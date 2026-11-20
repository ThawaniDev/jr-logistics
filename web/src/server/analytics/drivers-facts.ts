import { sql, type SQL } from "drizzle-orm";
import { offers, users } from "@/db/schema";
import { DRIVER_DOC_TYPES } from "../catalog";
import { bucketSql, riyadhDow, riyadhHour } from "./buckets";
import { anyWindow, inWindow, NOT_DRAFT, PARCEL_OUTCOME_AT, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, numOrNull, rows } from "./guard";
import { asOfWindow, pairOf, priorWindow, seriesOf, tsz, twin, type Pair } from "./companies-lib";
import { ACCEPT_EDGES, averageAvailable, bandMatrix, COMPLETE_EDGES, DRIVER_CANCELLED, emptyHeat, HEAT_DAYS, JOB_EDGES, KEPT, MIN_RESOLVED, PUSHED, slotCounts, SUCCESS_EDGES } from "./drivers-lib";
import { withDrivers } from "./drivers-sql";
import { histogramFromRow, histogramSelect } from "./stats";

type Row = Record<string, unknown>;
const P = (f: ResolvedFilters, r: Row | undefined, name: string): Pair => { const p = pairOf(r, name); return f.prev ? p : { cur: p.cur, prev: null }; };
const ids = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
const sums = (names: string[]) => sql.join(names.map((n) => sql.raw(`coalesce(sum(${n}_c), 0)::float8 as t_${n}_c, sum(${n}_p)::float8 as t_${n}_p`)), sql`, `);
const SUM_COLS = ["online", "jobs", "acc", "deliv", "fail", "ret", "ontime", "due", "accepted", "answered", "cancelled", "noshow", "replaced", "rn", "rsum", "earn", "busy"];
const raw = (n: number) => sql.raw(String(n));
/** Filters on driver accounts for queries that read a driver column directly (availability log, registrations). */
const driverCond = (f: ResolvedFilters, col: string): SQL => sql`${f.driver.length ? sql`and ${sql.raw(col)} in (${ids(f.driver)})` : sql``} ${f.office.length ? sql`and ${sql.raw(col)} in (select user_id from driver_profiles where office_id in (${ids(f.office)}))` : sql``}`;

/** Totals over the per-driver table for every KPI (one pass): active, available now, online time, jobs, parcels, quality counts, earnings, flagged. */
export async function driverSummary(f: ResolvedFilters, money: boolean, grace: number) {
  const [r] = await rows<Row>(withDrivers(f, money, grace, sql`
    select count(*) filter (where acc_c > 0)::int as active_c, count(*) filter (where acc_p > 0)::int as active_p,
      count(*) filter (where availability = 'available' and verification = 'verified' and user_status = 'active' and not suspended_now)::int as avail_now,
      count(*)::int as fleet, count(*) filter (where verification = 'verified')::int as fleet_verified, count(*) filter (where suspended_now)::int as suspended_now,
      count(*) filter (where earn_c > 0)::int as earners_c, count(*) filter (where earn_p > 0)::int as earners_p,
      coalesce(sum(least(busy_c, online_c)), 0)::float8 as t_utilnum_c, sum(least(busy_p, online_p))::float8 as t_utilnum_p,
      count(*) filter (where flags > 0 and offered_c + acc_c + rn_c + deliv_c + fail_c + ret_c > 0)::int as flagged,
      ${sums(SUM_COLS)},
      ${histogramSelect(sql`jobs_c`, JOB_EDGES, "j", sql`acc_c > 0`)}, ${histogramSelect(sql`succ_c`, SUCCESS_EDGES, "s", sql`deliv_c + fail_c + ret_c >= 5`)}
    from dd`));
  const t = (n: string) => P(f, r, `t_${n}`);
  return {
    active: P(f, r, "active"), availableNow: num(r?.avail_now), fleet: num(r?.fleet), fleetVerified: num(r?.fleet_verified), suspendedNow: num(r?.suspended_now), flagged: num(r?.flagged),
    earners: P(f, r, "earners"), utilNum: t("utilnum"), totals: Object.fromEntries(SUM_COLS.map((n) => [n, t(n)])) as Record<string, Pair>,
    jobsHist: histogramFromRow(r ?? {}, JOB_EDGES, "j"), successHist: histogramFromRow(r ?? {}, SUCCESS_EDGES, "s"),
  };
}

/** Median and 90th percentile of the time drivers take to accept an offer the platform pushed (seconds), this period and the comparison period. */
export async function responseTimes(f: ResolvedFilters) {
  const pc = (p: number, w: "cur" | "prev") => sql`percentile_cont(${raw(p)}) within group (order by x.secs) filter (where ${inWindow("x.at", w === "cur" ? f.cur : f.prev!)})`;
  const [r] = await rows<Row>(sql`
    select ${pc(0.5, "cur")} as p50_c, ${f.prev ? pc(0.5, "prev") : sql`null`} as p50_p, ${pc(0.9, "cur")} as p90_c, ${f.prev ? pc(0.9, "prev") : sql`null`} as p90_p
    from (select offers.created_at as at, extract(epoch from (offers.accepted_at - offers.created_at))::float8 as secs from offers join requests on requests.id = offers.request_id
      where ${scope(f, "offers")} and ${PUSHED} and offers.accepted_at is not null and ${anyWindow(f, offers.createdAt)}) x`);
  return { p50: P(f, r, "p50"), p90: P(f, r, "p90") };
}

/** Ratings received by drivers in the period: average, count and the 1–5 star distribution. */
export async function ratingFacts(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    select ${twin(f, { n: (w) => sql`count(*) filter (where ${w("ratings.created_at")})::int`, sum: (w) => sql`coalesce(sum(ratings.stars) filter (where ${w("ratings.created_at")}), 0)::float8`,
      ...Object.fromEntries([1, 2, 3, 4, 5].map((k) => [`star${k}`, (w: (c: string) => SQL) => sql`count(*) filter (where ${w("ratings.created_at")} and ratings.stars = ${raw(k)})::int`])) })}
    from ratings join offers on offers.id = ratings.offer_id join requests on requests.id = offers.request_id
    where ratings.ratee_id = offers.driver_id and ${scope(f, "offers")} and ${anyWindow(f, "ratings.created_at")}`);
  return { n: P(f, r, "n"), sum: P(f, r, "sum"), stars: [1, 2, 3, 4, 5].map((k) => num(r?.[`star${k}_c`])) };
}

/** Active drivers by vehicle type and by home city. */
export async function fleetMix(f: ResolvedFilters, money: boolean, grace: number) {
  const r = await rows<Row>(withDrivers(f, money, grace, sql`
    select 'vehicle' as dim, coalesce(vehicle, '') as k, count(*)::int as n from dd where acc_c > 0 group by 2
    union all select 'city', coalesce(city, ''), count(*)::int from dd where acc_c > 0 group by 2`));
  const by = (dim: string) => r.filter((x) => x.dim === dim).map((x) => ({ key: String(x.k), value: num(x.n) })).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  return { vehicle: by("vehicle"), city: by("city") };
}

/** The best and the worst drivers by delivery success among those with at least `MIN_RESOLVED` resolved parcels (the minimum-volume guard). */
export async function leaders(f: ResolvedFilters, money: boolean, grace: number) {
  const q = (dir: "desc" | "asc") => rows<Row>(withDrivers(f, money, grace, sql`
    select id, name, succ_c as value, deliv_c + fail_c + ret_c as resolved, rating_c as rating from dd where deliv_c + fail_c + ret_c >= ${raw(MIN_RESOLVED)}
    order by succ_c ${sql.raw(dir)}, deliv_c + fail_c + ret_c desc, id limit 10`));
  const [top, bottom] = await Promise.all([q("desc"), q("asc")]);
  const map = (x: Row) => ({ id: String(x.id), name: String(x.name ?? ""), value: num(x.value), resolved: num(x.resolved), rating: numOrNull(x.rating) });
  // With few qualifying drivers the two lists would show the same people: the bottom list leaves out everybody already in the top list.
  const inTop = new Set(top.map((x) => String(x.id)));
  return { top: top.map(map), bottom: bottom.filter((x) => !inTop.has(String(x.id))).map(map), minVolume: MIN_RESOLVED };
}

/** Drivers with enough offers and jobs, by acceptance band (rows) × completion band (columns); completion = jobs not cancelled, not no-show and not replaced. */
export async function reliabilityMatrix(f: ResolvedFilters, money: boolean, grace: number) {
  const r = await rows<Row>(withDrivers(f, money, grace, sql`
    select width_bucket(accept_c, array[${sql.join(ACCEPT_EDGES.map(raw), sql`, `)}]::float8[]) as a,
      width_bucket(1 - (cancelled_c + noshow_c + replaced_c)::float8 / acc_c, array[${sql.join(COMPLETE_EDGES.map(raw), sql`, `)}]::float8[]) as c, count(*)::int as n
    from dd where answered_c >= 3 and acc_c >= 3 group by 1, 2`));
  return { cells: bandMatrix(r.map((x) => ({ a: num(x.a), c: num(x.c), n: num(x.n) })), ACCEPT_EDGES.length + 1, COMPLETE_EDGES.length + 1), acceptEdges: ACCEPT_EDGES, completeEdges: COMPLETE_EDGES };
}

/** Auto-suspensions by the cancellation-strike policy in the period. */
export async function suspensionFacts(f: ResolvedFilters): Promise<Pair> {
  const [r] = await rows<Row>(sql`
    select ${twin(f, { n: (w) => sql`count(*) filter (where ${w("l.at")})::int` })} from driver_availability_log l
    where l.reason = 'cancel_strikes' and l.source = 'system' and l.to_status = 'unavailable' and ${anyWindow(f, "l.at")} ${driverCond(f, "l.driver_id")}`);
  return P(f, r, "n");
}

/** Drivers who accepted a job in the comparison period (or the period of the same length before) but none in this one. */
export async function churnFacts(f: ResolvedFilters): Promise<{ churned: number | null; wasActive: number | null }> {
  const before = priorWindow(f);
  const [r] = await rows<Row>(sql`
    select count(*) filter (where p > 0 and c = 0)::int as churned, count(*) filter (where p > 0)::int as was_active from (
      select offers.driver_id, count(*) filter (where ${inWindow(offers.acceptedAt, f.cur)}) as c, count(*) filter (where ${inWindow(offers.acceptedAt, before)}) as p
      from offers join requests on requests.id = offers.request_id
      where ${scope(f, "offers")} and (${inWindow(offers.acceptedAt, f.cur)} or ${inWindow(offers.acceptedAt, before)}) group by offers.driver_id) x`);
  return { churned: num(r?.churned), wasActive: num(r?.was_active) };
}

/** Cash on delivery the drivers collected and have not handed back yet (halalas), for parcels matching the filters. Point in time. */
export async function cashHeld(f: ResolvedFilters): Promise<number> {
  const [r] = await rows<Row>(sql`
    select coalesce((select sum(shipments.cod_collected_cents) from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
      where ${scope(f, "shipments")} and shipments.cod_collected_cents > 0), 0)::float8
    - coalesce((select sum(cod_remittances.amount_cents) from cod_remittances join offers on offers.id = cod_remittances.offer_id join requests on requests.id = offers.request_id where ${scope(f, "offers")}), 0)::float8 as held`);
  return Math.max(0, num(r?.held));
}

/** Average number of drivers available per Riyadh weekday × hour: from the availability log (last 4 weeks of the period), else from the hourly platform snapshots. */
export interface Heat { source: "log" | "snapshots" | "none"; cells: number[][]; days: number }
export async function availabilityHeat(f: ResolvedFilters): Promise<Heat> {
  const end = asOfWindow(f.cur), start = new Date(Math.max(f.cur.start.getTime(), end.getTime() - HEAT_DAYS * 864e5));
  const slots = slotCounts(start.getTime(), end.getTime());
  const [log, snap] = await Promise.all([
    rows<Row>(sql`
      with iv as (select l.driver_id as id, l.at as s, coalesce(lead(l.at) over (partition by l.driver_id order by l.at), now()) as e, l.to_status as st
        from driver_availability_log l where l.at < ${tsz(end)} ${driverCond(f, "l.driver_id")}),
      c as (select id, greatest(s, ${tsz(start)}) as s, least(e, ${tsz(end)}) as e from iv where st = 'available' and e > ${tsz(start)} and s < ${tsz(end)}),
      sl as (select c.s, c.e, h from c, lateral generate_series(date_trunc('hour', c.s), c.e, interval '1 hour') as h)
      select ${riyadhDow(sql`sl.h`)} as dow, ${riyadhHour(sql`sl.h`)} as hr, (sum(greatest(0, extract(epoch from (least(sl.e, sl.h + interval '1 hour') - greatest(sl.s, sl.h))))) / 3600)::float8 as hours from sl group by 1, 2`),
    rows<Row>(sql`
      select ${riyadhDow(sql`at`)} as dow, ${riyadhHour(sql`at`)} as hr, avg((metrics->>'drivers_available')::float8)::float8 as v from metric_snapshots
      where scope = 'hour' and city is null and at >= ${tsz(start)} and at < ${tsz(end)} group by 1, 2`),
  ]);
  const hours = emptyHeat();
  for (const x of log) { const d = num(x.dow), h = num(x.hr); if (d >= 0 && d < 7 && h >= 0 && h < 24) hours[d][h] = num(x.hours); }
  if (hours.flat().some((v) => v > 0)) return { source: "log", cells: averageAvailable(hours, slots), days: Math.min(HEAT_DAYS, f.cur.days) };
  const cells = emptyHeat();
  for (const x of snap) { const d = num(x.dow), h = num(x.hr); if (d >= 0 && d < 7 && h >= 0 && h < 24) cells[d][h] = Math.round(num(x.v) * 10) / 10; }
  return { source: cells.flat().some((v) => v > 0) ? "snapshots" : "none", cells, days: Math.min(HEAT_DAYS, f.cur.days) };
}

const REQUIRED = DRIVER_DOC_TYPES.filter((d) => d.required).map((d) => d.key);
export const FUNNEL = ["registered", "docs", "verified", "first_job", "active"] as const;
/**
 * The supply funnel of the drivers who registered in the period: registered → all required documents submitted → verified → first accepted job → a job in the last 30 days
 * (up to the end of the period). A driver whose profile is verified counts as having submitted documents (accounts created by staff may have none on file). Steps are clamped to the one
 * before; `times` are the median seconds between steps (from the documents on file).
 */
export async function supplyFunnel(f: ResolvedFilters) {
  const asOf = asOfWindow(f.cur);
  const req = sql.join(REQUIRED.map((k) => sql`${k}`), sql`, `), n = raw(REQUIRED.length);
  const [r] = await rows<Row>(sql`
    select count(*)::int as registered, count(*) filter (where docs_at is not null or ver_at is not null or vs = 'verified')::int as docs, count(*) filter (where ver_at is not null or vs = 'verified')::int as verified,
      count(*) filter (where job_at is not null)::int as first_job, count(*) filter (where act30)::int as active,
      percentile_cont(0.5) within group (order by extract(epoch from (docs_at - created_at))) filter (where docs_at is not null) as t_docs,
      percentile_cont(0.5) within group (order by extract(epoch from (ver_at - docs_at))) filter (where ver_at is not null and docs_at is not null and ver_at >= docs_at) as t_verify,
      percentile_cont(0.5) within group (order by extract(epoch from (job_at - ver_at))) filter (where job_at is not null and ver_at is not null and job_at >= ver_at) as t_job
    from (
      select u.id, u.created_at, dp.verification_status as vs,
        (select max(m) from (select min(d.created_at) as m from documents d where d.owner_id = u.id and d.owner_kind = 'driver' and d.type in (${req}) group by d.type) a having count(*) = ${n}) as docs_at,
        (select max(m) from (select min(d.reviewed_at) as m from documents d where d.owner_id = u.id and d.owner_kind = 'driver' and d.status = 'approved' and d.type in (${req}) group by d.type) a having count(*) = ${n}) as ver_at,
        (select min(o.accepted_at) from offers o where o.driver_id = u.id and o.accepted_at is not null) as job_at,
        exists (select 1 from offers o where o.driver_id = u.id and o.accepted_at >= ${tsz(new Date(asOf.getTime() - 30 * 864e5))} and o.accepted_at < ${tsz(asOf)}) as act30
      from users u left join driver_profiles dp on dp.user_id = u.id where u.role = 'driver' and ${inWindow("u.created_at", f.cur)} ${f.city.length ? sql`and u.city in (${ids(f.city)})` : sql``} ${driverCond(f, "u.id")}
    ) x`);
  const raws = FUNNEL.map((k) => num(r?.[k]));
  const steps = raws.map((n, i) => ({ key: FUNNEL[i], count: Math.min(n, ...raws.slice(0, i)) }));
  return { steps, times: { docs: numOrNull(r?.t_docs), verify: numOrNull(r?.t_verify), job: numOrNull(r?.t_job) } };
}

export const VOLUME_FIELDS = ["active", "jobs", "delivered", "signups"] as const;
/** Per bucket: drivers who accepted a job, jobs kept, parcels delivered and driver accounts created. */
export const volumeSeries = (f: ResolvedFilters) => seriesOf(f, [...VOLUME_FIELDS], (w) => sql`
  select t, sum(active)::int as active, sum(jobs)::int as jobs, sum(delivered)::int as delivered, sum(signups)::int as signups from (
    select ${bucketSql(offers.acceptedAt, f.bucket)} as t, count(distinct offers.driver_id) as active, count(*) filter (where ${KEPT}) as jobs, 0 as delivered, 0 as signups
      from offers join requests on requests.id = offers.request_id where ${scope(f, "offers")} and ${inWindow(offers.acceptedAt, w)} group by 1
    union all select ${bucketSql(PARCEL_OUTCOME_AT, f.bucket)}, 0, 0, count(*), 0
      from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
      where ${scope(f, "shipments")} and ${NOT_DRAFT} and shipments.status = 'delivered' and ${inWindow(PARCEL_OUTCOME_AT, w)} group by 1
    union all select ${bucketSql(users.createdAt, f.bucket)}, 0, 0, 0, count(*)
      from users where users.role = 'driver' and ${inWindow(users.createdAt, w)} ${f.city.length ? sql`and users.city in (${ids(f.city)})` : sql``} ${driverCond(f, "users.id")} group by 1
  ) y group by t`);

export const QUALITY_FIELDS = ["answered", "accepted", "acc", "bad", "resolved", "delivered"] as const;
/** Per bucket: the counts behind acceptance, cancellation + no-show and delivery success (ratios are formed from them). */
export const qualitySeries = (f: ResolvedFilters) => seriesOf(f, [...QUALITY_FIELDS], (w) => sql`
  select t, sum(answered)::int as answered, sum(accepted)::int as accepted, sum(acc)::int as acc, sum(bad)::int as bad, sum(resolved)::int as resolved, sum(delivered)::int as delivered from (
    select ${bucketSql(offers.createdAt, f.bucket)} as t, count(*) filter (where offers.accepted_at is not null or offers.status in ('rejected','expired')) as answered, count(*) filter (where offers.accepted_at is not null) as accepted, 0 as acc, 0 as bad, 0 as resolved, 0 as delivered
      from offers join requests on requests.id = offers.request_id where ${scope(f, "offers")} and ${PUSHED} and ${inWindow(offers.createdAt, w)} group by 1
    union all select ${bucketSql(offers.acceptedAt, f.bucket)}, 0, 0, count(*), count(*) filter (where ${DRIVER_CANCELLED} or offers.status = 'no_show'), 0, 0
      from offers join requests on requests.id = offers.request_id where ${scope(f, "offers")} and ${inWindow(offers.acceptedAt, w)} group by 1
    union all select ${bucketSql(PARCEL_OUTCOME_AT, f.bucket)}, 0, 0, 0, 0, count(*), count(*) filter (where shipments.status = 'delivered')
      from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
      where ${scope(f, "shipments")} and ${NOT_DRAFT} and ${inWindow(PARCEL_OUTCOME_AT, w)} group by 1
  ) y group by t`);
