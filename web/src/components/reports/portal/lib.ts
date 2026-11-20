import type { Locale } from "@/i18n/core";
import { fmtMoney } from "@/lib/format";
import type { Insight } from "@/server/analytics/portal-insights";
import type { HistBucket } from "@/server/analytics/stats";
import type { BarRow } from "../BarRows";
import { fmtDur, fmtPercent, formatValue } from "../chartTheme";
import type { Slice } from "../DonutChart";
import type { FunnelStep } from "../FunnelChart";
import type { HistogramBucket } from "../HistogramChart";
import { dimLabel, type Dim } from "../overview-lib";

/** Pure helpers that turn portal responses into component props (unit-tested in tests/unit/portal-reports-lib.test.ts; no React, no fetching). */
export type T = (key: string, vars?: Record<string, string | number>) => string;
type CityName = (key: string) => string | undefined;

export interface GroupRow { key: string; requests?: number; prevRequests?: number | null; spend?: number; prevSpend?: number | null; jobs?: number; prevJobs?: number | null; earned?: number; prevEarned?: number | null; share: number | null }
export type Measure = "requests" | "spend" | "jobs" | "earned";
const VALUE: Record<Measure, (r: GroupRow) => number> = { requests: (r) => r.requests ?? 0, spend: (r) => r.spend ?? 0, jobs: (r) => r.jobs ?? 0, earned: (r) => r.earned ?? 0 };
const PREV: Record<Measure, (r: GroupRow) => number | null | undefined> = { requests: (r) => r.prevRequests, spend: (r) => r.prevSpend, jobs: (r) => r.prevJobs, earned: (r) => r.prevEarned };

/** The label of a group key in the viewer's language. A company key (`C-3F9A`, an office's anonymous customer) is shown as it is, prefixed with the word "Company". */
export function groupLabel(dim: Dim | "company", key: string, t: T, cityName?: CityName): string {
  if (dim === "company") return t("rpr.anon_company", { id: key });
  return dimLabel(dim, key, t, cityName);
}
/** Rows for a BreakdownTable / RankedList of one measure; `sub` optionally carries a second measure formatted in the viewer's language. */
export function groupRows(rows: GroupRow[], dim: Dim | "company", measure: Measure, t: T, cityName?: CityName, sub?: (r: GroupRow) => string | undefined): BarRow[] {
  return rows.map((r) => ({ key: r.key || "—", label: groupLabel(dim, r.key, t, cityName), value: VALUE[measure](r), prev: PREV[measure](r), share: r.share, sub: sub?.(r) }));
}
/** The `n` rows with the largest value (a ranked list stays readable however many customers an office serves); rows without a value are not ranked. */
export const topRows = (rows: BarRow[], n = 10): BarRow[] => rows.filter((r) => (r.value ?? 0) > 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, n);
export const groupSlices = (rows: GroupRow[], dim: Dim | "company", measure: Measure, t: T, cityName?: CityName): Slice[] =>
  rows.map((r) => ({ key: r.key || "—", label: groupLabel(dim, r.key, t, cityName), value: VALUE[measure](r) }));

/** Failure reasons: the label is the stop-failure dictionary (`stopfail.<reason>`); an unknown reason shows as written. */
export function reasonLabel(key: string, t: T): string { const k = `stopfail.${key}`, s = t(k); return s !== k ? s : key; }
export const reasonRows = (rows: Array<{ key: string; count: number; prev: number | null }>, t: T): BarRow[] => {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return rows.map((r) => ({ key: r.key, label: reasonLabel(r.key, t), value: r.count, prev: r.prev, share: total > 0 ? r.count / total : null, tone: "danger" as const }));
};
export const reasonSlices = (rows: Array<{ key: string; count: number }>, t: T): Slice[] => rows.map((r) => ({ key: r.key, label: reasonLabel(r.key, t), value: r.count }));
export const proofSlices = (rows: Array<{ key: string; n: number }>, t: T): Slice[] => rows.map((r) => ({ key: r.key, label: t(`rpr.proof.${r.key}`), value: r.n }));
export const smsSlices = (rows: Array<{ key: string; n: number }>, t: T): Slice[] => rows.map((r) => ({ key: r.key, label: t(`rpr.sms_${r.key}`) === `rpr.sms_${r.key}` ? r.key : t(`rpr.sms_${r.key}`), value: r.n }));

/** Cities ranked by failure rate (the share of resolved parcels that failed or came back). Cities under `minVolume` resolved parcels are listed last and marked, never ranked. */
export const MIN_CITY_VOLUME = 5;
export function cityFailureRows(rows: Array<{ key: string; resolved: number; failed: number; prevResolved: number | null; prevFailed: number | null }>, t: T, cityName?: CityName): BarRow[] {
  const rate = (f: number, r: number) => (r > 0 ? f / r : null);
  const ok = rows.filter((r) => r.resolved >= MIN_CITY_VOLUME).sort((a, b) => (b.failed / b.resolved) - (a.failed / a.resolved) || b.resolved - a.resolved);
  const low = rows.filter((r) => r.resolved < MIN_CITY_VOLUME && r.resolved > 0).sort((a, b) => b.resolved - a.resolved);
  return [...ok, ...low].map((r) => ({
    key: r.key || "—", label: dimLabel("city", r.key, t, cityName), value: rate(r.failed, r.resolved), prev: r.prevResolved != null ? rate(r.prevFailed ?? 0, r.prevResolved) : undefined,
    sub: r.resolved < MIN_CITY_VOLUME ? t("rpr.low_volume", { n: r.resolved }) : t("rpr.n_of_m", { n: r.failed, m: r.resolved }), tone: r.resolved < MIN_CITY_VOLUME ? ("gold" as const) : ("danger" as const),
  }));
}

/** Labels of a histogram from its edges: `< x`, `x – y`, `≥ z`, with `fmt` formatting an edge (a duration, a percentage, a rating, a count). */
export function histBuckets(h: HistBucket[], fmt: (n: number) => string, t: T): HistogramBucket[] {
  return h.map((b) => ({ count: b.count, label: b.from == null ? t("rpf.hist_lt", { to: fmt(b.to!) }) : b.to == null ? t("rpf.hist_gte", { from: fmt(b.from) }) : t("rpf.hist_range", { from: fmt(b.from), to: fmt(b.to) }) }));
}
export const durationBuckets = (h: HistBucket[], t: T, l: Locale) => histBuckets(h, (n) => fmtDur(n, l), t);
export const percentBuckets = (h: HistBucket[], t: T, l: Locale) => histBuckets(h, (n) => fmtPercent(n, l, 0), t);
/** Whole-number buckets read as inclusive ranges: `0`, `1`, `2–4`, `5–9`, `10+` (the edges are exclusive upper bounds, so `[1, 2)` is just 1). */
export function countBuckets(h: HistBucket[], t: T, l: Locale): HistogramBucket[] {
  const n = (v: number) => formatValue(v, "number", l);
  return h.map((b) => {
    const from = b.from ?? 0;
    if (b.to == null) return { count: b.count, label: t("rpf.hist_gte", { from: n(from) }) };
    const last = b.to - 1;
    return { count: b.count, label: last <= from ? n(from) : `${n(from)}–${n(last)}` };
  });
}
export const ratingBuckets = (h: HistBucket[], t: T, l: Locale) => histBuckets(h, (n) => formatValue(n, "rate", l), t);

export const funnelOf = (steps: Array<{ key: string; count: number }>, prefix: string, t: T): FunnelStep[] => steps.map((s) => ({ key: s.key, label: t(`${prefix}${s.key}`), count: s.count }));

/** The sentence of an insight in the viewer's language: `refs` are translated first, amounts (`money`) are formatted as money. */
export function insightText(i: Insight, t: T, l: Locale, cityName?: CityName): string {
  const vars: Record<string, string | number> = { ...i.vars };
  for (const k of i.money ?? []) vars[k] = fmtMoney(Number(vars[k]), l);
  for (const [k, v] of Object.entries(i.refs ?? {})) vars[k] = ref(v, t, cityName);
  return t(i.key, vars);
}
/** A `refs` value is a dictionary key; a city the dictionary does not know falls back to the city names of Settings, anything else to its raw key part. */
function ref(key: string, t: T, cityName?: CityName): string {
  const s = t(key);
  if (s !== key) return s;
  const raw = key.slice(key.indexOf(".") + 1);
  return (key.startsWith("city.") ? cityName?.(raw) : undefined) ?? raw;
}

/** Names of the coaching flags (keys of `rpr.flag_*`) with the threshold shown next to them. */
export const FLAG_KEYS = ["low_success", "late", "no_shows", "cancellations", "low_rating", "low_acceptance", "idle"] as const;
export const pct = (v: number | null | undefined, l: Locale, digits = 0) => (v == null ? "—" : fmtPercent(v, l, digits));
