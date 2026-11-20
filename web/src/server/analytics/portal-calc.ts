import { safeDiv } from "./kpi";
import { FLAG_LIMITS, MIN_VOLUME, type Flag } from "./portal-constants";
import { bottomN, histogram, topN, type HistBucket } from "./stats";

/** PURE calculations of the portal reports (no database, no React): forecast, driver scorecard flags, ranked performers, distributions. Unit-tested in tests/unit/portal-reports-calc.test.ts. */

// ───────── spend forecast ─────────
export interface Forecast {
  /** Average charged per calendar day over the basis (days without spend count as 0). */
  perDay: number;
  /** perDay × horizon: the estimate for the next `horizon` days. */
  total: number;
  /** Lowest / highest weekly run-rate of the basis, scaled to the horizon: a plausible range, not a promise. */
  low: number; high: number;
  basisDays: number; activeDays: number; horizon: number;
}
/** Days of history the forecast needs before it says anything, and how many of them must have had spend. */
export const FORECAST_MIN_ACTIVE_DAYS = 3;
/**
 * Estimates the next `horizon` days of spend from the run-rate of the last days (`daily`, oldest first, calendar days). It is a plain average, not a model: the UI labels it an
 * estimate. Returns null when there is too little history (fewer than 3 days with spend), so the page says "not enough history" instead of inventing a number.
 */
export function forecastSpend(daily: number[], horizon = 30): Forecast | null {
  const d = daily.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const activeDays = d.filter((v) => v > 0).length;
  if (d.length < 7 || activeDays < FORECAST_MIN_ACTIVE_DAYS) return null;
  const sum = d.reduce((s, v) => s + v, 0);
  const perDay = sum / d.length;
  const weeks: number[] = [];
  for (let i = d.length; i - 7 >= 0; i -= 7) weeks.push(d.slice(i - 7, i).reduce((s, v) => s + v, 0));
  const weekly = weeks.map((w) => (w / 7) * horizon);
  const total = perDay * horizon;
  return { perDay, total, low: Math.min(total, ...weekly), high: Math.max(total, ...weekly), basisDays: d.length, activeDays, horizon };
}

// ───────── driver scorecards ─────────
export interface DriverScore {
  id: string; name: string; linked: boolean;
  jobs: number; completed: number; noShow: number; cancelled: number; replaced: number;
  resolved: number; delivered: number; failed: number; returned: number;
  onTime: number; due: number; earnings: number;
  offersMade: number; offersAccepted: number;
  ratingSum: number; ratingN: number;
}
export const successRate = (d: Pick<DriverScore, "delivered" | "resolved">) => safeDiv(d.delivered, d.resolved);
export const onTimeRate = (d: Pick<DriverScore, "onTime" | "due">) => safeDiv(d.onTime, d.due);
export const acceptanceRate = (d: Pick<DriverScore, "offersAccepted" | "offersMade">) => safeDiv(d.offersAccepted, d.offersMade);
export const ratingOf = (d: Pick<DriverScore, "ratingSum" | "ratingN">) => safeDiv(d.ratingSum, d.ratingN);
export { FLAGS, FLAG_LIMITS, MIN_VOLUME, type Flag } from "./portal-constants";

/**
 * Why a driver needs a conversation: each flag needs enough volume behind it (the same minimum as the rankings), so one failed parcel never brands a new driver.
 * `idle` (a linked driver with no job at all) is reported too but is not a performance problem: `coachFlags` leaves it out.
 */
export function driverFlags(d: DriverScore): Flag[] {
  const out: Flag[] = [];
  const s = successRate(d), t = onTimeRate(d), a = acceptanceRate(d), r = ratingOf(d);
  if (d.resolved >= MIN_VOLUME.parcels && s != null && s < FLAG_LIMITS.success) out.push("low_success");
  if (d.due >= MIN_VOLUME.due && t != null && t < FLAG_LIMITS.onTime) out.push("late");
  if (d.noShow >= 2 || (d.jobs >= MIN_VOLUME.jobs && d.noShow / d.jobs >= FLAG_LIMITS.noShow)) out.push("no_shows");
  if (d.cancelled >= 3 || (d.jobs >= MIN_VOLUME.jobs && d.cancelled / d.jobs >= FLAG_LIMITS.cancel)) out.push("cancellations");
  if (d.ratingN >= MIN_VOLUME.ratings && r != null && r < FLAG_LIMITS.rating) out.push("low_rating");
  if (d.offersMade >= MIN_VOLUME.offers && a != null && a < FLAG_LIMITS.acceptance) out.push("low_acceptance");
  if (d.linked && d.jobs === 0 && d.offersMade === 0) out.push("idle");
  return out;
}
export const coachFlags = (d: DriverScore): Flag[] => driverFlags(d).filter((f) => f !== "idle");

export interface Performers { top: DriverScore[]; bottom: DriverScore[]; ranked: number; belowGuard: number }
/**
 * Best and worst drivers by delivery success. Only drivers with at least `MIN_VOLUME.parcels` resolved parcels are ranked (the `belowGuard` others are counted, not listed), ties
 * are broken by volume so the larger sample ranks higher among the best and lower among the worst.
 */
export function performers(list: DriverScore[], n = 5): Performers {
  const eligible = list.filter((d) => d.resolved >= MIN_VOLUME.parcels);
  const by = (d: DriverScore) => (successRate(d) ?? 0) * 1e6 + Math.min(d.resolved, 99_999);
  const byBottom = (d: DriverScore) => (successRate(d) ?? 0) * 1e6 - Math.min(d.resolved, 99_999);
  return { top: topN(eligible, by, n), bottom: bottomN(eligible, byBottom, n), ranked: eligible.length, belowGuard: list.filter((d) => d.resolved > 0 && d.resolved < MIN_VOLUME.parcels).length };
}

/** Distributions of the fleet: jobs per driver, delivery success per driver (≥ minimum parcels) and rating per driver (≥ minimum ratings). Edges are exclusive upper bounds. */
export const JOBS_EDGES = [1, 2, 5, 10, 20];
export const SUCCESS_EDGES = [0.5, 0.7, 0.85, 0.95];
export const RATING_EDGES = [2, 3, 3.5, 4, 4.5];
export function distributions(list: DriverScore[]): { jobs: HistBucket[]; success: HistBucket[]; rating: HistBucket[] } {
  const num = (xs: Array<number | null>) => xs.filter((x): x is number => x != null);
  return {
    jobs: histogram(list.map((d) => d.jobs), JOBS_EDGES),
    success: histogram(num(list.filter((d) => d.resolved >= MIN_VOLUME.parcels).map(successRate)), SUCCESS_EDGES),
    rating: histogram(num(list.filter((d) => d.ratingN >= MIN_VOLUME.ratings).map(ratingOf)), RATING_EDGES),
  };
}

/** Fleet totals from the scorecards (the same sums the KPI row uses, so the table and the cards agree). */
export function fleetTotals(list: DriverScore[]) {
  const sum = (f: (d: DriverScore) => number) => list.reduce((s, d) => s + f(d), 0);
  return {
    drivers: list.length, active: list.filter((d) => d.jobs > 0).length, jobs: sum((d) => d.jobs), noShow: sum((d) => d.noShow), cancelled: sum((d) => d.cancelled),
    offersMade: sum((d) => d.offersMade), offersAccepted: sum((d) => d.offersAccepted), ratingSum: sum((d) => d.ratingSum), ratingN: sum((d) => d.ratingN), coach: list.filter((d) => coachFlags(d).length > 0).length,
  };
}
