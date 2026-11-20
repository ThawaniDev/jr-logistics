import { defineKpis } from "./definitions";
import { kpiOf as k } from "./finance-core";

/**
 * The KPIs of the Deliveries report (`GET /admin/analytics/deliveries`). `parcels_delivered`, `delivery_success` and `first_attempt` are the Overview's own
 * definitions (the same number must never be explained two ways); every other key is `dlv_*` with its text in `rpd.*`.
 * Anchors: parcels registered by `created_at`; handed over by `loaded_at`; delivered / failed / returned by their outcome time (`PARCEL_OUTCOME_AT`: a parcel counts once, when it was resolved);
 * missing by the time it was marked; pending = parcels registered in the period that have no outcome yet.
 */
export const DELIVERY_KPI_GROUPS = {
  flow: ["dlv_created", "dlv_handed", "parcels_delivered", "dlv_failed", "dlv_returned", "dlv_missing", "dlv_pending", "delivery_success"],
  quality: ["first_attempt", "dlv_attempts_avg", "dlv_defer_rate", "dlv_return_rate", "dlv_return_time", "dlv_incomplete_rate", "dlv_b2b_share", "dlv_b2c_success", "dlv_b2b_success", "dlv_evidence_rate", "dlv_otp_fail_rate", "dlv_far_rate"],
  speed: ["dlv_time_p50", "dlv_time_p90", "dlv_dwell_p50", "dlv_dist_p50", "dlv_dist_p90", "dlv_sms_per_parcel", "dlv_parcels_per_job", "dlv_stops_per_hour", "dlv_leg_ratio"],
} as const;

defineKpis("deliveries", [
  k("dlv_created", "count", "higher"), k("dlv_handed", "count", "higher"), k("dlv_failed", "count", "lower"), k("dlv_returned", "count", "lower"),
  k("dlv_missing", "count", "lower"), k("dlv_pending", "count", "neutral"),
  k("dlv_attempts_avg", "rate", "lower", { ratio: true }),
  k("dlv_defer_rate", "percent", "lower", { ratio: true }), k("dlv_return_rate", "percent", "lower", { ratio: true }), k("dlv_return_time", "duration", "lower", { ratio: true }),
  k("dlv_incomplete_rate", "percent", "lower", { ratio: true }), k("dlv_b2b_share", "percent", "neutral", { ratio: true }),
  k("dlv_b2c_success", "percent", "higher", { ratio: true }), k("dlv_b2b_success", "percent", "higher", { ratio: true }),
  k("dlv_evidence_rate", "percent", "higher", { ratio: true }), k("dlv_otp_fail_rate", "percent", "lower", { ratio: true }), k("dlv_far_rate", "percent", "lower", { ratio: true }),
  k("dlv_time_p50", "duration", "lower"), k("dlv_time_p90", "duration", "lower"), k("dlv_dwell_p50", "duration", "lower"),
  k("dlv_dist_p50", "rate", "lower"), k("dlv_dist_p90", "rate", "lower"),
  k("dlv_sms_per_parcel", "rate", "lower", { ratio: true }), k("dlv_parcels_per_job", "rate", "higher", { ratio: true }),
  k("dlv_stops_per_hour", "rate", "higher", { ratio: true }), k("dlv_leg_ratio", "rate", "lower", { ratio: true }),
]);
