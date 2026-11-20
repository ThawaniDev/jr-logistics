/** Pure helpers of the company detail sections (KPI strip, alerts, charts, parcels filters): no React, unit-tested in tests/unit/details3-company.test.ts. */
import type { Locale } from "@/i18n/core";
import { fmtSignedPct, fmtSignedPp, formatValue, type ValueFormat } from "@/components/reports/chartTheme";
import { deltaPctOf } from "@/server/analytics/kpi";
import type { CompanyAlert, CompanyPeriod } from "@/server/details-pure";
import { COMPANY_PERIODS } from "@/server/details-pure";
import type { CompanyKpi, CompanyKpiKey } from "@/server/details-companies";

export { COMPANY_PERIODS };
export const parsePeriod = (v: string | null | undefined): CompanyPeriod => ((COMPANY_PERIODS as readonly string[]).includes(v ?? "") ? (v as CompanyPeriod) : "30d");

/** Where each KPI tile belongs on the strip (the three rows) and which tab its tile links to. */
export const KPI_GROUPS: Array<{ id: "activity" | "money" | "now"; keys: CompanyKpiKey[] }> = [
  { id: "activity", keys: ["orders", "parcels", "success", "cancellation", "on_time", "frequency"] },
  { id: "money", keys: ["spend", "aov", "cod"] },
  { id: "now", keys: ["support", "health"] },
];
export const KPI_TAB: Partial<Record<CompanyKpiKey, "orders" | "parcels" | "finance" | "support">> = { orders: "orders", parcels: "parcels", success: "parcels", spend: "finance", aov: "finance", cod: "finance", support: "support" };

const FORMAT: Record<CompanyKpi["unit"], ValueFormat> = { count: "number", money: "money", percent: "percent", rate: "rate", score: "number" };
/** The number as the tile shows it (`—` when there is no data, never 0%). */
export const kpiText = (k: Pick<CompanyKpi, "unit" | "value">, locale: Locale) => (k.unit === "score" && k.value != null ? `${formatValue(k.value, "number", locale)}/100` : formatValue(k.value, FORMAT[k.unit], locale));

export interface Delta { dir: "up" | "down" | "flat"; tone: "good" | "bad" | "flat"; text: string; isNew?: boolean }
/** The change against the previous period: relative for counts, money and rates, percentage points for percentages; null when either side has no data. */
export function kpiDelta(k: Pick<CompanyKpi, "unit" | "value" | "prev" | "good">, locale: Locale): Delta | null {
  if (k.value == null || k.prev == null) return null;
  const diff = k.value - k.prev;
  if (k.unit === "percent") {
    const dir = Math.abs(diff) < 1e-9 ? "flat" : diff > 0 ? "up" : "down";
    return { dir, tone: toneOf(dir, k.good), text: dir === "flat" ? "0" : fmtSignedPp(diff, locale) };
  }
  const pct = deltaPctOf(k.value, k.prev);
  if (pct == null) return diff === 0 ? { dir: "flat", tone: "flat", text: "0%" } : { dir: diff > 0 ? "up" : "down", tone: toneOf(diff > 0 ? "up" : "down", k.good), text: "", isNew: true };
  const dir = pct === 0 ? "flat" : pct > 0 ? "up" : "down";
  return { dir, tone: toneOf(dir, k.good), text: fmtSignedPct(pct, locale) };
}
const toneOf = (dir: "up" | "down" | "flat", good: CompanyKpi["good"]): Delta["tone"] => (dir === "flat" || good === "neutral" ? "flat" : (dir === "up") === (good === "higher") ? "good" : "bad");

/** i18n keys of a KPI: label, definition, and the numerator / denominator sentence when it is a ratio. */
export const kpiKeys = (key: CompanyKpiKey) => ({ label: `dv3.k_${key}`, def: `dv3.d_${key}`, num: ["success", "cancellation", "on_time"].includes(key) ? `dv3.dn_${key}` : null, den: ["success", "cancellation", "on_time"].includes(key) ? `dv3.dd_${key}` : null });
export const ALL_KPI_KEYS: CompanyKpiKey[] = ["orders", "parcels", "success", "cancellation", "on_time", "spend", "aov", "cod", "wallet", "frequency", "support", "health"];

/** The i18n key and variables of one alert (the money in the variables is formatted by the caller). */
export const alertKey = (a: Pick<CompanyAlert, "params"> & { key: string }) => `dv3.al_${a.key}${a.key === "wallet_low" && !a.params.ref ? "_avg" : ""}`;
export const ALERT_KEYS = ["no_orders", "never_ordered", "wallet_low", "wallet_low_avg", "failure_up", "cancel_up", "credit_high", "integration_errors", "sla_breached"] as const;

/** Parcel list filters as the URL carries them → API query (empty values dropped). */
export function parcelQuery(o: { status?: string; city?: string; q?: string; from?: string; to?: string; cod?: string; page?: number; pageSize?: number; format?: "csv" }): string {
  const p = new URLSearchParams();
  for (const k of ["status", "city", "q", "from", "to", "cod"] as const) { const v = o[k]?.trim(); if (v && v !== "all") p.set(k, v); }
  if (o.page && o.page > 1) p.set("page", String(o.page));
  if (o.pageSize) p.set("pageSize", String(o.pageSize));
  if (o.format) p.set("format", o.format);
  const s = p.toString();
  return s ? `?${s}` : "";
}
export const PARCEL_STATUSES = ["pending", "loaded", "delivered", "failed", "returned", "missing", "cancelled"] as const;

/** Seconds as a short "3 h 20 min" text without needing the report kit (for SLA clocks): the shared formatter lives in the reports kit. */
export { fmtDur } from "@/components/reports/chartTheme";
