import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  users, sessions, loginEvents, driverLocationHistory, driverAvailabilityLog, shipmentEvents, messageLog, requests, tickets, complaints, metricSnapshots,
  offers, shipments, businessProfiles, webhookDeliveries,
} from "@/db/schema";
import { shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, mkStaff, publishedRequest, mkShipments } from "../helpers/factories";
import { resetDbWithFieldModes } from "../helpers/field-modes";
import { call, loginWithPhone, staffLogin, login, usernameOfPhone } from "../helpers/api";
import { work } from "../helpers/work";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { createSession } from "@/server/auth/session";
import { resetStaffPassword, updateStaff } from "@/server/accounts";
import { setSmsProvider } from "@/server/auth/otp";
import { currentStopOf, otpFor } from "@/server/shipments";
import { runMaintenance } from "@/server/maintenance";
import { runCaptureTick, takeDailySnapshot, takeHourlySnapshot, pruneCaptureData, hourStart, riyadhDayStart, foldByCity } from "@/server/snapshots";
import { reconcileMilestones, syncWebhookMessages, maskPhone, hostOf } from "@/server/data-capture";
import { createTicket, replyTicket, resolveTicket, reopenTicket, staffUpdateTicket, fileComplaint, updateComplaint } from "@/server/support";
import { logEvent } from "@/server/events";
import { cancelRequest } from "@/server/requests";

beforeEach(resetDbWithFieldModes); // J2 / J3: routing and B2B shipments default to OFF — this suite exercises the route / approve-route / business-parcel behaviour
afterAll(shutdown);

const offerOf = async (requestId: string, driverId: string) => (await db.select().from(offers).where(and(eq(offers.requestId, requestId), eq(offers.driverId, driverId))))[0];
async function setup() { const admin = await mkAdmin(); await mkRule(admin); const biz = await mkBusiness({ fundsCents: 5000_00 }); return { admin, biz }; }
/** One driver with an accepted + attendance-confirmed job of n parcels. */
async function ready(n = 3) {
  const { admin, biz } = await setup(); const d = await mkDriver();
  const r = await publishedRequest(biz, { shipments: mkShipments(n, { withRefs: true }), shipmentsPerDriver: n });
  const off = await offerOf(r.id, d.id);
  await jobs.acceptOffer(d, off.id, true); await jobs.confirmAttendance(biz, off.id, true);
  return { admin, biz, d, r, off };
}
const journey = async (shipmentId: string) => (await db.select().from(shipmentEvents).where(eq(shipmentEvents.shipmentId, shipmentId)).orderBy(asc(shipmentEvents.createdAt))).map((e) => e.type);

describe("sign-in capture", () => {
  it("records password sign-ins (failure then success), last login, count, IP and client; logout stores the reason", async () => {
    const phone = "+966500000111", username = usernameOfPhone(phone);
    const { token, user } = await loginWithPhone(phone, { role: "driver", name: "Sam Driver", vehicleType: "sedan", services: ["delivery_driver"] }); // registering signs in
    await db.delete(loginEvents); await db.update(users).set({ loginCount: 0 }).where(eq(users.id, user.id));
    const bad = await login(username, "Wrong#Pass2026", { headers: { "x-forwarded-for": "9.9.9.9", "user-agent": "vitest-ua" } });
    expect(bad.status).toBe(401);
    // returning user signs in again: counted, stamped
    const again = await loginWithPhone(phone);
    const rows = await db.select().from(loginEvents).orderBy(asc(loginEvents.createdAt));
    expect(rows.map((r) => [r.method, r.success, r.failureReason])).toEqual([["password", false, "bad_password"], ["password", true, null]]);
    expect(rows[0]).toMatchObject({ identifier: username, client: "web", userAgent: "vitest-ua" });
    const [u] = await db.select().from(users).where(eq(users.id, user.id));
    expect(u.loginCount).toBe(1); expect(u.lastLoginAt).toBeTruthy(); expect(u.lastLoginClient).toBe("web");
    const sess = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(sess).toHaveLength(2); // the registration session and this one
    await call("POST", "/auth/logout", { token: again.token });
    const [closed] = await db.select().from(sessions).where(and(eq(sessions.userId, user.id), sql`${sessions.revokedAt} is not null`));
    expect(closed.revokeReason).toBe("logout");
    void token;
  });

  it("records staff password sign-ins: unknown user, wrong password, success — never the password", async () => {
    const admin = await mkAdmin();
    const e = admin.email!;
    expect((await call("POST", "/auth/staff/login", { body: { email: "nobody@t.test", password: "x" } })).status).toBe(401);
    expect((await call("POST", "/auth/staff/login", { body: { email: e, password: "wrong-wrong" } })).status).toBe(401);
    const ok = await call("POST", "/auth/staff/login", { body: { email: e, password: "Password123" }, headers: { "user-agent": "ua-2" } });
    expect(ok.status).toBe(200);
    const rows = await db.select().from(loginEvents).orderBy(asc(loginEvents.createdAt));
    expect(rows.map((r) => [r.method, r.success, r.failureReason])).toEqual([["password", false, "unknown_user"], ["password", false, "bad_password"], ["password", true, null]]);
    expect(rows[1].userId).toBe(admin.id); expect(rows[0].userId).toBeNull(); expect(rows[2].userAgent).toBe("ua-2");
    expect(JSON.stringify(rows)).not.toContain("Password123");
    const [u] = await db.select().from(users).where(eq(users.id, admin.id));
    expect(u.loginCount).toBe(1); expect(u.failedLogins).toBe(0); // the successful sign-in cleared the failed-attempt counter (existing behaviour)
  });

  it("stamps last_seen_at at most once per five minutes and revoke reasons are kept", async () => {
    const d = await mkDriver();
    const { token } = await createSession(d.id, "web");
    expect(await call("GET", "/auth/me", { token })).toMatchObject({ status: 200 });
    const [a] = await db.select().from(users).where(eq(users.id, d.id));
    expect(a.lastSeenAt).toBeTruthy();
    await call("GET", "/auth/me", { token });
    const [b] = await db.select().from(users).where(eq(users.id, d.id));
    expect(b.lastSeenAt!.getTime()).toBe(a.lastSeenAt!.getTime()); // throttled
    await db.update(sessions).set({ lastSeenAt: new Date(Date.now() - 6 * 60_000) }).where(eq(sessions.userId, d.id));
    await call("GET", "/auth/me", { token });
    const [c] = await db.select().from(users).where(eq(users.id, d.id));
    expect(c.lastSeenAt!.getTime()).toBeGreaterThan(a.lastSeenAt!.getTime());
    const staff = await mkStaff(["users.edit", "users.view"]); const admin = await mkAdmin();
    await createSession(staff.id, "web");
    await updateStaff(admin, staff.id, { permissions: ["users.view"] });
    const ended = await db.select().from(sessions).where(eq(sessions.userId, staff.id));
    expect(ended.map((x) => x.revokeReason)).toEqual(["permissions_changed"]);
    await resetStaffPassword(admin, staff.id, "Another-Pass-2026!");
    await updateStaff(admin, staff.id, { status: "suspended" }).catch(() => null);
    expect((await db.select().from(sessions).where(eq(sessions.userId, staff.id))).every((x) => x.revokedAt && x.revokeReason)).toBe(true);
  });
});

describe("driver location + availability", () => {
  it("keeps at most one location row per driver per 60 s and attaches the current job", async () => {
    const { d, off } = await ready(1);
    const t = (await createSession(d.id, "mobile")).token;
    await db.update((await import("@/db/schema")).driverProfiles).set({ availability: "available" }).where(eq((await import("@/db/schema")).driverProfiles.userId, d.id));
    for (let i = 0; i < 4; i++) expect((await call("POST", "/driver/location", { token: t, body: { lat: 24.7 + i / 1000, lng: 46.7, accuracyM: 12, speedMps: 5.5, heading: 90 } })).status).toBe(200);
    let rows = await db.select().from(driverLocationHistory).where(eq(driverLocationHistory.driverId, d.id));
    expect(rows).toHaveLength(1); // three more pings inside the minute were dropped (the live position still updates)
    expect(rows[0]).toMatchObject({ accuracyM: 12, speedMps: 5.5, heading: 90, offerId: off.id });
    await db.update(driverLocationHistory).set({ recordedAt: new Date(Date.now() - 61_000) });
    await call("POST", "/driver/location", { token: t, body: { lat: 24.8, lng: 46.7 } });
    rows = await db.select().from(driverLocationHistory).where(eq(driverLocationHistory.driverId, d.id)).orderBy(asc(driverLocationHistory.recordedAt));
    expect(rows).toHaveLength(2);
    expect(rows[1].recordedAt.getTime() - rows[0].recordedAt.getTime()).toBeGreaterThanOrEqual(60_000);
  });

  it("logs availability changes with who caused them (driver toggle, cancel strikes → system)", async () => {
    const d = await mkDriver({ available: false });
    const t = (await createSession(d.id, "mobile")).token;
    await call("PUT", "/driver/availability", { token: t, body: { available: true } });
    await call("PUT", "/driver/availability", { token: t, body: { available: true } }); // no change → no row
    await call("PUT", "/driver/availability", { token: t, body: { available: false } });
    const rows = await db.select().from(driverAvailabilityLog).where(eq(driverAvailabilityLog.driverId, d.id)).orderBy(asc(driverAvailabilityLog.at));
    expect(rows.map((r) => [r.fromStatus, r.toStatus, r.source, r.reason])).toEqual([["unavailable", "available", "driver", "manual"], ["available", "unavailable", "driver", "manual"]]);
  });
});

describe("parcel journey (shipment_events)", () => {
  it("a delivered parcel: created → assigned → loaded → route_positioned → arrived → otp_verified → delivered", async () => {
    const { biz, d, off, r } = await ready(2);
    await work(biz, d, off.id);
    const parcels = await db.select().from(shipments).where(eq(shipments.requestId, r.id)).orderBy(asc(shipments.seq));
    const first = await journey(parcels[0].id);
    expect(first[0]).toBe("created");
    for (const t of ["assigned", "loaded", "arrived", "otp_verified", "delivered"]) expect(first, t).toContain(t);
    expect(first.indexOf("assigned")).toBeLessThan(first.indexOf("loaded"));
    expect(first.indexOf("arrived")).toBeLessThan(first.indexOf("delivered"));
    const [del] = await db.select().from(shipmentEvents).where(and(eq(shipmentEvents.shipmentId, parcels[0].id), eq(shipmentEvents.type, "delivered")));
    expect(del).toMatchObject({ actorId: d.id, actorRole: "driver", offerId: off.id });
    expect(del.payload).toMatchObject({ proofType: "otp" });
    const [loaded] = await db.select().from(shipmentEvents).where(and(eq(shipmentEvents.shipmentId, parcels[0].id), eq(shipmentEvents.type, "loaded")));
    expect(loaded.payload).toMatchObject({ via: "warehouse" }); expect(loaded.actorId).toBe(biz.id);
  });

  it("a refused + returned parcel: failed (with reason) → returned; COD parcels also log cod_collected", async () => {
    const { biz, d, off, r } = await ready(2);
    await work(biz, d, off.id, 1); // first delivered, second refused then handed back
    const parcels = await db.select().from(shipments).where(eq(shipments.requestId, r.id)).orderBy(asc(shipments.seq));
    const second = await journey(parcels[1].id);
    expect(second).toEqual(expect.arrayContaining(["created", "assigned", "loaded", "arrived", "failed", "returned"]));
    const [f] = await db.select().from(shipmentEvents).where(and(eq(shipmentEvents.shipmentId, parcels[1].id), eq(shipmentEvents.type, "failed")));
    expect(f.payload).toMatchObject({ reason: "refused" });
  });

  it("deferring a stop, a scan-loaded parcel and an unassigned one are captured; a cancelled request closes its parcels", async () => {
    const { admin, biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz, { shipments: mkShipments(3, { withRefs: true }), shipmentsPerDriver: 3 });
    const off = await offerOf(r.id, d.id);
    await jobs.acceptOffer(d, off.id, true); await jobs.confirmAttendance(biz, off.id, true);
    await jobs.recordLoading(biz, off.id, undefined, { codes: [`${r.ref}-001`] }); // only parcel 1 handed over: 2 and 3 go back to the pool
    const parcels = await db.select().from(shipments).where(eq(shipments.requestId, r.id)).orderBy(asc(shipments.seq));
    expect(await journey(parcels[1].id)).toContain("unassigned");
    await cancelRequest(admin, r.id, "ops cancelled the job");
    const ev = await db.select().from(shipmentEvents).where(and(eq(shipmentEvents.requestId, r.id), eq(shipmentEvents.type, "cancelled")));
    expect(ev.map((e) => e.shipmentId).sort()).toEqual([parcels[1].id, parcels[2].id].sort()); // the two parcels that never left the warehouse
    expect(ev[0]).toMatchObject({ actorId: admin.id, actorRole: "admin" }); expect(ev[0].payload).toMatchObject({ reason: "request_cancelled" });
    expect(await journey(parcels[0].id)).toContain("failed"); // the parcel already on the vehicle must come back
  });

  it("a failing capture statement never breaks the action (savepoint): the surrounding transaction keeps working", async () => {
    const { r } = await ready(1);
    const [s] = await db.select().from(shipments).where(eq(shipments.requestId, r.id));
    await db.transaction(async (tx) => {
      // an unknown shipment id violates the foreign key: the capture is swallowed and the surrounding transaction stays usable
      await logEvent(tx, { requestId: r.id, type: "shipment_updated", payload: { shipmentId: "00000000-0000-4000-8000-000000000000", code: "x" } });
      await logEvent(tx, { requestId: r.id, type: "shipment_updated", payload: { shipmentId: s.id, code: s.code, note: "still fine" } });
    });
    const ev = await db.select().from(shipmentEvents).where(and(eq(shipmentEvents.shipmentId, s.id), eq(shipmentEvents.type, "edited")));
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ note: "still fine" });
  });
});

describe("message log", () => {
  it("logs the recipient's delivery code with a masked recipient and no message text", async () => {
    const sent: string[] = []; setSmsProvider({ name: "stub", async send(p, t) { sent.push(`${p}|${t}`); } });
    try {
      const { biz, d, off, r } = await ready(2);
      await jobs.recordLoading(biz, off.id, undefined, { all: true }); await jobs.acknowledgeLoading(d, off.id, true); await stops.approveRoute(d, off.id);
      const rows = await db.select().from(messageLog).where(eq(messageLog.channel, "sms")).orderBy(asc(messageLog.createdAt));
      expect(rows.some((m) => m.type === "otp")).toBe(false); // nobody signs in with a code any more
      const code = rows.find((m) => m.type === "recipient_code")!;
      expect(code).toMatchObject({ status: "sent", requestId: r.id, direction: "out" });
      expect(code.shipmentId).toBeTruthy();
      expect(JSON.stringify(rows)).not.toMatch(/\+9665\d{8}/); expect(JSON.stringify(rows)).not.toContain("JR Logistics:");
      expect(sent.length).toBeGreaterThanOrEqual(1);
      // a provider outage is recorded as failed, with the reason
      setSmsProvider({ name: "down", async send() { throw new Error("gateway timeout"); } });
      const { biz: biz2, d: d2, off: off2 } = await ready(1);
      await jobs.recordLoading(biz2, off2.id, undefined, { all: true }); await jobs.acknowledgeLoading(d2, off2.id, true); await stops.approveRoute(d2, off2.id);
      const failed = await db.select().from(messageLog).where(and(eq(messageLog.channel, "sms"), eq(messageLog.status, "failed")));
      expect(failed.map((m) => m.error)).toContain("gateway timeout");
    } finally { setSmsProvider(null); }
  });

  it("logs outbound webhooks as queued and the maintenance tick syncs their final status", async () => {
    const { biz, d, off } = await ready(1);
    await db.update(businessProfiles).set({ webhookUrl: "https://hooks.example.com/jr/secret-path?k=1", webhookSecret: "whsec_x" }).where(eq(businessProfiles.userId, biz.id));
    await jobs.recordLoading(biz, off.id, undefined, { all: true }); await jobs.acknowledgeLoading(d, off.id, true); await stops.approveRoute(d, off.id);
    const s = await currentStopOf(db, off.id); await stops.arriveAtStop(d, off.id, s!.id); await stops.deliverStop(d, off.id, s!.id, { code: s!.code, otp: otpFor(s!) });
    const rows = await db.select().from(messageLog).where(eq(messageLog.channel, "webhook"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((m) => m.recipient === "hooks.example.com" && m.status === "queued" && m.providerRef)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("secret-path");
    const first = (await db.select().from(webhookDeliveries).orderBy(asc(webhookDeliveries.createdAt)))[0];
    await db.update(webhookDeliveries).set({ status: "delivered", deliveredAt: new Date(), attempts: 1, lastStatusCode: 200 }).where(eq(webhookDeliveries.id, first.id));
    expect(await syncWebhookMessages()).toBe(1);
    const after = await db.select().from(messageLog).where(eq(messageLog.providerRef, first.id));
    expect(after[0]).toMatchObject({ status: "delivered", attempts: 1 });
    expect(maskPhone("+966501234567")).toBe("••••4567"); expect(hostOf("https://a.b/c?d=1")).toBe("a.b"); expect(hostOf("nope")).toBeNull();
  });
});

describe("request milestones + first response", () => {
  it("stamps first offer, first acceptance, filled, started and last activity", async () => {
    const { biz, d, off, r } = await ready(2);
    let [row] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(row.firstOfferAt).toBeTruthy(); expect(row.firstAcceptedAt).toBeTruthy(); expect(row.filledAt).toBeTruthy();
    expect(row.startedAt).toBeNull();
    expect(row.firstOfferAt!.getTime()).toBeLessThanOrEqual(row.firstAcceptedAt!.getTime());
    await jobs.recordLoading(biz, off.id, undefined, { all: true }); await jobs.acknowledgeLoading(d, off.id, true);
    const before = (await db.select().from(requests).where(eq(requests.id, r.id)))[0].lastActivityAt!;
    await stops.approveRoute(d, off.id);
    [row] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(row.startedAt).toBeTruthy(); expect(row.lastActivityAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("reconcile fills milestones that live capture missed, idempotently", async () => {
    const { r } = await ready(1);
    await db.update(requests).set({ firstOfferAt: null, firstAcceptedAt: null, filledAt: null, lastActivityAt: null }).where(eq(requests.id, r.id));
    expect(await reconcileMilestones()).toBeGreaterThanOrEqual(3);
    const [row] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(row.firstOfferAt && row.firstAcceptedAt && row.filledAt && row.lastActivityAt).toBeTruthy();
    expect(await reconcileMilestones()).toBe(0);
  });

  it("ticket first response = first public staff reply (not an internal note); reopen count; complaint = first staff action", async () => {
    const { biz } = await setup(); const staff = await mkStaff(["tickets.view", "tickets.manage", "complaints.manage", "users.view"]);
    const t = await createTicket(biz, { category: "other", subject: "Help", body: "please" });
    expect((await db.select().from(tickets).where(eq(tickets.id, t.id)))[0].firstResponseAt).toBeNull();
    await replyTicket(staff, t.id, "internal only", true);
    expect((await db.select().from(tickets).where(eq(tickets.id, t.id)))[0].firstResponseAt).toBeNull();
    await replyTicket(staff, t.id, "Hello, on it");
    let [row] = await db.select().from(tickets).where(eq(tickets.id, t.id));
    expect(row.firstResponseAt).toBeTruthy(); expect(row.firstResponseBy).toBe(staff.id);
    const stamp = row.firstResponseAt!.getTime();
    await resolveTicket(staff, t.id); await reopenTicket(biz, t.id, "still broken");
    await staffUpdateTicket(staff, t.id, { status: "resolved" }); await staffUpdateTicket(staff, t.id, { status: "open" });
    [row] = await db.select().from(tickets).where(eq(tickets.id, t.id));
    expect(row.firstResponseAt!.getTime()).toBe(stamp); expect(row.reopenCount).toBe(2);
    const c = await fileComplaint(biz, { category: "delay", description: "late late late" });
    expect((await db.select().from(complaints).where(eq(complaints.id, c.id)))[0].firstResponseAt).toBeNull();
    await updateComplaint(staff, c.id, { assignToMe: true });
    const [cr] = await db.select().from(complaints).where(eq(complaints.id, c.id));
    expect(cr.firstResponseAt).toBeTruthy(); expect(cr.firstResponseBy).toBe(staff.id);
  });
});

describe("snapshots + retention", () => {
  it("writes hourly and daily snapshots idempotently (platform + per city) with every key present", async () => {
    const { biz } = await setup(); await mkDriver(); await mkDriver({ available: false }); await publishedRequest(biz, { shipments: mkShipments(3), shipmentsPerDriver: 3 });
    const now = new Date("2026-11-19T10:20:00Z");
    expect(await takeHourlySnapshot(now)).toBeGreaterThanOrEqual(2); // platform + riyadh
    expect(await takeHourlySnapshot(now)).toBe(0); // same hour: nothing new
    await takeDailySnapshot(now); await takeDailySnapshot(now);
    const hour = await db.select().from(metricSnapshots).where(eq(metricSnapshots.scope, "hour"));
    const plat = hour.find((h) => h.city === null)!, riy = hour.find((h) => h.city === "riyadh")!;
    expect(plat.at.toISOString()).toBe("2026-11-19T10:00:00.000Z");
    expect(plat.metrics).toMatchObject({ requests_open: 1, slots_unfilled: 1, parcels_pending: 3, drivers_available: 1, drivers_busy: 0 });
    expect(riy.metrics).toMatchObject({ requests_open: 1, parcels_pending: 3 });
    const day = await db.select().from(metricSnapshots).where(eq(metricSnapshots.scope, "day"));
    expect(day.filter((x) => x.city === null)).toHaveLength(1); // refreshed, never duplicated
    expect(day.find((x) => x.city === null)!.at.toISOString()).toBe("2026-11-18T21:00:00.000Z"); // start of the Riyadh day
    expect(day.find((x) => x.city === null)!.metrics).toMatchObject({ companies_active: 1, drivers_active: 2, wallet_escrow_cents: 3000, cash_with_drivers_cents: 0 });
    expect(Object.keys(plat.metrics).sort()).toEqual(["drivers_available", "drivers_busy", "offers_pending", "parcels_in_transit", "parcels_pending", "requests_in_progress", "requests_open", "slots_unfilled"]);
    expect(hourStart(now).toISOString()).toBe("2026-11-19T10:00:00.000Z"); expect(riyadhDayStart(new Date("2026-11-19T22:00:00Z")).toISOString()).toBe("2026-11-19T21:00:00.000Z");
    expect(foldByCity([{ city: "a", n: 1 }, { city: null, n: 2 }, { city: "a", n: 3 }]).get("")).toEqual({ n: 6 });
  });

  it("the maintenance tick takes the snapshot once per hour and prunes old capture data", async () => {
    const d = await mkDriver();
    await db.insert(driverLocationHistory).values([{ driverId: d.id, lat: 1, lng: 1, recordedAt: new Date(Date.now() - 91 * 864e5) }, { driverId: d.id, lat: 1, lng: 1, recordedAt: new Date(Date.now() - 89 * 864e5) }]);
    await db.insert(loginEvents).values([{ method: "otp", success: true, createdAt: new Date(Date.now() - 401 * 864e5) }, { method: "otp", success: true }]);
    await db.insert(messageLog).values([{ channel: "sms", type: "otp", status: "sent", createdAt: new Date(Date.now() - 401 * 864e5) }, { channel: "sms", type: "otp", status: "sent" }]);
    const first = await runMaintenance();
    expect(first.capture).toMatchObject({ hourly: true, daily: true, pruned: { locations: 1, logins: 1, messages: 1 } });
    const second = await runMaintenance();
    expect(second.capture).toMatchObject({ hourly: false, daily: false, pruned: null });
    expect(await db.select().from(driverLocationHistory)).toHaveLength(1);
    expect(await db.select().from(metricSnapshots).where(eq(metricSnapshots.scope, "hour"))).not.toHaveLength(0);
    expect(await pruneCaptureData()).toEqual({ locations: 0, logins: 0, messages: 0, notifications: 0 });
    void runCaptureTick; void desc; void staffLogin;
  });
});
