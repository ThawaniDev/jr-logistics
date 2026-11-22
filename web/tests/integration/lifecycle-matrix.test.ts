/**
 * A3 audit — the offer / request state machines driven through the real HTTP layer: EVERY driver and business action × EVERY state.
 * An action that does not belong to a state must be refused with a 4xx (never a 5xx) and must change NOTHING (rows, ledger, events, notifications).
 * Run once with routing OFF (the platform default) and once with routing ON.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { shutdown, resetDb, mkAdmin, mkBusiness, mkDriver, mkRule, mkShipments, mkStaff } from "../helpers/factories";
import { setFieldModes } from "../helpers/field-modes";
import { OFFER_STATES, allParcels, call, parcelsOf, requestRow, snapshot, tok, worldAt, WAREHOUSE, type OfferState, type World } from "../helpers/lifecycle-world";
import { clearSettingsCache } from "@/server/settings";

afterAll(shutdown);

type Req = { method: string; path: string; body?: unknown; form?: FormData };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const photo = (kind: string) => { const f = new FormData(); f.append("file", new File([PNG], "p.png", { type: "image/png" })); f.append("kind", kind); return f; };

/** Every driver-side action, keyed by name; `sid` = a stop of the job. */
function driverActions(w: World, sid: string, code: string): Record<string, Req> {
  const o = `/offers/${w.offerId}`, s = `${o}/stops/${sid}`;
  return {
    accept: { method: "POST", path: `${o}/accept`, body: { termsAccepted: true } },
    reject: { method: "POST", path: `${o}/reject` },
    checkin: { method: "POST", path: `${o}/checkin`, body: WAREHOUSE },
    cancel: { method: "POST", path: `${o}/cancel`, body: { reason: "matrix test cancel" } },
    loading_ack_ok: { method: "POST", path: `${o}/loading-ack`, body: { ok: true } },
    loading_ack_dispute: { method: "POST", path: `${o}/loading-ack`, body: { ok: false, note: "count differs" } },
    delivered: { method: "POST", path: `${o}/delivered`, body: {} },
    approve_route: { method: "POST", path: `${o}/route/approve` },
    optimize: { method: "POST", path: `${o}/route/optimize`, body: {} },
    reorder: { method: "POST", path: `${o}/route/reorder`, body: { order: [sid] } },
    scan: { method: "POST", path: `${o}/loading/scan`, body: { code } },
    unscan: { method: "POST", path: `${o}/loading/unscan`, body: { code } },
    finish_loading: { method: "POST", path: `${o}/loading/finish`, body: {} },
    arrive: { method: "POST", path: `${s}/arrive`, body: {} },
    deliver: { method: "POST", path: `${s}/deliver`, body: { code, otp: "0000" } },
    fail: { method: "POST", path: `${s}/fail`, body: { reason: "refused" } },
    defer: { method: "POST", path: `${s}/defer`, body: { note: "closed for now" } },
    resend_code: { method: "POST", path: `${s}/resend-code` },
    media: { method: "POST", path: `${s}/media`, form: photo("fail") },
    proof: { method: "POST", path: `${s}/proof`, form: photo("receipt") },
    end_route: { method: "POST", path: `${o}/end-route`, body: { reason: "vehicle broke down" } },
    no_work: { method: "POST", path: `${o}/no-work`, body: { note: "nobody came" } },
    contact_exception: { method: "POST", path: `/driver/jobs/${w.offerId}/contact-exception`, body: { reason: "no_answer" } },
    whatsapp: { method: "GET", path: `/driver/jobs/${w.offerId}/whatsapp?shipmentId=${sid}` },
    rate: { method: "POST", path: `${o}/rate`, body: { stars: 5 } },
  };
}

/** Actions that BELONG to a state (they may still fail on validation / a sub-phase rule — those are covered by the dedicated suites). Everything else must be refused. */
const BELONGS: Record<OfferState, string[]> = {
  offered: ["accept", "reject"],
  accepted: ["checkin", "cancel", "contact_exception", "whatsapp"],
  arrived: ["cancel", "no_work", "contact_exception", "whatsapp"],
  att_empty: ["scan", "unscan", "finish_loading", "no_work", "contact_exception", "whatsapp"],
  att_scanned: ["scan", "unscan", "finish_loading", "no_work", "contact_exception", "whatsapp"],
  att_loaded: ["approve_route", "optimize", "reorder", "loading_ack_ok", "no_work", "contact_exception", "whatsapp"],
  att_working: ["approve_route", "optimize", "reorder", "loading_ack_ok", "arrive", "deliver", "fail", "defer", "resend_code", "media", "proof", "end_route", "no_work", "contact_exception", "whatsapp"],
  att_all_resolved: ["approve_route", "loading_ack_ok", "arrive", "deliver", "fail", "delivered", "end_route", "no_work", "contact_exception", "whatsapp", "optimize"], // arrive/deliver/fail: idempotent replays of finished stops; loading-ack ok: replay of the answer already given
  completed: ["rate"],
  cancelled: [], rejected: [], no_show: [], replaced: [], expired: [], request_cancelled: [],
};

for (const routing of [false, true]) {
  describe(`driver actions × offer states — routing ${routing ? "ON" : "OFF"}`, () => {
    beforeEach(async () => { await resetDb(); await setFieldModes({ routing }); });

    for (const state of OFFER_STATES) {
      it(`${state}: every action that does not belong is refused (4xx) and changes nothing`, async () => {
        const w = await worldAt(state, { n: 3 });
        const t = await tok(w.driver);
        const ps = await parcelsOf(w.offerId); const any = ps[0] ?? (await allParcels(w.requestId))[0];
        const sid = any.id, code = any.code;
        // routing OFF: loading the parcels starts the route by itself, so "loaded" and "working" are the same state
        const belongs = new Set(BELONGS[!routing && state === "att_loaded" ? "att_working" : state]);
        const acts = driverActions(w, sid, code);
        const refused: string[] = [];
        let fired = 0;
        for (const [name, rq] of Object.entries(acts)) {
          if (belongs.has(name)) continue;
          fired++;
          // routing OFF: ROUTING_DISABLED answers are the right refusal for the three route calls
          const before = await snapshot(w.requestId);
          const res = await call(rq.method, rq.path, { token: t, body: rq.body, form: rq.form });
          const after = await snapshot(w.requestId);
          if (res.status < 400 || res.status >= 500) refused.push(`${name}: ${res.status} ${res.text.slice(0, 160)}`);
          else if (before !== after) refused.push(`${name}: refused with ${res.status} but the database changed`);
        }
        expect(refused, `${state} (routing ${routing ? "on" : "off"})`).toEqual([]);
        expect(fired, "the matrix must really fire the non-belonging actions").toBe(Object.keys(acts).filter((a) => !belongs.has(a)).length);
        expect(fired).toBeGreaterThanOrEqual(8);
      });
    }
  });
}

describe("another driver acts on someone else's offer: always 404, nothing changes", () => {
  beforeEach(async () => { await resetDb(); await setFieldModes({ routing: true }); });
  for (const state of ["offered", "accepted", "arrived", "att_scanned", "att_working", "completed"] as OfferState[]) {
    it(state, async () => {
      const w = await worldAt(state, { n: 3 });
      const ps = await parcelsOf(w.offerId); const any = ps[0] ?? (await allParcels(w.requestId))[0]; const sid = any.id, code = any.code;
      const t = await tok(w.other);
      const bad: string[] = [];
      for (const [name, rq] of Object.entries(driverActions(w, sid, code))) {
        const before = await snapshot(w.requestId);
        const res = await call(rq.method, rq.path, { token: t, body: rq.body, form: rq.form });
        if (res.status !== 404 && res.status !== 403 && res.status !== 409 && res.status !== 422) bad.push(`${name}: ${res.status} ${res.text.slice(0, 120)}`);
        if (before !== (await snapshot(w.requestId))) bad.push(`${name}: changed the database`);
      }
      expect(bad).toEqual([]);
    });
  }
});

describe("business / staff / office actions × request states", () => {
  beforeEach(async () => { await resetDb(); await setFieldModes({ routing: true, b2b: true }); });

  it("a terminal request (completed / cancelled / expired) refuses every mutation and changes nothing", async () => {
    for (const terminal of ["completed", "cancelled", "expired"] as const) {
      await resetDb(); await setFieldModes({ routing: true, b2b: true });
      const w = await worldAt(terminal === "completed" ? "completed" : terminal === "expired" ? "offered" : "accepted", { n: 3 });
      const tb = await tok(w.biz), ts = await tok(w.admin), td = await tok(w.driver);
      if (terminal === "cancelled") await call("POST", `/requests/${w.requestId}/cancel`, { token: tb, body: { reason: "changed my mind" } });
      if (terminal === "expired") { const { db } = await import("@/db"); const { requests, offers } = await import("@/db/schema"); const { eq } = await import("drizzle-orm"); await db.update(requests).set({ status: "expired" }).where(eq(requests.id, w.requestId)); await db.update(offers).set({ status: "expired" }).where(eq(offers.requestId, w.requestId)); }
      expect((await requestRow(w.requestId)).status).toBe(terminal);
      const sh = (await parcelsOf(w.offerId))[0] ?? (await allParcels(w.requestId))[0];
      const calls: Array<[string, Req, string]> = [
        ["update", { method: "PATCH", path: `/requests/${w.requestId}`, body: { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 3, vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "x warehouse", startsAt: new Date(Date.now() + 864e5).toISOString(), durationDays: 1 } }, tb],
        ["publish", { method: "POST", path: `/requests/${w.requestId}/publish`, body: { termsAccepted: true } }, tb],
        ["cancel", { method: "POST", path: `/requests/${w.requestId}/cancel`, body: { reason: "again" } }, tb],
        ["cancel (staff)", { method: "POST", path: `/requests/${w.requestId}/cancel`, body: { reason: "ops again" } }, ts],
        ["complete", { method: "POST", path: `/requests/${w.requestId}/complete` }, tb],
        ["patch shipment", { method: "PATCH", path: `/shipments/${sh.id}`, body: { recipientName: "Changed Name" } }, tb],
        ["cancel shipment", { method: "POST", path: `/shipments/${sh.id}/cancel`, body: { reason: "no longer needed" } }, tb],
        ["bulk complete", { method: "PATCH", path: `/requests/${w.requestId}/shipments`, body: { rows: [{ id: sh.id, recipientName: "Changed Name" }] } }, tb],
        ["attendance", { method: "POST", path: `/offers/${w.offerId}/attendance`, body: { present: true } }, tb],
        ["no-show", { method: "POST", path: `/offers/${w.offerId}/attendance`, body: { present: false, reason: "no show" } }, tb],
        ["loading", { method: "POST", path: `/offers/${w.offerId}/loading`, body: { all: true } }, tb],
        ["replace (staff)", { method: "POST", path: `/admin/offers/${w.offerId}/replace`, body: { reason: "replace the driver" } }, ts],
      ];
      const bad: string[] = [];
      for (const [name, rq, token] of calls) {
        const before = await snapshot(w.requestId);
        const res = await call(rq.method, rq.path, { token, body: rq.body });
        if (res.status < 400 || res.status >= 500) bad.push(`${terminal}/${name}: ${res.status} ${res.text.slice(0, 140)}`);
        else if (before !== (await snapshot(w.requestId))) bad.push(`${terminal}/${name}: ${res.status} but the database changed`);
      }
      void td;
      expect(bad).toEqual([]);
    }
  });

  it("a draft refuses everything that needs a published request", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 1000_00 }); const d = await mkDriver();
    const { createDraft } = await import("@/server/requests"); const { reqInput } = await import("../helpers/factories");
    const draft = await createDraft(biz, reqInput({ shipments: mkShipments(2) }));
    const tb = await tok(biz), ts = await tok(admin), td = await tok(d);
    const [p] = await allParcels(draft.id);
    const bad: string[] = [];
    const tries: Array<[string, Req, string]> = [
      ["complete", { method: "POST", path: `/requests/${draft.id}/complete` }, tb],
      ["cancel parcel", { method: "POST", path: `/shipments/${p.id}/cancel`, body: { reason: "remove from draft" } }, tb],
      ["reship", { method: "POST", path: `/requests/${draft.id}/reship`, body: {} }, tb],
      ["apply (driver)", { method: "POST", path: `/driver/requests/${draft.id}/apply`, body: { termsAccepted: true } }, td],
      ["staff rental fulfil", { method: "POST", path: `/admin/requests/${draft.id}/fulfil-rental`, body: {} }, ts],
    ];
    for (const [name, rq, token] of tries) {
      const before = await snapshot(draft.id);
      const res = await call(rq.method, rq.path, { token, body: rq.body });
      if (res.status < 400 || res.status >= 500) bad.push(`${name}: ${res.status} ${res.text.slice(0, 140)}`);
      else if (before !== (await snapshot(draft.id))) bad.push(`${name}: changed the database`);
    }
    expect(bad).toEqual([]);
    clearSettingsCache();
    void mkStaff;
  });
});
