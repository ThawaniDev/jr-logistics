import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, settlements, walletAccounts, complaints } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, publishedRequest, mkStaff, reqInput } from "../helpers/factories";
import * as jobs from "@/server/jobs";
import * as settle from "@/server/settlement";
import { ensureAccount, post } from "@/server/wallet";
import { createDraft, publishRequest, cancelRequest } from "@/server/requests";

beforeEach(resetDb);
afterAll(shutdown);

async function balance(userId: string) {
  const a = await ensureAccount(userId);
  const [r] = await db.select().from(walletAccounts).where(eq(walletAccounts.id, a.id));
  return r;
}
async function totalMoney() {
  const [r] = await db.select({ s: sql<number>`coalesce(sum(available_cents + reserved_cents + held_cents),0)::int` }).from(walletAccounts);
  return r.s;
}

describe("delivery lifecycle (happy path)", () => {
  it("runs request → settlement → payout with balanced money", async () => {
    const admin = await mkAdmin();
    await mkRule(admin); // 10.00 per shipment, provider 7.00
    const biz = await mkBusiness({ fundsCents: 500_00 });
    const driver = await mkDriver();
    const r = await publishedRequest(biz, { shipmentsPerDriver: 10 });
    expect(r.status).toBe("published");
    expect(r.totalCents).toBe(100_00);
    expect((await balance(biz.id)).reservedCents).toBe(100_00);
    expect((await balance(biz.id)).availableCents).toBe(400_00);

    const [offer] = await db.select().from(offers).where(eq(offers.requestId, r.id));
    expect(offer.driverId).toBe(driver.id);
    expect(offer.expectedEarningCents).toBe(70_00);

    await jobs.acceptOffer(driver, offer.id, true);
    expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].status).toBe("assigned");
    await expect(jobs.checkIn(driver, offer.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // too early
    await db.update(requests).set({ startsAt: new Date(Date.now() + 3600_000) }).where(eq(requests.id, r.id));
    await jobs.checkIn(driver, offer.id, { lat: 24.7, lng: 46.6 });
    await jobs.confirmAttendance(biz, offer.id, true);
    await jobs.recordLoading(biz, offer.id, 10);
    await jobs.acknowledgeLoading(driver, offer.id, true);
    await jobs.reportDelivered(driver, offer.id, 9);
    await jobs.confirmDelivery(biz, offer.id, { action: "confirm" });

    const req = (await db.select().from(requests).where(eq(requests.id, r.id)))[0];
    expect(req.status).toBe("completed");
    const [s] = await db.select().from(settlements).where(eq(settlements.requestId, r.id));
    expect(s.finalUnits).toBe(9);
    expect(s.customerCents).toBe(90_00);
    expect(s.providerCents).toBe(63_00);
    expect(s.marginCents).toBe(27_00);
    expect(s.refundCents).toBe(10_00);

    const before = await totalMoney();
    const fin = await mkStaff(["settlements.review", "settlements.approve", "payouts.execute"]);
    const fin2 = await mkStaff(["settlements.approve", "payouts.execute"]);
    await settle.reviewSettlement(fin, s.id);
    await expect(settle.approveSettlement(fin, s.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await settle.approveSettlement(fin2, s.id);
    await settle.payoutSettlement(fin2, s.id);
    await settle.payoutSettlement(fin2, s.id); // idempotent

    const b = await balance(biz.id), d = await balance(driver.id);
    expect(b.reservedCents).toBe(0);
    expect(b.availableCents).toBe(500_00 - 90_00);
    expect(d.availableCents).toBe(63_00);
    expect(await totalMoney()).toBe(before);
    const plat = (await db.select().from(walletAccounts).where(eq(walletAccounts.kind, "platform")))[0];
    expect(plat.availableCents).toBe(27_00);
    expect(b.availableCents + b.reservedCents + d.availableCents + plat.availableCents).toBe(500_00);
  });
});

describe("publish gates", () => {
  it("blocks unverified business, missing terms, missing price, insufficient funds", async () => {
    const admin = await mkAdmin();
    const unverified = await mkBusiness({ verified: false, fundsCents: 1000_00 });
    const d1 = await createDraft(unverified, reqInput());
    await mkRule(admin);
    await expect(publishRequest(unverified, d1.id, { termsAccepted: true })).rejects.toMatchObject({ code: "VERIFICATION_REQUIRED" });

    const biz = await mkBusiness({ fundsCents: 50_00 });
    const d2 = await createDraft(biz, reqInput());
    await expect(publishRequest(biz, d2.id, { termsAccepted: false })).rejects.toMatchObject({ code: "TERMS_REQUIRED" });
    await expect(publishRequest(biz, d2.id, { termsAccepted: true })).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect((await db.select().from(requests).where(eq(requests.id, d2.id)))[0].status).toBe("draft");
    expect((await balance(biz.id)).reservedCents).toBe(0);

    const biz2 = await mkBusiness({ fundsCents: 500_00 });
    const d3 = await createDraft(biz2, reqInput({ vehicleType: "dyna", temperature: "cold" }));
    await expect(publishRequest(biz2, d3.id, { termsAccepted: true })).rejects.toMatchObject({ code: "NO_APPROVED_PRICE" });
  });
});

describe("concurrency", () => {
  it("exactly N of M simultaneous acceptances win N slots", async () => {
    const admin = await mkAdmin();
    await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 1000_00 });
    const drivers = await Promise.all(Array.from({ length: 6 }, () => mkDriver()));
    const r = await publishedRequest(biz, { quantity: 2 });
    const all = await db.select().from(offers).where(eq(offers.requestId, r.id));
    expect(all.length).toBe(6);
    const results = await Promise.allSettled(all.map((o) => jobs.acceptOffer(drivers.find((d) => d.id === o.driverId)!, o.id, true)));
    expect(results.filter((x) => x.status === "fulfilled").length).toBe(2);
    const after = (await db.select().from(requests).where(eq(requests.id, r.id)))[0];
    expect(after.slotsFilled).toBe(2);
    expect(after.status).toBe("assigned");
    const losers = results.filter((x) => x.status === "rejected") as PromiseRejectedResult[];
    expect(losers.every((l) => l.reason.code === "SLOT_TAKEN")).toBe(true);
  });
});

describe("disputes, cancellation, replacement", () => {
  it("dispute holds settlement until resolved by ops", async () => {
    const admin = await mkAdmin();
    await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 500_00 });
    const driver = await mkDriver();
    const r = await publishedRequest(biz);
    const [o] = await db.select().from(offers).where(eq(offers.requestId, r.id));
    await jobs.acceptOffer(driver, o.id, true);
    await jobs.confirmAttendance(biz, o.id, true);
    await jobs.reportDelivered(driver, o.id, 10);
    await jobs.confirmDelivery(biz, o.id, { action: "dispute", note: "only 6 delivered" });
    expect((await db.select().from(settlements)).length).toBe(0);
    await expect(jobs.completeRequest(biz, r.id)).rejects.toMatchObject({ code: "DISPUTE_BLOCKS" });
    const ops = await mkStaff(["requests.edit"]);
    await jobs.resolveDispute(ops, o.id, 7, "agreed 7");
    const [s] = await db.select().from(settlements);
    expect(s.finalUnits).toBe(7);
    const [c] = await db.select().from(complaints);
    expect(c.status).toBe("resolved");
  });

  it("business cancel refunds the full reserve; started work blocks business cancel", async () => {
    const admin = await mkAdmin();
    await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 500_00 });
    const driver = await mkDriver();
    const r = await publishedRequest(biz);
    await cancelRequest(biz, r.id, "changed plans");
    let b = await balance(biz.id);
    expect(b.availableCents).toBe(500_00);
    expect(b.reservedCents).toBe(0);

    const r2 = await publishedRequest(biz);
    const [o] = await db.select().from(offers).where(eq(offers.requestId, r2.id));
    await jobs.acceptOffer(driver, o.id, true);
    await jobs.confirmAttendance(biz, o.id, true);
    await expect(cancelRequest(biz, r2.id, "x")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const ops = await mkStaff(["requests.edit"]);
    await cancelRequest(ops, r2.id, "ops cancel");
    b = await balance(biz.id);
    expect(b.reservedCents).toBe(0);
    expect(b.availableCents).toBe(500_00);
  });

  it("driver cancel frees the slot and a replacement can take it", async () => {
    const admin = await mkAdmin();
    await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 });
    const d1 = await mkDriver(), d2 = await mkDriver();
    const r = await publishedRequest(biz);
    const offs = await db.select().from(offers).where(eq(offers.requestId, r.id));
    const o1 = offs.find((o) => o.driverId === d1.id)!;
    await jobs.acceptOffer(d1, o1.id, true);
    const out = await jobs.driverCancel(d1, o1.id, "car broke");
    expect(out.offer.status).toBe("cancelled");
    const after = (await db.select().from(requests).where(eq(requests.id, r.id)))[0];
    expect(after.slotsFilled).toBe(0);
    expect(after.status).toBe("filling");
    const o2 = (await db.select().from(offers).where(eq(offers.requestId, r.id))).find((o) => o.driverId === d2.id && o.status === "offered")!;
    expect(o2.isReplacement).toBe(true);
    await jobs.acceptOffer(d2, o2.id, true);
    expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].status).toBe("assigned");
  });

  it("prevents overlapping jobs for the same driver", async () => {
    const admin = await mkAdmin();
    await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 });
    const d = await mkDriver();
    const r1 = await publishedRequest(biz);
    const [o1] = await db.select().from(offers).where(eq(offers.requestId, r1.id));
    await jobs.acceptOffer(d, o1.id, true);
    const r2 = await publishedRequest(biz);
    const o2s = await db.select().from(offers).where(eq(offers.requestId, r2.id));
    expect(o2s.length).toBe(0);
    await expect(jobs.applyToRequest(d, r2.id, true)).rejects.toMatchObject({ code: "OVERLAPPING_JOB" });
  });
});

describe("withdrawals", () => {
  it("holds funds on request and releases on rejection", async () => {
    const d = await mkDriver();
    const acct = await ensureAccount(d.id);
    await post(db, { accountId: acct.id, kind: "payout", available: 500_00, idempotencyKey: "seed-d" });
    const w = await settle.requestWithdrawal(d, 200_00);
    expect((await balance(d.id)).availableCents).toBe(300_00);
    expect((await balance(d.id)).heldCents).toBe(200_00);
    await expect(settle.requestWithdrawal(d, 400_00)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    const fin = await mkStaff(["withdrawals.manage"]);
    await settle.decideWithdrawal(fin, w.id, "rejected", { note: "iban mismatch" });
    expect((await balance(d.id)).availableCents).toBe(500_00);
    expect((await balance(d.id)).heldCents).toBe(0);
    const w2 = await settle.requestWithdrawal(d, 100_00);
    await settle.decideWithdrawal(fin, w2.id, "paid", { paymentRef: "BANK-1" });
    expect((await balance(d.id)).heldCents).toBe(0);
    expect((await balance(d.id)).availableCents).toBe(400_00);
  });
});
