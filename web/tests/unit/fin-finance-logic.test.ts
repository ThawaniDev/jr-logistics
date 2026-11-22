import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { parseFilters } from "@/server/analytics/filters";
import { financeKpis, lastValue, marginOutliers, topShare, waterfall, type FinanceFacts } from "@/server/analytics/finance-kpis";
import { FINANCE_KPI_GROUPS } from "@/server/analytics/finance-defs";
import { financeInsights } from "@/server/analytics/finance-insights";
import { payeeScope } from "@/server/analytics/finance-facts";
import { emptyPairs, emptySeries, makeKpis, sectionGuard } from "@/server/analytics/finance-core";
import type { CompanyRow } from "@/server/analytics/finance-series";
import { creditRows, kpiPick, marginPct, marginPctSeries, marginRows, outlierRows, pipelineRows, refundRows, topCompanyRows, waterfallBars, withdrawalRows } from "@/components/reports/fin/fin-lib";

const NOW = new Date("2026-11-19T10:00:00Z");
const ID = "0b8f3d3e-7b53-4c36-9f0c-6a8f0d2a7a11";
const render = (q: SQL) => new PgDialect().sqlToQuery(q);
const P = (cur: number | null, prev: number | null = null) => ({ cur, prev });
const f = parseFilters({ preset: "30d" }, NOW);
const co = (id: string, billed: number, margin: number, n = 5, prevBilled: number | null = null): CompanyRow => ({ id, name: id.toUpperCase(), billed, prevBilled, provider: billed - margin, margin, vat: Math.round((billed * 15) / 115), n });
const COMPANIES = [co("a", 60_000, 12_000), co("b", 30_000, 3_000), co("c", 10_000, 4_000, 2), ...Array.from({ length: 10 }, (_, i) => co(`z${i}`, 1_000, 200))];
const facts = (): FinanceFacts => ({
  settle: { billed: P(100_000, 80_000), vat: P(13_043, 10_435), provider: P(70_000, 56_000), margin: P(30_000, 24_000), office: P(40_000, 30_000), direct: P(30_000, 26_000), refund: P(2_000, 1_000), n: P(20, 16), orders: P(18, 14) } as never,
  parcels: P(150, 110), latency: { avg: P(7200, 9000), p50: P(3600), p90: P(20_000), paid_n: P(18) } as never, pipeline: { unpaid: 6, held: 2 },
  wd: { req_n: P(5, 4), req_c: P(50_000, 40_000), paid_n: P(3, 2), paid_c: P(30_000, 20_000), rej_n: P(1, 1), rej_c: P(5_000, 3_000), avg: P(86_400, 100_000), p50: P(80_000), p90: P(200_000), pending: { n: 2, cents: 15_000, oldestSecs: 4 * 86_400 } } as never,
  ledger: { topup: P(200_000, 150_000), topup_n: P(9, 7), adj_in: P(5_000, 0), adj_out: P(2_000, 1_000), cancel: P(8_000, 6_000), cancel_n: P(2, 1), rental: P(5_000, 0), rental_n: P(1, 0) } as never, invoices: { n: P(18, 14), sub: P(80_000), vat: P(10_000), total: P(90_000, 70_000) } as never,
  closing: { liability: P(500_000, 400_000), escrow: P(60_000, 50_000), cash: P(20_000, null) }, credit: { used: 40_000, limit: 100_000 }, companies: COMPANIES,
});
const by = (ks: ReturnType<typeof financeKpis>, key: string) => ks.find((k) => k.key === key)!;

describe("financeKpis", () => {
  it("builds every registered KPI of the report", () => {
    const ks = financeKpis(facts(), f);
    expect(ks.map((k) => k.key).sort()).toEqual(Object.values(FINANCE_KPI_GROUPS).flat().sort());
    expect(kpiPick(ks, FINANCE_KPI_GROUPS.revenue).map((k) => k.key)).toEqual([...FINANCE_KPI_GROUPS.revenue]);
  });
  it("splits the billed amount into VAT, provider cost and margin consistently", () => {
    const ks = financeKpis(facts(), f);
    expect(by(ks, "fin_billed")).toMatchObject({ value: 100_000, prev: 80_000 });
    expect(by(ks, "fin_net_sales").value).toBe(100_000 - 13_043);
    expect(by(ks, "fin_net_position")).toMatchObject({ value: 30_000 - 13_043, prev: 24_000 - 10_435 });
    expect(by(ks, "fin_margin_pct").value).toBe(0.3);
    expect(by(ks, "fin_aov").value).toBeCloseTo(100_000 / 18, 3);
    expect(by(ks, "fin_rev_per_parcel").value).toBe(200);
    expect(by(ks, "fin_payout_office").value! + by(ks, "fin_payout_direct").value!).toBe(by(ks, "fin_provider").value);
    expect(by(ks, "fin_adjustments").value).toBe(3_000);
    expect(by(ks, "fin_settle_latency").value).toBe(7200);
    expect(by(ks, "fin_credit_util").value).toBe(0.4);
    expect(by(ks, "fin_wd_pending")).toMatchObject({ value: 15_000, prev: null });
    expect(by(ks, "fin_cash_drivers")).toMatchObject({ value: 20_000, prev: null });
  });
  it("is empty (null) where nothing was billed or settled, and says which filters cannot narrow a balance", () => {
    const x = facts(); x.settle = Object.fromEntries(Object.keys(x.settle).map((k) => [k, P(0, 0)])) as never; x.parcels = P(0, 0); x.latency = { avg: P(null, null) } as never; x.credit = { used: 0, limit: 0 };
    const g = parseFilters({ preset: "30d", city: "riyadh", company: ID }, NOW);
    const ks = financeKpis(x, g);
    for (const k of ["fin_margin_pct", "fin_aov", "fin_rev_per_request", "fin_rev_per_parcel", "fin_concentration", "fin_settle_latency", "fin_credit_util"]) expect(by(ks, k).value, k).toBeNull();
    expect(by(ks, "fin_billed").value).toBe(0);
    expect(by(ks, "fin_wallet_liability").unfiltered).toEqual(["city", "company"]);
    expect(by(ks, "fin_wd_requested").unfiltered).toEqual(["city", "company"]);
    expect(by(ks, "fin_billed").unfiltered).toBeUndefined();
  });
});

describe("pure finance helpers", () => {
  it("top-N share of the billed amount, each period by its own ranking", () => {
    const rows = [co("a", 60, 1, 5, 10), co("b", 30, 1, 5, 70), co("c", 10, 1, 5, 20)];
    expect(topShare(rows, P(100, 100), 2)).toEqual({ cur: 0.9, prev: 0.9 });
    expect(topShare(rows, P(0, null), 2)).toEqual({ cur: null, prev: null });
    expect(topShare([co("a", 60, 1)], P(100, null), 5).prev).toBeNull();
  });
  it("margin outliers need volume and a 10-point gap, lowest and highest first", () => {
    const o = marginOutliers(COMPANIES, 0.3);
    expect(o.low.map((c) => c.id)).toEqual(["b"]); // 10 %
    expect(o.high.map((c) => c.id)).toEqual([]); // c has 2 settlements: skipped
    expect(marginOutliers([co("h", 1000, 600)], 0.3).high[0]).toMatchObject({ id: "h", pct: 0.6 });
    expect(marginOutliers(COMPANIES, null)).toEqual({ low: [], high: [] });
  });
  it("a waterfall ends at the margin after VAT", () => {
    const w = waterfall(100_000, 13_043, 70_000);
    expect(w.map((s) => s.value)).toEqual([100_000, -13_043, -70_000, 16_957]);
    const bars = waterfallBars(w, (k) => k);
    expect(bars.map((b) => [b.low, b.high])).toEqual([[0, 100_000], [86_957, 100_000], [16_957, 86_957], [0, 16_957]]);
  });
  it("the closing balance is the last point that is not a gap", () => {
    expect(lastValue([{ a: 1 }, { a: 5 }, { a: null }], "a")).toBe(5);
    expect(lastValue([{ a: null }], "a")).toBeNull(); expect(lastValue(null, "a")).toBeNull();
  });
  it("margin percentage is a gap where nothing was billed", () => {
    expect(marginPct({ billed: 0, margin: 0 })).toBeNull(); expect(marginPct({ billed: 200, margin: 50 })).toBe(0.25);
    expect(marginPctSeries([{ t: "a", billed: 200, margin: 50 }, { t: "b", billed: 0, margin: 0 }], null).data).toEqual([{ t: "a", pct: 0.25 }, { t: "b", pct: null }]);
  });
  it("withdrawals are limited to their payee: only the driver and office filters narrow them", () => {
    expect(render(payeeScope(parseFilters({ city: "riyadh" }, NOW))).sql).toBe("true");
    const q = render(payeeScope(parseFilters({ driver: ID }, NOW)));
    expect(q.sql).toContain('"withdrawals"."user_id" in ($1)'); expect(q.params).toEqual([ID]);
  });
});

describe("insights", () => {
  it("raises concentration, held and old unpaid settlements, a slow withdrawal, high credit use and margin outliers", () => {
    const ks = financeKpis(facts(), f);
    const out = financeInsights({ kpis: ks, top: { id: "a", name: "A", billed: 60_000 }, totalBilled: 100_000, outliers: marginOutliers(COMPANIES, 0.3), credit: [{ id: "k", name: "K", used: 90, limit: 100, util: 0.9 }], oldestUnpaidDays: 9, wdOldestSecs: 4 * 86_400, wdPendingN: 2, companyCount: COMPANIES.length });
    const keys = out.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["rpf.ins_concentration_gmv", "rpd.ins_fin_held", "rpd.ins_fin_unpaid_old", "rpd.ins_fin_wd_slow", "rpd.ins_fin_credit", "rpd.ins_fin_margin_low"]));
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out.find((i) => i.key === "rpd.ins_fin_credit")).toMatchObject({ vars: { name: "K", n: 90 }, href: "/admin/companies/k" });
  });
  it("is quiet and honest when there is hardly any data", () => {
    const x = facts(); x.settle = { ...x.settle, n: P(2, 0) } as never; x.pipeline = { unpaid: 0, held: 0 };
    const out = financeInsights({ kpis: financeKpis(x, f), top: null, totalBilled: 0, outliers: { low: [], high: [] }, credit: [], oldestUnpaidDays: null, wdOldestSecs: 0, wdPendingN: 0, companyCount: 0 });
    expect(out.map((i) => i.key)).toContain("rpd.ins_fin_sparse"); expect(out.map((i) => i.key)).not.toContain("rpd.ins_fin_held");
  });
});

describe("display rows", () => {
  const t = (k: string, v?: Record<string, string | number>) => (v ? `${k}:${Object.values(v).join("|")}` : k);
  it("margin rows show the billed amount as the bar with its previous value, and a gap for an unset vehicle", () => {
    const r = marginRows([{ dim: "vehicle", key: "", billed: 100, prevBilled: 50, provider: 70, margin: 30, vat: 13, n: 2 }, { dim: "service", key: "delivery_driver", billed: 300, prevBilled: null, provider: 200, margin: 100, vat: 39, n: 5 }], t, "en");
    expect(r[0]).toMatchObject({ label: "rpf.not_specified", value: 100, prev: 50 }); expect(r[0].share).toBe(0.25); expect(r[1].prev).toBeNull();
  });
  it("company, credit, outlier, pipeline, withdrawal and refund rows", () => {
    expect(topCompanyRows([co("a", 100, 20, 3, 80)], t, "en")[0]).toMatchObject({ value: 100, prev: 80, href: "/admin/companies/a" });
    expect(creditRows([{ id: "k", name: null, used: 90, limit: 100, util: 0.9 }, { id: "j", name: "J", used: 1, limit: 100, util: 0.01 }], t, "en").map((r) => r.tone)).toEqual(["danger", undefined]);
    expect(outlierRows([{ id: "l", name: "L", billed: 100, margin: 10, pct: 0.1, diff: -0.2 }], t, "en")[0]).toMatchObject({ value: 0.1, tone: "danger" });
    expect(pipelineRows([{ key: "d0_1", n: 1, payoutCents: 0, heldN: 0, heldCents: 0 }, { key: "d2_3", n: 0, payoutCents: 0, heldN: 0, heldCents: 0 }, { key: "d4_7", n: 0, payoutCents: 0, heldN: 0, heldCents: 0 }, { key: "d8_14", n: 3, payoutCents: 5, heldN: 1, heldCents: 2 }, { key: "d15", n: 0, payoutCents: 0, heldN: 0, heldCents: 0 }], t, "en").map((r) => r.tone)).toEqual(["accent", "accent", "gold", "danger", "danger"]);
    expect(withdrawalRows([{ key: "paid", n: 2, cents: 30 }, { key: "pending", n: 1, cents: 70 }, { key: "rejected", n: 1, cents: 5 }], t, "en").map((r) => r.key)).toEqual(["pending", "paid", "rejected"]);
    expect(refundRows({ cancelCents: 1, cancelN: 2, settlementCents: 3, adjustmentsIn: 4, adjustmentsOut: 5 }, t).map((r) => r.value)).toEqual([1, 3, 4, 5]);
  });
});


describe("fault isolation", () => {
  it("a failing section becomes its fallback and is reported, the others are untouched", async () => {
    const { safe, failed } = sectionGuard();
    const quiet = console.error; console.error = () => {};
    try {
      const [a, b] = await Promise.all([safe("a", Promise.resolve(1), 0), safe("b", Promise.reject(new Error("statement timeout")), 99)]);
      expect([a, b]).toEqual([1, 99]); expect(failed).toEqual(["b"]);
    } finally { console.error = quiet; }
  });
  it("the facts of a failed section read as no data for both periods, and extra parts are kept", () => {
    const e = emptyPairs({ hist: [1], n: 0 });
    expect(e.anything).toEqual({ cur: null, prev: null }); expect(e.hist).toEqual([1]); expect(e.n).toBe(0);
    const ks = makeKpis(f, [["fin_billed", e.billed]]);
    expect(ks[0]).toMatchObject({ value: null, prev: null });
  });
  it("the series of a failed section has every bucket, as zeros or as gaps", () => {
    const s = emptySeries(f, ["a", "b"] as const);
    expect(s.points).toHaveLength(f.keys.length); expect(s.points[0]).toMatchObject({ a: 0, b: 0 }); expect(s.prev).toHaveLength(f.prevKeys!.length);
    expect(emptySeries(f, ["a"] as const, true).points[3]).toMatchObject({ a: null });
    expect(emptySeries(parseFilters({ compare: "none" }, NOW), ["a"] as const).prev).toBeNull();
  });
});
