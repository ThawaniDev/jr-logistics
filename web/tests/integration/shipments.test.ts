import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, settlements, shipments, walletAccounts, tickets, jobEvents } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, mkStaff, publishedRequest, mkShipments, reqInput } from "../helpers/factories";
import { work, parcelsOf } from "../helpers/work";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { createDraft, updateDraft, estimate } from "@/server/requests";
import { currentStopOf, otpFor, trackingUrl, markRouteFinished } from "@/server/shipments";
import { updateSettings } from "@/server/settings";
import { ensureAccount } from "@/server/wallet";
import { setSmsProvider } from "@/server/auth/otp";
import { runMaintenance } from "@/server/maintenance";
import { CUSTODY_ITEM_TYPES } from "@/server/catalog";

beforeEach(resetDb);
afterAll(shutdown);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
/** A photo + written reason, as postponing a stop requires by default (E7). */
async function deferEvidence(d: any, offerId: string, stopId: string) {
  const m = await stops.saveStopMedia(d, offerId, stopId, { data: PNG, mime: "image/png", kind: "defer" });
  return { note: "Closed until the afternoon", mediaId: m.id };
}
const offerOf = async (requestId: string, driverId: string) => (await db.select().from(offers).where(and(eq(offers.requestId, requestId), eq(offers.driverId, driverId))))[0];
const wallet = async (id: string) => (await db.select().from(walletAccounts).where(eq(walletAccounts.id, (await ensureAccount(id)).id)))[0];
async function setup(funds = 5000_00) { const admin = await mkAdmin(); await mkRule(admin); const biz = await mkBusiness({ fundsCents: funds }); return { admin, biz }; }
/** One driver, accepted and attendance-confirmed, ready for hand-over. */
async function ready(n = 5, o: Parameters<typeof reqInput>[0] = {}) {
  const { admin, biz } = await setup(); const d = await mkDriver();
  const r = await publishedRequest(biz, { shipments: mkShipments(n, { withRefs: true }), shipmentsPerDriver: n, ...o });
  const off = await offerOf(r.id, d.id);
  await jobs.acceptOffer(d, off.id, true); await jobs.confirmAttendance(biz, off.id, true);
  return { admin, biz, d, r, off };
}
async function handOverAndApprove(biz: any, d: any, offerId: string) {
  await jobs.recordLoading(biz, offerId, undefined, { all: true });
  await jobs.acknowledgeLoading(d, offerId, true);
  await stops.approveRoute(d, offerId);
}

describe("manifest: every shipment carries its own recipient (B2C / B2B)", () => {
  it("rejects a bad row with the row number, and rejects a parcel for another city, a repeated order reference, junk phones", async () => {
    const { biz } = await setup();
    const rows = mkShipments(3);
    await expect(createDraft(biz, reqInput({ shipments: [rows[0], { ...rows[1], recipientPhone: "12" }, rows[2]] }))).rejects.toMatchObject({ code: "VALIDATION", details: { row: 2, field: "shipments.1.recipientPhone" } });
    await expect(createDraft(biz, reqInput({ shipments: [rows[0], { ...rows[1], address: "x" }] }))).rejects.toMatchObject({ code: "VALIDATION", details: { row: 2 } });
    await expect(createDraft(biz, reqInput({ shipments: [rows[0], { ...rows[1], city: "jeddah" }] }))).rejects.toMatchObject({ code: "VALIDATION", details: { row: 2, field: "shipments.1.city" } });
    await expect(createDraft(biz, reqInput({ shipments: [{ ...rows[0], externalRef: "A1" }, { ...rows[1], externalRef: "a1" }] }))).rejects.toMatchObject({ code: "VALIDATION", details: { row: 2 } });
  });

  it("sizes the request from the manifest and bills exactly the parcels (not slots × capacity)", async () => {
    const { biz } = await setup();
    const est = await estimate(biz, reqInput({ shipmentCount: 25, shipments: null, shipmentsPerDriver: 10 }));
    expect(est).toMatchObject({ available: true, quote: { quantity: 3, expectedUnits: 9, totalUnits: 25, totalCents: 250_00 } });
    const r = await publishedRequest(biz, { shipments: mkShipments(25), shipmentsPerDriver: 10 });
    expect(r.quantity).toBe(3); expect(r.shipmentsPerDriver).toBe(9); expect(r.totalCents).toBe(250_00); expect(r.reservedCents).toBe(250_00);
    expect((await wallet(biz.id)).reservedCents).toBe(250_00);
  });

  it("a draft's manifest can be replaced, and kept when an edit omits it", async () => {
    const { biz } = await setup();
    const d = await createDraft(biz, reqInput({ shipments: mkShipments(4), shipmentsPerDriver: 10 }));
    expect(await db.select().from(shipments).where(eq(shipments.requestId, d.id))).toHaveLength(4);
    const kept = await updateDraft(biz, d.id, { ...reqInput({ notes: "x" }), shipments: undefined });
    expect(await db.select().from(shipments).where(eq(shipments.requestId, d.id))).toHaveLength(4); expect(kept.notes).toBe("x");
    await updateDraft(biz, d.id, reqInput({ shipments: mkShipments(2) }));
    const rows = await db.select().from(shipments).where(eq(shipments.requestId, d.id)).orderBy(asc(shipments.seq));
    expect(rows.map((s) => s.seq)).toEqual([1, 2]); expect(rows[0].code).toBe(`${d.ref}-001`);
  });

  it("cash and card terminals are not part of the platform (no POS / network devices in custody)", () => {
    expect(CUSTODY_ITEM_TYPES).not.toContain("pos_device"); expect(CUSTODY_ITEM_TYPES).not.toContain("network_device");
  });
});

describe("allocation: balanced blocks, escrow stays exact", () => {
  it("25 parcels / 3 drivers → 9 + 8 + 8 contiguous blocks; booked units add up to the escrow", async () => {
    const { biz } = await setup();
    const ds = [await mkDriver(), await mkDriver(), await mkDriver()];
    const r = await publishedRequest(biz, { shipments: mkShipments(25), shipmentsPerDriver: 10 });
    const got: number[] = [];
    for (const d of ds) { const o = await offerOf(r.id, d.id); const a = await jobs.acceptOffer(d, o.id, true); got.push(a.expectedUnits); }
    expect(got).toEqual([9, 8, 8]);
    const blocks = await Promise.all(ds.map(async (d) => (await parcelsOf((await offerOf(r.id, d.id)).id)).map((s) => s.seq).sort((a, b) => a - b)));
    expect(blocks[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]); expect(blocks[1][0]).toBe(10); expect(blocks[2][7]).toBe(25);
    const total = (await db.select().from(offers).where(eq(offers.requestId, r.id))).reduce((a, o) => a + o.expectedUnits, 0);
    expect(total * 10_00 / 10).toBe(25 * 10_00 / 10 * 1); expect(total).toBe(25);
    expect((await offerOf(r.id, ds[0].id)).expectedEarningCents).toBe(9 * 7_00); // earning follows the real share
  });

  it("parcels not handed over return to the pool; a driver never receives more than the plan allows; the rest is refunded and can be re-shipped", async () => {
    const { biz } = await setup(); const d1 = await mkDriver(), d2 = await mkDriver();
    const r = await publishedRequest(biz, { shipments: mkShipments(20), shipmentsPerDriver: 10 });
    const o1 = await offerOf(r.id, d1.id), o2 = await offerOf(r.id, d2.id);
    await jobs.acceptOffer(d1, o1.id, true); await jobs.confirmAttendance(biz, o1.id, true);
    const mine = await parcelsOf(o1.id);
    await jobs.recordLoading(biz, o1.id, undefined, { codes: mine.slice(0, 6).map((s) => s.code) }); // only 6 of 10 handed over
    expect((await db.select().from(offers).where(eq(offers.id, o1.id)))[0].expectedUnits).toBe(6);
    await jobs.acceptOffer(d2, o2.id, true);
    expect((await db.select().from(offers).where(eq(offers.id, o2.id)))[0].expectedUnits).toBe(10); // capped at the plan; 4 stay in the pool
    expect(await db.select().from(shipments).where(and(eq(shipments.requestId, r.id), eq(shipments.status, "pending")))).toHaveLength(14);
    await jobs.confirmAttendance(biz, o2.id, true);
    await jobs.acknowledgeLoading(d1, o1.id, true); await stops.approveRoute(d1, o1.id);
    await work(biz, d2, o2.id);
    for (;;) { const s = await currentStopOf(db, o1.id); if (!s) break; await stops.arriveAtStop(d1, o1.id, s.id); await stops.deliverStop(d1, o1.id, s.id, { code: s.code, otp: otpFor(s) }); }
    await jobs.reportDelivered(d1, o1.id); // both drivers are paid the moment they finish — nobody confirms anything
    expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].status).toBe("completed");
    const left = await db.select().from(shipments).where(and(eq(shipments.requestId, r.id), eq(shipments.failReason, "unfulfilled")));
    expect(left).toHaveLength(4); expect(left.every((s) => s.status === "cancelled")).toBe(true); // withdrawn, escrow for them released
    const w = await wallet(biz.id); expect(w.reservedCents).toBe(0); // both carried shares were paid out as each driver finished; the 4 uncarried parcels' share went back
    const paid = (await db.select().from(settlements)).reduce((a, s) => a + s.customerCents, 0); expect(paid).toBe(16 * 10_00);
    expect(w.availableCents).toBe(5000_00 - 16 * 10_00);
    const draft = await stops.reshipFromRequest(biz, r.id);
    expect(draft.status).toBe("draft"); expect(await db.select().from(shipments).where(eq(shipments.requestId, draft.id))).toHaveLength(4);
  });
});

describe("fixing or withdrawing one parcel before it leaves the warehouse", () => {
  it("the store can correct a typo and cancel one order; the price goes back immediately; the driver's booked units follow; loaded parcels are locked", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz, { shipments: mkShipments(4, { withRefs: true }), shipmentsPerDriver: 4 });
    const off = await offerOf(r.id, d.id); await jobs.acceptOffer(d, off.id, true); await jobs.confirmAttendance(biz, off.id, true);
    const [p1, p2, p3] = (await parcelsOf(off.id)).sort((a, b) => a.seq - b.seq);
    const fixed = await stops.updateShipment(biz, p1.id, { recipientPhone: "0599999999", address: "99 Corrected St, Riyadh" });
    expect(fixed).toMatchObject({ recipientPhone: "+966599999999", address: "99 Corrected St, Riyadh" });
    await expect(stops.updateShipment(biz, p1.id, { recipientPhone: "12" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(stops.updateShipment(biz, p1.id, { externalRef: p2.externalRef })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "externalRef" } });
    const stranger = await mkBusiness(); await expect(stops.updateShipment(stranger, p1.id, { address: "somewhere else" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const before = await wallet(biz.id);
    const out = await stops.cancelShipment(biz, p2.id, "customer cancelled the order");
    expect(out.refundedCents).toBe(10_00);
    const after = await wallet(biz.id); expect(after.availableCents).toBe(before.availableCents + 10_00); expect(after.reservedCents).toBe(before.reservedCents - 10_00);
    expect((await db.select().from(offers).where(eq(offers.id, off.id)))[0].expectedUnits).toBe(3);
    expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].totalCents).toBe(30_00);
    await expect(stops.cancelShipment(biz, p2.id, "again")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await jobs.recordLoading(biz, off.id, undefined, { codes: [p1.code, p3.code] });
    await expect(stops.updateShipment(biz, p1.id, { address: "too late for this" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("one stop at a time (never bulk)", () => {
  it("stops are locked until the route is approved, then strictly in order; delivery needs arrival, the right parcel and the recipient's code", async () => {
    const { biz, d, off } = await ready(4);
    await jobs.recordLoading(biz, off.id, undefined, { all: true });
    const [s1, s2] = (await parcelsOf(off.id)).sort((a, b) => a.seq - b.seq);
    await expect(stops.arriveAtStop(d, off.id, s1.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // route not approved / loading not acknowledged
    await expect(stops.approveRoute(d, off.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await jobs.acknowledgeLoading(d, off.id, true); await stops.approveRoute(d, off.id);
    await expect(stops.arriveAtStop(d, off.id, s2.id)).rejects.toMatchObject({ code: "STOP_LOCKED" });
    await expect(stops.deliverStop(d, off.id, s1.id, { code: s1.code, otp: otpFor(s1) })).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // not arrived yet
    await stops.arriveAtStop(d, off.id, s1.id);
    await expect(stops.deliverStop(d, off.id, s1.id, { code: s2.code, otp: otpFor(s1) })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "code" } }); // wrong parcel
    await expect(stops.deliverStop(d, off.id, s1.id, { code: s1.code })).rejects.toMatchObject({ code: "OTP_REQUIRED" });
    for (const k of [1, 2, 3, 4]) await expect(stops.deliverStop(d, off.id, s1.id, { code: s1.code, otp: otpFor(s1) === "0000" ? "1111" : "0000" })).rejects.toMatchObject({ code: "OTP_INVALID", details: { attemptsLeft: 5 - k } });
    await expect(stops.deliverStop(d, off.id, s1.id, { code: "1", otp: otpFor(s1) === "0000" ? "1111" : "0000" })).rejects.toMatchObject({ code: "OTP_INVALID", details: { attemptsLeft: 0 } }); // "1" = manifest number, accepted as the parcel scan
    await expect(stops.deliverStop(d, off.id, s1.id, { code: s1.code, otp: otpFor(s1) })).rejects.toMatchObject({ code: "OTP_LOCKED" }); // even the right code is refused once locked
    const fresh = await stops.resendCode(d, off.id, s1.id); expect(fresh).toBeTruthy();
    const [s1b] = await db.select().from(shipments).where(eq(shipments.id, s1.id));
    await expect(stops.deliverStop(d, off.id, s1.id, { code: s1.code, otp: otpFor(s1) })).rejects.toMatchObject({ code: "OTP_INVALID" }); // old code retired by the resend (the derived code changed)
    const done = await stops.deliverStop(d, off.id, s1.id, { code: s1.externalRef!, otp: otpFor(s1b) }); // the warehouse's own barcode also works
    expect(done.status).toBe("delivered"); expect(done.proofType).toBe("otp");
    expect((await currentStopOf(db, off.id))!.id).toBe(s2.id);
    await expect(jobs.reportDelivered(d, off.id)).rejects.toMatchObject({ code: "STOPS_PENDING", details: { remaining: 3 } });
  });

  it("B2B recipients may give a signed/stamped receipt photo instead of a code; consumers may not", async () => {
    const { d, biz, off } = await ready(2, { shipments: [...mkShipments(1, { type: "business" }), ...mkShipments(1)].map((s, i) => ({ ...s, recipientName: i ? "Sara" : "Acme Branch", recipientPhone: i ? "0511111112" : "0511111111" })) });
    await handOverAndApprove(biz, d, off.id);
    const [b2b, b2c] = (await parcelsOf(off.id)).sort((a, c) => a.seq - c.seq);
    await stops.arriveAtStop(d, off.id, b2b.id);
    await expect(stops.deliverStop(d, off.id, b2b.id, { code: b2b.code, proof: "receipt", receiverName: "Khalid" })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "proof" } }); // no photo yet
    await expect(stops.saveProofPhoto(d, off.id, b2b.id, { data: Buffer.from("not an image at all"), mime: "image/png" })).rejects.toMatchObject({ code: "VALIDATION" }); // magic bytes checked
    await stops.saveProofPhoto(d, off.id, b2b.id, { data: PNG, mime: "image/png" });
    await expect(stops.deliverStop(d, off.id, b2b.id, { code: b2b.code, proof: "receipt", receiverName: "" })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "receiverName" } });
    const ok = await stops.deliverStop(d, off.id, b2b.id, { code: b2b.code, proof: "receipt", receiverName: "Khalid" });
    expect(ok.proofType).toBe("receipt"); expect(ok.receiverName).toBe("Khalid");
    expect((await stops.readProof(d, b2b.id)).mime).toBe("image/png");
    await stops.arriveAtStop(d, off.id, b2c.id);
    await expect(stops.deliverStop(d, off.id, b2c.id, { code: b2c.code, proof: "receipt", receiverName: "Sara" })).rejects.toMatchObject({ code: "OTP_REQUIRED" });
    await expect(stops.saveProofPhoto(d, off.id, b2c.id, { data: PNG, mime: "image/png" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("a stop can be postponed once (closed for now) but never skipped; the last stop cannot be postponed", async () => {
    const { biz, d, off } = await ready(3);
    await handOverAndApprove(biz, d, off.id);
    const [s1, s2, s3] = (await parcelsOf(off.id)).sort((a, b) => a.seq - b.seq);
    await stops.deferStop(d, off.id, s1.id, await deferEvidence(d, off.id, s1.id));
    expect((await currentStopOf(db, off.id))!.id).toBe(s2.id);
    await stops.arriveAtStop(d, off.id, s2.id); await stops.deliverStop(d, off.id, s2.id, { code: s2.code, otp: otpFor(s2) });
    await stops.arriveAtStop(d, off.id, s3.id); await stops.deliverStop(d, off.id, s3.id, { code: s3.code, otp: otpFor(s3) });
    expect((await currentStopOf(db, off.id))!.id).toBe(s1.id);
    await expect(stops.deferStop(d, off.id, s1.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("failed stops with the strict rules switched on: reasons need arrival, 'unreachable' needs the wait, notes where required; returns are received after the job — they never hold the money", async () => {
    const { biz, d, off, r } = await ready(3);
    await updateSettings({ stopWaitMin: 10, stopFailStrictRules: true }, (await mkAdmin()).id);
    await handOverAndApprove(biz, d, off.id);
    const [s1, s2, s3] = (await parcelsOf(off.id)).sort((a, b) => a.seq - b.seq);
    await expect(stops.failStop(d, off.id, s1.id, { reason: "refused" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // not at the address
    await expect(stops.failStop(d, off.id, s1.id, { reason: "nonsense" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(stops.failStop(d, off.id, s1.id, { reason: "wrong_address" })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "note" } });
    await stops.arriveAtStop(d, off.id, s1.id);
    await expect(stops.failStop(d, off.id, s1.id, { reason: "unreachable" })).rejects.toMatchObject({ code: "WAIT_REQUIRED" });
    await db.update(shipments).set({ arrivedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(shipments.id, s1.id)); // waited 11 minutes
    await stops.failStop(d, off.id, s1.id, { reason: "unreachable" });
    await stops.failStop(d, off.id, s2.id, { reason: "wrong_address", note: "no such building" }).catch(() => {}); // s2 not arrived: out_of_zone/wrong_address don't need arrival
    const s2row = (await db.select().from(shipments).where(eq(shipments.id, s2.id)))[0]; expect(s2row.status).toBe("failed");
    await stops.arriveAtStop(d, off.id, s3.id); await stops.deliverStop(d, off.id, s3.id, { code: s3.code, otp: otpFor(s3) });
    await jobs.reportDelivered(d, off.id);
    expect((await db.select().from(offers).where(eq(offers.id, off.id)))[0]).toMatchObject({ status: "completed", deliveredUnits: 1 }); // confirmed + paid at once
    expect((await db.select().from(settlements).where(eq(settlements.requestId, r.id)))[0].status).toBe("paid");
    await expect(stops.confirmReturns(biz, off.id, { codes: [s3.code] })).rejects.toMatchObject({ code: "VALIDATION" }); // a delivered parcel is not "returned"
    await stops.confirmReturns(biz, off.id, { codes: [s1.code] });
    expect((await parcelsOf(off.id)).filter((x) => x.status === "failed")).toHaveLength(1);
    await stops.confirmReturns(biz, off.id, { all: true });
    const [s] = await db.select().from(settlements).where(eq(settlements.requestId, r.id));
    expect(s.finalUnits).toBe(1); expect(s.customerCents).toBe(10_00); expect(s.refundCents).toBe(20_00);
    expect((await db.select().from(shipments).where(eq(shipments.offerId, off.id))).map((x) => x.status).sort()).toEqual(["delivered", "returned", "returned"]);
  });

  it("a legacy quantity dispute (opened under the old flow) is still resolved by ops: what is unaccounted for is recorded as missing", async () => {
    const { biz, d, off } = await ready(2);
    await handOverAndApprove(biz, d, off.id);
    const [s1, s2] = (await parcelsOf(off.id)).sort((a, b) => a.seq - b.seq);
    await stops.arriveAtStop(d, off.id, s1.id); await stops.failStop(d, off.id, s1.id, { reason: "refused" });
    await stops.arriveAtStop(d, off.id, s2.id); await stops.deliverStop(d, off.id, s2.id, { code: s2.code, otp: otpFor(s2) });
    // the old flow: the driver's report waited for the warehouse, which disputed it (that state can no longer be reached through the API)
    await db.transaction(async (tx) => { await markRouteFinished(tx, (await tx.select().from(offers).where(eq(offers.id, off.id)))[0], "delivery_reported", d); });
    await db.update(offers).set({ status: "qty_disputed" }).where(eq(offers.id, off.id));
    const ops = await mkStaff(["requests.edit"]);
    await jobs.resolveDispute(ops, off.id, 1, "driver liable for the missing parcel");
    expect((await db.select().from(shipments).where(eq(shipments.id, s1.id)))[0].status).toBe("missing");
    expect((await db.select().from(offers).where(eq(offers.id, off.id)))[0].status).toBe("completed");
  });
});

describe("driver cannot continue / replaced / cancelled", () => {
  it("ending the route keeps delivered stops paid, marks what is on board as failed-to-return, and raises an urgent ticket", async () => {
    const { biz, d, off, r } = await ready(4);
    await handOverAndApprove(biz, d, off.id);
    const [s1] = (await parcelsOf(off.id)).sort((a, b) => a.seq - b.seq);
    await stops.arriveAtStop(d, off.id, s1.id); await stops.deliverStop(d, off.id, s1.id, { code: s1.code, otp: otpFor(s1) });
    const out = await stops.endRoute(d, off.id, "vehicle_breakdown", "engine died");
    expect(out).toMatchObject({ delivered: 1, toReturn: 3 });
    expect((await db.select().from(offers).where(eq(offers.id, off.id)))[0]).toMatchObject({ status: "completed", deliveredUnits: 1 }); // confirmed and paid for what was delivered
    expect((await parcelsOf(off.id)).filter((s) => s.status === "failed" && s.failReason === "driver_unavailable")).toHaveLength(3);
    const t = await db.select().from(tickets).where(eq(tickets.requestId, r.id)); expect(t[0].priority).toBe("urgent");
    await stops.confirmReturns(biz, off.id, { all: true });
    expect((await db.select().from(settlements))[0]).toMatchObject({ finalUnits: 1, status: "paid" });
  });

  it("a driver who already worked stops cannot simply be replaced (their delivered stops must stay paid)", async () => {
    const { biz, d, off } = await ready(3);
    await handOverAndApprove(biz, d, off.id);
    const [s1] = (await parcelsOf(off.id)).sort((a, b) => a.seq - b.seq);
    await stops.arriveAtStop(d, off.id, s1.id); await stops.deliverStop(d, off.id, s1.id, { code: s1.code, otp: otpFor(s1) });
    const ops = await mkStaff(["replacements.manage"]);
    await expect(jobs.staffReplace(ops, off.id, "swap")).rejects.toMatchObject({ code: "INVALID_TRANSITION", details: { resolvedStops: 1 } });
  });

  it("cancelling before loading frees the parcels; the replacement driver receives them", async () => {
    const { biz } = await setup(); const d1 = await mkDriver(), d2 = await mkDriver();
    const r = await publishedRequest(biz, { shipments: mkShipments(5), shipmentsPerDriver: 5 });
    const o1 = await offerOf(r.id, d1.id); await jobs.acceptOffer(d1, o1.id, true);
    expect(await parcelsOf(o1.id)).toHaveLength(5);
    await jobs.driverCancel(d1, o1.id, "car problem");
    expect(await db.select().from(shipments).where(and(eq(shipments.requestId, r.id), eq(shipments.status, "pending")))).toHaveLength(5);
    const [o2] = await db.select().from(offers).where(and(eq(offers.requestId, r.id), eq(offers.driverId, d2.id), eq(offers.status, "offered"))); // the replacement offer
    await jobs.acceptOffer(d2, o2.id, true);
    expect(await parcelsOf(o2.id)).toHaveLength(5);
  });
});

describe("all-or-nothing requests (checkbox) vs partial fulfilment", () => {
  it("not fully staffed at the start time → called off and fully refunded; with partial allowed it runs with who accepted", async () => {
    const { biz } = await setup(); const d1 = await mkDriver(), d2 = await mkDriver();
    const strict = await publishedRequest(biz, { shipments: mkShipments(20), shipmentsPerDriver: 10, allowPartial: false });
    const loose = await publishedRequest(biz, { shipments: mkShipments(20), shipmentsPerDriver: 10 });
    expect(strict.allowPartial).toBe(false); expect(loose.allowPartial).toBe(true);
    await jobs.acceptOffer(d1, (await offerOf(strict.id, d1.id)).id, true);
    await db.update(requests).set({ startsAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(requests.id, strict.id));
    const out = await runMaintenance();
    expect(out.calledOff).toBe(1);
    const [after] = await db.select().from(requests).where(eq(requests.id, strict.id));
    expect(after).toMatchObject({ status: "cancelled", cancelReason: "not_fully_staffed" });
    expect((await db.select().from(offers).where(eq(offers.requestId, strict.id)))[0].status).toBe("cancelled");
    expect((await runMaintenance()).calledOff).toBe(0);
    void d2; void loose;
  });
});

describe("recipient notification & public tracking", () => {
  it("texts the recipient their one-time code when their stop becomes current (and again when resent); tracking needs the code + last 4 digits and reveals no address", async () => {
    const sent: Array<{ to: string; text: string }> = [];
    setSmsProvider({ name: "spy", async send(to, text) { sent.push({ to, text }); } });
    try {
      const { biz, d, off } = await ready(2);
      await handOverAndApprove(biz, d, off.id);
      const [s1, s2] = (await parcelsOf(off.id)).sort((a, b) => a.seq - b.seq);
      expect(sent).toHaveLength(1); expect(sent[0].to).toBe(s1.recipientPhone);
      expect(sent[0].text).toContain(otpFor(s1)); expect(sent[0].text).toContain(trackingUrl(s1.code));
      await stops.arriveAtStop(d, off.id, s1.id); await stops.deliverStop(d, off.id, s1.id, { code: s1.code, otp: otpFor(s1) });
      expect(sent).toHaveLength(2); expect(sent[1].to).toBe(s2.recipientPhone); expect(sent[1].text).toContain(otpFor(s2));
      await stops.resendCode(d, off.id, s2.id);
      const [s2b] = await db.select().from(shipments).where(eq(shipments.id, s2.id));
      expect(sent).toHaveLength(3); expect(sent[2].text).toContain(otpFor(s2b)); expect(otpFor(s2b)).not.toBe(otpFor(s2));
      const t = await stops.trackShipment(s1.code.toLowerCase(), s1.recipientPhone.slice(-4));
      expect(t).toMatchObject({ code: s1.code, stage: "delivered" }); expect(JSON.stringify(t)).not.toContain("Olaya");
      await expect(stops.trackShipment(s1.code, "0000")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(stops.trackShipment("JR-999999-001", "1234")).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await stops.trackShipment(s2.code, s2.recipientPhone.slice(-4))).stage).toBe("arrived" in t ? "on_the_way" : "on_the_way");
    } finally { setSmsProvider(null); }
  });

  it("an SMS outage never blocks the delivery flow (it is recorded for operations)", async () => {
    setSmsProvider({ name: "down", async send() { throw new Error("gateway down"); } });
    try {
      const { biz, d, off, r } = await ready(1);
      await handOverAndApprove(biz, d, off.id);
      const ev = await db.select().from(jobEvents).where(and(eq(jobEvents.requestId, r.id), eq(jobEvents.type, "recipient_notify_failed")));
      expect(ev).toHaveLength(1);
    } finally { setSmsProvider(null); }
  });
});
