import type { Locale } from "@/i18n/core";
import type { Point } from "@/server/analytics/buckets";
import type { HistBucket } from "@/server/analytics/stats";
import type { Kpi } from "@/server/analytics/kpi";
import { OFFER_OUTCOMES, OPS_HEADLINE, OPS_KPI_GROUPS, type OpsGroup } from "@/server/analytics/ops-kinds";
import type { BarRow } from "../BarRows";
import { fmtDur, seriesColor, STATUS_COLOR } from "../chartTheme";
import type { Slice } from "../DonutChart";
import type { HistogramBucket } from "../HistogramChart";
import type { TrendPoint } from "../TrendChart";

/** Pure helpers that turn the Operations / Geography responses into component props (unit-tested; no React). */
export type T = (key: string, vars?: Record<string, string | number>) => string;
type Series<K extends string> = { points: Array<Point<K>>; prev: Array<Point<K>> | null };

/**
 * The KPIs of one section of the Operations page, in the section's order (a KPI whose facts failed is simply absent). The headline KPIs sit in the row at the top of the
 * page, so the sections do not repeat them (a KPI card exists once per page).
 */
export const kpisOf = (kpis: Kpi[], group: OpsGroup): Kpi[] => OPS_KPI_GROUPS[group].filter((k) => !(OPS_HEADLINE as readonly string[]).includes(k)).map((k) => kpis.find((x) => x.key === k)).filter((x): x is Kpi => !!x);
export const pickKpis = (kpis: Kpi[], keys: readonly string[]): Kpi[] => keys.map((k) => kpis.find((x) => x.key === k)).filter((x): x is Kpi => !!x);

/** The query names (`meta.failed`) behind each section of the page: a section is "failed" when any of them is listed. */
export const SECTION_QUERIES: Record<OpsGroup | "groups", readonly string[]> = {
  demand: ["demand", "speed", "demandSeries"], execution: ["execution", "stops", "loading", "executionSeries", "pressure"], offers: ["offers"],
  supply: ["supply", "supplySeries", "supplyCities"], cancellations: ["cancel", "policy", "cancelSeries", "cancelDetail", "cancelRankings"], groups: ["breakdowns", "companies", "drivers"],
};
export const sectionFailed = (failed: string[] | undefined, section: keyof typeof SECTION_QUERIES) => (failed ?? []).some((f) => SECTION_QUERIES[section].includes(f));

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);
/** Requests per bucket plus the fill rate (slots filled ÷ slots asked) as a line; buckets with no slots have no rate (a gap, not 0 %). */
export function demandPoints(s: Series<"created" | "slots" | "filled" | "published" | "completed" | "active" | "cancelled" | "expired">): { data: TrendPoint[]; prev: TrendPoint[] | null } {
  const f = (p: Point<"created" | "slots" | "filled" | "published" | "completed" | "active" | "cancelled" | "expired">): TrendPoint => ({ ...p, fill_rate: ratio(p.filled, p.slots) });
  return { data: s.points.map(f), prev: s.prev ? s.prev.map(f) : null };
}
/** Jobs due per bucket with the on-time rate as a line (null when nothing was due). */
export function execPoints(s: Series<"due" | "on_time" | "no_show">): { data: TrendPoint[]; prev: TrendPoint[] | null } {
  const f = (p: Point<"due" | "on_time" | "no_show">): TrendPoint => ({ ...p, late: Math.max(0, p.due - p.on_time - p.no_show), on_time_rate: ratio(p.on_time, p.due) });
  return { data: s.points.map(f), prev: s.prev ? s.prev.map(f) : null };
}

const dur = (v: number, l: Locale) => fmtDur(v, l);
const label = (b: HistBucket, t: T, l: Locale): string =>
  b.from == null ? t("rpf.hist_lt", { to: dur(b.to!, l) }) : b.to == null ? t("rpf.hist_gte", { from: dur(b.from, l) }) : t("rpf.hist_range", { from: dur(b.from, l), to: dur(b.to, l) });
/** Labels for a duration histogram (seconds): `Under 1 min`, `1 min – 5 min`, … `2 h or more`. */
export const durationBuckets = (h: HistBucket[], t: T, l: Locale): HistogramBucket[] => h.map((b) => ({ count: b.count, label: label(b, t, l) }));
/** Histograms whose first bucket is a special case (on time / after the start) and whose second starts at zero: "Under {to}" instead of "0 s – {to}". */
const withHead = (head: string) => (h: HistBucket[], t: T, l: Locale): HistogramBucket[] =>
  h.map((b, i) => ({ count: b.count, label: i === 0 ? head : i === 1 && b.to != null ? t("rpf.hist_lt", { to: dur(b.to, l) }) : label(b, t, l) }));
/** The lateness histogram: its first bucket is "on or before the start time", the others are minutes late. */
export const lateBuckets = (h: HistBucket[], t: T, l: Locale): HistogramBucket[] => withHead(t("rpo.late_none"))(h, t, l);
/** The lead-time histogram (seconds BEFORE the start): its first bucket is "after the start time". */
export const leadBuckets = (h: HistBucket[], t: T, l: Locale): HistogramBucket[] => withHead(t("rpo.lead_after"))(h, t, l);

export const funnelLabel = (key: string, t: T) => t(`rpo.fn_${key}`);
export const OUTCOME_COLOR: Record<string, string> = { completed: STATUS_COLOR.completed, active: seriesColor(7), rejected: seriesColor(1), expired: seriesColor(5), cancelled: seriesColor(3), no_show: seriesColor(6), replaced: seriesColor(2), request_ended: seriesColor(4) };
/** Slices of "where the offers ended" in the fixed order of `OFFER_OUTCOMES`. */
export const outcomeSlices = (rows: Array<{ key: string; count: number }>, t: T): Slice[] => OFFER_OUTCOMES.map((k) => ({ key: k, label: t(`rpo.out_${k}`), value: rows.find((r) => r.key === k)?.count ?? 0, color: OUTCOME_COLOR[k] }));
export const PARTY_COLOR: Record<string, string> = { business: seriesColor(0), driver: seriesColor(3), platform: seriesColor(1) };
export const partySlices = (rows: Array<{ key: string; count: number }>, t: T): Slice[] => rows.map((r) => ({ key: r.key, label: t(`rpo.party.${r.key}`), value: r.count, color: PARTY_COLOR[r.key] }));
export const stageSlices = (rows: Array<{ key: string; count: number }>, t: T): Slice[] => rows.map((r, i) => ({ key: r.key, label: t(`rpo.stage.${r.key}`), value: r.count, color: seriesColor(i === 0 ? 4 : i === 1 ? 1 : i === 2 ? 5 : 3) }));
export const kindSlices = (rows: Array<{ key: string; count: number }>, t: T): Slice[] => rows.map((r, i) => ({ key: r.key, label: t(`rpo.kind.${r.key}`), value: r.count, color: seriesColor([0, 3, 6, 1][i] ?? i) }));

/** The text of a cancellation reason: a platform reason code gets its sentence, an empty one "No reason given", free text stays as typed. */
export function reasonLabel(reason: string, t: T): string {
  if (!reason) return t("rpo.reason_none");
  const k = `rpo.reason.${reason}`, s = t(k);
  return s !== k ? s : reason;
}
export const reasonRows = (rows: Array<{ reason: string; count: number }>, t: T): BarRow[] => rows.map((r, i) => ({ key: `${i}:${r.reason}`, label: reasonLabel(r.reason, t), value: r.count }));

/** Per-dimension label: city / service / vehicle keys in the dictionary, the empty vehicle as "Not specified". */
export function dimKey(dim: "city" | "service" | "vehicle", key: string, t: T, cityName?: (k: string) => string | undefined): string {
  if (!key) return t("rpf.not_specified");
  const ns = dim === "city" ? "city." : dim === "service" ? "svc." : "vehicle.", k = `${ns}${key}`, s = t(k);
  return s !== k ? s : (dim === "city" ? cityName?.(key) : undefined) ?? key;
}
