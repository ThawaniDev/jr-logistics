import { sql } from "drizzle-orm";
import { auditLogs, offers, officeInvites } from "@/db/schema";
import { bucketSql } from "./buckets";
import { anyWindow, BILLED, inWindow, NOT_DRAFT, PARCEL_OUTCOME_AT, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, numOrNull, rows } from "./guard";
import { pairOf, seriesOf, twin, type Pair } from "./companies-lib";
import { KEPT } from "./drivers-lib";
import { withDrivers } from "./drivers-sql";
import { withOffices } from "./offices-sql";

type Row = Record<string, unknown>;
const P = (f: ResolvedFilters, r: Row | undefined, name: string): Pair => { const p = pairOf(r, name); return f.prev ? p : { cur: p.cur, prev: null }; };
const SUM_COLS = ["acc", "jobs", "due", "ontime", "deliv", "fail", "ret", "rn", "rsum", "earned", "paid", "links", "unlinks"];
const sums = sql.join(SUM_COLS.map((n) => sql.raw(`coalesce(sum(${n}_c), 0)::float8 as t_${n}_c, sum(${n}_p)::float8 as t_${n}_p`)), sql`, `);
/** Offices with at least this many resolved parcels are ranked by delivery success. */
export const MIN_OFFICE_RESOLVED = 10;

/** Totals over the per-office table for every KPI (one pass). */
export async function officeSummary(f: ResolvedFilters, money: boolean, grace: number) {
  const [r] = await rows<Row>(withOffices(f, money, grace, sql`
    select count(*)::int as offices, count(*) filter (where acc_c > 0)::int as active_c, count(*) filter (where acc_p > 0)::int as active_p,
      coalesce(sum(fleet), 0)::float8 as fleet, coalesce(sum(verified_n), 0)::float8 as fleet_verified, coalesce(sum(avail_n), 0)::float8 as fleet_available,
      coalesce(sum(least(drv_c, fleet)), 0)::float8 as t_utilnum_c, sum(least(drv_p, fleet))::float8 as t_utilnum_p, coalesce(sum(pending), 0)::float8 as pending,
      count(*) filter (where agreement_state = 'accepted')::int as agr_accepted, count(*) filter (where agreement_state = 'pending_acceptance')::int as agr_pending,
      count(*) filter (where agreement_state = 'expired')::int as agr_expired, count(*) filter (where agreement_state = 'none' or agreement_state = 'superseded')::int as agr_none,
      ${sums}
    from od`));
  const t = (n: string) => P(f, r, `t_${n}`);
  return {
    offices: num(r?.offices), active: P(f, r, "active"), fleet: num(r?.fleet), fleetVerified: num(r?.fleet_verified), fleetAvailable: num(r?.fleet_available), pending: money ? num(r?.pending) : null,
    utilNum: t("utilnum"), totals: Object.fromEntries(SUM_COLS.map((n) => [n, t(n)])) as Record<string, Pair>,
    agreements: [{ key: "accepted", value: num(r?.agr_accepted) }, { key: "pending_acceptance", value: num(r?.agr_pending) }, { key: "expired", value: num(r?.agr_expired) }, { key: "none", value: num(r?.agr_none) }],
  };
}

/** Distinct drivers who accepted a job for an office in the period (a driver counts once even when they moved between offices). */
export async function officeDrivers(f: ResolvedFilters): Promise<Pair> {
  const [r] = await rows<Row>(sql`
    select ${twin(f, { n: (w) => sql`count(distinct offers.driver_id) filter (where ${w(offers.acceptedAt)})::int` })}
    from offers join requests on requests.id = offers.request_id where ${scope(f, "offers")} and offers.office_id is not null and ${anyWindow(f, offers.acceptedAt)}`);
  return P(f, r, "n");
}

/** Top offices by parcels delivered and the best / worst by delivery success among offices with enough resolved parcels. */
export async function officeLeaders(f: ResolvedFilters, money: boolean, grace: number) {
  const q = (order: ReturnType<typeof sql>, where: ReturnType<typeof sql>) => rows<Row>(withOffices(f, money, grace, sql`
    select id, name, deliv_c as parcels, succ_c as success, deliv_c + fail_c + ret_c as resolved, rating_c as rating from od where ${where} order by ${order}, id limit 10`));
  const [byParcels, best, worst] = await Promise.all([
    q(sql`deliv_c desc`, sql`deliv_c > 0`), q(sql`succ_c desc, deliv_c + fail_c + ret_c desc`, sql`deliv_c + fail_c + ret_c >= ${sql.raw(String(MIN_OFFICE_RESOLVED))}`),
    q(sql`succ_c asc, deliv_c + fail_c + ret_c desc`, sql`deliv_c + fail_c + ret_c >= ${sql.raw(String(MIN_OFFICE_RESOLVED))}`),
  ]);
  const map = (x: Row) => ({ id: String(x.id), name: String(x.name ?? ""), parcels: num(x.parcels), success: numOrNull(x.success), resolved: num(x.resolved), rating: numOrNull(x.rating) });
  // With few qualifying offices the best and worst lists would show the same offices: the worst list leaves out those already in the best list.
  const inBest = new Set(best.map((x) => String(x.id)));
  return { byParcels: byParcels.map(map), best: best.map(map), worst: worst.filter((x) => !inBest.has(String(x.id))).map(map), minVolume: MIN_OFFICE_RESOLVED };
}

/** When an office filter is on: that office's drivers ranked by parcels delivered, with the numbers of the period. Null without an office filter. */
export async function officeFleet(f: ResolvedFilters, money: boolean, grace: number) {
  if (!f.office.length) return null;
  const r = await rows<Row>(withDrivers(f, money, grace, sql`
    select id, name, deliv_c as parcels, jobs_c as jobs, succ_c as success, ontime_rate_c as on_time, rating_c as rating, earn_c as earn, availability, office_name as office
    from dd where office_id in (${sql.join(f.office.map((o) => sql`${o}`), sql`, `)}) or acc_c > 0 order by deliv_c desc, jobs_c desc, id limit 12`, { officeOnly: true }));
  return r.map((x) => ({ id: String(x.id), name: String(x.name ?? ""), parcels: num(x.parcels), jobs: num(x.jobs), success: numOrNull(x.success), onTime: numOrNull(x.on_time), rating: numOrNull(x.rating), earn: money ? numOrNull(x.earn) : null, availability: String(x.availability ?? ""), office: x.office == null ? null : String(x.office) }));
}

export const OFFICE_FIELDS = ["jobs", "offices", "delivered", "links", "unlinks"] as const;
/** Per bucket: jobs kept by office drivers, offices that worked, parcels delivered, drivers who joined and who left. */
export const officeSeries = (f: ResolvedFilters) => seriesOf(f, [...OFFICE_FIELDS], (w) => sql`
  select t, sum(jobs)::int as jobs, sum(offices)::int as offices, sum(delivered)::int as delivered, sum(links)::int as links, sum(unlinks)::int as unlinks from (
    select ${bucketSql(offers.acceptedAt, f.bucket)} as t, count(*) filter (where ${KEPT}) as jobs, count(distinct offers.office_id) as offices, 0 as delivered, 0 as links, 0 as unlinks
      from offers join requests on requests.id = offers.request_id where ${scope(f, "offers")} and offers.office_id is not null and ${inWindow(offers.acceptedAt, w)} group by 1
    union all select ${bucketSql(PARCEL_OUTCOME_AT, f.bucket)}, 0, 0, count(*), 0, 0
      from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
      where ${scope(f, "shipments")} and offers.office_id is not null and ${NOT_DRAFT} and shipments.status = 'delivered' and ${inWindow(PARCEL_OUTCOME_AT, w)} group by 1
    union all select ${bucketSql(officeInvites.respondedAt, f.bucket)}, 0, 0, 0, count(*), 0 from office_invites
      where office_invites.status = 'accepted' and ${inWindow(officeInvites.respondedAt, w)} ${f.office.length ? sql`and office_invites.office_id in (${sql.join(f.office.map((o) => sql`${o}`), sql`, `)})` : sql``} group by 1
    union all select ${bucketSql(auditLogs.createdAt, f.bucket)}, 0, 0, 0, 0, count(*) from audit_logs
      where audit_logs.action = 'office.unlink_driver' and ${inWindow(auditLogs.createdAt, w)} ${f.office.length ? sql`and audit_logs.actor_id in (${sql.join(f.office.map((o) => sql`${o}`), sql`, `)})` : sql``} group by 1
  ) y group by t`);

/** Earned and paid out per bucket (halalas, money): provider amount settled to offices by creation date, paid out by payment date. */
export const officeMoneySeries = (f: ResolvedFilters) => seriesOf(f, ["earned", "paid"], (w) => sql`
  select t, sum(earned)::float8 as earned, sum(paid)::float8 as paid from (
    select ${bucketSql("settlements.created_at", f.bucket)} as t, coalesce(sum(settlements.provider_cents), 0) as earned, 0 as paid
      from settlements join requests on requests.id = settlements.request_id where ${scope(f, "settlements")} and ${BILLED} and settlements.office_id is not null and ${inWindow("settlements.created_at", w)} group by 1
    union all select ${bucketSql("settlements.paid_at", f.bucket)}, 0, coalesce(sum(settlements.provider_cents), 0)
      from settlements join requests on requests.id = settlements.request_id where ${scope(f, "settlements")} and settlements.status = 'paid' and settlements.office_id is not null and ${inWindow("settlements.paid_at", w)} group by 1
  ) y group by t`);
