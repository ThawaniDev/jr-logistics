import type { Kpi } from "@/server/analytics/kpi";

/**
 * KPI cards in titled groups, shared by the entity centre and the two platform report pages. A KPI that is in no group (a metric added to the report later) is NOT dropped:
 * it lands in a final "More metrics" group. To place a new KPI key properly, add it to the `keys` of the group it belongs to below (the order of `keys` is the order of the cards).
 * Pure and unit-tested (tests/unit/fleet-ui-lib.test.ts).
 */
export interface KpiGroupDef { id: string; /** i18n key of the heading */ title: string; keys: readonly string[] }
export interface KpiGroup { id: string; title: string; kpis: Kpi[] }
export const MORE_GROUP = { id: "more", title: "fr.grp_more" } as const;

/** Cards per group in the order of `defs`; a KPI appears once (the first group that names it); `hide` keys are skipped; everything else goes to the last "More metrics" group. Empty groups are left out. */
export function groupKpis(kpis: readonly Kpi[], defs: readonly KpiGroupDef[], hide: readonly string[] = []): KpiGroup[] {
  const left = new Map(kpis.filter((k) => !hide.includes(k.key)).map((k) => [k.key, k] as const));
  const out: KpiGroup[] = [];
  for (const d of defs) {
    const list: Kpi[] = [];
    for (const key of d.keys) { const k = left.get(key); if (k) { list.push(k); left.delete(key); } }
    if (list.length) out.push({ id: d.id, title: d.title, kpis: list });
  }
  if (left.size) out.push({ ...MORE_GROUP, kpis: [...left.values()] });
  return out;
}

// Groups named after what the owner asked the reports to answer: how much is there, how reliable, how punctual, how are offers handled, how long things take, how far, how efficient,
// how good (ratings, complaints) and what it earns. The `fl_*` keys are the fleet KPIs of the core worker (`server/analytics/fleet-kpis.ts`, `first_attempt` is the Overview's).
// A group whose KPIs are not in the response (no money access, a report without that KPI) is simply not shown.
const TIMING = { id: "timing", title: "fr.grp_timing", keys: ["fl_wait", "fl_load", "fl_stop_time", "fl_parcel_time", "fl_job_time"] } as const satisfies KpiGroupDef;
const DISTANCE = { id: "distance", title: "fr.grp_distance", keys: ["fl_radius", "fl_route"] } as const satisfies KpiGroupDef;
const EFFICIENCY = { id: "efficiency", title: "fr.grp_efficiency", keys: ["fl_efficiency", "fl_parcels_per_job", "first_attempt"] } as const satisfies KpiGroupDef;
const LATENESS = ["fl_late", "fl_very_late", "fl_late_avg", "fl_arrival_delta"] as const;
const OFFER_OUTCOMES = ["fl_decline_rate", "fl_timeout_rate", "fl_resp_avg"] as const;

/** Reports › Drivers (`GET /admin/analytics/drivers`) and the driver entity page. */
export const DRIVER_GROUPS: readonly KpiGroupDef[] = [
  { id: "fleet", title: "fr.grp_fleet", keys: ["active_drivers", "flt_available", "flt_online_hours", "fl_online_days", "fl_active_days", "flt_util", "flt_jobs_per", "flt_parcels_per"] },
  { id: "reliability", title: "fr.grp_reliability", keys: ["flt_success", "flt_cancel", "flt_replaced", "flt_strikes", "flt_suspensions"] },
  { id: "punctuality", title: "fr.grp_punctuality", keys: ["on_time_start", ...LATENESS] },
  { id: "offers", title: "fr.grp_offers", keys: ["flt_acceptance", "fl_decline_rate", "fl_timeout_rate", "flt_resp_p50", "flt_resp_p90", "fl_resp_avg"] },
  TIMING, DISTANCE, EFFICIENCY,
  { id: "quality", title: "fr.grp_quality", keys: ["flt_rating", "fl_complaints", "flt_flagged", "flt_churned"] },
  { id: "earnings", title: "fr.grp_earnings", keys: ["flt_earn_per", "flt_earn_hour", "flt_cash"] },
];
/** Reports › Courier offices (`GET /admin/analytics/offices`) and the office entity page. */
export const OFFICE_GROUPS: readonly KpiGroupDef[] = [
  { id: "fleet", title: "fr.grp_fleet", keys: ["cof_active", "cof_fleet", "cof_active_drivers", "fl_online_days", "fl_active_days", "cof_util"] },
  { id: "work", title: "fr.grp_work", keys: ["cof_jobs", "cof_parcels", "cof_success"] },
  { id: "punctuality", title: "fr.grp_punctuality", keys: ["cof_ontime", ...LATENESS] },
  { id: "offers", title: "fr.grp_offers", keys: [...OFFER_OUTCOMES] },
  TIMING, DISTANCE, EFFICIENCY,
  { id: "quality", title: "fr.grp_quality", keys: ["cof_rating", "fl_complaints"] },
  { id: "earnings", title: "fr.grp_earnings", keys: ["cof_earned", "cof_paid", "cof_pending", "fl_cod_held"] },
  { id: "changes", title: "fr.grp_changes", keys: ["cof_links", "cof_unlinks", "cof_agreed"] },
];
/** The courier-office portal (`GET /office/analytics/overview`). */
export const PORTAL_GROUPS: readonly KpiGroupDef[] = [
  { id: "fleet", title: "fr.grp_fleet", keys: ["off_drivers", "active_drivers", "off_utilisation"] },
  { id: "work", title: "fr.grp_work", keys: ["off_jobs", "off_completion_rate", "parcels_delivered", "delivery_success"] },
  { id: "punctuality", title: "fr.grp_punctuality", keys: ["on_time_start", ...LATENESS] },
  { id: "offers", title: "fr.grp_offers", keys: [...OFFER_OUTCOMES] },
  TIMING, DISTANCE, EFFICIENCY,
  { id: "quality", title: "fr.grp_quality", keys: ["off_rating", "fl_complaints"] },
  { id: "earnings", title: "fr.grp_earnings", keys: ["off_earnings", "off_paid", "off_pending", "fl_cod_held"] },
];
/** KPIs that say nothing about ONE entity (the number of active offices of an office page is always 1). */
export const HIDE_FOR_ENTITY = { office: ["cof_active"], driver: ["active_drivers"] } as const;
