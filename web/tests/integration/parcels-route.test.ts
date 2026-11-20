import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobEvents, notifications, offers, requests, shipments } from "@/db/schema";
import { shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, publishedRequest, mkShipments, reqInput, WAREHOUSE } from "../helpers/factories";
import { resetDbWithFieldModes } from "../helpers/field-modes";
import { call } from "../helpers/api";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { createDraft, estimate, publishRequest } from "@/server/requests";
import { currentStopOf, otpFor, prepareManifest } from "@/server/shipments";
import { businessRequestDetail, driverJobView } from "@/server/views";
import { planOfferRoute } from "@/server/route-plan";
import { remindIncompleteParcels } from "@/server/maintenance";
import { createSession } from "@/server/auth/session";
import { DEFAULT_CITIES } from "@/server/catalog";
import { demoShipments } from "@/server/demo-shipments";

beforeEach(resetDbWithFieldModes); // J2 / J3: routing and B2B shipments default to OFF — this suite exercises the route / approve-route / business-parcel behaviour
afterAll(shutdown);

const tok = async (u: { id: string }) => (await createSession(u.id, "mobile")).token;
const offerOf = async (requestId: string, driverId: string) => (await db.select().from(offers).where(and(eq(offers.requestId, requestId), eq(offers.driverId, driverId))))[0];
async function setup(funds = 5000_00) { const admin = await mkAdmin(); await mkRule(admin); const biz = await mkBusiness({ fundsCents: funds }); return { admin, biz }; }

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("orders booked by count — recipient details later", () => {
  it("books N blank placeholder parcels from a count alone, priced and sized exactly like a full manifest", async () => {
    const { biz } = await setup();
    const est = await estimate(biz, reqInput({ shipments: null, shipmentCount: 40, detailsLater: true, shipmentsPerDriver: 20 }));
    expect(est).toMatchObject({ available: true, quote: { quantity: 2, totalUnits: 40, totalCents: 400_00 } });
    const d = await createDraft(biz, reqInput({ shipments: [], shipmentCount: 5, detailsLater: true, shipmentsPerDriver: 10 }));
    const rows = await db.select().from(shipments).where(eq(shipments.requestId, d.id)).orderBy(asc(shipments.seq));
    expect(rows).toHaveLength(5);
    expect(rows.every((s) => !s.detailsComplete && s.recipientName === "" && s.recipientPhone === "" && s.address === "")).toBe(true);
    expect(rows.every((s) => s.city === "riyadh" && s.status === "pending")).toBe(true);
    expect(rows.map((s) => s.code)).toEqual([1, 2, 3, 4, 5].map((n) => `${d.ref}-00${n}`));
    const pub = await publishRequest(biz, d.id, { termsAccepted: true }); // publishing with a count only works, escrow = exactly 5 parcels
    expect(pub.status).toBe("published"); expect(pub.totalCents).toBe(5 * 10_00); expect(pub.reservedCents).toBe(5 * 10_00);
  });

  it("is opt-in: without `detailsLater` every parcel still needs name, phone and address; whatever IS given must be valid either way", async () => {
    const { biz } = await setup();
    const rows = mkShipments(3);
    await expect(createDraft(biz, reqInput({ shipments: [rows[0], { recipientType: "consumer" }] }))).rejects.toMatchObject({ code: "VALIDATION", details: { row: 2, field: "shipments.1.recipientName" } });
    await expect(createDraft(biz, reqInput({ shipments: [rows[0], { ...rows[1], address: "" }] }))).rejects.toMatchObject({ code: "VALIDATION", details: { row: 2, field: "shipments.1.address" } });
    const later = { detailsLater: true as const };
    await expect(createDraft(biz, reqInput({ ...later, shipments: [rows[0], { ...rows[1], recipientPhone: "12" }] }))).rejects.toMatchObject({ code: "VALIDATION", details: { row: 2, field: "shipments.1.recipientPhone" } });
    await expect(createDraft(biz, reqInput({ ...later, shipments: [{ recipientName: "A" }] }))).rejects.toMatchObject({ code: "VALIDATION", details: { row: 1, field: "shipments.0.recipientName" } });
    await expect(createDraft(biz, reqInput({ ...later, shipments: [{ address: "abc" }] }))).rejects.toMatchObject({ code: "VALIDATION", details: { row: 1 } });
    // the key form the web client maps rows from is present too
    await expect(createDraft(biz, reqInput({ shipments: [{ recipientName: "x" }] }))).rejects.toMatchObject({ details: { "shipments.0.recipientName": expect.any(String) } });
  });

  it("mixes fully detailed parcels with blank ones; a partly known parcel keeps what it has", async () => {
    const { biz } = await setup();
    const full = mkShipments(2, { withRefs: true });
    const d = await createDraft(biz, reqInput({ shipments: [...full, { externalRef: "AWB-9", recipientName: "Sara Ali" }], shipmentCount: 5, detailsLater: true, shipmentsPerDriver: 10 }));
    const rows = await db.select().from(shipments).where(eq(shipments.requestId, d.id)).orderBy(asc(shipments.seq));
    expect(rows.map((s) => s.detailsComplete)).toEqual([true, true, false, false, false]);
    expect(rows[2]).toMatchObject({ externalRef: "AWB-9", recipientName: "Sara Ali", recipientPhone: "", address: "" });
    // a shorter count than the explicit parcels never drops any
    const d2 = await createDraft(biz, reqInput({ shipments: full, shipmentCount: 1, detailsLater: true, shipmentsPerDriver: 10 }));
    expect(await db.select().from(shipments).where(eq(shipments.requestId, d2.id))).toHaveLength(2);
  });

  it("the request detail reports how many parcels still need details", async () => {
    const { biz } = await setup();
    const r = await publishedRequest(biz, { shipments: [...mkShipments(2)], shipmentCount: 6, detailsLater: true, shipmentsPerDriver: 10 });
    expect((await businessRequestDetail(r, biz)).incompleteParcels).toBe(4);
  });

  it("the warehouse cannot hand over a parcel without details — all:true or by code — but can hand over just the complete ones", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz, { shipments: [...mkShipments(2, { withRefs: true })], shipmentCount: 5, detailsLater: true, shipmentsPerDriver: 10 });
    const off = await offerOf(r.id, d.id);
    await jobs.acceptOffer(d, off.id, true); await jobs.confirmAttendance(biz, off.id, true);
    const all = await db.select().from(shipments).where(eq(shipments.requestId, r.id)).orderBy(asc(shipments.seq));
    await expect(jobs.recordLoading(biz, off.id, undefined, { all: true })).rejects.toMatchObject({ code: "DETAILS_INCOMPLETE", status: 422, details: { count: expect.any(Number), codes: expect.any(Array) } });
    await expect(jobs.recordLoading(biz, off.id, undefined, { codes: [all[0].code, all[3].code] })).rejects.toMatchObject({ code: "DETAILS_INCOMPLETE", details: { count: 1, codes: [all[3].code] } });
    expect((await db.select().from(shipments).where(and(eq(shipments.requestId, r.id), eq(shipments.status, "loaded")))).length).toBe(0); // nothing moved
    const o = await jobs.recordLoading(biz, off.id, undefined, { codes: [all[0].code, all[1].code] });
    expect(o.loadedUnits).toBe(2);
    expect((await db.select().from(shipments).where(and(eq(shipments.requestId, r.id), eq(shipments.status, "pending")))).map((s) => s.offerId)).toEqual([null, null, null]); // the rest are back in the pool
  });

  it("details can be completed bit by bit; the last missing piece completes the parcel and is logged; a complete parcel cannot be blanked", async () => {
    const { biz } = await setup();
    const r = await publishedRequest(biz, { shipments: null, shipmentCount: 3, detailsLater: true, shipmentsPerDriver: 10 });
    const [p1] = await db.select().from(shipments).where(eq(shipments.requestId, r.id)).orderBy(asc(shipments.seq));
    let v = await stops.updateShipment(biz, p1.id, { recipientName: "Ali Saleh" });
    expect(v).toMatchObject({ recipientName: "Ali Saleh", detailsComplete: false });
    v = await stops.updateShipment(biz, p1.id, { recipientPhone: "0555123456", address: "12 Olaya St, Riyadh" });
    expect(v).toMatchObject({ detailsComplete: true, recipientPhone: "+966555123456" });
    const ev = await db.select().from(jobEvents).where(and(eq(jobEvents.requestId, r.id), eq(jobEvents.type, "shipment_details_completed")));
    expect(ev).toHaveLength(1);
    await expect(stops.updateShipment(biz, p1.id, { address: "" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(stops.updateShipment(biz, p1.id, { recipientPhone: "12" })).rejects.toMatchObject({ code: "VALIDATION" });
    // a half-typed value is never silently stored
    const [p2] = (await db.select().from(shipments).where(eq(shipments.requestId, r.id)).orderBy(asc(shipments.seq))).slice(1);
    await expect(stops.updateShipment(biz, p2.id, { recipientPhone: "12" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("bulk completion by code / manifest number: all-or-nothing, row-numbered errors, owner only, only while parcels are at the warehouse", async () => {
    const { biz } = await setup(); const other = await mkBusiness(); const d = await mkDriver();
    const r = await publishedRequest(biz, { shipments: null, shipmentCount: 4, detailsLater: true, shipmentsPerDriver: 10 });
    const rows = await db.select().from(shipments).where(eq(shipments.requestId, r.id)).orderBy(asc(shipments.seq));
    const good = (i: number) => ({ recipientName: `Customer ${i}`, recipientPhone: `05551234${i}0`, address: `${i} King Fahd Rd, Riyadh` });
    // one bad row → nothing is applied
    await expect(stops.completeShipments(biz, r.id, [{ code: rows[0].code, ...good(1) }, { seq: 2, ...good(2), recipientPhone: "12" }])).rejects.toMatchObject({ code: "VALIDATION", details: { row: 2, field: "rows.1.recipientPhone" } });
    expect((await db.select().from(shipments).where(eq(shipments.requestId, r.id))).every((s) => !s.detailsComplete)).toBe(true);
    await expect(stops.completeShipments(biz, r.id, [{ code: "JR-NOPE-001", ...good(1) }])).rejects.toMatchObject({ code: "VALIDATION", details: { row: 1 } });
    await expect(stops.completeShipments(biz, r.id, [{ seq: 1, ...good(1) }, { code: rows[0].code, ...good(2) }])).rejects.toMatchObject({ code: "VALIDATION", details: { row: 2 } }); // same parcel twice
    await expect(stops.completeShipments(other, r.id, [{ seq: 1, ...good(1) }])).rejects.toMatchObject({ code: "NOT_FOUND" });
    const res = await stops.completeShipments(biz, r.id, [{ code: rows[0].code, ...good(1) }, { seq: 2, ...good(2) }, { id: rows[2].id, ...good(3) }]);
    expect(res).toEqual({ updated: 3, completed: 3, stillIncomplete: 1 });
    // partial rows are kept as progress
    expect(await stops.completeShipments(biz, r.id, [{ seq: 4, recipientName: "Late One" }])).toEqual({ updated: 1, completed: 0, stillIncomplete: 1 });
    // once a parcel is with the driver it can no longer change
    const off = await offerOf(r.id, d.id);
    await jobs.acceptOffer(d, off.id, true); await jobs.confirmAttendance(biz, off.id, true);
    await jobs.recordLoading(biz, off.id, undefined, { codes: [rows[0].code] });
    await expect(stops.completeShipments(biz, r.id, [{ seq: 1, recipientName: "Changed Name" }])).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("the business is reminded once the start is near — at most every 4 hours — until everything is complete", async () => {
    const { biz } = await setup();
    const r = await publishedRequest(biz, { shipments: null, shipmentCount: 3, detailsLater: true, shipmentsPerDriver: 10 });
    const at = (h: number) => new Date(r.startsAt.getTime() + h * 3600_000);
    const count = async () => (await db.select().from(notifications).where(and(eq(notifications.userId, biz.id), eq(notifications.type, "parcels_details_pending")))).length;
    // events carry real timestamps; pin the last reminder to the simulated clock so "4 hours later" can be tested
    const stamp = (when: Date) => db.update(jobEvents).set({ createdAt: when }).where(and(eq(jobEvents.requestId, r.id), eq(jobEvents.type, "details_reminder")));
    expect(await remindIncompleteParcels(at(-24))).toBe(0); expect(await count()).toBe(0); // start is far away
    expect(await remindIncompleteParcels(at(-5))).toBe(1); expect(await count()).toBe(1);
    const [n] = await db.select().from(notifications).where(eq(notifications.type, "parcels_details_pending"));
    expect(n.data).toMatchObject({ ref: r.ref, n: 3 });
    await stamp(at(-5));
    expect(await remindIncompleteParcels(at(-4.5))).toBe(0); expect(await count()).toBe(1); // not again within 4 h
    expect(await remindIncompleteParcels(at(-0.5))).toBe(1); expect(await count()).toBe(2); // 4.5 h later: again
    await stamp(at(-0.5));
    const all = await db.select().from(shipments).where(eq(shipments.requestId, r.id));
    await stops.completeShipments(biz, r.id, all.map((s, i) => ({ id: s.id, recipientName: `Customer ${i}`, recipientPhone: `05551234${i}0`, address: `${i} King Fahd Rd, Riyadh` })));
    expect(await remindIncompleteParcels(at(5))).toBe(0); expect(await count()).toBe(2); // nothing left to remind about
  });

  it("works through the HTTP API: zod no longer demands details when booking by count, and the bulk route is wired", async () => {
    const { biz } = await setup(); const t = await tok(biz);
    const body = { ...reqInput({ shipments: null }), startsAt: reqInput().startsAt.toISOString() };
    delete (body as Record<string, unknown>).shipments;
    const strict = await call("POST", "/requests", { token: t, body: { ...body, shipments: [{ recipientType: "consumer" }] } });
    expect(strict.status).toBe(422); expect(strict.json.error.details).toMatchObject({ "shipments.0.recipientName": expect.any(String) });
    const made = await call("POST", "/requests", { token: t, body: { ...body, shipments: [], shipmentCount: 3, detailsLater: true, publish: true, termsAccepted: true } });
    expect(made.status).toBe(201); expect(made.json.status).toBe("published");
    const list = await call("GET", `/requests/${made.json.id}/shipments`, { token: t });
    expect(list.json.total).toBe(3); expect(list.json.items.every((s: { detailsComplete: boolean }) => s.detailsComplete === false)).toBe(true);
    const detail = await call("GET", `/requests/${made.json.id}`, { token: t });
    expect(detail.json.incompleteParcels).toBe(3);
    const bulk = await call("PATCH", `/requests/${made.json.id}/shipments`, { token: t, body: { rows: list.json.items.map((s: { id: string }, i: number) => ({ id: s.id, recipientName: `Cust ${i}`, recipientPhone: `05551234${i}0`, address: `${i} Olaya St, Riyadh` })) } });
    expect(bulk.status).toBe(200); expect(bulk.json).toEqual({ updated: 3, completed: 3, stillIncomplete: 0 });
    expect((await call("GET", `/requests/${made.json.id}`, { token: t })).json.incompleteParcels).toBe(0);
    const bad = await call("PATCH", `/requests/${made.json.id}/shipments`, { token: t, body: { rows: [{ seq: 1, recipientPhone: "12" }] } });
    expect(bad.status).toBe(422); expect(bad.json.error.details.row).toBe(1);
    const one = await call("PATCH", `/shipments/${list.json.items[0].id}`, { token: t, body: { notes: "Gate 2" } });
    expect(one.status).toBe(200); expect(one.json.notes).toBe("Gate 2");
    expect((await call("PATCH", `/requests/${made.json.id}/shipments`, { token: await tok(await mkBusiness()), body: { rows: [{ seq: 1, notes: "x" }] } })).status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("demo parcels", () => {
  it("80 fully detailed, unique, deterministic parcels for every delivery city — each one passes the strict manifest validation", async () => {
    for (const c of DEFAULT_CITIES.filter((x) => x.delivery)) {
      const items = demoShipments(c.key)!;
      expect(items).toHaveLength(80);
      expect(new Set(items.map((i) => i.ref)).size).toBe(80); expect(new Set(items.map((i) => i.recipientPhone)).size).toBe(80);
      expect(items.filter((i) => i.recipientType === "business")).toHaveLength(20);
      const rows = await prepareManifest(items.map((i) => ({ recipientType: i.recipientType, recipientName: i.recipientName, recipientPhone: i.recipientPhone, address: i.address, city: i.city, lat: i.lat, lng: i.lng, contents: i.contents, notes: i.notes, externalRef: i.ref })), c.key);
      expect(rows.every((r) => r.detailsComplete)).toBe(true);
      // pins land inside the city (≤ 25 km from its centre) so route planning is meaningful
      for (const i of items) expect(Math.hypot((i.lat - c.lat) * 111, (i.lng - c.lng) * 100)).toBeLessThan(25);
      expect(JSON.stringify(demoShipments(c.key))).toBe(JSON.stringify(items)); // deterministic
    }
    expect(demoShipments("atlantis")).toBeNull();
  });

  it("an order can be created straight from the demo parcels", async () => {
    const { biz } = await setup();
    const shipmentsIn = demoShipments("riyadh")!.map((i) => ({ recipientType: i.recipientType, recipientName: i.recipientName, recipientPhone: i.recipientPhone, address: i.address, city: i.city, lat: i.lat, lng: i.lng, contents: i.contents, notes: i.notes, externalRef: i.ref }));
    const r = await publishedRequest(biz, { shipments: shipmentsIn, shipmentsPerDriver: 30 });
    expect(r.quantity).toBe(3); expect(r.shipmentsPerDriver).toBe(27); expect(r.totalCents).toBe(80 * 10_00);
  });

  it("is served only in demo mode, only to businesses", async () => {
    const { biz } = await setup(); const t = await tok(biz);
    const ok = await call("GET", "/business/demo-shipments?city=riyadh", { token: t });
    expect(ok.status).toBe(200); expect(ok.json.total).toBe(80); expect(ok.json.items[0]).toMatchObject({ n: 1, ref: "DEMO-001", recipientType: "consumer", city: "riyadh" });
    expect((await call("GET", "/business/demo-shipments", { token: t })).json.city).toBe("riyadh"); // default city
    expect((await call("GET", "/business/demo-shipments?city=atlantis", { token: t })).status).toBe(422);
    expect((await call("GET", "/business/demo-shipments", { token: await tok(await mkDriver()) })).status).toBe(403);
    expect((await call("GET", "/business/demo-shipments")).status).toBe(401);
    const prev = process.env.DEMO_MODE; process.env.DEMO_MODE = "false";
    try { expect((await call("GET", "/business/demo-shipments?city=riyadh", { token: t })).status).toBe(404); } finally { process.env.DEMO_MODE = prev; }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
type GeoFn = (address: string) => { lat: number; lng: number } | null | "error";
/** Replaces global fetch with a Google stand-in (Routes + Geocoding). Returns the call log. */
function installGoogle(o: { permute?: (n: number) => number[]; routesStatus?: number; geocode?: GeoFn } = {}) {
  const routes: Array<{ origin: { lat: number; lng: number }; mids: number; destination: { lat: number; lng: number } }> = []; const geocodes: string[] = [];
  const ll = (w: { location: { latLng: { latitude: number; longitude: number } } }) => ({ lat: w.location.latLng.latitude, lng: w.location.latLng.longitude });
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("computeRoutes")) {
      const b = JSON.parse(String(init?.body)); const n = (b.intermediates ?? []).length;
      routes.push({ origin: ll(b.origin), mids: n, destination: ll(b.destination) });
      if (o.routesStatus) return new Response("{}", { status: o.routesStatus });
      const idx = (o.permute ?? ((k: number) => Array.from({ length: k }, (_, i) => i)))(n);
      return new Response(JSON.stringify({ routes: [{ ...(n > 1 ? { optimizedIntermediateWaypointIndex: idx } : {}), legs: Array.from({ length: n + 1 }, (_, i) => ({ distanceMeters: 1200 + i * 10, duration: `${300 + i}s` })) }] }));
    }
    if (url.includes("geocode")) {
      const addr = new URL(url).searchParams.get("address") ?? ""; geocodes.push(addr);
      const g = o.geocode ? o.geocode(addr) : { lat: 24.7, lng: 46.7 };
      if (g === "error") return new Response("{}", { status: 500 });
      return new Response(JSON.stringify(g ? { status: "OK", results: [{ geometry: { location: g, location_type: "ROOFTOP" } }] } : { status: "ZERO_RESULTS", results: [] }));
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return { routes, geocodes };
}
const reverse = (n: number) => Array.from({ length: n }, (_, i) => n - 1 - i);
/** Parcels with map pins scattered over Riyadh. */
const pinned = (n: number) => mkShipments(n, { withRefs: true }).map((s, i) => ({ ...s, lat: 24.6 + ((i * 37) % 100) / 500, lng: 46.55 + ((i * 53) % 100) / 400 }));

async function atHandOver(n: number, o: { shipments?: ReturnType<typeof pinned>; perDriver?: number } = {}) {
  const { biz } = await setup(); const d = await mkDriver();
  const r = await publishedRequest(biz, { shipments: o.shipments ?? pinned(n), shipmentsPerDriver: o.perDriver ?? n, pickupAddress: "Warehouse 4, Industrial Area" });
  const off = await offerOf(r.id, d.id);
  await jobs.acceptOffer(d, off.id, true); await jobs.confirmAttendance(biz, off.id, true);
  return { biz, d, r, off };
}
const loaded = (offerId: string) => db.select().from(shipments).where(eq(shipments.offerId, offerId)).orderBy(asc(shipments.stopOrder));
const planOf = async (offerId: string) => (await db.select().from(offers).where(eq(offers.id, offerId)))[0].routePlan as { provider: string; stops: number; chunks: number; googleCalls: number; warnings: string[]; unlocated: number; origin: { source: string } | null; sig: string } | null;

describe("best route (Google Routes, chunked)", () => {
  beforeEach(() => { process.env.GOOGLE_MAPS_API_KEY = "test-key"; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.GOOGLE_MAPS_API_KEY; });

  it("hand-over plans the route automatically: 30 stops → 2 Google calls of 15, every stop ordered once with its driving leg", async () => {
    const g = installGoogle({ permute: reverse });
    const { biz, d, off } = await atHandOver(30);
    await jobs.recordLoading(biz, off.id, undefined, { all: true });
    const p = (await planOf(off.id))!;
    expect(p).toMatchObject({ provider: "google_routes", stops: 30, chunks: 2, googleCalls: 2, warnings: [], unlocated: 0 });
    expect(g.routes).toHaveLength(2); expect(g.routes.map((c) => c.mids + 1)).toEqual([15, 15]); // chunks of 15 stops: 14 optimised intermediates + the destination
    const rows = await loaded(off.id);
    expect(rows.map((s) => s.stopOrder)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(rows.every((s) => s.legDistanceM! > 0 && s.legDurationS! > 0)).toBe(true);
    expect(rows.map((s) => s.seq)).not.toEqual(Array.from({ length: 30 }, (_, i) => i + 1)); // Google's order replaced the manifest order
    const view = await driverJobView((await db.select().from(offers).where(eq(offers.id, off.id)))[0], (await db.select().from(requests).where(eq(requests.id, off.requestId)))[0]);
    expect(view.route).toMatchObject({ planned: true, provider: "google_routes", chunks: 2, canOptimize: false /* driver has not confirmed the loading yet */ });
    expect(view.route!.totalDistanceM).toBeGreaterThan(0);
    await jobs.acknowledgeLoading(d, off.id, true);
    const after = await driverJobView((await db.select().from(offers).where(eq(offers.id, off.id)))[0], (await db.select().from(requests).where(eq(requests.id, off.requestId)))[0]);
    expect(after.route!.canOptimize).toBe(true);
    expect(after.stops!.every((s) => s.located && s.legDurationS != null)).toBe(true);
    // the warehouse's pickup address was geocoded for the origin and remembered on the request
    expect((await planOf(off.id))!.origin).toMatchObject({ source: "pickup", lat: WAREHOUSE.lat });
    expect((await db.select().from(requests).where(eq(requests.id, off.requestId)))[0].pickupLat).toBe(WAREHOUSE.lat); // the order starts at the warehouse pin
  });

  it("80 parcels for one driver → 4 balanced calls; nothing exceeds Google's 25-waypoint limit; the driver then works every stop in the planned order", async () => {
    const g = installGoogle({ permute: reverse });
    const { biz, d, off } = await atHandOver(80, { perDriver: 80 });
    await jobs.recordLoading(biz, off.id, undefined, { all: true });
    expect(g.routes).toHaveLength(4);
    expect(Math.max(...g.routes.map((c) => c.mids))).toBeLessThanOrEqual(24);
    expect((await planOf(off.id))).toMatchObject({ provider: "google_routes", stops: 80, chunks: 4, googleCalls: 4 });
    await jobs.acknowledgeLoading(d, off.id, true); await stops.approveRoute(d, off.id);
    const planned = (await loaded(off.id)).map((s) => s.id);
    const worked: string[] = [];
    for (let s = await currentStopOf(db, off.id); s; s = await currentStopOf(db, off.id)) {
      worked.push(s.id);
      await stops.arriveAtStop(d, off.id, s.id); await stops.deliverStop(d, off.id, s.id, { code: s.code, otp: otpFor(s) });
    }
    expect(worked).toEqual(planned); // one stop at a time, exactly in the best-route order
    await jobs.reportDelivered(d, off.id);
    expect((await db.select().from(offers).where(eq(offers.id, off.id)))[0].deliveredUnits).toBe(80);
  });

  it("re-optimising is free when nothing changed, paid when the driver's position changes, and rate-limited", async () => {
    const g = installGoogle();
    const { biz, d, off } = await atHandOver(10);
    await jobs.recordLoading(biz, off.id, undefined, { all: true }); await jobs.acknowledgeLoading(d, off.id, true);
    const before = g.routes.length;
    const same = await planOfOfferAs(d, off.id);
    expect(same).toMatchObject({ cached: true, changed: false }); expect(g.routes.length).toBe(before); // same inputs → no paid call
    const moved = await planOfferRoute({ offerId: off.id, actor: d, origin: { lat: 24.9, lng: 46.9 } });
    expect(moved.cached).toBe(false); expect(g.routes.length).toBe(before + 1);
    expect((await planOf(off.id))).toMatchObject({ origin: { source: "driver" } });
    let blocked = 0; try { for (let i = 0; i < 14; i++) await planOfferRoute({ offerId: off.id, actor: d, force: true }); } catch (e) { blocked = (e as { status: number }).status; }
    expect(blocked).toBe(429);
  });

  it("only the job's driver can re-plan, and only once the parcels are handed over", async () => {
    installGoogle();
    const { biz, d, off } = await atHandOver(4);
    await expect(planOfferRoute({ offerId: off.id, actor: d })).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // nothing handed over yet
    await jobs.recordLoading(biz, off.id, undefined, { all: true });
    const stranger = await mkDriver();
    await expect(planOfferRoute({ offerId: off.id, actor: stranger })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const t = await tok(d);
    const api = await call("POST", `/offers/${off.id}/route/optimize`, { token: t, body: { lat: 24.8, lng: 46.7 } });
    expect(api.status).toBe(200); expect(api.json.job.route.planned).toBe(true); expect(api.json.cached).toBe(false);
    expect((await call("POST", `/offers/${off.id}/route/optimize`, { token: await tok(stranger), body: {} })).status).toBe(404);
    expect((await call("POST", `/offers/${off.id}/route/optimize`, { token: await tok(biz), body: {} })).status).toBe(403);
  });

  it("after the route is approved, the stop the driver is standing at stays first and only the rest are re-ordered", async () => {
    installGoogle({ permute: reverse });
    const { biz, d, off } = await atHandOver(8);
    await jobs.recordLoading(biz, off.id, undefined, { all: true }); await jobs.acknowledgeLoading(d, off.id, true); await stops.approveRoute(d, off.id);
    const first = (await currentStopOf(db, off.id))!;
    await stops.arriveAtStop(d, off.id, first.id);
    const beforeOrder = (await loaded(off.id)).map((s) => s.id);
    const out = await planOfferRoute({ offerId: off.id, actor: d, origin: { lat: 24.65, lng: 46.6 }, force: true });
    const afterOrder = (await loaded(off.id)).map((s) => s.id);
    expect(afterOrder[0]).toBe(first.id); expect((await currentStopOf(db, off.id))!.id).toBe(first.id);
    expect(out.changed).toBe(true); expect(afterOrder.slice(1)).not.toEqual(beforeOrder.slice(1));
    expect(new Set(afterOrder)).toEqual(new Set(beforeOrder));
    expect((await planOf(off.id))!.origin).toMatchObject({ source: "stop" }); // optimised from where the driver stands
    // what is left to drive excludes the leg into the stop the driver has already reached
    const [ob, rb] = [(await db.select().from(offers).where(eq(offers.id, off.id)))[0], (await db.select().from(requests).where(eq(requests.id, off.requestId)))[0]];
    const rv = (await driverJobView(ob, rb)).route!;
    const arrivedLeg = (await loaded(off.id)).find((x) => x.id === first.id)!.legDistanceM!;
    expect(rv.remainingDistanceM).toBe((await loaded(off.id)).filter((x) => x.id !== first.id).reduce((a, x) => a + (x.legDistanceM ?? 0), 0));
    expect(rv.totalDistanceM - rv.remainingDistanceM).toBeGreaterThanOrEqual(0); void arrivedLeg;
    // delivered stops are not touched or re-ordered
    await stops.deliverStop(d, off.id, first.id, { code: first.code, otp: otpFor(first) });
    const second = (await currentStopOf(db, off.id))!;
    const done = await planOfferRoute({ offerId: off.id, actor: d, force: true }); // no GPS fix → planned from where the last stop was
    expect((await planOf(off.id))!.origin).toMatchObject({ source: "stop", lat: first.lat, lng: first.lng });
    expect(done.currentId).toBeTruthy(); expect((await db.select().from(shipments).where(eq(shipments.id, first.id)))[0].status).toBe("delivered");
    expect(second.id).not.toBe(first.id);
  });

  it("stops typed without a map pin are geocoded and remembered; ones Google cannot find go last and are flagged", async () => {
    const g = installGoogle({ geocode: (a) => (a.startsWith("3 Olaya") ? null : { lat: 24.7 + (a.length % 7) / 100, lng: 46.7 + (a.length % 5) / 100 }) });
    const { biz, d, off } = await atHandOver(6, { shipments: mkShipments(6, { withRefs: true }) as ReturnType<typeof pinned> });
    await jobs.recordLoading(biz, off.id, undefined, { all: true });
    const rows = await loaded(off.id);
    const missing = rows.filter((s) => s.lat == null);
    expect(missing).toHaveLength(1); expect(missing[0].address).toContain("3 Olaya"); expect(missing[0].stopOrder).toBe(6); // last
    expect(rows.filter((s) => s.lat != null).every((s) => s.geoSource === "geocoded")).toBe(true);
    expect((await planOf(off.id))).toMatchObject({ unlocated: 1, warnings: ["ROUTE_UNLOCATED_STOPS:1"] });
    expect(g.geocodes.some((a) => a.endsWith(", Riyadh"))).toBe(true);
    await jobs.acknowledgeLoading(d, off.id, true);
    const v = await driverJobView((await db.select().from(offers).where(eq(offers.id, off.id)))[0], (await db.select().from(requests).where(eq(requests.id, off.requestId)))[0]);
    expect(v.stops!.filter((s) => !s.located)).toHaveLength(1);
    expect(v.route!.unlocated).toBe(1);
    // an address Google could not find is remembered as unresolved and not looked up again on every re-plan
    expect((await loaded(off.id)).filter((x) => x.geoSource === "unresolved")).toHaveLength(1);
    const asked = g.geocodes.length;
    await planOfferRoute({ offerId: off.id, actor: d, force: true });
    expect(g.geocodes.length).toBe(asked);
    // pins that were typed/imported are never overwritten
    const typed = pinned(3);
    const again = installGoogle();
    const t2 = await atHandOver(3, { shipments: typed });
    await jobs.recordLoading(t2.biz, t2.off.id, undefined, { all: true });
    expect(again.geocodes.filter((a) => !a.startsWith("Warehouse"))).toHaveLength(0);
    expect((await loaded(t2.off.id)).every((s) => s.geoSource === "given")).toBe(true);
  });

  it("without a Google key the hand-over still works and the plan is honestly labelled an estimate", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const g = installGoogle();
    const { biz, d, off } = await atHandOver(6);
    await jobs.recordLoading(biz, off.id, undefined, { all: true });
    expect(g.routes).toHaveLength(0);
    expect(await planOf(off.id)).toMatchObject({ provider: "local_heuristic", stops: 6 });
    expect((await planOf(off.id))!.warnings).toContain("ROUTING_PROVIDER_NOT_CONFIGURED");
    const rows = await loaded(off.id);
    expect(rows.every((s) => s.legDurationS! >= 0 && s.stopOrder != null)).toBe(true);
    await jobs.acknowledgeLoading(d, off.id, true);
    const v = await driverJobView((await db.select().from(offers).where(eq(offers.id, off.id)))[0], (await db.select().from(requests).where(eq(requests.id, off.requestId)))[0]);
    expect(v.route).toMatchObject({ provider: "local_heuristic", googleConfigured: false });
  });

  it("Google down → the local order with a warning; the hand-over is never blocked and the job completes", async () => {
    installGoogle({ routesStatus: 503 });
    const { biz, d, off } = await atHandOver(5);
    await jobs.recordLoading(biz, off.id, undefined, { all: true });
    const p = (await planOf(off.id))!;
    expect(p.provider).toBe("local_heuristic"); expect(p.warnings[0]).toMatch(/^ROUTING_PROVIDER_FAILED/); expect(p.stops).toBe(5);
    await jobs.acknowledgeLoading(d, off.id, true); await stops.approveRoute(d, off.id);
    for (let s = await currentStopOf(db, off.id); s; s = await currentStopOf(db, off.id)) { await stops.arriveAtStop(d, off.id, s.id); await stops.deliverStop(d, off.id, s.id, { code: s.code, otp: otpFor(s) }); }
    await jobs.reportDelivered(d, off.id);
    expect((await db.select().from(offers).where(eq(offers.id, off.id)))[0].status).toBe("completed");
  });

  it("re-recording the hand-over re-plans for exactly the parcels that went on board", async () => {
    installGoogle();
    const { biz, off, r } = await atHandOver(10);
    const all = await db.select().from(shipments).where(eq(shipments.requestId, r.id)).orderBy(asc(shipments.seq));
    await jobs.recordLoading(biz, off.id, undefined, { codes: all.slice(0, 6).map((s) => s.code) });
    expect(await planOf(off.id)).toMatchObject({ stops: 6 });
    expect((await loaded(off.id)).filter((s) => s.status === "loaded")).toHaveLength(6);
  });
});

async function planOfOfferAs(d: { id: string } & Record<string, unknown>, offerId: string) { return planOfferRoute({ offerId, actor: d as never }); }
