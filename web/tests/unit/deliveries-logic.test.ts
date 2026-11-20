import { describe, it, expect } from "vitest";
import { parseFilters } from "@/server/analytics/filters";
import { deliveryKpis, type DeliveryFacts } from "@/server/analytics/deliveries-kpis";
import { DELIVERY_KPI_GROUPS } from "@/server/analytics/deliveries-defs";
import { busiest, deliveryInsights, worstOf } from "@/server/analytics/deliveries-insights";
import type { GroupRow } from "@/server/analytics/deliveries-groups";
import { MIN_VOLUME, ageKeyOf, AGE_KEYS } from "@/server/analytics/finance-core";
import { groupLabel, groupRows, histBuckets, reasonLabel, successOf, successSeries, worstRows, kpiPick, matrixColumns } from "@/components/reports/fin/fin-lib";

const NOW = new Date("2026-11-19T10:00:00Z");
const P = (cur: number | null, prev: number | null = null) => ({ cur, prev });
const f = parseFilters({ preset: "30d" }, NOW);
const flow = (o: Record<string, [number | null, (number | null)?]> = {}) => {
  const base: Record<string, [number | null, (number | null)?]> = {
    created: [100, 80], handed: [90, 70], delivered: [80, 60], failed: [10, 10], returned: [5, 4], missing: [1, 0], pending: [4, 6], first: [72, 50], attempts: [88, 66], deferred: [15, 10], def_del: [10, 6], incomplete: [10, 4],
    b2b_created: [25, 20], b2c_del: [60, 45], b2c_res: [70, 55], b2b_del: [20, 15], b2b_res: [25, 19], ret_n: [4, 2], ret_secs: [4 * 3600, 2 * 7200], otp: [60, 40], receipt: [12, 10], scan: [8, 10], signed: [5, 3], evidence: [74, 54], sms: [190, 140], ...o,
  };
  return Object.fromEntries(Object.entries(base).map(([k, [c, p]]) => [k, P(c, p ?? null)]));
};
const facts = (over: Partial<DeliveryFacts> = {}): DeliveryFacts => ({
  flow: flow() as never,
  timing: { time_p50: P(1800, 2400), time_p90: P(7200, 9000), dwell_p50: P(240, 300), dist_p50: P(40, 60), dist_p90: P(180, 250), far: P(12, 20), dist_n: P(60, 80), time: { hist: [], n: 0 }, distance: { hist: [], n: 0 } } as never,
  jobs: { del: P(80, 60), jobs: P(10, 8), actual: P(5400, 4000), planned: P(3600, 3600), stopsN: P(70, 50), stopsHrs: P(10, 8) } as never,
  otpBad: P(6, 4), otpOk: P(54, 40), ...over,
});
const by = (ks: ReturnType<typeof deliveryKpis>, key: string) => ks.find((k) => k.key === key)!;

describe("deliveryKpis", () => {
  it("builds every registered KPI of the report from the facts, in the groups' order", () => {
    const ks = deliveryKpis(facts(), f);
    const all = Object.values(DELIVERY_KPI_GROUPS).flat();
    expect(ks.map((k) => k.key).sort()).toEqual([...all].sort());
    expect(kpiPick(ks, DELIVERY_KPI_GROUPS.flow).map((k) => k.key)).toEqual([...DELIVERY_KPI_GROUPS.flow]);
  });
  it("computes rates from counts with the stated denominators and compares with the previous period", () => {
    const ks = deliveryKpis(facts(), f);
    expect(by(ks, "delivery_success").value).toBeCloseTo(80 / 95, 5); expect(by(ks, "delivery_success").prev).toBeCloseTo(60 / 74, 5);
    expect(by(ks, "first_attempt").value).toBeCloseTo(72 / 80);
    expect(by(ks, "dlv_attempts_avg").value).toBeCloseTo(88 / 80);
    expect(by(ks, "dlv_defer_rate").value).toBeCloseTo(15 / 95);
    expect(by(ks, "dlv_return_rate").value).toBeCloseTo(5 / 95);
    expect(by(ks, "dlv_return_time").value).toBe(3600);
    expect(by(ks, "dlv_incomplete_rate").value).toBeCloseTo(0.1);
    expect(by(ks, "dlv_b2c_success").value).toBeCloseTo(60 / 70);
    expect(by(ks, "dlv_otp_fail_rate").value).toBeCloseTo(6 / 60);
    expect(by(ks, "dlv_far_rate").value).toBeCloseTo(12 / 60);
    expect(by(ks, "dlv_sms_per_parcel").value).toBeCloseTo(190 / 95);
    expect(by(ks, "dlv_parcels_per_job").value).toBe(8);
    expect(by(ks, "dlv_stops_per_hour").value).toBe(7);
    expect(by(ks, "dlv_leg_ratio").value).toBe(1.5);
    expect(by(ks, "dlv_time_p50")).toMatchObject({ value: 1800, prev: 2400 });
  });
  it("shows no data (null), never 0%, when there is nothing to divide by", () => {
    const empty = Object.fromEntries(Object.keys(flow()).map((k) => [k, P(0, 0)]));
    const ks = deliveryKpis(facts({ flow: empty as never, otpBad: P(0), otpOk: P(0), jobs: { del: P(0), jobs: P(0), actual: P(0), planned: P(0), stopsN: P(0), stopsHrs: P(0) } as never }), f);
    for (const k of ["delivery_success", "first_attempt", "dlv_attempts_avg", "dlv_defer_rate", "dlv_return_time", "dlv_b2b_success", "dlv_otp_fail_rate", "dlv_parcels_per_job", "dlv_stops_per_hour", "dlv_leg_ratio"]) expect(by(ks, k).value, k).toBeNull();
    expect(by(ks, "dlv_created").value).toBe(0);
  });
  it("counts are 0 and the comparison stays empty without a comparison period", () => {
    const g = parseFilters({ preset: "30d", compare: "none" }, NOW);
    const ks = deliveryKpis(facts({ flow: flow({ created: [7, null] }) as never }), g);
    expect(by(ks, "dlv_created")).toMatchObject({ value: 7, prev: null, delta: null });
  });
});

const group = (o: Partial<GroupRow> & Pick<GroupRow, "dim" | "key">): GroupRow => ({ name: null, delivered: 0, failed: 0, resolved: 0, prevDelivered: null, prevResolved: null, avgSecs: null, ...o });
describe("rankings", () => {
  const rows = [
    group({ dim: "company", key: "a", name: "Alpha", delivered: 95, failed: 5, resolved: 100 }), group({ dim: "company", key: "b", name: "Beta", delivered: 60, failed: 40, resolved: 100 }),
    group({ dim: "company", key: "c", name: "Tiny", delivered: 0, failed: 3, resolved: 3 }), group({ dim: "company", key: "d", name: "Delta", delivered: 18, failed: 2, resolved: 20 }),
    group({ dim: "city", key: "riyadh", delivered: 10, failed: 0, resolved: 10 }),
  ];
  it("the weakest groups skip anything below the minimum volume and come lowest first", () => {
    const w = worstOf(rows);
    expect(w.company.map((g) => g.key)).toEqual(["b", "d", "a"]);
    expect(w.company.some((g) => g.resolved < MIN_VOLUME)).toBe(false);
    expect(w.driver).toEqual([]);
    expect(worstOf(rows, 1).company).toHaveLength(1);
  });
  it("breakdowns list the busiest group first", () => { expect(busiest(rows, "company").map((g) => g.key)).toEqual(["a", "b", "d", "c"]); expect(busiest(rows, "driver")).toEqual([]); });
  it("success is delivered ÷ resolved, null when nothing is resolved", () => { expect(successOf(rows[0])).toBe(0.95); expect(successOf(group({ dim: "city", key: "x" }))).toBeNull(); });
});

describe("insights", () => {
  const input = (kpiOver: Record<string, [number | null, number | null]> = {}, over = {}) => {
    const ks = deliveryKpis(facts(), f);
    const kpis = ks.map((k) => (kpiOver[k.key] ? { ...k, value: kpiOver[k.key][0], prev: kpiOver[k.key][1], delta: kpiOver[k.key][0] == null || kpiOver[k.key][1] == null ? null : kpiOver[k.key][0]! - kpiOver[k.key][1]!, deltaPct: null } : k));
    return { kpis, reasons: [{ reason: "wrong_address", n: 8 }, { reason: "closed", n: 4 }], groups: [] as GroupRow[], failHeat: { cells: Array.from({ length: 7 }, () => Array<number>(24).fill(0)), total: 0 }, samples: { distance: 60, otp: 60 }, ...over };
  };
  it("flags low success, the top failure reason, wrong codes and far deliveries with their placeholders", () => {
    const out = deliveryInsights(input({ delivery_success: [0.8, 0.9], dlv_otp_fail_rate: [0.2, 0.1] }));
    const keys = out.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["rpf.ins_success_low", "rpd.ins_top_reason", "rpd.ins_otp", "rpd.ins_far", "rpd.ins_defer", "rpf.ins_pp_down"]));
    expect(out.find((i) => i.key === "rpd.ins_top_reason")).toMatchObject({ refs: { reason: "stopfail.wrong_address" }, vars: { n: 66.7 } });
    expect(out.length).toBeLessThanOrEqual(10);
  });
  it("does not talk about a rate it has too few samples for", () => {
    const keys = deliveryInsights(input({}, { samples: { distance: 3, otp: 2 } })).map((i) => i.key);
    expect(keys).not.toContain("rpd.ins_far"); expect(keys).not.toContain("rpd.ins_otp");
  });
  it("says so when there are only a handful of parcels", () => {
    const small = Object.fromEntries(Object.keys(flow()).map((k) => [k, P(1, 0)]));
    expect(deliveryInsights({ ...input(), kpis: deliveryKpis(facts({ flow: small as never }), f) }).map((i) => i.key)).toContain("rpd.ins_sparse");
  });
  it("names the weakest company and city that have enough volume", () => {
    const groups = [group({ dim: "company", key: "b", name: "Beta", delivered: 60, failed: 40, resolved: 100 }), group({ dim: "city", key: "jeddah", delivered: 20, failed: 20, resolved: 40 }), group({ dim: "city", key: "riyadh", delivered: 38, failed: 2, resolved: 40 })];
    const out = deliveryInsights(input({}, { groups }));
    expect(out.find((i) => i.key === "rpd.ins_worst_company")).toMatchObject({ vars: { name: "Beta", n: 60 } });
    expect(out.find((i) => i.key === "rpd.ins_worst_city")).toMatchObject({ refs: { city: "city.jeddah" } });
  });
});

describe("display helpers", () => {
  const t = (k: string, v?: Record<string, string | number>) => (k === "stopfail.refused" ? "Refused" : k.startsWith("rpf.hist_lt") ? `Under ${v?.to}` : k === "rpf.hist_range" ? `${v?.from} – ${v?.to}` : k === "rpf.hist_gte" ? `${v?.from}+` : k === "rpd.metres" ? `${v?.n} m` : k === "rpd.attempts_n_plus" ? `${v?.n}+` : k === "rpf.not_specified" ? "Not specified" : k);
  it("a failure reason is translated, an unknown one is shown as stored", () => { expect(reasonLabel("refused", t)).toBe("Refused"); expect(reasonLabel("weird", t)).toBe("weird"); });
  it("labels the histograms of durations, distances and attempts", () => {
    const h = [{ from: null, to: 900, count: 1 }, { from: 900, to: 1800, count: 2 }, { from: 1800, to: null, count: 3 }];
    expect(histBuckets(h, "duration", t, "en").map((b) => b.label)).toEqual(["Under 15 min", "15 min – 30 min", "30 min+"]);
    expect(histBuckets([{ from: null, to: 25, count: 1 }, { from: 1000, to: null, count: 1 }], "distance", t, "en").map((b) => b.label)).toEqual(["Under 25 m", "1,000 m+"]);
    expect(histBuckets([{ from: null, to: 1, count: 0 }, { from: 1, to: 2, count: 5 }, { from: 3, to: null, count: 1 }], "attempts", t, "en").map((b) => b.label)).toEqual(["0", "1", "3+"]);
  });
  it("group labels: names for accounts, translated keys for cities and services, a placeholder for an unset vehicle", () => {
    expect(groupLabel({ dim: "company", key: "abc", name: "Alpha" }, t)).toBe("Alpha");
    expect(groupLabel({ dim: "driver", key: "12345678-aaaa", name: null }, t)).toBe("12345678…");
    expect(groupLabel({ dim: "vehicle", key: "", name: null }, t)).toBe("Not specified");
    expect(groupLabel({ dim: "city", key: "tabuk2", name: null }, t, (k) => (k === "tabuk2" ? "Tabuk North" : undefined))).toBe("Tabuk North");
  });
  it("rows of a breakdown carry share, links and the change against the previous period", () => {
    const rows = groupRows([group({ dim: "company", key: "a", name: "Alpha", delivered: 9, failed: 1, resolved: 10, prevResolved: 5 }), group({ dim: "city", key: "riyadh", delivered: 1, failed: 0, resolved: 1 })], t, "en");
    expect(rows[0]).toMatchObject({ value: 10, prev: 5, href: "/admin/companies/a" }); expect(rows[0].share).toBeCloseTo(10 / 11); expect(rows[1].href).toBeUndefined();
    expect(worstRows([group({ dim: "driver", key: "d", name: "Dan", delivered: 1, failed: 9, resolved: 10 })], t, "en")[0]).toMatchObject({ value: 0.1, href: "/admin/drivers/d", tone: "danger" });
  });
  it("success per bucket is a gap where nothing was resolved", () => {
    const s = successSeries([{ t: "a", delivered: 3, failed: 1, returned: 0 }, { t: "b", delivered: 0, failed: 0, returned: 0 }], null);
    expect(s.data).toEqual([{ t: "a", success: 0.75 }, { t: "b", success: null }]); expect(s.prev).toBeNull();
  });
  it("the matrix gets an 'other' column only when some row has other reasons", () => {
    expect(matrixColumns(["a", "b"], [{ by: { a: 1 } }])).toEqual(["a", "b"]);
    expect(matrixColumns(["a", "b"], [{ by: { other_reasons: 2 } }])).toEqual(["a", "b", "other_reasons"]);
    expect(matrixColumns(["a", "other"], [{ by: { other: 2 } }])).toEqual(["a", "other"]); // a real reason called "other" is not the "other reasons" column
  });
});

describe("age buckets", () => {
  it("0–1, 2–3, 4–7, 8–14 and 15+ days", () => {
    expect([0, 1, 2, 3, 4, 7, 8, 14, 15, 90].map(ageKeyOf)).toEqual(["d0_1", "d0_1", "d2_3", "d2_3", "d4_7", "d4_7", "d8_14", "d8_14", "d15", "d15"]);
    expect(AGE_KEYS).toHaveLength(5);
  });
});
