import type { Locale } from "@/i18n/core";
import type { HistogramBucket } from "../HistogramChart";
import type { BarRow } from "../BarRows";
import type { Slice } from "../DonutChart";
import { fmtDur, fmtMoneyCompact, formatValue, seriesColor, type ValueFormat } from "../chartTheme";
import type { TrendPoint } from "../TrendChart";

/** Pure mapping helpers of the people reports (companies, drivers, offices, growth): API response → component props. Unit-tested (tests/unit/people-lib.test.ts). */
export type T = (key: string, vars?: Record<string, string | number>) => string;
export interface Hist { from: number | null; to: number | null; count: number }

/** Labels for a histogram from its edges in ONE unit: `< 20`, `20 – 40`, `80 or more`. `fmt` formats an edge. */
export function histBuckets(h: Hist[], fmt: (n: number) => string, t: T): HistogramBucket[] {
  return h.map((b) => ({
    count: b.count,
    label: b.from == null ? t("rpf.hist_lt", { to: fmt(b.to!) }) : b.to == null ? t("rpf.hist_gte", { from: fmt(b.from) }) : t("rpf.hist_range", { from: fmt(b.from), to: fmt(b.to) }),
  }));
}
/** A histogram whose buckets are whole numbers (ratings 1–5, jobs per driver): `0`, `1–4`, `5+` — `to` is exclusive, so `1–4` is `[1, 5)`. */
export function intBuckets(h: Hist[]): HistogramBucket[] {
  return h.map((b) => ({
    count: b.count,
    label: b.from == null ? `< ${b.to}` : b.to == null ? `${b.from}+` : b.to - b.from <= 1 ? String(b.from) : `${b.from}–${b.to - 1}`,
  }));
}
/** Percent-band labels (`< 50%`, `50–70%`, `97%+`) from edges given as fractions. */
export function percentBuckets(h: Hist[], locale: Locale): HistogramBucket[] {
  const p = (n: number) => formatValue(n, "percent", locale, true);
  return h.map((b) => ({ count: b.count, label: b.from == null ? `< ${p(b.to!)}` : b.to == null ? `${p(b.from)}+` : `${p(b.from)} – ${p(b.to)}` }));
}
export const durBuckets = (h: Hist[], locale: Locale, t: T) => histBuckets(h, (n) => fmtDur(n, locale), t);

/** Pareto chart points: one per rank (x = rank), bars = value, line = running share of the total (0–1). */
export function paretoPoints(rows: Array<{ value: number; cumulative: number | null }>): TrendPoint[] {
  return rows.map((r, i) => ({ t: String(i + 1), value: r.value, cumulative: r.cumulative }));
}
/** Rows for a RankedList / BreakdownTable from `{ key, label, value, prev?, share? }` plus a link builder. */
export const barRows = <R extends { id: string; name: string; value: number; prev?: number | null; share?: number | null }>(rows: R[], href?: (r: R) => string, tone?: BarRow["tone"]): BarRow[] =>
  rows.map((r) => ({ key: r.id, label: r.name, value: r.value, prev: r.prev, share: r.share, href: href?.(r), tone }));
/** Slices for a donut from `{ key, value }` rows; `label` translates the key. Colours are positional. */
export const slicesOf = (rows: Array<{ key: string; value: number }>, label: (key: string) => string, colors: Record<string, string> = {}): Slice[] =>
  rows.map((r, i) => ({ key: r.key, label: label(r.key), value: r.value, color: colors[r.key] ?? seriesColor(i) }));
/** Retention percentage of one cohort cell (null when the cell is not observable yet or the cohort is empty). */
export const retention = (n: number | null, size: number): number | null => (n == null || size <= 0 ? null : Math.min(1, n / size));
/** Intensity (0–1) of a cell colour from a fraction, so 100 % is the strongest and a faint cell is still visible. */
export const heat = (v: number | null): number => (v == null ? 0 : Math.max(0.08, Math.min(1, v)));
/** `2026-03-01` → the month label in the viewer's language (the key is a Riyadh calendar month, formatted as UTC). */
export const monthLabel = (key: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale === "ur" ? "ur-PK-u-nu-latn" : "ar-SA-u-nu-latn-ca-gregory", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${key.slice(0, 10)}T00:00:00Z`));
/** Value formatting for a rank list row that may be money, a count, a percent or a duration. */
export const fmtBy = (v: number | null, kind: ValueFormat, locale: Locale): string => formatValue(v, kind, locale);
/** A star rating `4.5` with one decimal (null → "—"). */
export const stars = (v: number | null): string => (v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1));

/** Wallet balance buckets (halalas): overdrawn (using credit), empty, then SAR ranges. */
export function walletBuckets(h: Hist[], locale: Locale, t: T): HistogramBucket[] {
  const std = histBuckets(h, (n) => fmtMoneyCompact(n, locale), t);
  return std.map((b, i) => (h[i].from == null && h[i].to === 0 ? { ...b, label: t("rpp.wal_overdrawn") } : h[i].from === 0 && h[i].to === 1 ? { ...b, label: t("rpp.wal_empty") } : b));
}

/** Labels of the bands a set of ascending fraction edges makes: `< 50%`, `50% – 80%`, `95%+`. */
export function bandLabels(edges: number[], locale: Locale): string[] {
  const p = (n: number) => formatValue(n, "percent", locale, true);
  return [`< ${p(edges[0])}`, ...edges.slice(1).map((e, i) => `${p(edges[i])} – ${p(e)}`), `${p(edges[edges.length - 1])}+`];
}
/** The label of a catalogue key (a city, a vehicle) with a fallback to the raw key and "Not specified" for an empty one. */
export const keyLabel = (ns: string, key: string, t: T): string => { if (!key) return t("rpf.not_specified"); const k = `${ns}.${key}`, s = t(k); return s === k ? key : s; };
