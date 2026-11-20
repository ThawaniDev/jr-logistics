import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { tickets, users, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { can, requirePerm } from "./auth/permissions";
import { maskPhone } from "./account-admin-rules";
import { num, rows } from "./analytics/guard";
import { handlingHistory, slaFor, SLA, worstSla, type AuditRow } from "./details-pure";
import { entityPath } from "./details-users";

type Row = Record<string, unknown>;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const avg = (v: unknown) => (v == null ? null : Math.round(num(v)));

/**
 * The person behind a ticket or complaint: who they are, how to reach their own page, and how they have used support so far (tickets and complaints in total / open, the
 * last five tickets, orders or jobs, rating). The phone follows `drivers.sensitive`; the support counts follow the permission that opens that queue.
 */
export async function personCard(viewer: User, userId: string, o: { exceptTicket?: string } = {}) {
  const [u] = await db.select({ id: users.id, name: users.name, role: users.role, status: users.status, city: users.city, phone: users.phone, email: users.email, createdAt: users.createdAt, lastSeenAt: users.lastSeenAt }).from(users).where(eq(users.id, userId));
  if (!u) return null;
  const seeT = can(viewer, "tickets.view"), seeC = can(viewer, "complaints.manage"), seeO = can(viewer, "requests.view");
  const [t, c, last, ord, rating, comp] = await Promise.all([
    seeT ? rows<Row>(sql`select count(*)::int as n, count(*) filter (where status in ('open','in_review'))::int as open_n from tickets where opened_by = ${userId}`) : null,
    seeC ? rows<Row>(sql`select count(*)::int as n, count(*) filter (where status in ('open','in_progress'))::int as open_n from complaints where filed_by = ${userId}`) : null,
    seeT ? rows<Row>(sql`select id, ref, subject, status, created_at from tickets where opened_by = ${userId} ${o.exceptTicket ? sql`and id <> ${o.exceptTicket}` : sql``} order by created_at desc limit 5`) : null,
    seeO ? (u.role === "business" ? rows<Row>(sql`select count(*)::int as n from requests where business_id = ${userId} and status <> 'draft'`)
      : u.role === "driver" ? rows<Row>(sql`select count(*)::int as n from offers where driver_id = ${userId} and accepted_at is not null`)
      : u.role === "office" ? rows<Row>(sql`select count(*)::int as n from offers where office_id = ${userId} and accepted_at is not null`) : null) : null,
    u.role === "business" ? rows<Row>(sql`select rating_sum as s, rating_count as n from business_profiles where user_id = ${userId}`) : u.role === "driver" ? rows<Row>(sql`select rating_sum as s, rating_count as n from driver_profiles where user_id = ${userId}`) : null,
    u.role === "business" ? rows<Row>(sql`select company_name as name from business_profiles where user_id = ${userId}`) : u.role === "office" ? rows<Row>(sql`select office_name as name from office_profiles where user_id = ${userId}`) : null,
  ]);
  const sens = can(viewer, "drivers.sensitive");
  return {
    id: u.id, name: u.name, company: (comp?.[0]?.name as string | null) ?? null, role: u.role, status: u.status, city: u.city, phone: sens ? u.phone : maskPhone(u.phone), email: u.email, createdAt: u.createdAt, lastSeenAt: u.lastSeenAt,
    href: entityPath(u.role, u.id), userHref: `/admin/users/${u.id}`,
    stats: {
      tickets: t ? { total: num(t[0]?.n), open: num(t[0]?.open_n) } : null, complaints: c ? { total: num(c[0]?.n), open: num(c[0]?.open_n) } : null,
      orders: ord ? num(ord[0]?.n) : null, rating: rating?.[0] && num(rating[0].n) > 0 ? { avg: Math.round((num(rating[0].s) / num(rating[0].n)) * 10) / 10, count: num(rating[0].n) } : null,
      lastTickets: last ? last.map((x) => ({ id: String(x.id), ref: String(x.ref), subject: String(x.subject), status: String(x.status), createdAt: iso(x.created_at) })) : null,
    },
  };
}

/**
 * The request, job, driver and company a ticket or complaint points at, each as a small card with the key facts. Every card follows the permission of its own view
 * (`requests.view`, `drivers.view`, a people permission); amounts need `finance.view` or `pricing.view`. A card the viewer may not open is `null`, and `hidden` says which.
 */
export async function relatedCards(viewer: User, ids: { requestId?: string | null; offerId?: string | null }) {
  const seeR = can(viewer, "requests.view"), seeD = can(viewer, "drivers.view") || can(viewer, "users.view"), seeC = can(viewer, "users.view") || can(viewer, "verification.manage") || can(viewer, "offices.view");
  const money = can(viewer, "finance.view") || can(viewer, "pricing.view"), earn = can(viewer, "finance.view");
  const hidden: string[] = [];
  let offer: Row | null = null, request: Row | null = null;
  if (ids.offerId && seeR) offer = (await rows<Row>(sql`select o.*, d.name as driver_name, f.name as office_name from offers o join users d on d.id = o.driver_id left join users f on f.id = o.office_id where o.id = ${ids.offerId}`))[0] ?? null;
  const requestId = ids.requestId ?? (offer?.request_id as string | undefined) ?? null;
  if (requestId && seeR) request = (await rows<Row>(sql`select r.*, p.company_name from requests r left join business_profiles p on p.user_id = r.business_id where r.id = ${requestId}`))[0] ?? null;
  if ((ids.requestId || ids.offerId) && !seeR) hidden.push("request");
  const driverId = (offer?.driver_id as string | undefined) ?? null;
  const [drv] = driverId && seeD ? await rows<Row>(sql`select u.id, u.name, u.status, u.city, p.vehicle_type, p.availability, p.verification_status, p.jobs_completed, p.rating_sum, p.rating_count from users u left join driver_profiles p on p.user_id = u.id where u.id = ${driverId}`) : [];
  const [co] = request && seeC ? await rows<Row>(sql`select u.id, u.name, u.status, u.city, p.company_name, p.verification_status, (select count(*) from requests where business_id = u.id and status <> 'draft')::int as orders from users u left join business_profiles p on p.user_id = u.id where u.id = ${request.business_id as string}`) : [];
  if (driverId && !seeD) hidden.push("driver");
  if (request && !seeC) hidden.push("company");
  return {
    request: request ? { id: String(request.id), ref: String(request.ref), status: String(request.status), service: String(request.service), title: (request.title as string | null) ?? null, pickupCity: String(request.pickup_city), deliveryCity: String(request.delivery_city), startsAt: iso(request.starts_at), createdAt: iso(request.created_at), completedAt: iso(request.completed_at), cancelledAt: iso(request.cancelled_at), cancelReason: (request.cancel_reason as string | null) ?? null, quantity: num(request.quantity), slotsFilled: num(request.slots_filled), createdVia: String(request.created_via), totalCents: money && request.total_cents != null ? num(request.total_cents) : null } : null,
    offer: offer ? { id: String(offer.id), status: String(offer.status), acceptedAt: iso(offer.accepted_at), arrivedAt: iso(offer.arrived_at), deliveredAt: iso(offer.delivered_at), expectedUnits: num(offer.expected_units), deliveredUnits: offer.delivered_units == null ? null : num(offer.delivered_units), finalUnits: offer.final_units == null ? null : num(offer.final_units), expectedEarningCents: earn ? num(offer.expected_earning_cents) : null, driver: { id: String(offer.driver_id), name: String(offer.driver_name) }, office: offer.office_id ? { id: String(offer.office_id), name: String(offer.office_name) } : null } : null,
    driver: drv ? { id: String(drv.id), name: String(drv.name), status: String(drv.status), city: (drv.city as string | null) ?? null, vehicleType: (drv.vehicle_type as string | null) ?? null, availability: (drv.availability as string | null) ?? null, verificationStatus: (drv.verification_status as string | null) ?? null, jobsCompleted: num(drv.jobs_completed), rating: num(drv.rating_count) > 0 ? Math.round((num(drv.rating_sum) / num(drv.rating_count)) * 10) / 10 : null, href: entityPath("driver", String(drv.id)) } : null,
    company: co ? { id: String(co.id), name: String((co.company_name as string | null) ?? co.name), status: String(co.status), city: (co.city as string | null) ?? null, verificationStatus: (co.verification_status as string | null) ?? null, orders: num(co.orders), href: entityPath("business", String(co.id)) } : null,
    hidden,
  };
}

/** The audit rows of one ticket / complaint, with who did it, folded into a readable handling history (status, priority, assignment, resolution). */
export async function historyOf(entity: "ticket" | "complaint", id: string) {
  const r = await rows<Row>(sql`select a.id, a.created_at as at, a.action, a.actor_id, u.name as actor_name, a.diff from audit_logs a left join users u on u.id = a.actor_id
    where a.entity = ${entity} and a.entity_id = ${id} and a.action like ${entity + ".%"} order by a.created_at desc limit 100`);
  const audits: AuditRow[] = r.map((x) => ({ id: String(x.id), at: x.at as string, action: String(x.action), actorId: (x.actor_id as string | null) ?? null, actorName: (x.actor_name as string | null) ?? null, diff: x.diff }));
  const ids = new Set<string>();
  for (const a of audits) { if (a.actorId) ids.add(a.actorId); const d = (a.diff ?? {}) as Record<string, unknown>; const f = (d.from ?? {}) as Record<string, unknown>; const p = (entity === "ticket" ? d.patch : d) as Record<string, unknown> | undefined; for (const v of [f.assignedTo, p?.assignTo]) if (typeof v === "string") ids.add(v); }
  const names = ids.size ? new Map((await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...ids]))).map((x) => [x.id, x.name])) : new Map<string, string>();
  return handlingHistory(entity, audits, (uid) => (uid ? names.get(uid) ?? null : null));
}

/** What similar cases looked like over the last 90 days (same category): how many, how they ended, how fast the team answered and resolved them. */
export async function categoryOutcomes(table: "tickets" | "complaints", category: string, exceptId: string) {
  const closed = table === "tickets" ? sql`status = 'resolved'` : sql`status in ('resolved','closed')`;
  const open = table === "tickets" ? sql`status in ('open','in_review')` : sql`status in ('open','in_progress')`;
  const tb = sql.raw(table);
  const [r] = await rows<Row>(sql`select count(*)::int as total, count(*) filter (where ${closed})::int as closed_n, count(*) filter (where ${open})::int as open_n,
      avg(extract(epoch from (first_response_at - created_at))) filter (where first_response_at is not null)::float8 as first_secs,
      avg(extract(epoch from (resolved_at - created_at))) filter (where resolved_at is not null)::float8 as res_secs,
      count(*) filter (where first_response_at is not null and extract(epoch from (first_response_at - created_at)) > ${SLA.firstResponseSec})::int as late_first,
      count(*) filter (where first_response_at is not null)::int as with_first
    from ${tb} where category = ${category} and id <> ${exceptId} and created_at >= now() - interval '90 days'`);
  return { total: num(r?.total), resolved: num(r?.closed_n), open: num(r?.open_n), avgFirstResponseSec: avg(r?.first_secs), avgResolutionSec: avg(r?.res_secs), firstResponseLateRate: num(r?.with_first) > 0 ? num(r?.late_first) / num(r?.with_first) : null };
}

/** `GET /admin/tickets/:id/context`: everything around a ticket that its conversation does not carry. Needs `tickets.view`; conversation and actions stay on `/admin/tickets/:id`. */
export async function ticketContext(viewer: User, id: string) {
  requirePerm(viewer, "tickets.view");
  if (!UUID.test(id)) throw err("NOT_FOUND");
  const [t] = await db.select().from(tickets).where(eq(tickets.id, id));
  if (!t) throw err("NOT_FOUND");
  const [requester, related, history, outcomes, sameCategory, names] = await Promise.all([
    personCard(viewer, t.openedBy, { exceptTicket: id }), relatedCards(viewer, { requestId: t.requestId, offerId: t.offerId }), historyOf("ticket", id), categoryOutcomes("tickets", t.category, id),
    rows<Row>(sql`select x.id, x.ref, x.subject, x.status, x.created_at, u.name as opener from tickets x join users u on u.id = x.opened_by where x.category = ${t.category} and x.id <> ${id} and x.opened_by <> ${t.openedBy} order by x.created_at desc limit 6`),
    db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [t.assignedTo, t.firstResponseBy].filter((x): x is string => !!x))),
  ]);
  const nm = new Map(names.map((n) => [n.id, n.name]));
  const sla = slaFor({ createdAt: t.createdAt, firstResponseAt: t.firstResponseAt, resolvedAt: t.resolvedAt });
  return {
    id: t.id, ref: t.ref, category: t.category, sla: { ...sla, worst: worstSla(sla), targets: { firstResponseSec: SLA.firstResponseSec, resolutionSec: SLA.resolutionSec } },
    milestones: { createdAt: t.createdAt, firstResponseAt: t.firstResponseAt, firstResponseBy: t.firstResponseBy ? { id: t.firstResponseBy, name: nm.get(t.firstResponseBy) ?? null } : null, resolvedAt: t.resolvedAt, reopenCount: t.reopenCount, assignee: t.assignedTo ? { id: t.assignedTo, name: nm.get(t.assignedTo) ?? null } : null },
    requester, related, history, outcomes,
    sameCategory: sameCategory.map((x) => ({ id: String(x.id), ref: String(x.ref), subject: String(x.subject), status: String(x.status), createdAt: iso(x.created_at), opener: String(x.opener) })),
    raw: { id: t.id, ref: t.ref, openedBy: t.openedBy, requestId: t.requestId, offerId: t.offerId, category: t.category, subject: t.subject, priority: t.priority, status: t.status, assignedTo: t.assignedTo, resolvedAt: t.resolvedAt, firstResponseAt: t.firstResponseAt, firstResponseBy: t.firstResponseBy, reopenCount: t.reopenCount, createdAt: t.createdAt, updatedAt: t.updatedAt },
  };
}
