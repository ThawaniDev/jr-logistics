import { logError } from "@/lib/log";
import { safeDiv } from "./kpi";

/** Pure helpers shared by the Operations and Geography reports (no database access). */
export type Pair = { cur: number | null; prev: number | null };
export type Row = Record<string, unknown>;

/** A count is 0 when nothing happened (the previous value stays null when there is no comparison). */
export const z = (p: Pair): Pair => ({ cur: p.cur ?? 0, prev: p.prev });
export const ratio = (n: Pair, d: Pair): Pair => ({ cur: safeDiv(n.cur, d.cur), prev: safeDiv(n.prev, d.prev) });
export const sub = (a: Pair, b: Pair): Pair => ({ cur: a.cur == null ? null : a.cur - (b.cur ?? 0), prev: a.prev == null ? null : a.prev - (b.prev ?? 0) });
export const add = (...p: Pair[]): Pair => ({ cur: p.reduce((s, x) => s + (x.cur ?? 0), 0), prev: p.every((x) => x.prev == null) ? null : p.reduce((s, x) => s + (x.prev ?? 0), 0) });
export const scale = (p: Pair, k: number): Pair => ({ cur: p.cur == null ? null : p.cur * k, prev: p.prev == null ? null : p.prev * k });
export const asNum = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
export const round = (n: number | null, digits = 2): number | null => (n == null ? null : Math.round(n * 10 ** digits) / 10 ** digits);
export const roundPair = (p: Pair, digits = 0): Pair => ({ cur: round(p.cur, digits), prev: round(p.prev, digits) });

/** A 7 × 24 matrix (weekday 0 = Sunday × hour) from `{ dow, hr, n }` rows; out-of-range rows are dropped. */
export function cellsOf(rows: Array<{ dow: unknown; hr: unknown; n: unknown }>): { cells: number[][]; total: number; max: number } {
  const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const x of rows) { const d = Number(x.dow), h = Number(x.hr), n = Number(x.n); if (d >= 0 && d < 7 && h >= 0 && h < 24 && Number.isFinite(n)) cells[d][h] = n; }
  const flat = cells.flat();
  return { cells, total: flat.reduce((s, n) => s + n, 0), max: Math.max(0, ...flat) };
}

/**
 * Report sections fail on their own (decision G11: "partial sections show their own error state"): `run` catches a section's error and records it, the report is
 * assembled from what worked. When EVERY section failed the first error is thrown (the page shows its error state, a timeout keeps its 503 hint). When only some
 * failed the finished value leaves through `PartialReport`, which the report function unwraps AFTER the cache, so a partial result is never cached for 30 s.
 */
export class PartialReport<T> extends Error {
  constructor(readonly value: T) { super("Some sections of the report could not be computed"); this.name = "PartialReport"; }
}
export function sectionRunner(report: string) {
  const failed: string[] = []; const errors: unknown[] = []; let total = 0;
  return {
    failed,
    async run<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
      total++;
      try { return await fn(); } catch (e) { failed.push(name); errors.push(e); logError(e, { correlationId: `analytics:${report}:${name}` }); return null; }
    },
    /** Returns the value, or throws (everything failed → the first error; some failed → `PartialReport`). */
    done<T>(value: T): T {
      if (failed.length && failed.length >= total) throw errors[0];
      if (failed.length) throw new PartialReport(value);
      return value;
    },
  };
}

/**
 * Sorts and pages rows that were aggregated in SQL and are few by construction (cities, routes, grid cells): numbers by value, text alphabetically, missing values
 * last whatever the direction, ties by `id`. The drill-down contract (`registry.ts`) pages everything the same way, only here the order is applied in memory.
 */
export function memoryPage<T extends { id: string }>(items: T[], sort: { key: string; dir: "asc" | "desc" }, limit: number, offset: number): { rows: T[]; total: number } {
  const dir = sort.dir === "desc" ? -1 : 1;
  const val = (r: T) => (r as unknown as Record<string, unknown>)[sort.key];
  const sorted = [...items].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null && y == null) return a.id.localeCompare(b.id);
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return c * dir || a.id.localeCompare(b.id);
  });
  return { rows: sorted.slice(offset, offset + limit), total: sorted.length };
}
