import { inArray, sql, type SQL } from "drizzle-orm";
import { users } from "@/db/schema";
import { bucketSql, zeroFill, type Point } from "./buckets";
import { ignoredFilters } from "./conditions";
import { kpiDef, type Good, type KpiDef, type Unit } from "./definitions";
import type { ResolvedFilters } from "./filters";
import { rows } from "./guard";
import { logError } from "@/lib/log";
import { makeKpi, safeDiv, type Kpi } from "./kpi";
import type { Window } from "./periods";

/**
 * Shared plumbing of the deliveries, cash-on-delivery and finance reports (prefix `rpd.`): KPI definition builder, pair arithmetic, series builders
 * (zero-filled counts and null-filled measures), names for ids, the age buckets and the minimum volume that guards every "worst performer" ranking.
 */
export type Row = Record<string, unknown>;
export type Pair = { cur: number | null; prev: number | null };
export const NONE: Pair = { cur: null, prev: null };
/** A count or a sum: 0 (not null) when nothing happened in the current period; the comparison stays null when there is none. */
export const z = (p: Pair): Pair => ({ cur: p.cur ?? 0, prev: p.prev });
export const add = (...p: Pair[]): Pair => ({ cur: p.reduce((s, x) => s + (x.cur ?? 0), 0), prev: p.every((x) => x.prev == null) ? null : p.reduce((s, x) => s + (x.prev ?? 0), 0) });
export const sub = (a: Pair, b: Pair): Pair => ({ cur: (a.cur ?? 0) - (b.cur ?? 0), prev: a.prev == null && b.prev == null ? null : (a.prev ?? 0) - (b.prev ?? 0) });
export const ratio = (n: Pair, d: Pair): Pair => ({ cur: safeDiv(n.cur, d.cur), prev: safeDiv(n.prev, d.prev) });
/** Pair of the same expression read from two rows (current period, previous period). */
export const pairOf = (cur: number | null | undefined, prev: number | null | undefined): Pair => ({ cur: cur ?? null, prev: prev ?? null });
/** Fewer outcomes than this and a success rate says nothing: ranked "worst performers" skip such rows. */
export const MIN_VOLUME = 10;
/** Edges of the age buckets (days) of unpaid cash and unpaid settlements: 0–1, 2–3, 4–7, 8–14, 15+. */
export const AGE_EDGES = [2, 4, 8, 15] as const;
export const AGE_KEYS = ["d0_1", "d2_3", "d4_7", "d8_14", "d15"] as const;
export type AgeKey = (typeof AGE_KEYS)[number];
export const ageKeyOf = (days: number): AgeKey => AGE_KEYS[AGE_EDGES.filter((e) => days >= e).length];
/** `case` expression giving the age bucket key of `days` (an SQL expression yielding whole days). */
export const ageKeySql = (days: SQL): SQL => sql`(case when ${days} < 2 then 'd0_1' when ${days} < 4 then 'd2_3' when ${days} < 8 then 'd4_7' when ${days} < 15 then 'd8_14' else 'd15' end)`;

/** KPI definition of the `rpd.` reports: label `rpd.kpi_<key>`, definition `rpd.def_<key>`, and `_n` / `_d` for ratios. */
export function kpiOf(key: string, unit: Unit, good: Good, o: Partial<KpiDef> & { ratio?: boolean } = {}): KpiDef {
  const { ratio: r, ...rest } = o;
  return { key, unit, good, label: `rpd.kpi_${key}`, definition: `rpd.def_${key}`, ...(r ? { numerator: `rpd.def_${key}_n`, denominator: `rpd.def_${key}_d` } : {}), ...rest };
}

/** The KPI objects of a report from `[key, pair, extra]` entries, in order; every KPI reports the filters that cannot narrow it. */
export function makeKpis(f: ResolvedFilters, entries: Array<[string, Pair, Partial<Kpi>?]>, spark: Record<string, Array<number | null> | undefined> = {}): Kpi[] {
  return entries.map(([key, p, extra]) => {
    const unfiltered = ignoredFilters(f, kpiDef(key).notFilteredBy ?? []);
    return makeKpi(key, p.cur, p.prev, { ...extra, spark: spark[key], ...(unfiltered.length ? { unfiltered } : {}) });
  });
}

/** One chart series: a point per bucket, plus the comparison period's points aligned by position (null without comparison). */
export interface Series<K extends string, V = number> { fields: K[]; points: Array<{ t: string } & Record<K, V>>; prev: Array<{ t: string } & Record<K, V>> | null }

/** Zero-filled counts/sums per bucket for both periods. `query(w)` selects `t` (a `bucketSql`) and the fields. */
export async function buildSeries<K extends string>(f: ResolvedFilters, fields: K[], query: (w: Window) => SQL): Promise<Series<K, number>> {
  const read = async (w: Window, keys: string[]) => zeroFill(keys, await rows<{ t: string } & Partial<Record<K, unknown>>>(query(w)), fields) as Array<Point<K>>;
  const [points, prev] = await Promise.all([read(f.cur, f.keys), f.prev && f.prevKeys ? read(f.prev, f.prevKeys) : null]);
  return { fields, points, prev };
}

/** Like `buildSeries`, but a bucket without data is `null` (a gap), never 0: for percentiles, averages and balances. */
export function nullFill<K extends string>(keys: string[], data: Array<{ t: string } & Partial<Record<K, unknown>>>, fields: readonly K[]): Array<{ t: string } & Record<K, number | null>> {
  const by = new Map(data.map((r) => [r.t, r]));
  return keys.map((t) => {
    const r = by.get(t);
    const p = { t } as { t: string } & Record<K, number | null>;
    for (const k of fields) { const v = r?.[k]; (p as Record<string, number | null>)[k] = v == null || !Number.isFinite(Number(v)) ? null : Number(v); }
    return p;
  });
}
export async function buildGapSeries<K extends string>(f: ResolvedFilters, fields: K[], query: (w: Window) => SQL): Promise<Series<K, number | null>> {
  const read = async (w: Window, keys: string[]) => nullFill(keys, await rows<{ t: string } & Partial<Record<K, unknown>>>(query(w)), fields);
  const [points, prev] = await Promise.all([read(f.cur, f.keys), f.prev && f.prevKeys ? read(f.prev, f.prevKeys) : null]);
  return { fields, points, prev };
}
export const bucketOf = (col: SQL | { _: unknown } | string, f: ResolvedFilters) => bucketSql(col, f.bucket);

/** `col` as seconds between two timestamps (`b − a`). */
export const secsBetween = (a: SQL | { _: unknown }, b: SQL | { _: unknown }): SQL => sql`extract(epoch from (${b as SQL} - ${a as SQL}))`;
/** `a, b, c` as a SQL list of parameters (for `in (...)`). */
export const sqlList = (xs: string[]): SQL => sql.join(xs.map((x) => sql`${x}`), sql`, `);

/** Display names of accounts (companies, offices, drivers) by id: company / office name when there is one, the person's name otherwise. */
export async function namesOf(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return out;
  const r = await rows<{ id: string; name: string }>(sql`
    select u.id, coalesce(bp.company_name, op.office_name, u.name) as name from ${users} u
    left join business_profiles bp on bp.user_id = u.id left join office_profiles op on op.user_id = u.id where ${inArray(sql`u.id`, uniq)}`);
  for (const x of r) out.set(String(x.id), String(x.name ?? ""));
  return out;
}

/** Windows of a series for the sparkline of a ratio: null where the denominator is 0 (a gap, not 0%). */
export const perBucket = (n: number[], d: number[]): Array<number | null> => n.map((v, i) => safeDiv(v, d[i]));

/**
 * Fault isolation (G11): every section of a report is an independent query. `safe(name, promise, fallback)` turns a failure (a timeout, a bad row) into the section's empty
 * fallback and records its name in `failed`, so one slow query leaves a gap in the page instead of replacing the whole report with an error. The response says which sections failed
 * (`meta.failed`) and the page shows a notice; the report is never "empty" because of a failure.
 */
export function sectionGuard() {
  const failed: string[] = [];
  return {
    failed,
    async safe<T>(name: string, p: Promise<T>, fallback: T): Promise<T> {
      try { return await p; } catch (e) { failed.push(name); logError(e, { correlationId: `analytics:${name}` }); return fallback; }
    },
  };
}
/** Facts of a failed section: every measure is "no data" (null) for both periods; `extra` carries the non-pair parts (histograms, lists) the report reads. */
export function emptyPairs<X extends object = object>(extra: X = {} as X): Record<string, Pair> & X {
  return new Proxy({ ...extra } as Record<string, unknown>, { get: (t, k) => (typeof k !== "string" ? undefined : k in t ? t[k] : { cur: null, prev: null }) }) as Record<string, Pair> & X;
}
/** A series of a failed section: every bucket present, zeros (counts) or gaps (measures). */
export function emptySeries<K extends string>(f: ResolvedFilters, fields: readonly K[], gaps = false): Series<K, number> {
  const pts = (keys: string[]) => keys.map((t) => ({ t, ...Object.fromEntries(fields.map((k) => [k, gaps ? null : 0])) })) as unknown as Array<{ t: string } & Record<K, number>>;
  return { fields: [...fields], points: pts(f.keys), prev: f.prevKeys ? pts(f.prevKeys) : null };
}
