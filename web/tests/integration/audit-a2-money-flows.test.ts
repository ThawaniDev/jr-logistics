/**
 * Audit K / A2 — money and settlement logic (2/2): races, IBAN masking, sums past int4, property-style books check. Regression tests for memory/audit/money.md findings 7, 9, 10, 12.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { requests, settlements, invoices, ledgerEntries, withdrawals, shipments, codRemittances, pricingRules } from "@/db/schema";
import { shutdown, mkAdmin, mkStaff, mkBusiness, mkDriver, mkOffice, mkRule, publishedRequest, mkShipments } from "../helpers/factories";
import { resetDbWithFieldModes } from "../helpers/field-modes";
import { call } from "../helpers/api";
import { work } from "../helpers/work";
import { offerOf, setup, sound } from "../helpers/money-world";
import { createSession } from "@/server/auth/session";
import * as jobs from "@/server/jobs";
import * as settle from "@/server/settlement";
import { ensureAccount, post } from "@/server/wallet";
import { updateSettings } from "@/server/settings";
import { setCreditLimit, adjustWallet } from "@/server/adminviews";
import { createRule } from "@/server/pricing";
import { receiveCash, offerCodMap } from "@/server/cod";
import { codDrivers } from "@/server/finance-views";

beforeEach(resetDbWithFieldModes);
afterAll(shutdown);

describe("A2-6: races on money", () => {
  it("two withdrawals at once for a balance that covers one: exactly one is accepted and the balance is held once", async () => {
    await setup(); const d = await mkDriver();
    const acct = await ensureAccount(d.id);
    await post(db, { accountId: acct.id, kind: "topup", available: 15_000, idempotencyKey: "a2-6-seed" });
    const res = await Promise.allSettled([settle.requestWithdrawal(d, 10_000), settle.requestWithdrawal(d, 10_000)]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const lost = res.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(await db.select().from(withdrawals)).toHaveLength(1);
    expect(await ensureAccount(d.id)).toMatchObject({ availableCents: 5_000, heldCents: 10_000 });
    await sound();
  });

  it("paying and rejecting the same withdrawal at once: one decision wins, the held amount is released or paid once", async () => {
    await setup(); const d = await mkDriver(); const fin = await mkStaff(["withdrawals.manage"]);
    await post(db, { accountId: (await ensureAccount(d.id)).id, kind: "topup", available: 20_000, idempotencyKey: "a2-6-seed2" });
    const w = await settle.requestWithdrawal(d, 12_000);
    const res = await Promise.allSettled([settle.decideWithdrawal(fin, w.id, "paid", { paymentRef: "BANK-9" }), settle.decideWithdrawal(fin, w.id, "rejected", { note: "iban mismatch" })]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const a = await ensureAccount(d.id);
    expect(a.heldCents).toBe(0);
    expect([8_000, 20_000]).toContain(a.availableCents); // paid → 8 000 left, rejected → all 20 000 back
    await sound();
  });

  it("two cash receipts for the same driver's full amount at once (the warehouse and ops): the driver is never marked as having handed over more than he collected", async () => {
    const { biz } = await setup(); const d = await mkDriver(); const ops = await mkStaff(["cod.manage"]);
    const rows = mkShipments(2).map((s) => ({ ...s, codCents: 7_500 }));
    const r = await publishedRequest(biz, { shipments: rows, shipmentsPerDriver: 2 });
    const o = await offerOf(r.id, d.id);
    await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
    await work(biz, d, o.id);
    expect((await offerCodMap(db, [o.id])).get(o.id)).toMatchObject({ collectedCents: 15_000, outstandingCents: 15_000 });
    const res = await Promise.allSettled([receiveCash(biz, o.id, 15_000), receiveCash(ops, o.id, 15_000)]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const rem = await db.select().from(codRemittances).where(eq(codRemittances.offerId, o.id));
    expect(rem.reduce((a, x) => a + x.amountCents, 0)).toBe(15_000);
    expect((await offerCodMap(db, [o.id])).get(o.id)).toMatchObject({ receivedCents: 15_000, outstandingCents: 0 });
    // …and partial receipts that together exceed what is held: the second one that would overshoot is refused
    const r2 = await publishedRequest(biz, { shipments: rows, shipmentsPerDriver: 2 });
    const o2 = await offerOf(r2.id, d.id);
    await jobs.acceptOffer(d, o2.id, true); await jobs.confirmAttendance(biz, o2.id, true);
    await work(biz, d, o2.id);
    const res2 = await Promise.allSettled([receiveCash(biz, o2.id, 9_000), receiveCash(ops, o2.id, 9_000)]);
    expect(res2.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await offerCodMap(db, [o2.id])).get(o2.id)).toMatchObject({ receivedCents: 9_000, outstandingCents: 6_000 });
  });

  it("two requests published at once against a balance that covers one: one is reserved, the other is refused, nothing is over-reserved", async () => {
    const { biz } = await setup(5_000); // SAR 50: one 4-parcel order costs SAR 40
    const { createDraft, publishRequest } = await import("@/server/requests");
    const { reqInput } = await import("../helpers/factories");
    const a = await createDraft(biz, reqInput({ shipments: mkShipments(4), shipmentsPerDriver: 4 })), b = await createDraft(biz, reqInput({ shipments: mkShipments(4), shipmentsPerDriver: 4 }));
    const res = await Promise.allSettled([publishRequest(biz, a.id, { termsAccepted: true }), publishRequest(biz, b.id, { termsAccepted: true })]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((res.find((x) => x.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(await ensureAccount(biz.id)).toMatchObject({ availableCents: 1_000, reservedCents: 4_000 });
    await sound();
  });

  it("two admins saving the same price scope at once leave exactly one approved version (and versions 1 and 2)", async () => {
    const admin = await mkAdmin();
    await Promise.all([mkRule(admin, { priceCents: 1_000 }), mkRule(admin, { priceCents: 1_100 })]);
    const rows = await db.select().from(pricingRules).where(eq(pricingRules.service, "delivery_driver"));
    expect(rows.filter((r) => r.status === "approved")).toHaveLength(1);
    expect(rows.map((r) => r.version).sort()).toEqual([1, 2]);
    void createRule;
  });

  it("the same manual adjustment sent twice at once (same idempotency key) applies once on both sides, books balanced", async () => {
    const { biz } = await setup(); const d = await mkDriver(); const fin = await mkStaff(["wallet.adjust"]);
    await post(db, { accountId: (await ensureAccount(d.id)).id, kind: "topup", available: 30_000, idempotencyKey: "a2-6-seed3" });
    const body = { userId: d.id, amountCents: -12_000, reason: "damaged parcel deduction", idempotencyKey: "adj-key-0001" };
    const res = await Promise.all([adjustWallet(fin, body), adjustWallet(fin, body), adjustWallet(fin, body)]);
    expect(res.filter((x) => x.applied)).toHaveLength(1);
    expect((await ensureAccount(d.id)).availableCents).toBe(18_000);
    expect(await db.select().from(ledgerEntries).where(inArray(ledgerEntries.idempotencyKey, ["adjust:adj-key-0001:user", "adjust:adj-key-0001:platform"]))).toHaveLength(2);
    void biz;
    // the same key for another amount or another account is a conflict, not a silent "already applied"
    await expect(adjustWallet(fin, { ...body, amountCents: -9_000 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(adjustWallet(fin, { ...body, userId: (await mkDriver()).id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await ensureAccount(d.id)).availableCents).toBe(18_000);
    await expect(adjustWallet(fin, { ...body, idempotencyKey: "adj-key-0002", amountCents: -100_000 })).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" }); // cannot overdraw the driver
    await sound();
  });
});

describe("A2-6b: the withdrawal list shows the full IBAN only to those who pay it", () => {
  it("finance.view alone sees the last four digits; withdrawals.manage (the payer) and drivers.sensitive see the number", async () => {
    await setup(); const d = await mkDriver();
    await post(db, { accountId: (await ensureAccount(d.id)).id, kind: "topup", available: 50_000, idempotencyKey: "a2-6b-seed" });
    await settle.requestWithdrawal(d, 20_000);
    const tokOf = async (perms: string[]) => (await createSession((await mkStaff(perms)).id, "web")).token;
    const viewer = await call("GET", "/admin/finance/withdrawals", { token: await tokOf(["finance.view"]) });
    expect(viewer.status).toBe(200);
    expect(viewer.json.items[0].iban).toBe("•••• 7519");
    for (const perms of [["finance.view", "withdrawals.manage"], ["finance.view", "drivers.sensitive"]]) {
      const payer = await call("GET", "/admin/finance/withdrawals", { token: await tokOf(perms) });
      expect(payer.json.items[0].iban).toBe("SA0380000000608010167519");
    }
  });
});

describe("A2-7: totals past SAR 21.4 million do not overflow integer casts", () => {
  it("a company's invoice totals and a driver's cash totals add up beyond 2^31 halalas without a 500", async () => {
    const { biz } = await setup(); const d = await mkDriver(); const ops = await mkStaff(["cod.manage", "finance.view"]);
    const rows = mkShipments(2).map((s) => ({ ...s, codCents: 1_000 }));
    const r = await publishedRequest(biz, { shipments: rows, shipmentsPerDriver: 2 });
    const o = await offerOf(r.id, d.id);
    await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
    await work(biz, d, o.id);
    // two enormous invoices and two enormous cash collections (each below the int4 limit, their sums above it)
    await db.insert(invoices).values([1, 2].map((n) => ({ number: `BIG-${n}`, requestId: r.id, businessId: biz.id, subtotalCents: 1_300_000_000, vatCents: 200_000_000, totalCents: 1_500_000_000, vatPct: 15 })));
    await db.update(shipments).set({ codCollectedCents: 1_500_000_000 }).where(eq(shipments.offerId, o.id));
    const token = (await createSession(biz.id, "web")).token;
    const inv = await call("GET", "/business/invoices", { token });
    expect(inv.status).toBe(200);
    expect(inv.json.totals.totalCents).toBe(3_000_000_000 + 2000); // the 2 BIG ones + the real one (2 parcels × SAR 10 = 2000)
    const cod = await codDrivers(ops, {});
    expect(cod.totals.collectedCents).toBe(3_000_000_000);
    expect((await offerCodMap(db, [o.id])).get(o.id)!.collectedCents).toBe(3_000_000_000);
    const biz2 = await call("GET", "/business/cod", { token });
    expect(biz2.status).toBe(200);
    expect(biz2.json.totals.collectedCents).toBe(3_000_000_000);
  });
});

describe("A2-8: property-style — the books balance after random jobs (direct and office drivers, credit line, partial deliveries)", () => {
  it("every paid settlement posts balanced legs to the right payee; wallets, escrow and conservation hold after each scenario", async () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor((seed / 2147483648) * n); };
    const admin = await mkAdmin();
    await mkRule(admin, { priceCents: 1_235, providerCostCents: 777 }); // odd amounts on purpose
    const biz = await mkBusiness({ fundsCents: 0 });
    await setCreditLimit(await mkStaff(["wallet.adjust"]), biz.id, 500_000_00); // a pure credit-line customer: the balance goes negative
    await updateSettings({ vatPct: 15 }, admin.id);
    const office = await mkOffice(); const od = await mkDriver({ officeId: office.id }); const dd = await mkDriver();
    for (let n = 0; n < 8; n++) {
      const d = rnd(2) ? od : dd, parcels = 2 + rnd(9), deliver = rnd(parcels + 1);
      const r = await publishedRequest(biz, { shipments: mkShipments(parcels), shipmentsPerDriver: parcels });
      const o = await offerOf(r.id, d.id);
      await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
      await work(biz, d, o.id, deliver);
      const [s] = await db.select().from(settlements).where(eq(settlements.offerId, o.id));
      expect(s).toMatchObject({ status: "paid", finalUnits: deliver, customerCents: 1_235 * deliver, providerCents: 777 * deliver, marginCents: (1_235 - 777) * deliver, reservedCents: 1_235 * parcels, refundCents: 1_235 * (parcels - deliver) });
      expect(s.customerCents).toBe(s.providerCents + s.marginCents);
      expect(s.officeId).toBe(d.id === od.id ? office.id : null);
      const legs = await db.select().from(ledgerEntries).where(eq(ledgerEntries.settlementId, s.id));
      const sum = (k: string) => legs.filter((l) => l.kind === k).reduce((a, l) => a + l.availableDeltaCents, 0);
      expect(sum("charge") + s.customerCents).toBe(0); expect(sum("payout")).toBe(s.providerCents); expect(sum("platform_fee")).toBe(s.marginCents);
      expect(legs.filter((l) => l.kind === "release_reserve").reduce((a, l) => a + l.reservedDeltaCents, 0) + s.reservedCents).toBe(0);
      const payee = await ensureAccount(s.officeId ?? d.id);
      expect(legs.find((l) => l.kind === "payout")!.accountId).toBe(payee.id);
      const [inv] = await db.select().from(invoices).where(eq(invoices.settlementId, s.id));
      expect(inv).toMatchObject({ totalCents: s.customerCents, vatCents: s.vatCents }); expect(inv.subtotalCents + inv.vatCents).toBe(inv.totalCents);
      expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].reservedCents).toBe(0);
      await sound();
    }
    const driverSide = await ensureAccount(dd.id);
    expect(driverSide.reservedCents).toBe(0);
    // the credit customer paid for everything it used: its balance is minus the sum of the charges
    const charged = (await db.select().from(settlements)).reduce((a, s) => a + s.customerCents, 0);
    expect((await ensureAccount(biz.id)).availableCents).toBe(-charged);
  });
});
