import { sql, type SQL } from "drizzle-orm";
import { driverAvailabilityLog, offers, ratings, requests, settlements, withdrawals } from "@/db/schema";
import { riyadhDow, riyadhHour } from "./buckets";
import { anyWindow, BILLED, inWindow, scope, twinSelect } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { pair, z, type Row } from "./portal-facts";
import { grid } from "./portal-series";
import { histogramFromRow, histogramSelect } from "./stats";

/**
 * Facts of ONE courier office. Ownership is `scope()` with the office filter forced by `portalCtx()`: offers of the office, parcels carried on those offers, settlements payable to
 * the office. Money is what the office EARNS (`provider_cents`): the customer price and the platform margin are never selected, and no company name or id leaves the server.
 */
/** An offer that really put a driver to work (not an offer that was rejected, expired, replaced …): those offers carry no punctuality. */
const COUNTED = sql`offers.accepted_at is not null and offers.status not in ('rejected','expired','cancelled','replaced')`;
/** Cancelled by the driver (the system's own cancellations — the company cancelled, the request was not fully staffed — are not the driver's doing). */
export const DRIVER_CANCELLED = sql`(offers.status = 'cancelled' and coalesce(offers.cancel_reason, '') not in ('request_cancelled', 'not_fully_staffed'))`;
/** `C-3F9A`: a stable label per (company, office) pair that lets an office tell its customers apart without ever learning who they are. */
export const anonCompany = (me: string) => sql`('C-' || upper(substr(md5(requests.business_id::text || ${me}::text), 1, 5)))`;

/** Jobs (offers accepted in the period) and what became of them, offers made and accepted, active drivers, and start punctuality — both periods in one pass. */
export async function jobFacts(f: ResolvedFilters, me: string, grace: number) {
  const limit = sql`requests.starts_at + make_interval(mins => ${grace}::int)`;
  const jobsAt = (w: (c: SQL) => SQL) => sql`offers.accepted_at is not null and ${w(sql`offers.accepted_at`)}`;
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      jobs: (w) => sql`count(*) filter (where ${jobsAt(w)})::int`,
      completed: (w) => sql`count(*) filter (where offers.status = 'completed' and ${jobsAt(w)})::int`,
      no_show: (w) => sql`count(*) filter (where offers.status = 'no_show' and ${jobsAt(w)})::int`,
      cancelled: (w) => sql`count(*) filter (where ${DRIVER_CANCELLED} and ${jobsAt(w)})::int`,
      replaced: (w) => sql`count(*) filter (where offers.status = 'replaced' and ${jobsAt(w)})::int`,
      drivers: (w) => sql`count(distinct offers.driver_id) filter (where ${jobsAt(w)})::int`,
      fleet_active: (w) => sql`count(distinct offers.driver_id) filter (where ${jobsAt(w)} and fp.user_id is not null)::int`,
      made: (w) => sql`count(*) filter (where offers.source = 'system' and ${w(sql`offers.created_at`)} and (offers.accepted_at is not null or offers.status in ('rejected','expired')))::int`,
      taken: (w) => sql`count(*) filter (where offers.source = 'system' and offers.accepted_at is not null and ${w(sql`offers.created_at`)})::int`,
      on_time: (w) => sql`count(*) filter (where ${w(sql`requests.starts_at`)} and ${COUNTED} and offers.arrived_at is not null and offers.arrived_at <= ${limit})::int`,
      due: (w) => sql`count(*) filter (where ${w(sql`requests.starts_at`)} and ${COUNTED} and (offers.arrived_at is not null or offers.status = 'no_show' or now() > ${limit}))::int`,
    })}
    from offers join requests on requests.id = offers.request_id left join driver_profiles fp on fp.user_id = offers.driver_id and fp.office_id = ${me}
    where ${scope(f, "offers")} and ${anyWindow(f, offers.acceptedAt, offers.createdAt, requests.startsAt)}`);
  const P = (k: string) => pair(r, k);
  return { jobs: z(P("jobs")), completed: z(P("completed")), no_show: z(P("no_show")), cancelled: z(P("cancelled")), replaced: z(P("replaced")), drivers: z(P("drivers")), fleet_active: z(P("fleet_active")), made: z(P("made")), taken: z(P("taken")), on_time: P("on_time"), due: P("due") };
}

/** The fleet as of now: drivers linked to the office, and those available. */
export async function fleetNow(me: string) {
  const [r] = await rows<Row>(sql`
    select count(*)::int as total, count(*) filter (where availability = 'available' and verification_status = 'verified')::int as available from driver_profiles where office_id = ${me}`);
  return { total: num(r?.total), available: num(r?.available) };
}

/** Stars the office's drivers received for their jobs (rated by the company), by rating time. */
export async function ratingFacts(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      sum: (w) => sql`coalesce(sum(ratings.stars) filter (where ${w(ratings.createdAt)}), 0)::float8`,
      n: (w) => sql`count(*) filter (where ${w(ratings.createdAt)})::int`,
    })}
    from ratings join offers on offers.id = ratings.offer_id join requests on requests.id = offers.request_id
    where ${scope(f, "offers")} and ratings.ratee_id = offers.driver_id and ${anyWindow(f, ratings.createdAt)}`);
  return { sum: z(pair(r, "sum")), n: z(pair(r, "n")) };
}

/** What the office earned (settlements created, not rejected), what was paid (by payment time), jobs behind it, parcel work, and the time from creation to payment. */
export async function earningFacts(f: ResolvedFilters) {
  const parcelWork = sql`requests.service = 'delivery_driver'`;
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      earned: (w) => sql`coalesce(sum(settlements.provider_cents) filter (where ${BILLED} and ${w(settlements.createdAt)}), 0)::float8`,
      settled: (w) => sql`count(*) filter (where ${BILLED} and ${w(settlements.createdAt)})::int`,
      parcel_cents: (w) => sql`coalesce(sum(settlements.provider_cents) filter (where ${BILLED} and ${parcelWork} and ${w(settlements.createdAt)}), 0)::float8`,
      parcel_units: (w) => sql`coalesce(sum(settlements.final_units) filter (where ${BILLED} and ${parcelWork} and ${w(settlements.createdAt)}), 0)::float8`,
      paid: (w) => sql`coalesce(sum(settlements.provider_cents) filter (where settlements.status = 'paid' and ${w(settlements.paidAt)}), 0)::float8`,
      pay_secs: (w) => sql`coalesce(sum(extract(epoch from (settlements.paid_at - settlements.created_at))) filter (where settlements.status = 'paid' and ${w(settlements.paidAt)}), 0)::float8`,
      pay_n: (w) => sql`count(*) filter (where settlements.status = 'paid' and ${w(settlements.paidAt)})::int`,
    })}
    from settlements join requests on requests.id = settlements.request_id
    where ${scope(f, "settlements")} and ${anyWindow(f, settlements.createdAt, settlements.paidAt)}`);
  const P = (k: string) => z(pair(r, k));
  return { earned: P("earned"), settled: P("settled"), parcel_cents: P("parcel_cents"), parcel_units: P("parcel_units"), paid: P("paid"), pay_secs: P("pay_secs"), pay_n: P("pay_n") };
}

/** Settlements not yet paid and not rejected (as of now, any date), honouring the request-level filters. */
export async function pendingPay(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    select coalesce(sum(settlements.provider_cents), 0)::float8 as cents, count(*)::int as n from settlements join requests on requests.id = settlements.request_id
    where ${scope(f, "settlements")} and settlements.status not in ('paid', 'rejected')`);
  return { cents: num(r?.cents), n: num(r?.n) };
}

/** Withdrawals (bank payouts) of the office: paid out in the period (twin), waiting now, and the wallet balance. */
export async function withdrawalFacts(f: ResolvedFilters, me: string) {
  const [[w], [s], [b]] = await Promise.all([
    rows<Row>(sql`
      select ${twinSelect(f, {
        paid: (x) => sql`coalesce(sum(withdrawals.amount_cents) filter (where withdrawals.status = 'paid' and ${x(withdrawals.decidedAt)}), 0)::float8`,
        asked: (x) => sql`coalesce(sum(withdrawals.amount_cents) filter (where ${x(withdrawals.createdAt)}), 0)::float8`,
      })}
      from withdrawals where withdrawals.user_id = ${me} and ${anyWindow(f, withdrawals.decidedAt, withdrawals.createdAt)}`),
    rows<Row>(sql`select coalesce(sum(amount_cents) filter (where status in ('pending','approved')), 0)::float8 as cents, count(*) filter (where status in ('pending','approved'))::int as n from withdrawals where user_id = ${me}`),
    rows<Row>(sql`select available_cents::float8 as available, held_cents::float8 as held from wallet_accounts where owner_id = ${me}`),
  ]);
  return { paid: z(pair(w, "paid")), asked: z(pair(w, "asked")), pendingCents: num(s?.cents), pendingN: num(s?.n), available: num(b?.available), held: num(b?.held) };
}

/** Settlements created in the period by status (count and amount): the pipeline from created to paid, plus the approval and payment funnel and the time-to-pay histogram. */
export const PAY_EDGES = [3600, 21_600, 86_400, 259_200, 604_800];
export async function pipeline(f: ResolvedFilters) {
  const [[tot], by, [t]] = await Promise.all([
    rows<Row>(sql`
      select count(*)::int as created, count(*) filter (where settlements.status in ('approved','batch_ready','paid'))::int as approved, count(*) filter (where settlements.status = 'paid')::int as paid
      from settlements join requests on requests.id = settlements.request_id where ${scope(f, "settlements")} and ${inWindow(settlements.createdAt, f.cur)}`),
    rows<Row>(sql`
      select settlements.status as k, count(*)::int as n, coalesce(sum(settlements.provider_cents), 0)::float8 as cents from settlements join requests on requests.id = settlements.request_id
      where ${scope(f, "settlements")} and ${inWindow(settlements.createdAt, f.cur)} group by 1 order by 2 desc, 1`),
    rows<Row>(sql`
      select count(*)::int as n, ${histogramSelect(sql`x.secs`, PAY_EDGES, "h")} from (select extract(epoch from (settlements.paid_at - settlements.created_at))::float8 as secs
        from settlements join requests on requests.id = settlements.request_id where ${scope(f, "settlements")} and settlements.status = 'paid' and ${inWindow(settlements.paidAt, f.cur)}) x`),
  ]);
  const raw = [num(tot?.created), num(tot?.approved), num(tot?.paid)];
  const funnel = (["created", "approved", "paid"] as const).map((key, i) => ({ key, count: Math.min(raw[i], ...raw.slice(0, i)) }));
  return { funnel, byStatus: by.map((x) => ({ key: String(x.k), n: num(x.n), cents: num(x.cents) })), payTime: { n: num(t?.n), histogram: histogramFromRow(t ?? {}, PAY_EDGES) } };
}

/** Withdrawals requested in the period by status. */
export async function withdrawalsByStatus(f: ResolvedFilters, me: string) {
  const r = await rows<Row>(sql`
    select status as k, count(*)::int as n, coalesce(sum(amount_cents), 0)::float8 as cents from withdrawals where user_id = ${me} and ${inWindow(withdrawals.createdAt, f.cur)} group by 1 order by 2 desc, 1`);
  return r.map((x) => ({ key: String(x.k), n: num(x.n), cents: num(x.cents) }));
}

/** Offers made to the office's drivers in the period and how far they got (clamped so each step is at most the one before). */
export async function offerFunnel(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    select count(*)::int as offered, count(*) filter (where offers.accepted_at is not null)::int as accepted, count(*) filter (where offers.arrived_at is not null)::int as arrived,
      count(*) filter (where offers.delivered_at is not null or offers.status in ('delivered_reported','pending_settlement','completed'))::int as delivered, count(*) filter (where offers.status = 'completed')::int as completed
    from offers join requests on requests.id = offers.request_id where ${scope(f, "offers")} and ${inWindow(offers.createdAt, f.cur)}`);
  const keys = ["offered", "accepted", "arrived", "delivered", "completed"] as const, raw = keys.map((k) => num(r?.[k]));
  return keys.map((key, i) => ({ key, count: Math.min(raw[i], ...raw.slice(0, i)) }));
}

/** Offers created in the period by status (the table the old report showed): how many and the units they carried. */
export async function jobsByStatus(f: ResolvedFilters) {
  const r = await rows<Row>(sql`
    select offers.status as k, count(*)::int as n, coalesce(sum(offers.final_units), 0)::int as units from offers join requests on requests.id = offers.request_id
    where ${scope(f, "offers")} and ${inWindow(offers.createdAt, f.cur)} group by 1 order by 2 desc, 1`);
  return r.map((x) => ({ key: String(x.k), n: num(x.n), units: num(x.units) }));
}

export type OfficeDim = "city" | "service" | "vehicle" | "company";
export interface OfficeGroupRow { key: string; jobs: number; prevJobs: number | null; earned: number; prevEarned: number | null; share: number | null }
/** Jobs and earnings by delivery city, service, vehicle type and (anonymised) company; current vs comparison period. */
export async function officeBreakdowns(f: ResolvedFilters, me: string): Promise<Record<OfficeDim, OfficeGroupRow[]>> {
  const expr: Record<OfficeDim, SQL> = { city: sql`requests.delivery_city`, service: sql`requests.service`, vehicle: sql`coalesce(requests.vehicle_type, '')`, company: anonCompany(me) };
  const one = async (dim: OfficeDim): Promise<OfficeGroupRow[]> => {
    const r = await rows<Row>(sql`
      select ${expr[dim]} as k, ${twinSelect(f, {
        jobs: (w) => sql`count(*) filter (where offers.accepted_at is not null and ${w(sql`offers.accepted_at`)})::int`,
        earned: (w) => sql`coalesce(sum(settlements.provider_cents) filter (where ${BILLED} and ${w(settlements.createdAt)}), 0)::float8`,
      })}
      from offers join requests on requests.id = offers.request_id left join settlements on settlements.offer_id = offers.id
      where ${scope(f, "offers")} and ${anyWindow(f, offers.acceptedAt, settlements.createdAt)} group by 1 order by jobs_c desc, earned_c desc, 1 limit 30`);
    const total = r.reduce((s, x) => s + num(x.jobs_c), 0);
    return r.map((x) => ({ key: String(x.k ?? ""), jobs: num(x.jobs_c), prevJobs: f.prev ? num(x.jobs_p) : null, earned: num(x.earned_c), prevEarned: f.prev ? num(x.earned_p) : null, share: total > 0 ? num(x.jobs_c) / total : null }))
      .filter((x) => x.jobs > 0 || x.earned > 0 || (x.prevJobs ?? 0) > 0 || (x.prevEarned ?? 0) > 0);
  };
  const [city, service, vehicle, company] = await Promise.all((["city", "service", "vehicle", "company"] as const).map(one));
  return { city, service, vehicle, company };
}

/** Weekday × hour grids (Riyadh time): when the office's drivers go online, and when they arrive at jobs. */
export async function activityGrids(f: ResolvedFilters, me: string) {
  const drv = f.driver.length ? sql`and driver_availability_log.driver_id in (${sql.join(f.driver.map((d) => sql`${d}::uuid`), sql`, `)})` : sql``;
  const [online, arrivals] = await Promise.all([
    rows<Row>(sql`
      select ${riyadhDow(driverAvailabilityLog.at)} as dow, ${riyadhHour(driverAvailabilityLog.at)} as hr, count(*)::int as n
      from driver_availability_log join driver_profiles on driver_profiles.user_id = driver_availability_log.driver_id and driver_profiles.office_id = ${me}
      where driver_availability_log.to_status = 'available' and ${inWindow(driverAvailabilityLog.at, f.cur)} ${drv} group by 1, 2`),
    rows<Row>(sql`
      select ${riyadhDow(offers.arrivedAt)} as dow, ${riyadhHour(offers.arrivedAt)} as hr, count(*)::int as n
      from offers join requests on requests.id = offers.request_id where ${scope(f, "offers")} and ${inWindow(offers.arrivedAt, f.cur)} group by 1, 2`),
  ]);
  return { online: grid(online), arrivals: grid(arrivals) };
}
