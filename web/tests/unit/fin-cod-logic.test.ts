import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { parseFilters } from "@/server/analytics/filters";
import { codKpis, type CodFacts } from "@/server/analytics/cod-kpis";
import { COD_KPI_GROUPS } from "@/server/analytics/cod-defs";
import { codInsights } from "@/server/analytics/cod-insights";
import { cashWithBalance, withBalance } from "@/server/analytics/cod-series";
import { remitScope } from "@/server/analytics/cod-facts";
import { ageRows, holderRows, kpiPick } from "@/components/reports/fin/fin-lib";
import { pairOf } from "@/server/analytics/finance-core";

const NOW = new Date("2026-11-19T10:00:00Z");
const ID = "0b8f3d3e-7b53-4c36-9f0c-6a8f0d2a7a11";
const render = (q: SQL) => new PgDialect().sqlToQuery(q);
const P = (cur: number | null, prev: number | null = null) => ({ cur, prev });
const f = parseFilters({ preset: "30d" }, NOW);
const facts = (): CodFacts => ({
  parcels: { all_created: P(200, 150), created: P(50, 30), value_created: P(500_000, 240_000), delivered: P(40, 25), due: P(400_000, 200_000), got: P(400_000, 195_000), mismatch: P(2, 0), failed: P(6, 4), failed_value: P(60_000, 30_000), collected: P(400_000, 200_000), collected_n: P(40, 25) },
  remit: { remitted: P(300_000, 180_000), n: P(12, 9), by_business: P(7, 5), by_staff: P(5, 4), amt_business: P(180_000, 90_000), amt_staff: P(120_000, 90_000), lag_p50: P(86_400, 90_000), lag_p90: P(4 * 86_400, 3 * 86_400), hist: [], histN: 0 },
  outstanding: P(250_000, 100_000), aged: { orders: 3, cents: 80_000 }, holders: 4,
} as never);
const by = (ks: ReturnType<typeof codKpis>, key: string) => ks.find((k) => k.key === key)!;

describe("codKpis", () => {
  it("computes every KPI of the report with its stated numerator and denominator", () => {
    const ks = codKpis(facts(), f, true);
    expect(ks.map((k) => k.key).sort()).toEqual(Object.values(COD_KPI_GROUPS).flat().sort());
    expect(by(ks, "cod_collected")).toMatchObject({ value: 400_000, prev: 200_000 });
    expect(by(ks, "cod_remit_rate").value).toBe(0.75);
    expect(by(ks, "cod_avg_value").value).toBe(10_000);
    expect(by(ks, "cod_collection_rate").value).toBe(1);
    expect(by(ks, "cod_share").value).toBe(0.25);
    expect(by(ks, "cod_outstanding")).toMatchObject({ value: 250_000, prev: 100_000 });
    expect(by(ks, "cod_aged_value")).toMatchObject({ value: 80_000, prev: null });
    expect(by(ks, "cod_holders").value).toBe(4);
    expect(by(ks, "cod_lag_p90").value).toBe(4 * 86_400);
  });
  it("without finance access every amount is omitted (not zeroed) and the counts stay", () => {
    const ks = codKpis(facts(), f, false);
    const keys = ks.map((k) => k.key);
    for (const k of ["cod_collected", "cod_remitted", "cod_outstanding", "cod_remit_rate", "cod_avg_value", "cod_collection_rate", "cod_uncollected", "cod_aged_value"]) expect(keys).not.toContain(k);
    expect(keys).toEqual(expect.arrayContaining(["cod_parcels", "cod_share", "cod_failed", "cod_mismatch", "cod_aged_orders", "cod_holders", "cod_lag_p50", "cod_lag_p90"]));
    expect(kpiPick(ks, COD_KPI_GROUPS.cash)).toEqual([]);
  });
  it("is empty (null) where there is nothing to divide by", () => {
    const x = facts(); x.parcels.created = P(0, 0); x.parcels.due = P(0, 0); x.parcels.collected = P(0, 0); x.remit.lag_p50 = P(null, null);
    const ks = codKpis(x, f, true);
    for (const k of ["cod_avg_value", "cod_collection_rate", "cod_remit_rate", "cod_lag_p50"]) expect(by(ks, k).value, k).toBeNull();
    expect(by(ks, "cod_parcels").value).toBe(40);
  });
});

describe("running balance", () => {
  it("starts from the balance at the start of the period and adds collected minus received per bucket", () => {
    const pts = [{ t: "a", collected: 100, remitted: 0 }, { t: "b", collected: 50, remitted: 120 }, { t: "c", collected: 0, remitted: 0 }];
    expect(withBalance(pts, 30).map((p) => p.outstanding)).toEqual([130, 60, 60]);
    const s = cashWithBalance({ fields: ["collected", "remitted"], points: pts, prev: [{ t: "p", collected: 10, remitted: 4 }] }, 30, 5);
    expect(s.points[2].outstanding).toBe(60); expect(s.prev![0].outstanding).toBe(11);
    expect(cashWithBalance({ fields: ["collected", "remitted"], points: pts, prev: null }, 0, null).prev).toBeNull();
  });
});

describe("insights", () => {
  const holders = [{ key: "d1", name: "Dan", outstanding: 70_000, orders: 4, oldestDays: 9 }, { key: "d2", name: "Eli", outstanding: 30_000, orders: 1, oldestDays: 1 }];
  it("raises aged cash, mismatches, slow receipts, a low received-back rate and a dominant holder", () => {
    const ks = codKpis({ ...facts(), parcels: { ...facts().parcels, collected: P(1_000_000, 0) } } as never, f, true);
    const keys = codInsights({ kpis: ks, money: true, drivers: holders, alerts: [], outstanding: 100_000, collected: 1_000_000 }).map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["rpd.ins_cod_aged", "rpd.ins_cod_mismatch", "rpd.ins_cod_lag", "rpd.ins_cod_remit_low", "rpd.ins_cod_holder"]));
  });
  it("never mentions amounts to a viewer without finance access", () => {
    const keys = codInsights({ kpis: codKpis(facts(), f, false), money: false, drivers: holders, alerts: [], outstanding: 100_000, collected: 400_000 }).map((i) => i.key);
    expect(keys).not.toContain("rpd.ins_cod_remit_low"); expect(keys).not.toContain("rpd.ins_cod_holder"); expect(keys).toContain("rpd.ins_cod_aged");
  });
});

describe("filters and display", () => {
  it("the remittance table follows the request filters plus driver and office, all as bound parameters", () => {
    const q = render(remitScope(parseFilters({ city: "riyadh", driver: ID, office: ID }, NOW)));
    expect(q.sql).toContain('"requests"."delivery_city" in ($1)');
    expect(q.sql).toContain('"cod_remittances"."driver_id" in ($2)');
    expect(q.sql).toContain('"cod_remittances"."offer_id" in (select id from offers where office_id in');
    expect(q.sql).not.toContain("riyadh"); expect(q.params).toContain(ID);
    expect(render(remitScope(parseFilters({}, NOW))).sql).toBe("true");
  });
  const t = (k: string, v?: Record<string, string | number>) => (k.startsWith("rpd.age.") ? k.slice(8) : k === "rpd.holder_sub" ? `${v?.orders} orders, ${v?.age} d` : k);
  it("aging rows warn on old cash and show the amount only when given", () => {
    const r = ageRows([{ key: "d0_1", orders: 4, cents: 1000 }, { key: "d2_3", orders: 0 }, { key: "d4_7", orders: 1 }, { key: "d8_14", orders: 2 }, { key: "d15", orders: 3 }], t, "en");
    expect(r.map((x) => x.tone)).toEqual(["accent", "accent", "gold", "danger", "danger"]);
    expect(r[0].share).toBe(0.4); expect(r[0].sub).toBeTruthy(); expect(r[1].sub).toBeUndefined();
  });
  it("holder rows link to the account and flag old cash", () => {
    const r = holderRows([{ key: "d1", name: null, outstanding: 5, orders: 2, oldestDays: 9.7 }], "/admin/drivers/", "en", t);
    expect(r[0]).toMatchObject({ href: "/admin/drivers/d1", tone: "danger" }); expect((r[0].sub as { props: { children: string } }).props.children).toBe("2 orders, 9 d");
  });
  it("pairOf keeps the empty side null", () => { expect(pairOf(5, null)).toEqual({ cur: 5, prev: null }); expect(pairOf(null, 3)).toEqual({ cur: null, prev: 3 }); });
});
