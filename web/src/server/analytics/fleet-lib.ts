import { sql, type SQL } from "drizzle-orm";
import { err } from "@/lib/errors";
import { bucketKeys } from "./buckets";
import type { ResolvedFilters } from "./filters";

/**
 * Pure pieces of the fleet reports (drivers + courier offices, decisions I1–I12 in memory/FLEET_REPORTS.md): constants, the haversine distance (in TypeScript for tests and as a SQL
 * fragment for the queries), naming rules and the Riyadh-day grid of the daily tables. Nothing here touches the database.
 */
export const FLEET = {
  /** A step (arrival → loaded, delivered − arrived …) shorter than 0 or longer than this is not a measurement: it is left out of the averages. */
  maxStepSec: 16 * 3600,
  /** Time at a customer's door: longer than this is a forgotten "arrived" tap, not a stop. */
  maxStopSec: 4 * 3600,
  /** GPS distance: points further apart in time than `gapSec`, jumps above `jumpM` and fixes less accurate than `accuracyM` are dropped; computed for at most `maxDrivers` drivers. */
  gps: { gapSec: 600, jumpM: 3000, accuracyM: 100, maxDrivers: 200 },
  /** The daily tables refuse a longer period. */
  maxDailyDays: 366,
  earthM: 6_371_000,
} as const;

/** An offer that counts as a job for punctuality: accepted and not dropped (the same rule as `punctuality()` in drivers-lib). */
export const COUNTED = sql`(offers.accepted_at is not null and offers.status not in ('rejected','expired','cancelled','replaced'))`;
/** True when a timestamp difference `b − a` is a plausible step (0 ≤ x ≤ max); NULL (so false in a filter) when a timestamp is missing. */
export const stepOk = (a: SQL, b: SQL, max: number): SQL => sql`extract(epoch from (${b} - ${a})) between 0 and ${sql.raw(String(max))}`;
export const stepSec = (a: SQL, b: SQL): SQL => sql`extract(epoch from (${b} - ${a}))`;

/** Great-circle distance in metres (haversine, sphere of radius 6 371 km: Thawani's definition). */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * FLEET.earthM * Math.asin(Math.sqrt(Math.min(1, a)));
}
/** The same formula as an SQL fragment over four double-precision expressions (degrees). */
export const haversineSql = (lat1: SQL, lng1: SQL, lat2: SQL, lng2: SQL): SQL =>
  sql`(2 * ${sql.raw(String(FLEET.earthM))} * asin(sqrt(least(1, power(sin(radians((${lat2}) - (${lat1})) / 2), 2) + cos(radians(${lat1})) * cos(radians(${lat2})) * power(sin(radians((${lng2}) - (${lng1})) / 2), 2)))))`;
/** Both pins are real coordinates (a missing pin is NULL, which fails a `between`). */
export const validPin = (lat: SQL, lng: SQL): SQL => sql`(${lat} between -90 and 90 and ${lng} between -180 and 180)`;

/** `late_avg_min` → `lateAvgMin`: the field name of a metric in a table row. */
export const camel = (snake: string): string => snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
/** The row field of a metric: camelCase, money gets the `Cents` suffix (`cod_held` → `codHeldCents`). */
export const rowKey = (key: string, money = false): string => camel(key) + (money ? "Cents" : "");
/** Quotes a camelCase alias (Postgres folds unquoted ones to lower case). */
export const alias = (name: string): SQL => sql.raw(`"${name.replace(/"/g, "")}"`);

/** Every Riyadh day of the period as `YYYY-MM-DD` (the zero-filled grid of a daily table). A period over 366 days is refused with `VALIDATION`. */
export function dailyKeys(f: Pick<ResolvedFilters, "cur">): string[] {
  if (f.cur.days > FLEET.maxDailyDays) throw err("VALIDATION", `A daily table covers at most ${FLEET.maxDailyDays} days: choose a shorter period`, { field: "to" });
  return bucketKeys(f.cur.from, f.cur.to, "day");
}
/** The filters of a table query read ONE period: the comparison window is dropped so the `_p` columns are not computed at all. */
export const currentOnly = (f: ResolvedFilters): ResolvedFilters => ({ ...f, prev: null, prevKeys: null, compare: "none" });
/** The text array of the day grid as an SQL fragment (`unnest(...)` source). */
export const dayGrid = (keys: string[]): SQL => sql`select unnest(array[${sql.join(keys.map((k) => sql`${k}`), sql`, `)}]::text[]) as t`;

/** The driver / office filters narrow the people in a query that reads a driver column directly (availability log, registrations). */
const ids = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
export const driverScope = (f: ResolvedFilters, col: string): SQL => {
  const c = sql.raw(col);
  return sql`${f.driver.length ? sql`and ${c} in (${ids(f.driver)})` : sql``} ${f.office.length ? sql`and ${c} in (select user_id from driver_profiles where office_id in (${ids(f.office)}))` : sql``}`;
};
export const idList = ids;

const tsz = (d: Date) => sql`${d.toISOString()}::timestamptz`;
/**
 * The availability intervals `(id, s, e, st)` of the drivers in scope that can overlap `[from, to)`: every log row inside the window plus, per driver, the LAST row before it (the status
 * the driver was in when the window began; its `s` lies before `from`, callers clamp with `greatest(s, from)`). An interval ends at the driver's next row, or at `now()` for the latest one.
 * Same intervals as reading the whole log up to `to`, but the cost follows the window and the number of drivers (one index probe each), not the age of the platform: on 1.2 million log
 * rows the whole-log read took 2.9 s, this 12 ms, identical output (audit K, A4). `scopeOn(col)` renders the driver / office filters for the column it is given (`l.driver_id` in the
 * window part, `dp.user_id` in the probe part); a driver without a profile row has no log.
 */
export function availabilityIntervals(from: Date, to: Date, scopeOn: (col: string) => SQL): SQL {
  return sql`(select u.id, u.at as s, coalesce(lead(u.at) over (partition by u.id order by u.at), now()) as e, u.st from (
      select l.driver_id as id, l.at, l.to_status as st from driver_availability_log l where l.at >= ${tsz(from)} and l.at < ${tsz(to)} ${scopeOn("l.driver_id")}
      union all
      select b.driver_id, b.at, b.to_status from driver_profiles dp
        join lateral (select l.driver_id, l.at, l.to_status from driver_availability_log l where l.driver_id = dp.user_id and l.at < ${tsz(from)} order by l.at desc limit 1) b on true
        where true ${scopeOn("dp.user_id")}
    ) u)`;
}
