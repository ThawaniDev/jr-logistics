/**
 * Order and parcel detail views (decisions G6–G7): GET /admin/requests/:id/{overview,offers,parcels,money,communication} and GET /admin/shipments/:id/detail.
 * Pins the permissions (requests.view opens an order, finance.view money, drivers.sensitive personal data, reports.export the CSV), 404 for unknown ids,
 * and the numbers the pages show (KPIs, milestones, offer cards, manifest filters and paging, ledger, cash, journey, visits, similar parcels).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, messages, offers, requests, shipments } from "@/db/schema";
import { shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, mkStaff, mkShipments, publishedRequest, WAREHOUSE } from "../helpers/factories";
import { resetDbWithFieldModes } from "../helpers/field-modes";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { currentStopOf, otpFor } from "@/server/shipments";
import { finishLoading, scanLoad } from "@/server/loading";
import { logMessage } from "@/server/data-capture";

beforeEach(resetDbWithFieldModes); // J2 / J3: routing and B2B shipments default to OFF — this suite exercises the route / approve-route / business-parcel behaviour
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const get = async (u: { id: string }, path: string) => call("GET", path, { token: await tok(u) });
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

/**
 * One delivery order with 4 parcels (two with cash on delivery, two sharing a phone number): the driver accepted, checked in at the pin, loaded everything by scan,
 * delivered parcel 1 and 2 (with the cash), could not deliver parcel 3 (refused) and has parcel 4 still on board.
 */
async function scenario() {
  const admin = await mkAdmin(); await mkRule(admin);
  const biz = await mkBusiness({ fundsCents: 5000_00, name: "Alpha Foods" }); const driver = await mkDriver({ name: "Nasser Driver" });
  const rows = mkShipments(4, { withRefs: true }).map((s, i) => ({ ...s, codCents: i < 2 ? [10_000, 5_000][i] : 0, recipientPhone: i === 3 ? "0599999999" : s.recipientPhone }));
  const r = await publishedRequest(biz, { shipments: rows, shipmentsPerDriver: 4 });
  const off = (await db.select().from(offers).where(and(eq(offers.requestId, r.id), eq(offers.driverId, driver.id))))[0];
  await jobs.acceptOffer(driver, off.id, true);
  await db.update(requests).set({ startsAt: new Date(Date.now() + 3600_000) }).where(eq(requests.id, r.id));
  await jobs.checkIn(driver, off.id, WAREHOUSE); await jobs.confirmAttendance(biz, off.id, true);
  for (const p of await db.select().from(shipments).where(eq(shipments.offerId, off.id)).orderBy(asc(shipments.seq))) await scanLoad(driver, off.id, p.code);
  await finishLoading(driver, off.id); await stops.approveRoute(driver, off.id);
  for (let i = 0; i < 3; i++) {
    const s = (await currentStopOf(db, off.id))!;
    await stops.arriveAtStop(driver, off.id, s.id);
    if (i < 2) await stops.deliverStop(driver, off.id, s.id, { code: s.code, otp: otpFor(s), cashCollectedCents: s.codCents > 0 ? s.codCents : undefined });
    else await stops.failStop(driver, off.id, s.id, { reason: "refused", note: "nobody home" });
  }
  const parcels = await db.select().from(shipments).where(eq(shipments.requestId, r.id)).orderBy(asc(shipments.seq));
  return { admin, biz, driver, r, off, parcels };
}
const finance = () => mkStaff(["requests.view", "finance.view"]);
const ops = () => mkStaff(["requests.view"]);

describe("permissions and unknown ids", () => {
  it("needs requests.view for every order read; money also needs finance.view", async () => {
    const { admin, biz, driver, r, parcels } = await scenario();
    const paths = ["overview", "offers", "parcels", "money", "communication"].map((p) => `/admin/requests/${r.id}/${p}`).concat(`/admin/shipments/${parcels[0].id}/detail`);
    for (const path of paths) {
      expect((await call("GET", path)).status, `anonymous ${path}`).toBe(401);
      expect((await get(biz, path)).status, `business ${path}`).toBe(403);
      expect((await get(driver, path)).status, `driver ${path}`).toBe(403);
      expect((await get(await mkStaff(["tickets.view", "finance.view"]), path)).status, `no requests.view ${path}`).toBe(403);
      expect((await get(admin, path)).status, `admin ${path}`).toBe(200);
    }
    const support = await ops();
    for (const path of paths.filter((p) => !p.endsWith("/money"))) expect((await get(support, path)).status, path).toBe(200);
    expect((await get(support, `/admin/requests/${r.id}/money`)).status).toBe(403);
    expect((await get(await finance(), `/admin/requests/${r.id}/money`)).status).toBe(200);
  });
  it("answers 404 for an unknown or malformed id", async () => {
    const admin = await mkAdmin();
    for (const id of [UNKNOWN, "not-a-uuid"]) {
      for (const p of ["overview", "offers", "parcels", "money", "communication"]) expect((await get(admin, `/admin/requests/${id}/${p}`)).status, `${p} ${id}`).toBe(404);
      expect((await get(admin, `/admin/shipments/${id}/detail`)).status, id).toBe(404);
    }
  });
});

describe("GET /admin/requests/:id/overview", () => {
  it("returns the header facts, flags, KPIs, milestones, offers funnel, parcel mix, failure reasons and the map points", async () => {
    const { admin, r, biz } = await scenario();
    const o = (await get(admin, `/admin/requests/${r.id}/overview`)).json;
    expect(o.request).toMatchObject({ id: r.id, ref: r.ref, slotsFilled: 1 }); expect(["confirmed", "in_progress"]).toContain(o.request.status);
    expect(o.company).toMatchObject({ id: biz.id, name: "Co Alpha Foods" }); // the company name from the profile, not the owner's name
    expect(o.flags).toMatchObject({ allOrNothing: false, detailsLater: false, partnerCreated: false, createdVia: "web", manifest: true, closed: null });
    expect(o.kpis.parcels).toMatchObject({ total: 4, delivered: 2, failed: 1, returned: 0, pending: 1, onBoard: 1 });
    expect(o.kpis.successRate).toBeCloseTo(2 / 3, 5);
    expect(o.kpis.firstAttemptRate).toBe(1);
    expect(o.kpis.slots).toEqual({ filled: 1, needed: 1 });
    expect(o.kpis.start.arrived).toBe(1);
    expect(o.kpis.start.deltaMin).toBeLessThan(0); // checked in before the start
    expect(o.kpis.executionRunning).toBe(true);
    expect(o.parcelMix).toMatchObject({ delivered: 2, failed: 1, loaded: 1, pending: 0 });
    expect(o.failureReasons).toEqual([{ reason: "refused", n: 1 }]);
    expect(o.funnel).toMatchObject({ offered: 1, accepted: 1, arrived: 1, attendance: 1, loaded: 1 });
    expect(o.milestones.map((m: any) => m.key)).toEqual(["created", "published", "first_offer", "first_accepted", "filled", "started", "loaded", "first_delivery", "closed"]);
    for (const k of ["created", "published", "first_offer", "first_accepted", "filled", "started", "loaded", "first_delivery"]) expect(o.milestones.find((m: any) => m.key === k).at, k).toBeTruthy();
    expect(o.milestones.find((m: any) => m.key === "closed").at).toBeNull();
    expect(o.delivery.n).toBe(2);
    expect(o.map.pickup).toEqual(WAREHOUSE);
    expect(o.map.unlocated + o.map.located).toBe(4);
    expect(o.alerts.map((a: any) => a.key)).toEqual(expect.arrayContaining(["returns_pending"]));
  });
  it("hides money and cash from staff who may not see them, and shows them with finance.view", async () => {
    const { r } = await scenario();
    const plain = (await get(await ops(), `/admin/requests/${r.id}/overview`)).json;
    expect(plain.kpis.money).toBeNull(); expect(plain.kpis.cod).toBeNull(); expect(plain.access).toMatchObject({ finance: false, cod: false, sensitive: false });
    expect(plain.alerts.map((a: any) => a.key)).not.toContain("cod_outstanding");
    const fin = (await get(await finance(), `/admin/requests/${r.id}/overview`)).json;
    expect(fin.kpis.money.totalCents).toBe(4000);
    expect(fin.kpis.cod).toEqual({ dueCents: 15_000, collectedCents: 15_000, remittedCents: 0, outstandingCents: 15_000 });
    expect(fin.alerts.map((a: any) => a.key)).toContain("cod_outstanding");
    const cashOnly = (await get(await mkStaff(["requests.view", "cod.manage"]), `/admin/requests/${r.id}/overview`)).json;
    expect(cashOnly.kpis.cod.outstandingCents).toBe(15_000); expect(cashOnly.kpis.money).toBeNull();
  });
  it("masks the company phone without drivers.sensitive and shows support items only to staff who handle them", async () => {
    const { r, admin } = await scenario();
    const plain = (await get(await ops(), `/admin/requests/${r.id}/overview`)).json;
    expect(plain.company.phone).toMatch(/•••/);
    expect(plain.kpis.support).toBeNull();
    expect((await get(admin, `/admin/requests/${r.id}/overview`)).json.kpis.support).toEqual({ open: 0, total: 0 });
  });
});

describe("GET /admin/requests/:id/offers", () => {
  it("gives one detailed card per offer: steps, arrival, loading, route, parcels and cash", async () => {
    const { admin, r, off, driver } = await scenario();
    const res = (await get(admin, `/admin/requests/${r.id}/offers`)).json;
    expect(res.manifest).toBe(true); expect(res.sensitive).toBe(true); expect(res.items).toHaveLength(1);
    const c = res.items[0];
    expect(c).toMatchObject({ id: off.id, status: "attendance_confirmed", driver: { id: driver.id, name: "Nasser Driver" } });
    expect(c.steps.map((s: any) => s.key)).toEqual(expect.arrayContaining(["offered", "accepted", "arrived", "attendance", "loaded", "route_approved"]));
    expect(c.arrival.distanceM).toBeLessThanOrEqual(5);
    expect(c.arrival.lateMin).toBeLessThan(0);
    expect(c.loading).toMatchObject({ mode: "driver_scan", assigned: 4, scanned: 4, unscanned: 0, finished: true });
    expect(c.loading.viaScan).toBe(4);
    expect(c.route).toMatchObject({ stops: 4 }); expect(c.route.provider).toBeTruthy();
    expect(c.parcels).toMatchObject({ total: 4, delivered: 2, failed: 1, onBoard: 1 });
    expect(c.parcels.successRate).toBeCloseTo(2 / 3, 5);
    expect(c.cod).toEqual({ collectedCents: 15_000, receivedCents: 0, outstandingCents: 15_000 });
    expect(c.expectedEarningCents).toBeGreaterThan(0);
    expect(c.routePlan).toBeTruthy();
  });
  it("hides the driver's phone, plate and earnings without drivers.sensitive / finance.view", async () => {
    const { r } = await scenario();
    const res = (await get(await ops(), `/admin/requests/${r.id}/offers`)).json;
    expect(res.sensitive).toBe(false);
    expect(res.items[0].driver.phone).toMatch(/•••/); expect(res.items[0].driver.plate).toBeNull();
    expect(res.items[0].expectedEarningCents).toBeNull(); expect(res.items[0].arrival.lat).toBeNull();
  });
  it("counts the chat messages of an offer", async () => {
    const { admin, r, off, biz } = await scenario();
    await db.insert(messages).values([{ requestId: r.id, offerId: off.id, senderId: biz.id, senderRole: "business", body: "Hello" }, { requestId: r.id, offerId: off.id, senderId: off.driverId, senderRole: "driver", body: "On my way" }]);
    expect((await get(admin, `/admin/requests/${r.id}/offers`)).json.items[0].chat.count).toBe(2);
  });
});

describe("GET /admin/requests/:id/parcels", () => {
  it("pages on the server and returns the facets of the whole order", async () => {
    const { admin, r } = await scenario();
    const p1 = (await get(admin, `/admin/requests/${r.id}/parcels?pageSize=3`)).json;
    expect(p1).toMatchObject({ page: 1, pageSize: 3, total: 4 }); expect(p1.items.map((x: any) => x.seq)).toEqual([1, 2, 3]);
    const p2 = (await get(admin, `/admin/requests/${r.id}/parcels?pageSize=3&page=2`)).json;
    expect(p2.items.map((x: any) => x.seq)).toEqual([4]);
    expect(p1.counts).toEqual({ delivered: 2, failed: 1, loaded: 1 }); expect(p1.withCod).toBe(2); expect(p1.incomplete).toBe(0);
    expect(p1.cities).toEqual([{ city: "riyadh", n: 4 }]); expect(p1.drivers).toEqual([expect.objectContaining({ n: 4, name: "Nasser Driver" })]);
  });
  it("filters by status, driver, text, cash on delivery and city", async () => {
    const { admin, r, off, parcels } = await scenario();
    const q = async (s: string) => ((await get(admin, `/admin/requests/${r.id}/parcels?${s}`)).json.items as any[]).map((x) => x.seq);
    expect(await q("status=failed")).toEqual([3]);
    expect(await q("status=delivered,failed")).toEqual([1, 2, 3]);
    expect(await q("status=nonsense")).toEqual([1, 2, 3, 4]); // unknown statuses are ignored, not an error
    expect(await q(`offerId=${off.id}`)).toEqual([1, 2, 3, 4]); expect(await q("offerId=none")).toEqual([]);
    expect(await q(`q=${encodeURIComponent(parcels[1].code)}`)).toEqual([2]); expect(await q("q=ORD-4")).toEqual([4]); expect(await q("q=Customer%203")).toEqual([3]);
    expect(await q("cod=1")).toEqual([1, 2]); expect(await q("city=jeddah")).toEqual([]); expect(await q("city=riyadh&cod=1&status=delivered")).toEqual([1, 2]);
    expect((await get(admin, `/admin/requests/${r.id}/parcels?pageSize=500`)).status).toBe(422);
  });
  it("returns the manifest columns: attempts, stop order, proof, cash, timestamps, dwell, failure reason", async () => {
    const { admin, r } = await scenario();
    const items = (await get(admin, `/admin/requests/${r.id}/parcels`)).json.items;
    expect(items[0]).toMatchObject({ seq: 1, status: "delivered", attempts: 1, stopOrder: 1, proofType: "otp", codCents: 10_000, codCollectedCents: 10_000, driverName: "Nasser Driver" });
    expect(items[0].loadedAt).toBeTruthy(); expect(items[0].arrivedAt).toBeTruthy(); expect(items[0].deliveredAt).toBeTruthy(); expect(items[0].dwellS).toBeGreaterThanOrEqual(0);
    expect(items[2]).toMatchObject({ status: "failed", failReason: "refused", failNote: "nobody home" });
    expect(items[3]).toMatchObject({ status: "loaded", deliveredAt: null });
  });
  it("masks recipient phones without drivers.sensitive", async () => {
    const { r, admin } = await scenario();
    expect((await get(await ops(), `/admin/requests/${r.id}/parcels`)).json.items[0].recipientPhone).toMatch(/•••/);
    expect((await get(admin, `/admin/requests/${r.id}/parcels`)).json.items[0].recipientPhone).not.toMatch(/•••/);
  });
  it("exports the filtered manifest as CSV only with reports.export, and audits it", async () => {
    const { admin, r } = await scenario();
    expect((await get(await ops(), `/admin/requests/${r.id}/parcels?format=csv`)).status).toBe(403);
    const exporter = await mkStaff(["requests.view", "reports.export"]);
    const res = await get(exporter, `/admin/requests/${r.id}/parcels?format=csv&status=delivered`);
    expect(res.status).toBe(200); expect(res.headers.get("content-type")).toContain("text/csv");
    const lines = res.text.replace(/^﻿/, "").split("\n");
    expect(lines[0].startsWith("seq,code,externalRef,recipientType,recipientName,recipientPhone")).toBe(true);
    expect(lines).toHaveLength(3); // header + the 2 delivered parcels
    expect(lines[1]).toContain("delivered"); expect(res.text).toContain("Nasser Driver");
    expect((await get(admin, `/admin/requests/${r.id}/parcels?format=csv`)).text.split("\n")).toHaveLength(5);
    const logged = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "report.export"), eq(auditLogs.entityId, r.id)));
    expect(logged.length).toBeGreaterThanOrEqual(2);
  });
});

describe("GET /admin/requests/:id/money", () => {
  it("shows the price build, reservation, cash per driver and ledger entries of the order", async () => {
    const { r, off } = await scenario();
    const m = (await get(await finance(), `/admin/requests/${r.id}/money`)).json;
    expect(m.request).toMatchObject({ totalCents: 4000, unitPriceCents: 1000 });
    expect(m.pricing.snapshot).toMatchObject({ unitPriceCents: 1000, providerCostCents: 700, totalUnits: 4, totalCents: 4000, marginCents: 1200 });
    expect(m.pricing.rule).toMatchObject({ version: 1, status: "approved" });
    expect(m.reservation).toMatchObject({ currentCents: 4000, reservedCents: 4000, releasedCents: 0 });
    expect(m.settlements).toEqual([]); expect(m.invoices).toEqual([]);
    expect(m.ledger.total).toBeGreaterThanOrEqual(1);
    expect(m.ledger.items.some((e: any) => e.kind === "reserve" && e.reservedCents === 4000)).toBe(true);
    expect(m.cod.drivers).toEqual([expect.objectContaining({ offerId: off.id, driverName: "Nasser Driver", dueCents: 15_000, collectedCents: 15_000, receivedCents: 0, outstandingCents: 15_000, parcels: 2 })]);
    expect(m.cod.totals.outstandingCents).toBe(15_000); expect(m.cod.remittances).toEqual([]);
  });
  it("pages the ledger and 422s a page out of range", async () => {
    const { r } = await scenario();
    const f = await finance();
    expect((await get(f, `/admin/requests/${r.id}/money?page=2`)).json.ledger.items).toEqual([]);
    expect((await get(f, `/admin/requests/${r.id}/money?page=0`)).status).toBe(422);
  });
});

describe("GET /admin/requests/:id/communication", () => {
  it("groups the chat per driver offer and lists messages and notifications about the order", async () => {
    const { admin, r, off, biz, parcels } = await scenario();
    await db.insert(messages).values([{ requestId: r.id, offerId: off.id, senderId: biz.id, senderRole: "business", body: "Please call me", createdAt: new Date(Date.now() - 2000) }, { requestId: r.id, offerId: off.id, senderId: off.driverId, senderRole: "driver", body: "OK", createdAt: new Date(Date.now() - 1000) }]); // one INSERT gives both rows the same now(): the order asserted below needs distinct times (it failed on a tie)
    await logMessage({ channel: "sms", type: "recipient_code", recipient: "•••• 0001", requestId: r.id, shipmentId: parcels[0].id, status: "sent" });
    await logMessage({ channel: "sms", type: "recipient_code", recipient: "•••• 0002", requestId: r.id, shipmentId: parcels[1].id, status: "failed", error: "provider down" });
    const c = (await get(admin, `/admin/requests/${r.id}/communication`)).json;
    expect(c.chat.total).toBe(2); expect(c.chat.threads).toHaveLength(1); expect(c.chat.threads[0]).toMatchObject({ offerId: off.id, driverName: "Nasser Driver" });
    expect(c.chat.threads[0].messages.map((m: any) => m.body)).toEqual(["Please call me", "OK"]);
    expect(c.messages.total).toBeGreaterThanOrEqual(2); /* + the SMS the delivery flow itself logged */ expect(c.messages.stats).toEqual(expect.arrayContaining([{ channel: "sms", status: "failed", n: 1 }]));
    expect(c.messages.items.find((m: any) => m.status === "failed")).toMatchObject({ error: "provider down", shipmentCode: parcels[1].code });
    expect(c.notifications.total).toBeGreaterThan(0); expect(c.notifications.items[0]).toMatchObject({ userName: expect.any(String), type: expect.any(String) });
  });
});

describe("GET /admin/shipments/:id/detail", () => {
  it("returns the journey with elapsed times, the visits, cash, route leg and similar parcels of a delivered parcel", async () => {
    const { admin, parcels, off } = await scenario();
    const d = (await get(admin, `/admin/shipments/${parcels[0].id}/detail`)).json;
    expect(d.parcel).toMatchObject({ id: parcels[0].id, code: parcels[0].code, status: "delivered", attempts: 1, stopOrder: 1, proofType: "otp" });
    expect(d.request).toMatchObject({ businessName: "Co Alpha Foods" }); expect(d.offer).toMatchObject({ id: off.id, driverName: "Nasser Driver" });
    const types = d.journey.map((e: any) => e.type);
    expect(types).toEqual(expect.arrayContaining(["created", "assigned", "loaded", "arrived", "otp_verified", "delivered", "cod_collected"]));
    expect(d.journey[0].fromPrevS).toBeNull(); expect(d.journey.slice(1).every((e: any) => typeof e.fromPrevS === "number")).toBe(true);
    expect(d.attempts).toEqual([expect.objectContaining({ n: 1, outcome: "delivered" })]);
    expect(d.cod).toMatchObject({ dueCents: 10_000, collectedCents: 10_000, offer: { outstandingCents: 15_000 } });
    expect(d.route.stopOrder).toBe(1); expect(d.route.provider).toBeTruthy();
    expect(d.otp.verifiedAt).toBeTruthy(); expect(d.media).toEqual([]); expect(d.partner).toBeNull();
  });
  it("shows a failed parcel's visit with its reason and note, and finds parcels with the same recipient phone", async () => {
    const { admin, parcels } = await scenario();
    const failed = (await get(admin, `/admin/shipments/${parcels[2].id}/detail`)).json;
    expect(failed.attempts).toEqual([expect.objectContaining({ outcome: "failed", reason: "refused", note: "nobody home" })]);
    expect(failed.parcel).toMatchObject({ status: "failed", failReason: "refused" });
    // parcel 4 has a phone of its own; give parcel 3 the same one and they find each other
    await db.update(shipments).set({ recipientPhone: parcels[3].recipientPhone }).where(eq(shipments.id, parcels[2].id));
    const again = (await get(admin, `/admin/shipments/${parcels[2].id}/detail`)).json;
    expect(again.similar.byPhone.map((x: any) => x.id)).toEqual([parcels[3].id]);
  });
  it("masks the recipient phone and hides the driver's delivery position without drivers.sensitive", async () => {
    const { parcels, admin } = await scenario();
    await db.update(shipments).set({ lat: 24.71, lng: 46.67, deliveredLat: 24.7101, deliveredLng: 46.6701, deliveredDistanceM: 15 }).where(eq(shipments.id, parcels[0].id));
    const plain = (await get(await ops(), `/admin/shipments/${parcels[0].id}/detail`)).json;
    expect(plain.recipient.phone).toMatch(/•••/); expect(plain.location.delivered).toBeNull(); expect(plain.location.deliveredHidden).toBe(true); expect(plain.location.distanceM).toBe(15); expect(plain.location.pin).toEqual({ lat: 24.71, lng: 46.67 });
    const full = (await get(admin, `/admin/shipments/${parcels[0].id}/detail`)).json;
    expect(full.location.delivered).toEqual({ lat: 24.7101, lng: 46.6701 }); expect(full.recipient.phone).not.toMatch(/•••/);
  });
});
