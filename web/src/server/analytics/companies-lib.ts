import { sql, type SQL } from "drizzle-orm";
import { zeroFill, type Point } from "./buckets";
import { inWindow, type Metric } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { logError } from "@/lib/log";
import { rows } from "./guard";
import { type Good, type KpiDef, type Unit } from "./definitions";
import type { Insight } from "./insights";
import { safeDiv, type Kpi } from "./kpi";
import { windowOf, previousRange, type Window } from "./periods";

/**
 * Helpers shared by the four "people" reports (companies, drivers, offices, growth): paired numbers, the previous-period select list that is always present,
 * zero-filled series, and the pure pieces of the companies report (health score, size segments, cohorts, concentration, insights). PURE except `twin` / `seriesOf`.
 */
export type Pair = { cur: number | null; prev: number | null };
export const zeroPair = (p: Pair): Pair => ({ cur: p.cur ?? 0, prev: p.prev });
export const ratioPair = (n: Pair, d: Pair): Pair => ({ cur: safeDiv(n.cur, d.cur), prev: safeDiv(n.prev, d.prev) });
export const perPair = ratioPair;
export const sumPairs = (...p: Pair[]): Pair => ({ cur: p.reduce((s, x) => s + (x.cur ?? 0), 0), prev: p.every((x) => x.prev == null) ? null : p.reduce((s, x) => s + (x.prev ?? 0), 0) });
export const pct1 = (n: number) => Math.round(n * 1000) / 10;
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const tsz = (d: Date) => sql`${d.toISOString()}::timestamptz`;
/** The row's value as a number or null (never 0 for missing). */
export const nn = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
export const pairOf = (r: Record<string, unknown> | undefined, name: string): Pair => ({ cur: nn(r?.[`${name}_c`]), prev: nn(r?.[`${name}_p`]) });

/**
 * Like `twinSelect`, but `<name>_p` ALWAYS exists (NULL without a comparison period), so a CTE and the queries on top of it can reference both columns unconditionally.
 * Names are lower snake_case (Postgres folds unquoted aliases).
 */
export function twin(f: ResolvedFilters, metrics: Record<string, Metric>): SQL {
  const parts: SQL[] = [];
  for (const [name, m] of Object.entries(metrics)) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`twin: metric name "${name}" must be lower snake_case`);
    parts.push(sql`${m((c) => inWindow(c, f.cur))} as ${sql.raw(`${name}_c`)}`);
    parts.push(f.prev ? sql`${m((c) => inWindow(c, f.prev!))} as ${sql.raw(`${name}_p`)}` : sql`null::float8 as ${sql.raw(`${name}_p`)}`);
  }
  return sql.join(parts, sql`, `);
}
/** `coalesce(b.x_c, 0) as x_c, coalesce(b.x_p, 0) as x_p` for left-joined twin columns (the previous column stays NULL without a comparison). */
export const twinOrZero = (f: ResolvedFilters, from: string, names: string[]): SQL =>
  sql.join(names.flatMap((n) => [sql`coalesce(${sql.raw(`${from}.${n}_c`)}, 0) as ${sql.raw(`${n}_c`)}`, f.prev ? sql`coalesce(${sql.raw(`${from}.${n}_p`)}, 0) as ${sql.raw(`${n}_p`)}` : sql`null::float8 as ${sql.raw(`${n}_p`)}`]), sql`, `);

/** The window a point-in-time number is read at: the end of the period, or now when the period is still running. */
export const asOfWindow = (w: Window, now = new Date()): Date => new Date(Math.min(w.end.getTime(), now.getTime()));
/** The comparison window, or — for numbers that need a "before" even when the user switched the comparison off — the period of the same length immediately before. */
export function priorWindow(f: ResolvedFilters): Window {
  if (f.prev) return f.prev;
  const r = previousRange({ from: f.cur.from, to: f.cur.to }, f.preset);
  return windowOf(r.from, r.to);
}

export interface Series<K extends string> { fields: K[]; points: Array<Point<K>>; prev: Array<Point<K>> | null }
/** One chart series: a zero-filled point per bucket of the period and, with a comparison, of the previous period (aligned by position). `query(w)` returns `{ t, <fields…> }` rows. */
export async function seriesOf<K extends string>(f: ResolvedFilters, fields: K[], query: (w: Window) => SQL): Promise<Series<K>> {
  const read = async (w: Window, keys: string[]) => zeroFill(keys, await rows<{ t: string } & Partial<Record<K, unknown>>>(query(w)), fields);
  const [points, prev] = await Promise.all([read(f.cur, f.keys), f.prev && f.prevKeys ? read(f.prev, f.prevKeys) : null]);
  return { fields, points, prev };
}
/** Turns count series into ratio series: `{ acceptance: ["accepted", "answered"] }` → per bucket `accepted ÷ answered`, null where the denominator is 0 (a gap, never 0 %). */
export function ratioSeries<K extends string, R extends string>(s: Series<K>, defs: Record<R, [K, K]>): { fields: R[]; points: Array<{ t: string } & Record<R, number | null>>; prev: Array<{ t: string } & Record<R, number | null>> | null } {
  const map = (pts: Array<Point<K>> | null) => pts?.map((p) => ({ t: p.t, ...Object.fromEntries((Object.entries(defs) as Array<[R, [K, K]]>).map(([k, [n, d]]) => [k, safeDiv(p[n], p[d])])) }) as { t: string } & Record<R, number | null>) ?? null;
  return { fields: Object.keys(defs) as R[], points: map(s.points) ?? [], prev: map(s.prev) };
}
/** A series with a zero point per bucket (the fallback of a section that could not be computed). */
export const emptySeries = <K extends string>(f: ResolvedFilters, fields: readonly K[]): Series<K> => ({ fields: [...fields], points: zeroFill(f.keys, [], fields), prev: f.prevKeys ? zeroFill(f.prevKeys, [], fields) : null });
/**
 * Runs one section of a report. If it fails (a timeout, a bad row), the failure is logged, `title` (the i18n key of the section's title) is added to `failed`, and the
 * fallback — an empty section, or a KPI with no value — is used, so one slow query never takes the whole page down. A section the KPIs cannot do without is NOT run through this.
 */
export async function safely<T>(failed: string[], title: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try { return await run(); } catch (e) { logError(e, { correlationId: "analytics", path: `analytics/${title}` }); failed.push(title); return fallback; }
}
export const NO_PAIR: Pair = { cur: null, prev: null };
export const col = <K extends string>(s: { points: Array<Record<K, number>> }, k: K) => s.points.map((p) => p[k]);
export const perBucket = (n: number[], d: number[]) => n.map((v, i) => safeDiv(v, d[i]));
/** Keeps a KPI only when the viewer may see it (money KPIs are dropped, not zeroed) and attaches the `unfiltered` note. */
export const withUnfiltered = (k: Kpi, notFilteredBy: readonly string[] | undefined, active: readonly string[]): Kpi => {
  const u = active.filter((a) => (notFilteredBy ?? []).includes(a));
  return u.length ? { ...k, unfiltered: u } : k;
};

/** KPI registry helper: label / definition / numerator / denominator keys follow `<prefix>.kpi_<key>`, `.def_<key>`, `.def_<key>_n`, `.def_<key>_d` (see ANALYTICS.md §6). */
export const kdef = (prefix: string) => (key: string, unit: Unit, good: Good, o: Partial<KpiDef> & { ratio?: boolean } = {}): KpiDef => {
  const { ratio, ...rest } = o;
  return { key, unit, good, label: `${prefix}.kpi_${key}`, definition: `${prefix}.def_${key}`, ...(ratio ? { numerator: `${prefix}.def_${key}_n`, denominator: `${prefix}.def_${key}_d` } : {}), ...rest };
};

// ───────── Companies: health score, segments, concentration, cohorts ─────────
/**
 * Company health score (0–100), shown to the user as a formula. Each component is 0–1 and weighted; a component that has no data (no resolved parcels, no requests)
 * is left out and the weights of the others are rescaled, so a missing number never counts as a zero.
 *   recency   max(0, 1 − days since the last request ÷ 60)               frequency  min(1, requests per 30 days ÷ 4)
 *   success   delivered ÷ (delivered + failed + returned) parcels        cancel     1 − cancelled ÷ requests
 *   support   1 − min(1, tickets and complaints opened ÷ max(1, requests))
 */
export const HEALTH = { recency: 30, frequency: 20, success: 25, cancel: 15, support: 10, silentDays: 60, ordersPer30d: 4, healthy: 70, watch: 40 } as const;
export const HEALTH_EDGES = [20, 40, 60, 80];
export function healthScore(p: { silentDays: number | null; orders: number; days: number; delivered: number; resolved: number; cancelled: number; issues: number }): number | null {
  if (p.silentDays == null) return null;
  const rec = Math.max(0, 1 - p.silentDays / HEALTH.silentDays), freq = Math.min(1, p.orders / ((p.days / 30) * HEALTH.ordersPer30d));
  const succ = p.resolved > 0 ? p.delivered / p.resolved : null, canc = p.orders > 0 ? 1 - p.cancelled / p.orders : null;
  const supp = 1 - Math.min(1, p.issues / Math.max(1, p.orders));
  const num = HEALTH.recency * rec + HEALTH.frequency * freq + (succ == null ? 0 : HEALTH.success * succ) + (canc == null ? 0 : HEALTH.cancel * canc) + HEALTH.support * supp;
  const den = HEALTH.recency + HEALTH.frequency + HEALTH.support + (succ == null ? 0 : HEALTH.success) + (canc == null ? 0 : HEALTH.cancel);
  return Math.round((100 * num) / den);
}
export const healthBand = (score: number | null): "healthy" | "watch" | "risk" | null => (score == null ? null : score >= HEALTH.healthy ? "healthy" : score >= HEALTH.watch ? "watch" : "risk");
/** The same formula in SQL, over the columns `silent_c, req_c, succ_c, canc_c, iss_c` (see companies-sql.ts). Built from the constants above so the two cannot drift. */
export const healthSql = (days: number): SQL => {
  const W = HEALTH, r = (n: number) => sql.raw(String(n));
  return sql`case when silent_c is null then null else round(100 * (
    ${r(W.recency)} * greatest(0, 1 - silent_c / ${r(W.silentDays)}.0) + ${r(W.frequency)} * least(1, req_c / (${r(days)}.0 / 30 * ${r(W.ordersPer30d)}))
    + coalesce(${r(W.success)} * succ_c, 0) + coalesce(${r(W.cancel)} * (1 - canc_c::float8 / nullif(req_c, 0)), 0) + ${r(W.support)} * (1 - least(1, iss_c::float8 / greatest(req_c, 1)))
  ) / (${r(W.recency + W.frequency + W.support)} + case when succ_c is null then 0 else ${r(W.success)} end + case when req_c > 0 then ${r(W.cancel)} else 0 end))::int end`;
};

/** Parcels per 30 days that separate small, medium and large companies. */
export const SEGMENT_EDGES = { medium: 100, large: 500 } as const;
export const SEGMENTS = ["small", "medium", "large"] as const;
export type Segment = (typeof SEGMENTS)[number];
export const segmentOf = (parcelsPer30d: number): Segment => (parcelsPer30d >= SEGMENT_EDGES.large ? "large" : parcelsPer30d >= SEGMENT_EDGES.medium ? "medium" : "small");
export const segmentSql = (days: number): SQL => sql`case when reg_c * 30.0 / ${sql.raw(String(days))} >= ${sql.raw(String(SEGMENT_EDGES.large))} then 'large' when reg_c * 30.0 / ${sql.raw(String(days))} >= ${sql.raw(String(SEGMENT_EDGES.medium))} then 'medium' else 'small' end`;

/** Silent for this many days (as of the end of the period) after the last request. */
export const RISK = { atRiskFrom: 14, churnDays: [30, 60, 90] as const, minOrders: 2 } as const;

export interface ParetoRow { id: string; name: string; value: number; share: number | null; cumulative: number | null }
/** Top-N rows with their share of the TOTAL and the running share (0–1); null shares when the total is 0. */
export function pareto(rowsIn: Array<{ id: string; name: string; value: number }>, total: number): ParetoRow[] {
  let run = 0;
  return rowsIn.map((r) => { run += r.value; return { ...r, share: total > 0 ? r.value / total : null, cumulative: total > 0 ? Math.min(1, run / total) : null }; });
}

export interface CohortRow { cohort: string; size: number; cells: Array<number | null> }
/**
 * Retention matrix from `(cohort month key, months since signup k, companies that ordered in month cohort + k)` triples and `k = -1` size rows. `months` = every cohort
 * month key (`YYYY-MM-01`), oldest first. Cells beyond the last month of the period are null (not yet observable), never 0.
 */
export function buildCohorts(raw: Array<{ cohort: string; k: number; n: number }>, months: string[]): { rows: CohortRow[]; maxK: number } {
  const size = new Map<string, number>(), cell = new Map<string, number>();
  for (const r of raw) { if (r.k < 0) size.set(r.cohort, r.n); else cell.set(`${r.cohort}|${r.k}`, r.n); }
  const maxK = Math.max(0, months.length - 1);
  return { maxK, rows: months.map((m, i) => ({ cohort: m, size: size.get(m) ?? 0, cells: Array.from({ length: maxK + 1 }, (_, k) => (k > months.length - 1 - i ? null : cell.get(`${m}|${k}`) ?? 0)) })) };
}

export interface CompanyInsightInput {
  active: Pair; churned: Pair; atRisk: Pair; newCompanies: Pair; returning: Pair; repeat: Pair; apiShare: Pair; creditUtil: number | null; verified: number | null; activeCount: number;
  top: { name: string; id: string; share: number } | null; top10Share: number | null; lowHealth: number; liveCount: number; unverified: number;
}
/** Plain-language observations about the companies report (keys `rpp.ins_*`; `href` is a filtered list). */
export function companyInsights(i: CompanyInsightInput): Insight[] {
  const out: Insight[] = [];
  if (i.activeCount < 3) out.push({ key: "rpp.ins_sparse", tone: "info", vars: { n: i.activeCount } });
  if (i.top && i.top.share >= 0.4 && i.activeCount > 1) out.push({ key: "rpp.ins_top_company", tone: "info", vars: { name: i.top.name, n: pct1(i.top.share) }, href: `/admin/companies/${i.top.id}` });
  if (i.top10Share != null && i.activeCount > 10 && i.top10Share >= 0.8) out.push({ key: "rpp.ins_top10", tone: "info", vars: { n: pct1(i.top10Share) } });
  if ((i.churned.cur ?? 0) > 0 && i.churned.prev != null && (i.churned.cur ?? 0) > i.churned.prev) out.push({ key: "rpp.ins_churn_up", tone: "bad", vars: { n: (i.churned.cur ?? 0) - i.churned.prev } });
  if ((i.atRisk.cur ?? 0) > 0) out.push({ key: "rpp.ins_at_risk", tone: "bad", vars: { n: i.atRisk.cur ?? 0 } });
  if (i.activeCount >= 5 && (i.newCompanies.cur ?? 0) / i.activeCount >= 0.5) out.push({ key: "rpp.ins_mostly_new", tone: "info", vars: { n: pct1((i.newCompanies.cur ?? 0) / i.activeCount) } });
  const rep = safeDiv(i.repeat.cur, i.active.cur);
  if (rep != null && i.activeCount >= 5 && rep < 0.4) out.push({ key: "rpp.ins_repeat_low", tone: "bad", vars: { n: pct1(rep) } });
  if (i.liveCount >= 5 && i.lowHealth / i.liveCount >= 0.25) out.push({ key: "rpp.ins_health_low", tone: "bad", vars: { n: pct1(i.lowHealth / i.liveCount) } });
  if (i.apiShare.cur === 0 && i.activeCount >= 5) out.push({ key: "rpp.ins_api_none", tone: "info" });
  else if ((i.apiShare.cur ?? 0) >= 0.5) out.push({ key: "rpp.ins_api_high", tone: "good", vars: { n: pct1(i.apiShare.cur ?? 0) } });
  if (i.creditUtil != null && i.creditUtil >= 0.8) out.push({ key: "rpp.ins_credit_high", tone: "bad", vars: { n: pct1(i.creditUtil) } });
  if (i.unverified > 0) out.push({ key: "rpp.ins_unverified", tone: "bad", vars: { n: i.unverified }, href: "/admin/verification" });
  return out.slice(0, 8);
}
