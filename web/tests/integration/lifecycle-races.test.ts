/**
 * A3 audit — concurrency: the same action fired twice at the same instant (double tap, retry storm, two devices) and conflicting actions racing
 * (accept vs cancel, deliver vs fail, cancel vs cancel, tick vs tick). Whatever the interleaving, a state is reached exactly once, money balances,
 * no event is written twice and no row is left half-changed.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, shipments, jobEvents, codRemittances, settlements } from "@/db/schema";
import { shutdown, resetDb, mkBusiness, mkDriver, mkAdmin, mkRule, publishedRequest, mkShipments } from "../helpers/factories";
import { setFieldModes } from "../helpers/field-modes";
import { offerRow, parcelsOf, requestRow, worldAt, allParcels } from "../helpers/lifecycle-world";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { otpFor } from "@/server/shipments";
import { cancelRequest, publishRequest, createDraft } from "@/server/requests";
import { cancelShipment } from "@/server/stops";
import { runMaintenance } from "@/server/maintenance";
import { receiveCash } from "@/server/cod";
import { moneyViolations } from "../helpers/invariants";
import { reqInput } from "../helpers/factories";

afterAll(shutdown);
beforeEach(async () => { await resetDb(); await setFieldModes({ routing: true, b2b: true }); });

const settled = (r: PromiseSettledResult<unknown>[]) => ({ ok: r.filter((x) => x.status === "fulfilled").length, codes: r.filter((x) => x.status === "rejected").map((x) => (x as PromiseRejectedResult).reason?.code as string) });
const events = async (requestId: string, type: string) => db.select().from(jobEvents).where(and(eq(jobEvents.requestId, requestId), eq(jobEvents.type, type)));

describe("the same stop action twice at once", () => {
  it("deliver ×2 (double tap): one delivery, the other is an idempotent replay; one event, COD counted once", async () => {
    const w = await worldAt("att_working", { n: 3 });
    const [s] = await parcelsOf(w.offerId);
    await db.update(shipments).set({ codCents: 5000 }).where(eq(shipments.id, s.id));
    await stops.arriveAtStop(w.driver, w.offerId, s.id);
    const input = { code: s.code, otp: otpFor(s), cashCollectedCents: 5000 };
    const r = await Promise.allSettled([stops.deliverStop(w.driver, w.offerId, s.id, input), stops.deliverStop(w.driver, w.offerId, s.id, input), stops.deliverStop(w.driver, w.offerId, s.id, input)]);
    expect(settled(r).ok).toBe(3); // replays answer with the stop
    expect((await events(w.requestId, "shipment_delivered")).filter((e) => (e.payload as { shipmentId?: string })?.shipmentId === s.id)).toHaveLength(1);
    const [row] = await db.select().from(shipments).where(eq(shipments.id, s.id));
    expect(row.status).toBe("delivered"); expect(row.codCollectedCents).toBe(5000); expect(row.attempts).toBe(1);
  });

  it("deliver vs fail on the same stop: exactly one of them wins, the other is refused", async () => {
    const w = await worldAt("att_working", { n: 3 });
    const [s] = await parcelsOf(w.offerId);
    await stops.arriveAtStop(w.driver, w.offerId, s.id);
    const r = await Promise.allSettled([stops.deliverStop(w.driver, w.offerId, s.id, { code: s.code, otp: otpFor(s) }), stops.failStop(w.driver, w.offerId, s.id, { reason: "refused" })]);
    const x = settled(r); expect(x.ok).toBe(1); expect(x.codes).toEqual(["INVALID_TRANSITION"]);
    const [row] = await db.select().from(shipments).where(eq(shipments.id, s.id));
    expect(["delivered", "failed"]).toContain(row.status);
    expect(row.attempts).toBe(1);
  });

  it("wrong code ×8 in parallel: the counter stops at the limit — never more than 5 guesses are accepted", async () => {
    const w = await worldAt("att_working", { n: 3 });
    const [s] = await parcelsOf(w.offerId);
    await stops.arriveAtStop(w.driver, w.offerId, s.id);
    const wrong = otpFor(s) === "0000" ? "1111" : "0000";
    const r = await Promise.allSettled(Array.from({ length: 8 }, () => stops.deliverStop(w.driver, w.offerId, s.id, { code: s.code, otp: wrong })));
    const x = settled(r); expect(x.ok).toBe(0);
    expect(x.codes.filter((c) => c === "OTP_INVALID")).toHaveLength(5);
    expect(x.codes.filter((c) => c === "OTP_LOCKED")).toHaveLength(3);
    const [row] = await db.select().from(shipments).where(eq(shipments.id, s.id));
    expect(row.otpAttempts).toBe(5);
  });

  it("finish the route ×2 (reportDelivered): one settlement, one completed event, wallet balanced", async () => {
    const w = await worldAt("att_all_resolved", { n: 3 });
    const r = await Promise.allSettled([jobs.reportDelivered(w.driver, w.offerId), jobs.reportDelivered(w.driver, w.offerId)]);
    const x = settled(r); expect(x.ok).toBe(1); expect(x.codes).toEqual(["INVALID_TRANSITION"]);
    expect((await offerRow(w.offerId)).status).toBe("completed");
    expect(await db.select().from(settlements).where(eq(settlements.requestId, w.requestId))).toHaveLength(1);
    expect(await events(w.requestId, "request_completed")).toHaveLength(1);
    expect(await moneyViolations()).toEqual([]);
  });

  it("end-route (driver) vs finish (reportDelivered) vs ops end-route: one outcome, one settlement", async () => {
    const w = await worldAt("att_all_resolved", { n: 3 });
    const r = await Promise.allSettled([jobs.reportDelivered(w.driver, w.offerId), stops.endRoute(w.driver, w.offerId, "breakdown"), stops.endRoute(w.admin, w.offerId, "ops ended it")]);
    expect(settled(r).ok).toBe(1);
    expect(await db.select().from(settlements).where(eq(settlements.requestId, w.requestId))).toHaveLength(1);
    expect(await moneyViolations()).toEqual([]);
  });
});

describe("conflicting job actions", () => {
  it("driver cancel vs business attendance confirm: the offer ends in exactly one of the two states and the request slot count matches", async () => {
    const w = await worldAt("arrived", { n: 3 });
    const r = await Promise.allSettled([jobs.driverCancel(w.driver, w.offerId, "cannot continue"), jobs.confirmAttendance(w.biz, w.offerId, true)]);
    const o = await offerRow(w.offerId), q = await requestRow(w.requestId);
    expect(["cancelled", "attendance_confirmed"]).toContain(o.status);
    expect(settled(r).ok).toBeGreaterThanOrEqual(1);
    if (o.status === "cancelled") { expect(q.slotsFilled).toBe(0); expect(["filling", "published"]).toContain(q.status); expect((await allParcels(w.requestId)).every((p) => p.offerId === null)).toBe(true); }
    else expect(q.slotsFilled).toBe(1);
  });

  it("business cancels the request while the driver accepts: either the accept is refused, or the offer is cancelled with the request — never an accepted offer on a cancelled request", async () => {
    await setFieldModes({ routing: true });
    const w = await worldAt("offered", { n: 3 });
    const r = await Promise.allSettled([jobs.acceptOffer(w.driver, w.offerId, true), cancelRequest(w.biz, w.requestId, "changed mind")]);
    void r;
    const q = await requestRow(w.requestId), o = await offerRow(w.offerId);
    expect(q.status).toBe("cancelled");
    expect(["cancelled", "expired", "offered"]).toContain(o.status);
    expect(o.status).not.toBe("accepted");
    const money = await moneyViolations(); expect(money).toEqual([]);
    expect(q.reservedCents).toBe(0);
  });

  it("publish ×3 of one draft: one escrow reservation, one dispatch", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 }); await mkDriver();
    const d = await createDraft(biz, reqInput({ shipments: mkShipments(4), shipmentsPerDriver: 2 }));
    const r = await Promise.allSettled([1, 2, 3].map(() => publishRequest(biz, d.id, { termsAccepted: true })));
    const x = settled(r); expect(x.ok).toBe(1); expect(x.codes.every((c) => c === "INVALID_TRANSITION")).toBe(true);
    const [q] = await db.select().from(requests).where(eq(requests.id, d.id));
    expect(q.reservedCents).toBe(q.totalCents);
    expect(await moneyViolations()).toEqual([]);
  });

  it("cancel ×3 of one request (business ×2 + ops): the escrow returns once", async () => {
    const w = await worldAt("accepted", { n: 3 });
    const r = await Promise.allSettled([cancelRequest(w.biz, w.requestId, "first"), cancelRequest(w.biz, w.requestId, "second"), cancelRequest(w.admin, w.requestId, "ops")]);
    expect(settled(r).ok).toBe(1);
    expect((await requestRow(w.requestId)).reservedCents).toBe(0);
    expect(await moneyViolations()).toEqual([]);
  });

  it("cancel the same pending parcel ×3: refunded once", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 }); await mkDriver();
    const r0 = await publishedRequest(biz, { shipments: mkShipments(4), shipmentsPerDriver: 2 });
    const [p] = await allParcels(r0.id);
    const before = await requestRow(r0.id);
    const r = await Promise.allSettled([1, 2, 3].map(() => cancelShipment(biz, p.id, "no longer needed")));
    expect(settled(r).ok).toBe(1);
    const after = await requestRow(r0.id);
    expect(before.reservedCents - after.reservedCents).toBe(before.unitPriceCents);
    expect(await moneyViolations()).toEqual([]);
  });

  it("COD received ×3 for the full outstanding amount: only the first is recorded", async () => {
    const w = await worldAt("att_working", { n: 3 });
    const [s] = await parcelsOf(w.offerId);
    await db.update(shipments).set({ codCents: 7000 }).where(eq(shipments.id, s.id));
    await stops.arriveAtStop(w.driver, w.offerId, s.id);
    await stops.deliverStop(w.driver, w.offerId, s.id, { code: s.code, otp: otpFor(s), cashCollectedCents: 7000 });
    const r = await Promise.allSettled([1, 2, 3].map(() => receiveCash(w.biz, w.offerId, 7000, "handed over")));
    expect(settled(r).ok).toBe(1);
    const rem = await db.select().from(codRemittances).where(eq(codRemittances.offerId, w.offerId));
    expect(rem).toHaveLength(1);
  });
});

describe("housekeeping ticks", () => {
  it("three ticks at once expire a lapsed request, refund it once and leave a partly staffed one consistent", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 }); const d = await mkDriver();
    const lapsed = await publishedRequest(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2 });
    const partial = await publishedRequest(biz, { shipments: mkShipments(4), shipmentsPerDriver: 2, startsAt: new Date(Date.now() + 2 * 864e5) });
    const off = (await db.select().from(offers).where(and(eq(offers.requestId, partial.id), eq(offers.driverId, d.id))))[0];
    await jobs.acceptOffer(d, off.id, true);
    await db.update(requests).set({ startsAt: new Date(Date.now() - 3 * 3600_000) }).where(sql`id in (${lapsed.id}, ${partial.id})`);
    const r = await Promise.allSettled([runMaintenance(), runMaintenance(), runMaintenance()]);
    expect(settled(r).ok).toBe(3);
    expect((await requestRow(lapsed.id)).status).toBe("expired");
    const p = await requestRow(partial.id);
    expect(p.quantity).toBe(1); expect(p.slotsFilled).toBe(1);
    expect(await moneyViolations()).toEqual([]);
    expect(await events(lapsed.id, "request_expired")).toHaveLength(1);
    expect(await events(partial.id, "unfilled_slots_closed")).toHaveLength(1);
  });
});
