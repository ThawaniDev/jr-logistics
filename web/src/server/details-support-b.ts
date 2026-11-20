import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { complaints, users, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { can, requirePerm } from "./auth/permissions";
import { num, rows } from "./analytics/guard";
import { slaFor, SLA, worstSla } from "./details-pure";
import { categoryOutcomes, historyOf, iso, personCard, relatedCards, UUID } from "./details-support";
import { entityPath } from "./details-users";

type Row = Record<string, unknown>;
type Complaint = typeof complaints.$inferSelect;
const clip = (s: unknown, n = 320) => (typeof s === "string" ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);

/** The other side of a complaint, as far as the data says: the driver / office of the job when a business complains, the business when a driver or office does. */
async function respondentsOf(c: Complaint) {
  if (!c.requestId && !c.offerId) return { items: [] as Array<{ id: string; name: string; role: string; href: string }>, basis: "none" as const };
  const [r] = c.requestId ? await rows<Row>(sql`select business_id from requests where id = ${c.requestId}`) : [];
  const people = (ids: string[]) => (ids.length ? db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(inArray(users.id, ids)) : Promise.resolve([]));
  let ids: string[] = [];
  if (c.filedByRole === "business") {
    const o = await rows<Row>(c.offerId ? sql`select driver_id, office_id from offers where id = ${c.offerId}` : sql`select driver_id, office_id from offers where request_id = ${c.requestId} and accepted_at is not null and status not in ('rejected','expired','cancelled','replaced') limit 5`);
    ids = [...new Set(o.flatMap((x) => [x.driver_id, x.office_id]).filter((x): x is string => typeof x === "string"))];
  } else if (r?.business_id && r.business_id !== c.filedBy) ids = [String(r.business_id)];
  const list = (await people(ids.slice(0, 6))).filter((p) => p.id !== c.filedBy);
  return { items: list.map((p) => ({ id: p.id, name: p.name, role: p.role, href: entityPath(p.role, p.id) })), basis: c.offerId ? ("offer" as const) : ("request" as const) };
}

/** Facts of the job that decide a complaint: timeline against the start time, the driver's lateness, parcels by outcome, the last chat messages, ratings (`requests.view`). */
async function evidenceOf(c: Complaint) {
  const [o] = c.offerId ? await rows<Row>(sql`select o.*, r.starts_at from offers o join requests r on r.id = o.request_id where o.id = ${c.offerId}`) : [];
  const [req] = !o && c.requestId ? await rows<Row>(sql`select starts_at, created_at, published_at, completed_at, cancelled_at from requests where id = ${c.requestId}`) : [];
  const scope = c.offerId ? sql`offer_id = ${c.offerId}` : c.requestId ? sql`request_id = ${c.requestId}` : sql`false`;
  const [chat, parcels, reasons, ratings, custody] = await Promise.all([
    rows<Row>(sql`select m.id, m.created_at, m.sender_role, u.name, m.body from messages m join users u on u.id = m.sender_id where ${sql.raw(c.offerId ? "m.offer_id" : "m.request_id")} = ${c.offerId ?? c.requestId ?? null} order by m.created_at desc limit 8`),
    rows<Row>(sql`select s.status as k, count(*)::int as n from shipments s where ${c.offerId ? sql`s.offer_id = ${c.offerId}` : sql`s.request_id = ${c.requestId ?? null}`} group by 1`),
    rows<Row>(sql`select coalesce(s.fail_reason, 'other') as k, count(*)::int as n from shipments s where ${c.offerId ? sql`s.offer_id = ${c.offerId}` : sql`s.request_id = ${c.requestId ?? null}`} and s.status in ('failed','returned') group by 1 order by n desc limit 5`),
    c.offerId ? rows<Row>(sql`select r.stars, r.comment, r.created_at, u.name as rater, r.rater_id from ratings r join users u on u.id = r.rater_id where r.offer_id = ${c.offerId}`) : Promise.resolve([] as Row[]),
    rows<Row>(sql`select item_type, status, qty from custody_items where ${scope} order by created_at desc limit 10`),
  ]);
  const startsAt = (o?.starts_at ?? req?.starts_at) as string | undefined;
  const t = (k: string) => (o?.[k] ? iso(o[k]) : null);
  const arrived = t("arrived_at");
  return {
    startsAt: iso(startsAt),
    timeline: o ? [["accepted", t("accepted_at")], ["arrived", arrived], ["attendance", t("attendance_at")], ["loaded", t("loaded_at")], ["delivered", t("delivered_at")], ["final", t("final_at")], ["cancelled", t("cancelled_at")]]
      .filter(([, at]) => at).map(([key, at]) => ({ key: key as string, at: at as string })) : [],
    offerStatus: o ? String(o.status) : null, lateMinutes: arrived && startsAt ? Math.round((new Date(arrived).getTime() - new Date(startsAt).getTime()) / 60000) : null,
    units: o ? { expected: num(o.expected_units), delivered: o.delivered_units == null ? null : num(o.delivered_units), final: o.final_units == null ? null : num(o.final_units), loaded: o.loaded_units == null ? null : num(o.loaded_units) } : null,
    parcels: { byStatus: Object.fromEntries(parcels.map((p) => [String(p.k), num(p.n)])), failureReasons: reasons.map((r) => ({ key: String(r.k), value: num(r.n) })) },
    chat: chat.map((m) => ({ id: String(m.id), at: iso(m.created_at), name: String(m.name), role: String(m.sender_role), body: clip(m.body) })).reverse(),
    ratings: ratings.map((r) => ({ stars: num(r.stars), comment: clip(r.comment), rater: String(r.rater), raterId: String(r.rater_id) })),
    custody: custody.map((x) => ({ type: String(x.item_type), status: String(x.status), qty: num(x.qty) })),
  };
}

/** The settlement(s) of the job and what this complaint does to them. Amounts need `finance.view`; the hold itself is shown to every complaint handler. */
async function settlementOf(viewer: User, c: Complaint) {
  const money = can(viewer, "finance.view");
  const where = c.offerId ? sql`s.offer_id = ${c.offerId}` : c.requestId ? sql`s.request_id = ${c.requestId}` : sql`false`;
  const list = await rows<Row>(sql`select s.id, s.status, s.final_units, s.customer_cents, s.provider_cents, s.margin_cents, s.vat_cents, s.refund_cents, s.adjustment_cents, s.created_at, s.paid_at, s.request_id, r.ref
    from settlements s join requests r on r.id = s.request_id where ${where} order by s.created_at desc limit 5`);
  const others = await rows<Row>(sql`select id, ref, status from complaints where holds_settlement and status in ('open','in_progress') and id <> ${c.id}
    and ${c.offerId ? sql`(offer_id = ${c.offerId} or (offer_id is null and request_id = ${c.requestId ?? null}))` : sql`request_id = ${c.requestId ?? null}`} limit 5`);
  const active = c.holdsSettlement && (c.status === "open" || c.status === "in_progress");
  return {
    holds: c.holdsSettlement, active, items: list.map((s) => ({
      id: String(s.id), status: String(s.status), requestId: String(s.request_id), ref: String(s.ref), finalUnits: num(s.final_units), createdAt: iso(s.created_at), paidAt: iso(s.paid_at),
      ...(money ? { customerCents: num(s.customer_cents), providerCents: num(s.provider_cents), marginCents: num(s.margin_cents), vatCents: num(s.vat_cents), refundCents: num(s.refund_cents), adjustmentCents: num(s.adjustment_cents) } : {}),
    })), otherHolds: others.map((o) => ({ id: String(o.id), ref: String(o.ref), status: String(o.status) })), moneyHidden: !money,
  };
}

/** `GET /admin/complaints/:id/context`: parties, related cards, evidence, settlement hold, handling history and how similar complaints ended. Needs `complaints.manage`. */
export async function complaintContext(viewer: User, id: string) {
  requirePerm(viewer, "complaints.manage");
  if (!UUID.test(id)) throw err("NOT_FOUND");
  const [c] = await db.select().from(complaints).where(eq(complaints.id, id));
  if (!c) throw err("NOT_FOUND");
  const seeR = can(viewer, "requests.view");
  const [filer, respondents, related, evidence, settlement, history, outcomes, similar, names] = await Promise.all([
    personCard(viewer, c.filedBy), respondentsOf(c), relatedCards(viewer, { requestId: c.requestId, offerId: c.offerId }), seeR && (c.requestId || c.offerId) ? evidenceOf(c) : Promise.resolve(null),
    settlementOf(viewer, c), historyOf("complaint", id), categoryOutcomes("complaints", c.category, id),
    rows<Row>(sql`select x.id, x.ref, x.status, x.created_at, x.resolved_at, x.resolution, x.holds_settlement, u.name as filer from complaints x join users u on u.id = x.filed_by
      where x.category = ${c.category} and x.id <> ${id} order by (x.status in ('resolved','closed')) desc, x.created_at desc limit 6`),
    db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [c.handlerId, c.firstResponseBy].filter((x): x is string => !!x))),
  ]);
  const nm = new Map(names.map((n) => [n.id, n.name]));
  const sla = slaFor({ createdAt: c.createdAt, firstResponseAt: c.firstResponseAt, resolvedAt: c.resolvedAt });
  const holdN = await rows<Row>(sql`select count(*)::int as n, count(*) filter (where holds_settlement)::int as holds from complaints where category = ${c.category} and id <> ${id} and created_at >= now() - interval '90 days'`);
  return {
    id: c.id, ref: c.ref, category: c.category, sla: { ...sla, worst: worstSla(sla), targets: { firstResponseSec: SLA.firstResponseSec, resolutionSec: SLA.resolutionSec } },
    milestones: { createdAt: c.createdAt, firstResponseAt: c.firstResponseAt, firstResponseBy: c.firstResponseBy ? { id: c.firstResponseBy, name: nm.get(c.firstResponseBy) ?? null } : null, resolvedAt: c.resolvedAt, handler: c.handlerId ? { id: c.handlerId, name: nm.get(c.handlerId) ?? null } : null },
    filer, respondents, related, evidence, settlement, history, evidenceHidden: !seeR,
    outcomes: { ...outcomes, holdRate: num(holdN[0]?.n) > 0 ? num(holdN[0]?.holds) / num(holdN[0]?.n) : null },
    similar: similar.map((x) => ({ id: String(x.id), ref: String(x.ref), status: String(x.status), createdAt: iso(x.created_at), resolvedAt: iso(x.resolved_at), resolution: clip(x.resolution, 200), holdsSettlement: !!x.holds_settlement, filer: String(x.filer) })),
    raw: { id: c.id, ref: c.ref, filedBy: c.filedBy, filedByRole: c.filedByRole, requestId: c.requestId, offerId: c.offerId, category: c.category, priority: c.priority, status: c.status, handlerId: c.handlerId, holdsSettlement: c.holdsSettlement, resolvedAt: c.resolvedAt, firstResponseAt: c.firstResponseAt, firstResponseBy: c.firstResponseBy, createdAt: c.createdAt, updatedAt: c.updatedAt },
  };
}
