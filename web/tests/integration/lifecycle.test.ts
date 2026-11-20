import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, settlements, walletAccounts, jobEvents } from "@/db/schema";
import * as stops from "@/server/stops";
import { currentStopOf, markRouteFinished, otpFor } from "@/server/shipments";
import { runMaintenance } from "@/server/maintenance";
import { shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, publishedRequest, mkStaff, reqInput, WAREHOUSE } from "../helpers/factories";
import { resetDbWithFieldModes } from "../helpers/field-modes";
import * as jobs from "@/server/jobs";
import { work } from "../helpers/work";
import * as settle from "@/server/settlement";
import { ensureAccount, post } from "@/server/wallet";
import { createDraft, publishRequest, cancelRequest } from "@/server/requests";

beforeEach(resetDbWithFieldModes); // J2 / J3: routing and B2B shipments default to OFF — this suite exercises the route / approve-route / business-parcel behaviour
afterAll(shutdown);

const dbTx = () => db as unknown as Parameters<typeof jobs.autoConfirmDelivery>[0];
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
    await expect(jobs.checkIn(driver, offer.id, { lat: 24.9, lng: 46.9 })).rejects.toMatchObject({ code: "TOO_FAR_FROM_WAREHOUSE" });
    await jobs.checkIn(driver, offer.id, WAREHOUSE);
    await jobs.confirmAttendance(biz, offer.id, true);
    const before = await totalMoney();
    await work(biz, driver, offer.id, 9); // 9 delivered, 1 refused at the door and handed back
    // E16/E18: finishing the route confirms the delivery and PAYS — no warehouse confirmation, no review / approval / payout steps.
    expect((await db.select().from(offers).where(eq(offers.id, offer.id)))[0].status).toBe("completed");

    const req = (await db.select().from(requests).where(eq(requests.id, r.id)))[0];
    expect(req.status).toBe("completed");
    const [s] = await db.select().from(settlements).where(eq(settlements.requestId, r.id));
    expect(s.status).toBe("paid");
    expect(s.finalUnits).toBe(9);
    expect(s.customerCents).toBe(90_00);
    expect(s.providerCents).toBe(63_00);
    expect(s.marginCents).toBe(27_00);
    expect(s.refundCents).toBe(10_00);

    const b = await balance(biz.id), d = await balance(driver.id);
    expect(b.reservedCents).toBe(0);
    expect(b.availableCents).toBe(500_00 - 90_00);
    expect(d.availableCents).toBe(63_00);
    expect(await totalMoney()).toBe(before);
    const plat = (await db.select().from(walletAccounts).where(eq(walletAccounts.kind, "platform")))[0];
    expect(plat.availableCents).toBe(27_00);
    expect(b.availableCents + b.reservedCents + d.availableCents + plat.availableCents).toBe(500_00);
    // paying again is a no-op (idempotent safety net)
    expect(await settle.paySettlementsDue()).toBe(0);
    expect((await balance(driver.id)).availableCents).toBe(63_00);
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
  it("the warehouse has nothing to confirm or dispute: the delivery is confirmed by the system when the driver finishes (and a leftover from the old flow is swept up)", async () => {
    const admin = await mkAdmin();
    await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 500_00 });
    const driver = await mkDriver();
    const r = await publishedRequest(biz);
    const [o] = await db.select().from(offers).where(eq(offers.requestId, r.id));
    await jobs.acceptOffer(driver, o.id, true);
    await jobs.confirmAttendance(biz, o.id, true);
    await work(biz, driver, o.id, 10);
    const ev = (await db.select().from(jobEvents).where(eq(jobEvents.offerId, o.id))).filter((e) => e.type === "delivery_confirmed");
    expect(ev).toHaveLength(1); expect(ev[0].payload).toMatchObject({ auto: true, units: 10 }); expect(ev[0].actorId).toBeNull();
    expect((await db.select().from(settlements))[0].status).toBe("paid");
    expect(await jobs.autoConfirmDelivery(await dbTx(), o.id)).toMatchObject({ status: "completed" }); // idempotent
    // an offer the old flow left in "delivery reported" (it waited for a warehouse click) is confirmed and paid by the housekeeping tick
    const d2 = await mkDriver(); const r2 = await publishedRequest(biz, { startsAt: new Date(Date.now() + 4 * 864e5) });
    const o2 = (await db.select().from(offers).where(eq(offers.requestId, r2.id)))[0];
    const drv = o2.driverId === driver.id ? driver : d2;
    await jobs.acceptOffer(drv, o2.id, true); await jobs.confirmAttendance(biz, o2.id, true);
    await jobs.recordLoading(biz, o2.id, undefined, { all: true }); await jobs.acknowledgeLoading(drv, o2.id, true); await stops.approveRoute(drv, o2.id);
    for (let st = await currentStopOf(db, o2.id); st; st = await currentStopOf(db, o2.id)) { await stops.arriveAtStop(drv, o2.id, st.id); await stops.deliverStop(drv, o2.id, st.id, { code: st.code, otp: otpFor(st) }); }
    await db.transaction(async (tx) => { await markRouteFinished(tx, (await tx.select().from(offers).where(eq(offers.id, o2.id)))[0], "delivery_reported", drv); });
    expect((await db.select().from(offers).where(eq(offers.id, o2.id)))[0].status).toBe("delivered_reported");
    await runMaintenance();
    expect((await db.select().from(offers).where(eq(offers.id, o2.id)))[0].status).toBe("completed");
    expect((await db.select().from(settlements).where(eq(settlements.offerId, o2.id)))[0].status).toBe("paid");
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
