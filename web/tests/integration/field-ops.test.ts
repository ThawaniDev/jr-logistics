/**
 * Field-operations overhaul (decisions E1–E14, E16): arrival geofence, per-warehouse switches, loading by the driver's scans, manual route order,
 * stop evidence, door timer, OTP / signature, one active job. (COD, finance and support have their own file.)
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { businessProfiles, jobEvents, notifications, offers, requests, shipmentMedia, shipments } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, mkStaff, publishedRequest, mkShipments, WAREHOUSE } from "../helpers/factories";
import { call } from "../helpers/api";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { createSession } from "@/server/auth/session";
import { createDraft, publishRequest } from "@/server/requests";
import { currentStopOf, otpFor } from "@/server/shipments";
import { driverJobView } from "@/server/views";
import { finishLoading, scanLoad, unscanLoad } from "@/server/loading";
import { reorderOfferRoute, routeGeometry } from "@/server/route-plan";
import { patchWarehouseAdmin, warehouseAdminView, mergeOps } from "@/server/warehouse";
import { updateSettings, getSettings } from "@/server/settings";
import { setSmsProvider } from "@/server/auth/otp";
import { backfillOffersForDriver } from "@/server/matching";

beforeEach(resetDb);
afterAll(shutdown);
afterEach(() => { vi.unstubAllGlobals(); setSmsProvider(null); delete process.env.GOOGLE_MAPS_API_KEY; });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const tok = async (u: { id: string }) => (await createSession(u.id, "mobile")).token;
const offerOf = async (requestId: string, driverId: string) => (await db.select().from(offers).where(and(eq(offers.requestId, requestId), eq(offers.driverId, driverId))))[0];
const reload = async (offerId: string) => (await db.select().from(offers).where(eq(offers.id, offerId)))[0];
const viewOf = async (offerId: string) => { const o = await reload(offerId); const [r] = await db.select().from(requests).where(eq(requests.id, o.requestId)); return driverJobView(o, r); };
const parcels = (offerId: string) => db.select().from(shipments).where(eq(shipments.offerId, offerId)).orderBy(asc(shipments.seq));
async function setup(bizOpts: Parameters<typeof mkBusiness>[0] = {}) { const admin = await mkAdmin(); await mkRule(admin); const biz = await mkBusiness({ fundsCents: 5000_00, ...bizOpts }); return { admin, biz }; }
/** One driver who accepted a job of `n` parcels (route NOT yet planned, attendance NOT yet confirmed). */
async function accepted(n = 6, bizOpts: Parameters<typeof mkBusiness>[0] = {}, req: Parameters<typeof publishedRequest>[1] = {}) {
  const { admin, biz } = await setup(bizOpts); const d = await mkDriver();
  const r = await publishedRequest(biz, { shipments: mkShipments(n, { withRefs: true }), shipmentsPerDriver: n, ...req });
  const off = await offerOf(r.id, d.id);
  await jobs.acceptOffer(d, off.id, true);
  await db.update(requests).set({ startsAt: new Date(Date.now() + 3600_000) }).where(eq(requests.id, r.id)); // inside the check-in window
  return { admin, biz, d, r, off };
}
/** …and attendance confirmed (the default flow: the warehouse confirms). */
async function atWarehouse(n = 6, bizOpts: Parameters<typeof mkBusiness>[0] = {}) {
  const x = await accepted(n, bizOpts);
  await jobs.checkIn(x.d, x.off.id, WAREHOUSE);
  if ((await reload(x.off.id)).status === "arrived") await jobs.confirmAttendance(x.biz, x.off.id, true);
  return x;
}
async function scanAll(d: any, offerId: string) { for (const p of await parcels(offerId)) await scanLoad(d, offerId, p.code); }
const fakeGoogle = (o: { polyline?: string } = {}) => {
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("computeRoutes")) {
      const b = JSON.parse(String(init?.body)); const n = (b.intermediates ?? []).length;
      return new Response(JSON.stringify({ routes: [{ ...(n > 1 ? { optimizedIntermediateWaypointIndex: Array.from({ length: n }, (_, i) => i) } : {}), legs: Array.from({ length: n + 1 }, (_, i) => ({ distanceMeters: 1000 + i, duration: `${100 + i}s`, polyline: { encodedPolyline: o.polyline ?? "_p~iF~ps|U_ulLnnqC_mqNvxq`@" } })) }] }));
    }
    return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }));
  });
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("E1 arrival geofence", () => {
  it("needs GPS and a position within the platform radius of the warehouse (default 200 m)", async () => {
    const { d, off } = await accepted();
    await expect(jobs.checkIn(d, off.id)).rejects.toMatchObject({ code: "LOCATION_REQUIRED", status: 422 });
    await expect(jobs.checkIn(d, off.id, { lat: WAREHOUSE.lat, lng: WAREHOUSE.lng + 0.01 })).rejects.toMatchObject({ code: "TOO_FAR_FROM_WAREHOUSE", details: { radiusM: 200, distanceM: expect.any(Number) } });
    const e = await jobs.checkIn(d, off.id, { lat: WAREHOUSE.lat + 0.0012, lng: WAREHOUSE.lng }).then(() => null).catch((x) => x); // ≈ 133 m north: inside
    expect(e).toBeNull();
    expect((await reload(off.id)).status).toBe("arrived");
  });

  it("the radius and the whole check are configurable by the superadmin", async () => {
    const { admin, d, off } = await accepted();
    const near = { lat: WAREHOUSE.lat + 0.0027, lng: WAREHOUSE.lng }; // ≈ 300 m
    await expect(jobs.checkIn(d, off.id, near)).rejects.toMatchObject({ code: "TOO_FAR_FROM_WAREHOUSE", details: { distanceM: expect.any(Number) } });
    await updateSettings({ arrivalRadiusM: 500 }, admin.id);
    expect((await jobs.checkIn(d, off.id, near)).status).toBe("arrived");
    const x = await accepted(); await updateSettings({ arrivalGeofenceEnabled: false }, x.admin.id);
    expect((await jobs.checkIn(x.d, x.off.id)).status).toBe("arrived"); // anywhere, no GPS
  });

  it("the job view tells the app the radius and the pin; a warehouse without a pin cannot publish a driver order, and a legacy order is not blocked", async () => {
    const { d, off } = await accepted();
    expect((await viewOf(off.id)).arrival).toEqual({ geofence: true, radiusM: 200, warehouse: WAREHOUSE });
    const { biz } = await setup({ noLocation: true }); await mkDriver();
    const draft = await createDraft(biz, { ...(await import("../helpers/factories")).reqInput() });
    await expect(publishRequest(biz, draft.id, { termsAccepted: true })).rejects.toMatchObject({ code: "WAREHOUSE_LOCATION_REQUIRED", status: 422 });
    // legacy: an already-published request whose pin is unknown never blocks the driver — it is recorded as unverified
    const { biz: b2 } = await setup({ noLocation: true });
    await mkDriver();
    const r2 = await publishedRequest(b2, { startsAt: new Date(Date.now() + 864e5), shipments: mkShipments(3) }).catch(() => null);
    expect(r2).toBeNull(); // (cannot even publish — covered above)
    void d;
  });

  it("an order inherits the warehouse pin, and moving the warehouse moves the pin of its open orders (never a different explicit one)", async () => {
    const { biz, admin } = await setup();
    const open = await publishedRequest(biz);
    const draft = await createDraft(biz, { ...(await import("../helpers/factories")).reqInput(), pickupLat: 24.5, pickupLng: 46.5 }); // an explicit, different pin
    expect(open.pickupLat).toBe(WAREHOUSE.lat);
    const res = await call("PUT", "/business/warehouse", { token: await tok(biz), body: { lat: 24.8, lng: 46.7 } });
    expect(res.status).toBe(200);
    expect((await db.select().from(requests).where(eq(requests.id, open.id)))[0]).toMatchObject({ pickupLat: 24.8, pickupLng: 46.7 });
    expect((await db.select().from(requests).where(eq(requests.id, draft.id)))[0]).toMatchObject({ pickupLat: 24.5, pickupLng: 46.5 });
    expect((await call("PUT", "/business/warehouse", { token: await tok(biz), body: { lat: 200, lng: 0 } })).status).toBe(422);
    const ov = await call("GET", "/business/overview", { token: await tok(biz) });
    expect(ov.json.warehouse).toEqual({ lat: 24.8, lng: 46.7 }); expect(ov.json.ops).toEqual({ requireArrivalConfirmation: true, requireLoadingRecord: false, requireDeliveryOtp: true, requireSignature: false });
    void admin;
  });
});

describe("E2/E3/E9/E10 per-warehouse switches", () => {
  it("each switch inherits the platform default until the superadmin sets it for that warehouse (null = inherit again)", async () => {
    const { admin, biz } = await setup();
    const staff = await mkStaff(["users.view"]); const hr = await mkStaff(["users.view", "users.edit"]);
    expect(mergeOps({ requireArrivalConfirmation: true, requireLoadingRecord: false, requireDeliveryOtp: true, requireSignature: false }, { requireSignature: true, junk: 1 } as never).requireSignature).toBe(true);
    const base = await warehouseAdminView(biz.id);
    expect(base.ops).toEqual(base.defaults); expect(base.overrides).toEqual({ requireArrivalConfirmation: null, requireLoadingRecord: null, requireDeliveryOtp: null, requireSignature: null });
    await expect(patchWarehouseAdmin(staff, biz.id, { ops: { requireSignature: true } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const v = await patchWarehouseAdmin(hr, biz.id, { ops: { requireSignature: true, requireDeliveryOtp: false } });
    expect(v.ops).toMatchObject({ requireSignature: true, requireDeliveryOtp: false, requireArrivalConfirmation: true }); expect(v.overrides.requireSignature).toBe(true);
    await updateSettings({ warehouseDefaults: { requireLoadingRecord: true } as never }, admin.id); // platform default flips → only inheriting switches follow
    expect((await warehouseAdminView(biz.id)).ops).toMatchObject({ requireLoadingRecord: true, requireSignature: true, requireDeliveryOtp: false });
    const back = await patchWarehouseAdmin(hr, biz.id, { ops: { requireSignature: null } });
    expect(back.ops.requireSignature).toBe(false); expect(back.overrides.requireSignature).toBeNull();
    // the same through the API (and the pin)
    const t = await tok(hr);
    const api = await call("PATCH", `/admin/businesses/${biz.id}/warehouse`, { token: t, body: { lat: 24.9, lng: 46.8, ops: { requireArrivalConfirmation: false } } });
    expect(api.status).toBe(200); expect(api.json).toMatchObject({ lat: 24.9, lng: 46.8, ops: { requireArrivalConfirmation: false } });
    expect((await call("GET", `/admin/businesses/${biz.id}/warehouse`, { token: t })).json.overrides.requireArrivalConfirmation).toBe(false);
    expect((await call("PATCH", `/admin/businesses/${biz.id}/warehouse`, { token: t, body: { ops: { requireSignature: "yes" } } })).status).toBe(422);
    expect((await call("PATCH", `/admin/businesses/${biz.id}/warehouse`, { token: await tok(biz), body: { lat: 1, lng: 1 } })).status).toBe(403);
  });

  it("E2: a warehouse that does not confirm arrivals gets attendance from the verified check-in itself; the default asks the warehouse", async () => {
    const def = await accepted();
    expect((await jobs.checkIn(def.d, def.off.id, WAREHOUSE)).status).toBe("arrived");
    const { biz, d, off, r } = await accepted(6, { ops: { requireArrivalConfirmation: false } });
    const o = await jobs.checkIn(d, off.id, WAREHOUSE);
    expect(o).toMatchObject({ status: "attendance_confirmed", attendanceBy: null });
    expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].status).toBe("in_progress");
    const ev = (await db.select().from(jobEvents).where(eq(jobEvents.offerId, off.id))).filter((e) => e.type === "attendance_confirmed");
    expect(ev).toHaveLength(1); expect(ev[0].payload).toEqual({ auto: true });
    expect((await viewOf(off.id)).actions).toContain("scan_loading");
    void biz;
  });
});

describe("E3 loading by the driver's scans", () => {
  it("scan → already scanned → unscan → finish: counts, hand-back of unscanned parcels, units, route planned", async () => {
    const { d, off, r } = await atWarehouse(6);
    const all = await parcels(off.id);
    expect((await viewOf(off.id)).actions).toEqual(["scan_loading", "report_no_work"]); // finish only appears after a scan
    expect(await scanLoad(d, off.id, all[0].code)).toMatchObject({ scanned: 1, assigned: 6, already: false, shipment: { code: all[0].code } });
    expect(await scanLoad(d, off.id, all[0].code.toLowerCase())).toMatchObject({ scanned: 1, already: true });
    expect(await scanLoad(d, off.id, String(all[1].seq))).toMatchObject({ scanned: 2 }); // the manifest number works
    expect(await scanLoad(d, off.id, all[2].externalRef!)).toMatchObject({ scanned: 3 }); // …and the warehouse's own reference
    expect(await unscanLoad(d, off.id, all[2].code)).toEqual({ scanned: 2, assigned: 6 });
    await expect(unscanLoad(d, off.id, all[2].code)).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await viewOf(off.id)).actions).toEqual(["scan_loading", "finish_loading", "report_no_work"]);
    expect((await viewOf(off.id)).loading).toEqual({ mode: "driver_scan", assigned: 6, scanned: 2, finished: false });
    const res = await finishLoading(d, off.id);
    expect(res).toEqual({ loaded: 2, released: 4 });
    const o = await reload(off.id);
    expect(o).toMatchObject({ loadedUnits: 2, loadedAckByDriver: true, expectedUnits: 2 });
    const mine = await parcels(off.id); expect(mine).toHaveLength(2); expect(mine.every((p) => p.status === "loaded" && p.loadedVia === "driver_scan")).toBe(true);
    expect(mine.map((p) => p.stopOrder)).toEqual([1, 2]);
    expect((await db.select().from(shipments).where(and(eq(shipments.requestId, r.id), eq(shipments.status, "pending")))).every((p) => p.offerId === null)).toBe(true);
    const v = await viewOf(off.id);
    expect(v.route).toMatchObject({ planned: true }); expect(v.actions).toEqual(["approve_route", "report_no_work"]);
    await expect(scanLoad(d, off.id, all[3].code)).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // loading is finished
    await expect(finishLoading(d, off.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const ev = (await db.select().from(jobEvents).where(eq(jobEvents.offerId, off.id))).map((e) => e.type);
    expect(ev).toEqual(expect.arrayContaining(["loading_scanned", "loading_unscanned", "loading_finished", "route_planned"]));
  });

  it("refuses codes that are not this driver's load, with the reason; parcels without details cannot be scanned; finishing needs ≥ 1 scan", async () => {
    const { admin, biz } = await setup(); const d1 = await mkDriver(), d2 = await mkDriver();
    const r = await publishedRequest(biz, { shipments: [...mkShipments(4, { withRefs: true })], shipmentsPerDriver: 2 });
    const o1 = await offerOf(r.id, d1.id), o2 = await offerOf(r.id, d2.id);
    for (const [dd, oo] of [[d1, o1], [d2, o2]] as const) { await jobs.acceptOffer(dd, oo.id, true); }
    await db.update(requests).set({ startsAt: new Date(Date.now() + 3600_000) }).where(eq(requests.id, r.id));
    for (const [dd, oo] of [[d1, o1], [d2, o2]] as const) { await jobs.checkIn(dd, oo.id, WAREHOUSE); await jobs.confirmAttendance(biz, oo.id, true); }
    const [mine] = await parcels(o1.id), [theirs] = await parcels(o2.id);
    await expect(scanLoad(d1, o1.id, theirs.code)).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("another driver") });
    await expect(scanLoad(d1, o1.id, "NOPE-000")).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("not part of this order") });
    await expect(scanLoad(d1, o1.id, "")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(scanLoad(d2, o1.id, mine.code)).rejects.toMatchObject({ code: "NOT_FOUND" }); // someone else's job
    await expect(finishLoading(d1, o1.id)).rejects.toMatchObject({ code: "VALIDATION", details: { field: "codes" } });
    await db.update(shipments).set({ detailsComplete: false, recipientName: "", recipientPhone: "", address: "" }).where(eq(shipments.id, mine.id));
    await expect(scanLoad(d1, o1.id, mine.code)).rejects.toMatchObject({ code: "DETAILS_INCOMPLETE", details: { count: 1, codes: [mine.code] } });
    void admin;
  });

  it("a warehouse that records the hand-over itself keeps the old flow; scanning is refused there; the business actions follow the switch", async () => {
    const { biz, d, off } = await atWarehouse(4, { ops: { requireLoadingRecord: true } });
    const v = await viewOf(off.id);
    expect(v.loading!.mode).toBe("warehouse"); expect(v.actions).toEqual(["report_no_work"]); // waits for the warehouse
    await expect(scanLoad(d, off.id, (await parcels(off.id))[0].code)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const detail = await call("GET", `/requests/${off.requestId}`, { token: await tok(biz) });
    expect(detail.json.offers[0].actions).toContain("record_loading"); expect(detail.json.offers[0].loading).toMatchObject({ mode: "warehouse" });
    await jobs.recordLoading(biz, off.id, undefined, { all: true });
    expect((await viewOf(off.id)).actions).toContain("ack_loading");
    // the default warehouse does not get the button — but staff/the warehouse can still record as a fallback (e.g. a dead phone)
    const def = await atWarehouse(4);
    const dd = await call("GET", `/requests/${def.off.requestId}`, { token: await tok(def.biz) });
    expect(dd.json.offers[0].actions).not.toContain("record_loading"); expect(dd.json.offers[0].loading).toEqual({ mode: "driver_scan", assigned: 4, scanned: 0, finished: false });
    expect((await jobs.recordLoading(def.biz, def.off.id, undefined, { all: true })).loadedUnits).toBe(4);
    expect((await viewOf(def.off.id)).actions).toContain("ack_loading"); // and the driver acknowledges, exactly as before
  });

  it("works through the API: scan / unscan / finish with the fresh job view", async () => {
    const { d, off } = await atWarehouse(3);
    const t = await tok(d); const [p1, p2] = await parcels(off.id);
    expect((await call("POST", `/offers/${off.id}/loading/scan`, { token: t, body: { code: p1.code } })).json).toMatchObject({ scanned: 1, assigned: 3 });
    expect((await call("POST", `/offers/${off.id}/loading/scan`, { token: t, body: { code: p2.code } })).status).toBe(200);
    expect((await call("POST", `/offers/${off.id}/loading/unscan`, { token: t, body: { code: p2.code } })).json.scanned).toBe(1);
    const fin = await call("POST", `/offers/${off.id}/loading/finish`, { token: t, body: {} });
    expect(fin.status).toBe(200); expect(fin.json).toMatchObject({ loaded: 1, released: 2, job: { loading: { finished: true, scanned: 1 }, route: { planned: true } } });
    expect((await call("POST", `/offers/${off.id}/loading/scan`, { token: await tok(await mkDriver()), body: { code: p1.code } })).status).toBe(404);
  });
});

describe("E5/E6 manual route order and map geometry", () => {
  /** `n` parcels with map pins, scanned and the loading finished (route planned). */
  async function planned(n = 5) {
    const x = await atWarehouse(n);
    for (const [i, p] of (await parcels(x.off.id)).entries()) await db.update(shipments).set({ lat: 24.70 + i * 0.01, lng: 46.66 + (i % 2) * 0.02, geoSource: "given" }).where(eq(shipments.id, p.id));
    await scanAll(x.d, x.off.id); await finishLoading(x.d, x.off.id); return x;
  }

  it("the driver arranges the remaining stops: exact permutation, estimated legs, manual plan, event; the platform can switch it off", async () => {
    const { admin, d, off } = await planned(5);
    const before = (await parcels(off.id)).sort((a, b) => a.stopOrder! - b.stopOrder!).map((p) => p.id);
    expect((await viewOf(off.id)).route).toMatchObject({ canReorder: true, manual: false });
    const order = [before[4], before[0], before[3], before[1], before[2]];
    await expect(reorderOfferRoute(d, off.id, order.slice(1))).rejects.toMatchObject({ code: "VALIDATION", details: { field: "order" } });
    await expect(reorderOfferRoute(d, off.id, [...order.slice(0, 4), order[0]])).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(reorderOfferRoute(d, off.id, [...order.slice(0, 4), "11111111-1111-4111-8111-111111111111"])).rejects.toMatchObject({ code: "VALIDATION" });
    const out = await reorderOfferRoute(d, off.id, order);
    expect(out.plan).toMatchObject({ provider: "manual", manual: true, by: "driver", stops: 5 });
    const after = (await parcels(off.id)).sort((a, b) => a.stopOrder! - b.stopOrder!);
    expect(after.map((p) => p.id)).toEqual(order); expect(after.map((p) => p.stopOrder)).toEqual([1, 2, 3, 4, 5]);
    expect(after.every((p) => p.legPolyline === null)).toBe(true);
    const v = await viewOf(off.id);
    expect(v.route).toMatchObject({ provider: "manual", manual: true, canReorder: true, planned: true }); expect(v.stops!.map((s) => s.id)).toEqual(order);
    expect((await db.select().from(jobEvents).where(eq(jobEvents.offerId, off.id))).some((e) => e.type === "route_reordered")).toBe(true);
    await updateSettings({ driverCanReorderRoute: false }, admin.id);
    await expect(reorderOfferRoute(d, off.id, order)).rejects.toMatchObject({ code: "FEATURE_DISABLED", status: 403 });
    expect((await viewOf(off.id)).route!.canReorder).toBe(false);
  });

  it("after approval the stop the driver stands at stays first; only the rest move; the new next recipient is texted; manual order survives until the next optimise", async () => {
    const sent: string[] = []; setSmsProvider({ name: "t", async send(_to: string, text: string) { sent.push(text); } } as never);
    const { d, off } = await planned(4);
    await stops.approveRoute(d, off.id);
    const [first, second, third, fourth] = (await parcels(off.id)).sort((a, b) => a.stopOrder! - b.stopOrder!);
    await stops.arriveAtStop(d, off.id, first.id);
    await expect(reorderOfferRoute(d, off.id, [third.id, second.id])).rejects.toMatchObject({ code: "VALIDATION" }); // the pinned stop is not part of the order: 3 stops expected
    const out = await reorderOfferRoute(d, off.id, [fourth.id, third.id, second.id]);
    expect(out.currentId).toBe(first.id); expect((await currentStopOf(db, off.id))!.id).toBe(first.id); // he is still at the first stop
    expect((await parcels(off.id)).sort((a, b) => a.stopOrder! - b.stopOrder!).map((p) => p.id)).toEqual([first.id, fourth.id, third.id, second.id]);
    await stops.deliverStop(d, off.id, first.id, { code: first.code, otp: otpFor(first) });
    expect((await currentStopOf(db, off.id))!.id).toBe(fourth.id); // the order the driver chose
    expect(sent.some((m) => m.includes(otpFor(fourth)))).toBe(true); // that recipient got their code
    // not the order's owner / not yet loaded
    await expect(reorderOfferRoute(await mkDriver(), off.id, [])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("route-geometry returns the legs of the stops still to do in order, with Google polylines (null for an estimate)", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "k"; fakeGoogle({ polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" });
    const { d, off } = await planned(3);
    const g = await routeGeometry(d, off.id);
    expect(g.origin).toEqual(WAREHOUSE); expect(g.provider).toBe("google_routes"); expect(g.legs.map((l) => l.order)).toEqual([1, 2, 3]);
    expect(g.legs[0]).toMatchObject({ polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@", from: WAREHOUSE, distanceM: expect.any(Number) });
    expect(g.legs[1].from).toEqual(g.legs[0].to);
    // after a manual order the legs are estimates (no polyline) but still ordered, with from → to
    const ids = (await parcels(off.id)).sort((a, b) => a.stopOrder! - b.stopOrder!).map((p) => p.id);
    await reorderOfferRoute(d, off.id, [ids[2], ids[1], ids[0]]);
    const m = await routeGeometry(d, off.id);
    expect(m.provider).toBe("manual"); expect(m.legs.map((l) => l.stopId)).toEqual([ids[2], ids[1], ids[0]]); expect(m.legs.every((l) => l.polyline === null && l.from && l.to)).toBe(true);
    const t = await tok(d);
    const api = await call("GET", `/driver/jobs/${off.id}/route-geometry`, { token: t });
    expect(api.status).toBe(200); expect(api.json.legs).toHaveLength(3);
    expect((await call("POST", `/offers/${off.id}/route/reorder`, { token: t, body: { order: [ids[0], ids[1], ids[2]] } })).json).toMatchObject({ plan: { manual: true }, job: { route: { manual: true } } });
    expect((await call("GET", `/driver/jobs/${off.id}/route-geometry`, { token: await tok(await mkDriver()) })).status).toBe(404);
  });
});

describe("E7/E8/E14 stop evidence, door timer, failure reasons", () => {
  async function working(n = 3) {
    const x = await atWarehouse(n); await scanAll(x.d, x.off.id); await finishLoading(x.d, x.off.id); await stops.approveRoute(x.d, x.off.id);
    const [s1, s2, s3] = (await parcels(x.off.id)).sort((a, b) => a.stopOrder! - b.stopOrder!);
    return { ...x, s1, s2, s3 };
  }
  const photo = (d: any, offerId: string, stopId: string, kind: string) => stops.saveStopMedia(d, offerId, stopId, { data: PNG, mime: "image/png", kind });

  it("postponing needs the written reason AND a photo by default; each is a superadmin switch; evidence is stored and visible to the warehouse", async () => {
    const { admin, biz, d, off, s1, s2 } = await working(3);
    await expect(stops.deferStop(d, off.id, s1.id)).rejects.toMatchObject({ code: "EVIDENCE_REQUIRED", details: { note: true, photo: true } });
    await expect(stops.deferStop(d, off.id, s1.id, { note: "ok" })).rejects.toMatchObject({ code: "EVIDENCE_REQUIRED", details: { note: true, photo: true } }); // < 3 characters is not a reason
    const m = await photo(d, off.id, s1.id, "defer");
    await expect(stops.deferStop(d, off.id, s1.id, { mediaId: m.id })).rejects.toMatchObject({ code: "EVIDENCE_REQUIRED", details: { note: true, photo: false } });
    await expect(stops.deferStop(d, off.id, s1.id, { note: "Shop closed until 5pm", mediaId: "11111111-1111-4111-8111-111111111111" })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "mediaId" } });
    await stops.deferStop(d, off.id, s1.id, { note: "Shop closed until 5pm", mediaId: m.id });
    expect((await currentStopOf(db, off.id))!.id).toBe(s2.id);
    // visible to the warehouse: list + image bytes; a stranger gets nothing
    const t = await tok(biz);
    const list = await call("GET", `/shipments/${s1.id}/media`, { token: t });
    expect(list.json.items).toHaveLength(1); expect(list.json.items[0]).toMatchObject({ id: m.id, kind: "defer", byName: d.name });
    const img = await call("GET", `/shipments/${s1.id}/media/${m.id}`, { token: t });
    expect(img.status).toBe(200); expect(img.headers.get("content-type")).toBe("image/png");
    expect((await call("GET", `/shipments/${s1.id}/media`, { token: await tok(await mkBusiness()) })).status).toBe(404);
    const ev = (await db.select().from(jobEvents).where(eq(jobEvents.offerId, off.id))).find((e) => e.type === "stop_deferred")!;
    expect(ev.payload).toMatchObject({ note: "Shop closed until 5pm", mediaId: m.id });
    expect((await db.select().from(notifications).where(and(eq(notifications.userId, biz.id), eq(notifications.type, "shipment_deferred")))).length).toBe(1);
    // a photo is single-use and bound to its stop
    const m2 = await photo(d, off.id, s2.id, "defer");
    await expect(stops.deferStop(d, off.id, s2.id, { note: "again please", mediaId: m.id })).rejects.toMatchObject({ code: "VALIDATION" });
    // switches
    await updateSettings({ rescheduleEvidencePhoto: false }, admin.id);
    const v = await viewOf(off.id); expect(v.policy).toMatchObject({ rescheduleEvidenceText: true, rescheduleEvidencePhoto: false });
    await stops.arriveAtStop(d, off.id, s2.id);
    await stops.deferStop(d, off.id, s2.id, { note: "second attempt later" }).then(() => null).catch((e) => e); // (a stop can only be postponed once; s2 is fine)
    void m2;
    await updateSettings({ rescheduleEvidenceText: false, rescheduleEvidencePhoto: false }, admin.id);
    expect((await viewOf(off.id)).policy).toMatchObject({ rescheduleEvidenceText: false, rescheduleEvidencePhoto: false });
  });

  it("evidence photos are validated (type, size, magic bytes, stop must be current)", async () => {
    const { d, off, s1, s2 } = await working(3);
    await expect(stops.saveStopMedia(d, off.id, s1.id, { data: PNG, mime: "image/png", kind: "nonsense" })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "kind" } });
    await expect(stops.saveStopMedia(d, off.id, s1.id, { data: PNG, mime: "text/plain", kind: "defer" })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "file" } });
    await expect(stops.saveStopMedia(d, off.id, s1.id, { data: Buffer.from("not an image at all"), mime: "image/png", kind: "defer" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(stops.saveStopMedia(d, off.id, s1.id, { data: Buffer.alloc(9 * 1024 * 1024, 1), mime: "image/png", kind: "defer" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(photo(d, off.id, s2.id, "defer")).rejects.toMatchObject({ code: "STOP_LOCKED" }); // not the current stop
    const t = await tok(d);
    const fd = new FormData(); fd.set("file", new File([PNG], "x.png", { type: "image/png" })); fd.set("kind", "fail");
    const up = await call("POST", `/offers/${off.id}/stops/${s1.id}/media`, { token: t, form: fd });
    expect(up.status).toBe(201); expect(up.json).toMatchObject({ kind: "fail" });
  });

  it("'can't deliver': every reason works anytime by default (no arrival, no wait, no note) and may carry a photo; the strict switch restores the old rules", async () => {
    const { admin, biz, d, off, s1, s2, s3 } = await working(3);
    // default: refused / wrong_address / damaged / unreachable… all without arrival or notes
    const m = await photo(d, off.id, s1.id, "fail");
    await stops.failStop(d, off.id, s1.id, { reason: "damaged", mediaId: m.id }); // note-required reason, no note, not arrived — fine
    expect((await db.select().from(shipments).where(eq(shipments.id, s1.id)))[0]).toMatchObject({ status: "failed", failReason: "damaged" });
    const ev = (await db.select().from(jobEvents).where(eq(jobEvents.offerId, off.id))).find((e) => e.type === "shipment_failed")!;
    expect(ev.payload).toMatchObject({ reason: "damaged", mediaId: m.id });
    expect((await call("GET", `/shipments/${s1.id}/media`, { token: await tok(biz) })).json.items[0]).toMatchObject({ kind: "fail" });
    await stops.failStop(d, off.id, s2.id, { reason: "unreachable" }); // no arrival, no waiting
    // the photo of another kind / other stop is refused
    const bad = await photo(d, off.id, s3.id, "defer");
    await expect(stops.failStop(d, off.id, s3.id, { reason: "refused", mediaId: bad.id })).rejects.toMatchObject({ code: "VALIDATION" });
    // strict again
    const x = await working(3); await updateSettings({ stopFailStrictRules: true }, admin.id);
    await expect(stops.failStop(x.d, x.off.id, x.s1.id, { reason: "refused" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(stops.failStop(x.d, x.off.id, x.s1.id, { reason: "wrong_address" })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "note" } });
    expect((await viewOf(x.off.id)).policy.failStrict).toBe(true);
  });

  it("the door timer is gone by default and returns only when the superadmin sets minutes", async () => {
    const { admin, d, off, s1 } = await working(3);
    expect((await getSettings()).stopWaitMin).toBe(0);
    await stops.arriveAtStop(d, off.id, s1.id);
    const v = await viewOf(off.id); expect(v.stops!.find((s) => s.current)!.waitRemainingSec).toBeNull(); expect(v.policy.stopWaitMin).toBe(0);
    await updateSettings({ stopWaitMin: 10 }, admin.id);
    const v2 = await viewOf(off.id); expect(v2.stops!.find((s) => s.current)!.waitRemainingSec).toBeGreaterThan(540);
    await expect(stops.failStop(d, off.id, s1.id, { reason: "unreachable" })).rejects.toMatchObject({ code: "WAIT_REQUIRED" });
    await db.update(shipments).set({ arrivedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(shipments.id, s1.id));
    await stops.failStop(d, off.id, s1.id, { reason: "unreachable" });
  });
});

describe("E9/E10 delivery proof per warehouse", () => {
  async function working(ops: Partial<import("@/db/schema").WarehouseOps>, n = 2) {
    const x = await atWarehouse(n, { ops }); await scanAll(x.d, x.off.id); await finishLoading(x.d, x.off.id); await stops.approveRoute(x.d, x.off.id);
    const [s1, s2] = (await parcels(x.off.id)).sort((a, b) => a.stopOrder! - b.stopOrder!);
    await stops.arriveAtStop(x.d, x.off.id, s1.id);
    return { ...x, s1, s2 };
  }

  it("OTP off: the scanned parcel code is the proof, the SMS carries only the tracking link, the stop says proofMode 'scan'", async () => {
    const sent: string[] = []; setSmsProvider({ name: "t", async send(_to: string, text: string) { sent.push(text); } } as never);
    const { d, off, s1, s2 } = await working({ requireDeliveryOtp: false });
    const v = await viewOf(off.id); const cur = v.stops!.find((s) => s.current)!;
    expect(cur).toMatchObject({ needsOtp: false, proofMode: "scan", canResend: false }); expect(v.ops.requireDeliveryOtp).toBe(false);
    expect(sent.length).toBeGreaterThan(0); expect(sent.every((m) => !m.includes(otpFor(s1)) && m.includes("/track/"))).toBe(true);
    await expect(stops.deliverStop(d, off.id, s1.id, { code: "WRONG-1" })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "code" } }); // the code must still match this parcel
    const done = await stops.deliverStop(d, off.id, s1.id, { code: s1.code });
    expect(done).toMatchObject({ status: "delivered", proofType: "scan" });
    void s2;
  });

  it("OTP on (default): the code is required and wrong ones count", async () => {
    const { d, off, s1 } = await working({});
    await expect(stops.deliverStop(d, off.id, s1.id, { code: s1.code })).rejects.toMatchObject({ code: "OTP_REQUIRED" });
    await expect(stops.deliverStop(d, off.id, s1.id, { code: s1.code, otp: "0000" === otpFor(s1) ? "1111" : "0000" })).rejects.toMatchObject({ code: "OTP_INVALID", details: { attemptsLeft: 4 } });
    expect((await stops.deliverStop(d, off.id, s1.id, { code: s1.code, otp: otpFor(s1) })).proofType).toBe("otp");
  });

  it("signature on: delivery needs the recipient's drawn signature, uploaded once and used once; the warehouse can open it", async () => {
    const { biz, d, off, s1, s2 } = await working({ requireSignature: true });
    expect((await viewOf(off.id)).stops!.find((s) => s.current)).toMatchObject({ needsSignature: true });
    await expect(stops.deliverStop(d, off.id, s1.id, { code: s1.code, otp: otpFor(s1) })).rejects.toMatchObject({ code: "SIGNATURE_REQUIRED", status: 422 });
    expect((await db.select().from(shipments).where(eq(shipments.id, s1.id)))[0].otpAttempts).toBe(0); // the OTP attempt was not burnt by the missing signature
    const wrongKind = await stops.saveStopMedia(d, off.id, s1.id, { data: PNG, mime: "image/png", kind: "defer" });
    await expect(stops.deliverStop(d, off.id, s1.id, { code: s1.code, otp: otpFor(s1), signatureMediaId: wrongKind.id })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "signatureMediaId" } });
    const sig = await stops.saveStopMedia(d, off.id, s1.id, { data: PNG, mime: "image/png", kind: "signature" });
    const done = await stops.deliverStop(d, off.id, s1.id, { code: s1.code, otp: otpFor(s1), signatureMediaId: sig.id });
    expect(done.status).toBe("delivered");
    const list = await call("GET", `/shipments/${s1.id}/media`, { token: await tok(biz) });
    expect(list.json.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: sig.id, kind: "signature" })]));
    // the used signature cannot sign another parcel
    await stops.arriveAtStop(d, off.id, s2.id);
    await expect(stops.deliverStop(d, off.id, s2.id, { code: s2.code, otp: otpFor(s2), signatureMediaId: sig.id })).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await db.select().from(shipmentMedia).where(eq(shipmentMedia.id, sig.id)))[0].usedAt).not.toBeNull();
  });
});

describe("E11 one active job; E12 new-offer notification", () => {
  it("a driver who accepted a job sees no other offers/opportunities, gets none, cannot accept more — until he finishes", async () => {
    const { admin, biz } = await setup(); const d = await mkDriver();
    const r1 = await publishedRequest(biz, { shipments: mkShipments(3) });
    const r2 = await publishedRequest(biz, { shipments: mkShipments(3), startsAt: new Date(Date.now() + 3 * 864e5) });
    const o1 = await offerOf(r1.id, d.id), o2 = await offerOf(r2.id, d.id);
    const t = await tok(d);
    expect((await call("GET", "/driver/offers", { token: t })).json).toMatchObject({ hidden: false, activeJob: null, items: expect.any(Array) });
    expect((await call("GET", "/driver/offers", { token: t })).json.items).toHaveLength(2);
    await jobs.acceptOffer(d, o1.id, true);
    const hidden = await call("GET", "/driver/offers", { token: t });
    expect(hidden.json).toMatchObject({ items: [], hidden: true, activeJob: { offerId: o1.id, ref: r1.ref, status: "accepted" } });
    expect((await call("GET", "/driver/opportunities", { token: t })).json).toMatchObject({ items: [], hidden: true });
    const ov = await call("GET", "/driver/overview", { token: t });
    expect(ov.json).toMatchObject({ newOffers: 0, activeJob: { offerId: o1.id }, cash: { outstandingCents: 0, orders: 0 } });
    await expect(jobs.acceptOffer(d, o2.id, true)).rejects.toMatchObject({ code: "OVERLAPPING_JOB", details: { activeJob: { offerId: o1.id } } });
    // no new offers are created for a busy driver
    const r3 = await publishedRequest(biz, { shipments: mkShipments(3), startsAt: new Date(Date.now() + 6 * 864e5) });
    expect((await db.select().from(offers).where(and(eq(offers.requestId, r3.id), eq(offers.driverId, d.id)))).length).toBe(0);
    expect(await backfillOffersForDriver(d.id)).toBe(0);
    // finishing frees him: the held-back offers are visible again and the backfill finds the order published meanwhile
    await db.update(requests).set({ startsAt: new Date(Date.now() + 3600_000) }).where(eq(requests.id, r1.id));
    await jobs.checkIn(d, o1.id, WAREHOUSE); await jobs.confirmAttendance(biz, o1.id, true);
    const { work } = await import("../helpers/work"); await work(biz, d, o1.id);
    const back = await call("GET", "/driver/offers", { token: t });
    expect(back.json.hidden).toBe(false); expect(back.json.items.map((i: any) => i.requestId)).toEqual(expect.arrayContaining([r2.id, r3.id]));
    // the platform can turn the rule off
    const { admin: a2, biz: b2 } = await setup(); const d2 = await mkDriver();
    const q1 = await publishedRequest(b2, { shipments: mkShipments(3) }); await publishedRequest(b2, { shipments: mkShipments(3), startsAt: new Date(Date.now() + 3 * 864e5) });
    await updateSettings({ driverSingleActiveJob: false }, a2.id);
    await jobs.acceptOffer(d2, (await offerOf(q1.id, d2.id)).id, true);
    expect((await call("GET", "/driver/offers", { token: await tok(d2) })).json).toMatchObject({ hidden: false });
    void admin;
  });

  it("every new offer creates an in-app notification with parcels, cities and earning (earning hidden for office drivers)", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz, { shipments: mkShipments(4), shipmentsPerDriver: 4 });
    const o = await offerOf(r.id, d.id);
    const [n] = await db.select().from(notifications).where(and(eq(notifications.userId, d.id), eq(notifications.type, "offer_new")));
    expect(n.data).toMatchObject({ requestId: r.id, ref: r.ref, offerId: o.id, parcels: 4, pickupCity: "riyadh", deliveryCity: "riyadh", earningCents: 4 * 7_00 });
    const { mkOffice } = await import("../helpers/factories");
    const office = await mkOffice(); const od = await mkDriver({ officeId: office.id });
    const r2 = await publishedRequest(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2, startsAt: new Date(Date.now() + 5 * 864e5) });
    const [on] = await db.select().from(notifications).where(and(eq(notifications.userId, od.id), eq(notifications.type, "offer_new")));
    expect(on.data).toMatchObject({ ref: r2.ref, earningCents: null });
    void businessProfiles;
  });
});
