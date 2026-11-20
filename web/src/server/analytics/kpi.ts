import { kpiDef, type Good, type Unit } from "./definitions";

export type { Good, Unit };
/**
 * A KPI as every report returns it. `value`/`prev` are in base units (halalas, fractions 0–1 for `percent`, seconds for `duration`, a plain ratio for `rate`).
 * `null` means "no data" (never 0): a ratio over an empty denominator, a period without activity. `delta = value − prev` (percentage points/100 for percent KPIs),
 * `deltaPct = delta / |prev|` (null when prev is 0 or missing).
 */
export interface Kpi {
  key: string; label: string; definition: string; numerator?: string; denominator?: string;
  unit: Unit; good: Good;
  value: number | null; prev: number | null; delta: number | null; deltaPct: number | null;
  /** One number per bucket of the period (sparkline). */
  spark?: Array<number | null>;
  /** Extra named parts of the value (new signups by role). */
  parts?: Array<{ key: string; value: number }>;
  /** Where the number can be explored. */
  href?: string;
  /** Active filters that cannot narrow this KPI. */
  unfiltered?: string[];
}

const fin = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
/** n / d, or null when there is nothing to divide by (0, missing, not finite): "no data", never 0%. */
export const safeDiv = (n: number | null | undefined, d: number | null | undefined): number | null => (fin(n) && fin(d) && d !== 0 ? n / d : null);
export const deltaOf = (v: number | null | undefined, p: number | null | undefined): number | null => (fin(v) && fin(p) ? r6(v - p) : null);
export const deltaPctOf = (v: number | null | undefined, p: number | null | undefined): number | null => (fin(v) && fin(p) && p !== 0 ? r6((v - p) / Math.abs(p)) : null);

export function makeKpi(key: string, value: number | null | undefined, prev: number | null | undefined, extra: Partial<Pick<Kpi, "spark" | "parts" | "href" | "unfiltered">> = {}): Kpi {
  const d = kpiDef(key);
  const v = fin(value) ? r6(value) : null, p = fin(prev) ? r6(prev) : null;
  return { key, label: d.label, definition: d.definition, numerator: d.numerator, denominator: d.denominator, unit: d.unit, good: d.good, value: v, prev: p, delta: deltaOf(v, p), deltaPct: deltaPctOf(v, p), ...extra };
}
/** Whether a change is good, bad or flat for this KPI (null when it cannot be compared). The UI colours the delta pill with it. */
export function verdict(k: Pick<Kpi, "delta" | "good">): "good" | "bad" | "flat" | null {
  if (k.delta == null) return null;
  if (Math.abs(k.delta) < 1e-9) return "flat";
  if (k.good === "neutral") return "flat";
  return (k.delta > 0) === (k.good === "higher") ? "good" : "bad";
}
/** The KPIs a viewer may see: money KPIs are dropped without `finance.view` (the response says so with `moneyHidden`). */
export const visibleKpis = (kpis: Kpi[], money: boolean): Kpi[] => (money ? kpis : kpis.filter((k) => !kpiDef(k.key).money));
