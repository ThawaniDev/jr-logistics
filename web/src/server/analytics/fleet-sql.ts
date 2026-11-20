import { sql, type SQL } from "drizzle-orm";
import { complaints, offers, ratings } from "@/db/schema";
import { anyWindow, NOT_DRAFT, PARCEL_OUTCOME_AT, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { tsz, twin, twinOrZero } from "./companies-lib";
import { PUSHED, STARTS } from "./drivers-lib";
import { driverRows } from "./drivers-sql";
import { FLEET, driverScope, haversineSql } from "./fleet-lib";
import { codChain, COD_COLS, MONEY_BASE, SETTLE_COLS, settlementsBy } from "./fleet-sql-money";
import { jobFamily, names, NULLABLE_PARCEL, offeredFamily, parcelFamily, startFamily } from "./fleet-sql-parts";

/**
 * `dx`: the per-driver table of the fleet reports, built on top of `dd` (drivers-sql.ts) without adding a column to it. One row per driver account (the same people as `dd`), every
 * column of `dd` plus the fleet columns below; `_c` = this period, `_p` = the comparison period (NULL without one). Everything is a sum or a count (so an office, a day or the whole fleet
 * is a plain sum) except `resp_p90_c`; ratios and averages are formed from them by `fleet-metrics.ts`. Names come from the metric families of `fleet-sql-parts.ts`.
 * Money columns exist only with `finance.view` (NULL otherwise). `gps_m` is computed only for a selection of at most 200 drivers that an office or driver filter narrowed.
 */
export interface FleetOpts { officeOnly?: boolean }

const OFFER_COLS = [...names(offeredFamily()), ...names(startFamily(0)), ...names(jobFamily())];
const PARCEL_COLS = names(parcelFamily()).filter((n) => !(NULLABLE_PARCEL as readonly string[]).includes(n));
const STAR_COLS = [1, 2, 3, 4, 5].map((k) => `stars${k}`);
/** Every additive base column of `dx` (what an office sums), money ones included. */
export const DX_BASE = [
  "offered", "answered", "accepted", "acc", "jobs", "cancelled", "noshow", "replaced", "due", "ontime", "busy", "deliv", "fail", "ret", "rn", "rsum", "online",
  ...OFFER_COLS, ...PARCEL_COLS, ...NULLABLE_PARCEL, "gps_m", ...STAR_COLS, "complaints", "complaints_open", "suspensions", "active_days", "online_days", "pending_parcels",
];

/** Online days of a driver: the Riyadh days with some available time, from the intervals `iv` (one row per availability interval). */
export function onlineDaySecs(iv: string, lo: Date, hi: Date): SQL {
  const rel = sql.raw(iv), l = tsz(lo), h = tsz(hi);
  return sql`select ${rel}.id, to_char(g.d, 'YYYY-MM-DD') as day,
      sum(extract(epoch from (least(${rel}.e, (g.d + interval '1 day') at time zone 'Asia/Riyadh') - greatest(${rel}.s, g.d at time zone 'Asia/Riyadh'))))::float8 as secs
    from ${rel} cross join lateral generate_series(date_trunc('day', greatest(${rel}.s, ${l}) at time zone 'Asia/Riyadh'), date_trunc('day', (least(${rel}.e, ${h}) - interval '1 millisecond') at time zone 'Asia/Riyadh'), interval '1 day') as g(d)
    where ${rel}.st = 'available' and ${rel}.s < ${h} and ${rel}.e > ${l} group by 1, 2`;
}

/** The CTEs after `driverRows`: `xo xs xr xk xu xa xod xg xp` (+ money) and `dx`. */
export function fleetChain(f: ResolvedFilters, money: boolean, grace: number, opts: FleetOpts = {}): SQL {
  const oo = opts.officeOnly ? sql` and offers.office_id is not null` : sql``;
  const lo = f.prev && f.prev.start < f.cur.start ? f.prev.start : f.cur.start, hi = f.prev && f.prev.end > f.cur.end ? f.prev.end : f.cur.end;
  const gps = f.driver.length > 0 || f.office.length > 0;
  const day = (col: SQL) => sql`(${col} at time zone 'Asia/Riyadh')::date`;
  const noPrev = (n: string) => sql.raw(`null::float8 as ${n}_p`);
  const gap = sql.raw(String(FLEET.gps.gapSec)), jump = sql.raw(String(FLEET.gps.jumpM));
  const nullCols = (xs: readonly string[]) => sql.join(xs.flatMap((n) => [sql.raw(`null::float8 as ${n}_c`), noPrev(n)]), sql`, `);
  const moneyBase = [...SETTLE_COLS, ...COD_COLS];
  return sql`
  xo as (
    select offers.driver_id as id, ${twin(f, { ...offeredFamily(), ...startFamily(grace), ...jobFamily() })},
      percentile_cont(0.9) within group (order by extract(epoch from (offers.accepted_at - offers.created_at))) filter (where offers.accepted_at is not null and ${PUSHED}
        and offers.created_at >= ${tsz(f.cur.start)} and offers.created_at < ${tsz(f.cur.end)}) as resp_p90_c
    from offers join requests on requests.id = offers.request_id
    where ${scope(f, "offers")}${oo} and ${anyWindow(f, offers.createdAt, offers.acceptedAt, STARTS)} group by offers.driver_id
  ),
  xs as (
    select offers.driver_id as id, ${twin(f, parcelFamily())}
    from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
    where ${scope(f, "shipments")}${oo} and ${NOT_DRAFT} and ${anyWindow(f, PARCEL_OUTCOME_AT)} group by offers.driver_id
  ),
  xr as (
    select ratings.ratee_id as id, ${twin(f, Object.fromEntries([1, 2, 3, 4, 5].map((k) => [`stars${k}`, (w: (c: SQL | { _: unknown } | string) => SQL) => sql`count(*) filter (where ${w(ratings.createdAt)} and ratings.stars = ${sql.raw(String(k))})::int`])))}
    from ratings join offers on offers.id = ratings.offer_id join requests on requests.id = offers.request_id
    where ratings.ratee_id = offers.driver_id and ${scope(f, "offers")}${oo} and ${anyWindow(f, ratings.createdAt)} group by ratings.ratee_id
  ),
  xk as (
    select offers.driver_id as id, ${twin(f, {
      complaints: (w) => sql`count(*) filter (where ${w(complaints.createdAt)})::int`,
      complaints_open: (w) => sql`count(*) filter (where ${w(complaints.createdAt)} and complaints.status in ('open','in_progress'))::int`,
    })}
    from complaints join offers on offers.id = complaints.offer_id join requests on requests.id = offers.request_id
    where ${scope(f, "offers")}${oo} and complaints.filed_by <> offers.driver_id and ${anyWindow(f, complaints.createdAt)} group by offers.driver_id
  ),
  xu as (
    select l.driver_id as id, ${twin(f, { suspensions: (w) => sql`count(*) filter (where ${w("l.at")})::int` })}
    from driver_availability_log l where l.reason = 'cancel_strikes' and l.source = 'system' and l.to_status = 'unavailable' and ${anyWindow(f, "l.at")} ${driverScope(f, "l.driver_id")} group by l.driver_id
  ),
  xa as (
    select a.id, ${twin(f, { active_days: (w) => sql`count(distinct a.d) filter (where ${w("a.t")})::int` })} from (
      select offers.driver_id as id, offers.arrived_at as t, ${day(sql`offers.arrived_at`)} as d from offers join requests on requests.id = offers.request_id
        where ${scope(f, "offers")}${oo} and offers.arrived_at is not null and ${anyWindow(f, offers.arrivedAt)}
      union all
      select offers.driver_id, ${PARCEL_OUTCOME_AT}, ${day(PARCEL_OUTCOME_AT)} from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
        where ${scope(f, "shipments")}${oo} and ${NOT_DRAFT} and ${anyWindow(f, PARCEL_OUTCOME_AT)}
    ) a group by a.id
  ),
  xod as (
    select d.id, count(*) filter (where d.day between ${f.cur.from} and ${f.cur.to})::int as online_days_c,
      ${f.prev ? sql`count(*) filter (where d.day between ${f.prev.from} and ${f.prev.to})::int` : sql`null::float8`} as online_days_p
    from (${onlineDaySecs("iv", lo, hi)}) d where d.secs > 0 group by d.id
  ),
  xg as (${gps ? sql`
    select g.id, ${twin(f, { gps_m: (w) => sql`sum(g.step) filter (where ${w("g.at")} and g.gap <= ${gap} and g.step <= ${jump})::float8` })} from (
      select q.id, q.at, extract(epoch from (q.at - q.pat)) as gap, ${haversineSql(sql`q.plat`, sql`q.plng`, sql`q.lat`, sql`q.lng`)} as step from (
        select p.driver_id as id, p.recorded_at as at, p.lat, p.lng, lag(p.recorded_at) over w as pat, lag(p.lat) over w as plat, lag(p.lng) over w as plng
        from driver_location_history p
        where p.driver_id in (select id from dd) and (select count(*) <= ${sql.raw(String(FLEET.gps.maxDrivers))} from dd) and p.recorded_at >= ${tsz(lo)} and p.recorded_at < ${tsz(hi)}
          and (p.accuracy_m is null or p.accuracy_m <= ${sql.raw(String(FLEET.gps.accuracyM))})
        window w as (partition by p.driver_id order by p.recorded_at)
      ) q where q.pat is not null
    ) g group by g.id` : sql`select null::uuid as id, null::float8 as gps_m_c, null::float8 as gps_m_p where false`}
  ),
  xp as (
    select offers.driver_id as id, count(*)::int as pending_parcels_c
    from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
    where ${scope(f, "shipments")}${oo} and ${NOT_DRAFT} and shipments.status in ('pending','loaded') and offers.status not in ('rejected','expired','cancelled','replaced','no_show') group by offers.driver_id
  ),${money ? sql`
  xm as (${settlementsBy(f, sql`settlements.driver_id`, !!opts.officeOnly, false)}),
  ${codChain(f, !!opts.officeOnly)},` : sql``}
  dx as (
    select dd.*,
      ${twinOrZero(f, "xo", OFFER_COLS)}, xo.resp_p90_c,
      ${twinOrZero(f, "xs", PARCEL_COLS)}, xs.radius_m_c, xs.radius_m_p, xs.route_m_c, xs.route_m_p,
      ${twinOrZero(f, "xr", STAR_COLS)}, ${twinOrZero(f, "xk", ["complaints", "complaints_open"])}, ${twinOrZero(f, "xu", ["suspensions"])},
      ${twinOrZero(f, "xa", ["active_days"])}, coalesce(xod.online_days_c, 0) as online_days_c, ${f.prev ? sql`coalesce(xod.online_days_p, 0)` : sql`null::float8`} as online_days_p,
      xg.gps_m_c, xg.gps_m_p, coalesce(xp.pending_parcels_c, 0) as pending_parcels_c, null::float8 as pending_parcels_p,
      ${money ? sql`${twinOrZero(f, "xm", [...SETTLE_COLS])}, coalesce(xm.pending, 0) as pending_c, null::float8 as pending_p, ${twinOrZero(f, "xcod", ["cod_collected"])}, ${twinOrZero(f, "xcr", ["cod_remitted"])},
        coalesce(xh.cod_held_c, 0) as cod_held_c, null::float8 as cod_held_p`
        : sql`${nullCols([...moneyBase, "pending", "cod_held"])}`}
    from dd left join xo on xo.id = dd.id left join xs on xs.id = dd.id left join xr on xr.id = dd.id left join xk on xk.id = dd.id left join xu on xu.id = dd.id left join xa on xa.id = dd.id
      left join xod on xod.id = dd.id left join xg on xg.id = dd.id left join xp on xp.id = dd.id${money ? sql` left join xm on xm.id = dd.id left join xcod on xcod.id = dd.id left join xcr on xcr.id = dd.id left join xh on xh.id = dd.id` : sql``}
  )`;
}

/** `with <driverRows>, <fleetChain> select …`: the select reads `dx` (and, for the people it lists, nothing else). `grace` = Settings › late grace minutes. */
export const withFleet = (f: ResolvedFilters, money: boolean, grace: number, select: SQL, opts: FleetOpts = {}): SQL =>
  sql`with ${driverRows(f, money, grace, opts)}, ${fleetChain(f, money, grace, opts)} ${select}`;
/** The base columns an aggregate sums: without finance access the money ones do not exist. */
export const dxBase = (money: boolean): string[] => [...DX_BASE, ...(money ? MONEY_BASE : [])];
