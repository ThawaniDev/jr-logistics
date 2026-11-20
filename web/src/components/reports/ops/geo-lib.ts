import type { Point } from "@/server/analytics/buckets";
import type { CityRow, ZoneRow } from "@/server/analytics/geo-lib";
import type { BarRow } from "../BarRows";
import { seriesColor } from "../chartTheme";
import type { Slice } from "../DonutChart";
import { dimKey, type T } from "./ops-lib";

/** Pure helpers that turn the Geography response into component props (unit-tested; no React). */
type CityName = (key: string) => string | undefined;

/** The stacked-chart series: one per busiest city (`c0…`), then "other". Colours follow the order so a city keeps its colour between the chart and the legend. */
export function citySeriesDefs(cities: string[], t: T, cityName?: CityName) {
  return [...cities.map((k, i) => ({ key: `c${i}`, label: dimKey("city", k, t, cityName), color: seriesColor(i) })), { key: "other", label: t("rpo.other_cities"), color: seriesColor(7) }];
}
/** Points of the city series (fields `c0…`, `other`), typed for TrendChart. */
export const seriesPoints = (pts: Array<Point<string>> | null) => pts;

/** Cities with enough resolved parcels to rank by failure rate (a city with 2 parcels would otherwise top the list), worst first. */
export const MIN_RESOLVED = 5;
export function failureRows(cities: CityRow[], t: T, cityName?: CityName): BarRow[] {
  return cities.filter((c) => c.delivered + c.failed + c.returned >= MIN_RESOLVED && c.failureRate != null).sort((a, b) => b.failureRate! - a.failureRate! || b.parcels - a.parcels)
    .map((c) => ({ key: c.key, label: dimKey("city", c.key, t, cityName), value: c.failureRate, tone: "danger" as const, sub: t("rpo.fail_of", { n: c.failed + c.returned, total: c.delivered + c.failed + c.returned }) }));
}
export const parcelSlices = (cities: CityRow[], t: T, cityName?: CityName): Slice[] => cities.filter((c) => c.parcels > 0).slice(0, 8).map((c) => ({ key: c.key, label: dimKey("city", c.key, t, cityName), value: c.parcels }));
/** Same-city vs cross-city requests from the route rows (pickup city ≠ delivery city = cross-city). */
export function crossSlices(routes: Array<{ requests: number; crossCity: boolean }>, t: T): Slice[] {
  const sum = (cross: boolean) => routes.filter((r) => r.crossCity === cross).reduce((s, r) => s + r.requests, 0);
  return [{ key: "same", label: t("rpo.same_city"), value: sum(false), color: seriesColor(0) }, { key: "cross", label: t("rpo.cross_city"), value: sum(true), color: seriesColor(1) }];
}
/** Rows of the busiest-zones list: zone centre, city and parcels (with the share of all located parcels). */
export function zoneBarRows(zones: ZoneRow[], t: T, cityName?: CityName, n = 10): BarRow[] {
  return zones.slice(0, n).map((z) => ({ key: z.id, label: `\u2066${z.zone}\u2069`, value: z.parcels, share: z.share, sub: z.city ? dimKey("city", z.city, t, cityName) : undefined }));
}
