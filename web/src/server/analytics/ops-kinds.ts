/**
 * Names shared by the Operations / Geography reports and their pages. PURE (no imports): client components may import it, the server modules re-export from it.
 */
/** KPI keys of each section of the Operations page, in display order (the page shows one KPI row per section). */
export const OPS_KPI_GROUPS = {
  demand: ["requests_created", "ops_published", "ops_fill_rate", "ops_fully_filled", "ops_unfilled_slots", "ops_first_offer_p50", "ops_first_accept_p50", "ops_fill_p50", "ops_fill_p90", "ops_expiry_rate", "ops_aon_failed", "ops_manual_share", "ops_replacement_rate"],
  execution: ["on_time_start", "ops_delay_p90", "ops_no_show_rate", "ops_arrival_distance", "ops_loading_p50", "ops_scan_share", "ops_route_approval_p50", "ops_job_duration_p50", "ops_parcels_per_job", "ops_stops_per_hour", "ops_completion_rate"],
  offers: ["ops_offer_acceptance", "ops_response_p50"],
  supply: ["ops_utilisation", "ops_drivers_available", "ops_slots_open"],
  cancellations: ["cancellation_rate", "ops_cancelled_requests", "ops_driver_cancels", "ops_late_cancel_share", "ops_strikes", "ops_refunds_released"],
} as const;
export type OpsGroup = keyof typeof OPS_KPI_GROUPS;
export const OPS_GROUPS = Object.keys(OPS_KPI_GROUPS) as OpsGroup[];
/** The cards at the top of the page: the numbers an operations lead looks at first. */
export const OPS_HEADLINE = ["requests_created", "ops_fill_rate", "ops_fill_p50", "on_time_start", "ops_no_show_rate", "ops_offer_acceptance", "cancellation_rate", "ops_utilisation"] as const;

/** Filters a hourly platform snapshot cannot be narrowed by (it only knows the city). */
export const SNAPSHOT_IGNORES = ["service", "vehicle", "company", "office", "driver", "status", "channel"] as const;

export const CANCEL_KINDS = ["request", "driver_cancel", "no_show", "replaced"] as const;
export const PARTIES = ["business", "driver", "platform"] as const;
export const STAGES = ["before_accept", "after_accept", "after_arrival", "mid_route"] as const;
export const FUNNEL_STEPS = ["offered", "accepted", "arrived", "loaded", "completed"] as const;
export const OFFER_OUTCOMES = ["completed", "active", "rejected", "expired", "cancelled", "no_show", "replaced", "request_ended"] as const;
export const OPS_DIMS = ["city", "service", "vehicle", "company"] as const;
export type OpsDim = (typeof OPS_DIMS)[number];
export const SPEED_STEPS = ["offer", "accept", "fill"] as const;
export type SpeedStep = (typeof SPEED_STEPS)[number];

/** The sections of the Operations response; a section that failed is listed in `meta.failed` and is `null` in the response. */
export const OPS_SECTIONS = ["demand", "execution", "offers", "supply", "cancellations", "groups"] as const;
export type OpsSection = (typeof OPS_SECTIONS)[number];

/** Geography. */
export const GEO_SECTIONS = ["cities", "routes", "series", "zones"] as const;
export type GeoSection = (typeof GEO_SECTIONS)[number];
/** Size of one cell of the delivery-point grid, in degrees (≈ 5.5 km of latitude). */
export const GRID_DEG = 0.05;
