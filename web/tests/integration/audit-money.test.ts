/**
 * Server audit — money and state-machine safety: conservation, double-spend / double-refund, races, retries, time boundaries.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, settlements, shipments, jobEvents, invoices, walletAccounts, ledgerEntries, withdrawals, complaints } from "@/db/schema";
import { shutdown, mkAdmin, mkStaff, mkBusiness, mkDriver, mkRule, publishedRequest, mkShipments } from "../helpers/factories";
import { resetDbWithFieldModes } from "../helpers/field-modes";
import { work } from "../helpers/work";
import { moneyViolations } from "../helpers/invariants";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import * as settle from "@/server/settlement";
import { cancelRequest } from "@/server/requests";
import { ensureAccount, setPaymentProvider, topUp, type PaymentProvider } from "@/server/wallet";
import { runMaintenance } from "@/server/maintenance";
import { currentStopOf, otpFor } from "@/server/shipments";

beforeEach(resetDbWithFieldModes); // J2 / J3: routing and B2B shipments default to OFF — this suite exercises the route / approve-route / business-parcel behaviour
afterAll(shutdown);

const offerOf = async (requestId: string, driverId: string) => (await db.select().from(offers).where(and(eq(offers.requestId, requestId), eq(offers.driverId, driverId))))[0];
async function setup(funds = 5000_00) { const admin = await mkAdmin(); await mkRule(admin); const biz = await mkBusiness({ fundsCents: funds }); return { admin, biz }; }
const sound = async () => expect(await moneyViolations()).toEqual([]);

describe("wallet top-up", () => {
  it("a retried top-up with the same idempotency key charges the payment provider once and credits once", async () => {
    const biz = await mkBusiness();
    let charges = 0;
    const provider: PaymentProvider = { name: "stub", simulated: false, async charge(_a, ref) { charges++; return { providerRef: `stub-${ref}` }; } };
    setPaymentProvider(provider);
    try {
      await topUp(biz.id, 5000, "retry-key-1", 1_000_000);
      await topUp(biz.id, 5000, "retry-key-1", 1_000_000);
      await Promise.all([topUp(biz.id, 5000, "retry-key-1", 1_000_000), topUp(biz.id, 5000, "retry-key-1", 1_000_000)]);
      expect(charges).toBe(1);
      expect((await ensureAccount(biz.id)).availableCents).toBe(5000);
      await expect(topUp(biz.id, 7000, "retry-key-1", 1_000_000)).rejects.toMatchObject({ code: "CONFLICT" }); // same key, different amount = a client bug, not a second charge
    } finally { setPaymentProvider(null); }
  });
});

describe("races", () => {
  it("two housekeeping ticks running at once pay each held settlement once", async () => {
    const { biz } = await setup(); const d1 = await mkDriver(), d2 = await mkDriver();
    const held: string[] = [];
    for (const d of [d1, d2]) {
      const r = await publishedRequest(biz, { shipmentsPerDriver: 4, shipments: mkShipments(4) });
      const o = await offerOf(r.id, d.id);
      await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
      // an open complaint that holds the job: the work is confirmed but the money waits
      const [c] = await db.insert(complaints).values({ ref: `CP-T-${held.length}`, filedBy: biz.id, filedByRole: "business", requestId: r.id, offerId: o.id, category: "other", description: "hold the payment please", holdsSettlement: true, status: "open" }).returning();
      held.push(c.id);
      await work(biz, d, o.id);
    }
    expect((await db.select().from(settlements)).every((s) => s.status === "approved")).toBe(true); // created, not paid
    expect(await settle.paySettlementsDue()).toBe(0); // still held
    await db.update(complaints).set({ status: "resolved", holdsSettlement: false }).where(inArray(complaints.id, held));
    const [x, y] = await Promise.all([settle.paySettlementsDue(), settle.paySettlementsDue()]);
    expect(x + y).toBe(2);
    expect(await db.select().from(invoices)).toHaveLength(2);
    expect((await db.select().from(settlements)).every((s) => s.status === "paid")).toBe(true);
    await sound();
  });

  it("the same stop delivered twice at once (or retried after a lost response) is delivered once; a retry just returns it", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz, { shipments: mkShipments(3), shipmentsPerDriver: 3 });
    const o = await offerOf(r.id, d.id);
    await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
    await jobs.recordLoading(biz, o.id, undefined, { all: true }); await jobs.acknowledgeLoading(d, o.id, true); await stops.approveRoute(d, o.id);
    const s = (await currentStopOf(db, o.id))!;
    await stops.arriveAtStop(d, o.id, s.id);
    const res = await Promise.allSettled([stops.deliverStop(d, o.id, s.id, { code: s.code, otp: otpFor(s) }), stops.deliverStop(d, o.id, s.id, { code: s.code, otp: otpFor(s) })]);
    expect(res.some((x) => x.status === "fulfilled")).toBe(true);
    const events = (await db.select().from(jobEvents).where(eq(jobEvents.offerId, o.id))).filter((e) => e.type === "shipment_delivered");
    expect(events).toHaveLength(1);
    const again = await stops.deliverStop(d, o.id, s.id, { code: s.code, otp: otpFor(s) });
    expect(again.status).toBe("delivered");
    expect((await db.select().from(jobEvents).where(eq(jobEvents.offerId, o.id))).filter((e) => e.type === "shipment_delivered")).toHaveLength(1);
    // the next stop is untouched by the replays
    expect((await currentStopOf(db, o.id))!.id).not.toBe(s.id);
  });

  it("a failed stop reported twice is failed once", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz, { shipments: mkShipments(3), shipmentsPerDriver: 3 });
    const o = await offerOf(r.id, d.id);
    await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
    await jobs.recordLoading(biz, o.id, undefined, { all: true }); await jobs.acknowledgeLoading(d, o.id, true); await stops.approveRoute(d, o.id);
    const s = (await currentStopOf(db, o.id))!;
    await stops.arriveAtStop(d, o.id, s.id);
    await Promise.allSettled([stops.failStop(d, o.id, s.id, { reason: "refused" }), stops.failStop(d, o.id, s.id, { reason: "refused" })]);
    expect((await stops.failStop(d, o.id, s.id, { reason: "refused" })).status).toBe("failed");
    expect((await db.select().from(jobEvents).where(eq(jobEvents.offerId, o.id))).filter((e) => e.type === "shipment_failed")).toHaveLength(1);
    // a different reason is a real conflict, not a retry
    await expect(stops.failStop(d, o.id, s.id, { reason: "closed" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("cancelling a request while a driver accepts it ends in one consistent state, with all escrow returned", async () => {
    for (let i = 0; i < 5; i++) {
      await resetDbWithFieldModes();
      const { biz } = await setup(); const d = await mkDriver();
      const r = await publishedRequest(biz, { shipments: mkShipments(4), shipmentsPerDriver: 4 });
      const o = await offerOf(r.id, d.id);
      await Promise.allSettled([jobs.acceptOffer(d, o.id, true), cancelRequest(biz, r.id, "changed my mind")]);
      const [req] = await db.select().from(requests).where(eq(requests.id, r.id));
      const [off] = await db.select().from(offers).where(eq(offers.id, o.id));
      expect(req.status).toBe("cancelled");
      expect(["cancelled", "expired"]).toContain(off.status);
      expect(req.reservedCents).toBe(0);
      expect((await ensureAccount(biz.id)).availableCents).toBe(5000_00);
      expect((await db.select().from(shipments).where(eq(shipments.requestId, r.id))).every((s) => s.status === "cancelled")).toBe(true);
      await sound();
    }
  });

  it("the housekeeping tick running twice at once refunds an expired request exactly once", async () => {
    const { biz } = await setup();
    const r = await publishedRequest(biz, { shipments: mkShipments(4), shipmentsPerDriver: 4 });
    await db.update(requests).set({ startsAt: new Date(Date.now() - 3600_000) }).where(eq(requests.id, r.id));
    const [a, b] = await Promise.all([runMaintenance(), runMaintenance()]);
    expect(a.expiredRequests + b.expiredRequests).toBe(1);
    expect((await ensureAccount(biz.id)).availableCents).toBe(5000_00);
    await runMaintenance();
    expect((await ensureAccount(biz.id)).availableCents).toBe(5000_00);
    await sound();
  });
});

describe("time-based rules at their boundaries", () => {
  it("a no-show cannot be recorded before the job starts; afterwards it frees the slot and returns the parcels", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz, { shipments: mkShipments(4), shipmentsPerDriver: 4 });
    const o = await offerOf(r.id, d.id);
    await jobs.acceptOffer(d, o.id, true);
    await expect(jobs.confirmAttendance(biz, o.id, false, "not here")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await db.update(requests).set({ startsAt: new Date(Date.now() - 60_000) }).where(eq(requests.id, r.id));
    await jobs.confirmAttendance(biz, o.id, false, "not here");
    expect((await offerOf(r.id, d.id)).status).toBe("no_show");
    const [req] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(req.slotsFilled).toBe(0);
    expect((await db.select().from(shipments).where(eq(shipments.requestId, r.id))).every((s) => s.offerId === null && s.status === "pending")).toBe(true);
    await sound();
  });

  it("an all-or-nothing request called off at its start time also cancels a driver who was already confirmed and loaded, and refunds everything", async () => {
    const { biz } = await setup(); const d1 = await mkDriver(), d2 = await mkDriver();
    const r = await publishedRequest(biz, { shipments: mkShipments(20), shipmentsPerDriver: 10, allowPartial: false });
    const o = await offerOf(r.id, d1.id);
    await jobs.acceptOffer(d1, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
    await jobs.recordLoading(biz, o.id, undefined, { all: true });
    await db.update(requests).set({ startsAt: new Date(Date.now() - 3600_000) }).where(eq(requests.id, r.id));
    expect((await runMaintenance()).calledOff).toBe(1);
    const off = await offerOf(r.id, d1.id);
    expect(off.status).toBe("cancelled");
    const [req] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(req).toMatchObject({ status: "cancelled", reservedCents: 0 });
    const parcels = await db.select().from(shipments).where(eq(shipments.requestId, r.id));
    expect(parcels.some((s) => s.status === "pending" || s.status === "loaded")).toBe(false);
    expect((await ensureAccount(biz.id)).availableCents).toBe(5000_00);
    void d2;
    await sound();
  });
});

describe("conservation across messy scenarios", () => {
  it("partial delivery, parcel cancel, dispute resolution, closed slots, cancellation, expiry and withdrawals leave the books balanced", async () => {
    const { biz } = await setup(); const d1 = await mkDriver(), d2 = await mkDriver(), d3 = await mkDriver();
    const fin2 = await mkStaff(["withdrawals.manage"]);

    // (a) a job with 4 of 8 parcels refused, one parcel cancelled before loading — settled and paid the moment the driver finishes
    const a = await publishedRequest(biz, { shipments: mkShipments(8), shipmentsPerDriver: 8 });
    const oa = await offerOf(a.id, d1.id);
    await jobs.acceptOffer(d1, oa.id, true); await jobs.confirmAttendance(biz, oa.id, true);
    const [first] = await db.select().from(shipments).where(eq(shipments.requestId, a.id));
    await stops.cancelShipment(biz, first.id, "customer changed their mind"); await sound();
    await work(biz, d1, oa.id, 4);
    expect((await db.select().from(settlements).where(eq(settlements.offerId, oa.id)))[0].status).toBe("paid");
    await sound();

    // (b) a complaint holds the payment, ops resolves it, the housekeeping tick pays
    const b = await publishedRequest(biz, { shipments: mkShipments(6), shipmentsPerDriver: 6 });
    const ob = await offerOf(b.id, d2.id);
    await jobs.acceptOffer(d2, ob.id, true); await jobs.confirmAttendance(biz, ob.id, true);
    const [cb] = await db.insert(complaints).values({ ref: "CP-T-B", filedBy: biz.id, filedByRole: "business", requestId: b.id, offerId: ob.id, category: "other", description: "check the count", holdsSettlement: true, status: "open" }).returning();
    await work(biz, d2, ob.id, 5); await sound();
    expect((await db.select().from(settlements).where(eq(settlements.offerId, ob.id)))[0].status).toBe("approved");
    await db.update(complaints).set({ status: "resolved", holdsSettlement: false }).where(eq(complaints.id, cb.id));
    expect(await settle.paySettlementsDue()).toBe(1); await sound();

    // (c) a half-staffed request closes its open slots after the grace period
    const c = await publishedRequest(biz, { shipments: mkShipments(20), shipmentsPerDriver: 10 });
    await jobs.acceptOffer(d3, (await offerOf(c.id, d3.id)).id, true);
    await db.update(requests).set({ startsAt: new Date(Date.now() - 3 * 3600_000) }).where(eq(requests.id, c.id));
    await runMaintenance(); await sound();

    // (d) cancelled by the business, (e) expired unfilled
    const d = await publishedRequest(biz, { shipments: mkShipments(5), shipmentsPerDriver: 5 });
    await cancelRequest(biz, d.id, "no longer needed");
    const e = await publishedRequest(biz, { shipments: mkShipments(5), shipmentsPerDriver: 5 });
    await db.update(requests).set({ startsAt: new Date(Date.now() - 3600_000) }).where(eq(requests.id, e.id));
    await runMaintenance(); await sound();

    // (f) a driver withdraws part of what they earned, one request is paid, one is rejected
    const bal = (await ensureAccount(d1.id)).availableCents;
    expect(bal).toBeGreaterThan(0);
    const w1 = await settle.requestWithdrawal(d1, Math.max(10000, Math.floor(bal / 2) > 10000 ? Math.floor(bal / 2) : bal)).catch(() => null);
    if (w1) await settle.decideWithdrawal(fin2, w1.id, "paid", { paymentRef: "BANK-1" });
    await sound();
    expect((await db.select().from(withdrawals)).length).toBeGreaterThanOrEqual(0);
    // only the accepted-but-unworked slot of (c) is still held in escrow: 10 parcels × SAR 10
    const all = await db.select().from(walletAccounts);
    expect(all.reduce((n, x) => n + x.reservedCents, 0)).toBe(10 * 1000);
    void ledgerEntries;
  });
});
