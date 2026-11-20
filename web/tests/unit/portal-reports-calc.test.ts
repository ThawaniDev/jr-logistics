/** Pure logic of the company and courier-office reports: forecast, driver flags, performers, distributions, insights and the KPI builders (null / zero / sparse cases). */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/server/settings", () => ({ getSettings: async () => ({ lateGraceMin: 15, cities: [] }) }));
vi.mock("@/server/office", () => ({ officeReport: async () => ({}) }));
import { coachFlags, distributions, driverFlags, fleetTotals, forecastSpend, performers, successRate, MIN_VOLUME, type DriverScore } from "@/server/analytics/portal-calc";
import { businessInsights, earningsInsights, officeInsights, spendingInsights, swingInsights } from "@/server/analytics/portal-insights";
import { add, kpisFrom, perBucket, ratio, stock } from "@/server/analytics/portal-kpis";
import { businessOverviewKpis } from "@/server/analytics/portal-company";
import { deliveriesKpis, spendingKpis } from "@/server/analytics/portal-company-reports";
import { officeOverviewKpis } from "@/server/analytics/portal-office";
import { driversKpis, earningsKpis } from "@/server/analytics/portal-office-reports";
import { makeKpi } from "@/server/analytics/kpi";
import { pivotRows } from "@/server/analytics/portal-series";
import { OTHER_KEY } from "@/server/analytics/portal-constants";
import { parseFilters } from "@/server/analytics/filters";

const NOW = new Date("2026-11-19T10:00:00Z");
const F = parseFilters({ preset: "30d" }, NOW), FN = parseFilters({ preset: "30d", compare: "none", city: "riyadh" }, NOW);
const P = (cur: number | null, prev: number | null = null) => ({ cur, prev });
const drv = (o: Partial<DriverScore> = {}): DriverScore => ({ id: "d", name: "Omar", linked: false, jobs: 0, completed: 0, noShow: 0, cancelled: 0, replaced: 0, resolved: 0, delivered: 0, failed: 0, returned: 0, onTime: 0, due: 0, earnings: 0, offersMade: 0, offersAccepted: 0, ratingSum: 0, ratingN: 0, ...o });

describe("forecast of the next 30 days", () => {
  it("is the average daily run-rate of the last 28 days times 30, with the weekly range around it", () => {
    const daily = [...Array(28)].map((_, i) => (i < 21 ? 1000 : 3000));
    const f = forecastSpend(daily)!;
    expect(f.perDay).toBeCloseTo((21 * 1000 + 7 * 3000) / 28, 6);
    expect(f.total).toBeCloseTo(f.perDay * 30, 6);
    expect(f.low).toBeCloseTo((7000 / 7) * 30, 6); expect(f.high).toBeCloseTo((21000 / 7) * 30, 6);
    expect(f.low).toBeLessThanOrEqual(f.total); expect(f.high).toBeGreaterThanOrEqual(f.total);
    expect(f).toMatchObject({ basisDays: 28, activeDays: 28, horizon: 30 });
  });
  it("refuses to guess with too little history, and ignores bad numbers", () => {
    expect(forecastSpend([])).toBeNull();
    expect(forecastSpend(Array(28).fill(0))).toBeNull();
    expect(forecastSpend([...Array(26).fill(0), 500, 700])).toBeNull(); // only 2 days with spend
    expect(forecastSpend([...Array(25).fill(0), 500, 700, 900])).not.toBeNull();
    expect(forecastSpend([NaN, -5, ...Array(26).fill(100)])!.activeDays).toBe(26);
    expect(forecastSpend(Array(6).fill(100))).toBeNull(); // under a week is not a run-rate
  });
});

describe("driver scorecards", () => {
  it("flags only what has enough volume behind it", () => {
    expect(driverFlags(drv({ resolved: 4, delivered: 1 }))).toEqual([]); // 25% success but only 4 parcels
    expect(driverFlags(drv({ resolved: MIN_VOLUME.parcels, delivered: 8, jobs: 5 }))).toEqual(["low_success"]);
    expect(driverFlags(drv({ due: 2, onTime: 0 }))).toEqual([]);
    expect(driverFlags(drv({ due: 4, onTime: 2, jobs: 4 }))).toEqual(["late"]);
    expect(driverFlags(drv({ jobs: 20, noShow: 1 }))).toEqual([]); expect(driverFlags(drv({ jobs: 20, noShow: 2 }))).toEqual(["no_shows"]); expect(driverFlags(drv({ jobs: 5, noShow: 1 }))).toEqual(["no_shows"]);
    expect(driverFlags(drv({ jobs: 30, cancelled: 3 }))).toEqual(["cancellations"]); expect(driverFlags(drv({ jobs: 5, cancelled: 1 }))).toEqual(["cancellations"]);
    expect(driverFlags(drv({ ratingN: 2, ratingSum: 4 }))).toEqual([]); expect(driverFlags(drv({ ratingN: 4, ratingSum: 12 }))).toEqual(["low_rating"]);
    expect(driverFlags(drv({ offersMade: 4, offersAccepted: 0 }))).toEqual([]); expect(driverFlags(drv({ offersMade: 10, offersAccepted: 3, jobs: 3 }))).toEqual(["low_acceptance"]);
  });
  it("an idle driver is reported but is not a coaching case", () => {
    const idle = drv({ linked: true });
    expect(driverFlags(idle)).toEqual(["idle"]); expect(coachFlags(idle)).toEqual([]);
    expect(driverFlags(drv({ linked: false }))).toEqual([]); // a driver who left is not "idle"
    expect(driverFlags(drv({ linked: true, jobs: 1 }))).toEqual([]); expect(driverFlags(drv({ linked: true, offersMade: 1 }))).toEqual([]);
  });
  it("ranks only drivers above the minimum volume, best first and worst first, and counts the rest", () => {
    const list = [
      drv({ id: "a", resolved: 50, delivered: 49 }), drv({ id: "b", resolved: 10, delivered: 10 }), drv({ id: "c", resolved: 30, delivered: 20 }), drv({ id: "d", resolved: 9, delivered: 0 }), drv({ id: "e", resolved: 0 }),
      drv({ id: "f", resolved: 20, delivered: 10 }),
    ];
    const p = performers(list, 2);
    expect(p.top.map((d) => d.id)).toEqual(["b", "a"]); // b is perfect; a has more volume but 98%
    expect(p.bottom.map((d) => d.id)).toEqual(["f", "c"]);
    expect(p.ranked).toBe(4); expect(p.belowGuard).toBe(1); // d has parcels but too few; e has none and is not counted
    expect(successRate(drv({ resolved: 0 }))).toBeNull();
  });
  it("breaks ties by volume: the larger sample ranks higher among the best and lower among the worst", () => {
    const list = [drv({ id: "s", resolved: 12, delivered: 12 }), drv({ id: "l", resolved: 90, delivered: 90 }), drv({ id: "x", resolved: 12, delivered: 6 }), drv({ id: "y", resolved: 90, delivered: 45 })];
    const p = performers(list, 4);
    expect(p.top.map((d) => d.id).slice(0, 2)).toEqual(["l", "s"]);
    expect(p.bottom.map((d) => d.id).slice(0, 2)).toEqual(["y", "x"]);
  });
  it("builds the distributions from drivers that qualify and the fleet totals the KPI row needs", () => {
    const list = [drv({ id: "a", jobs: 0 }), drv({ id: "b", jobs: 12, resolved: 20, delivered: 19, ratingN: 5, ratingSum: 24, noShow: 1, offersMade: 4, offersAccepted: 3 }), drv({ id: "c", jobs: 12, resolved: 4, delivered: 1, cancelled: 4 })];
    const d = distributions(list);
    expect(d.jobs.map((b) => b.count)).toEqual([1, 0, 0, 0, 2, 0]); // 0 | 1 | 2–4 | 5–9 | 10–19 | 20+
    expect(d.success.reduce((s, b) => s + b.count, 0)).toBe(1); // only b has 10 resolved parcels
    expect(d.rating.reduce((s, b) => s + b.count, 0)).toBe(1);
    const t = fleetTotals(list);
    expect(t).toMatchObject({ drivers: 3, active: 2, jobs: 24, noShow: 1, cancelled: 4, offersMade: 4, offersAccepted: 3, ratingSum: 24, ratingN: 5 });
    expect(t.coach).toBe(1); // c: 4 cancellations (33%); b: 95% success, rating 4.8, one no-show in 12 jobs is under the limit
  });
});

describe("spend pivot (the stacked trend by vehicle or city)", () => {
  const keys = ["2026-11-01", "2026-11-02", "2026-11-03"];
  it("keeps the biggest keys as series, sums the rest into one, and fills every bucket", () => {
    const r = pivotRows([
      { t: "2026-11-01", k: "riyadh", spend: 500 }, { t: "2026-11-03", k: "riyadh", spend: 300 }, { t: "2026-11-02", k: "jeddah", spend: 400 },
      { t: "2026-11-02", k: "abha", spend: 50 }, { t: "2026-11-03", k: "tabuk", spend: 20 }, { t: "2026-11-01", k: null, spend: 10 },
    ], keys, 2);
    expect(r.series).toEqual([{ field: "s0", key: "riyadh" }, { field: "s1", key: "jeddah" }, { field: "other", key: OTHER_KEY }]);
    expect(r.points).toEqual([{ t: "2026-11-01", s0: 500, s1: 0, other: 10 }, { t: "2026-11-02", s0: 0, s1: 400, other: 50 }, { t: "2026-11-03", s0: 300, s1: 0, other: 20 }]);
    // nothing is lost: the pivot adds up to the input
    expect(r.points.reduce((s, p) => s + (p.s0 as number) + (p.s1 as number) + (p.other as number), 0)).toBe(500 + 300 + 400 + 50 + 20 + 10);
  });
  it("has no 'other' series when everything fits, treats a missing vehicle as its own key, and survives an empty period", () => {
    const r = pivotRows([{ t: "2026-11-02", k: "", spend: 70 }, { t: "2026-11-02", k: "sedan", spend: 30 }], keys, 6);
    expect(r.series.map((x) => x.key)).toEqual(["", "sedan"]); expect(r.points[1]).toEqual({ t: "2026-11-02", s0: 70, s1: 30 });
    expect(pivotRows([], keys)).toEqual({ series: [], points: keys.map((t) => ({ t })) });
    expect(pivotRows([{ t: "2026-11-02", k: "x", spend: 0 }], keys).series).toEqual([]); // zero spend is not a series
  });
});

describe("KPI builders", () => {
  it("ratio / add / stock keep 'no data' as null", () => {
    expect(ratio(P(1, 2), P(0, 4))).toEqual({ cur: null, prev: 0.5 }); expect(ratio(P(null), P(5))).toEqual({ cur: null, prev: null });
    expect(add(P(1, null), P(2, null))).toEqual({ cur: 3, prev: null }); expect(add(P(1, 1), P(2, null))).toEqual({ cur: 3, prev: 1 });
    expect(stock(7)).toEqual({ cur: 7, prev: null }); expect(perBucket([1, 2], [0, 4])).toEqual([null, 0.5]);
  });
  it("kpisFrom skips missing entries and flags the filters that cannot narrow a KPI", () => {
    const k = kpisFrom(FN, [["biz_wallet_balance", stock(500)], null, false, ["biz_topups", P(1000, 800)]]);
    expect(k.map((x) => x.key)).toEqual(["biz_wallet_balance", "biz_topups"]);
    expect(k[0].unfiltered).toEqual(["city"]); // a balance is not narrowed by city
    expect(kpisFrom(F, [["biz_wallet_balance", stock(500)]])[0].unfiltered).toBeUndefined();
    expect(k[1]).toMatchObject({ value: 1000, prev: 800, delta: 200, unit: "money" });
  });
  const parcels = { sent: P(120, 100), delivered: P(90, 80), failed: P(6, 4), returned: P(4, 2), first: P(81, 60), resolved: P(100, 86), deferred: P(10, 6), otp_issue: P(5, 5), p50: P(5400, 7200) };
  const spend = { spend: P(250_000, 200_000), orders: P(10, 8), parcel_spend: P(180_000, 150_000), parcel_units: P(900, 800) };
  const cod = { collected: P(80_000, 50_000), received: P(60_000, 40_000), outstanding: 20_000, jobs: 3 };
  it("the company overview computes every ratio from the same facts", () => {
    const k = businessOverviewKpis({ req: { created: P(40, 30), cancelled: P(4, 6), completed: P(30, 20), funnel: [] }, parcels, start: { on_time: P(9, 6), due: P(10, 8) }, fill: { avg: P(1800, 3600), n: 5, p50: 1, p90: 2, histogram: [] }, spend, cod }, F);
    const by = Object.fromEntries(k.map((x) => [x.key, x]));
    expect(by.delivery_success.value).toBeCloseTo(90 / 100, 9); expect(by.first_attempt.value).toBeCloseTo(81 / 90, 9); expect(by.cancellation_rate.value).toBeCloseTo(0.1, 9);
    expect(by.on_time_start.value).toBe(0.9); expect(by.time_to_fill.value).toBe(1800);
    expect(by.biz_spend.value).toBe(250_000); expect(by.biz_avg_order.value).toBe(25_000); expect(by.biz_cost_per_parcel.value).toBe(200);
    expect(by.biz_cod_outstanding).toMatchObject({ value: 20_000, prev: null, delta: null }); // a stock has no comparison
    expect(by.biz_parcels_failed.delta).toBe(2); expect(k.length).toBe(17);
  });
  it("a failed fact removes only its own cards", () => {
    const k = businessOverviewKpis({ req: null, parcels, start: null, fill: null, spend: null, cod }, F).map((x) => x.key);
    expect(k).toContain("parcels_delivered"); expect(k).toContain("biz_cod_collected"); expect(k).not.toContain("biz_spend"); expect(k).not.toContain("biz_requests"); expect(k).not.toContain("on_time_start");
  });
  it("an empty period gives null percentages and 0 counts, never 0%", () => {
    const zero = { sent: P(0), delivered: P(0), failed: P(0), returned: P(0), first: P(0), resolved: P(0), deferred: P(0), otp_issue: P(0), p50: P(null) };
    const k = Object.fromEntries(deliveriesKpis(F, { parcels: zero, sms: { sent: P(0), failed: P(0) }, returns: { n: 0 } }).map((x) => [x.key, x]));
    expect(k.delivery_success.value).toBeNull(); expect(k.biz_deferred_rate.value).toBeNull(); expect(k.biz_delivery_time.value).toBeNull(); expect(k.biz_sms_failure_rate.value).toBeNull();
    expect(k.parcels_delivered.value).toBe(0); expect(k.biz_returns_outstanding.value).toBe(0);
  });
  it("deliveries and spending KPIs", () => {
    const d = Object.fromEntries(deliveriesKpis(F, { parcels, sms: { sent: P(200, 150), failed: P(10, 3) }, returns: { n: 7 } }).map((x) => [x.key, x]));
    expect(d.biz_deferred_rate.value).toBe(0.1); expect(d.biz_otp_issue_rate.value).toBe(0.05); expect(d.biz_sms_failure_rate.value).toBeCloseTo(0.05, 9); expect(d.biz_delivery_time).toMatchObject({ value: 5400, prev: 7200, unit: "duration" });
    const s = Object.fromEntries(spendingKpis(F, { spend, inv: { invoiced: P(240_000, 190_000), vat: P(31_304, 24_782), n: P(9, 7) }, cod, wallet: { topups: P(300_000, 100_000), charges: P(0), available: -50_000, reserved: 0, held: 0, creditLimit: 200_000, creditUsed: 50_000 }, forecast: { total: 270_000 } }).map((x) => [x.key, x]));
    expect(s.biz_credit_usage.value).toBe(0.25); expect(s.biz_wallet_balance.value).toBe(-50_000); expect(s.biz_forecast.value).toBe(270_000); expect(s.biz_orders_billed.value).toBe(10);
    const noLimit = spendingKpis(F, { spend: null, inv: null, cod: null, wallet: { topups: P(0), charges: P(0), available: 100, reserved: 0, held: 0, creditLimit: 0, creditUsed: 0 }, forecast: null });
    expect(noLimit.find((x) => x.key === "biz_credit_usage")!.value).toBeNull(); // no credit facility: "no data", not 0%
  });
  const jobs = { jobs: P(40, 30), completed: P(30, 20), no_show: P(2, 3), cancelled: P(3, 1), replaced: P(1, 0), drivers: P(8, 6), fleet_active: P(7, 6), made: P(50, 40), taken: P(40, 30), on_time: P(30, 20), due: P(36, 25) };
  it("the office overview and drivers KPIs", () => {
    const k = Object.fromEntries(officeOverviewKpis({ jobs, parcels, rating: { sum: P(90, 40), n: P(20, 10) }, earn: { earned: P(100_000, 80_000), settled: P(30, 20), parcel_cents: P(0), parcel_units: P(0), paid: P(90_000, 70_000), pay_secs: P(0), pay_n: P(0) }, pending: { cents: 12_000 }, fleet: { total: 10 } }, F).map((x) => [x.key, x]));
    expect(k.off_completion_rate.value).toBeCloseTo(30 / 36, 5); expect(k.off_utilisation.value).toBe(0.7); expect(k.off_utilisation.prev).toBe(0.6); expect(k.off_rating.value).toBe(4.5); expect(k.off_rating.unit).toBe("rate");
    expect(k.off_pending).toMatchObject({ value: 12_000, prev: null }); expect(k.active_drivers.value).toBe(8);
    const d = Object.fromEntries(driversKpis(F, { jobs, parcels, rating: null, coach: 3 }).map((x) => [x.key, x]));
    expect(d.off_acceptance_rate.value).toBe(0.8); expect(d.off_no_show_rate.value).toBe(0.05); expect(d.off_cancel_rate.value).toBeCloseTo(0.075, 9); expect(d.off_avg_jobs.value).toBe(5); expect(d.off_coach.value).toBe(3); expect(d.off_rating).toBeUndefined();
  });
  it("the earnings KPIs", () => {
    const e = Object.fromEntries(earningsKpis(F, { earn: { earned: P(100_000, 80_000), settled: P(20, 16), parcel_cents: P(60_000, 40_000), parcel_units: P(300, 250), paid: P(90_000, 70_000), pay_secs: P(7200, 3600), pay_n: P(4, 2) }, pending: { cents: 5000 }, wd: { paid: P(50_000, 0), asked: P(60_000, 0), pendingCents: 10_000, pendingN: 1, available: 33_000, held: 10_000 } }).map((x) => [x.key, x]));
    expect(e.off_avg_per_job.value).toBe(5000); expect(e.off_avg_per_parcel.value).toBe(200); expect(e.off_time_to_pay.value).toBe(1800); expect(e.off_time_to_pay.prev).toBe(1800); expect(e.off_wallet.value).toBe(33_000); expect(e.off_withdrawals_pending.value).toBe(10_000);
  });
});

describe("insights", () => {
  const kpi = (key: string, value: number | null, prev: number | null) => makeKpi(key, value, prev);
  const heat = { cells: Array.from({ length: 7 }, () => Array(24).fill(0)), total: 0 };
  it("says the failure rate of a city rose, only with volume in both periods", () => {
    const base = { kpis: [kpi("biz_requests", 50, 40)], reasons: [], codOutstanding: 0, returnsOutstanding: 0, heat };
    const rose = businessInsights({ ...base, cities: [{ key: "jeddah", resolved: 40, failed: 12, prevResolved: 30, prevFailed: 3 }, { key: "riyadh", resolved: 100, failed: 5, prevResolved: 90, prevFailed: 4 }] });
    expect(rose.find((i) => i.key === "rpr.ins_city_fail_up")).toMatchObject({ refs: { city: "city.jeddah" }, vars: { now: 30, before: 10 }, tone: "bad" });
    const thin = businessInsights({ ...base, cities: [{ key: "jeddah", resolved: 8, failed: 6, prevResolved: 30, prevFailed: 3 }] });
    expect(thin.some((i) => i.key.startsWith("rpr.ins_city_fail"))).toBe(false); // 8 parcels is too few to say anything
    const worst = businessInsights({ ...base, cities: [{ key: "dammam", resolved: 20, failed: 4, prevResolved: null, prevFailed: null }] });
    expect(worst.find((i) => i.key === "rpr.ins_city_fail_high")).toMatchObject({ vars: { n: 20, failed: 4, total: 20 } });
  });
  it("names the main failure reason, the cash still out and the returns waiting; amounts are flagged as money", () => {
    const i = businessInsights({ kpis: [kpi("biz_requests", 3, null)], cities: [], reasons: [{ key: "unreachable", count: 6 }, { key: "refused", count: 2 }], codOutstanding: 12_345, returnsOutstanding: 4, heat });
    expect(i[0]).toMatchObject({ key: "rpf.ins_sparse", vars: { n: 3 } });
    expect(i.find((x) => x.key === "rpr.ins_top_reason")).toMatchObject({ refs: { reason: "stopfail.unreachable" }, vars: { n: 75 } });
    expect(i.find((x) => x.key === "rpr.ins_cod_outstanding")).toMatchObject({ vars: { amount: 12_345 }, money: ["amount"] });
    expect(i.find((x) => x.key === "rpr.ins_returns_waiting")!.vars).toEqual({ n: 4 });
    expect(businessInsights({ kpis: [kpi("delivery_success", 0.97, null)], cities: [], reasons: [{ key: "other", count: 3 }], codOutstanding: 0, returnsOutstanding: 0, heat }).some((x) => x.key === "rpr.ins_top_reason")).toBe(false); // too few failures
  });
  it("swings are the two biggest movements; unchanged and tiny numbers say nothing", () => {
    const s = swingInsights([kpi("biz_spend", 150, 100), kpi("biz_requests", 12, 10), kpi("delivery_success", 0.8, 0.9), kpi("parcels_delivered", 3, 2)]);
    expect(s.map((x) => x.key)).toEqual(["rpf.ins_swing_up", "rpf.ins_pp_down"]); // +50% spend (neutral) outranks −10 points of success
    expect(s[0]).toMatchObject({ tone: "info", vars: { n: 50 } }); expect(s[1]).toMatchObject({ tone: "bad", vars: { n: 10 } }); // spend going up is neither good nor bad
  });
  it("office and spending insights", () => {
    const list = [drv({ id: "a", name: "Ali", delivered: 60, resolved: 62, jobs: 20 }), drv({ id: "b", delivered: 20, resolved: 20, jobs: 8 }), drv({ id: "c", jobs: 0, linked: true }), drv({ id: "d", jobs: 5, cancelled: 3 })];
    const o = officeInsights({ kpis: [kpi("off_jobs", 33, 20), kpi("off_no_show_rate", 0.12, 0.1)], drivers: list, pendingCents: 7000 });
    const keys = o.map((x) => x.key);
    expect(keys).toContain("rpr.ins_idle"); expect(keys).toContain("rpr.ins_coach"); expect(keys).toContain("rpr.ins_no_show"); expect(keys).toContain("rpr.ins_pending_pay");
    expect(o.find((x) => x.key === "rpr.ins_concentration")).toMatchObject({ vars: { name: "Ali", n: 75 }, href: "/office/drivers/a" });
    expect(earningsInsights({ kpis: [], pendingCents: 0 })).toEqual([]);
    expect(spendingInsights({ kpis: [], creditUsage: 0.85, forecastTotal: 1000 }).map((x) => x.key)).toEqual(["rpr.ins_credit_high", "rpr.ins_forecast"]);
    expect(spendingInsights({ kpis: [], creditUsage: null, forecastTotal: null })).toEqual([]);
  });
});
