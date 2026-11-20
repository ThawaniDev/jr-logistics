import { ignoredFilters } from "./conditions";
import { kpiDef } from "./definitions";
import type { ResolvedFilters } from "./filters";
import "./geo-defs";
import type { CityRow } from "./geo-lib";
import type { parcelFacts, RequestFacts } from "./geo-queries";
import { makeKpi, safeDiv, type Kpi } from "./kpi";
import { add, ratio, sub, z, type Pair } from "./ops-util";

export interface GeoFacts { parcels: Awaited<ReturnType<typeof parcelFacts>> | null; requests: RequestFacts | null; cities: CityRow[] | null; zones: Pair | null }
type Extra = Partial<Pick<Kpi, "href" | "spark">>;

/** The KPI objects of the Geography report from the raw facts (pure, unit-tested). A group that failed (null) leaves its KPIs out instead of showing 0. */
export function geoKpis(facts: GeoFacts, f: ResolvedFilters, spark: Record<string, Array<number | null> | undefined> = {}, money = true): Kpi[] {
  const { parcels: p, requests: r, cities, zones } = facts;
  const out: Array<[string, Pair, Extra?]> = [];
  const put = (key: string, pair: Pair | null | undefined, extra?: Extra) => { if (pair) out.push([key, pair, extra]); };
  if (r) put("requests_created", z(r.created), { href: "/admin/requests" });
  if (p) {
    const resolved = add(p.delivered, p.failed, p.returned);
    put("parcels_delivered", z(p.delivered)); put("delivery_success", ratio(p.delivered, resolved)); put("geo_avg_delivery", ratio(p.timeSecs, p.timeN));
  }
  if (r) put("geo_cities_served", z(r.cities));
  if (cities) {
    const total = cities.reduce((s, c) => s + c.parcels, 0), top = cities[0]?.parcels ?? 0;
    const prevs = f.prev ? cities.map((c) => c.prevParcels ?? 0) : null;
    put("geo_top_city_share", { cur: safeDiv(top, total), prev: prevs ? safeDiv(Math.max(0, ...prevs), prevs.reduce((s, n) => s + n, 0)) : null });
  }
  if (r) {
    put("geo_cross_city", ratio(r.cross, r.created)); put("geo_unserved_slots", z(sub(r.slots, r.filled)));
    put("geo_supply_demand", { cur: safeDiv(r.drivers, r.slots.cur), prev: null });
  }
  if (zones) put("geo_active_zones", z(zones));
  if (p) put("geo_geocoded", ratio(p.geocoded, p.registered));
  if (money && r?.gmv) put("gmv", z(r.gmv), { href: "/admin/finance" });
  return out.map(([key, pair, extra]) => {
    const unfiltered = ignoredFilters(f, kpiDef(key).notFilteredBy ?? []);
    return makeKpi(key, pair.cur, pair.prev, { ...extra, spark: spark[key], ...(unfiltered.length ? { unfiltered } : {}) });
  });
}
