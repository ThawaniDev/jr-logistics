import { sql, type SQL } from "drizzle-orm";
import type { Metric } from "./conditions";
import type { Insight } from "./insights";
import { pct1, type Pair } from "./companies-lib";
import { RIYADH_OFFSET_MS } from "./time";

/** Pure pieces of the drivers report: reliability thresholds (the SQL is built from them), the weekday × hour slot maths of the availability heatmap, insights. */

/** An offer the driver kept (accepted and not later dropped); a job the driver cancelled themselves (not the customer, not the platform). */
export const KEPT = sql`(offers.accepted_at is not null and offers.status not in ('rejected','expired','cancelled','replaced','no_show'))`;
export const DRIVER_CANCELLED = sql`(offers.status = 'cancelled' and offers.accepted_at is not null and coalesce(offers.cancel_reason, '') not in ('request_cancelled','not_fully_staffed'))`;
/** An offer the platform pushed to the driver (an application the driver made themselves is not an answer to an offer). */
export const PUSHED = sql`offers.source <> 'apply'`;
/** The request's start time, the anchor of punctuality. */
export const STARTS = sql`requests.starts_at`;
/**
 * Start punctuality (the Overview's rule): a job is DUE once its driver arrived, was marked no-show, or start + grace has passed; it is ON TIME when the driver arrived by start + grace.
 * `grace` = Settings › late grace minutes. Jobs are anchored on the request's start time.
 */
export function punctuality(grace: number): { due: Metric; ontime: Metric } {
  const limit = sql`requests.starts_at + make_interval(mins => ${grace}::int)`;
  const counted = sql`offers.accepted_at is not null and offers.status not in ('rejected','expired','cancelled','replaced')`;
  return {
    due: (w) => sql`count(*) filter (where ${w(STARTS)} and ${counted} and (offers.arrived_at is not null or offers.status = 'no_show' or now() > ${limit}))::int`,
    ontime: (w) => sql`count(*) filter (where ${w(STARTS)} and ${counted} and offers.arrived_at is not null and offers.arrived_at <= ${limit})::int`,
  };
}
/** One job never counts more than this much busy time (a vehicle-day job is not 24 working hours). */
export const MAX_BUSY_SECONDS = 16 * 3600;

/** A driver is flagged unreliable on a reason only with at least `volume` jobs, offers or parcels behind it (the minimum-volume guard). */
export const FLAGS = { volume: 5, acceptance: 0.4, cancel: 0.15, onTime: 0.6, rating: 3.5, ratingMin: 3, success: 0.8, successMin: 10 } as const;
export const FLAG_ORDER = ["suspended", "high_cancel", "low_success", "low_ontime", "low_acceptance", "low_rating"] as const;
export type Flag = (typeof FLAG_ORDER)[number];
/** The leaderboard only ranks drivers with at least this many resolved parcels. */
export const MIN_RESOLVED = 10;
export const ACCEPT_EDGES = [0.5, 0.8, 0.95], COMPLETE_EDGES = [0.7, 0.9, 0.98];
export const SUCCESS_EDGES = [0.5, 0.7, 0.9, 0.97], JOB_EDGES = [2, 5, 10, 20];
export const HEAT_DAYS = 28;

/** The flags of one driver from their numbers (the same rules as `flagSql`). */
export function flagsOf(d: { suspended: boolean; answered: number; accepted: number; jobsAccepted: number; cancelled: number; noShow: number; due: number; onTime: number; ratings: number; ratingSum: number; resolved: number; delivered: number }): Flag[] {
  const out = new Set<Flag>();
  if (d.suspended) out.add("suspended");
  if (d.jobsAccepted >= FLAGS.volume && (d.cancelled + d.noShow) / d.jobsAccepted >= FLAGS.cancel) out.add("high_cancel");
  if (d.resolved >= FLAGS.successMin && d.delivered / d.resolved < FLAGS.success) out.add("low_success");
  if (d.due >= FLAGS.volume && d.onTime / d.due < FLAGS.onTime) out.add("low_ontime");
  if (d.answered >= FLAGS.volume && d.accepted / d.answered < FLAGS.acceptance) out.add("low_acceptance");
  if (d.ratings >= FLAGS.ratingMin && d.ratingSum / d.ratings < FLAGS.rating) out.add("low_rating");
  return FLAG_ORDER.filter((f) => out.has(f));
}
const r = (n: number) => sql.raw(String(n));
/** SQL booleans of every flag over the per-driver columns `answered_c accepted_c acc_c cancelled_c noshow_c due_c ontime_c rn_c rsum_c deliv_c fail_c ret_c suspended_now`. */
export const FLAG_SQL: Record<Flag, SQL> = {
  suspended: sql`suspended_now`,
  high_cancel: sql`(acc_c >= ${r(FLAGS.volume)} and (cancelled_c + noshow_c)::float8 / acc_c >= ${r(FLAGS.cancel)})`,
  low_success: sql`(deliv_c + fail_c + ret_c >= ${r(FLAGS.successMin)} and deliv_c::float8 / (deliv_c + fail_c + ret_c) < ${r(FLAGS.success)})`,
  low_ontime: sql`(due_c >= ${r(FLAGS.volume)} and ontime_c::float8 / due_c < ${r(FLAGS.onTime)})`,
  low_acceptance: sql`(answered_c >= ${r(FLAGS.volume)} and accepted_c::float8 / answered_c < ${r(FLAGS.acceptance)})`,
  low_rating: sql`(rn_c >= ${r(FLAGS.ratingMin)} and rsum_c::float8 / rn_c < ${r(FLAGS.rating)})`,
};
export const flagCountSql = (): SQL => sql.join(FLAG_ORDER.map((f) => sql`(case when ${FLAG_SQL[f]} then 1 else 0 end)`), sql` + `);
/** The most serious flag (by `FLAG_ORDER`) as text, null when there is none. */
export const flagReasonSql = (): SQL => sql`case ${sql.join(FLAG_ORDER.map((f) => sql`when ${FLAG_SQL[f]} then ${sql.raw(`'${f}'`)}`), sql` `)} end`;
/** All the flags as a comma-separated list (CSV and the detail drawer). */
export const flagListSql = (): SQL => sql`concat_ws(',', ${sql.join(FLAG_ORDER.map((f) => sql`case when ${FLAG_SQL[f]} then ${sql.raw(`'${f}'`)} end`), sql`, `)})`;

/**
 * How many hour slots of each Riyadh weekday (0 = Sunday) × hour fall in `[startMs, endMs)`, as fractions (a partly covered slot counts partly): the denominator of
 * "average drivers available in this slot".
 */
export function slotCounts(startMs: number, endMs: number): number[][] {
  const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const H = 3_600_000;
  for (let t = Math.floor(startMs / H) * H; t < endMs; t += H) {
    const cover = Math.min(endMs, t + H) - Math.max(startMs, t);
    if (cover <= 0) continue;
    const local = new Date(t + RIYADH_OFFSET_MS);
    cells[local.getUTCDay()][local.getUTCHours()] += cover / H;
  }
  return cells;
}
/** Hours of availability per slot (`hours[d][h]`) ÷ the slot counts → the average number of drivers available (null slot count → 0). One decimal. */
export function averageAvailable(hours: number[][], slots: number[][]): number[][] {
  return hours.map((row, d) => row.map((h, i) => (slots[d][i] > 0 ? Math.round((h / slots[d][i]) * 10) / 10 : 0)));
}
export const emptyHeat = () => Array.from({ length: 7 }, () => Array<number>(24).fill(0));
/** A banded matrix: counts of drivers by acceptance band (rows) × completion band (columns); bands are `width_bucket` indexes 0..edges.length. */
export function bandMatrix(raw: Array<{ a: number; c: number; n: number }>, rowsN: number, colsN: number): number[][] {
  const m = Array.from({ length: rowsN }, () => Array<number>(colsN).fill(0));
  for (const x of raw) if (x.a >= 0 && x.a < rowsN && x.c >= 0 && x.c < colsN) m[x.a][x.c] += x.n;
  return m;
}

export interface DriverInsightInput {
  active: Pair; acceptance: Pair; success: Pair; cancel: Pair; onTime: Pair; utilisation: Pair; churned: number | null; flagged: number; activeCount: number; availableNow: number | null;
  heatPeak: { day: number; hour: number } | null; lowRatingShare: number | null; suspensions: Pair; cash: number | null;
}
/** Plain-language observations about the drivers report (keys `rpp.ins_drv_*`). */
export function driverInsights(i: DriverInsightInput): Insight[] {
  const out: Insight[] = [];
  if (i.activeCount < 3) out.push({ key: "rpp.ins_drv_sparse", tone: "info", vars: { n: i.activeCount } });
  if (i.flagged > 0) out.push({ key: "rpp.ins_drv_flagged", tone: "bad", vars: { n: i.flagged } });
  if (i.acceptance.cur != null && i.acceptance.cur < 0.6) out.push({ key: "rpp.ins_drv_acceptance_low", tone: "bad", vars: { n: pct1(i.acceptance.cur) } });
  if (i.cancel.cur != null && i.cancel.cur >= 0.1) out.push({ key: "rpp.ins_drv_cancel_high", tone: "bad", vars: { n: pct1(i.cancel.cur) } });
  if (i.success.cur != null && i.success.cur < 0.9) out.push({ key: "rpp.ins_drv_success_low", tone: "bad", vars: { n: pct1(i.success.cur) } });
  if (i.onTime.cur != null && i.onTime.cur < 0.8) out.push({ key: "rpp.ins_drv_ontime_low", tone: "bad", vars: { n: pct1(i.onTime.cur) } });
  if (i.utilisation.cur != null && i.utilisation.cur < 0.3 && i.activeCount >= 3) out.push({ key: "rpp.ins_drv_util_low", tone: "info", vars: { n: pct1(i.utilisation.cur) } });
  if (i.churned != null && i.churned > 0) out.push({ key: "rpp.ins_drv_churned", tone: "bad", vars: { n: i.churned } });
  if ((i.suspensions.cur ?? 0) > 0) out.push({ key: "rpp.ins_drv_suspended", tone: "bad", vars: { n: i.suspensions.cur ?? 0 } });
  if (i.availableNow === 0 && i.activeCount > 0) out.push({ key: "rpp.ins_drv_none_available", tone: "bad" });
  if (i.heatPeak) out.push({ key: "rpp.ins_drv_peak", tone: "info", refs: { day: `rpf.wd_${i.heatPeak.day}` }, vars: { hour: `${String(i.heatPeak.hour).padStart(2, "0")}:00` } });
  if (i.lowRatingShare != null && i.lowRatingShare >= 0.2) out.push({ key: "rpp.ins_drv_ratings_low", tone: "bad", vars: { n: pct1(i.lowRatingShare) } });
  if ((i.cash ?? 0) > 0) out.push({ key: "rpp.ins_drv_cash", tone: "info" });
  return out.slice(0, 8);
}
