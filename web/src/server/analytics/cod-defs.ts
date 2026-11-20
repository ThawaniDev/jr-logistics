import { defineKpis } from "./definitions";
import { kpiOf as k } from "./finance-core";

/**
 * The KPIs of the cash-on-delivery report (`GET /admin/analytics/cod`). The driver collects `codCents` at delivery and the platform only TRACKS who holds the cash (decision E17):
 * outstanding = collected − received back from the driver. Collected is anchored to the moment the cash was collected, received to the moment it was recorded; the
 * "aged" and "holders" figures are as of now (the period does not narrow them). Everything that is an amount needs `finance.view`; counts of parcels and orders stay visible.
 */
export const COD_KPI_GROUPS = {
  cash: ["cod_collected", "cod_remitted", "cod_outstanding", "cod_remit_rate", "cod_avg_value", "cod_collection_rate", "cod_uncollected", "cod_aged_value"],
  parcels: ["cod_parcels", "cod_share", "cod_failed", "cod_mismatch", "cod_aged_orders", "cod_holders", "cod_lag_p50", "cod_lag_p90"],
} as const;

defineKpis("cod", [
  k("cod_collected", "money", "neutral", { money: true }), k("cod_remitted", "money", "higher", { money: true }), k("cod_outstanding", "money", "lower", { money: true }),
  k("cod_remit_rate", "percent", "higher", { money: true, ratio: true }), k("cod_avg_value", "money", "neutral", { money: true, ratio: true }),
  k("cod_collection_rate", "percent", "higher", { money: true, ratio: true }), k("cod_uncollected", "money", "lower", { money: true }), k("cod_aged_value", "money", "lower", { money: true }),
  k("cod_parcels", "count", "neutral"), k("cod_share", "percent", "neutral", { ratio: true }), k("cod_failed", "count", "lower"), k("cod_mismatch", "count", "lower"),
  k("cod_aged_orders", "count", "lower"), k("cod_holders", "count", "neutral"), k("cod_lag_p50", "duration", "lower"), k("cod_lag_p90", "duration", "lower"),
]);
