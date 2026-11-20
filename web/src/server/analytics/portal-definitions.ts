import { defineKpis, type Good, type KpiDef, type Unit } from "./definitions";

/**
 * KPI definitions of the company and courier-office portal reports (prefix `rpr.`). Same rules as the admin reports: ONE definition per KPI, shown in the UI; every percentage
 * says what it is a share of. Keys: label `rpr.kpi_<key>`, definition `rpr.def_<key>`, `rpr.def_<key>_n` / `_d` for ratios. Numbers shared with the admin Overview
 * (`parcels_delivered`, `delivery_success`, `first_attempt`, `on_time_start`, `time_to_fill`, `cancellation_rate`, `requests_completed`, `active_drivers`) reuse its keys.
 */
const NO_REQUEST_FILTERS = ["city", "service", "vehicle", "status", "channel"] as const;
const NO_FLEET_FILTERS = ["city", "service", "vehicle", "driver"] as const;

const k = (key: string, unit: Unit, good: Good, o: Partial<KpiDef> & { ratio?: boolean } = {}): KpiDef => {
  const { ratio, ...rest } = o;
  return { key, unit, good, label: `rpr.kpi_${key}`, definition: `rpr.def_${key}`, ...(ratio ? { numerator: `rpr.def_${key}_n`, denominator: `rpr.def_${key}_d` } : {}), ...rest };
};

export const BUSINESS_KPI_KEYS = [
  "biz_requests", "biz_parcels_sent", "biz_parcels_failed", "biz_parcels_returned", "biz_spend", "biz_avg_order", "biz_cost_per_parcel", "biz_cod_collected", "biz_cod_received", "biz_cod_outstanding",
  "biz_deferred_rate", "biz_delivery_time", "biz_otp_issue_rate", "biz_sms_failure_rate", "biz_returns_outstanding",
  "biz_orders_billed", "biz_invoiced", "biz_vat", "biz_topups", "biz_wallet_balance", "biz_credit_usage", "biz_forecast",
] as const;
export const OFFICE_KPI_KEYS = [
  "off_drivers", "off_jobs", "off_completion_rate", "off_utilisation", "off_rating", "off_earnings", "off_paid", "off_pending",
  "off_acceptance_rate", "off_no_show_rate", "off_cancel_rate", "off_avg_jobs", "off_coach",
  "off_avg_per_job", "off_avg_per_parcel", "off_withdrawn", "off_withdrawals_pending", "off_wallet", "off_time_to_pay", "off_settlements",
] as const;

defineKpis("portal-business", [
  k("biz_requests", "count", "higher"),
  k("biz_parcels_sent", "count", "higher"),
  k("biz_parcels_failed", "count", "lower"),
  k("biz_parcels_returned", "count", "lower"),
  k("biz_spend", "money", "neutral"),
  k("biz_avg_order", "money", "neutral", { ratio: true }),
  k("biz_cost_per_parcel", "money", "lower", { ratio: true }),
  k("biz_cod_collected", "money", "neutral"),
  k("biz_cod_received", "money", "neutral"),
  k("biz_cod_outstanding", "money", "lower"),
  k("biz_deferred_rate", "percent", "lower", { ratio: true }),
  k("biz_delivery_time", "duration", "lower"),
  k("biz_otp_issue_rate", "percent", "lower", { ratio: true }),
  k("biz_sms_failure_rate", "percent", "lower", { ratio: true }),
  k("biz_returns_outstanding", "count", "lower"),
  k("biz_orders_billed", "count", "neutral"),
  k("biz_invoiced", "money", "neutral"),
  k("biz_vat", "money", "neutral"),
  k("biz_topups", "money", "neutral", { notFilteredBy: NO_REQUEST_FILTERS }),
  k("biz_wallet_balance", "money", "neutral", { notFilteredBy: NO_REQUEST_FILTERS }),
  k("biz_credit_usage", "percent", "lower", { ratio: true, notFilteredBy: NO_REQUEST_FILTERS }),
  k("biz_forecast", "money", "neutral"),
]);

defineKpis("portal-office", [
  k("off_drivers", "count", "neutral", { notFilteredBy: NO_FLEET_FILTERS }),
  k("off_jobs", "count", "higher"),
  k("off_completion_rate", "percent", "higher", { ratio: true }),
  k("off_utilisation", "percent", "higher", { ratio: true, notFilteredBy: NO_FLEET_FILTERS }),
  k("off_rating", "rate", "higher", { ratio: true }),
  k("off_earnings", "money", "higher"),
  k("off_paid", "money", "higher"),
  k("off_pending", "money", "neutral"),
  k("off_acceptance_rate", "percent", "higher", { ratio: true }),
  k("off_no_show_rate", "percent", "lower", { ratio: true }),
  k("off_cancel_rate", "percent", "lower", { ratio: true }),
  k("off_avg_jobs", "rate", "higher", { ratio: true }),
  k("off_coach", "count", "lower"),
  k("off_avg_per_job", "money", "higher", { ratio: true }),
  k("off_avg_per_parcel", "money", "higher", { ratio: true }),
  k("off_withdrawn", "money", "neutral", { notFilteredBy: NO_FLEET_FILTERS }),
  k("off_withdrawals_pending", "money", "neutral", { notFilteredBy: NO_FLEET_FILTERS }),
  k("off_wallet", "money", "neutral", { notFilteredBy: NO_FLEET_FILTERS }),
  k("off_time_to_pay", "duration", "lower", { ratio: true }),
  k("off_settlements", "count", "neutral"),
]);

/** Reused admin keys that have a portal meaning (the label and definition are the admin ones). */
export const SHARED_KPI_KEYS = ["parcels_delivered", "delivery_success", "first_attempt", "on_time_start", "time_to_fill", "cancellation_rate", "requests_completed", "active_drivers"] as const;
