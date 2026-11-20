import { sql, type SQL } from "drizzle-orm";
import type { User } from "@/db/schema";
import { contains } from "@/lib/sql";
import { can, requirePerm } from "./auth/permissions";
import { audit } from "./audit";
import { toCsv } from "./ops";
import { inWindow } from "./analytics/conditions";
import { num, rows } from "./analytics/guard";
import { GROUP_STATUSES, JOB_GROUPS, PARCEL_GROUPS, clampPage, parsePeriod, resolvePeriod, type JobGroup, type ParcelGroup, type PeriodKey } from "./details-people-lib";
import { BUSINESS_JOIN, BUSINESS_NAME, list } from "./details-people-sql";
import { driverBase } from "./details-people";

/** Driver detail lists: every offer (job) with its timeline, every parcel with its outcome, the ratings received and the support items that involve the driver. */
type Rec = Record<string, unknown>;
export interface ListQuery { period?: string; group?: string; q?: string; reason?: string; city?: string; stars?: number; page?: number; pageSize?: number }
const periodWindow = async (u: { createdAt: Date }, key?: string) => resolvePeriod(parsePeriod(key) as PeriodKey, new Date(), u.createdAt).cur;

const groupWhere = (g: JobGroup): SQL => (g === "all" ? sql`true` : sql`offers.status in (${list(GROUP_STATUSES[g])})`);

/** What an offers list is about: the SQL that picks the offers (`offers.driver_id = …` or `offers.office_id = …`), and whether the viewer may see earnings. */
export interface OfferScope { where: SQL; money: boolean }
/** One page of offers (jobs) with their timeline, parcels, rating and earnings, filtered by period (the day the offer was sent), status group, driver and search text. */
export async function offerList(scope: OfferScope, win: { start: Date; end: Date }, q: ListQuery & { driverId?: string }) {
  const { page, pageSize, offset } = clampPage(q, 10, 50); const money = scope.money;
  const group = (JOB_GROUPS as readonly string[]).includes(q.group ?? "") ? (q.group as JobGroup) : "all"; const find = q.q?.trim() ? contains(q.q) : null;
  const base = sql`${scope.where} and ${inWindow("offers.created_at", win)} ${q.driverId ? sql`and offers.driver_id = ${q.driverId}` : sql``} ${find ? sql`and (requests.ref ilike ${find} or ${BUSINESS_NAME} ilike ${find} or du.name ilike ${find})` : sql``}`;
  const [items, counts] = await Promise.all([
    rows<Rec>(sql`select offers.id, offers.request_id, offers.driver_id, du.name as driver, requests.ref, requests.service, requests.starts_at, requests.pickup_city, requests.delivery_city, requests.business_id, ${BUSINESS_NAME} as business,
        offers.status, offers.source, offers.is_replacement, offers.expected_units, offers.delivered_units, offers.final_units, offers.expected_earning_cents, offers.cancel_reason,
        offers.created_at, offers.accepted_at, offers.arrived_at, offers.attendance_at, offers.loaded_at, offers.delivered_at, offers.final_at, offers.cancelled_at,
        pc.total as parcels, pc.delivered as parcels_delivered, pc.failed as parcels_failed, st.id as settlement_id, st.provider_cents, st.status as settlement_status, rt.stars as rating
      from offers join requests on requests.id = offers.request_id join users du on du.id = offers.driver_id ${BUSINESS_JOIN}
      left join lateral (select count(*)::int as total, count(*) filter (where s.status = 'delivered')::int as delivered, count(*) filter (where s.status in ('failed','returned'))::int as failed from shipments s where s.offer_id = offers.id) pc on true
      left join settlements st on st.offer_id = offers.id left join ratings rt on rt.offer_id = offers.id and rt.ratee_id = offers.driver_id
      where ${base} and ${groupWhere(group)} order by offers.created_at desc, offers.id desc limit ${pageSize} offset ${offset}`),
    rows<Rec>(sql`select count(*)::int as n, ${sql.join(Object.entries(GROUP_STATUSES).map(([g, st]) => sql`count(*) filter (where offers.status in (${list(st)}))::int as ${sql.raw(g)}`), sql`, `)}
      from offers join requests on requests.id = offers.request_id join users du on du.id = offers.driver_id ${BUSINESS_JOIN} where ${base}`),
  ]);
  const c = counts[0] ?? {}; const total = group === "all" ? num(c.n) : num(c[group]);
  return {
    page, pageSize, total, counts: { all: num(c.n), active: num(c.active), completed: num(c.completed), cancelled: num(c.cancelled), no_show: num(c.no_show), declined: num(c.declined) },
    items: items.map((r) => ({
      offerId: r.id, requestId: r.request_id, driverId: r.driver_id, driver: r.driver, ref: r.ref, service: r.service, startsAt: r.starts_at, pickupCity: r.pickup_city, deliveryCity: r.delivery_city, businessId: r.business_id, business: r.business,
      status: r.status, source: r.source, isReplacement: !!r.is_replacement, expectedUnits: num(r.expected_units), deliveredUnits: r.delivered_units, finalUnits: r.final_units, cancelReason: r.cancel_reason,
      timeline: { offeredAt: r.created_at, acceptedAt: r.accepted_at, arrivedAt: r.arrived_at, attendanceAt: r.attendance_at, loadedAt: r.loaded_at, deliveredAt: r.delivered_at, finalAt: r.final_at, cancelledAt: r.cancelled_at },
      parcels: { total: num(r.parcels), delivered: num(r.parcels_delivered), failed: num(r.parcels_failed) }, rating: r.rating ?? null,
      earningCents: money ? (r.provider_cents ?? null) : undefined, expectedEarningCents: money ? num(r.expected_earning_cents) : undefined, settlementId: money ? r.settlement_id ?? null : undefined, settlementStatus: money ? r.settlement_status ?? null : undefined,
    })),
  };
}
/** All offers of a driver, newest first. Earnings need `finance.view`. */
export async function driverOffers(viewer: User, driverId: string, q: ListQuery) {
  const { u } = await driverBase(viewer, driverId);
  return offerList({ where: sql`offers.driver_id = ${driverId}`, money: can(viewer, "finance.view") }, await periodWindow(u, q.period ?? "all"), q);
}

const ANCHOR = sql`coalesce(shipments.delivered_at, shipments.failed_at, shipments.returned_at, shipments.loaded_at, shipments.created_at)`;
const parcelGroup = (g: ParcelGroup): SQL => g === "delivered" ? sql`shipments.status = 'delivered'` : g === "failed" ? sql`shipments.status = 'failed'` : g === "returned" ? sql`shipments.status = 'returned'` : g === "open" ? sql`shipments.status in ('pending','loaded')` : sql`true`;
function parcelWhere(driverId: string, win: { start: Date; end: Date }, q: ListQuery) {
  const find = q.q?.trim() ? contains(q.q) : null;
  return sql`offers.driver_id = ${driverId} and ${inWindow(ANCHOR, win)}
    ${q.reason ? sql`and shipments.fail_reason = ${q.reason}` : sql``} ${q.city ? sql`and shipments.city = ${q.city}` : sql``}
    ${find ? sql`and (shipments.code ilike ${find} or shipments.recipient_name ilike ${find} or requests.ref ilike ${find} or shipments.external_ref ilike ${find})` : sql``}`;
}
const PARCEL_FROM = sql`from shipments join offers on offers.id = shipments.offer_id join requests on requests.id = shipments.request_id ${BUSINESS_JOIN}`;
export const PARCEL_CSV_MAX = 5000;

/** The parcels a driver carried, with the outcome, reason and times of each. `format = csv` needs `reports.export` (audited). */
export async function driverParcels(viewer: User, driverId: string, q: ListQuery) {
  const { u } = await driverBase(viewer, driverId);
  const group = (PARCEL_GROUPS as readonly string[]).includes(q.group ?? "") ? (q.group as ParcelGroup) : "all";
  const win = await periodWindow(u, q.period ?? "all"); const where = parcelWhere(driverId, win, q);
  const cols = sql`shipments.id, shipments.code, shipments.request_id, requests.ref, ${BUSINESS_NAME} as business, shipments.recipient_name, shipments.city, shipments.status, shipments.attempts, shipments.defer_count,
      shipments.fail_reason, shipments.fail_note, shipments.loaded_at, shipments.arrived_at, shipments.delivered_at, shipments.failed_at, shipments.returned_at, shipments.proof_type, shipments.delivered_distance_m,
      shipments.cod_cents, shipments.cod_collected_cents, ${ANCHOR} as at`;
  const map = (r: Rec) => ({
    id: r.id, code: r.code, requestId: r.request_id, ref: r.ref, business: r.business, recipient: r.recipient_name, city: r.city, status: r.status, attempts: num(r.attempts), deferrals: num(r.defer_count),
    failReason: r.fail_reason ?? null, failNote: r.fail_note ?? null, loadedAt: r.loaded_at, arrivedAt: r.arrived_at, deliveredAt: r.delivered_at, failedAt: r.failed_at, returnedAt: r.returned_at,
    proofType: r.proof_type ?? null, distanceM: r.delivered_distance_m ?? null, codCents: num(r.cod_cents), codCollectedCents: r.cod_collected_cents ?? null, at: r.at,
  });
  const { page, pageSize, offset } = clampPage(q, 10, 100);
  const [items, counts, cities, reasons] = await Promise.all([
    rows<Rec>(sql`select ${cols} ${PARCEL_FROM} where ${where} and ${parcelGroup(group)} order by ${ANCHOR} desc, shipments.id desc limit ${pageSize} offset ${offset}`),
    rows<Rec>(sql`select count(*)::int as n, count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*) filter (where shipments.status = 'failed')::int as failed,
        count(*) filter (where shipments.status = 'returned')::int as returned, count(*) filter (where shipments.status in ('pending','loaded'))::int as open ${PARCEL_FROM} where ${where}`),
    rows<Rec>(sql`select shipments.city as city, count(*)::int as n ${PARCEL_FROM} where offers.driver_id = ${driverId} and ${inWindow(ANCHOR, win)} group by 1 order by 2 desc limit 30`),
    rows<Rec>(sql`select shipments.fail_reason as reason, count(*)::int as n ${PARCEL_FROM} where offers.driver_id = ${driverId} and ${inWindow(ANCHOR, win)} and shipments.fail_reason is not null group by 1 order by 2 desc limit 15`),
  ]);
  const c = counts[0] ?? {};
  return {
    page, pageSize, total: group === "all" ? num(c.n) : num(c[group]), counts: { all: num(c.n), delivered: num(c.delivered), failed: num(c.failed), returned: num(c.returned), open: num(c.open) },
    cities: cities.map((x) => ({ city: String(x.city), count: num(x.n) })), reasons: reasons.map((x) => ({ reason: String(x.reason), count: num(x.n) })), items: items.map(map),
  };
}

/** CSV of the filtered parcels (up to `PARCEL_CSV_MAX`), formula-injection safe; needs `reports.export` and is audited. */
export async function driverParcelsCsv(viewer: User, driverId: string, q: ListQuery) {
  requirePerm(viewer, "reports.export");
  const { u } = await driverBase(viewer, driverId);
  const group = (PARCEL_GROUPS as readonly string[]).includes(q.group ?? "") ? (q.group as ParcelGroup) : "all";
  const win = await periodWindow(u, q.period ?? "all");
  const data = await rows<Rec>(sql`select shipments.code, requests.ref as order_ref, ${BUSINESS_NAME} as business, shipments.recipient_name as recipient, shipments.city, shipments.status, shipments.attempts, shipments.fail_reason, shipments.fail_note,
      shipments.arrived_at, shipments.delivered_at, shipments.failed_at, shipments.returned_at, shipments.cod_cents, shipments.cod_collected_cents ${PARCEL_FROM}
    where ${parcelWhere(driverId, win, q)} and ${parcelGroup(group)} order by ${ANCHOR} desc, shipments.id desc limit ${PARCEL_CSV_MAX}`, 30_000);
  const cols = ["code", "order_ref", "business", "recipient", "city", "status", "attempts", "fail_reason", "fail_note", "arrived_at", "delivered_at", "failed_at", "returned_at", "cod_cents", "cod_collected_cents"];
  await audit(viewer, "report.export", "driver_parcels", driverId, { rows: data.length, group, period: q.period ?? "all" });
  return { csv: "\uFEFF" + toCsv(cols, data.map((r) => Object.fromEntries(cols.map((k) => [k, r[k] instanceof Date ? (r[k] as Date).toISOString() : r[k]])))), name: u.name };
}

/** Ratings the driver received (newest first, `stars` narrows) with the person who gave them, plus the tickets and complaints that involve the driver. */
export async function driverReviews(viewer: User, driverId: string, q: ListQuery) {
  await driverBase(viewer, driverId);
  const { page, pageSize, offset } = clampPage(q, 10, 50); const stars = q.stars && q.stars >= 1 && q.stars <= 5 ? Math.floor(q.stars) : null;
  const canTickets = can(viewer, "tickets.view") || can(viewer, "tickets.manage"), canComplaints = can(viewer, "complaints.manage");
  const mine = sql`(select o.id from offers o where o.driver_id = ${driverId})`;
  const [items, dist, tickets, complaints] = await Promise.all([
    rows<Rec>(sql`select ratings.id, ratings.stars, ratings.comment, ratings.created_at, ratings.offer_id, ru.id as rater_id, coalesce(bp.company_name, ru.name) as rater, ru.role as rater_role, requests.id as request_id, requests.ref
      from ratings join users ru on ru.id = ratings.rater_id join offers on offers.id = ratings.offer_id join requests on requests.id = offers.request_id left join business_profiles bp on bp.user_id = ru.id
      where ratings.ratee_id = ${driverId} ${stars ? sql`and ratings.stars = ${stars}` : sql``} order by ratings.created_at desc, ratings.id desc limit ${pageSize} offset ${offset}`),
    rows<Rec>(sql`select stars, count(*)::int as n, count(*) filter (where comment is not null and comment <> '')::int as with_comment from ratings where ratee_id = ${driverId} group by stars`),
    canTickets ? rows<Rec>(sql`select tickets.id, tickets.ref, tickets.category, tickets.subject, tickets.priority, tickets.status, tickets.created_at, tickets.resolved_at, tickets.first_response_at, requests.ref as order_ref, requests.id as request_id,
        (tickets.opened_by = ${driverId}) as by_driver from tickets left join requests on requests.id = tickets.request_id
        where tickets.opened_by = ${driverId} or tickets.offer_id in ${mine} order by tickets.created_at desc limit 25`) : Promise.resolve(null),
    canComplaints ? rows<Rec>(sql`select complaints.id, complaints.ref, complaints.category, left(complaints.description, 200) as description, complaints.priority, complaints.status, complaints.created_at, complaints.resolved_at, complaints.first_response_at,
        requests.ref as order_ref, requests.id as request_id, (complaints.filed_by = ${driverId}) as by_driver from complaints left join requests on requests.id = complaints.request_id
        where complaints.filed_by = ${driverId} or complaints.offer_id in ${mine} order by complaints.created_at desc limit 25`) : Promise.resolve(null),
  ]);
  const d = [1, 2, 3, 4, 5].map((n) => ({ stars: n, count: num(dist.find((x) => num(x.stars) === n)?.n), withComment: num(dist.find((x) => num(x.stars) === n)?.with_comment) }));
  const count = d.reduce((n, x) => n + x.count, 0);
  const shape = (r: Rec) => ({ id: r.id, ref: r.ref, category: r.category, priority: r.priority, status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at, firstResponseAt: r.first_response_at, orderRef: r.order_ref ?? null, requestId: r.request_id ?? null, byDriver: !!r.by_driver });
  return {
    page, pageSize, total: stars ? d[stars - 1].count : count, count, avg: count ? d.reduce((n, x) => n + x.stars * x.count, 0) / count : null, distribution: d,
    items: items.map((r) => ({ id: r.id, stars: num(r.stars), comment: r.comment ?? null, at: r.created_at, rater: { id: r.rater_id, name: r.rater, role: r.rater_role }, offerId: r.offer_id, requestId: r.request_id, ref: r.ref })),
    tickets: tickets ? tickets.map((r) => ({ ...shape(r), subject: r.subject })) : null, complaints: complaints ? complaints.map((r) => ({ ...shape(r), description: r.description })) : null,
  };
}
