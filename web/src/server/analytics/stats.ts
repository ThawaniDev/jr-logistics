import { sql, type SQL } from "drizzle-orm";

/** Percentile `p` (0–1) of an ascending-sorted list with linear interpolation (the same rule as SQL `percentile_cont`); null for an empty list. */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const x = Math.min(Math.max(p, 0), 1) * (sorted.length - 1);
  const lo = Math.floor(x), hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}
/** `{ p50, p90, p95 }` of any list (unsorted is fine). Prefer SQL `percentile_cont(...) within group (order by …)` for big data; this is for rows already in memory. */
export function percentiles(values: number[], ps: number[] = [0.5, 0.9, 0.95]): Record<string, number | null> {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  return Object.fromEntries(ps.map((p) => [`p${Math.round(p * 100)}`, percentile(s, p)]));
}

/** `from` inclusive, `to` exclusive; null = open end (the first bucket has no lower bound, the last no upper bound). */
export interface HistBucket { from: number | null; to: number | null; count: number }
/** Buckets for ascending `edges`: edges `[10, 20]` → `< 10`, `10–<20`, `≥ 20`. */
export function histogram(values: number[], edges: number[]): HistBucket[] {
  const out: HistBucket[] = [...edges, null].map((to, i) => ({ from: i === 0 ? null : edges[i - 1], to, count: 0 }));
  for (const v of values) { if (!Number.isFinite(v)) continue; let i = edges.findIndex((e) => v < e); if (i < 0) i = edges.length; out[i].count++; }
  return out;
}
/** SQL select-list items `count(*) filter (where <expr> in bucket i) as <prefix>i` for the same bucketing, so a histogram is one aggregate (add `extra` to also filter rows). */
export function histogramSelect(expr: SQL, edges: number[], prefix = "h", extra?: SQL): SQL {
  const cond = (c: SQL) => (extra ? sql`${extra} and ${c}` : c);
  const parts = [...edges, null].map((to, i) => {
    const from = i === 0 ? null : edges[i - 1];
    const c = from === null ? sql`${expr} < ${to}` : to === null ? sql`${expr} >= ${from}` : sql`${expr} >= ${from} and ${expr} < ${to}`;
    return sql`count(*) filter (where ${cond(c)})::int as ${sql.raw(`${prefix}${i}`)}`;
  });
  return sql.join(parts, sql`, `);
}
export const histogramFromRow = (row: Record<string, unknown>, edges: number[], prefix = "h"): HistBucket[] =>
  [...edges, null].map((to, i) => ({ from: i === 0 ? null : edges[i - 1], to, count: Number(row?.[`${prefix}${i}`] ?? 0) }));

/** The n rows with the largest (topN) or smallest (bottomN) `by`, ties keep the input order. Rows whose value is null are never ranked. */
export const topN = <T>(rows: T[], by: (r: T) => number | null, n: number): T[] =>
  rows.map((r, i) => ({ r, i, v: by(r) })).filter((x) => x.v != null).sort((a, b) => (b.v as number) - (a.v as number) || a.i - b.i).slice(0, n).map((x) => x.r);
export const bottomN = <T>(rows: T[], by: (r: T) => number | null, n: number): T[] =>
  rows.map((r, i) => ({ r, i, v: by(r) })).filter((x) => x.v != null).sort((a, b) => (a.v as number) - (b.v as number) || a.i - b.i).slice(0, n).map((x) => x.r);
/** Adds `share` (0–1 of the total, null when the total is 0) to each row. */
export function withShare<T>(rows: T[], by: (r: T) => number): Array<T & { share: number | null }> {
  const total = rows.reduce((s, r) => s + (Number(by(r)) || 0), 0);
  return rows.map((r) => ({ ...r, share: total > 0 ? Math.round(((Number(by(r)) || 0) / total) * 1e6) / 1e6 : null }));
}

export interface Mover { id: string; name: string; cur: number; prev: number; delta: number; deltaPct: number | null }
/** The `n` biggest increases and decreases (by absolute change) between two periods; unchanged rows are left out. */
export function movers(rows: Array<{ id: string; name: string; cur: number; prev: number }>, n = 5): { up: Mover[]; down: Mover[] } {
  const all: Mover[] = rows.map((r) => ({ ...r, delta: r.cur - r.prev, deltaPct: r.prev !== 0 ? Math.round(((r.cur - r.prev) / Math.abs(r.prev)) * 1e6) / 1e6 : null })).filter((m) => m.delta !== 0);
  return { up: topN(all.filter((m) => m.delta > 0), (m) => m.delta, n), down: bottomN(all.filter((m) => m.delta < 0), (m) => m.delta, n) };
}
