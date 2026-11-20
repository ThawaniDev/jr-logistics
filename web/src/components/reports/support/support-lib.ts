import type { Locale } from "@/i18n/core";
import type { supportReport } from "@/server/analytics/support";
import { SUPPORT_GROUPS } from "@/server/analytics/support-kpis";
import { AGING_EDGES } from "@/server/analytics/support-sla";
import type { BarRow } from "../BarRows";
import { fmtDur, seriesColor } from "../chartTheme";
import type { Slice } from "../DonutChart";
import type { HistogramBucket } from "../HistogramChart";
import { fillBuckets } from "../overview-lib";
import type { Kpi } from "../types";

/** Pure helpers that turn the Support report response into component props (unit-tested; no React). */
export type SupportData = Awaited<ReturnType<typeof supportReport>>;
type T = (key: string, vars?: Record<string, string | number>) => string;
type Group = SupportData["breakdowns"]["priority"][number];

export const KPI_GROUPS = Object.keys(SUPPORT_GROUPS) as Array<keyof typeof SUPPORT_GROUPS>;
/** The KPIs of one card group, in the group's order (a KPI the viewer may not see, like the settlement amount on hold, is simply absent). */
export const kpisOf = (kpis: Kpi[], group: keyof typeof SUPPORT_GROUPS): Kpi[] => SUPPORT_GROUPS[group].map((k) => kpis.find((x) => x.key === k)).filter((k): k is Kpi => !!k);

/** The label of a group key: a dictionary namespace, with "Not specified" for an empty key and the raw key when nothing translates it. */
export function groupLabel(ns: string, key: string, t: T): string {
  if (!key) return t("rpf.not_specified");
  const k = `${ns}.${key}`, s = t(k);
  return s !== k ? s : key;
}
export const categoryLabel = (key: string, t: T) => (key === "_other" ? t("rpq.s_other") : groupLabel("ticket_cat", key, t));
/** Rows for BreakdownTable / RankedList: value, share and the comparison period's value. */
export const groupRows = (rows: Group[], ns: string, t: T): BarRow[] => rows.map((r) => ({ key: r.key || "—", label: groupLabel(ns, r.key, t), value: r.value, prev: r.prev, share: r.share }));
export const groupSlices = (rows: Group[], ns: string, t: T): Slice[] => rows.map((r) => ({ key: r.key || "—", label: groupLabel(ns, r.key, t), value: r.value }));

/** Series of the stacked "tickets by category" chart: one colour per category, the folded rest in muted. */
export const volumeSeries = (categories: string[], t: T) => categories.map((c, i) => ({ key: c, label: categoryLabel(c, t), color: c === "_other" ? "var(--jr-muted)" : seriesColor(i) }));

/** The five backlog age buckets: 0–1 d, 2–3 d, 4–7 d, 8–14 d, 15+ d (the edges are in `support-sla.ts`). */
export function agingBuckets(h: SupportData["aging"]["buckets"], t: T): HistogramBucket[] {
  return h.map((b, i) => ({ count: b.count, label: i === 0 ? t("rpq.age_range", { from: 0, to: AGING_EDGES[0] / 86_400 - 1 }) : i === h.length - 1 ? t("rpq.age_plus", { from: AGING_EDGES[i - 1] / 86_400 }) : t("rpq.age_range", { from: AGING_EDGES[i - 1] / 86_400, to: AGING_EDGES[i] / 86_400 - 1 }) }));
}
/** Labels of the resolution-time histogram (`< 1 h` … `7 d or more`), the same wording as the Overview's fill-time chart. */
export const resolutionBuckets = (h: SupportData["resolution"]["histogram"], t: T, locale: Locale) => fillBuckets(h, t, locale);
/** The 1…5 star counts as histogram columns ("1 ★" …). */
export const starBuckets = (distribution: number[], t: T): HistogramBucket[] => distribution.map((count, i) => ({ count, label: t("rpq.stars_n", { n: i + 1 }) }));

/** Average rating per bucket (null where nothing was rated: a gap, not a 0). */
export const ratingTrend = (points: Array<{ t: string; n: number; stars: number }>) => points.map((p) => ({ t: p.t, avg: p.n > 0 ? p.stars / p.n : null, n: p.n }));
/** "2 d 4 h" for an age, "Overdue by …" is the UI's job. */
export const ageText = (sec: number, locale: Locale) => fmtDur(sec, locale);
/** Where a person / company / office of the repeat-requester list is explored. */
export const roleHref = (role: string, id: string): string | undefined => (role === "business" ? `/admin/companies/${id}` : role === "driver" ? `/admin/drivers/${id}` : role === "office" ? `/admin/offices/${id}` : undefined);
/** Share of the ratings that were given by drivers vs companies (for the split line under the rating chart); null without ratings. */
export const roleAvg = (r: { n: number; avg: number | null }) => (r.n > 0 && r.avg != null ? Math.round(r.avg * 100) / 100 : null);
