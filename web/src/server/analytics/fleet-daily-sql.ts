import { sql, type SQL } from "drizzle-orm";
import { codRemittances, offers, settlements, shipments, users } from "@/db/schema";
import { bucketSql } from "./buckets";
import { anyWindow, BILLED, NOT_DRAFT, PARCEL_OUTCOME_AT, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { tsz, twin, twinOrZero } from "./companies-lib";
import { DRIVER_CANCELLED, KEPT, PUSHED, STARTS } from "./drivers-lib";
import { dayGrid, driverScope } from "./fleet-lib";
import { onlineDaySecs } from "./fleet-sql";
import { jobFamily, names, NULLABLE_PARCEL, offeredFamily, parcelFamily, startFamily } from "./fleet-sql-parts";

/**
 * The day grid of the daily tables: one row per Riyadh calendar day of the period, zero-filled, joined from one CTE per time anchor (a day is NOT a cohort: offers pushed that day, jobs
 * accepted that day, jobs that STARTED that day, parcels resolved that day … each keeps its own anchor — the Notes say so). The final relation `dday` has the base columns `<name>_c`
 * of the metric registry (`fleet-metrics.ts`), so the same formulas serve a driver, an office and a day. `kind = "offices"` counts only work done through an office.
 */
export type DailyKind = "drivers" | "offices";
const day = (col: SQL | { _: unknown }) => bucketSql(col, "day");

/** `days`, the availability intervals `iv` of the people in scope, their per-day seconds `ivd` and `d_on` (drivers online and online seconds per day; per driver and day with `by = "driver"`). */
function daysAndOnline(f: ResolvedFilters, keys: string[], kind: DailyKind, by: Grain = "day"): SQL {
  const inOffice = kind === "offices" ? sql` and l.driver_id in (select user_id from driver_profiles where office_id is not null)` : sql``;
  const online = by === "driver" ? sql`select ivd.id, ivd.day as t, ivd.secs as online_c from ivd where ivd.secs > 0` : sql`select ivd.day as t, count(*) filter (where ivd.secs > 0)::int as online_drivers_c, coalesce(sum(ivd.secs), 0)::float8 as online_c from ivd group by 1`;
  return sql`
  days as (${dayGrid(keys)}),
  iv as (select l.driver_id as id, l.at as s, coalesce(lead(l.at) over (partition by l.driver_id order by l.at), now()) as e, l.to_status as st
    from driver_availability_log l where l.at < ${tsz(f.cur.end)} ${driverScope(f, "l.driver_id")}${inOffice}),
  ivd as (${onlineDaySecs("iv", f.cur.start, f.cur.end)}),
  d_on as (${online})`;
}

const OFF = ["offered", ...names(offeredFamily())], JOB = ["jobs", "cancelled", "drivers_with_jobs", ...names(jobFamily())], START = names(startFamily(0));
const PAR = ["deliv", "fail", "ret", ...names(parcelFamily()).filter((n) => !(NULLABLE_PARCEL as readonly string[]).includes(n))];
/** The grain of an operations daily chain: one row per day, or one per driver and day (only the driver-days that had something). */
export type Grain = "day" | "driver";

/** CTEs `days … d_reg` and `dday` for the operations daily table (counts, punctuality, warehouse and route times, distance, efficiency). `by = "driver"` groups every CTE by driver and day. */
export function opsDailyChain(f: ResolvedFilters, grace: number, keys: string[], kind: DailyKind, by: Grain = "day"): SQL {
  const oo = kind === "offices" ? sql` and offers.office_id is not null` : sql``;
  const regOffice = kind === "offices" ? sql` and exists (select 1 from driver_profiles where driver_profiles.user_id = users.id and driver_profiles.office_id is not null)` : sql``;
  const g = by === "driver";
  const id = g ? sql`offers.driver_id as id, ` : sql``, grp = g ? sql`1, 2` : sql`1`; // the driver column comes first, so the day is the 2nd grouping column
  const t = (col: SQL | { _: unknown }) => sql`${day(col)} as t`;
  const join = (x: string) => (g ? sql`${sql.raw(x)}.t = k.t and ${sql.raw(x)}.id = k.id` : sql`${sql.raw(x)}.t = days.t`);
  const cols = (from: string, ns: readonly string[]) => twinOrZero(f, from, [...ns]);
  const grid = g
    ? sql`k as (select id, t from d_off union select id, t from d_job union select id, t from d_start union select id, t from d_par union select id, t from d_on where online_c > 0)`
    : sql``;
  const reg = g ? sql`` : sql`,
  d_reg as (select ${day(users.createdAt)} as t, ${twin(f, { registered: (w) => sql`count(*) filter (where ${w(users.createdAt)})::int` })} from users
    where users.role = 'driver' and ${anyWindow(f, users.createdAt)} ${driverScope(f, "users.id")}${regOffice} group by 1)`;
  const head = g ? sql`k.id, k.t` : sql`days.t`;
  const online = g ? sql`coalesce(d_on.online_c, 0) as online_c, null::float8 as online_p` : sql`coalesce(d_on.online_drivers_c, 0) as online_drivers_c, null::float8 as online_drivers_p, coalesce(d_on.online_c, 0) as online_c, null::float8 as online_p`;
  const regCols = g ? sql`` : sql`, ${cols("d_reg", ["registered"])}`;
  const src = g ? sql`k` : sql`days`;
  return sql`${daysAndOnline(f, keys, kind, by)},
  d_off as (
    select ${id}${t(offers.createdAt)}, ${twin(f, { offered: (w) => sql`count(*) filter (where ${w(offers.createdAt)} and ${PUSHED})::int`, ...offeredFamily() })}
    from offers join requests on requests.id = offers.request_id where ${scope(f, "offers")}${oo} and ${anyWindow(f, offers.createdAt)} group by ${grp}
  ),
  d_job as (
    select ${id}${t(offers.acceptedAt)}, ${twin(f, {
      jobs: (w) => sql`count(*) filter (where ${w(offers.acceptedAt)} and ${KEPT})::int`, cancelled: (w) => sql`count(*) filter (where ${w(offers.acceptedAt)} and ${DRIVER_CANCELLED})::int`,
      drivers_with_jobs: (w) => sql`count(distinct offers.driver_id) filter (where ${w(offers.acceptedAt)} and ${KEPT})::int`, ...jobFamily(),
    })}
    from offers join requests on requests.id = offers.request_id where ${scope(f, "offers")}${oo} and ${anyWindow(f, offers.acceptedAt)} group by ${grp}
  ),
  d_start as (
    select ${id}${t(STARTS)}, ${twin(f, startFamily(grace))}
    from offers join requests on requests.id = offers.request_id where ${scope(f, "offers")}${oo} and ${anyWindow(f, STARTS)} group by ${grp}
  ),
  d_par as (
    select ${id}${t(PARCEL_OUTCOME_AT)}, ${twin(f, {
      deliv: (w) => sql`count(*) filter (where shipments.status = 'delivered' and ${w(PARCEL_OUTCOME_AT)})::int`, fail: (w) => sql`count(*) filter (where shipments.status = 'failed' and ${w(PARCEL_OUTCOME_AT)})::int`,
      ret: (w) => sql`count(*) filter (where shipments.status = 'returned' and ${w(PARCEL_OUTCOME_AT)})::int`, ...parcelFamily(),
    })}
    from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
    where ${scope(f, "shipments")}${oo} and ${NOT_DRAFT} and ${anyWindow(f, PARCEL_OUTCOME_AT)} group by ${grp}
  )${reg}${g ? sql`, ${grid}` : sql``},
  dday as (
    select ${head}, ${cols("d_off", OFF)}, ${cols("d_job", JOB)}, ${cols("d_start", START)}, ${cols("d_par", PAR)}, d_par.radius_m_c, d_par.radius_m_p, d_par.route_m_c, d_par.route_m_p${regCols}, ${online}
    from ${src} left join d_off on ${join("d_off")} left join d_job on ${join("d_job")} left join d_start on ${join("d_start")} left join d_par on ${join("d_par")}${g ? sql`` : sql` left join d_reg on d_reg.t = days.t`} left join d_on on ${join("d_on")}
  )`;
}

/** CTEs for the money daily table: settlements by creation (paid by payment), COD collected / remitted, jobs, parcels delivered and online time. */
export function moneyDailyChain(f: ResolvedFilters, keys: string[], kind: DailyKind): SQL {
  const oo = kind === "offices" ? sql` and offers.office_id is not null` : sql``;
  const so = kind === "offices" ? sql` and settlements.office_id is not null` : sql``;
  const money = (col: string, w: (c: SQL | { _: unknown } | string) => SQL) => sql`coalesce(sum(settlements.${sql.raw(col)}) filter (where ${w(settlements.createdAt)}), 0)::float8`;
  return sql`${daysAndOnline(f, keys, kind)},
  d_set as (
    select ${day(settlements.createdAt)} as t, ${twin(f, {
      earn: (w) => money("provider_cents", w), customer: (w) => money("customer_cents", w), margin: (w) => money("margin_cents", w), vat: (w) => money("vat_cents", w),
      refund: (w) => money("refund_cents", w), adjust: (w) => money("adjustment_cents", w),
    })}
    from settlements join requests on requests.id = settlements.request_id where ${scope(f, "settlements")}${so} and ${BILLED} and ${anyWindow(f, settlements.createdAt)} group by 1
  ),
  d_paid as (
    select ${day(settlements.paidAt)} as t, ${twin(f, { paid: (w) => sql`coalesce(sum(settlements.provider_cents) filter (where ${w(settlements.paidAt)}), 0)::float8` })}
    from settlements join requests on requests.id = settlements.request_id where ${scope(f, "settlements")}${so} and settlements.status = 'paid' and ${anyWindow(f, settlements.paidAt)} group by 1
  ),
  d_cod as (
    select ${day(shipments.codCollectedAt)} as t, ${twin(f, { cod_collected: (w) => sql`coalesce(sum(shipments.cod_collected_cents) filter (where ${w(shipments.codCollectedAt)}), 0)::float8` })}
    from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
    where ${scope(f, "shipments")}${oo} and shipments.cod_collected_cents is not null and ${anyWindow(f, shipments.codCollectedAt)} group by 1
  ),
  d_rem as (
    select ${day(codRemittances.createdAt)} as t, ${twin(f, { cod_remitted: (w) => sql`coalesce(sum(cod_remittances.amount_cents) filter (where ${w(codRemittances.createdAt)}), 0)::float8` })}
    from cod_remittances join offers on offers.id = cod_remittances.offer_id join requests on requests.id = offers.request_id where ${scope(f, "offers")}${oo} and ${anyWindow(f, codRemittances.createdAt)} group by 1
  ),
  d_job as (
    select ${day(offers.acceptedAt)} as t, ${twin(f, { jobs: (w) => sql`count(*) filter (where ${w(offers.acceptedAt)} and ${KEPT})::int` })}
    from offers join requests on requests.id = offers.request_id where ${scope(f, "offers")}${oo} and ${anyWindow(f, offers.acceptedAt)} group by 1
  ),
  d_par as (
    select ${day(PARCEL_OUTCOME_AT)} as t, ${twin(f, { deliv: (w) => sql`count(*) filter (where shipments.status = 'delivered' and ${w(PARCEL_OUTCOME_AT)})::int` })}
    from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id where ${scope(f, "shipments")}${oo} and ${NOT_DRAFT} and ${anyWindow(f, PARCEL_OUTCOME_AT)} group by 1
  ),
  dday as (
    select days.t, ${twinOrZero(f, "d_set", ["earn", "customer", "margin", "vat", "refund", "adjust"])}, ${twinOrZero(f, "d_paid", ["paid"])}, ${twinOrZero(f, "d_cod", ["cod_collected"])}, ${twinOrZero(f, "d_rem", ["cod_remitted"])},
      ${twinOrZero(f, "d_job", ["jobs"])}, ${twinOrZero(f, "d_par", ["deliv"])}, coalesce(d_on.online_c, 0) as online_c, null::float8 as online_p
    from days left join d_set on d_set.t = days.t left join d_paid on d_paid.t = days.t left join d_cod on d_cod.t = days.t left join d_rem on d_rem.t = days.t
      left join d_job on d_job.t = days.t left join d_par on d_par.t = days.t left join d_on on d_on.t = days.t
  )`;
}
