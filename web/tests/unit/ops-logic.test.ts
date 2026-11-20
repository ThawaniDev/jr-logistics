import { describe, it, expect } from "vitest";
import * as rpo from "@/i18n/fragments/rd-reports-o";
import * as rpf from "@/i18n/fragments/rd-reports-f";
import { makeKpi } from "@/server/analytics/kpi";
import { buildOpsInsights, type OpsInsightInput } from "@/server/analytics/ops-insights";
import { buildGeoInsights } from "@/server/analytics/geo-insights";
import { funnelOf, outcomesOf, type OfferFacts } from "@/server/analytics/ops-offers";
import { MIN_SAMPLE, rankingsOf, type CompanyOps, type DriverLate, type OpsRow } from "@/server/analytics/ops-groups";
import { cellsOf, memoryPage, PartialReport, sectionRunner } from "@/server/analytics/ops-util";
import { blankCity, cellBox, cellLabel, cellOf, finishCities, zonesOf, GRID_DEG } from "@/server/analytics/geo-lib";
import { ARRIVAL_M } from "@/server/analytics/ops-sql";
import { PgDialect } from "drizzle-orm/pg-core";
import "@/server/analytics/ops-defs";
import "@/server/analytics/geo-defs";

const p = (cur: number | null, prev: number | null = null) => ({ cur, prev });

describe("the offers funnel", () => {
  const o = (v: Partial<Record<"offered" | "accepted" | "arrived" | "loaded" | "done", number | null>>) => ({ offered: p(v.offered ?? 0), accepted: p(v.accepted ?? 0), arrived: p(v.arrived ?? 0), loaded: p(v.loaded ?? 0), done: p(v.done ?? 0) });
  it("never shows a step larger than the one before it", () => {
    expect(funnelOf(o({ offered: 10, accepted: 6, arrived: 7, loaded: 5, done: 5 })).map((s) => s.count)).toEqual([10, 6, 6, 5, 5]);
    expect(funnelOf(o({})).map((s) => s.count)).toEqual([0, 0, 0, 0, 0]);
    expect(funnelOf(o({ offered: 3, accepted: null as never })).map((s) => s.count)).toEqual([3, 0, 0, 0, 0]);
    expect(funnelOf(o({ offered: 1 })).map((s) => s.key)).toEqual(["offered", "accepted", "arrived", "loaded", "completed"]);
  });
  it("puts every offer into exactly one outcome, the rest is still active", () => {
    const f = { offered: p(100), done: p(30), rejected: p(20), expired: p(15), cancelled: p(5), noShow: p(2), replaced: p(3), requestEnded: p(4) } as unknown as OfferFacts;
    const out = outcomesOf(f), by = Object.fromEntries(out.map((x) => [x.key, x.count]));
    expect(out.reduce((s, x) => s + x.count, 0)).toBe(100); expect(by.active).toBe(21); expect(by.completed).toBe(30); expect(by.request_ended).toBe(4);
    expect(outcomesOf({ ...f, offered: p(10) } as unknown as OfferFacts).find((x) => x.key === "active")!.count).toBe(0); // never negative
  });
});

describe("rankings", () => {
  const city = (key: string, requests: number, p50Fill: number | null): OpsRow => ({ key, requests, p50Fill } as OpsRow);
  const co = (id: string, requests: number, p50Fill: number | null): CompanyOps => ({ id, key: id, name: `Co ${id}`, requests, p50Fill } as CompanyOps);
  const dr = (id: string, arrived: number, avgDelayS: number | null): DriverLate => ({ id, name: `Dr ${id}`, arrived, avgDelayS, jobs: arrived, late: 0, noShows: 0 });
  it("ranks the slowest to fill and the latest to start, ignoring samples that are too small", () => {
    const r = rankingsOf([city("riyadh", 10, 3600), city("jeddah", 2, 99_999), city("dammam", MIN_SAMPLE, 7200), city("tabuk", 8, null)], [co("a", 5, 900), co("b", 4, 5000), co("c", 1, 90_000)], [dr("x", 5, 600.4), dr("y", 2, 9000), dr("z", 9, 1200)]);
    expect(r.slowCities.map((x) => x.key)).toEqual(["dammam", "riyadh"]); expect(r.slowCompanies.map((x) => x.key)).toEqual(["b", "a"]);
    expect(r.lateDrivers.map((x) => x.key)).toEqual(["z", "x"]); expect(r.lateDrivers[1]).toMatchObject({ value: 600, n: 5 }); // whole seconds
    expect(r.fastCities.map((x) => x.key)).toEqual(["riyadh", "dammam"]);
    expect(rankingsOf([], [], [])).toEqual({ slowCompanies: [], slowCities: [], lateDrivers: [], fastCities: [] });
  });
});

describe("operations insights", () => {
  const k = (key: string, value: number | null, prev: number | null = null) => makeKpi(key, value, prev);
  const base = (kpis = [k("requests_created", 100)], o: Partial<OpsInsightInput> = {}): OpsInsightInput => ({ kpis, cities: [], unfilledHeat: null, companies: [], drivers: [], samples: { due: 50, cohort: 50, cancelled: 10 }, ...o });
  it("says nothing alarming for a healthy period, and warns about a sparse one", () => {
    expect(buildOpsInsights(base([k("requests_created", 100), k("ops_fill_rate", 0.97), k("on_time_start", 0.95), k("ops_no_show_rate", 0.01)]))).toEqual([]);
    expect(buildOpsInsights(base([k("requests_created", 2)])).map((i) => i.key)).toEqual(["rpf.ins_sparse"]);
  });
  it("flags each problem when its threshold is crossed, bad news first", () => {
    const city = { key: "jeddah", fillRate: 0.4, slots: 10 } as OpsRow, heat = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (d === 3 && h === 9 ? 8 : 0)));
    const out = buildOpsInsights(base([
      k("requests_created", 100), k("ops_fill_rate", 0.7), k("ops_unfilled_slots", 12), k("ops_fill_p90", 9 * 3600), k("on_time_start", 0.7), k("ops_no_show_rate", 0.08), k("ops_late_cancel_share", 0.5), k("ops_cancelled_requests", 8),
      k("ops_response_p50", 2400), k("ops_utilisation", 0.9),
    ], { cities: [city, { key: "riyadh", fillRate: 0.8, slots: 40 } as OpsRow] }));
    expect(out.map((i) => i.key)).toEqual(["rpo.ins_fill_low", "rpo.ins_slow_staff", "rpo.ins_late_high", "rpo.ins_noshow_high", "rpo.ins_cancel_late", "rpo.ins_response_slow", "rpo.ins_util_high", "rpo.ins_city_weak"]);
    expect(out.every((i) => i.tone === "bad")).toBe(true);
    expect(out[0]).toMatchObject({ vars: { n: 70, slots: 12 } }); expect(out[2].vars).toEqual({ n: 30 }); expect(out[1].vars).toEqual({ n: 9 }); expect(out[5].vars).toEqual({ n: 40 });
    const info = buildOpsInsights(base([k("requests_created", 100), k("ops_strikes", 3)], { unfilledHeat: { cells: heat, total: 8 }, companies: [{ id: "c1", name: "Acme", value: 4, prev: 1 }], drivers: [{ id: "d1", name: "Sami", value: 3, prev: null }] }));
    expect(info.map((i) => i.key)).toEqual(["rpo.ins_repeat_company", "rpo.ins_repeat_driver", "rpo.ins_peak_unfilled", "rpo.ins_strikes"]); // bad (repeat cancellers) before info
    const peak = info.find((i) => i.key === "rpo.ins_peak_unfilled")!;
    expect(peak.refs).toEqual({ day: "rpf.wd_3" }); expect(peak.vars).toEqual({ hour: "09:00", n: 8 });
    expect(info.find((i) => i.key === "rpo.ins_repeat_company")).toMatchObject({ href: "/admin/companies/c1", vars: { name: "Acme", n: 4 } });
  });
  it("does not judge small samples", () => {
    expect(buildOpsInsights(base([k("requests_created", 100), k("ops_fill_rate", 0.2), k("on_time_start", 0.3), k("ops_no_show_rate", 0.5)], { samples: { due: 4, cohort: 4, cancelled: 1 } })).map((i) => i.key)).toEqual([]);
    expect(buildOpsInsights(base([k("requests_created", 100)], { companies: [{ id: "c", name: "A", value: 2, prev: 0 }] }))).toEqual([]);
  });
  it("reports the biggest swings against the previous period with the shared swing sentences", () => {
    const out = buildOpsInsights(base([k("requests_created", 100, 90), k("ops_fill_rate", 0.3, 0.9), k("ops_cancelled_requests", 20, 10)]));
    const keys = out.map((i) => i.key);
    expect(keys).toContain("rpf.ins_pp_down"); expect(out.find((i) => i.key === "rpf.ins_pp_down")).toMatchObject({ tone: "bad", refs: { kpi: "rpo.kpi_ops_fill_rate" }, vars: { n: 60 } });
    expect(keys.filter((x) => x.startsWith("rpf.ins_swing")).length + keys.filter((x) => x.startsWith("rpf.ins_pp")).length).toBe(2);
  });
  it("every sentence is translated and only uses placeholders the insight provides", () => {
    const heat = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (d === 1 && h === 5 ? 9 : 0)));
    const all = buildOpsInsights({ ...base([k("requests_created", 100, 40), k("ops_fill_rate", 0.5, 0.9), k("ops_unfilled_slots", 12), k("ops_fill_p90", 9 * 3600), k("on_time_start", 0.6, 0.9), k("ops_no_show_rate", 0.1), k("ops_late_cancel_share", 0.5), k("ops_cancelled_requests", 9, 3), k("ops_response_p50", 2400), k("ops_utilisation", 0.9), k("ops_strikes", 3)]),
      cities: [{ key: "jeddah", fillRate: 0.3, slots: 20 } as OpsRow], unfilledHeat: { cells: heat, total: 9 }, companies: [{ id: "c1", name: "Acme", value: 4, prev: 1 }], drivers: [{ id: "d1", name: "Sami", value: 3, prev: null }] });
    const geo = buildGeoInsights({ kpis: [k("requests_created", 3), k("geo_top_city_share", 0.8), k("delivery_success", 0.8), k("geo_geocoded", 0.5), k("geo_cross_city", 0.4)], located: 20,
      cities: [{ ...blankCity("riyadh"), parcels: 80, delivered: 40, failed: 15, returned: 5, failureRate: 1 / 3, slots: 20, unserved: 10, unservedRate: 0.5 }, { ...blankCity("jeddah"), parcels: 20 }], zones: zonesOf([{ gy: 494, gx: 933, parcels: 9, delivered: 6, failed: 2, city: "riyadh" }]) });
    expect(geo.map((i) => i.key)).toEqual(expect.arrayContaining(["rpo.ins_geo_top_city", "rpo.ins_geo_fail_city", "rpo.ins_geo_unserved", "rpo.ins_geo_located_low", "rpo.ins_geo_cross", "rpo.ins_geo_zone"]));
    const dicts = { en: { ...rpf.en, ...rpo.en }, ar: { ...rpf.ar, ...rpo.ar }, ur: { ...rpf.ur, ...rpo.ur } };
    const seen = new Set<string>();
    for (const i of [...all, ...geo]) {
      seen.add(i.key);
      const vars = new Set([...Object.keys(i.vars ?? {}), ...Object.keys(i.refs ?? {})]);
      for (const [lang, d] of Object.entries(dicts)) { expect(d[i.key], `${lang} ${i.key}`).toBeTruthy(); expect([...d[i.key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).every((x) => vars.has(x)), `${lang} ${i.key} placeholders`).toBe(true); }
    }
    expect(seen.size).toBeGreaterThanOrEqual(16);
  });
});

describe("geography helpers", () => {
  it("places a coordinate in a 0.05° grid cell with exact, rounded bounds", () => {
    expect(GRID_DEG).toBe(0.05);
    const c = cellOf(24.7136, 46.6753); expect(c).toEqual({ gy: 494, gx: 933 });
    const b = cellBox(c.gy, c.gx); expect(b).toEqual({ south: 24.7, north: 24.75, west: 46.65, east: 46.7, lat: 24.725, lng: 46.675 });
    expect(b.south).toBeLessThanOrEqual(24.7136); expect(b.north).toBeGreaterThan(24.7136); expect(cellLabel(c.gy, c.gx)).toBe("24.725, 46.675");
    expect(cellOf(-0.01, -0.01)).toEqual({ gy: -1, gx: -1 }); // negative coordinates floor away from zero
    expect(cellBox(-1, -1).south).toBe(-0.05);
  });
  it("derives zone rates and shares; failure + success of a resolved zone is 100 %", () => {
    const z = zonesOf([{ gy: 494, gx: 933, parcels: 10, delivered: 6, failed: 2, city: "riyadh" }, { gy: 1, gx: 1, parcels: 5, delivered: 0, failed: 0, city: null }]);
    expect(z[0]).toMatchObject({ id: "494:933", zone: "24.725, 46.675", successRate: 0.75, failureRate: 0.25, share: 10 / 15 });
    expect(z[1]).toMatchObject({ successRate: null, failureRate: null }); // nothing resolved yet: no rate
    expect(zonesOf([{ gy: 0, gx: 0, parcels: 3, delivered: 1, failed: 0, city: null }], 12)[0].share).toBe(0.25); // share of ALL located parcels
    expect(zonesOf([])).toEqual([]);
  });
  it("finishes city rows: unserved slots, failure rate, share, drivers per slot; quiet cities disappear, busiest first", () => {
    const a = { ...blankCity("riyadh"), parcels: 60, delivered: 40, failed: 8, returned: 2, slots: 20, filled: 15, drivers: 10, requests: 8 }, b = { ...blankCity("jeddah"), parcels: 40, requests: 4 }, quiet = blankCity("tabuk");
    const out = finishCities([b, quiet, a]);
    expect(out.map((c) => c.key)).toEqual(["riyadh", "jeddah"]);
    expect(out[0]).toMatchObject({ unserved: 5, unservedRate: 0.25, failureRate: 0.2, driversPerSlot: 0.5, share: 0.6 });
    expect(out[1]).toMatchObject({ failureRate: null, unservedRate: null, driversPerSlot: null, share: 0.4 });
    expect(finishCities([{ ...blankCity("x"), slots: 2, filled: 5, parcels: 1 }])[0].unserved).toBe(0); // never negative
  });
  it("sorts and pages in memory: numbers by value, missing last in both directions, ties by id", () => {
    const rows = [{ id: "a", v: 5, s: "b" }, { id: "b", v: null, s: "a" }, { id: "c", v: 5, s: "c" }, { id: "d", v: 9, s: null }];
    const pg = (key: string, dir: "asc" | "desc", limit = 10, offset = 0) => memoryPage(rows, { key, dir }, limit, offset);
    expect(pg("v", "desc").rows.map((r) => r.id)).toEqual(["d", "a", "c", "b"]); expect(pg("v", "asc").rows.map((r) => r.id)).toEqual(["a", "c", "d", "b"]);
    expect(pg("s", "asc").rows.map((r) => r.id)).toEqual(["b", "a", "c", "d"]);
    expect(pg("v", "desc", 2, 1).rows.map((r) => r.id)).toEqual(["a", "c"]); expect(pg("v", "desc", 2, 1).total).toBe(4); expect(pg("v", "desc", 5, 9).rows).toEqual([]);
  });
});

describe("shared helpers", () => {
  it("builds a 7 × 24 matrix and ignores out-of-range rows", () => {
    const m = cellsOf([{ dow: 0, hr: 0, n: 3 }, { dow: 6, hr: 23, n: "4" }, { dow: 7, hr: 1, n: 9 }, { dow: 1, hr: 24, n: 9 }, { dow: 1, hr: 2, n: "x" }]);
    expect(m.cells).toHaveLength(7); expect(m.cells[0]).toHaveLength(24); expect(m.cells[0][0]).toBe(3); expect(m.cells[6][23]).toBe(4); expect(m.total).toBe(7); expect(m.max).toBe(4);
  });
  it("a report section that fails does not take the page down, unless everything failed", async () => {
    const r = sectionRunner("test");
    expect(await r.run("a", async () => 1)).toBe(1); expect(await r.run("b", async () => { throw new Error("boom"); })).toBeNull();
    expect(r.failed).toEqual(["b"]);
    expect(() => r.done({ ok: true })).toThrow(PartialReport); // some failed: the value leaves through PartialReport (not cached)
    try { r.done({ ok: true }); } catch (e) { expect((e as PartialReport<{ ok: boolean }>).value).toEqual({ ok: true }); }
    const all = sectionRunner("test"); await all.run("x", async () => { throw new Error("first"); }); await all.run("y", async () => { throw new Error("second"); });
    expect(() => all.done({})).toThrow("first");
    const fine = sectionRunner("test"); await fine.run("x", async () => 1); expect(fine.done({ ok: 1 })).toEqual({ ok: 1 });
  });
  it("the check-in distance is a great-circle distance in SQL (haversine) and the pin falls back to the warehouse", () => {
    const q = new PgDialect().sqlToQuery(ARRIVAL_M);
    expect(q.sql).toContain("asin"); expect(q.sql).toContain("6371000"); expect(q.sql).toContain("coalesce(requests.pickup_lat, bp.warehouse_lat)"); expect(q.sql).toContain("offers.arrived_lat is not null");
  });
});
