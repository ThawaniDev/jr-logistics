import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessProfiles, requests, users, type Request, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { can, requirePerm } from "./auth/permissions";
import { getSettings } from "./settings";
import { viewRequest } from "./requests";
import { pickupPinOf } from "./warehouse";
import { buildMilestones, closedKind, DELIVERY_EDGES_S, histogram, minutes, orderAlerts, overdueMin, percentile, punctuality, rate, resolveMilestoneTimes, secBetween, topReasons } from "./details-orders-lib";

/** Order views: the order summary every section needs (header, KPI strip, overview). Sections have their own modules: details-orders-{offers,parcels,money,comms,parcel}.ts. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const maskPhone = (p: string | null) => (p ? p.slice(0, 4) + "•••" + p.slice(-2) : null);
export const num = (v: unknown) => (v == null ? 0 : Number(v));
export const numOrNull = (v: unknown) => (v == null ? null : Number(v));
export const isoOrNull = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw SQL rows carry driver-typed values; every field is read through num() / isoOrNull() / String()
export type Row = Record<string, any>;
export const rowsOf = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Row[];

/** The order, or 404 / 403. Every order endpoint starts here (`requests.view`; an id that is not a uuid is simply "not found"). */
export async function loadOrder(user: Pick<User, "role" | "permissions">, id: string): Promise<Request> {
  requirePerm(user, "requests.view");
  if (!UUID_RE.test(id)) throw err("NOT_FOUND", "Request not found");
  const [r] = await db.select().from(requests).where(eq(requests.id, id));
  if (!r) throw err("NOT_FOUND", "Request not found");
  return r;
}

/** Which money views the viewer has: price / provider cost / margin / ledger need `finance.view`; cash on delivery also `cod.manage`. */
export const moneyAccess = (u: Pick<User, "role" | "permissions">) => ({ finance: can(u, "finance.view"), pricing: can(u, "finance.view") || can(u, "pricing.view"), cod: can(u, "finance.view") || can(u, "cod.manage"), sensitive: can(u, "drivers.sensitive") });

async function parcelFigures(id: string) {
  const [a] = await rowsOf(sql`select count(*)::int total,
      count(*) filter (where status = 'delivered')::int delivered, count(*) filter (where status = 'failed')::int failed, count(*) filter (where status = 'returned')::int returned,
      count(*) filter (where status = 'missing')::int missing, count(*) filter (where status = 'cancelled')::int cancelled, count(*) filter (where status = 'pending')::int pending, count(*) filter (where status = 'loaded')::int loaded,
      count(*) filter (where status = 'delivered' and attempts <= 1)::int first_attempt,
      count(*) filter (where status <> 'cancelled' and (lat is null or lng is null))::int no_coords,
      count(*) filter (where status <> 'cancelled' and not details_complete)::int incomplete,
      count(*) filter (where status = 'pending' and offer_id is null)::int unassigned,
      count(*) filter (where partner_id is not null)::int partner,
      coalesce(sum(cod_cents) filter (where status <> 'cancelled'), 0)::float8 cod_due, coalesce(sum(cod_collected_cents) filter (where status = 'delivered'), 0)::float8 cod_collected,
      min(loaded_at) first_loaded_at, min(delivered_at) first_delivered_at, coalesce(sum(defer_count), 0)::int defers
    from shipments where request_id = ${id}::uuid`);
  const [byReason, durations, points] = await Promise.all([
    rowsOf(sql`select fail_reason as reason, count(*)::int n from shipments where request_id = ${id}::uuid and status in ('failed', 'returned', 'missing') group by fail_reason`),
    rowsOf(sql`select extract(epoch from (delivered_at - loaded_at))::int s from shipments where request_id = ${id}::uuid and status = 'delivered' and loaded_at is not null and delivered_at is not null limit 2000`),
    rowsOf(sql`select id, seq, code, lat, lng, status from shipments where request_id = ${id}::uuid and lat is not null and lng is not null order by seq limit 2000`),
  ]);
  return { a, byReason, durations: durations.map((d) => Number(d.s)).filter((n) => Number.isFinite(n) && n >= 0), points };
}

/** The numbers behind the milestone fallbacks: what the offers and the job events say when the request's own milestone columns are still empty. */
async function fallbackTimes(id: string, quantity: number) {
  const [o] = await rowsOf(sql`select min(created_at) first_offer, min(accepted_at) first_accepted, min(route_approved_at) started, min(loaded_at) loaded,
      (select a.accepted_at from offers a where a.request_id = ${id}::uuid and a.accepted_at is not null order by a.accepted_at offset ${Math.max(0, quantity - 1)} limit 1) nth_accepted from offers where request_id = ${id}::uuid`);
  const ev = await rowsOf(sql`select type, min(created_at) at from job_events where request_id = ${id}::uuid and type in ('request_published', 'offers_dispatched', 'driver_accepted', 'driver_assigned', 'route_approved', 'request_created') group by type`);
  const at = Object.fromEntries(ev.map((e) => [e.type, e.at]));
  return {
    offers: { firstOfferAt: o?.first_offer, firstAcceptedAt: o?.first_accepted, filledAt: o?.nth_accepted, startedAt: o?.started, loadedAt: o?.loaded },
    events: { createdAt: at.request_created, publishedAt: at.request_published, firstOfferAt: at.offers_dispatched ?? at.driver_assigned, firstAcceptedAt: at.driver_accepted ?? at.driver_assigned, startedAt: at.route_approved },
  };
}

/** Everything the order's header, KPI strip and overview need in one call (about a dozen bounded queries, run in parallel). */
export async function orderOverview(user: User, id: string) {
  const r = await loadOrder(user, id);
  const acc = moneyAccess(user);
  const canSupport = can(user, "tickets.view") || can(user, "tickets.manage") || can(user, "complaints.manage");
  const [cfg, pf, fb, offerRows, [co], [rem], [rat], [sup], [money], pin] = await Promise.all([
    getSettings(), parcelFigures(r.id), fallbackTimes(r.id, r.quantity),
    rowsOf(sql`select id, status, created_at, accepted_at, arrived_at, attendance_at, loaded_at, route_approved_at, delivered_at, final_at, cancelled_at, source, is_replacement from offers where request_id = ${r.id}::uuid order by created_at`),
    db.select({ name: users.name, phone: users.phone, company: businessProfiles.companyName, cr: businessProfiles.crNumber }).from(users).leftJoin(businessProfiles, eq(businessProfiles.userId, users.id)).where(eq(users.id, r.businessId)),
    rowsOf(sql`select coalesce(sum(amount_cents), 0)::float8 total from cod_remittances where request_id = ${r.id}::uuid`),
    rowsOf(sql`select avg(rt.stars)::float8 avg, count(*)::int n from ratings rt join offers o on o.id = rt.offer_id where o.request_id = ${r.id}::uuid and rt.ratee_id = o.driver_id`),
    canSupport ? rowsOf(sql`select (select count(*) from tickets where request_id = ${r.id}::uuid and status <> 'resolved')::int open_t, (select count(*) from complaints where request_id = ${r.id}::uuid and status in ('open', 'in_progress'))::int open_c, (select count(*) from tickets where request_id = ${r.id}::uuid)::int all_t, (select count(*) from complaints where request_id = ${r.id}::uuid)::int all_c`) : Promise.resolve([null]),
    acc.finance ? rowsOf(sql`select count(*)::int n, coalesce(sum(customer_cents), 0)::float8 customer, coalesce(sum(provider_cents), 0)::float8 provider, coalesce(sum(margin_cents), 0)::float8 margin, coalesce(sum(vat_cents), 0)::float8 vat from settlements where request_id = ${r.id}::uuid and status <> 'rejected'`) : Promise.resolve([null]),
    pickupPinOf(r),
  ]);
  const a = pf.a, now = Date.now();
  const manifest = num(a.total) > 0 || r.service === "delivery_driver";
  const mt = buildMilestones(resolveMilestoneTimes({
    row: { createdAt: r.createdAt, publishedAt: r.publishedAt, firstOfferAt: r.firstOfferAt, firstAcceptedAt: r.firstAcceptedAt, filledAt: r.filledAt, startedAt: r.startedAt, loadedAt: null, firstDeliveryAt: a.first_delivered_at, closedAt: r.completedAt ?? r.cancelledAt ?? (r.status === "expired" ? r.updatedAt : null) },
    offers: { ...fb.offers, filledAt: r.slotsFilled >= r.quantity ? fb.offers.filledAt : null, loadedAt: a.first_loaded_at ?? fb.offers.loadedAt }, events: fb.events,
  }));
  const at = (k: string) => mt.find((m) => m.key === k)?.at ?? null;
  const live = ["published", "filling", "assigned", "confirmed", "in_progress"].includes(r.status);
  const accepted = offerRows.filter((o) => o.accepted_at && !["rejected", "expired", "cancelled", "no_show", "replaced"].includes(o.status));
  const pun = punctuality(r.startsAt, accepted.map((o) => o.arrived_at).filter(Boolean), cfg.lateGraceMin);
  const waiting = accepted.filter((o) => !o.arrived_at && ["accepted"].includes(o.status));
  const overdue = waiting.map(() => overdueMin(r.startsAt, cfg.lateGraceMin, now)).filter((m) => m > 0);
  const delivered = num(a.delivered), failed = num(a.failed), returned = num(a.returned);
  const startedAt = at("started"), closedAt = at("closed");
  const codCollected = num(a.cod_collected), codRemitted = num(rem?.total);
  const openSupport = sup ? num(sup.open_t) + num(sup.open_c) : null;
  const codOutstanding = acc.cod ? Math.max(0, codCollected - codRemitted) : null;
  const snap = r.pricingSnapshot as Row | null;
  const durations = pf.durations;
  const funnel = {
    offered: offerRows.length, accepted: offerRows.filter((o) => o.accepted_at).length, arrived: offerRows.filter((o) => o.arrived_at).length, attendance: offerRows.filter((o) => o.attendance_at).length,
    loaded: offerRows.filter((o) => o.loaded_at).length, delivered: offerRows.filter((o) => o.delivered_at || o.final_at).length,
    cancelled: offerRows.filter((o) => o.status === "cancelled").length, noShow: offerRows.filter((o) => o.status === "no_show").length, replaced: offerRows.filter((o) => o.status === "replaced").length,
    rejected: offerRows.filter((o) => o.status === "rejected").length, expired: offerRows.filter((o) => o.status === "expired").length,
  };
  return {
    request: viewRequest(r, user),
    company: { id: r.businessId, name: co?.company ?? co?.name ?? "", contactName: co?.name ?? "", phone: acc.sensitive ? co?.phone ?? null : maskPhone(co?.phone ?? null), crNumber: co?.cr ?? null },
    flags: { allOrNothing: r.allowPartial === false, detailsLater: num(a.incomplete) > 0, partnerCreated: num(a.partner) > 0, partnerParcels: num(a.partner), createdVia: r.createdVia, manifest, closed: closedKind(r.status) },
    access: { finance: acc.finance, pricing: acc.pricing, cod: acc.cod, sensitive: acc.sensitive, support: canSupport },
    kpis: {
      slots: { filled: r.slotsFilled, needed: r.quantity },
      parcels: { total: num(a.total), delivered, failed, returned, missing: num(a.missing), cancelled: num(a.cancelled), pending: num(a.pending) + num(a.loaded), pendingHandover: num(a.pending), onBoard: num(a.loaded), unassigned: num(a.unassigned), defers: num(a.defers) },
      successRate: rate(delivered, delivered + failed + returned), firstAttemptRate: rate(num(a.first_attempt), delivered),
      start: { startsAt: r.startsAt.toISOString(), ...pun },
      timeToFirstOfferS: secBetween(at("published") ?? at("created"), at("first_offer")), timeToFirstAcceptS: secBetween(at("published") ?? at("created"), at("first_accepted")), timeToFillS: secBetween(at("published") ?? at("created"), at("filled")),
      executionS: startedAt ? secBetween(startedAt, closedAt ?? new Date(now)) : null, executionRunning: !!startedAt && !closedAt && live,
      rating: { avg: numOrNull(rat?.avg), count: num(rat?.n) },
      support: sup ? { open: openSupport, total: num(sup.all_t) + num(sup.all_c) } : null,
      money: acc.pricing ? {
        totalCents: r.totalCents, providerCents: numOrNull(snap?.providerTotalCents), marginCents: numOrNull(snap?.marginCents), reservedCents: r.reservedCents,
        settled: acc.finance && money ? { n: num(money.n), customerCents: num(money.customer), providerCents: num(money.provider), marginCents: num(money.margin), vatCents: num(money.vat) } : null,
      } : null,
      cod: acc.cod ? { dueCents: num(a.cod_due), collectedCents: codCollected, remittedCents: codRemitted, outstandingCents: codOutstanding } : null,
    },
    milestones: mt, graceMin: cfg.lateGraceMin,
    funnel,
    parcelMix: { pending: num(a.pending), loaded: num(a.loaded), delivered, failed, returned, missing: num(a.missing), cancelled: num(a.cancelled) },
    failureReasons: topReasons(pf.byReason.map((x) => ({ reason: x.reason, n: num(x.n) }))),
    delivery: { n: durations.length, p50: percentile(durations, 50), p90: percentile(durations, 90), edges: [...DELIVERY_EDGES_S], buckets: histogram(durations) },
    map: { pickup: pin, points: pf.points.map((p) => ({ id: p.id, seq: num(p.seq), code: p.code, lat: Number(p.lat), lng: Number(p.lng), status: p.status })), located: pf.points.length, unlocated: num(a.no_coords) },
    alerts: orderAlerts({
      status: r.status, slotsFilled: r.slotsFilled, quantity: r.quantity, startsInMin: minutes(secBetween(now, r.startsAt)) ?? 0, manifest,
      parcels: { total: num(a.total), noCoords: num(a.no_coords), unassigned: num(a.unassigned), incomplete: num(a.incomplete), failedOpen: failed },
      lateDrivers: overdue.length, maxLateMin: Math.max(0, ...overdue), codOutstandingCents: codOutstanding, openSupport,
    }),
  };
}
