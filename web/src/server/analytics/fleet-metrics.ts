import { sql, type SQL } from "drizzle-orm";
import type { ColType, DrillColumn } from "./registry";
import { alias, rowKey } from "./fleet-lib";

/**
 * The public metrics of the fleet tables: one entry per column. `expr` forms the metric from the additive base columns (`<name>_c` / `<name>_p`) of `dx`, of an office aggregate or of a
 * day, so a driver, an office, a day and the whole fleet all use the same arithmetic. Averages and ratios are NULL (never 0) without a base; counts are 0.
 * Units in the API: durations in seconds (`type: "duration"`), `*_min` metrics in minutes, `*_m` in metres, money in halalas (row field `…Cents`), rates as fractions 0–1.
 * Label key `fr.col_<key>`; the plain-language definition is `fr.help_<key>` (same suffix).
 */
type S = "c" | "p";
export type Group = "offers" | "activity" | "punctuality" | "warehouse" | "route" | "distance" | "parcels" | "quality" | "money";
export interface FleetMetric { key: string; type: ColType; group: Group; expr(s: S): SQL }

const c = (n: string, s: S): SQL => sql.raw(`${n}_${s}`);
const div = (n: SQL, d: SQL): SQL => sql`(${n})::float8 / nullif(${d}, 0)`;
const r2 = (x: SQL): SQL => sql`round((${x})::numeric, 2)::float8`;
const mins = (sec: string, n: (s: S) => SQL, s: S): SQL => r2(sql`${div(c(sec, s), n(s))} / 60.0`);
const col = (name: string) => (s: S) => c(name, s);
const sum = (...xs: string[]) => (s: S) => sql.join(xs.map((x) => c(x, s)), sql` + `);
const m = (key: string, type: ColType, group: Group, expr: (s: S) => SQL): FleetMetric => ({ key, type, group, expr });
const perHour = (n: (s: S) => SQL) => (s: S) => r2(div(sql`(${n(s)}) * 3600.0`, c("online", s)));
const resolved = (s: S) => sql`${c("deliv", s)} + ${c("fail", s)} + ${c("ret", s)}`;
const arrived = (s: S) => sql`${c("punctual", s)} + ${c("late", s)} + ${c("very_late", s)}`;
const latened = (s: S) => sql`${c("late", s)} + ${c("very_late", s)}`;
const perJob = (n: string) => (s: S) => sql`round(${div(c(n, s), c("jobs", s))})::float8`;

export const METRICS: FleetMetric[] = [
  m("registered", "number", "activity", col("registered")), m("online_drivers", "number", "activity", col("online_drivers")), m("drivers_with_jobs", "number", "activity", col("drivers_with_jobs")),
  m("cancelled", "number", "offers", col("cancelled")),
  m("fleet", "number", "activity", () => sql.raw("fleet")), m("drivers_active", "number", "activity", col("drivers_active")), m("links", "number", "activity", col("links")), m("unlinks", "number", "activity", col("unlinks")),
  m("offered", "number", "offers", col("offered")), m("declined", "number", "offers", col("declined")), m("timedout", "number", "offers", col("timedout")),
  m("decline_rate", "percent", "offers", (s) => div(sum("declined", "timedout")(s), c("offered", s))), m("acceptance", "percent", "offers", (s) => div(c("accepted", s), c("answered", s))),
  m("resp_avg", "duration", "offers", (s) => div(c("resp_sec", s), c("resp_n", s))), m("resp_p90", "duration", "offers", col("resp_p90")),
  m("jobs", "number", "activity", col("jobs")), m("active_days", "number", "activity", col("active_days")), m("online_days", "number", "activity", col("online_days")),
  m("jobs_per_active_day", "number", "activity", (s) => r2(div(c("jobs", s), c("active_days", s)))), m("parcels_per_active_day", "number", "activity", (s) => r2(div(c("deliv", s), c("active_days", s)))),
  m("online", "duration", "activity", col("online")), m("deliv_per_online_hour", "number", "activity", perHour(col("deliv"))), m("parcels_per_job", "number", "activity", (s) => r2(div(c("deliv", s), c("jobs", s)))),
  m("punctual", "number", "punctuality", col("punctual")), m("late", "number", "punctuality", col("late")), m("very_late", "number", "punctuality", col("very_late")),
  m("on_time", "percent", "punctuality", (s) => div(c("ontime", s), c("due", s))),
  m("late_avg_min", "number", "punctuality", (s) => mins("late_sec", latened, s)), m("arrival_delta_avg_min", "number", "punctuality", (s) => mins("delta_sec", arrived, s)),
  m("attend_avg_min", "number", "warehouse", (s) => mins("attend_sec", col("attend_n"), s)), m("load_avg_min", "number", "warehouse", (s) => mins("load_sec", col("load_n"), s)),
  m("wait_avg_min", "number", "warehouse", (s) => mins("wait_sec", col("wait_n"), s)), m("plan_avg_min", "number", "warehouse", (s) => mins("plan_sec", col("plan_n"), s)),
  m("stop_avg_min", "number", "route", (s) => mins("stop_sec", col("stop_n"), s)), m("parcel_avg_min", "number", "route", (s) => mins("parcel_sec", col("parcel_n"), s)),
  m("job_avg_min", "number", "route", (s) => mins("job_sec", col("job_n"), s)),
  m("radius_m", "distance", "distance", (s) => sql`round(${c("radius_m", s)}::numeric)::float8`), m("route_m", "distance", "distance", (s) => sql`round(${c("route_m", s)}::numeric)::float8`),
  m("gps_m", "distance", "distance", (s) => sql`round(${c("gps_m", s)}::numeric)::float8`),
  m("delivered", "number", "parcels", col("deliv")), m("failed", "number", "parcels", col("fail")), m("returned", "number", "parcels", col("ret")), m("pending_parcels", "number", "parcels", col("pending_parcels")),
  m("success", "percent", "parcels", (s) => div(c("deliv", s), resolved(s))), m("first_attempt", "percent", "parcels", (s) => div(c("first_att", s), c("deliv", s))),
  m("deferrals", "number", "parcels", col("deferrals")), m("proof_otp", "number", "parcels", col("proof_otp")), m("proof_receipt", "number", "parcels", col("proof_receipt")),
  m("cod_parcels", "number", "parcels", col("cod_parcels")),
  m("rating", "number", "quality", (s) => r2(div(c("rsum", s), c("rn", s)))), m("rating_count", "number", "quality", col("rn")),
  ...[1, 2, 3, 4, 5].map((k) => m(`stars${k}`, "number", "quality", col(`stars${k}`))),
  m("complaints", "number", "quality", col("complaints")), m("complaints_open", "number", "quality", col("complaints_open")), m("strikes", "number", "quality", col("cancelled")),
  m("suspensions", "number", "quality", col("suspensions")),
  m("customer", "money", "money", col("customer")), m("earn", "money", "money", col("earn")), m("margin", "money", "money", col("margin")), m("vat", "money", "money", col("vat")),
  m("refund", "money", "money", col("refund")), m("adjust", "money", "money", col("adjust")), m("paid", "money", "money", col("paid")), m("pending", "money", "money", col("pending")),
  m("cod_collected", "money", "money", col("cod_collected")), m("cod_remitted", "money", "money", col("cod_remitted")), m("cod_held", "money", "money", col("cod_held")),
  m("earn_per_job", "money", "money", perJob("earn")), m("earn_per_parcel", "money", "money", (s) => sql`round(${div(c("earn", s), c("deliv", s))})::float8`),
  m("earn_per_hour", "money", "money", (s) => sql`round(${div(sql`${c("earn", s)} * 3600.0`, c("online", s))})::float8`),
];
const BY_KEY = new Map(METRICS.map((x) => [x.key, x]));
export const metric = (key: string): FleetMetric => { const x = BY_KEY.get(key); if (!x) throw new Error(`Unknown fleet metric "${key}"`); return x; };
export const isMoney = (key: string): boolean => metric(key).type === "money";
/** The row field of a metric (`late_avg_min` → `lateAvgMin`, `cod_held` → `codHeldCents`). */
export const fieldOf = (key: string): string => rowKey(key, isMoney(key));

/** `<expr> as "<field>"` for each metric key, over the `_c` columns. */
export const selectMetrics = (keys: readonly string[]): SQL => sql.join(keys.map((k) => sql`${metric(k).expr("c")} as ${alias(fieldOf(k))}`), sql`, `);
/** The drill-down column of a metric: label `fr.col_<key>`, numbers right-aligned; `phone: false` keeps a long table readable on a phone. */
export function columnOf(key: string, o: { phone?: boolean } = {}): DrillColumn {
  const x = metric(key);
  return { key: fieldOf(key), label: `fr.col_${key}`, type: x.type, align: "end", ...(o.phone === false ? { phone: false } : {}) };
}
/** Sort map entry (the alias of the output column, quoted) of a metric key. */
export const sortOf = (keys: readonly string[]): Record<string, SQL> => Object.fromEntries(keys.map((k) => [fieldOf(k), alias(fieldOf(k))]));
export const moneyFields = (keys: readonly string[]): string[] => keys.filter(isMoney).map(fieldOf);
