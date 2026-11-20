import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as rpo from "@/i18n/fragments/rd-reports-o";
import { allKpiDefs, kpiConflicts, kpiDef } from "@/server/analytics/definitions";
import { parseFilters } from "@/server/analytics/filters";
import { visibleKpis } from "@/server/analytics/kpi";
import "@/server/analytics/ops-defs";
import "@/server/analytics/geo-defs";
import { opsKpis, type OpsFacts } from "@/server/analytics/ops-kpis";
import { geoKpis, type GeoFacts } from "@/server/analytics/geo-kpis";
import { OPS_HEADLINE, OPS_KPI_GROUPS } from "@/server/analytics/ops-kinds";
import { GEO_KPI_KEYS } from "@/server/analytics/geo-defs";

const p = (cur: number | null, prev: number | null = null) => ({ cur, prev });
const NOW = new Date("2026-11-19T10:00:00Z");
const F = (q: Record<string, unknown> = {}) => parseFilters({ compare: "prev", ...q }, NOW);

const facts = (o: Partial<OpsFacts> = {}): OpsFacts => ({
  demand: { created: p(50, 40), published: p(48, 38), cancelled: p(5, 2), expired: p(3, 4), completed: p(30, 20), driven: p(46, 36), cohort: p(40, 30), full: p(32, 27), slots: p(60, 45), filled: p(51, 36), aon: p(10, 8), aonFailed: p(2, 1) },
  speed: { offer: { p50: p(60, 120), p90: p(300, 400), n: 40 }, accept: { p50: p(600, 900), p90: p(3600, 4000), n: 38 }, fill: { p50: p(1800, 2400), p90: p(14_400, 20_000), n: 32 }, acceptHistogram: [], fillHistogram: [] },
  offers: { offered: p(200, 150), accepted: p(70, 50), arrived: p(60, 45), loaded: p(55, 40), done: p(50, 35), rejected: p(40, 30), expired: p(60, 40), cancelled: p(4, 2), requestEnded: p(2, 0), noShow: p(3, 1), replaced: p(2, 1), manual: p(7, 5), lost: p(9, 4),
    response: { p50: p(420, 600), p90: p(2400, 3000), n: 100, histogram: [] } },
  exec: { due: p(60, 40), onTime: p(51, 36), late: p(6, 3), noShow: p(3, 1), arrived: p(57, 39), started: p(55, 38), finished: p(44, 30), parcels: p(1100, 700), parcelJobs: p(55, 35),
    delay: { p50: p(0, 0), p90: p(1200, 900), histogram: [] }, distance: { p50: p(35, 50), p90: p(150, 200), n: p(40, 30) }, loading: { p50: p(900, 1000), p90: p(2400, 2600), n: p(50, 35) }, approval: { p50: p(240, 300), p90: p(900, 1000) },
    job: { p50: p(14_400, 15_000), p90: p(25_000, 26_000), n: p(40, 30), histogram: [] } },
  stops: { stops: p(1000, 600), secs: p(36_000 * 2, 36_000) },
  loading: { scan: p(80, 20), warehouse: p(20, 20) },
  supply: { available: p(12.5, 10), busy: p(7.5, 6), open: p(3, 4), unfilled: p(5, 6), sumAvailable: p(1000, 800), sumBusy: p(600, 400), hours: p(80, 80) },
  cancel: { requests: p(8, 5), byBusiness: p(5, 3), byPlatform: p(3, 2), lateRequests: p(4, 1), driverCancels: p(6, 3), noShows: p(3, 1), replaced: p(2, 1), lead: { p50: p(7200, 3600), histogram: [] } },
  policy: { warnings: p(3, 1), suspensions: p(1, 0), strikes: p(4, 1), refunds: p(500_00, 100_00) },
  ...o,
} as OpsFacts);
/** KPI values are rounded to 6 decimals; compare numbers with that tolerance. */
const near = (k: { value: number | null; prev: number | null }, value: number | null, prev?: number | null) => {
  if (value === null) expect(k.value).toBeNull(); else expect(k.value).toBeCloseTo(value, 5);
  if (prev !== undefined) { if (prev === null) expect(k.prev).toBeNull(); else expect(k.prev).toBeCloseTo(prev, 5); }
};
const by = (k: ReturnType<typeof opsKpis>) => Object.fromEntries(k.map((x) => [x.key, x]));

describe("operations KPI definitions", () => {
  it("every key is registered once, belongs to one section, and has its texts in en, ar and ur", () => {
    expect(kpiConflicts()).toEqual([]);
    const own = allKpiDefs().filter((d) => d.label.startsWith("rpo."));
    expect(own.length).toBeGreaterThanOrEqual(38);
    for (const d of own) {
      for (const k of [d.label, d.definition, d.numerator, d.denominator].filter(Boolean) as string[]) { expect(rpo.en[k], `en ${k}`).toBeTruthy(); expect(rpo.ar[k], `ar ${k}`).toBeTruthy(); expect(rpo.ur[k], `ur ${k}`).toBeTruthy(); }
    }
    // every percentage and average says what it is a share / average of (G8)
    for (const d of own.filter((x) => x.unit === "percent" || ["ops_parcels_per_job", "ops_stops_per_hour", "geo_avg_delivery", "geo_supply_demand"].includes(x.key))) { expect(d.numerator, d.key).toBeTruthy(); expect(d.denominator, d.key).toBeTruthy(); }
    const grouped = Object.values(OPS_KPI_GROUPS).flat() as string[];
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const k of grouped) expect(() => kpiDef(k), k).not.toThrow();
    for (const k of GEO_KPI_KEYS) expect(() => kpiDef(k), k).not.toThrow();
    for (const k of OPS_HEADLINE) expect(grouped, k).toContain(k);
  });
  it("the money KPI needs finance access", () => { expect(kpiDef("ops_refunds_released")).toMatchObject({ money: true, unit: "money" }); expect(kpiDef("gmv").money).toBe(true); });
  it("snapshot-based and strike KPIs say which filters cannot narrow them", () => {
    expect(kpiDef("ops_utilisation").notFilteredBy).toEqual(expect.arrayContaining(["service", "company", "driver"]));
    expect(kpiDef("ops_utilisation").notFilteredBy).not.toContain("city");
    expect(kpiDef("ops_strikes").notFilteredBy).toContain("city");
    expect(kpiDef("ops_strikes").notFilteredBy).not.toContain("driver");
  });
});

describe("opsKpis", () => {
  it("computes every ratio from its numerator and denominator, with the comparison period", () => {
    const k = by(opsKpis(facts(), F()));
    near(k.ops_fill_rate, 51 / 60, 36 / 45);
    near(k.ops_fully_filled, 32 / 40, 27 / 30);
    expect(k.ops_unfilled_slots).toMatchObject({ value: 9, prev: 9, delta: 0 });
    near(k.ops_expiry_rate, 3 / 46, 4 / 36);
    near(k.ops_aon_failed, 0.2, 0.125);
    expect(k.ops_manual_share.value).toBeCloseTo(0.1, 6); expect(k.ops_replacement_rate.value).toBeCloseTo(9 / 70, 6);
    near(k.on_time_start, 51 / 60, 36 / 40); near(k.ops_no_show_rate, 3 / 60);
    expect(k.ops_scan_share).toMatchObject({ value: 0.8, prev: 0.5 }); expect(k.ops_parcels_per_job).toMatchObject({ value: 20, prev: 20 });
    expect(k.ops_stops_per_hour).toMatchObject({ value: 50, prev: 60 }); // 1000 stops in 20 h, 600 stops in 10 h
    near(k.ops_completion_rate, 44 / 55); near(k.ops_offer_acceptance, 0.35, 1 / 3);
    near(k.ops_utilisation, 600 / 1600, 400 / 1200); near(k.ops_late_cancel_share, 0.5, 0.2);
    expect(k.cancellation_rate).toMatchObject({ value: 0.1, prev: 0.05 });
    expect(k.ops_fill_p50).toMatchObject({ value: 1800, prev: 2400, delta: -600 }); expect(k.ops_response_p50.value).toBe(420);
    expect(k.ops_strikes).toMatchObject({ value: 4, prev: 1 }); expect(k.ops_refunds_released).toMatchObject({ value: 500_00, prev: 100_00 });
    expect(k.ops_arrival_distance.value).toBe(35); expect(k.ops_delay_p90.value).toBe(1200);
  });
  it("every KPI it can produce belongs to a section of the page", () => {
    const grouped = new Set(Object.values(OPS_KPI_GROUPS).flat() as string[]);
    const keys = opsKpis(facts(), F()).map((x) => x.key);
    expect(keys.filter((x) => !grouped.has(x))).toEqual([]);
    expect([...grouped].filter((x) => !keys.includes(x))).toEqual([]);
  });
  it("shows no data as null, never 0 %", () => {
    const empty = facts({
      demand: { created: p(0, 0), published: p(0, 0), cancelled: p(0, 0), expired: p(0, 0), completed: p(0, 0), driven: p(0, 0), cohort: p(0, 0), full: p(0, 0), slots: p(0, 0), filled: p(0, 0), aon: p(0, 0), aonFailed: p(0, 0) },
      supply: { available: p(null, null), busy: p(null, null), open: p(null, null), unfilled: p(null, null), sumAvailable: p(0, 0), sumBusy: p(0, 0), hours: p(0, 0) },
      stops: { stops: p(0, 0), secs: p(0, 0) },
    });
    const k = by(opsKpis(empty, F()));
    expect(k.requests_created.value).toBe(0); expect(k.ops_fill_rate.value).toBeNull(); expect(k.ops_fully_filled.value).toBeNull(); expect(k.cancellation_rate.value).toBeNull();
    expect(k.ops_expiry_rate.value).toBeNull(); expect(k.ops_utilisation.value).toBeNull(); expect(k.ops_drivers_available.value).toBeNull(); expect(k.ops_stops_per_hour.value).toBeNull();
    expect(k.ops_unfilled_slots.value).toBe(0);
  });
  it("leaves out the KPIs whose facts failed, and the money KPI without finance access", () => {
    const k = opsKpis(facts({ exec: null, supply: null, cancel: null }), F()).map((x) => x.key);
    for (const gone of ["on_time_start", "ops_no_show_rate", "ops_loading_p50", "ops_utilisation", "ops_cancelled_requests", "ops_completion_rate"]) expect(k).not.toContain(gone);
    expect(k).toEqual(expect.arrayContaining(["ops_fill_rate", "ops_offer_acceptance", "ops_stops_per_hour", "ops_strikes"]));
    const money = opsKpis(facts(), F(), {}, false); expect(money.map((x) => x.key)).not.toContain("ops_refunds_released");
    expect(visibleKpis(opsKpis(facts(), F()), false).map((x) => x.key)).not.toContain("ops_refunds_released");
    expect(visibleKpis(opsKpis(facts(), F()), true).map((x) => x.key)).toContain("ops_refunds_released");
  });
  it("without a comparison there is no previous value, and unfilterable KPIs are flagged", () => {
    const k = by(opsKpis(facts({ demand: { ...facts().demand!, created: p(50, null) } }), F({ compare: "none", service: "delivery_driver", city: "riyadh" }), { requests_created: [1, 2] }));
    expect(k.requests_created).toMatchObject({ value: 50, prev: null, delta: null, spark: [1, 2] });
    expect(k.ops_utilisation.unfiltered).toEqual(["service"]); // the city filter does apply to snapshots
    expect(k.ops_strikes.unfiltered).toEqual(["city", "service"]);
    expect(k.ops_fill_rate.unfiltered).toBeUndefined();
  });
});

describe("geoKpis", () => {
  const g = (o: Partial<GeoFacts> = {}): GeoFacts => ({
    parcels: { registered: p(200, 100), delivered: p(150, 80), failed: p(10, 10), returned: p(5, 0), geocoded: p(180, 60), timeSecs: p(150 * 3600, 80 * 4000), timeN: p(150, 80) },
    requests: { created: p(20, 10), cross: p(5, 2), cities: p(4, 3), slots: p(40, 20), filled: p(30, 18), drivers: 10, gmv: p(100_000, 50_000) },
    cities: [{ key: "riyadh", parcels: 120, prevParcels: 50 }, { key: "jeddah", parcels: 80, prevParcels: 50 }] as never, zones: p(7, 5),
    ...o,
  });
  const by2 = (k: ReturnType<typeof geoKpis>) => Object.fromEntries(k.map((x) => [x.key, x]));
  it("computes the geography numbers", () => {
    const k = by2(geoKpis(g(), F()));
    expect(k.parcels_delivered.value).toBe(150); near(k.delivery_success, 150 / 165, 80 / 90);
    expect(k.geo_avg_delivery).toMatchObject({ value: 3600 }); expect(k.geo_cities_served).toMatchObject({ value: 4, prev: 3 });
    expect(k.geo_top_city_share).toMatchObject({ value: 0.6, prev: 0.5 }); expect(k.geo_cross_city).toMatchObject({ value: 0.25, prev: 0.2 });
    expect(k.geo_unserved_slots).toMatchObject({ value: 10, prev: 2 }); expect(k.geo_supply_demand).toMatchObject({ value: 0.25, prev: null });
    expect(k.geo_active_zones).toMatchObject({ value: 7, prev: 5 }); expect(k.geo_geocoded).toMatchObject({ value: 0.9, prev: 0.6 }); expect(k.gmv.value).toBe(100_000);
    expect(k.geo_supply_demand.unfiltered).toBeUndefined();
    expect(by2(geoKpis(g(), F({ service: "delivery_driver" }))).geo_supply_demand.unfiltered).toEqual(["service"]);
  });
  it("omits money without finance access and what failed", () => {
    expect(geoKpis(g(), F(), {}, false).map((x) => x.key)).not.toContain("gmv");
    const k = geoKpis(g({ parcels: null, cities: null, zones: null }), F()).map((x) => x.key);
    expect(k).not.toContain("parcels_delivered"); expect(k).not.toContain("geo_top_city_share"); expect(k).not.toContain("geo_active_zones"); expect(k).toContain("requests_created");
  });
  it("no parcels and no slots are null, not 0", () => {
    const k = by2(geoKpis(g({ parcels: { registered: p(0, 0), delivered: p(0, 0), failed: p(0, 0), returned: p(0, 0), geocoded: p(0, 0), timeSecs: p(0, 0), timeN: p(0, 0) }, requests: { created: p(0, 0), cross: p(0, 0), cities: p(0, 0), slots: p(0, 0), filled: p(0, 0), drivers: 3, gmv: p(0, 0) }, cities: [] }), F()));
    expect(k.delivery_success.value).toBeNull(); expect(k.geo_avg_delivery.value).toBeNull(); expect(k.geo_cross_city.value).toBeNull(); expect(k.geo_supply_demand.value).toBeNull(); expect(k.geo_geocoded.value).toBeNull(); expect(k.geo_top_city_share.value).toBeNull();
  });
});

describe("every rpo.* key the code asks for exists in en, ar and ur, with the same placeholders", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const x = join(d, f); return statSync(x).isDirectory() ? walk(x) : /\.tsx?$/.test(x) ? [x] : []; });
  const files = [...walk("src/components/reports/ops"), ...readdirSync("src/server/analytics").filter((f) => /^(ops|geo)-/.test(f)).map((f) => join("src/server/analytics", f)), "src/app/(app)/admin/reports/operations/page.tsx", "src/app/(app)/admin/reports/geography/page.tsx"];
  const NAMESPACES = new Set(["rpo.kind", "rpo.party", "rpo.stage"]); // dictionary prefixes of enum columns, not keys
  it("literal keys in components, pages and server code", () => {
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/["'`](rpo\.[a-z0-9_.]*[a-z0-9_])["'`]/g)) if (!NAMESPACES.has(m[1])) used.add(m[1]);
    expect(used.size).toBeGreaterThan(150);
    expect([...used].filter((k) => !(k in rpo.en) || !(k in rpo.ar) || !(k in rpo.ur)).sort()).toEqual([]);
  });
  it("keys built at run time", () => {
    const need = [
      ...["demand", "execution", "offers", "supply", "cancellations", "groups"].flatMap((s) => [`rpo.s_${s}`, `rpo.s_${s}_hint`]),
      ...["city", "service", "vehicle", "company"].map((d) => `rpo.dim_${d}`), ...["offered", "accepted", "arrived", "loaded", "completed"].map((s) => `rpo.fn_${s}`),
      ...["completed", "active", "rejected", "expired", "cancelled", "no_show", "replaced", "request_ended"].map((s) => `rpo.out_${s}`),
      ...["business", "driver", "platform"].map((s) => `rpo.party.${s}`), ...["before_accept", "after_accept", "after_arrival", "mid_route"].map((s) => `rpo.stage.${s}`),
      ...["request", "driver_cancel", "no_show", "replaced"].map((s) => `rpo.kind.${s}`), ...["offer", "accept", "fill"].map((s) => `rpo.step_${s}`), "rpo.reason.not_fully_staffed",
    ];
    expect(need.filter((k) => !(k in rpo.en) || !(k in rpo.ar) || !(k in rpo.ur))).toEqual([]);
  });
  it("the three languages have the same keys and the same {placeholders}", () => {
    expect(Object.keys(rpo.ar).sort()).toEqual(Object.keys(rpo.en).sort()); expect(Object.keys(rpo.ur).sort()).toEqual(Object.keys(rpo.en).sort());
    expect(Object.keys(rpo.en).every((k) => k.startsWith("rpo."))).toBe(true);
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const k of Object.keys(rpo.en)) { expect(ph(rpo.ar[k]), `ar ${k}`).toBe(ph(rpo.en[k])); expect(ph(rpo.ur[k]), `ur ${k}`).toBe(ph(rpo.en[k])); expect(rpo.ar[k].trim(), `ar ${k}`).not.toBe(""); expect(rpo.ur[k].trim(), `ur ${k}`).not.toBe(""); }
  });
});
