/**
 * A3 audit — probes for state-machine / concurrency / housekeeping defects found while auditing the order, job and field-ops lifecycle.
 * Each test states the DESIRED behaviour; the finding number refers to memory/audit/lifecycle.md.
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, shipments, driverProfiles, jobEvents, notifications } from "@/db/schema";
import { shutdown, resetDb, mkAdmin, mkBusiness, mkDriver, mkRule, publishedRequest, mkShipments, mkStaff } from "../helpers/factories";
import { setFieldModes } from "../helpers/field-modes";
import { call, offerRow, parcelsOf, requestRow, tok, worldAt, WAREHOUSE } from "../helpers/lifecycle-world";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { otpFor } from "@/server/shipments";
import { runMaintenance } from "@/server/maintenance";
import { setSmsProvider } from "@/server/auth/otp";
import { cancelRequest } from "@/server/requests";
import { moneyViolations } from "../helpers/invariants";

afterAll(shutdown);
afterEach(() => setSmsProvider(null));

describe("F1 — a loading answer after the route has started", () => {
  for (const routing of [false, true]) {
    it(`routing ${routing ? "ON" : "OFF"}: loading-ack (dispute or confirm) is refused once loading was answered; the driver's action list is never degraded`, async () => {
      await resetDb(); await setFieldModes({ routing });
      const w = await worldAt("att_working", { n: 3 });
      const t = await tok(w.driver);
      const dispute = await call("POST", `/offers/${w.offerId}/loading-ack`, { token: t, body: { ok: false, note: "changed my mind" } });
      expect(dispute.status).toBe(409);
      const o = await offerRow(w.offerId);
      expect(o.loadedAckByDriver).toBe(true);
      const view = await call("GET", `/driver/jobs/${w.offerId}`, { token: t });
      expect(view.json.actions).toEqual(["work_stops", "end_route"]);
      // an exact repeat of the answer already given is a harmless replay
      const again = await call("POST", `/offers/${w.offerId}/loading-ack`, { token: t, body: { ok: true } });
      expect(again.status).toBe(200);
      const tickets = await db.execute(sql`select count(*)::int n from tickets where category = 'shipment_count_differs'`);
      expect((tickets.rows[0] as { n: number }).n).toBe(0);
    });
  }
});

describe("F2 — recipient code resend cannot be used to brute-force the 4-digit code when the SMS does not go out", () => {
  it("resend is counted when it is REQUESTED (not only when the SMS was delivered): after 3 the stop refuses further resends", async () => {
    await resetDb(); await setFieldModes({ routing: true });
    setSmsProvider({ name: "down", send: async () => { throw new Error("provider outage"); } }); // the SMS never goes out
    const w = await worldAt("att_working", { n: 3 });
    const [s] = await parcelsOf(w.offerId);
    const t = await tok(w.driver);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await call("POST", `/offers/${w.offerId}/stops/${s.id}/resend-code`, { token: t })).status);
    expect(codes.slice(0, 3).every((c) => c === 200)).toBe(true);
    expect(codes.slice(3).every((c) => c === 429)).toBe(true);
    const [row] = await db.select().from(shipments).where(eq(shipments.id, s.id));
    expect(row.otpVersion).toBeLessThanOrEqual(4); // 1 + at most 3 resends
  });
});

describe("F3 — one bad row never stops the housekeeping tick", () => {
  it("a request whose release fails is skipped (logged); the other lapsed request is still expired and refunded", async () => {
    await resetDb();
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 });
    const bad = await publishedRequest(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2 });
    const good = await publishedRequest(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2, startsAt: new Date(Date.now() + 2 * 864e5) });
    await db.update(requests).set({ startsAt: new Date(Date.now() - 3600_000) }).where(sql`id in (${bad.id}, ${good.id})`);
    // the first request can no longer be released: its escrow claims more than the wallet holds → the ledger constraint raises
    await db.update(requests).set({ reservedCents: 99_999_999 }).where(eq(requests.id, bad.id));
    const out = await runMaintenance();
    expect((await requestRow(good.id)).status).toBe("expired");
    expect((await requestRow(bad.id)).status).toBe("published"); // left alone, retried next tick
    expect(out.expiredRequests).toBe(1);
    expect(out).toHaveProperty("errors");
  });
});

describe("F4 — a driver can never hold two active jobs (E11), even when both accepts race", () => {
  it("two offers of one driver accepted at the same instant: exactly one wins", async () => {
    await resetDb();
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 }); const d = await mkDriver();
    const r1 = await publishedRequest(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2 });
    const r2 = await publishedRequest(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2, startsAt: new Date(Date.now() + 5 * 864e5) });
    const o1 = (await db.select().from(offers).where(eq(offers.requestId, r1.id)))[0], o2 = (await db.select().from(offers).where(eq(offers.requestId, r2.id)))[0];
    const res = await Promise.allSettled([jobs.acceptOffer(d, o1.id, true), jobs.acceptOffer(d, o2.id, true)]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const rej = res.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(rej.reason).toMatchObject({ code: "OVERLAPPING_JOB" });
    const active = await db.select().from(offers).where(and(eq(offers.driverId, d.id), eq(offers.status, "accepted")));
    expect(active).toHaveLength(1);
  });
});

describe("F5 — parcels handed to a driver that never completes come back, and can be received back", () => {
  it("a request cancelled by ops after the driver loaded: the parcels are failed(request_cancelled) and the warehouse CAN receive them back", async () => {
    await resetDb(); await setFieldModes({ routing: true });
    const w = await worldAt("att_working", { n: 3 });
    const admin = w.admin;
    await cancelRequest(admin, w.requestId, "ops cancelled");
    const ps = await db.select().from(shipments).where(eq(shipments.requestId, w.requestId));
    expect(ps.every((p) => p.status === "failed" && p.failReason === "request_cancelled")).toBe(true);
    const tb = await tok(w.biz);
    const res = await call("POST", `/offers/${w.offerId}/returns`, { token: tb, body: { all: true } });
    expect(res.status, res.text).toBe(200);
    expect(res.json.returned).toBe(3);
    expect((await moneyViolations())).toEqual([]);
  });
});

describe("F6 — a partly staffed request whose only driver already finished does not hang", () => {
  it("after the grace period the request closes and completes by itself (escrow of the empty slots returns)", async () => {
    await resetDb(); await setFieldModes({ routing: true });
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 }); const d = await mkDriver();
    const r = await publishedRequest(biz, { shipments: mkShipments(4), shipmentsPerDriver: 2 }); // two drivers needed, one shows up
    const off = (await db.select().from(offers).where(and(eq(offers.requestId, r.id), eq(offers.driverId, d.id))))[0];
    await jobs.acceptOffer(d, off.id, true);
    await db.update(requests).set({ startsAt: new Date(Date.now() + 3600_000) }).where(eq(requests.id, r.id));
    await jobs.checkIn(d, off.id, WAREHOUSE); await jobs.confirmAttendance(biz, off.id, true);
    const { work } = await import("../helpers/work");
    await work(biz, d, off.id);
    expect((await offerRow(off.id)).status).toBe("completed");
    await db.update(requests).set({ startsAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(requests.id, r.id));
    await runMaintenance();
    const after = await requestRow(r.id);
    expect(after.status).toBe("completed");
    expect(after.reservedCents).toBe(0);
    expect(await moneyViolations()).toEqual([]);
  });
});

describe("F7 — a parcel sent back to the pool starts afresh", () => {
  it("ops replaces a driver who had arrived at a stop: the next driver cannot deliver it without arriving, and its code counters are reset", async () => {
    await resetDb(); await setFieldModes({ routing: true });
    const w = await worldAt("att_working", { n: 3 });
    const [first] = await parcelsOf(w.offerId);
    await stops.arriveAtStop(w.driver, w.offerId, first.id);
    await stops.deliverStop(w.driver, w.offerId, first.id, { code: first.code, otp: "0000" }).catch(() => {}); // a wrong code counts an attempt
    await jobs.staffReplace(w.admin, w.offerId, "ops replaces the driver");
    const [row] = await db.select().from(shipments).where(eq(shipments.id, first.id));
    expect(row.status).toBe("pending"); expect(row.offerId).toBeNull();
    expect(row.arrivedAt).toBeNull(); expect(row.deferCount).toBe(0); expect(row.otpAttempts).toBe(0);
  });
});

describe("F8 — ops cannot cancel a request out from under a driver who already delivered parcels", () => {
  it("the cancel is refused (end the route instead); ending the route pays the delivered stop and refunds the rest, books balance", async () => {
    await resetDb(); await setFieldModes({ routing: true });
    const w = await worldAt("att_working", { n: 3 });
    const [s1] = await parcelsOf(w.offerId);
    await stops.arriveAtStop(w.driver, w.offerId, s1.id);
    await stops.deliverStop(w.driver, w.offerId, s1.id, { code: s1.code, otp: otpFor(s1) });
    await expect(cancelRequest(w.admin, w.requestId, "ops cancelled mid-route")).rejects.toMatchObject({ code: "INVALID_TRANSITION", details: { deliveredParcels: 1 } });
    expect((await requestRow(w.requestId)).status).not.toBe("cancelled");
    await stops.endRoute(w.admin, w.offerId, "ops ends the route");
    expect((await offerRow(w.offerId)).status).toBe("completed");
    const wallet = await db.execute(sql`select available_cents::int a from wallet_accounts where owner_id = ${w.driver.id}`);
    expect((wallet.rows[0] as { a: number }).a).toBe(700); // one delivered parcel × SAR 7.00 provider cost
    expect(await moneyViolations()).toEqual([]);
  });
});

describe("F9 — re-shipping twice does not duplicate the undelivered parcels", () => {
  it("a second re-ship of the same parcels returns the draft already created", async () => {
    await resetDb(); await setFieldModes({ routing: true });
    const w = await worldAt("completed", { n: 3 }); // the last parcel was refused at the door
    const tb = await tok(w.biz);
    const a = await call("POST", `/requests/${w.requestId}/reship`, { token: tb, body: {} });
    const b = await call("POST", `/requests/${w.requestId}/reship`, { token: tb, body: {} });
    expect(a.status).toBe(201);
    expect([201, 200]).toContain(b.status);
    expect(b.json.id).toBe(a.json.id);
    const drafts = await db.select().from(requests).where(and(eq(requests.businessId, w.biz.id), eq(requests.status, "draft")));
    expect(drafts).toHaveLength(1);
  });
});

describe("F10 — a job where every stop failed still completes cleanly", () => {
  for (const routing of [false, true]) {
    it(`routing ${routing ? "ON" : "OFF"}: all parcels refused → job and request complete, nothing is billed, the whole escrow comes back, no negative or stray money`, async () => {
      await resetDb(); await setFieldModes({ routing });
      const w = await worldAt("att_working", { n: 3 });
      for (const p of await parcelsOf(w.offerId)) {
        const cur = (await parcelsOf(w.offerId)).find((x) => x.status === "loaded")!;
        await stops.arriveAtStop(w.driver, w.offerId, cur.id);
        await stops.failStop(w.driver, w.offerId, cur.id, { reason: "refused" });
        void p;
      }
      const done = await jobs.reportDelivered(w.driver, w.offerId);
      expect(done.status).toBe("completed");
      expect((await requestRow(w.requestId)).status).toBe("completed");
      expect((await requestRow(w.requestId)).reservedCents).toBe(0);
      const wallet = await db.execute(sql`select available_cents::int a from wallet_accounts where owner_id = ${w.biz.id}`);
      expect((wallet.rows[0] as { a: number }).a).toBe(5000_00); // the business paid nothing
      expect(await moneyViolations()).toEqual([]);
    });
  }
});

describe("F11 — what a driver sees before the job starts (routing OFF is decision J2; this pins it)", () => {
  it("routing OFF: after accepting, every stop shows name + phone; routing ON: only addresses until the route is approved", async () => {
    for (const routing of [false, true]) {
      await resetDb(); await setFieldModes({ routing });
      const w = await worldAt("accepted", { n: 3 });
      const v = (await call("GET", `/driver/jobs/${w.offerId}`, { token: await tok(w.driver) })).json;
      const named = (v.stops ?? []).filter((x: { recipientPhone: string | null }) => x.recipientPhone).length;
      expect(named).toBe(routing ? 0 : 3);
    }
  });
});

describe("F12 — the attendance.edit permission works (it was shown in the roles matrix but ignored by the server)", () => {
  it("a staff member with only attendance.edit confirms attendance and sees just those actions; one with only requests.view cannot", async () => {
    await resetDb(); await setFieldModes({ routing: true });
    const w = await worldAt("accepted", { n: 3 });
    const clerk = await mkStaff(["requests.view", "attendance.edit"]), viewer = await mkStaff(["requests.view"]);
    const view = await call("GET", `/requests/${w.requestId}`, { token: await tok(clerk) });
    expect(view.json.offers.find((o: { id: string }) => o.id === w.offerId).actions).toEqual(["confirm_attendance", "mark_no_show"]);
    expect((await call("POST", `/requests/${w.requestId}/cancel`, { token: await tok(clerk), body: { reason: "not allowed for him" } })).status).toBe(404);
    expect((await call("POST", `/offers/${w.offerId}/attendance`, { token: await tok(viewer), body: { present: true } })).status).toBe(404);
    const ok = await call("POST", `/offers/${w.offerId}/attendance`, { token: await tok(clerk), body: { present: true } });
    expect(ok.status, ok.text).toBe(200);
    expect((await offerRow(w.offerId)).status).toBe("attendance_confirmed");
  });
});

describe("F13 — every notification written by the real flows carries what its text needs", () => {
  it("offers (system dispatch, manual assignment, vehicle-day service), job events and cancellations: no placeholder of notif.<type> is left without a value", async () => {
    const { dictionaries } = await import("@/i18n/dictionaries");
    const { translate } = await import("@/i18n/core");
    const { placeholdersOf, notificationText } = await import("@/lib/notif-text");
    const { reqInput, mkRule: rule, publishedRequest: publish } = await import("../helpers/factories");
    const t = (k: string, v?: Record<string, string | number>) => translate(dictionaries.en, dictionaries.en, k, v);
    const all: Array<typeof notifications.$inferSelect> = [];
    for (const state of ["completed", "cancelled", "no_show", "replaced", "request_cancelled"] as const) { await resetDb(); await setFieldModes({ routing: true }); await worldAt(state, { n: 3 }); all.push(...(await db.select().from(notifications))); }
    await resetDb(); await setFieldModes({ routing: true });
    const admin = await mkAdmin(); await rule(admin);
    await rule(admin, { service: "car_with_driver", vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", priceCents: 30000, providerCostCents: 20000 });
    const biz = await mkBusiness({ fundsCents: 9000_00 });
    const first = await publish(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2 }); // nobody to offer it to yet
    const late = await (await import("../helpers/factories")).mkDriver();
    await jobs.assignDriver(admin, first.id, late.id, "manual", "ops picked him"); // the call that used to send {ref} only
    const car = await publish(biz, { service: "car_with_driver", quantity: 1, vehicleType: "sedan", durationDays: 2, shipments: null, shipmentsPerDriver: null });
    void car; void reqInput;
    const rows = await db.select().from(notifications); all.push(...rows);
    const bad: string[] = []; const types = new Set<string>();
    for (const n of all) {
      types.add(n.type);
      const tpl = dictionaries.en[`notif.${n.type}`];
      if (tpl === undefined) { bad.push(`${n.type}: no text`); continue; }
      const data = (n.data ?? {}) as Record<string, unknown>;
      const have = new Set(Object.entries(data).filter(([, v]) => v != null && typeof v !== "object" && String(v) !== "").map(([k]) => k));
      if (typeof data.amountCents === "number") have.add("amount");
      const miss = placeholdersOf(tpl).filter((p) => !have.has(p));
      const short = dictionaries.en[`notif.${n.type}__short`];
      if (miss.length && !(short !== undefined && placeholdersOf(short).every((p) => have.has(p)))) bad.push(`${n.type}: missing ${miss.join(",")} in ${JSON.stringify(data)}`);
      expect(notificationText(t, n)).not.toMatch(/[{}]/);
    }
    expect(bad).toEqual([]);
    expect(types.has("offer_new")).toBe(true);
    // the vehicle-day offer has no parcel count: it renders with the short variant, cities localized
    const carOffer = rows.filter((n) => n.type === "offer_new").find((n) => !("parcels" in ((n.data ?? {}) as object)));
    expect(carOffer).toBeTruthy();
    expect(notificationText(t, carOffer!)).toMatch(/^New job offer JR-\d+: Riyadh → Riyadh$/);
    // the manual assignment now carries parcels + cities + earning like every other offer
    const manual = rows.find((n) => n.type === "offer_new" && n.userId === late.id && (n.data as { requestId: string }).requestId === first.id)!;
    expect(manual.data).toMatchObject({ parcels: 2, pickupCity: "riyadh", deliveryCity: "riyadh", earningCents: 1400 });
    expect(types.size).toBeGreaterThan(12); // the flows really produced a variety of notification types
  });
});

void jobEvents; void notifications; void driverProfiles; void mkStaff;
