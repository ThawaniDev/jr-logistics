import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import { allKpiDefs, defineKpis, kpiConflicts, kpiDef } from "@/server/analytics/definitions";
import { deltaOf, deltaPctOf, makeKpi, safeDiv, verdict, visibleKpis } from "@/server/analytics/kpi";
import { bottomN, histogram, histogramFromRow, movers, percentile, percentiles, topN, withShare } from "@/server/analytics/stats";
import { buildInsights } from "@/server/analytics/insights";
import { overviewKpis, type OverviewFacts } from "@/server/analytics/overview-kpis";
import { parseFilters } from "@/server/analytics/filters";
import { FUNNEL_STEPS } from "@/server/analytics/overview-kpis";
import { CHANNELS, MULTI_KEYS } from "@/server/analytics/keys";
import { BUCKETS, COMPARES, PRESETS } from "@/server/analytics/periods";

describe("safe division and deltas", () => {
  it("never turns missing data into 0", () => {
    expect(safeDiv(1, 0)).toBeNull(); expect(safeDiv(null, 5)).toBeNull(); expect(safeDiv(5, null)).toBeNull(); expect(safeDiv(0, 4)).toBe(0); expect(safeDiv(1, 4)).toBe(0.25);
    expect(deltaOf(5, null)).toBeNull(); expect(deltaOf(null, 5)).toBeNull(); expect(deltaOf(7, 5)).toBe(2);
    expect(deltaPctOf(5, 0)).toBeNull(); expect(deltaPctOf(0, 0)).toBeNull(); expect(deltaPctOf(110, 100)).toBe(0.1); expect(deltaPctOf(50, 100)).toBe(-0.5); expect(deltaPctOf(-5, -10)).toBe(0.5);
  });
  it("builds the KPI object from the registry", () => {
    const k = makeKpi("cancellation_rate", 0.12, 0.1);
    expect(k).toMatchObject({ key: "cancellation_rate", unit: "percent", good: "lower", value: 0.12, prev: 0.1, delta: 0.02, deltaPct: 0.2, label: "rpf.kpi_cancellation_rate", definition: "rpf.def_cancellation_rate", numerator: "rpf.def_cancellation_rate_n", denominator: "rpf.def_cancellation_rate_d" });
    expect(makeKpi("gmv", null, 100)).toMatchObject({ value: null, prev: 100, delta: null, deltaPct: null });
    expect(makeKpi("requests_created", 5, undefined)).toMatchObject({ prev: null, delta: null });
    expect(() => makeKpi("nope", 1, 1)).toThrow(/Unknown KPI/);
  });
  it("a rise in a 'lower is better' KPI is bad, and neutral KPIs are never coloured", () => {
    expect(verdict(makeKpi("cancellation_rate", 0.2, 0.1))).toBe("bad");
    expect(verdict(makeKpi("cancellation_rate", 0.05, 0.1))).toBe("good");
    expect(verdict(makeKpi("gmv", 200, 100))).toBe("good");
    expect(verdict(makeKpi("gmv", 100, 100))).toBe("flat");
    expect(verdict(makeKpi("parcels_per_request", 9, 3))).toBe("flat");
    expect(verdict(makeKpi("gmv", 100, null))).toBeNull();
    expect(verdict(makeKpi("time_to_fill", 600, 900))).toBe("good");
  });
  it("money KPIs are dropped without finance access", () => {
    const all = ["gmv", "revenue", "requests_created", "margin_pct", "aov"].map((k) => makeKpi(k, 1, 1));
    expect(visibleKpis(all, false).map((k) => k.key)).toEqual(["requests_created"]);
    expect(visibleKpis(all, true)).toHaveLength(5);
  });
});

describe("registry", () => {
  it("has one definition per KPI and no cross-report key clashes", () => {
    expect(kpiConflicts()).toEqual([]);
    const keys = allKpiDefs().map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(["gmv", "revenue", "margin_pct", "requests_created", "requests_completed", "parcels_delivered", "delivery_success", "first_attempt", "cancellation_rate", "active_companies", "active_drivers", "new_signups", "aov", "parcels_per_request", "on_time_start", "time_to_fill"]));
    defineKpis("other", [{ key: "gmv", unit: "money", good: "higher", label: "x", definition: "y" }]);
    expect(kpiConflicts()).toHaveLength(1);
    defineKpis("overview", [kpiDef("gmv")]); // restore
  });
  it("every definition, numerator, denominator and label exists in en, ar and ur with the same placeholders", () => {
    for (const d of allKpiDefs().filter((x) => x.label.startsWith("rpf."))) {
      for (const k of [d.label, d.definition, d.numerator, d.denominator].filter(Boolean) as string[]) { expect(en[k], `en ${k}`).toBeTruthy(); expect(ar[k], `ar ${k}`).toBeTruthy(); expect(ur[k], `ur ${k}`).toBeTruthy(); }
    }
    // a percentage or an average always says what it is a share / average of
    for (const d of allKpiDefs().filter((x) => (x.unit === "percent" || x.key === "aov" || x.key === "time_to_fill") && x.key !== "new_signups")) { expect(d.numerator, d.key).toBeTruthy(); expect(d.denominator, d.key).toBeTruthy(); }
  });
});

describe("every rpf.* key the UI can ask for exists in en, ar and ur", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
  it("literal keys in components, pages and server code", () => {
    const files = [...walk("src/components/reports"), ...walk("src/server/analytics"), "src/app/(app)/admin/reports/page.tsx", "src/app/(app)/admin/reports/layout.tsx"];
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/["'`](rpf\.[a-z0-9_]*[a-z0-9])["'`]/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(80);
    expect([...used].filter((k) => !(k in en) || !(k in ar) || !(k in ur)).sort()).toEqual([]);
  });
  it("keys built at run time", () => {
    const need = [
      ...PRESETS.map((p) => `rpf.preset_${p}`), "rpf.preset_custom", ...COMPARES.map((c) => `rpf.cmp_${c}`), ...BUCKETS.map((b) => `rpf.b_${b}`),
      ...MULTI_KEYS.map((k) => `rpf.f_${k}`), ...CHANNELS.map((c) => `rpf.ch_${c}`), ...FUNNEL_STEPS.map((s) => `rpf.fn_${s}`),
      ...["completed", "active", "cancelled", "expired", "delivered", "failed", "returned"].map((s) => `rpf.s_${s}`),
      ...[0, 1, 2, 3, 4, 5, 6].flatMap((d) => [`rpf.wd_${d}`, `rpf.wds_${d}`]), ...["business", "driver", "office"].map((r) => `rpf.part_${r}`),
      ...["up", "down", "companies", "cities"].map((k) => `rpf.mv_${k}`),
    ];
    expect(need.filter((k) => !(k in en) || !(k in ar) || !(k in ur))).toEqual([]);
  });
  it("a very slow fill is reported in days", () => {
    const base = { kpis: [], companies: { by: "gmv" as const, rows: [] }, cities: [], heat: { cells: [], total: 0 } };
    expect(buildInsights({ ...base, fill: { p90: 7 * 24 * 3600, n: 9 } }).map((i) => i.key)).toContain("rpf.ins_slow_fill_d");
    expect(buildInsights({ ...base, fill: { p90: 3600, n: 9 } }).map((i) => i.key)).not.toContain("rpf.ins_slow_fill");
    expect(buildInsights({ ...base, fill: { p90: 10 * 3600, n: 4 } }).map((i) => i.key)).not.toContain("rpf.ins_slow_fill"); // too few requests to say
  });
  it("insight keys and their placeholders", () => {
    const out = buildInsights({
      kpis: [makeKpi("requests_created", 100, 50), makeKpi("cancellation_rate", 0.3, 0.1), makeKpi("delivery_success", 0.8, 0.95)],
      companies: { by: "gmv", rows: [{ id: "a", name: "Acme", value: 900, prev: 1, orders: 3 }, { id: "b", name: "Beta", value: 100, prev: 1, orders: 1 }] },
      cities: [{ key: "riyadh", requests: 80, prevRequests: 1, completed: 1, cancelled: 1, gmv: null, prevGmv: null, revenue: null, share: 0.8 }, { key: "jeddah", requests: 20, prevRequests: 1, completed: 1, cancelled: 1, gmv: null, prevGmv: null, revenue: null, share: 0.2 }],
      heat: { cells: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (d === 2 && h === 14 ? 30 : 1))), total: 190 },
      fill: { p90: 8 * 3600, n: 12 },
    });
    expect(out.map((i) => i.key)).toEqual(expect.arrayContaining(["rpf.ins_swing_up", "rpf.ins_cancel_high", "rpf.ins_success_low", "rpf.ins_slow_fill", "rpf.ins_concentration_gmv", "rpf.ins_city_lead", "rpf.ins_peak"]));
    for (const i of out) {
      const vars = new Set([...Object.keys(i.vars ?? {}), ...Object.keys(i.refs ?? {})]);
      for (const dict of [en, ar, ur]) expect([...dict[i.key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).every((p) => vars.has(p)), `${i.key} placeholders`).toBe(true);
      for (const r of Object.values(i.refs ?? {})) expect(r in en, r).toBe(true);
    }
  });
});

describe("statistics helpers", () => {
  it("percentiles interpolate like percentile_cont", () => {
    expect(percentile([], 0.5)).toBeNull(); expect(percentile([7], 0.9)).toBe(7);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5); expect(percentile([1, 2, 3, 4], 0)).toBe(1); expect(percentile([1, 2, 3, 4], 1)).toBe(4);
    expect(percentile([10, 20, 30, 40, 50], 0.9)).toBe(46);
    expect(percentiles([5, 1, 3, 2, 4, NaN])).toEqual({ p50: 3, p90: 4.6, p95: 4.8 });
    expect(percentiles([])).toEqual({ p50: null, p90: null, p95: null });
  });
  it("histogram buckets are half open with open ends", () => {
    const h = histogram([1, 9, 10, 19.9, 20, 500, NaN], [10, 20]);
    expect(h).toEqual([{ from: null, to: 10, count: 2 }, { from: 10, to: 20, count: 2 }, { from: 20, to: null, count: 2 }]);
    expect(histogramFromRow({ h0: "3", h1: 0, h2: "1" }, [10, 20]).map((b) => b.count)).toEqual([3, 0, 1]);
  });
  it("top / bottom N, share of total and movers", () => {
    const rows = [{ n: "a", v: 5 }, { n: "b", v: 9 }, { n: "c", v: 1 }, { n: "d", v: null }, { n: "e", v: 9 }];
    expect(topN(rows, (r) => r.v, 3).map((r) => r.n)).toEqual(["b", "e", "a"]);
    expect(bottomN(rows, (r) => r.v, 2).map((r) => r.n)).toEqual(["c", "a"]);
    expect(withShare([{ v: 1 }, { v: 3 }], (r) => r.v).map((r) => r.share)).toEqual([0.25, 0.75]);
    expect(withShare([{ v: 0 }], (r) => r.v)[0].share).toBeNull();
    const m = movers([{ id: "1", name: "A", cur: 10, prev: 2 }, { id: "2", name: "B", cur: 3, prev: 30 }, { id: "3", name: "C", cur: 5, prev: 5 }, { id: "4", name: "D", cur: 7, prev: 0 }], 1);
    expect(m.up.map((x) => x.id)).toEqual(["1"]); expect(m.down.map((x) => x.id)).toEqual(["2"]); expect(m.up[0].deltaPct).toBe(4);
    expect(movers([{ id: "4", name: "D", cur: 7, prev: 0 }]).up[0].deltaPct).toBeNull();
  });
});

describe("overviewKpis", () => {
  const p = (cur: number | null, prev: number | null = null) => ({ cur, prev });
  const facts = {
    req: { created: p(100, 80), cancelled: p(10, 4), completed: p(70, 60), companies: p(12, 10), funnel: [] },
    parcels: { delivered: p(90, 70), failed: p(5, 10), returned: p(5, 0), first: p(72, 49), registered: p(200, 100), reg_requests: p(20, 10) },
    cash: { gmv: p(1000, 800), revenue: p(100, 100), orders: p(10, 8) },
    drivers: { drivers: p(8, 6), on_time: p(18, 0), due: p(20, 0) },
    fill: { avg: p(1200, 1800), n: 5, p50: 1000, p90: 3000, p95: 4000, histogram: [] },
    signups: { business: p(2, 1), driver: p(5, 4), office: p(1, 0) },
  } as unknown as OverviewFacts;
  const f = parseFilters({ compare: "prev", service: "delivery_driver", city: "riyadh" }, new Date("2026-11-19T10:00:00Z"));
  const by = Object.fromEntries(overviewKpis(facts, f, { gmv: [1, 2] }).map((k) => [k.key, k]));
  it("computes each ratio from its numerator and denominator", () => {
    expect(by.margin_pct).toMatchObject({ value: 0.1, prev: 0.125 });
    expect(by.aov).toMatchObject({ value: 100, prev: 100 });
    expect(by.delivery_success.value).toBe(0.9); expect(by.delivery_success.prev).toBe(0.875);
    expect(by.first_attempt.value).toBe(0.8); expect(by.cancellation_rate.value).toBe(0.1); expect(by.parcels_per_request.value).toBe(10);
    expect(by.on_time_start).toMatchObject({ value: 0.9, prev: null, delta: null });
    expect(by.time_to_fill).toMatchObject({ value: 1200, prev: 1800, delta: -600 });
    expect(by.new_signups).toMatchObject({ value: 8, prev: 5, parts: [{ key: "business", value: 2 }, { key: "driver", value: 5 }, { key: "office", value: 1 }] });
    expect(by.gmv.spark).toEqual([1, 2]);
  });
  it("says which active filters cannot narrow a KPI", () => {
    expect(by.new_signups.unfiltered).toEqual(["service"]); // the city filter does apply
    expect(by.gmv.unfiltered).toBeUndefined();
  });
  it("omits the money KPIs when there is no finance data and shows no data as null", () => {
    const k = overviewKpis({ ...facts, cash: null, parcels: { ...facts.parcels, delivered: p(0, 0), failed: p(0, 0), returned: p(0, 0), first: p(0, 0) } } as OverviewFacts, f);
    expect(k.map((x) => x.key)).not.toContain("gmv"); expect(k.map((x) => x.key)).not.toContain("aov");
    const s = Object.fromEntries(k.map((x) => [x.key, x]));
    expect(s.delivery_success.value).toBeNull(); expect(s.first_attempt.value).toBeNull();
    expect(s.requests_created.value).toBe(100);
  });
});

describe("timestamps in table rows", () => {
  it("leave the API as ISO-8601 UTC whatever the driver returned", async () => {
    const { isoValue } = await import("@/server/analytics/registry");
    expect(isoValue("2026-11-19 05:28:38.384301+03")).toBe("2026-11-19T02:28:38.384Z");
    expect(isoValue("2026-11-19 05:28:38+03")).toBe("2026-11-19T02:28:38.000Z");
    expect(isoValue("2026-11-19 05:28:38.5-05:30")).toBe("2026-11-19T10:58:38.500Z");
    expect(isoValue(new Date("2026-11-19T02:28:38Z"))).toBe("2026-11-19T02:28:38.000Z");
    expect(isoValue("JR-000011")).toBe("JR-000011"); expect(isoValue(7)).toBe(7); expect(isoValue(null)).toBeNull();
  });
});
