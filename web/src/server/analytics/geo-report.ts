import type { User } from "@/db/schema";
import { can, requirePerm } from "../auth/permissions";
import { filtersMeta, parseFilters, type ResolvedFilters } from "./filters";
import { cached, permClass } from "./guard";
import { geoKpis, type GeoFacts } from "./geo-kpis";
import { buildGeoInsights } from "./geo-insights";
import { zonesOf, type CityRow } from "./geo-lib";
import { activeZones, cityRows, citySeries, gridCells, parcelFacts, requestFacts, routeRows } from "./geo-queries";
import { visibleKpis } from "./kpi";
import { PartialReport, sectionRunner } from "./ops-util";
import "./geo-tables";

/** Number of delivery cities drawn as their own column in the stacked chart (the rest is "other"). */
const SERIES_CITIES = 6;
const MAP_ZONES = 400;

async function compute(f: ResolvedFilters, money: boolean) {
  const run = sectionRunner("geography");
  const [parcels, requests, cities, routes, cells, zoneCount] = await Promise.all([
    run.run("parcels", () => parcelFacts(f)), run.run("requests", () => requestFacts(f, money)), run.run("cities", () => cityRows(f, money)),
    run.run("routes", () => routeRows(f, money)), run.run("zones", () => gridCells(f, MAP_ZONES)), run.run("zoneCount", () => activeZones(f)),
  ]);
  // The stacked chart needs to know the busiest cities first (by delivered parcels, then registered).
  const top = cities ? [...cities].sort((a, b) => b.delivered - a.delivered || b.parcels - a.parcels).filter((c) => c.delivered > 0).slice(0, SERIES_CITIES).map((c) => c.key) : [];
  const series = cities ? await run.run("series", () => citySeries(f, top)) : null;
  const located = parcels?.geocoded.cur ?? 0;
  const zones = cells ? zonesOf(cells, located || undefined) : null;
  const facts: GeoFacts = { parcels, requests, cities, zones: zoneCount };
  const kpis = visibleKpis(geoKpis(facts, f, {}, money), money);
  const resolvedParcels = parcels ? (parcels.delivered.cur ?? 0) + (parcels.failed.cur ?? 0) + (parcels.returned.cur ?? 0) : 0;
  const empty = !!(parcels && requests && cities) && !(requests.created.cur || parcels.registered.cur || resolvedParcels || cities.length);
  const meta = { ...filtersMeta(f), empty, moneyHidden: !money, failed: run.failed, gridDeg: 0.05, located, registered: parcels?.registered.cur ?? 0 };
  return run.done({
    meta, kpis, cities, routes, zones, series: series && { cities: top, ...series },
    insights: buildGeoInsights({ kpis, cities: cities ?? ([] as CityRow[]), zones: zones ?? [], located }),
  });
}
export type GeographyData = Awaited<ReturnType<typeof compute>> & { meta: { generatedAt?: string; cached?: boolean } };

/**
 * `GET /admin/analytics/geography`: the whole Geography report for one filter set (cached 30 s per permission class): per-city parcels, outcomes, delivery time, supply and demand,
 * top routes, delivered parcels by city over time, and the delivery-point density grid. Sections fail on their own (`null` + `meta.failed`). Billed amounts need `finance.view`.
 */
export async function geographyReport(user: User, query: URLSearchParams): Promise<GeographyData> {
  requirePerm(user, "reports.view");
  const f = parseFilters(query);
  const money = can(user, "finance.view");
  const stamp = (v: Awaited<ReturnType<typeof compute>>, at: number, hit: boolean) => ({ ...v, meta: { ...v.meta, generatedAt: new Date(at).toISOString(), cached: hit } });
  try {
    const res = await cached(`geography|${permClass(user)}|${f.canonical}`, () => compute(f, money));
    return stamp(res.value, res.at, res.cached);
  } catch (e) {
    if (e instanceof PartialReport) return stamp(e.value as Awaited<ReturnType<typeof compute>>, Date.now(), false);
    throw e;
  }
}
