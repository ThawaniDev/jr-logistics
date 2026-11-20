import { defineKpis, type Good, type KpiDef, type Unit } from "./definitions";

/**
 * KPI definitions of the Geography report (decision G8). Label `rpo.kpi_<key>`, definition `rpo.def_<key>`, ratios also `_n` / `_d`.
 * Shared with the Overview (its definitions apply): `requests_created`, `parcels_delivered`, `delivery_success`, `gmv`.
 */
const k = (key: string, unit: Unit, good: Good, o: Partial<KpiDef> & { ratio?: boolean } = {}): KpiDef => {
  const { ratio, ...rest } = o;
  return { key, unit, good, label: `rpo.kpi_${key}`, definition: `rpo.def_${key}`, ...(ratio ? { numerator: `rpo.def_${key}_n`, denominator: `rpo.def_${key}_d` } : {}), ...rest };
};
/** Drivers are counted as they are right now (verified, active), so only the city filter can narrow that number. */
const SUPPLY_IGNORES = ["service", "vehicle", "company", "office", "driver", "status", "channel"] as const;

export const GEO_KPI_KEYS = ["requests_created", "parcels_delivered", "delivery_success", "geo_avg_delivery", "geo_cities_served", "geo_top_city_share", "geo_cross_city", "geo_unserved_slots", "geo_supply_demand", "geo_active_zones", "geo_geocoded", "gmv"] as const;

defineKpis("geography", [
  k("geo_avg_delivery", "duration", "lower", { ratio: true }),
  k("geo_cities_served", "count", "higher"),
  k("geo_top_city_share", "percent", "neutral", { ratio: true }),
  k("geo_cross_city", "percent", "neutral", { ratio: true }),
  k("geo_unserved_slots", "count", "lower"),
  k("geo_supply_demand", "rate", "higher", { ratio: true, notFilteredBy: SUPPLY_IGNORES }),
  k("geo_active_zones", "count", "neutral"),
  k("geo_geocoded", "percent", "higher", { ratio: true }),
]);
