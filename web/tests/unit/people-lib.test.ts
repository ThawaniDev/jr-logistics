/**
 * Pure logic of the people reports (companies, drivers, offices, growth): the health score, segments, concentration, cohorts, reliability rules, heatmap slot maths,
 * funnels, backlog buckets, insights and the KPI builders (null / zero cases included). No database.
 */
import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { parseFilters } from "@/server/analytics/filters";
import { allKpiDefs, kpiConflicts } from "@/server/analytics/definitions";
import {
  buildCohorts, companyInsights, emptySeries, HEALTH, safely, healthBand, healthScore, healthSql, pareto, ratioPair, ratioSeries, RISK, segmentOf, SEGMENT_EDGES, sumPairs, twin, twinOrZero, zeroPair, asOfWindow, priorWindow,
} from "@/server/analytics/companies-lib";
import { COMPANY_KPI_KEYS, companyKpis } from "@/server/analytics/companies-kpis";
import { averageAvailable, bandMatrix, driverInsights, FLAG_ORDER, FLAG_SQL, FLAGS, flagReasonSql, flagsOf, slotCounts } from "@/server/analytics/drivers-lib";
import { DRIVER_KPI_KEYS, driverKpis } from "@/server/analytics/drivers-kpis";
import { OFFICE_KPI_KEYS, officeKpis } from "@/server/analytics/offices-kpis";
import { BACKLOG_EDGES, backlogBuckets, docsSubmittedSql, funnelOf, growthInsights, REQUIRED_DOCS, stickiness } from "@/server/analytics/growth-lib";
import { GROWTH_KPI_KEYS, growthKpis } from "@/server/analytics/growth-kpis";

const dialect = new PgDialect();
const text = (q: ReturnType<typeof sql>) => dialect.sqlToQuery(q).sql.replace(/\s+/g, " ").trim();
const NOW = new Date("2026-11-19T10:00:00Z");
const P = (cur: number | null, prev: number | null = null) => ({ cur, prev });
const by = (kpis: Array<{ key: string }>, key: string) => kpis.find((k) => k.key === key) as { key: string; value: number | null; prev: number | null; delta: number | null; parts?: Array<{ key: string; value: number }>; unfiltered?: string[] } | undefined;

describe("shared helpers", () => {
  it("pairs: ratios never turn missing data into 0, sums keep a missing comparison missing", () => {
    expect(ratioPair(P(1, 2), P(4, 0))).toEqual({ cur: 0.25, prev: null });
    expect(ratioPair(P(null, null), P(4, 4))).toEqual({ cur: null, prev: null });
    expect(zeroPair(P(null, 3))).toEqual({ cur: 0, prev: 3 });
    expect(sumPairs(P(1, null), P(2, null))).toEqual({ cur: 3, prev: null });
    expect(sumPairs(P(1, 5), P(2, null))).toEqual({ cur: 3, prev: 5 });
  });
  it("twin always emits the previous-period column (NULL without a comparison) so CTEs can reference it", () => {
    const m = { n: (w: (c: string) => ReturnType<typeof sql>) => sql`count(*) filter (where ${w("x.at")})::int` };
    const withPrev = text(twin(parseFilters({}, NOW), m)), without = text(twin(parseFilters({ compare: "none" }, NOW), m));
    expect(withPrev).toContain("as n_c"); expect(withPrev).toContain("as n_p"); expect(withPrev).not.toContain("null::float8 as n_p");
    expect(without).toContain("as n_c"); expect(without).toContain("null::float8 as n_p");
    expect(() => twin(parseFilters({}, NOW), { badName: m.n })).toThrow(/snake_case/);
    expect(text(twinOrZero(parseFilters({ compare: "none" }, NOW), "b", ["req"]))).toBe("coalesce(b.req_c, 0) as req_c, null::float8 as req_p");
    expect(text(twinOrZero(parseFilters({}, NOW), "b", ["req"]))).toBe("coalesce(b.req_c, 0) as req_c, coalesce(b.req_p, 0) as req_p");
  });
  it("point-in-time numbers are read at the end of the period or now, whichever is earlier; a missing comparison falls back to the period before", () => {
    const f = parseFilters({ from: "2026-01-01", to: "2026-01-31", compare: "none" }, NOW);
    expect(asOfWindow(f.cur, NOW).toISOString()).toBe(f.cur.end.toISOString());
    const running = parseFilters({}, NOW);
    expect(asOfWindow(running.cur, NOW).getTime()).toBe(NOW.getTime());
    expect(priorWindow(f)).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(priorWindow(running)).toBe(running.prev);
  });
  it("ratioSeries forms per-bucket ratios and leaves a gap where the denominator is 0", () => {
    const s = { fields: ["a", "b"] as const, points: [{ t: "1", a: 1, b: 4 }, { t: "2", a: 0, b: 0 }], prev: null };
    const r = ratioSeries(s as never, { rate: ["a", "b"] });
    expect(r.fields).toEqual(["rate"]); expect(r.points).toEqual([{ t: "1", rate: 0.25 }, { t: "2", rate: null }]); expect(r.prev).toBeNull();
  });
});

describe("sections fail independently", () => {
  it("a failing section is logged, named by its title key and replaced by its fallback; the others are untouched", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed: string[] = [];
    expect(await safely(failed, "rpp.cmp_cohorts", async () => { throw new Error("canceling statement due to statement timeout"); }, { rows: [], maxK: 0 })).toEqual({ rows: [], maxK: 0 });
    expect(await safely(failed, "rpp.cmp_wallets", async () => 41 + 1, 0)).toBe(42);
    expect(failed).toEqual(["rpp.cmp_cohorts"]);
    expect(spy).toHaveBeenCalledTimes(1); expect(String(spy.mock.calls[0][0])).toContain("rpp.cmp_cohorts");
    spy.mockRestore();
  });
  it("an empty series has a zero point for every bucket of the period and of the comparison period", () => {
    const s = emptySeries(parseFilters({ preset: "7d" }, NOW), ["a", "b"] as const);
    expect(s.points).toHaveLength(7); expect(s.prev).toHaveLength(7); expect(s.points[0]).toEqual({ t: s.points[0].t, a: 0, b: 0 });
    expect(emptySeries(parseFilters({ preset: "7d", compare: "none" }, NOW), ["a"] as const).prev).toBeNull();
  });
});

describe("company health score", () => {
  const base = { silentDays: 0, orders: 10, days: 30, delivered: 10, resolved: 10, cancelled: 0, issues: 0 };
  it("is 100 for a perfect company and null for one that never ordered", () => {
    expect(healthScore(base)).toBe(100);
    expect(healthScore({ ...base, silentDays: null })).toBeNull();
  });
  it("weights recency, frequency, success, cancellations and support issues as published", () => {
    expect(HEALTH.recency + HEALTH.frequency + HEALTH.success + HEALTH.cancel + HEALTH.support).toBe(100);
    expect(healthScore({ ...base, delivered: 5 })).toBe(88);                     // success 0.5 costs 12.5 of 100
    expect(healthScore({ ...base, silentDays: 30 })).toBe(85);                   // recency 0.5 costs 15
    expect(healthScore({ ...base, orders: 2, delivered: 2, resolved: 2 })).toBe(90); // 2 requests a month against a target of 4: frequency 0.5
    expect(healthScore({ ...base, orders: 4, cancelled: 2, delivered: 4, resolved: 4, issues: 2 })).toBe(Math.round(100 * (30 + 20 + 25 + 15 * 0.5 + 10 * 0.5) / 100));
  });
  it("leaves a component without data out and rescales the others, so missing data is never a zero", () => {
    expect(healthScore({ ...base, resolved: 0, delivered: 0 })).toBe(100);
    expect(healthScore({ ...base, orders: 0, delivered: 0, resolved: 0, silentDays: 70 })).toBe(17); // only recency (0), frequency (0) and support (1): 10 / 60
  });
  it("frequency scales with the length of the period", () => {
    expect(healthScore({ ...base, orders: 4, days: 7, delivered: 4, resolved: 4 })).toBe(100);
    expect(healthScore({ ...base, orders: 4, days: 90, delivered: 4, resolved: 4 })).toBe(Math.round(100 - 20 * (1 - 4 / 12)));
  });
  it("bands: healthy from 70, watch from 40, risk below, none without a score", () => {
    expect([healthBand(100), healthBand(70), healthBand(69), healthBand(40), healthBand(39), healthBand(0), healthBand(null)]).toEqual(["healthy", "healthy", "watch", "watch", "risk", "risk", null]);
  });
  it("the SQL formula is built from the same constants", () => {
    const q = text(healthSql(30));
    expect(q).toContain(`${HEALTH.recency} * greatest(0, 1 - silent_c / ${HEALTH.silentDays}.0)`);
    expect(q).toContain(`${HEALTH.frequency} * least(1, req_c / (30.0 / 30 * ${HEALTH.ordersPer30d}))`);
    expect(q).toContain(`coalesce(${HEALTH.success} * succ_c, 0)`);
    expect(q).toContain(`coalesce(${HEALTH.cancel} * (1 - canc_c::float8 / nullif(req_c, 0)), 0)`);
    expect(q).toContain(`${HEALTH.support} * (1 - least(1, iss_c::float8 / greatest(req_c, 1)))`);
    expect(q).toContain(`/ (${HEALTH.recency + HEALTH.frequency + HEALTH.support} + case when succ_c is null then 0 else ${HEALTH.success} end + case when req_c > 0 then ${HEALTH.cancel} else 0 end)`);
    expect(text(healthSql(90))).toContain("(90.0 / 30 * 4)");
  });
});

describe("segments, concentration, cohorts", () => {
  it("size is parcels per 30 days: small under 100, medium under 500, large from 500", () => {
    expect([99, 100, 499, 500, 0].map(segmentOf)).toEqual(["small", "medium", "medium", "large", "small"]);
    expect(SEGMENT_EDGES).toEqual({ medium: 100, large: 500 });
  });
  it("pareto: share of the total and the running share; no total means no shares", () => {
    const rows = pareto([{ id: "a", name: "A", value: 60 }, { id: "b", name: "B", value: 30 }, { id: "c", name: "C", value: 10 }], 100);
    expect(rows.map((r) => r.share)).toEqual([0.6, 0.3, 0.1]); expect(rows.map((r) => r.cumulative)).toEqual([0.6, 0.9, 1]);
    expect(pareto([{ id: "a", name: "A", value: 5 }], 0)[0]).toMatchObject({ share: null, cumulative: null });
    expect(pareto([{ id: "a", name: "A", value: 120 }], 100)[0].cumulative).toBe(1); // never above 100 %
  });
  it("cohorts: months since signup, unobservable cells are null (not 0), observable but empty cells are 0", () => {
    const months = ["2026-01-01", "2026-02-01", "2026-03-01"];
    const raw = [
      { cohort: "2026-01-01", k: -1, n: 10 }, { cohort: "2026-01-01", k: 0, n: 8 }, { cohort: "2026-01-01", k: 1, n: 5 },
      { cohort: "2026-02-01", k: -1, n: 4 }, { cohort: "2026-02-01", k: 0, n: 4 }, { cohort: "2026-02-01", k: 1, n: 2 },
      { cohort: "2026-03-01", k: -1, n: 2 }, { cohort: "2026-03-01", k: 0, n: 1 },
    ];
    const c = buildCohorts(raw, months);
    expect(c.maxK).toBe(2);
    expect(c.rows.map((r) => r.size)).toEqual([10, 4, 2]);
    expect(c.rows[0].cells).toEqual([8, 5, 0]); // 2 months after January is observable (March) but nobody ordered
    expect(c.rows[1].cells).toEqual([4, 2, null]); expect(c.rows[2].cells).toEqual([1, null, null]);
    expect(buildCohorts([], months).rows.every((r) => r.size === 0)).toBe(true);
  });
  it("risk thresholds", () => { expect(RISK).toMatchObject({ atRiskFrom: 14, churnDays: [30, 60, 90], minOrders: 2 }); });
});

describe("company insights", () => {
  const input = { active: P(10, 8), churned: P(3, 1), atRisk: P(2, 1), newCompanies: P(6, 2), returning: P(4, 6), repeat: P(3, 4), apiShare: P(0, null), creditUtil: 0.9, verified: 0.5, activeCount: 10,
    top: { name: "Acme", id: "x", share: 0.45 }, top10Share: 0.85, lowHealth: 3, liveCount: 10, unverified: 4 };
  it("says what stands out, in priority order, at most eight", () => {
    const keys = companyInsights(input).map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["rpp.ins_top_company", "rpp.ins_churn_up", "rpp.ins_at_risk", "rpp.ins_mostly_new", "rpp.ins_repeat_low", "rpp.ins_health_low", "rpp.ins_api_none", "rpp.ins_credit_high"]));
    expect(keys.length).toBeLessThanOrEqual(8); // the ninth and tenth observations (top 10, unverified) are cut
    expect(companyInsights({ ...input, activeCount: 12, top: null, churned: P(0, 0), atRisk: P(0, 0), newCompanies: P(0, 0), repeat: P(12, 12), lowHealth: 0, apiShare: P(0.3, null), creditUtil: null }).map((i) => i.key)).toEqual(["rpp.ins_top10", "rpp.ins_unverified"]);
    expect(companyInsights(input)[0]).toMatchObject({ key: "rpp.ins_top_company", vars: { name: "Acme", n: 45 }, href: "/admin/companies/x" });
  });
  it("is quiet when nothing stands out, and warns about thin data", () => {
    expect(companyInsights({ ...input, churned: P(0, 0), atRisk: P(0, 0), newCompanies: P(1, 1), repeat: P(9, 9), apiShare: P(0.3, null), creditUtil: null, top: null, top10Share: 0.2, lowHealth: 0, unverified: 0 })).toEqual([]);
    expect(companyInsights({ ...input, activeCount: 2, top: null })[0]).toMatchObject({ key: "rpp.ins_sparse", vars: { n: 2 } });
  });
});

describe("company KPIs", () => {
  const summary = {
    active: P(10, 8), newCompanies: P(3, 2), returning: P(7, 6), atRisk: P(2, 1), repeat: P(6, 4), churn: { 30: P(5, 4), 60: P(3, 2), 90: P(1, 1) } as Record<number, { cur: number | null; prev: number | null }>, verified: 8, located: 5,
    totals: { req: P(100, 80), canc: P(10, 4), api: P(25, 20), deliv: P(180, 150), fail: P(10, 10), ret: P(10, 0), reg: P(300, 200), cod: P(60, 40), gmv: P(500_000, 400_000), ord: P(90, 70) },
    health: { buckets: [], live: 0, low: 0, avg: null },
  };
  const f = parseFilters({}, NOW);
  it("shows every KPI in grid order, with the arithmetic of the definitions", () => {
    const k = companyKpis(summary as never, P(86_400, 172_800), 0.4, f, true);
    expect(k.map((x) => x.key)).toEqual([...COMPANY_KPI_KEYS]);
    expect(by(k, "active_companies")).toMatchObject({ value: 10, prev: 8, delta: 2 });
    expect(by(k, "cmp_orders_per")).toMatchObject({ value: 10, prev: 10 }); expect(by(k, "cmp_parcels_per")).toMatchObject({ value: 30, prev: 25 });
    expect(by(k, "delivery_success")).toMatchObject({ value: 0.9, prev: 0.9375 }); expect(by(k, "cancellation_rate")).toMatchObject({ value: 0.1, prev: 0.05 });
    expect(by(k, "cmp_cod_share")).toMatchObject({ value: 0.2, prev: 0.2 }); expect(by(k, "cmp_api_share")).toMatchObject({ value: 0.25 }); expect(by(k, "cmp_repeat")).toMatchObject({ value: 0.6, prev: 0.5 });
    expect(by(k, "aov")?.value).toBeCloseTo(500_000 / 90, 2); expect(by(k, "gmv")).toMatchObject({ value: 500_000, prev: 400_000 });
    expect(by(k, "cmp_order_gap")).toMatchObject({ value: 86_400, prev: 172_800 }); expect(by(k, "cmp_credit_util")).toMatchObject({ value: 0.4, prev: null });
  });
  it("churn is the 60-day count with the 30 / 60 / 90 day counts as parts; coverage KPIs have no previous value", () => {
    const k = companyKpis(summary as never, P(null), null, f, true);
    expect(by(k, "cmp_churned")).toMatchObject({ value: 3, prev: 2, parts: [{ key: "d30", value: 5 }, { key: "d60", value: 3 }, { key: "d90", value: 1 }] });
    expect(by(k, "cmp_verified")).toMatchObject({ value: 0.8, prev: null }); expect(by(k, "cmp_located")).toMatchObject({ value: 0.5, prev: null });
    expect(by(k, "cmp_order_gap")?.value).toBeNull(); expect(by(k, "cmp_credit_util")?.value).toBeNull();
  });
  it("drops the money KPIs (not zeroes them) without finance access", () => {
    const keys = companyKpis(summary as never, P(null), null, f, false).map((x) => x.key);
    for (const m of ["gmv", "aov", "cmp_credit_util"]) expect(keys).not.toContain(m);
    expect(keys).toContain("cmp_new");
  });
  it("empty selections give null ratios, never 0 %", () => {
    const empty = { ...summary, active: P(0, 0), totals: Object.fromEntries(Object.keys(summary.totals).map((n) => [n, P(0, 0)])), verified: 0, located: 0 };
    const k = companyKpis(empty as never, P(null), null, f, true);
    for (const key of ["cmp_orders_per", "cmp_cod_share", "cmp_api_share", "cmp_repeat", "delivery_success", "cancellation_rate", "cmp_verified", "aov"]) expect(by(k, key)?.value, key).toBeNull();
  });
  it("tells which active filters cannot narrow a KPI", () => {
    const k = companyKpis(summary as never, P(null), 0.4, parseFilters({ city: "riyadh", company: "0b8f3d3e-7b53-4c36-9f0c-6a8f0d2a7a11" }, NOW), true);
    expect(by(k, "cmp_credit_util")?.unfiltered).toEqual(["city"]); expect(by(k, "cmp_new")?.unfiltered).toBeUndefined();
  });
});

describe("driver reliability rules", () => {
  const ok = { suspended: false, answered: 10, accepted: 9, jobsAccepted: 10, cancelled: 0, noShow: 0, due: 10, onTime: 10, ratings: 5, ratingSum: 25, resolved: 20, delivered: 20 };
  it("flags nothing for a good driver and nothing without enough volume", () => {
    expect(flagsOf(ok)).toEqual([]);
    expect(flagsOf({ ...ok, answered: 4, accepted: 0, jobsAccepted: 4, cancelled: 4, due: 4, onTime: 0, ratings: 2, ratingSum: 2, resolved: 9, delivered: 0 })).toEqual([]);
  });
  it("each rule trips at its threshold and the most serious comes first", () => {
    expect(flagsOf({ ...ok, jobsAccepted: 10, cancelled: 1, noShow: 1 })).toEqual(["high_cancel"]); // 20 % ≥ 15 %
    expect(flagsOf({ ...ok, jobsAccepted: 20, cancelled: 2, noShow: 1 })).toEqual(["high_cancel"]); // exactly 15 %
    expect(flagsOf({ ...ok, jobsAccepted: 20, cancelled: 2, noShow: 0 })).toEqual([]);
    expect(flagsOf({ ...ok, resolved: 20, delivered: 15 })).toEqual(["low_success"]);
    expect(flagsOf({ ...ok, due: 10, onTime: 5 })).toEqual(["low_ontime"]);
    expect(flagsOf({ ...ok, answered: 10, accepted: 3 })).toEqual(["low_acceptance"]);
    expect(flagsOf({ ...ok, ratings: 4, ratingSum: 12 })).toEqual(["low_rating"]);
    expect(flagsOf({ ...ok, suspended: true, accepted: 1, due: 10, onTime: 0 })).toEqual(["suspended", "low_ontime", "low_acceptance"]);
    expect(FLAG_ORDER[0]).toBe("suspended");
  });
  it("the SQL rules use the same thresholds and a flag order that matches", () => {
    expect(text(FLAG_SQL.high_cancel)).toContain(`acc_c >= ${FLAGS.volume}`); expect(text(FLAG_SQL.high_cancel)).toContain(`>= ${FLAGS.cancel}`);
    expect(text(FLAG_SQL.low_success)).toContain(`>= ${FLAGS.successMin}`); expect(text(FLAG_SQL.low_success)).toContain(`< ${FLAGS.success}`);
    expect(text(FLAG_SQL.low_rating)).toContain(`rn_c >= ${FLAGS.ratingMin}`); expect(text(FLAG_SQL.low_rating)).toContain(`< ${FLAGS.rating}`);
    const reason = text(flagReasonSql());
    expect(FLAG_ORDER.map((f) => reason.indexOf(`'${f}'`))).toEqual([...FLAG_ORDER.map((f) => reason.indexOf(`'${f}'`))].sort((a, b) => a - b));
  });
});

describe("availability heatmap maths", () => {
  const H = 3_600_000;
  const sunday = Date.UTC(2026, 0, 3, 21, 0, 0); // Sunday 4 Jan 2026, 00:00 in Riyadh
  it("a whole Riyadh week has one slot in every weekday × hour cell", () => {
    const c = slotCounts(sunday, sunday + 7 * 24 * H);
    expect(c).toHaveLength(7); expect(c.every((r) => r.length === 24 && r.every((n) => n === 1))).toBe(true);
  });
  it("partly covered slots count partly, and the weekday follows Riyadh time (not UTC)", () => {
    const half = slotCounts(sunday, sunday + H / 2);
    expect(half[0][0]).toBe(0.5); expect(half.flat().reduce((s, n) => s + n, 0)).toBe(0.5);
    const odd = slotCounts(sunday + H / 2, sunday + 2 * H);
    expect(odd[0][0]).toBe(0.5); expect(odd[0][1]).toBe(1);
    const sat = slotCounts(sunday - H, sunday); // 23:00–24:00 on Saturday in Riyadh
    expect(sat[6][23]).toBe(1);
  });
  it("average drivers available = available hours ÷ slots, one decimal, 0 where the slot never occurred", () => {
    const hours = Array.from({ length: 7 }, () => Array<number>(24).fill(0)); hours[0][8] = 7; hours[1][9] = 3;
    const slots = Array.from({ length: 7 }, () => Array<number>(24).fill(0)); slots[0][8] = 4; slots[1][9] = 0;
    const avg = averageAvailable(hours, slots);
    expect(avg[0][8]).toBe(1.8); expect(avg[1][9]).toBe(0); expect(avg[2][2]).toBe(0);
  });
  it("band matrix adds counts and ignores bands outside the grid", () => {
    const m = bandMatrix([{ a: 0, c: 0, n: 2 }, { a: 0, c: 0, n: 3 }, { a: 3, c: 3, n: 1 }, { a: 9, c: 0, n: 5 }, { a: 0, c: -1, n: 5 }], 4, 4);
    expect(m[0][0]).toBe(5); expect(m[3][3]).toBe(1); expect(m.flat().reduce((s, n) => s + n, 0)).toBe(6);
  });
});

describe("drivers KPIs and insights", () => {
  const f = parseFilters({}, NOW);
  const totals = { online: P(400 * 3600, 300 * 3600), jobs: P(80, 60), acc: P(100, 70), deliv: P(700, 500), fail: P(50, 40), ret: P(50, 10), ontime: P(70, 50), due: P(90, 70), accepted: P(60, 40), answered: P(100, 80), cancelled: P(8, 5), noshow: P(2, 1), replaced: P(5, 2), rn: P(40, 30), rsum: P(170, 120), earn: P(900_000, 600_000), busy: P(0, 0) };
  const facts = { summary: { active: P(20, 15), availableNow: 6, fleet: 50, fleetVerified: 40, suspendedNow: 2, flagged: 4, earners: P(18, 10), utilNum: P(100 * 3600, 90 * 3600), totals }, response: { p50: P(120, 150), p90: P(900, null) }, rating: { n: P(40, 30), sum: P(170, 120), stars: [0, 0, 0, 0, 0] }, suspensions: P(2, 1), churn: { churned: 3, wasActive: 15 }, cash: 5_000 };
  it("computes every driver KPI with its definition's arithmetic", () => {
    const k = driverKpis(facts as never, f, true);
    expect(k.map((x) => x.key)).toEqual([...DRIVER_KPI_KEYS]);
    expect(by(k, "flt_jobs_per")).toMatchObject({ value: 4, prev: 4 }); expect(by(k, "flt_parcels_per")).toMatchObject({ value: 35 });
    expect(by(k, "flt_success")?.value).toBeCloseTo(0.875, 5); expect(by(k, "on_time_start")?.value).toBeCloseTo(70 / 90, 5);
    expect(by(k, "flt_acceptance")).toMatchObject({ value: 0.6, prev: 0.5 }); expect(by(k, "flt_cancel")).toMatchObject({ value: 0.1 }); expect(by(k, "flt_replaced")).toMatchObject({ value: 0.05 });
    expect(by(k, "flt_rating")).toMatchObject({ value: 4.25, prev: 4 }); expect(by(k, "flt_earn_per")).toMatchObject({ value: 50_000 });
    expect(by(k, "flt_earn_hour")).toMatchObject({ value: 2250 }); expect(by(k, "flt_util")?.value).toBeCloseTo(100 / 400, 5);
    expect(by(k, "flt_resp_p50")).toMatchObject({ value: 120, prev: 150 }); expect(by(k, "flt_churned")).toMatchObject({ value: 3, prev: null }); expect(by(k, "flt_cash")).toMatchObject({ value: 5000 });
    expect(by(k, "flt_strikes")).toMatchObject({ value: 8, prev: 5 }); expect(by(k, "flt_flagged")?.value).toBe(4);
  });
  it("omits earnings and cash without finance access and shows no ratio for an empty base", () => {
    const k = driverKpis({ ...facts, summary: { ...facts.summary, active: P(0, 0), totals: Object.fromEntries(Object.keys(totals).map((n) => [n, P(0, 0)])) } } as never, f, false);
    const keys = k.map((x) => x.key);
    for (const m of ["flt_earn_per", "flt_earn_hour", "flt_cash"]) expect(keys).not.toContain(m);
    for (const key of ["flt_jobs_per", "flt_success", "on_time_start", "flt_acceptance", "flt_cancel", "flt_rating", "flt_util"]) expect(by(k, key)?.value, key).toBeNull();
  });
  it("availability KPIs say which filters cannot narrow them", () => {
    const k = driverKpis(facts as never, parseFilters({ service: "delivery_driver", driver: "0b8f3d3e-7b53-4c36-9f0c-6a8f0d2a7a11" }, NOW), true);
    expect(by(k, "flt_online_hours")?.unfiltered).toEqual(["service"]); expect(by(k, "flt_available")?.unfiltered).toEqual(["service"]);
  });
  it("insights: only what the numbers support", () => {
    const quiet = { active: P(10), acceptance: P(0.9), success: P(0.97), cancel: P(0.02), onTime: P(0.95), utilisation: P(0.6), churned: 0, flagged: 0, activeCount: 10, availableNow: 4, heatPeak: null, lowRatingShare: 0.05, suspensions: P(0), cash: 0 };
    expect(driverInsights(quiet)).toEqual([]);
    const loud = driverInsights({ ...quiet, acceptance: P(0.5), cancel: P(0.2), success: P(0.8), onTime: P(0.7), utilisation: P(0.1), churned: 2, flagged: 3, availableNow: 0, heatPeak: { day: 0, hour: 9 }, lowRatingShare: 0.3, suspensions: P(1), cash: 10 }).map((i) => i.key);
    expect(loud).toEqual(expect.arrayContaining(["rpp.ins_drv_flagged", "rpp.ins_drv_acceptance_low", "rpp.ins_drv_cancel_high", "rpp.ins_drv_success_low"]));
    expect(loud.length).toBeLessThanOrEqual(8);
    expect(driverInsights({ ...quiet, activeCount: 1 })[0]).toMatchObject({ key: "rpp.ins_drv_sparse", vars: { n: 1 } });
  });
});

describe("offices KPIs", () => {
  const f = parseFilters({}, NOW);
  const totals = { acc: P(50, 40), jobs: P(40, 30), due: P(30, 20), ontime: P(24, 10), deliv: P(300, 200), fail: P(20, 20), ret: P(10, 0), rn: P(10, 8), rsum: P(45, 32), earned: P(800_000, 500_000), paid: P(600_000, 400_000), links: P(4, 2), unlinks: P(1, 3) };
  const summary = { offices: 4, active: P(3, 2), fleet: 20, fleetVerified: 18, fleetAvailable: 7, pending: 120_000, utilNum: P(12, 9), totals, agreements: [{ key: "accepted", value: 3 }, { key: "pending_acceptance", value: 1 }, { key: "expired", value: 0 }, { key: "none", value: 0 }] };
  it("computes every office KPI, in grid order", () => {
    const k = officeKpis(summary as never, P(14, 11), f, true);
    expect(k.map((x) => x.key)).toEqual([...OFFICE_KPI_KEYS]);
    expect(by(k, "cof_active")).toMatchObject({ value: 3, prev: 2 }); expect(by(k, "cof_active_drivers")).toMatchObject({ value: 14, prev: 11 });
    expect(by(k, "cof_success")?.value).toBeCloseTo(300 / 330, 5); expect(by(k, "cof_ontime")).toMatchObject({ value: 0.8, prev: 0.5 }); expect(by(k, "cof_rating")).toMatchObject({ value: 4.5, prev: 4 });
    expect(by(k, "cof_util")).toMatchObject({ value: 0.6, prev: null }); expect(by(k, "cof_pending")).toMatchObject({ value: 120_000 }); expect(by(k, "cof_agreed")).toMatchObject({ value: 0.75 });
    expect(by(k, "cof_links")).toMatchObject({ value: 4, prev: 2 }); expect(by(k, "cof_unlinks")).toMatchObject({ value: 1, prev: 3 });
  });
  it("earnings, payouts and the pending amount are omitted without finance access; no offices means no agreement share", () => {
    const keys = officeKpis(summary as never, P(1), f, false).map((x) => x.key);
    for (const m of ["cof_earned", "cof_paid", "cof_pending"]) expect(keys).not.toContain(m);
    expect(by(officeKpis({ ...summary, offices: 0 } as never, P(0), f, true), "cof_agreed")?.value).toBeNull();
  });
});

describe("growth: funnels, backlog, stickiness, KPIs and insights", () => {
  it("required documents come from the catalogue", () => {
    expect(REQUIRED_DOCS.driver).toEqual(["national_id", "driving_license", "vehicle_registration"]); expect(REQUIRED_DOCS.business).toEqual(["business_cr"]); expect(REQUIRED_DOCS.office).toEqual(["office_cr", "office_license"]);
    const q = text(docsSubmittedSql("u"));
    expect(q).toContain(">= 3"); expect(q).toContain("'national_id'"); expect(q).toContain("when 'business'");
  });
  it("funnel steps never grow, branches are kept as they are", () => {
    const f = funnelOf({ role: "driver", registered: 10, docs: 12, verified: 4, rejected: 2, info: 1, pending: 3 });
    expect(f.steps.map((s) => s.count)).toEqual([10, 10, 4]); expect(f.branches).toEqual({ rejected: 2, info: 1, pending: 3 });
    expect(funnelOf({ role: "office", registered: 0, docs: 0, verified: 0, rejected: 0, info: 0, pending: 0 }).steps.map((s) => s.count)).toEqual([0, 0, 0]);
  });
  it("backlog buckets: one per age band, counts added across roles", () => {
    const b = backlogBuckets([{ b: 0, n: 2 }, { b: 0, n: 3 }, { b: 4, n: 1 }]);
    expect(b).toHaveLength(BACKLOG_EDGES.length + 1); expect(b.map((x) => x.count)).toEqual([5, 0, 0, 0, 1]);
    expect(b[0]).toMatchObject({ from: null, to: 1 }); expect(b[4]).toMatchObject({ from: 14, to: null });
  });
  it("stickiness is day ÷ month, null without a month", () => { expect(stickiness(10, 40)).toBe(0.25); expect(stickiness(0, 0)).toBeNull(); expect(stickiness(null, 5)).toBeNull(); });

  const cur = { dau: 20, wau: 60, mau: 100, roles: {} as never };
  const facts = {
    mix: { roles: { business: P(10, 5), driver: P(20, 10), office: P(2, 1) }, sources: [{ key: "self", value: 30, prev: 14 }, { key: "admin", value: 2, prev: 2 }], cities: [{ key: "riyadh", value: 25 }], totalCities: 3 },
    funnel: { roles: [], rate: P(0.5, 0.4), verified: P(16, 6), registered: P(32, 16) }, ver: { n: P(16, 6), p50: P(86_400, 172_800), p90: P(259_200, null), byRole: [] },
    drvAct: { verified: P(10, 8), activated: P(6, 4), firstJob: P(3600, 7200) }, coAct: { registered: P(10, 5), ordered: P(7, 3), completed: P(5, 2), firstOrder: P(1800, null), toComplete: P(86_400, null) },
    docs: { types: [], rejected: P(4, 2), decided: P(20, 10), reasons: [] }, logins: { clients: [], methods: [], failures: [], attempts: P(200, 100), failed: P(10, 10) },
    active: { cur, prev: { dau: 10, wau: 50, mau: 80, roles: {} as never } }, backlog: { total: 5, oldestDays: 9, medianAgeSeconds: 3 * 86_400, buckets: [], roles: [] }, stalled: { total: 4, reasons: [] },
  };
  it("computes every growth KPI with its definition's arithmetic", () => {
    const k = growthKpis(facts as never, parseFilters({}, NOW));
    expect(k.map((x) => x.key)).toEqual([...GROWTH_KPI_KEYS]);
    expect(by(k, "new_signups")).toMatchObject({ value: 32, prev: 16, parts: [{ key: "business", value: 10 }, { key: "driver", value: 20 }, { key: "office", value: 2 }] });
    expect(by(k, "gro_verify_rate")).toMatchObject({ value: 0.5, prev: 0.4 }); expect(by(k, "gro_doc_reject")).toMatchObject({ value: 0.2, prev: 0.2 });
    expect(by(k, "gro_company_activation")).toMatchObject({ value: 0.7 }); expect(by(k, "gro_driver_activation")).toMatchObject({ value: 0.6, prev: 0.5 });
    expect(by(k, "gro_dau")).toMatchObject({ value: 20, prev: 10 }); expect(by(k, "gro_stickiness")).toMatchObject({ value: 0.2, prev: 0.125 });
    expect(by(k, "gro_login_fail")).toMatchObject({ value: 0.05, prev: 0.1 }); expect(by(k, "gro_backlog")).toMatchObject({ value: 5, prev: null }); expect(by(k, "gro_backlog_age")?.value).toBe(3 * 86_400);
    expect(by(k, "gro_stalled")?.value).toBe(4);
  });
  it("without a comparison the previous values are null, and empty bases give no rate", () => {
    const k = growthKpis({ ...facts, mix: { ...facts.mix, roles: { business: P(0), driver: P(0), office: P(0) } }, active: { cur: { dau: 0, wau: 0, mau: 0, roles: {} as never }, prev: null }, logins: { ...facts.logins, attempts: P(0), failed: P(0) },
      coAct: { ...facts.coAct, registered: P(0), ordered: P(0) } } as never, parseFilters({ compare: "none" }, NOW));
    expect(by(k, "new_signups")).toMatchObject({ value: 0, prev: null }); expect(by(k, "gro_dau")).toMatchObject({ value: 0, prev: null });
    expect(by(k, "gro_stickiness")?.value).toBeNull(); expect(by(k, "gro_login_fail")?.value).toBeNull(); expect(by(k, "gro_company_activation")?.value).toBeNull();
  });
  it("only the city filter narrows growth; the others are called out on the KPIs they cannot narrow", () => {
    const k = growthKpis(facts as never, parseFilters({ city: "riyadh", service: "delivery_driver" }, NOW));
    expect(by(k, "gro_verify_rate")?.unfiltered).toEqual(["service"]); expect(by(k, "gro_dau")?.unfiltered).toEqual(["city", "service"]);
    expect(by(k, "new_signups")?.unfiltered).toEqual(["service"]);
  });
  it("insights", () => {
    const quiet = { signups: P(10), signupsCount: 40, verifyRate: 0.9, ttvP90: 86_400, docReject: 0.1, backlog: 0, oldest: 0, stalled: 0, companyActivation: 0.8, driverActivation: 0.9, stickiness: 0.4, loginFail: 0.01, topSource: { key: "self", share: 0.5 }, topCity: { key: "riyadh", share: 0.4 } };
    expect(growthInsights(quiet)).toEqual([]);
    const loud = growthInsights({ ...quiet, verifyRate: 0.3, ttvP90: 5 * 86_400, docReject: 0.4, backlog: 7, oldest: 9, stalled: 3, companyActivation: 0.2, driverActivation: 0.3, stickiness: 0.05, loginFail: 0.3, topSource: { key: "seed", share: 0.95 }, topCity: { key: "riyadh", share: 0.9 } });
    expect(loud.map((i) => i.key)).toEqual(expect.arrayContaining(["rpp.ins_gro_backlog_old", "rpp.ins_gro_stalled", "rpp.ins_gro_verify_low", "rpp.ins_gro_ttv_slow", "rpp.ins_gro_reject_high"]));
    expect(loud.length).toBeLessThanOrEqual(8);
    expect(growthInsights({ ...quiet, backlog: 2, oldest: 2 })[0]).toMatchObject({ key: "rpp.ins_gro_backlog", tone: "info" });
    expect(growthInsights({ ...quiet, signupsCount: 2 })[0]).toMatchObject({ key: "rpp.ins_gro_sparse" });
  });
});

describe("KPI registry", () => {
  it("every people KPI is registered once with the rpp prefix, ratios say what they divide, and no key clashes with another report", () => {
    expect(kpiConflicts()).toEqual([]);
    const mine = allKpiDefs().filter((d) => d.label.startsWith("rpp."));
    expect(mine.length).toBeGreaterThanOrEqual(55);
    for (const d of mine) {
      expect(d.label, d.key).toBe(`rpp.kpi_${d.key}`); expect(d.definition, d.key).toBe(`rpp.def_${d.key}`);
      if (d.unit === "percent" || d.numerator) { expect(d.numerator, d.key).toBe(`rpp.def_${d.key}_n`); expect(d.denominator, d.key).toBe(`rpp.def_${d.key}_d`); }
    }
    for (const k of ["flt_earn_per", "flt_earn_hour", "flt_cash", "cmp_credit_util", "cof_earned", "cof_paid", "cof_pending"]) expect(mine.find((d) => d.key === k)?.money, k).toBe(true);
  });
});
