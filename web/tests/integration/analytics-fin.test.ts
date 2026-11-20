/**
 * Deliveries, cash-on-delivery and finance reports (`GET /admin/analytics/{deliveries,cod,finance}` and their drill-down tables).
 * One world: Alpha has a completed job of 10 parcels (4 with cash on delivery, 8 delivered, 2 refused and returned) that was settled and invoiced; Bravo has an open request.
 * Every number is compared with what the database holds for the same rows, never with a constant, because the order in which the driver works the stops is not fixed.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, ledgerEntries, offers, settlements, shipments, walletAccounts, withdrawals } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, mkShipments, mkStaff, publishedRequest } from "../helpers/factories";
import { work } from "../helpers/work";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import * as jobs from "@/server/jobs";
import { receiveCash } from "@/server/cod";
import { clearAnalyticsCache } from "@/server/analytics/guard";

beforeEach(async () => { await resetDb(); clearAnalyticsCache(); });
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const get = async (u: { id: string }, path: string) => call("GET", path, { token: await tok(u) });
const kpi = (json: any, key: string) => json.kpis.find((k: any) => k.key === key);
const COD = [5_000, 7_500, 2_500, 10_000];
const sum = (xs: number[]) => xs.reduce((s, n) => s + n, 0);

async function world() {
  const admin = await mkAdmin(); await mkRule(admin);
  const alpha = await mkBusiness({ fundsCents: 5000_00, name: "Alpha Owner" }), bravo = await mkBusiness({ fundsCents: 5000_00, name: "Bravo Owner" });
  const driver = await mkDriver();
  const rows = mkShipments(10, { withRefs: true }).map((s, i) => ({ ...s, codCents: i < COD.length ? COD[i] : 0 }));
  const r1 = await publishedRequest(alpha, { shipments: rows, shipmentsPerDriver: 10 });
  const [o1] = await db.select().from(offers).where(eq(offers.requestId, r1.id));
  await jobs.acceptOffer(driver, o1.id, true); await jobs.confirmAttendance(alpha, o1.id, true);
  await work(alpha, driver, o1.id, 8);
  const rb = await publishedRequest(bravo, { startsAt: new Date(Date.now() + 3 * 864e5) });
  await db.delete(shipments).where(eq(shipments.requestId, rb.id)); // Bravo has an open request and no parcels yet (the factory adds a default manifest)
  const ps = await db.select().from(shipments).where(eq(shipments.requestId, r1.id));
  const [settlement] = await db.select().from(settlements).where(eq(settlements.requestId, r1.id));
  const delivered = ps.filter((p) => p.status === "delivered"), notDelivered = ps.filter((p) => p.status !== "delivered");
  const codDelivered = delivered.filter((p) => p.codCents > 0);
  return { admin, alpha, bravo, driver, r1, o1, ps, delivered, notDelivered, codDelivered, collected: sum(codDelivered.map((p) => p.codCollectedCents ?? 0)), settlement };
}

describe("permissions", () => {
  it("deliveries and COD need reports.view; finance needs reports.view AND finance.view; nobody else gets in", async () => {
    const { alpha, driver } = await world();
    const viewer = await mkStaff(["reports.view"]), money = await mkStaff(["finance.view"]), both = await mkStaff(["reports.view", "finance.view"]), none = await mkStaff(["requests.view"]);
    for (const p of ["/admin/analytics/deliveries", "/admin/analytics/cod", "/admin/analytics/finance"]) {
      expect((await call("GET", p)).status, `anonymous ${p}`).toBe(401);
      expect((await get(alpha, p)).status, `business ${p}`).toBe(403);
      expect((await get(driver, p)).status, `driver ${p}`).toBe(403);
      expect((await get(none, p)).status, `no permission ${p}`).toBe(403);
    }
    expect((await get(viewer, "/admin/analytics/deliveries")).status).toBe(200);
    expect((await get(viewer, "/admin/analytics/cod")).status).toBe(200);
    expect((await get(viewer, "/admin/analytics/finance")).status).toBe(403);
    expect((await get(money, "/admin/analytics/finance")).status).toBe(403);
    expect((await get(both, "/admin/analytics/finance")).status).toBe(200);
  });
});

describe("GET /admin/analytics/deliveries", () => {
  it("every flow KPI is what the database holds, and rates say what they divide", async () => {
    const { admin, ps, delivered, notDelivered } = await world();
    const r = await get(admin, "/admin/analytics/deliveries");
    expect(r.status).toBe(200);
    const j = r.json;
    expect(j.meta).toMatchObject({ bucket: "day", compare: "prev", empty: false, moneyHidden: false });
    expect(kpi(j, "dlv_created").value).toBe(ps.length);
    expect(kpi(j, "dlv_handed").value).toBeGreaterThanOrEqual(delivered.length);
    expect(kpi(j, "parcels_delivered").value).toBe(delivered.length);
    expect(kpi(j, "dlv_failed").value + kpi(j, "dlv_returned").value).toBe(notDelivered.length);
    expect(kpi(j, "delivery_success").value).toBeCloseTo(delivered.length / (delivered.length + notDelivered.length), 5);
    expect(kpi(j, "first_attempt").value).toBe(1);
    expect(kpi(j, "dlv_attempts_avg").value).toBe(1);
    expect(kpi(j, "dlv_incomplete_rate").value).toBe(0);
    expect(kpi(j, "dlv_b2b_share").value).toBe(0);
    expect(kpi(j, "dlv_b2c_success").value).toBeCloseTo(delivered.length / ps.length, 5);
    expect(kpi(j, "dlv_b2b_success").value).toBeNull(); // no business recipient: no data, not 0 %
    expect(kpi(j, "dlv_evidence_rate").value).toBe(1); // every delivery was confirmed with a code
    expect(kpi(j, "dlv_parcels_per_job").value).toBe(delivered.length);
    expect(kpi(j, "dlv_created")).toMatchObject({ prev: 0, label: "rpd.kpi_dlv_created", definition: "rpd.def_dlv_created" });
    expect(kpi(j, "delivery_success")).toMatchObject({ prev: null, delta: null });
    expect(j.kpiGroups.flow).toContain("dlv_created");
    expect(j.kpis.map((k: any) => k.key)).toEqual(expect.arrayContaining(Object.values(j.kpiGroups).flat() as string[]));
  });

  it("series, funnel, reasons, proof, heatmaps and breakdowns agree with the KPIs", async () => {
    const { admin, alpha, driver, ps, delivered, notDelivered } = await world();
    const j = (await get(admin, "/admin/analytics/deliveries")).json;
    expect(j.series.outcomes.points).toHaveLength(30); expect(j.series.outcomes.prev).toHaveLength(30);
    expect(j.series.outcomes.points.reduce((s: number, p: any) => s + p.delivered, 0)).toBe(delivered.length);
    expect(j.series.flow.points.reduce((s: number, p: any) => s + p.created, 0)).toBe(ps.length);
    expect(j.series.speed.points.some((p: any) => p.p50 === null)).toBe(true); // a day without deliveries is a gap, never 0
    expect(j.funnel.map((s: any) => s.key)).toEqual(["created", "handed", "delivered"]);
    expect(j.funnel[0].count).toBe(ps.length); expect(j.funnel[2].count).toBe(delivered.length);
    expect(j.reasons.all[0]).toMatchObject({ reason: "refused", n: notDelivered.length });
    expect(j.reasons.byCity[0]).toMatchObject({ key: "riyadh", total: notDelivered.length });
    expect(j.reasons.byCompany[0]).toMatchObject({ key: alpha.id, name: expect.stringContaining("Alpha") });
    expect(j.proof).toMatchObject({ otp: delivered.length, scan: 0, receipt: 0, delivered: delivered.length });
    expect(j.heatmap.delivered.total).toBe(delivered.length); expect(j.heatmap.failures.total).toBe(notDelivered.length);
    expect(j.heatmap.delivered.cells).toHaveLength(7); expect(j.heatmap.delivered.cells[0]).toHaveLength(24);
    expect(j.attempts.n).toBe(ps.length);
    expect(j.breakdowns.company[0]).toMatchObject({ key: alpha.id, resolved: ps.length, delivered: delivered.length });
    expect(j.breakdowns.driver[0]).toMatchObject({ key: driver.id, resolved: ps.length });
    expect(j.breakdowns.city[0]).toMatchObject({ key: "riyadh" }); expect(j.breakdowns.service[0]).toMatchObject({ key: "delivery_driver" });
    expect(j.minVolume).toBe(10);
    expect(j.worst.company.map((g: any) => g.key)).toEqual([alpha.id]); // ten resolved parcels reach the minimum volume
    expect(Array.isArray(j.insights)).toBe(true);
  });

  it("filters narrow every number, an empty selection says so, and the comparison can be switched off", async () => {
    const { admin, alpha, bravo, driver } = await world();
    const q = async (s: string) => (await get(admin, `/admin/analytics/deliveries?${s}`)).json;
    expect(kpi(await q(`company=${alpha.id}`), "dlv_created").value).toBe(10);
    expect(kpi(await q(`company=${bravo.id}`), "dlv_created").value).toBe(0);
    expect(kpi(await q(`company=${bravo.id}`), "delivery_success").value).toBeNull();
    expect(kpi(await q(`driver=${driver.id}`), "dlv_created").value).toBe(10);
    expect(kpi(await q("city=jeddah"), "dlv_created").value).toBe(0);
    expect(kpi(await q("service=delivery_driver&vehicle=sedan"), "dlv_created").value).toBe(10);
    expect((await q("city=jeddah&compare=none")).meta.empty).toBe(true);
    expect(kpi(await q("compare=none"), "dlv_created")).toMatchObject({ prev: null, delta: null });
  });

  it("drill-down tables: parcels, failed, slow and returns outstanding page, sort and export", async () => {
    const { admin, ps, delivered, notDelivered } = await world();
    const exporter = await mkStaff(["reports.view", "reports.export"]), viewer = await mkStaff(["reports.view"]);
    const t = async (name: string, qs = "") => (await get(admin, `/admin/analytics/deliveries/table/${name}?${qs}`)).json;
    const parcels = await t("parcels");
    expect(parcels.total).toBe(ps.length); expect(parcels.columns.find((c: any) => c.key === "code")).toMatchObject({ type: "link", sortable: true });
    expect(parcels.rows[0]).toMatchObject({ company: expect.stringContaining("Alpha"), requestId: expect.any(String) });
    expect((await t("parcels", "pageSize=4&page=3")).rows).toHaveLength(2);
    const byCode = (await t("parcels", "sort=code&dir=asc")).rows.map((r: any) => r.code);
    expect(byCode).toEqual([...byCode].sort());
    expect((await t("failed")).total).toBe(notDelivered.length);
    expect((await t("failed")).rows[0]).toMatchObject({ failReason: "refused" });
    expect((await t("slow")).total).toBeLessThanOrEqual(delivered.length);
    expect((await t("returns-open")).total).toBe(0); // the warehouse received them all back
    expect((await get(admin, "/admin/analytics/deliveries/table/nope")).status).toBe(404);
    expect((await get(viewer, "/admin/analytics/deliveries/table/parcels?format=csv")).status).toBe(403);
    const csv = await get(exporter, "/admin/analytics/deliveries/table/parcels?format=csv");
    expect(csv.status).toBe(200); expect(csv.headers.get("content-disposition")).toContain("deliveries-parcels.csv");
    expect(csv.text.startsWith("﻿code,")).toBe(true); expect(csv.text.slice(1).split("\n")).toHaveLength(1 + ps.length);
  });

  it("rejects invalid filters with a 422 that names the field", async () => {
    const { admin } = await world();
    const bad = async (qs: string) => { const r = await get(admin, `/admin/analytics/deliveries?${qs}`); return { status: r.status, field: r.json?.error?.details?.field }; };
    expect(await bad("preset=forever")).toMatchObject({ status: 422, field: "preset" });
    expect(await bad("company=nope")).toMatchObject({ status: 422, field: "company" });
    expect(await bad("from=2026-03-05&to=2026-03-01")).toMatchObject({ status: 422, field: "to" });
  });
});

describe("GET /admin/analytics/cod", () => {
  it("collected, received back and outstanding follow the cash, and a partial receipt moves them", async () => {
    const { admin, alpha, driver, o1, codDelivered, collected, ps } = await world();
    expect(codDelivered.length).toBeGreaterThanOrEqual(2); // at least two of the four COD parcels are among the eight delivered
    const a = (await get(admin, "/admin/analytics/cod")).json;
    expect(a.meta).toMatchObject({ moneyHidden: false, empty: false });
    expect(kpi(a, "cod_parcels").value).toBe(codDelivered.length);
    expect(kpi(a, "cod_collected").value).toBe(collected);
    expect(kpi(a, "cod_remitted").value).toBe(0);
    expect(kpi(a, "cod_outstanding").value).toBe(collected);
    expect(kpi(a, "cod_share").value).toBeCloseTo(COD.length / ps.length, 5);
    expect(kpi(a, "cod_collection_rate").value).toBe(1);
    expect(kpi(a, "cod_mismatch").value).toBe(0);
    expect(kpi(a, "cod_holders").value).toBe(1);
    expect(kpi(a, "cod_remit_rate").value).toBe(0);
    expect(kpi(a, "cod_lag_p50").value).toBeNull(); // nothing received yet: no data
    expect(a.aging.map((b: any) => b.key)).toEqual(["d0_1", "d2_3", "d4_7", "d8_14", "d15"]);
    expect(a.aging[0]).toMatchObject({ orders: 1, cents: collected }); expect(a.aging.slice(1).every((b: any) => b.orders === 0)).toBe(true);
    expect(a.holders.driver[0]).toMatchObject({ key: driver.id, outstanding: collected, orders: 1 });
    expect(a.holders.company[0]).toMatchObject({ key: alpha.id }); expect(a.alerts).toEqual([]); // a fresh order is not an alert
    const last = a.series.cash.points[a.series.cash.points.length - 1];
    expect(last.outstanding).toBe(collected); expect(a.series.cash.points.reduce((s: number, p: any) => s + p.collected, 0)).toBe(collected);
    expect(a.series.mix.points.reduce((s: number, p: any) => s + p.cod, 0)).toBe(codDelivered.length);

    await receiveCash(alpha, o1.id, 1_000, "first handover");
    clearAnalyticsCache();
    const b = (await get(admin, "/admin/analytics/cod")).json;
    expect(kpi(b, "cod_remitted").value).toBe(1_000);
    expect(kpi(b, "cod_outstanding").value).toBe(collected - 1_000);
    expect(kpi(b, "cod_remit_rate").value).toBeCloseTo(1_000 / collected, 5);
    expect(kpi(b, "cod_lag_p50").value).toBeGreaterThanOrEqual(0);
    expect(b.received.business).toMatchObject({ n: 1, cents: 1_000 }); expect(b.received.staff).toMatchObject({ n: 0 });
    expect(b.lag.n).toBe(1); expect(b.lag.hist.reduce((s: number, h: any) => s + h.count, 0)).toBe(1);
    expect(b.holders.driver[0].outstanding).toBe(collected - 1_000);
    expect(b.series.cash.points.reduce((s: number, p: any) => s + p.remitted, 0)).toBe(1_000);
    expect(kpi(b, "cod_outstanding").prev).toBe(0); // the balance at the end of the previous period
  });

  it("without finance.view every amount is omitted and the counts stay", async () => {
    const { collected } = await world();
    const plain = (await get(await mkStaff(["reports.view"]), "/admin/analytics/cod")).json;
    const keys = plain.kpis.map((k: any) => k.key);
    for (const m of ["cod_collected", "cod_remitted", "cod_outstanding", "cod_avg_value", "cod_remit_rate", "cod_collection_rate", "cod_uncollected", "cod_aged_value"]) expect(keys).not.toContain(m);
    expect(keys).toEqual(expect.arrayContaining(["cod_parcels", "cod_share", "cod_failed", "cod_mismatch", "cod_aged_orders", "cod_holders", "cod_lag_p50"]));
    expect(plain.meta.moneyHidden).toBe(true); expect(plain.series.cash).toBeNull(); expect(plain.holders).toBeNull(); expect(plain.alerts).toBeNull();
    expect(plain.aging[0]).toEqual({ key: "d0_1", orders: 1 }); // the order count, not the cash
    expect(JSON.stringify(plain)).not.toContain(String(collected));
    expect(kpi(plain, "cod_holders").value).toBe(1);
    for (const name of ["outstanding", "remittances", "collected"]) expect((await get(await mkStaff(["reports.view"]), `/admin/analytics/cod/table/${name}`)).status, name).toBe(403);
  });

  it("drill-down tables list the orders, the receipts and the collected parcels", async () => {
    const { admin, alpha, driver, o1, collected, codDelivered } = await world();
    await receiveCash(alpha, o1.id, 1_000);
    const t = async (name: string, qs = "") => (await get(admin, `/admin/analytics/cod/table/${name}?${qs}`)).json;
    const out = await t("outstanding");
    expect(out.total).toBe(1); expect(out.rows[0]).toMatchObject({ driver: driver.name, collectedCents: collected, receivedCents: 1_000, outstandingCents: collected - 1_000, ageDays: 0, parcels: codDelivered.length });
    const rem = await t("remittances");
    expect(rem.total).toBe(1); expect(rem.rows[0]).toMatchObject({ amountCents: 1_000, receivedByRole: "business", ref: expect.stringMatching(/^COD-/) });
    const col = await t("collected");
    expect(col.total).toBe(codDelivered.length); expect(col.rows.reduce((s: number, r: any) => s + r.collectedCents, 0)).toBe(collected);
    expect((await t("outstanding", `driver=${driver.id}`)).total).toBe(1); expect((await t("outstanding", `company=${(await mkBusiness()).id}`)).total).toBe(0);
    const exporter = await mkStaff(["reports.view", "finance.view", "reports.export"]);
    const csv = await get(exporter, "/admin/analytics/cod/table/remittances?format=csv");
    expect(csv.status).toBe(200); expect(csv.text.split("\n")).toHaveLength(2);
    expect((await get(await mkStaff(["reports.view", "reports.export"]), "/admin/analytics/cod/table/remittances?format=csv")).status).toBe(403); // reports.export alone does not unlock money
  });
});

describe("GET /admin/analytics/finance", () => {
  it("billed amount, VAT, provider cost and margin are the settlement, and the waterfall ends at the margin after VAT", async () => {
    const { admin, settlement } = await world();
    const j = (await get(admin, "/admin/analytics/finance")).json;
    expect(j.meta).toMatchObject({ moneyHidden: false, empty: false });
    expect(kpi(j, "fin_billed").value).toBe(settlement.customerCents);
    expect(kpi(j, "fin_vat").value).toBe(settlement.vatCents);
    expect(kpi(j, "fin_provider").value).toBe(settlement.providerCents);
    expect(kpi(j, "fin_revenue").value).toBe(settlement.marginCents);
    expect(kpi(j, "fin_net_sales").value).toBe(settlement.customerCents - settlement.vatCents);
    expect(kpi(j, "fin_net_position").value).toBe(settlement.marginCents - settlement.vatCents);
    expect(kpi(j, "fin_margin_pct").value).toBeCloseTo(settlement.marginCents / settlement.customerCents, 5);
    expect(kpi(j, "fin_aov").value).toBe(settlement.customerCents);
    expect(kpi(j, "fin_settlements").value).toBe(1);
    expect(kpi(j, "fin_payout_direct").value).toBe(settlement.providerCents); expect(kpi(j, "fin_payout_office").value).toBe(0);
    expect(kpi(j, "fin_invoices").value).toBe(1);
    expect(kpi(j, "fin_settle_unpaid").value).toBe(0); expect(kpi(j, "fin_settle_held").value).toBe(0);
    expect(kpi(j, "fin_settle_latency").value).toBeGreaterThanOrEqual(0);
    expect(kpi(j, "fin_concentration").value).toBe(1); // one company carries all of it
    expect(j.waterfall.cur.map((s: any) => s.key)).toEqual(["billed", "vat", "provider", "net"]);
    expect(j.waterfall.cur.map((s: any) => s.value)).toEqual([settlement.customerCents, -settlement.vatCents, -settlement.providerCents, settlement.marginCents - settlement.vatCents]);
    const [inv] = await db.select().from(invoices); expect(kpi(j, "fin_invoiced").value).toBe(inv.totalCents);
    expect(j.series.money.points).toHaveLength(30);
    expect(j.series.money.points.reduce((s: number, p: any) => s + p.billed, 0)).toBe(settlement.customerCents);
    expect(j.series.money.points.reduce((s: number, p: any) => s + p.s_delivery_driver, 0)).toBe(settlement.customerCents);
    expect(j.margins.service[0]).toMatchObject({ key: "delivery_driver", billed: settlement.customerCents, margin: settlement.marginCents });
    expect(j.margins.city[0]).toMatchObject({ key: "riyadh" });
    expect(j.companies.top[0]).toMatchObject({ billed: settlement.customerCents, name: expect.stringContaining("Alpha") });
    expect(j.pipeline.latency.n).toBe(1);
  });

  it("balances are live for today, withdrawals and credit are counted from their own rows", async () => {
    const { admin, alpha, driver } = await world();
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
    await db.insert(withdrawals).values([
      { userId: driver.id, amountCents: 5_000, iban: "SA0380000000608010167519", status: "pending", createdAt: hoursAgo(5) },
      { userId: driver.id, amountCents: 3_000, iban: "SA0380000000608010167519", status: "paid", createdAt: hoursAgo(3), decidedAt: hoursAgo(1), paymentRef: "P1" },
      { userId: driver.id, amountCents: 1_000, iban: "SA0380000000608010167519", status: "rejected", createdAt: hoursAgo(3), decidedAt: hoursAgo(1), note: "no" },
    ]);
    await db.update(walletAccounts).set({ availableCents: -40_000, creditLimitCents: 100_000 }).where(eq(walletAccounts.ownerId, alpha.id));
    const j = (await get(admin, "/admin/analytics/finance")).json;
    expect(kpi(j, "fin_wd_requested").value).toBe(9_000); expect(kpi(j, "fin_wd_paid").value).toBe(3_000); expect(kpi(j, "fin_wd_rejected").value).toBe(1_000);
    expect(kpi(j, "fin_wd_pending").value).toBe(5_000); expect(kpi(j, "fin_wd_turnaround").value).toBeCloseTo(7_200, 0);
    expect(j.withdrawals.byStatus.map((s: any) => s.key).sort()).toEqual(["paid", "pending", "rejected"]);
    expect(j.withdrawals.pending).toMatchObject({ n: 1, cents: 5_000 });
    expect(kpi(j, "fin_credit_used").value).toBe(40_000); expect(kpi(j, "fin_credit_util").value).toBe(0.4);
    expect(j.credit.top[0]).toMatchObject({ id: alpha.id, used: 40_000, limit: 100_000, util: 0.4 });
    const accounts = await db.select().from(walletAccounts).where(eq(walletAccounts.kind, "user"));
    const liability = sum(accounts.map((a) => Math.max(a.availableCents, 0) + a.heldCents + a.reservedCents));
    expect(kpi(j, "fin_wallet_liability").value).toBe(liability);
    expect(kpi(j, "fin_escrow").value).toBe(sum(accounts.map((a) => a.reservedCents)));
    const topups = await db.select().from(ledgerEntries).where(eq(ledgerEntries.kind, "topup"));
    expect(kpi(j, "fin_topups").value).toBe(sum(topups.map((e) => e.availableDeltaCents)));
    // a withdrawal belongs to its payee: the company filter cannot narrow it and the card says so; the driver filter does
    expect(kpi((await get(admin, `/admin/analytics/finance?company=${alpha.id}`)).json, "fin_wd_requested").unfiltered).toEqual(["company"]);
    expect(kpi((await get(admin, `/admin/analytics/finance?driver=${driver.id}`)).json, "fin_wd_requested").value).toBe(9_000);
    expect(kpi((await get(admin, `/admin/analytics/finance?driver=${(await mkDriver()).id}`)).json, "fin_wd_requested").value).toBe(0);
  });

  it("filters narrow the money, and an empty selection is reported", async () => {
    const { admin, alpha, bravo, settlement } = await world();
    const q = async (s: string) => (await get(admin, `/admin/analytics/finance?${s}`)).json;
    expect(kpi(await q(`company=${alpha.id}`), "fin_billed").value).toBe(settlement.customerCents);
    expect(kpi(await q(`company=${bravo.id}`), "fin_billed").value).toBe(0);
    expect(kpi(await q(`company=${bravo.id}`), "fin_margin_pct").value).toBeNull();
    expect(kpi(await q("city=jeddah"), "fin_billed").value).toBe(0);
    expect(kpi(await q("service=delivery_driver"), "fin_billed").value).toBe(settlement.customerCents);
    expect(kpi(await q("compare=none"), "fin_billed")).toMatchObject({ prev: null });
    expect(kpi(await q("city=riyadh"), "fin_wallet_liability").unfiltered).toEqual(["city"]); // balances cannot be narrowed by city
  });

  it("drill-down tables: settlements, withdrawals, ledger, invoices and company profitability need finance.view", async () => {
    const { admin, alpha, driver, settlement } = await world();
    await db.insert(withdrawals).values({ userId: driver.id, amountCents: 2_000, iban: "SA0380000000608010167519", status: "pending" });
    const t = async (name: string, qs = "") => (await get(admin, `/admin/analytics/finance/table/${name}?${qs}`)).json;
    const s = await t("settlements");
    expect(s.total).toBe(1); expect(s.rows[0]).toMatchObject({ customerCents: settlement.customerCents, marginCents: settlement.marginCents, status: "paid", driver: expect.any(String), company: expect.stringContaining("Alpha") });
    expect(s.rows[0].marginPct).toBeCloseTo(settlement.marginCents / settlement.customerCents, 5); expect(s.rows[0].latencySecs).toBeGreaterThanOrEqual(0);
    const c = await t("companies");
    expect(c.total).toBe(1); expect(c.rows[0]).toMatchObject({ id: alpha.id, billedCents: settlement.customerCents, settlementCount: 1, shareOfBilled: 1 });
    expect((await t("withdrawals")).total).toBe(1);
    expect((await t("invoices")).total).toBe(1); expect((await t("invoices")).rows[0]).toMatchObject({ totalCents: settlement.customerCents, number: expect.stringMatching(/^INV-/) });
    const ledger = await t("ledger");
    const entries = await db.select().from(ledgerEntries); expect(ledger.total).toBe(entries.length);
    expect((await t("ledger", "pageSize=5&sort=availableCents&dir=desc")).rows).toHaveLength(5);
    expect((await t("ledger", `company=${alpha.id}`)).total).toBeGreaterThan(0);
    for (const name of ["settlements", "withdrawals", "ledger", "invoices", "companies"]) {
      expect((await get(await mkStaff(["reports.view"]), `/admin/analytics/finance/table/${name}`)).status, name).toBe(403);
      expect((await get(await mkStaff(["finance.view"]), `/admin/analytics/finance/table/${name}`)).status, name).toBe(403);
    }
    const exporter = await mkStaff(["reports.view", "finance.view", "reports.export"]);
    const csv = await get(exporter, "/admin/analytics/finance/table/companies?format=csv");
    expect(csv.status).toBe(200); expect(csv.text.startsWith("﻿company,")).toBe(true); expect(csv.text.slice(1).split("\n")).toHaveLength(2);
    expect((await get(exporter, "/admin/analytics/finance/table/companies?sort=password")).status).toBe(422);
  });

  it("caches an identical request for 30 s per permission class", async () => {
    const { admin, alpha } = await world();
    const a = (await get(admin, "/admin/analytics/finance")).json, b = (await get(admin, "/admin/analytics/finance")).json;
    expect(a.meta.cached).toBe(false); expect(b.meta.cached).toBe(true); expect(b.meta.generatedAt).toBe(a.meta.generatedAt);
    await db.update(settlements).set({ customerCents: 1 }).where(eq(settlements.businessId, alpha.id));
    expect(kpi((await get(admin, "/admin/analytics/finance")).json, "fin_billed").value).toBe(kpi(a, "fin_billed").value); // still the cached number
    clearAnalyticsCache();
    expect(kpi((await get(admin, "/admin/analytics/finance")).json, "fin_billed").value).toBe(1);
  });
});

describe("shared behaviour", () => {
  it("a one-day period is grouped by hour (24 points), except the balances, which come from daily snapshots", async () => {
    const { admin, alpha } = await world();
    const day = (await get(admin, `/admin/analytics/deliveries?preset=today&compare=none&company=${alpha.id}`)).json;
    expect(day.meta.bucket).toBe("hour"); expect(day.series.outcomes.points).toHaveLength(24);
    const fin = (await get(admin, "/admin/analytics/finance?preset=today&compare=none")).json;
    expect(fin.series.balances.bucket).toBe("day"); // balances come from daily snapshots, so hours are shown per day
    expect(fin.series.balances.points).toHaveLength(1);
  });
});
