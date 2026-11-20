import type { Locale } from "@/i18n/core";
import type { BarRow } from "./BarRows";
import { fmtDur, formatValue, STATUS_COLOR } from "./chartTheme";
import type { Slice } from "./DonutChart";
import type { FunnelStep } from "./FunnelChart";
import type { HistogramBucket } from "./HistogramChart";
import type { OverviewData } from "./types";

/** Pure helpers that turn the Overview response into component props (unit-tested; no React). */
type T = (key: string, vars?: Record<string, string | number>) => string;
export type Dim = keyof OverviewData["breakdowns"];
type BdRow = OverviewData["breakdowns"][Dim][number];
const NS: Record<Dim, string> = { city: "city.", service: "svc.", vehicle: "vehicle.", channel: "rpf.ch_" };

/** The label of a breakdown key in the viewer's language: a catalog namespace, the city names from Settings for custom cities, "Not specified" for an empty key. */
export function dimLabel(dim: Dim, key: string, t: T, cityName?: (key: string) => string | undefined): string {
  if (!key) return t("rpf.not_specified");
  const k = `${NS[dim]}${key}`, s = t(k);
  return s !== k ? s : (dim === "city" ? cityName?.(key) : undefined) ?? key;
}
/** Rows for BreakdownTable: requests (with their share and change); finance viewers also get the billed amount as the sub-line. */
export function breakdownRows(rows: BdRow[], dim: Dim, t: T, locale: Locale, cityName?: (key: string) => string | undefined): BarRow[] {
  return rows.map((r) => ({
    key: r.key || "—", label: dimLabel(dim, r.key, t, cityName), value: r.requests, prev: r.prevRequests, share: r.share,
    sub: r.gmv != null ? t("rpf.bd_billed", { value: formatValue(r.gmv, "money", locale) }) : undefined,
  }));
}
/** Slices for a DonutChart of the same rows (requests, or the billed amount with `by: "gmv"`). */
export function breakdownSlices(rows: BdRow[], dim: Dim, t: T, by: "requests" | "gmv" = "requests", cityName?: (key: string) => string | undefined): Slice[] {
  return rows.map((r) => ({ key: r.key || "—", label: dimLabel(dim, r.key, t, cityName), value: by === "gmv" ? r.gmv ?? 0 : r.requests }));
}
export const funnelSteps = (funnel: OverviewData["funnel"], t: T): FunnelStep[] => funnel.map((s) => ({ key: s.key, label: t(`rpf.fn_${s.key}`), count: s.count }));

/** Labels for the time-to-fill histogram from its edges: `< 15 min`, `15 min – 30 min`, … `≥ 24 h`. */
export function fillBuckets(h: OverviewData["fill"]["histogram"], t: T, locale: Locale): HistogramBucket[] {
  return h.map((b) => ({
    count: b.count,
    label: b.from == null ? t("rpf.hist_lt", { to: fmtDur(b.to!, locale) }) : b.to == null ? t("rpf.hist_gte", { from: fmtDur(b.from, locale) }) : t("rpf.hist_range", { from: fmtDur(b.from, locale), to: fmtDur(b.to, locale) }),
  }));
}
/** Series definitions (key, i18n label, fixed colour) of the stacked requests and parcels charts. */
export const REQUEST_SERIES = ["completed", "active", "cancelled", "expired"] as const;
export const PARCEL_SERIES = ["delivered", "failed", "returned"] as const;
export const statusSeries = (keys: readonly string[], t: T) => keys.map((k) => ({ key: k, label: t(`rpf.s_${k}`), color: STATUS_COLOR[k] }));
