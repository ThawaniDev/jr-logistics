/**
 * Support & quality: the constants and the PURE logic (no imports from the server, so client components and unit tests can use it).
 * The SQL in `support-sql.ts` implements exactly these rules; `tests/unit/support-sla.test.ts` pins them and the integration test checks the two agree.
 */

/** SLA targets of the support desk, defined ONCE. KPI definitions, SQL, tables and the UI all read these. */
export const FIRST_RESPONSE_TARGET_SEC = 4 * 3600;
export const RESOLUTION_TARGET_SEC = 48 * 3600;
export const TARGET_HOURS = { firstResponse: FIRST_RESPONSE_TARGET_SEC / 3600, resolution: RESOLUTION_TARGET_SEC / 3600 } as const;
/** A ticket that has used this share of a target without meeting it is "at risk". */
export const AT_RISK_SHARE = 0.75;
/** Backlog aging buckets (seconds; edges of 2, 4, 8 and 15 days → 0–1 d, 2–3 d, 4–7 d, 8–14 d, 15+ d). */
export const AGING_EDGES = [2, 4, 8, 15].map((d) => d * 86_400);
/** Resolution-time histogram edges: < 1 h, 1–4 h, 4–12 h, 12–24 h, 24–48 h, 2–7 d, ≥ 7 d. */
export const RESOLUTION_EDGES = [3600, 4 * 3600, 12 * 3600, 24 * 3600, 48 * 3600, 7 * 86_400];
/** Guards against ranking on tiny samples. */
export const MIN_ORDERS_FOR_RATE = 5;
export const MIN_RATINGS_FOR_RANK = 3;
/** 1–2 stars count as "low". */
export const LOW_STARS = 2;
export const HELD_STATES = ["pending_review", "reviewed", "approved", "failed"] as const;

export type SlaPart = "met" | "missed" | "pending" | "at_risk";
export interface SlaInput { createdAt: Date | string; firstResponseAt?: Date | string | null; resolvedAt?: Date | string | null; now?: Date }
export interface SlaState { response: SlaPart; resolution: SlaPart; breached: boolean; atRisk: boolean }

const ms = (d: Date | string) => (d instanceof Date ? d : new Date(d)).getTime();

/**
 * One ticket against the two targets at `now`.
 * - response: `met` when answered within the target; `missed` when answered late or still unanswered after the target; `at_risk` when unanswered and past 75 % of it; else `pending`.
 * - resolution: the same for `resolvedAt` (a reopened ticket has no `resolvedAt`, so it counts as unresolved until it is resolved again).
 * - breached = either part missed; atRisk = not breached and either part at risk.
 */
export function slaState(i: SlaInput): SlaState {
  const created = ms(i.createdAt), now = (i.now ?? new Date()).getTime();
  const part = (doneAt: Date | string | null | undefined, target: number): SlaPart => {
    const limit = created + target * 1000;
    if (doneAt != null) return ms(doneAt) <= limit ? "met" : "missed";
    if (now > limit) return "missed";
    return now >= created + target * 1000 * AT_RISK_SHARE ? "at_risk" : "pending";
  };
  const response = part(i.firstResponseAt, FIRST_RESPONSE_TARGET_SEC), resolution = part(i.resolvedAt, RESOLUTION_TARGET_SEC);
  const breached = response === "missed" || resolution === "missed";
  return { response, resolution, breached, atRisk: !breached && (response === "at_risk" || resolution === "at_risk") };
}
/** `breached` | `at_risk` | `ok` (everything met) | `pending` (nothing missed yet, nothing at risk): the label shown in the tables. */
export function slaLabel(s: SlaState, done: boolean): "breached" | "at_risk" | "ok" | "pending" {
  return s.breached ? "breached" : s.atRisk ? "at_risk" : done ? "ok" : "pending";
}

/** Tickets per 100 orders; null without orders (never 0). */
export const per100 = (tickets: number | null, orders: number | null): number | null => (tickets == null || orders == null || orders <= 0 ? null : (tickets / orders) * 100);

/** Pearson correlation of two series, ignoring positions where either is null; null with fewer than `min` pairs or no variance. */
export function pearson(xs: Array<number | null>, ys: Array<number | null>, min = 6): number | null {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) { const x = xs[i], y = ys[i]; if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y]); }
  if (pairs.length < min) return null;
  const n = pairs.length, mx = pairs.reduce((s, p) => s + p[0], 0) / n, my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (sxx === 0 || syy === 0) return null;
  return Math.round((sxy / Math.sqrt(sxx * syy)) * 1e4) / 1e4;
}

/** Keeps the `n` biggest groups (by `by`) and folds the rest into one `other` group; every kept key is returned in order. */
export function topWithOther(totals: Map<string, number>, n: number): { keys: string[]; hasOther: boolean } {
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { keys: sorted.slice(0, n).map(([k]) => k), hasOther: sorted.length > n };
}
