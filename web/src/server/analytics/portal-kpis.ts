import { ignoredFilters } from "./conditions";
import { kpiDef } from "./definitions";
import type { ResolvedFilters } from "./filters";
import { makeKpi, safeDiv, type Kpi } from "./kpi";
import type { Pair } from "./portal-facts";

/** Small pure helpers every portal report uses to turn facts into KPI objects (unit-tested through the report KPI builders). */
export const ratio = (n: Pair, d: Pair): Pair => ({ cur: safeDiv(n.cur, d.cur), prev: safeDiv(n.prev, d.prev) });
export const add = (...p: Pair[]): Pair => ({ cur: p.reduce((s, x) => s + (x.cur ?? 0), 0), prev: p.every((x) => x.prev == null) ? null : p.reduce((s, x) => s + (x.prev ?? 0), 0) });
/** A number as of now (a balance, an open queue): it has no comparison period. */
export const stock = (v: number | null): Pair => ({ cur: v, prev: null });
/** Per-bucket ratio for a sparkline: null where the denominator is 0 (a gap, not a 0%). */
export const perBucket = (n: number[], d: number[]) => n.map((v, i) => safeDiv(v, d[i]));
export const col = <K extends string>(s: { points: Array<Record<K, number>> } | null | undefined, k: K): number[] => (s ? s.points.map((p) => p[k]) : []);

export type KpiEntry = [key: string, value: Pair, extra?: Partial<Pick<Kpi, "href" | "parts">>];
/** KPI objects for the entries that exist (a failed section passes `null` and its cards are simply absent). `spark` carries one number per bucket for the KPIs that have a series. */
export function kpisFrom(f: ResolvedFilters, entries: Array<KpiEntry | null | false | undefined>, spark: Record<string, Array<number | null> | undefined> = {}): Kpi[] {
  return entries.filter((e): e is KpiEntry => !!e).map(([key, p, extra]) => {
    const unfiltered = ignoredFilters(f, kpiDef(key).notFilteredBy ?? []);
    const s = spark[key];
    return makeKpi(key, p.cur, p.prev, { ...extra, ...(s && s.length ? { spark: s } : {}), ...(unfiltered.length ? { unfiltered } : {}) });
  });
}
