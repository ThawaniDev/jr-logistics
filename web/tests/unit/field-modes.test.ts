/**
 * Platform update J2 / J3 — pure pieces of the routing switch and the B2B switch: settings defaults, error codes, what the driver's stop view shows with
 * routing off / on, the server-driven action list, the demo parcels.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "@/server/settings";
import { AppError, err } from "@/lib/errors";
import { driverStopView } from "@/server/shipments";
import { driverActions } from "@/server/views";
import { demoShipments } from "@/server/demo-shipments";
import { en, ar, ur } from "@/i18n/fragments/rd-j-f1";
import type { Offer, Request, Shipment } from "@/db/schema";

const parcel = (o: Partial<Shipment> = {}): Shipment => ({
  id: "s1", requestId: "r1", offerId: "o1", seq: 1, code: "JR-000001-001", externalRef: null, recipientType: "consumer", recipientName: "Mona Ali", recipientPhone: "+966555555555",
  address: "King Fahd Rd 120, Riyadh", city: "riyadh", lat: 24.7, lng: 46.6, contents: "Clothes", notes: null, status: "loaded", stopOrder: 1, attempts: 0, deferCount: 0,
  arrivedAt: null, otpAttempts: 0, otpSends: 0, otpVersion: 1, codCents: 0, codCollectedCents: null, proofKey: null, createdAt: new Date("2026-11-20T08:00:00Z"),
  deliveredAt: null, proofType: null, failReason: null, failNote: null, legDistanceM: null, legDurationS: null, geoSource: null, ...o,
} as unknown as Shipment);
const base = { stopWaitMin: 0, remaining: 3, needsOtp: true } as const;

describe("settings defaults and error codes (J2 / J3)", () => {
  it("routing and B2B shipments are OFF by default", () => {
    expect(DEFAULT_SETTINGS.routingEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.b2bShipmentsEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.driverCanReorderRoute).toBe(true); // unchanged: only meaningful while routing is on
  });
  it("ROUTING_DISABLED is a 409 and B2B_DISABLED a 422, both carry their own message", () => {
    expect(err("ROUTING_DISABLED")).toBeInstanceOf(AppError);
    expect(err("ROUTING_DISABLED").status).toBe(409);
    expect(err("B2B_DISABLED").status).toBe(422);
  });
  it("both error codes and the coercion event are translated in en, ar and ur", () => {
    for (const k of ["err.ROUTING_DISABLED", "err.B2B_DISABLED", "event.shipments_b2b_coerced"]) for (const d of [en, ar, ur]) expect(d[k]?.length, k).toBeGreaterThan(5);
  });
});

describe("driverStopView — new fields (J2)", () => {
  it("paymentMode follows the cash amount, createdAt is the parcel's date, pieces is always 1", () => {
    const prepaid = driverStopView(parcel(), { ...base, currentId: "s1", routeApproved: true });
    const cod = driverStopView(parcel({ codCents: 4500 }), { ...base, currentId: "s1", routeApproved: true });
    expect(prepaid).toMatchObject({ paymentMode: "prepaid", pieces: 1, codCents: 0 });
    expect(cod).toMatchObject({ paymentMode: "cod", pieces: 1, codCents: 4500 });
    expect(prepaid.createdAt).toEqual(new Date("2026-11-20T08:00:00Z"));
  });
});

describe("driverStopView — routing ON is exactly as before", () => {
  it("name and phone only for the current stop (phone only once the route is approved); the others stay anonymous", () => {
    const cur = driverStopView(parcel({ id: "a" }), { ...base, currentId: "a", routeApproved: true });
    const other = driverStopView(parcel({ id: "b", seq: 2 }), { ...base, currentId: "a", routeApproved: true });
    expect(cur).toMatchObject({ current: true, recipientName: "Mona Ali", recipientPhone: "+966555555555", canDefer: true });
    expect(other).toMatchObject({ current: false, recipientName: null, recipientPhone: null, canDefer: false });
    const before = driverStopView(parcel({ id: "a" }), { ...base, currentId: "a", routeApproved: false });
    expect(before.recipientPhone).toBeNull();
  });
  it("a resolved stop shows the name but never the phone", () => {
    const done = driverStopView(parcel({ status: "delivered" }), { ...base, currentId: null, routeApproved: true });
    expect(done).toMatchObject({ recipientName: "Mona Ali", recipientPhone: null, current: false });
  });
});

describe("driverStopView — routing OFF", () => {
  const off = { ...base, routing: false, started: true, routeApproved: true } as const;
  it("every open stop of his own job shows name AND phone; only the first unresolved one is `current`", () => {
    const a = driverStopView(parcel({ id: "a" }), { ...off, currentId: "a" });
    const b = driverStopView(parcel({ id: "b", seq: 2, status: "loaded" }), { ...off, currentId: "a" });
    const pending = driverStopView(parcel({ id: "c", seq: 3, status: "pending" }), { ...off, currentId: "a" });
    expect(a.current).toBe(true); expect(b.current).toBe(false);
    for (const v of [a, b, pending]) expect(v).toMatchObject({ recipientName: "Mona Ali", recipientPhone: "+966555555555" });
  });
  it("resolved stops keep the name but not the phone", () => {
    for (const status of ["delivered", "failed", "returned", "missing"]) {
      expect(driverStopView(parcel({ status }), { ...off, currentId: null })).toMatchObject({ recipientName: "Mona Ali", recipientPhone: null });
    }
  });
  it("any open stop may be postponed / has the door timer, not only the current one; the last stop cannot be postponed", () => {
    const arrivedAt = new Date(Date.now() - 60_000);
    const b = driverStopView(parcel({ id: "b", arrivedAt }), { ...off, stopWaitMin: 10, currentId: "a" });
    expect(b.current).toBe(false); expect(b.canDefer).toBe(true); expect(b.waitRemainingSec).toBeGreaterThan(0);
    expect(driverStopView(parcel({ id: "b" }), { ...off, remaining: 1, currentId: "a" }).canDefer).toBe(false);
    expect(driverStopView(parcel({ id: "b", deferCount: 1 }), { ...off, currentId: "a" }).canDefer).toBe(false);
  });
  it("before loading is confirmed (`started` false) nothing is current or actionable", () => {
    const v = driverStopView(parcel({ id: "a" }), { ...off, started: false, currentId: "a" });
    expect(v).toMatchObject({ current: false, canDefer: false });
  });
});

describe("driverActions — no approve-route step while routing is off", () => {
  const offer = (o: Partial<Offer> = {}) => ({ id: "o1", status: "attendance_confirmed", loadedUnits: 3, loadedAckByDriver: true, routeApprovedAt: null, ...o } as unknown as Offer);
  const req = { service: "delivery_driver" } as unknown as Request;
  it("routing on: loaded + acknowledged but not approved → approve_route (as before)", () => {
    expect(driverActions(offer(), req, { manifest: true, remaining: 3 })).toEqual(["approve_route", "report_no_work"]);
    expect(driverActions(offer(), req, { manifest: true, remaining: 3, routing: true })).toEqual(["approve_route", "report_no_work"]);
  });
  it("routing off: straight to the stops, even for a job that was mid-flow when the switch flipped (never approved)", () => {
    expect(driverActions(offer(), req, { manifest: true, remaining: 3, routing: false })).toEqual(["work_stops", "end_route"]);
    expect(driverActions(offer(), req, { manifest: true, remaining: 0, routing: false })).toEqual(["report_delivered"]);
  });
  it("an approved route behaves the same with the switch on or off", () => {
    const approved = offer({ routeApprovedAt: new Date() });
    for (const routing of [true, false]) expect(driverActions(approved, req, { manifest: true, remaining: 2, routing })).toEqual(["work_stops", "end_route"]);
  });
  it("the loading steps before the acknowledgement are unchanged either way", () => {
    const warehouse = offer({ loadedAckByDriver: null });
    for (const routing of [true, false]) expect(driverActions(warehouse, req, { manifest: true, remaining: 3, routing })).toEqual(["ack_loading", "dispute_loading", "report_no_work"]);
  });
});

describe("demo parcels (J3)", () => {
  it("with B2B on, every 4th demo parcel is a business (20 of 80); with it off, all 80 are consumers — same parcels otherwise", () => {
    const on = demoShipments("riyadh")!, onExplicit = demoShipments("riyadh", { b2b: true })!, off = demoShipments("riyadh", { b2b: false })!;
    expect(on.filter((p) => p.recipientType === "business")).toHaveLength(20);
    expect(onExplicit).toEqual(on);
    expect(off).toHaveLength(80);
    expect(off.every((p) => p.recipientType === "consumer")).toBe(true);
    expect(off.map((p) => ({ ...p, recipientType: "x" }))).toEqual(on.map((p) => ({ ...p, recipientType: "x" })));
  });
});
