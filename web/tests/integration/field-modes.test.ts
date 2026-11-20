/**
 * Platform update J2 / J3 — the two super-admin switches `routingEnabled` and `b2bShipmentsEnabled` (both default OFF), enforced on the server.
 *
 *  - settings plumbing: defaults, `GET /catalog` policy, `PATCH /admin/settings` (validated, audited, permissioned), the driver job view's `policy`;
 *  - routing OFF: no Google call, no approve-route step (the route starts by itself), no STOP_LOCKED, no reorder / optimise / geometry, name + phone of every open
 *    stop, WhatsApp for any own stop, recipient codes texted at the right moments; a job that was mid-flow when the switch flipped just works;
 *  - routing ON: exactly as before (a few control checks; the rest of the suite — which enables the switch in its setup — covers the detail);
 *  - B2B OFF: `422 B2B_DISABLED` on every entry point, coercion for the public API / re-ship / demo parcels, existing business parcels keep working end to end;
 *  - analytics that group by recipient type keep working with no business parcels (and with old ones).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, jobEvents, offers, requests, shipments } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkStaff, mkBusiness, mkDriver, mkRule, publishedRequest, mkShipments, reqInput } from "../helpers/factories";
import { setFieldModes } from "../helpers/field-modes";
import { call } from "../helpers/api";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { createSession } from "@/server/auth/session";
import { createDraft, updateDraft } from "@/server/requests";
import { otpFor, prepareManifest } from "@/server/shipments";
import { driverJobView } from "@/server/views";
import { finishLoading, scanLoad } from "@/server/loading";
import { planOfferRoute, reorderOfferRoute, routeGeometry, autoPlanRoute } from "@/server/route-plan";
import { getSettings, updateSettings } from "@/server/settings";
import { setSmsProvider } from "@/server/auth/otp";
import { createApiKey } from "@/server/integrations";
import type { User } from "@/db/schema";

beforeEach(resetDb); // empty database ⇒ the platform defaults: routing OFF, B2B OFF
afterAll(shutdown);
afterEach(() => { vi.unstubAllGlobals(); setSmsProvider(null); delete process.env.GOOGLE_MAPS_API_KEY; });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const tok = async (u: { id: string }) => (await createSession(u.id, "mobile")).token;
const offerOf = async (requestId: string, driverId: string) => (await db.select().from(offers).where(and(eq(offers.requestId, requestId), eq(offers.driverId, driverId))))[0];
const reload = async (offerId: string) => (await db.select().from(offers).where(eq(offers.id, offerId)))[0];
const viewOf = async (offerId: string) => { const o = await reload(offerId); const [r] = await db.select().from(requests).where(eq(requests.id, o.requestId)); return driverJobView(o, r); };
const parcels = async (offerId: string) => (await db.select().from(shipments).where(eq(shipments.offerId, offerId)).orderBy(asc(shipments.seq)));
const byOrder = async (offerId: string) => (await parcels(offerId)).sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0));
const events = async (requestId: string, type: string) => db.select().from(jobEvents).where(and(eq(jobEvents.requestId, requestId), eq(jobEvents.type, type))).orderBy(asc(jobEvents.createdAt));
const googleCalls: string[] = [];
/** Any call to Google (Routes / Geocoding) is recorded; the answers are empty, so nothing is ever located. */
const installGoogle = () => {
  googleCalls.length = 0; process.env.GOOGLE_MAPS_API_KEY = "test-key";
  vi.stubGlobal("fetch", async (input: unknown) => { googleCalls.push(String(input)); return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [], routes: [] })); });
};
const evidenceOff = (admin: User) => updateSettings({ rescheduleEvidenceText: false, rescheduleEvidencePhoto: false }, admin.id);

async function setup(bizOpts: Parameters<typeof mkBusiness>[0] = {}) { const admin = await mkAdmin(); await mkRule(admin); const biz = await mkBusiness({ fundsCents: 5000_00, ...bizOpts }); return { admin, biz }; }
/** One driver, accepted and attendance-confirmed, ready to load `n` parcels. */
async function ready(n = 4, o: { biz?: Parameters<typeof mkBusiness>[0]; req?: Parameters<typeof publishedRequest>[1] } = {}) {
  const { admin, biz } = await setup(o.biz); const d = await mkDriver();
  const r = await publishedRequest(biz, { shipments: mkShipments(n, { withRefs: true }), shipmentsPerDriver: n, ...o.req });
  const off = await offerOf(r.id, d.id);
  await jobs.acceptOffer(d, off.id, true); await jobs.confirmAttendance(biz, off.id, true);
  return { admin, biz, d, r, off };
}
const scanAll = async (d: User, offerId: string) => { for (const p of await parcels(offerId)) await scanLoad(d, offerId, p.code); };
/** Loading by the driver's own scans (the default flow). */
async function loadByScan(d: User, offerId: string) { await scanAll(d, offerId); return finishLoading(d, offerId); }
const deliver = (d: User, offerId: string, s: { id: string; code: string }) => stops.deliverStop(d, offerId, s.id, { code: s.code, otp: otpFor(s as never) });

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("settings plumbing", () => {
  it("both switches are OFF on a fresh platform; GET /catalog and the driver job view expose them (reorder is effectively off while routing is off)", async () => {
    expect(await getSettings()).toMatchObject({ routingEnabled: false, b2bShipmentsEnabled: false, driverCanReorderRoute: true });
    const cat = (await call("GET", "/catalog")).json;
    expect(cat.policy).toMatchObject({ routingEnabled: false, b2bShipmentsEnabled: false, driverCanReorderRoute: false });
    const { d, off } = await ready(3);
    expect((await viewOf(off.id)).policy).toMatchObject({ routingEnabled: false, b2bShipmentsEnabled: false, canReorderRoute: false });
    await setFieldModes({ routing: true, b2b: true });
    expect((await call("GET", "/catalog")).json.policy).toMatchObject({ routingEnabled: true, b2bShipmentsEnabled: true, driverCanReorderRoute: true });
    expect((await viewOf(off.id)).policy).toMatchObject({ routingEnabled: true, b2bShipmentsEnabled: true, canReorderRoute: true });
    void d;
  });

  it("PATCH /admin/settings: booleans only, needs settings.edit, audited old → new; the job view follows the new value at once", async () => {
    const admin = await mkAdmin(); const t = await tok(admin);
    const got = await call("PATCH", "/admin/settings", { token: t, body: { routingEnabled: true, b2bShipmentsEnabled: true } });
    expect(got.status).toBe(200); expect(got.json).toMatchObject({ routingEnabled: true, b2bShipmentsEnabled: true });
    expect((await call("GET", "/admin/settings", { token: t })).json).toMatchObject({ routingEnabled: true, b2bShipmentsEnabled: true });
    expect((await call("PATCH", "/admin/settings", { token: t, body: { routingEnabled: "yes" } })).status).toBe(422);
    expect((await call("PATCH", "/admin/settings", { token: t, body: { b2bShipmentsEnabled: 1 } })).status).toBe(422);
    expect((await call("PATCH", "/admin/settings", { token: t, body: { routingEnabled: false } })).json.routingEnabled).toBe(false);
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "settings.update")).orderBy(desc(auditLogs.createdAt));
    expect(rows[0].diff).toMatchObject({ routingEnabled: { from: true, to: false } });
    expect(rows.some((r) => JSON.stringify(r.diff).includes("b2bShipmentsEnabled"))).toBe(true);
    const viewer = await mkStaff(["settings.view"]); const noEdit = await call("PATCH", "/admin/settings", { token: await tok(viewer), body: { routingEnabled: true } });
    expect(noEdit.status).toBe(403);
    expect((await getSettings()).routingEnabled).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("routing OFF — the driver works his stops without a route", () => {
  it("finishing the scan-loading starts the route by itself: no Google call, no plan, no approve step, route = null in the job view", async () => {
    installGoogle();
    const { d, r, off } = await ready(4);
    expect((await viewOf(off.id)).actions).toContain("scan_loading");
    await loadByScan(d, off.id);
    const o = await reload(off.id);
    expect(googleCalls).toEqual([]); // not a single request to Google
    expect(o.routePlan).toBeNull(); expect(o.routeApprovedAt).toBeInstanceOf(Date);
    const v = await viewOf(off.id);
    expect(v.route).toBeNull(); expect(v.routeApprovedAt).toBeTruthy();
    expect(v.actions).toEqual(["work_stops", "end_route"]); expect(v.actions).not.toContain("approve_route");
    expect(v.stops!.every((s) => s.legDurationS == null)).toBe(true);
    const ev = await events(r.id, "route_approved");
    expect(ev).toHaveLength(1); expect(ev[0].payload).toMatchObject({ auto: true, stops: 4 });
  });

  it("warehouse hand-over mode: recording the hand-over plans nothing; the driver's acknowledgement starts the route; a disputed count does not", async () => {
    installGoogle();
    const { biz, d, r, off } = await ready(3, { biz: { ops: { requireLoadingRecord: true } } });
    await jobs.recordLoading(biz, off.id, undefined, { all: true });
    expect(googleCalls).toEqual([]); expect((await reload(off.id)).routePlan).toBeNull();
    expect((await viewOf(off.id)).actions).toEqual(["ack_loading", "dispute_loading", "report_no_work"]);
    await jobs.acknowledgeLoading(d, off.id, true);
    const v = await viewOf(off.id);
    expect(v.routeApprovedAt).toBeTruthy(); expect(v.actions).toEqual(["work_stops", "end_route"]);
    expect(await events(r.id, "route_approved")).toHaveLength(1);
    // a dispute never starts a route
    const x = await ready(2, { biz: { ops: { requireLoadingRecord: true } } });
    await jobs.recordLoading(x.biz, x.off.id, undefined, { all: true }); await jobs.acknowledgeLoading(x.d, x.off.id, false, "count is different");
    expect((await reload(x.off.id)).routeApprovedAt).toBeNull(); expect((await viewOf(x.off.id)).actions).toEqual(["report_no_work"]);
    expect(googleCalls).toEqual([]);
  });

  it("every planning entry point is closed: optimise / reorder / route-geometry → 409 ROUTING_DISABLED (HTTP and direct), the auto-planner is a silent no-op", async () => {
    installGoogle();
    const { d, off } = await ready(4); await loadByScan(d, off.id);
    const t = await tok(d); const ids = (await byOrder(off.id)).map((s) => s.id);
    for (const [method, path, body] of [["POST", `/offers/${off.id}/route/optimize`, {}], ["POST", `/offers/${off.id}/route/reorder`, { order: ids }], ["GET", `/driver/jobs/${off.id}/route-geometry`, undefined]] as const) {
      const res = await call(method, path, { token: t, body });
      expect(res.status, path).toBe(409); expect(res.json.error.code).toBe("ROUTING_DISABLED");
    }
    await expect(planOfferRoute({ offerId: off.id, actor: d })).rejects.toMatchObject({ code: "ROUTING_DISABLED", status: 409 });
    await expect(planOfferRoute({ offerId: off.id, actor: d, force: true })).rejects.toMatchObject({ code: "ROUTING_DISABLED" });
    await expect(reorderOfferRoute(d, off.id, ids)).rejects.toMatchObject({ code: "ROUTING_DISABLED" });
    await expect(routeGeometry(d, off.id)).rejects.toMatchObject({ code: "ROUTING_DISABLED" });
    await expect(autoPlanRoute(off.id)).resolves.toBeUndefined();
    expect(googleCalls).toEqual([]); expect((await reload(off.id)).routePlan).toBeNull();
    expect((await byOrder(off.id)).map((s) => s.id)).toEqual(ids); // order untouched
  });

  it("the approve-route call is a harmless idempotent no-op (old clients mid-flow keep working) and never moves the route", async () => {
    const { d, off } = await ready(3); await loadByScan(d, off.id);
    const t = await tok(d); const first = (await reload(off.id)).routeApprovedAt!;
    const a = await call("POST", `/offers/${off.id}/route/approve`, { token: t });
    expect(a.status).toBe(200); expect(new Date(a.json.routeApprovedAt).getTime()).toBe(first.getTime());
    expect((await call("POST", `/offers/${off.id}/route/approve`, { token: t })).status).toBe(200);
    // not before loading is confirmed
    const x = await ready(2);
    await expect(stops.approveRoute(x.d, x.off.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("no one-stop-at-a-time lock: arrive / deliver / fail in ANY order; 'current' is the first unresolved stop; replays stay idempotent", async () => {
    const { d, off } = await ready(5); await loadByScan(d, off.id);
    const [s1, s2, s3, s4, s5] = await byOrder(off.id);
    expect((await viewOf(off.id)).stops!.find((s) => s.current)!.id).toBe(s1.id);
    await stops.arriveAtStop(d, off.id, s4.id);
    expect(await deliver(d, off.id, s4)).toMatchObject({ status: "delivered" }); // the 4th first
    await stops.arriveAtStop(d, off.id, s2.id);
    await expect(stops.deliverStop(d, off.id, s3.id, { code: s3.code, otp: otpFor(s3) })).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // arrival is still required (not STOP_LOCKED)
    expect(await stops.failStop(d, off.id, s5.id, { reason: "refused" })).toMatchObject({ status: "failed" }); // …a failure needs no arrival
    expect(await deliver(d, off.id, s2)).toMatchObject({ status: "delivered" });
    // replays of resolved stops are answered, not rejected; a different action is still refused
    expect(await deliver(d, off.id, s4)).toMatchObject({ status: "delivered" });
    expect(await stops.failStop(d, off.id, s5.id, { reason: "refused" })).toMatchObject({ status: "failed" });
    await expect(stops.failStop(d, off.id, s4.id, { reason: "refused" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    // the first unresolved stop (in manifest order) is still the "current" one
    const v = await viewOf(off.id);
    expect(v.stops!.find((s) => s.current)!.id).toBe(s1.id); expect(v.stopsSummary).toMatchObject({ loaded: 2, delivered: 2, failed: 1 });
    // finish the rest, in reverse
    await stops.arriveAtStop(d, off.id, s3.id); await deliver(d, off.id, s3);
    await stops.arriveAtStop(d, off.id, s1.id); await deliver(d, off.id, s1);
    expect((await viewOf(off.id)).actions).toEqual(["report_delivered"]);
    expect((await jobs.reportDelivered(d, off.id)).status).toBe("completed");
  });

  it("postponing works for any open stop (it goes to the end), still once per stop and never for the last one", async () => {
    const { admin, d, off } = await ready(3); await evidenceOff(admin); await loadByScan(d, off.id);
    const [s1, s2, s3] = await byOrder(off.id);
    await stops.arriveAtStop(d, off.id, s2.id);
    expect((await viewOf(off.id)).stops!.find((s) => s.id === s2.id)).toMatchObject({ canDefer: true, current: false });
    const moved = await stops.deferStop(d, off.id, s2.id);
    expect(moved.deferCount).toBe(1); expect(moved.stopOrder).toBeGreaterThan(s3.stopOrder!); expect(moved.arrivedAt).toBeNull();
    await expect(stops.deferStop(d, off.id, s2.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // once
    await stops.arriveAtStop(d, off.id, s3.id); await deliver(d, off.id, s3);
    await stops.arriveAtStop(d, off.id, s1.id); await deliver(d, off.id, s1);
    await expect(stops.deferStop(d, off.id, s2.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // the last stop
  });

  it("the driver sees name AND phone of every open stop of his own job (resolved ones: name only); the new stop fields are there", async () => {
    const { biz, d, off } = await ready(3, { req: { shipments: mkShipments(3).map((s, i) => ({ ...s, codCents: i === 1 ? 4500 : 0 })) } });
    expect((await viewOf(off.id)).stops!.every((s) => s.recipientName != null)).toBe(true); // already while scanning: his own parcels
    await loadByScan(d, off.id);
    const [s1, s2, s3] = await byOrder(off.id);
    let v = await viewOf(off.id);
    for (const s of v.stops!) { expect(s.recipientName, s.code).toMatch(/^Customer \d$/); expect(s.recipientPhone, s.code).toMatch(/^\+9665/); }
    expect(v.stops!.map((s) => [s.paymentMode, s.codCents])).toEqual([["prepaid", 0], ["cod", 4500], ["prepaid", 0]]);
    expect(v.stops!.every((s) => s.pieces === 1 && !Number.isNaN(new Date(s.createdAt).getTime()))).toBe(true);
    await stops.arriveAtStop(d, off.id, s3.id); await deliver(d, off.id, s3);
    v = await viewOf(off.id);
    expect(v.stops!.find((s) => s.id === s3.id)).toMatchObject({ status: "delivered", recipientName: s3.recipientName, recipientPhone: null });
    expect(v.stops!.find((s) => s.id === s1.id)!.recipientPhone).toBe(s1.recipientPhone);
    // another driver's job never leaks: his job view is empty of this driver's stops
    const other = await mkDriver(); expect((await call("GET", `/driver/jobs/${off.id}`, { token: await tok(other) })).status).toBe(404);
    void biz; void s2;
  });

  it("WhatsApp works for any stop of his own active job; another job's parcel, a stranger and a finished job are refused; with routing ON only the current stop is allowed", async () => {
    const { d, off, r } = await ready(3); await loadByScan(d, off.id);
    const [s1, s2, s3] = await byOrder(off.id); const t = await tok(d);
    for (const s of [s3, s1, s2]) {
      const res = await call("GET", `/driver/jobs/${off.id}/whatsapp?kind=arriving&lang=en&shipmentId=${s.id}`, { token: t });
      expect(res.status, s.code).toBe(200); expect(res.json.url).toContain(`wa.me/${s.recipientPhone.replace(/\D/g, "")}`); expect(res.json.text).toContain(s.code);
    }
    expect((await call("GET", `/driver/jobs/${off.id}/whatsapp?shipmentId=00000000-0000-4000-8000-000000000000`, { token: t })).status).toBe(404);
    // a parcel of ANOTHER driver's job is not reachable
    const { biz } = await setup(); const d2 = await mkDriver();
    const r2 = await publishedRequest(biz, { shipments: mkShipments(2, { withRefs: true }).map((s, i) => ({ ...s, recipientPhone: `0566${String(i).padStart(6, "1")}` })), shipmentsPerDriver: 2 });
    const off2 = await offerOf(r2.id, d2.id); await jobs.acceptOffer(d2, off2.id, true); await jobs.confirmAttendance(biz, off2.id, true); await loadByScan(d2, off2.id);
    const foreign = (await parcels(off2.id))[0];
    expect((await call("GET", `/driver/jobs/${off.id}/whatsapp?shipmentId=${foreign.id}`, { token: t })).status).toBe(404);
    expect((await call("GET", `/driver/jobs/${off.id}/whatsapp?shipmentId=${s1.id}`, { token: await tok(d2) })).status).toBe(404); // not his job
    // routing ON: only the current stop
    await setFieldModes({ routing: true });
    expect((await call("GET", `/driver/jobs/${off.id}/whatsapp?shipmentId=${s1.id}`, { token: t })).status).toBe(200);
    const locked = await call("GET", `/driver/jobs/${off.id}/whatsapp?shipmentId=${s3.id}`, { token: t });
    expect(locked.status).toBe(409); expect(locked.json.error.code).toBe("STOP_LOCKED");
    void r;
  });

  it("recipient codes: the first stop is texted when the route starts, the next one when a stop is resolved, any other stop when the driver arrives (never twice)", async () => {
    const sent: string[] = []; setSmsProvider({ name: "t", async send(_to: string, text: string) { sent.push(text); } } as never);
    const { d, off } = await ready(4);
    await loadByScan(d, off.id);
    const [s1, s2, s3, s4] = await byOrder(off.id);
    const has = (s: typeof s1) => sent.some((m) => m.includes(otpFor(s)));
    expect(has(s1)).toBe(true); expect(has(s3)).toBe(false); expect(has(s4)).toBe(false);
    await stops.arriveAtStop(d, off.id, s4.id); // out of order: this recipient has not been texted yet — now they are
    expect(has(s4)).toBe(true);
    const n = sent.length;
    await stops.arriveAtStop(d, off.id, s4.id); // idempotent tap: no second SMS
    expect(sent.length).toBe(n);
    await deliver(d, off.id, s4);
    await stops.arriveAtStop(d, off.id, s1.id); await deliver(d, off.id, s1);
    expect(has(s2)).toBe(true); // s1 resolved → the next unresolved (s2) is texted as before
    expect(has(s3)).toBe(false);
  });

  it("a job that was mid-flow when routing was switched OFF works without approval: stop actions start the route, report / end-route are allowed", async () => {
    await setFieldModes({ routing: true });
    const { d, off, r } = await ready(4); await loadByScan(d, off.id); // routing ON: planned, NOT approved
    expect((await reload(off.id)).routeApprovedAt).toBeNull(); expect((await viewOf(off.id)).actions).toEqual(["approve_route", "report_no_work"]);
    const [s1, , s3] = await byOrder(off.id);
    await expect(stops.arriveAtStop(d, off.id, s3.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await setFieldModes({ routing: false });
    const v = await viewOf(off.id);
    expect(v.actions).toEqual(["work_stops", "end_route"]); expect(v.route).toBeNull();
    expect(v.stops!.find((s) => s.id === s1.id)).toMatchObject({ current: true, recipientPhone: s1.recipientPhone }); // usable before the first action
    await stops.arriveAtStop(d, off.id, s3.id); // the first stop action starts the route
    expect((await reload(off.id)).routeApprovedAt).toBeInstanceOf(Date);
    expect(await events(r.id, "route_approved")).toHaveLength(1);
    await deliver(d, off.id, s3);
    // …and ending the route early works for such a job too
    const y = await ready(3); await setFieldModes({ routing: true }); await loadByScan(y.d, y.off.id); await setFieldModes({ routing: false });
    expect((await reload(y.off.id)).routeApprovedAt).toBeNull();
    const done = await stops.endRoute(y.d, y.off.id, "breakdown");
    expect(done.offer.status).toBe("completed");
  });

  it("a job approved while routing was ON keeps working when it is switched OFF; switching ON again re-applies the lock (nothing is stuck)", async () => {
    await setFieldModes({ routing: true });
    const { d, off } = await ready(3); await loadByScan(d, off.id); await stops.approveRoute(d, off.id);
    const [s1, s2] = await byOrder(off.id);
    await setFieldModes({ routing: false });
    await stops.arriveAtStop(d, off.id, s2.id); await deliver(d, off.id, s2); // out of order, fine now
    await setFieldModes({ routing: true });
    await expect(stops.arriveAtStop(d, off.id, (await byOrder(off.id)).filter((s) => s.status === "loaded").at(-1)!.id)).rejects.toMatchObject({ code: "STOP_LOCKED", details: { currentId: s1.id } });
    await stops.arriveAtStop(d, off.id, s1.id); await deliver(d, off.id, s1);
  });

  it("everything else on the stop is unchanged: parcel code must match, OTP is checked, cash must match, arrival is required to deliver", async () => {
    const { d, off } = await ready(3, { req: { shipments: mkShipments(3).map((s) => ({ ...s, codCents: 2500 })) } }); await loadByScan(d, off.id);
    const [s1, s2] = await byOrder(off.id);
    await expect(stops.deliverStop(d, off.id, s2.id, { code: s2.code, otp: otpFor(s2), cashCollectedCents: 2500 })).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // not arrived
    await stops.arriveAtStop(d, off.id, s2.id);
    await expect(stops.deliverStop(d, off.id, s2.id, { code: s1.code, otp: otpFor(s2), cashCollectedCents: 2500 })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "code" } });
    await expect(stops.deliverStop(d, off.id, s2.id, { code: s2.code, otp: otpFor(s2), cashCollectedCents: 100 })).rejects.toMatchObject({ code: "CASH_MISMATCH", details: { expectedCents: 2500 } });
    await expect(stops.deliverStop(d, off.id, s2.id, { code: s2.code, otp: "0000".replace(/0/g, otpFor(s2) === "0000" ? "1" : "0"), cashCollectedCents: 2500 })).rejects.toMatchObject({ code: "OTP_INVALID" });
    expect(await stops.deliverStop(d, off.id, s2.id, { code: s2.code, otp: otpFor(s2), cashCollectedCents: 2500 })).toMatchObject({ status: "delivered", codCollectedCents: 2500 });
  });

  it("business, office and report views keep working: the offer carries routeApprovedAt, the request detail lists it, the office job view too", async () => {
    const { biz, d, r, off } = await ready(3); await loadByScan(d, off.id);
    const detail = await call("GET", `/requests/${r.id}`, { token: await tok(biz) });
    expect(detail.status).toBe(200);
    const o = detail.json.offers.find((x: { id: string }) => x.id === off.id);
    expect(o.routeApprovedAt).toBeTruthy(); expect(o.parcels).toMatchObject({ total: 3, loaded: 3 }); expect(o.actions).not.toContain("record_loading");
    const [s1] = await byOrder(off.id); await stops.arriveAtStop(d, off.id, s1.id); await deliver(d, off.id, s1);
    expect((await call("GET", `/requests/${r.id}/shipments`, { token: await tok(biz) })).json.counts).toMatchObject({ delivered: 1, loaded: 2 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("routing ON — behaviour is exactly as before", () => {
  beforeEach(() => setFieldModes({ routing: true }));

  it("hand-over plans the route (Google is called), the driver must approve, the stops are locked to one at a time, name/phone only for the current stop", async () => {
    installGoogle();
    const { d, off } = await ready(4); await loadByScan(d, off.id);
    expect(googleCalls.length).toBeGreaterThan(0);
    let v = await viewOf(off.id);
    expect(v.route).toMatchObject({ planned: true }); expect(v.routeApprovedAt).toBeNull(); expect(v.actions).toEqual(["approve_route", "report_no_work"]);
    expect(v.policy).toMatchObject({ routingEnabled: true, canReorderRoute: true });
    await expect(stops.arriveAtStop(d, off.id, v.stops![0].id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // approve first
    await stops.approveRoute(d, off.id);
    await expect(stops.approveRoute(d, off.id)).rejects.toMatchObject({ code: "CONFLICT" }); // routing on: a second approval is still refused
    v = await viewOf(off.id);
    const [s1, , s3] = await byOrder(off.id);
    expect(v.actions).toEqual(["work_stops", "end_route"]);
    expect(v.stops!.filter((s) => s.recipientName != null).map((s) => s.id)).toEqual([s1.id]); // only the current stop shows the name…
    expect(v.stops!.filter((s) => s.recipientPhone != null).map((s) => s.id)).toEqual([s1.id]); // …and the phone
    await expect(stops.arriveAtStop(d, off.id, s3.id)).rejects.toMatchObject({ code: "STOP_LOCKED", status: 409, details: { currentId: s1.id } });
    expect(v.stops!.find((s) => s.id === s1.id)).toMatchObject({ paymentMode: "prepaid", pieces: 1 }); // the new fields are present in both modes
  });

  it("optimise, reorder and route-geometry answer as before; a stranger still gets 404 and the business 403", async () => {
    installGoogle();
    const { biz, d, off } = await ready(4); await loadByScan(d, off.id);
    const t = await tok(d); const ids = (await byOrder(off.id)).map((s) => s.id);
    expect((await call("POST", `/offers/${off.id}/route/optimize`, { token: t, body: { lat: 24.8, lng: 46.7 } })).status).toBe(200);
    const re = await call("POST", `/offers/${off.id}/route/reorder`, { token: t, body: { order: [...ids].reverse() } });
    expect(re.status).toBe(200); expect(re.json.job.route).toMatchObject({ manual: true, provider: "manual" });
    expect((await call("GET", `/driver/jobs/${off.id}/route-geometry`, { token: t })).status).toBe(200);
    const stranger = await mkDriver();
    expect((await call("POST", `/offers/${off.id}/route/optimize`, { token: await tok(stranger), body: {} })).status).toBe(404);
    expect((await call("POST", `/offers/${off.id}/route/optimize`, { token: await tok(biz), body: {} })).status).toBe(403);
    // the old per-setting switch still works on top of routing: reorder off → FEATURE_DISABLED
    const admin = await mkAdmin(); await updateSettings({ driverCanReorderRoute: false }, admin.id);
    expect((await viewOf(off.id)).policy.canReorderRoute).toBe(false);
    await expect(reorderOfferRoute(d, off.id, ids)).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("B2B OFF — business recipients are refused on every entry point", () => {
  const withBusiness = (n = 3) => mkShipments(n).map((s, i) => (i === 1 ? { ...s, recipientType: "business" as const } : s));

  it("request manifests: create (service layer and POST /requests) and edit a draft → 422 B2B_DISABLED with the row; consumer-only manifests are untouched", async () => {
    const { biz } = await setup();
    await expect(createDraft(biz, reqInput({ shipments: withBusiness() }))).rejects.toMatchObject({ code: "B2B_DISABLED", status: 422, details: { field: "recipientType", row: 2, path: "shipments.1.recipientType" } });
    const body = { ...reqInput({ shipments: withBusiness() }), startsAt: new Date(Date.now() + 864e5).toISOString() };
    const res = await call("POST", "/requests", { token: await tok(biz), body });
    expect(res.status).toBe(422); expect(res.json.error).toMatchObject({ code: "B2B_DISABLED", details: { field: "recipientType", row: 2 } });
    const draft = await createDraft(biz, reqInput({ shipments: mkShipments(3) }));
    const patch = await call("PATCH", `/requests/${draft.id}`, { token: await tok(biz), body: { ...body, shipments: withBusiness() } });
    expect(patch.status).toBe(422); expect(patch.json.error.code).toBe("B2B_DISABLED");
    expect(await db.select().from(shipments).where(eq(shipments.requestId, draft.id))).toHaveLength(3); // nothing was replaced
    await expect(updateDraft(biz, draft.id, reqInput({ shipments: withBusiness() }))).rejects.toMatchObject({ code: "B2B_DISABLED" });
    // details later + a business row is refused too; an explicit "consumer" and an omitted type are fine
    await expect(createDraft(biz, reqInput({ detailsLater: true, shipmentCount: 5, shipments: [{ recipientType: "business", recipientName: "Acme" }] }))).rejects.toMatchObject({ code: "B2B_DISABLED", details: { row: 1 } });
    const ok = await createDraft(biz, reqInput({ shipments: [{ recipientType: "consumer", recipientName: "Mona", recipientPhone: "0555555555", address: "King Fahd Rd 1, Riyadh" }, { recipientName: "Sara", recipientPhone: "0555555556", address: "King Fahd Rd 2, Riyadh" }] }));
    expect((await db.select().from(shipments).where(eq(shipments.requestId, ok.id))).every((s) => s.recipientType === "consumer")).toBe(true);
    // an unknown type is still a plain validation error
    await expect(createDraft(biz, reqInput({ shipments: [{ ...mkShipments(1)[0], recipientType: "other" as never }] }))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("prepareManifest: reject by default, coerce on request (counted), keep for an existing business parcel; with B2B ON nothing changes", async () => {
    const rows = withBusiness(3);
    await expect(prepareManifest(rows, "riyadh")).rejects.toMatchObject({ code: "B2B_DISABLED", details: { row: 2 } });
    const report = { coerced: 0 };
    const coerced = await prepareManifest(rows, "riyadh", db, { b2b: "coerce", report });
    expect(coerced.map((r) => r.recipientType)).toEqual(["consumer", "consumer", "consumer"]); expect(report.coerced).toBe(1);
    expect((await prepareManifest(rows, "riyadh", db, { b2b: "keep" }))[1].recipientType).toBe("business");
    await setFieldModes({ b2b: true });
    const on = await prepareManifest(rows, "riyadh"); const r2 = { coerced: 0 };
    expect(on[1].recipientType).toBe("business");
    await prepareManifest(rows, "riyadh", db, { b2b: "coerce", report: r2 }); expect(r2.coerced).toBe(0);
  });

  it("shipment edit and the bulk details-later completion: a consumer parcel cannot become a business parcel (single 422, bulk 422 with the row)", async () => {
    const { biz } = await setup();
    const r = await publishedRequest(biz, { shipments: mkShipments(3), shipmentsPerDriver: 3 });
    const [a, b] = await db.select().from(shipments).where(eq(shipments.requestId, r.id)).orderBy(asc(shipments.seq));
    const t = await tok(biz);
    const one = await call("PATCH", `/shipments/${a.id}`, { token: t, body: { recipientType: "business" } });
    expect(one.status).toBe(422); expect(one.json.error).toMatchObject({ code: "B2B_DISABLED", details: { field: "recipientType" } });
    const bulk = await call("PATCH", `/requests/${r.id}/shipments`, { token: t, body: { rows: [{ id: a.id, address: "New Street 12, Riyadh" }, { id: b.id, recipientType: "business" }] } });
    expect(bulk.status).toBe(422); expect(bulk.json.error).toMatchObject({ code: "B2B_DISABLED", details: { row: 2, field: "recipientType", path: "rows.1.recipientType" } });
    expect((await db.select().from(shipments).where(eq(shipments.id, a.id)))[0].address).toBe(a.address); // all-or-nothing: row 1 was rolled back
    // consumer → consumer is fine
    expect((await call("PATCH", `/shipments/${a.id}`, { token: t, body: { recipientType: "consumer", address: "Edited Street 9, Riyadh" } })).status).toBe(200);
    expect((await call("PATCH", `/requests/${r.id}/shipments`, { token: t, body: { rows: [{ id: b.id, contents: "Books" }] } })).json).toMatchObject({ updated: 1 });
  });

  it("the public API (X-API-Key) and re-ship COERCE to consumer instead of failing, and report it; the idempotent replay returns the same report", async () => {
    const { biz } = await setup();
    const key = await createApiKey(biz, "erp") as { key: string };
    const H = { "x-api-key": key.key, "idempotency-key": "k-1" };
    const body = { ...reqInput({ shipments: withBusiness() }), startsAt: new Date(Date.now() + 864e5).toISOString() };
    const res = await call("POST", "/jobs", { headers: H, body });
    expect(res.status).toBe(201);
    expect(res.json.warnings).toEqual([expect.objectContaining({ code: "B2B_DISABLED", count: 1 })]);
    const rows = await db.select().from(shipments).where(eq(shipments.requestId, res.json.id)).orderBy(asc(shipments.seq));
    expect(rows).toHaveLength(3); expect(rows.every((s) => s.recipientType === "consumer")).toBe(true);
    expect((await events(res.json.id, "shipments_b2b_coerced"))[0].payload).toMatchObject({ count: 1, via: "api" });
    const again = await call("POST", "/jobs", { headers: H, body });
    expect(again.status).toBe(200); expect(again.json.warnings).toEqual(res.json.warnings);
    // no business rows → no warnings key
    const clean = await call("POST", "/jobs", { headers: { "x-api-key": key.key }, body: { ...body, shipments: mkShipments(2) } });
    expect(clean.status).toBe(201); expect(clean.json.warnings).toBeUndefined();
    // with B2B ON the public API keeps business recipients, as before
    await setFieldModes({ b2b: true });
    const on = await call("POST", "/jobs", { headers: { "x-api-key": key.key }, body: { ...body, shipments: withBusiness() } });
    expect(on.status).toBe(201); expect(on.json.warnings).toBeUndefined();
    expect((await db.select().from(shipments).where(eq(shipments.requestId, on.json.id))).filter((s) => s.recipientType === "business")).toHaveLength(1);
  });

  it("demo parcels (demo mode): all 80 are consumers while B2B is off, 20 are businesses when it is on", async () => {
    const { biz } = await setup(); const t = await tok(biz);
    const off = await call("GET", "/business/demo-shipments?city=riyadh", { token: t });
    expect(off.status).toBe(200); expect(off.json.items).toHaveLength(80); expect(off.json.items.every((p: { recipientType: string }) => p.recipientType === "consumer")).toBe(true);
    // the picked parcels go straight into a manifest
    await expect(createDraft(biz, reqInput({ shipments: off.json.items.slice(0, 5).map((p: { ref: string }) => ({ ...p, externalRef: p.ref })) }))).resolves.toBeTruthy();
    await setFieldModes({ b2b: true });
    const on = await call("GET", "/business/demo-shipments?city=riyadh", { token: t });
    expect(on.json.items.filter((p: { recipientType: string }) => p.recipientType === "business")).toHaveLength(20);
  });

  it("re-shipping parcels that were business parcels creates a consumer draft while B2B is off (never refused)", async () => {
    await setFieldModes({ b2b: true });
    const { biz, ...x } = await ready(3, { req: { shipments: mkShipments(3, { type: "business" }).map((s, i) => ({ ...s, recipientName: `Acme ${i}` })) } });
    await loadByScan(x.d, x.off.id);
    for (const s of await byOrder(x.off.id)) { await stops.failStop(x.d, x.off.id, s.id, { reason: "refused" }); }
    await jobs.reportDelivered(x.d, x.off.id); await stops.confirmReturns(biz, x.off.id, { all: true });
    await setFieldModes({ b2b: false });
    const draft = await stops.reshipFromRequest(biz, x.r.id);
    const rows = await db.select().from(shipments).where(eq(shipments.requestId, draft.id));
    expect(rows).toHaveLength(3); expect(rows.every((s) => s.recipientType === "consumer")).toBe(true);
    expect((await events(draft.id, "shipments_b2b_coerced"))[0].payload).toMatchObject({ count: 3 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("B2B OFF — existing business parcels keep working end to end (no migration, nothing rewritten)", () => {
  async function businessJob(n = 3) {
    await setFieldModes({ routing: true, b2b: true });
    const { biz, d, r, off } = await ready(n, { req: { shipments: mkShipments(n, { type: "business" }).map((s, i) => ({ ...s, recipientName: `Acme ${i + 1}`, recipientPhone: `05110000${i + 1}0` })) } });
    return { biz, d, r, off };
  }

  it("a draft that already holds business parcels can be re-saved with them; business rows beyond the draft's own are still refused for a draft without any", async () => {
    await setFieldModes({ b2b: true });
    const { biz } = await setup();
    const draft = await createDraft(biz, reqInput({ shipments: mkShipments(3, { type: "business" }) }));
    await setFieldModes({ b2b: false });
    const upd = await updateDraft(biz, draft.id, reqInput({ shipments: mkShipments(3, { type: "business" }), title: "edited" }));
    expect(upd.title).toBe("edited");
    expect((await db.select().from(shipments).where(eq(shipments.requestId, draft.id))).every((s) => s.recipientType === "business")).toBe(true); // not rewritten
    const consumerDraft = await createDraft(biz, reqInput({ shipments: mkShipments(2) }));
    await expect(updateDraft(biz, consumerDraft.id, reqInput({ shipments: mkShipments(2, { type: "business" }) }))).rejects.toMatchObject({ code: "B2B_DISABLED" });
  });

  it("an existing business parcel can be edited (address, phone) while B2B is off and stays a business parcel; it can be changed to consumer", async () => {
    await setFieldModes({ b2b: true });
    const { biz } = await setup();
    const r = await publishedRequest(biz, { shipments: mkShipments(2, { type: "business" }), shipmentsPerDriver: 2 });
    await setFieldModes({ b2b: false });
    const [a, b] = await db.select().from(shipments).where(eq(shipments.requestId, r.id)).orderBy(asc(shipments.seq)); const t = await tok(biz);
    const edit = await call("PATCH", `/shipments/${a.id}`, { token: t, body: { address: "Updated Street 77, Riyadh" } });
    expect(edit.status).toBe(200); expect(edit.json).toMatchObject({ recipientType: "business", address: "Updated Street 77, Riyadh" });
    expect((await call("PATCH", `/shipments/${a.id}`, { token: t, body: { recipientType: "business", contents: "Docs" } })).status).toBe(200);
    expect((await call("PATCH", `/shipments/${b.id}`, { token: t, body: { recipientType: "consumer" } })).json.recipientType).toBe("consumer");
    expect((await call("PATCH", `/requests/${r.id}/shipments`, { token: t, body: { rows: [{ id: a.id, notes: "Gate 2" }] } })).json).toMatchObject({ updated: 1 });
  });

  it("the whole job works: proof by receipt photo (proofMode code_or_receipt) and by code, COD, finish, settlement; the business and staff views list the type", async () => {
    const { biz, d, r, off } = await businessJob(3);
    await loadByScan(d, off.id); await stops.approveRoute(d, off.id);
    await setFieldModes({ b2b: false }); // switched OFF while the business parcels are on the road
    const v = await viewOf(off.id);
    expect(v.stops!.every((s) => s.recipientType === "business" && s.proofMode === "code_or_receipt")).toBe(true);
    const [s1, s2, s3] = await byOrder(off.id);
    await stops.arriveAtStop(d, off.id, s1.id);
    await stops.saveProofPhoto(d, off.id, s1.id, { data: PNG, mime: "image/png" });
    expect(await stops.deliverStop(d, off.id, s1.id, { code: s1.code, proof: "receipt", receiverName: "Khalid" })).toMatchObject({ status: "delivered", proofType: "receipt", receiverName: "Khalid" });
    await stops.arriveAtStop(d, off.id, s2.id); expect(await deliver(d, off.id, s2)).toMatchObject({ status: "delivered", proofType: "otp" });
    await stops.arriveAtStop(d, off.id, s3.id); await stops.failStop(d, off.id, s3.id, { reason: "closed" });
    expect((await jobs.reportDelivered(d, off.id)).status).toBe("completed");
    await stops.confirmReturns(biz, off.id, { all: true });
    const list = await call("GET", `/requests/${r.id}/shipments`, { token: await tok(biz) });
    expect(list.json.items.map((s: { recipientType: string }) => s.recipientType)).toEqual(["business", "business", "business"]);
    expect(list.json.counts).toMatchObject({ delivered: 2, returned: 1 });
  });

  it("analytics that group by recipient type keep working with business parcels in the data and none new being created", async () => {
    const { biz, d, off } = await businessJob(3);
    await loadByScan(d, off.id); await stops.approveRoute(d, off.id);
    for (const s of await byOrder(off.id)) { await stops.arriveAtStop(d, off.id, s.id); await deliver(d, off.id, s); }
    await jobs.reportDelivered(d, off.id);
    await setFieldModes({ routing: false, b2b: false });
    await publishedRequest(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2 }); // new data is consumer-only
    const admin = await mkAdmin(); const t = await tok(admin);
    // the B2C / B2B split of the deliveries report and the parcel explorer (grouped by recipient type) still answer, counting the old business parcels
    const rep = await call("GET", "/admin/analytics/deliveries", { token: t });
    expect(rep.status).toBe(200);
    const flat = JSON.stringify(rep.json);
    expect(flat).toContain("b2b"); expect(flat).not.toContain("B2B_DISABLED");
    const grp = await call("GET", "/admin/analytics/explorer/parcels?group=recipientType", { token: t });
    expect(grp.status).toBe(200);
    expect(JSON.stringify(grp.json)).toContain("business"); expect(JSON.stringify(grp.json)).toContain("consumer");
    const grouped = await db.execute(`select recipient_type, count(*)::int n from shipments group by 1 order by 1` as never);
    expect((grouped.rows as Array<{ recipient_type: string; n: number }>).map((x) => [x.recipient_type, x.n])).toEqual([["business", 3], ["consumer", 2]]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("B2B ON — exactly as before", () => {
  beforeEach(() => setFieldModes({ b2b: true }));
  it("business recipients are accepted on every entry point and kept as business parcels", async () => {
    const { biz } = await setup();
    const d1 = await createDraft(biz, reqInput({ shipments: mkShipments(3).map((s, i) => ({ ...s, recipientType: i === 1 ? "business" as const : s.recipientType })) }));
    expect((await db.select().from(shipments).where(eq(shipments.requestId, d1.id)).orderBy(asc(shipments.seq))).map((s) => s.recipientType)).toEqual(["consumer", "business", "consumer"]);
    const r = await publishedRequest(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2 });
    const [a] = await db.select().from(shipments).where(eq(shipments.requestId, r.id)).orderBy(asc(shipments.seq));
    expect((await call("PATCH", `/shipments/${a.id}`, { token: await tok(biz), body: { recipientType: "business" } })).json.recipientType).toBe("business");
    expect((await call("PATCH", `/requests/${r.id}/shipments`, { token: await tok(biz), body: { rows: [{ id: a.id, recipientType: "consumer" }] } })).json).toMatchObject({ updated: 1 });
    expect((await events(d1.id, "shipments_b2b_coerced"))).toHaveLength(0);
  });
});
