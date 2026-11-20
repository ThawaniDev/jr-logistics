import { defineKpis, type KpiDef } from "./analytics/definitions";
import { makeKpi, safeDiv, type Kpi } from "./analytics/kpi";

/**
 * The KPIs of the driver and courier-office detail views (decision G8: one definition per KPI, shown as the card's tooltip).
 * Keys are `drv_*` / `ofc_*`; label / definition / numerator / denominator are `dv2.kpi_<key>`, `dv2.def_<key>`, `dv2.def_<key>_n`, `dv2.def_<key>_d`.
 */
const def = (key: string, unit: KpiDef["unit"], good: KpiDef["good"], o: { ratio?: boolean; money?: boolean } = {}): KpiDef => ({
  key, unit, good, label: `dv2.kpi_${key}`, definition: `dv2.def_${key}`, ...(o.ratio ? { numerator: `dv2.def_${key}_n`, denominator: `dv2.def_${key}_d` } : {}), ...(o.money ? { money: true } : {}),
});
export const PEOPLE_KPI_KEYS = {
  driver: ["drv_jobs", "drv_parcels", "drv_success", "drv_first_attempt", "drv_on_time", "drv_acceptance", "drv_cancels", "drv_rating", "drv_response", "drv_online", "drv_utilisation", "drv_earnings", "drv_earnings_life", "drv_cash_held"],
  office: ["ofc_drivers", "ofc_active_drivers", "ofc_new_drivers", "ofc_jobs", "ofc_parcels", "ofc_success", "ofc_on_time", "ofc_rating", "ofc_utilisation", "ofc_earnings", "ofc_paid", "ofc_pending", "ofc_agreement_age", "ofc_turnover"],
} as const;

defineKpis("people", [
  def("drv_jobs", "count", "higher"), def("drv_parcels", "count", "higher"),
  def("drv_success", "percent", "higher", { ratio: true }), def("drv_first_attempt", "percent", "higher", { ratio: true }), def("drv_on_time", "percent", "higher", { ratio: true }),
  def("drv_acceptance", "percent", "higher", { ratio: true }), def("drv_cancels", "count", "lower"), def("drv_rating", "rate", "higher", { ratio: true }),
  def("drv_response", "duration", "lower", { ratio: true }), def("drv_online", "duration", "higher"), def("drv_utilisation", "percent", "higher", { ratio: true }),
  def("drv_earnings", "money", "higher", { money: true }), def("drv_earnings_life", "money", "higher", { money: true }), def("drv_cash_held", "money", "lower", { money: true }),
  def("ofc_drivers", "count", "higher"), def("ofc_active_drivers", "count", "higher"), def("ofc_new_drivers", "count", "higher"), def("ofc_jobs", "count", "higher"), def("ofc_parcels", "count", "higher"),
  def("ofc_success", "percent", "higher", { ratio: true }), def("ofc_on_time", "percent", "higher", { ratio: true }), def("ofc_rating", "rate", "higher", { ratio: true }),
  def("ofc_utilisation", "percent", "higher", { ratio: true }), def("ofc_earnings", "money", "higher", { money: true }), def("ofc_paid", "money", "higher", { money: true }),
  def("ofc_pending", "money", "lower", { money: true }), def("ofc_agreement_age", "duration", "neutral"), def("ofc_turnover", "percent", "lower", { ratio: true }),
]);

/** A value for the current period and for the comparison period (null = no data / no comparison). */
export interface Twin { cur: number | null; prev: number | null }
const T = (cur: number | null | undefined, prev: number | null | undefined): Twin => ({ cur: cur ?? null, prev: prev ?? null });
const ratio = (n: Twin, d: Twin): Twin => ({ cur: safeDiv(n.cur, d.cur), prev: safeDiv(n.prev, d.prev) });
const k = (key: string, t: Twin, extra: Partial<Pick<Kpi, "spark" | "parts" | "href">> = {}) => makeKpi(key, t.cur, t.prev, extra);

export interface DriverFacts {
  jobs: Twin; parcels: Twin; delivered: Twin; outcomes: Twin; firstAttempt: Twin;
  onTime: Twin; due: Twin; accepted: Twin; decided: Twin; cancelled: Twin; noShow: Twin;
  ratingSum: Twin; ratingCount: Twin; respSum: Twin; respCount: Twin;
  online: Twin; utilisation: Twin;
  earnings: Twin | null; earningsLife: number | null; cashHeld: number | null;
  spark?: { jobs?: Array<number | null>; parcels?: Array<number | null>; success?: Array<number | null> };
}
/**
 * The driver's KPI strip. Money KPIs are left out (not zeroed) when the viewer lacks the permission: `earnings` null = no `finance.view`, `cashHeld` null = no cash access.
 * Percentages are safe ratios (null with an empty denominator); the rating shows the average of the stars received in the period with their count as a part.
 */
export function driverKpis(f: DriverFacts): Kpi[] {
  const out: Kpi[] = [
    k("drv_jobs", f.jobs, { spark: f.spark?.jobs }), k("drv_parcels", f.parcels, { spark: f.spark?.parcels }),
    k("drv_success", ratio(f.delivered, f.outcomes), { spark: f.spark?.success }), k("drv_first_attempt", ratio(f.firstAttempt, f.delivered)), k("drv_on_time", ratio(f.onTime, f.due)),
    k("drv_acceptance", ratio(f.accepted, f.decided)),
    k("drv_cancels", T((f.cancelled.cur ?? 0) + (f.noShow.cur ?? 0), f.cancelled.prev == null && f.noShow.prev == null ? null : (f.cancelled.prev ?? 0) + (f.noShow.prev ?? 0)), { parts: [{ key: "cancelled", value: f.cancelled.cur ?? 0 }, { key: "no_show", value: f.noShow.cur ?? 0 }] }),
    k("drv_rating", ratio(f.ratingSum, f.ratingCount), { parts: [{ key: "ratings", value: f.ratingCount.cur ?? 0 }] }), k("drv_response", ratio(f.respSum, f.respCount)),
    k("drv_online", f.online), k("drv_utilisation", f.utilisation),
  ];
  if (f.earnings) out.push(k("drv_earnings", f.earnings), makeKpi("drv_earnings_life", f.earningsLife, null));
  if (f.cashHeld != null) out.push(makeKpi("drv_cash_held", f.cashHeld, null));
  return out;
}

export interface OfficeFacts {
  drivers: number; availableDrivers: number; onJobDrivers: number;
  activeDrivers: Twin; newDrivers: Twin; jobs: Twin; parcels: Twin; delivered: Twin; outcomes: Twin; onTime: Twin; due: Twin;
  ratingSum: Twin; ratingCount: Twin; utilisation: Twin;
  earnings: Twin | null; paid: Twin | null; pending: number | null;
  agreementAgeSec: number | null; churned: number | null; workedPrev: number | null;
  spark?: { jobs?: Array<number | null>; parcels?: Array<number | null>; success?: Array<number | null> };
}
/** The office's KPI strip (money KPIs only with the money permission; turnover = `churned / workedPrev`, null without a previous period). */
export function officeKpis(f: OfficeFacts): Kpi[] {
  const out: Kpi[] = [
    makeKpi("ofc_drivers", f.drivers, null, { parts: [{ key: "available", value: f.availableDrivers }, { key: "on_job", value: f.onJobDrivers }] }),
    k("ofc_active_drivers", f.activeDrivers), k("ofc_new_drivers", f.newDrivers),
    k("ofc_jobs", f.jobs, { spark: f.spark?.jobs }), k("ofc_parcels", f.parcels, { spark: f.spark?.parcels }),
    k("ofc_success", ratio(f.delivered, f.outcomes), { spark: f.spark?.success }), k("ofc_on_time", ratio(f.onTime, f.due)),
    k("ofc_rating", ratio(f.ratingSum, f.ratingCount), { parts: [{ key: "ratings", value: f.ratingCount.cur ?? 0 }] }), k("ofc_utilisation", f.utilisation),
  ];
  if (f.earnings) out.push(k("ofc_earnings", f.earnings));
  if (f.paid) out.push(k("ofc_paid", f.paid));
  if (f.pending != null) out.push(makeKpi("ofc_pending", f.pending, null));
  out.push(makeKpi("ofc_agreement_age", f.agreementAgeSec, null), makeKpi("ofc_turnover", safeDiv(f.churned, f.workedPrev), null));
  return out;
}
