import { defineKpis, type Good, type KpiDef, type Unit } from "./definitions";
import { SNAPSHOT_IGNORES } from "./ops-kinds";

/**
 * KPI definitions of the Operations report (decision G8). Label `rpo.kpi_<key>`, definition `rpo.def_<key>`, and for ratios `rpo.def_<key>_n` / `_d`. Three numbers are
 * shared with the Overview and keep ITS definition: `requests_created`, `on_time_start`, `cancellation_rate`.
 */
const k = (key: string, unit: Unit, good: Good, o: Partial<KpiDef> & { ratio?: boolean } = {}): KpiDef => {
  const { ratio, ...rest } = o;
  return { key, unit, good, label: `rpo.kpi_${key}`, definition: `rpo.def_${key}`, ...(ratio ? { numerator: `rpo.def_${key}_n`, denominator: `rpo.def_${key}_d` } : {}), ...rest };
};
const STRIKE_IGNORES = ["city", "service", "vehicle", "company", "status", "channel"] as const;

defineKpis("operations", [
  k("ops_published", "count", "higher"),
  k("ops_fill_rate", "percent", "higher", { ratio: true }),
  k("ops_fully_filled", "percent", "higher", { ratio: true }),
  k("ops_unfilled_slots", "count", "lower"),
  k("ops_first_offer_p50", "duration", "lower"),
  k("ops_first_accept_p50", "duration", "lower"),
  k("ops_fill_p50", "duration", "lower"),
  k("ops_fill_p90", "duration", "lower"),
  k("ops_expiry_rate", "percent", "lower", { ratio: true }),
  k("ops_aon_failed", "percent", "lower", { ratio: true }),
  k("ops_manual_share", "percent", "neutral", { ratio: true }),
  k("ops_replacement_rate", "percent", "lower", { ratio: true }),
  k("ops_delay_p90", "duration", "lower"),
  k("ops_no_show_rate", "percent", "lower", { ratio: true }),
  k("ops_arrival_distance", "count", "lower"),
  k("ops_loading_p50", "duration", "lower"),
  k("ops_scan_share", "percent", "neutral", { ratio: true }),
  k("ops_route_approval_p50", "duration", "lower"),
  k("ops_job_duration_p50", "duration", "neutral"),
  k("ops_parcels_per_job", "rate", "neutral", { ratio: true }),
  k("ops_stops_per_hour", "rate", "higher", { ratio: true }),
  k("ops_completion_rate", "percent", "higher", { ratio: true }),
  k("ops_offer_acceptance", "percent", "higher", { ratio: true }),
  k("ops_response_p50", "duration", "lower"),
  k("ops_utilisation", "percent", "neutral", { ratio: true, notFilteredBy: SNAPSHOT_IGNORES }),
  k("ops_drivers_available", "rate", "neutral", { notFilteredBy: SNAPSHOT_IGNORES }),
  k("ops_slots_open", "rate", "lower", { notFilteredBy: SNAPSHOT_IGNORES }),
  k("ops_cancelled_requests", "count", "lower"),
  k("ops_driver_cancels", "count", "lower"),
  k("ops_late_cancel_share", "percent", "lower", { ratio: true }),
  k("ops_strikes", "count", "lower", { notFilteredBy: STRIKE_IGNORES }),
  k("ops_refunds_released", "money", "neutral", { money: true }),
]);
