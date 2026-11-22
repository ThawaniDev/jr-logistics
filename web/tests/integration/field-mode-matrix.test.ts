/**
 * A3 audit — the routing (J2) × B2B (J3) mode matrix. For each of the four combinations a complete job is driven through the HTTP API
 * (publish → accept → check in → scan → finish → [approve] → stops in a mode-appropriate order → finish → returns → rate) and, at every phase,
 * every business / office / admin / driver view of it is read: no 5xx, the mode flags are consistent everywhere, `routeApprovedAt` is set in
 * BOTH modes (so every report and guard that reads it keeps working), COD / wallet / notification views never break.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, shipments } from "@/db/schema";
import { shutdown, resetDb, mkAdmin, mkBusiness, mkDriver, mkOffice, mkRule, mkStaff, WAREHOUSE, tomorrow } from "../helpers/factories";
import { setFieldModes } from "../helpers/field-modes";
import { call } from "../helpers/api";
import { tok } from "../helpers/lifecycle-world";
import { otpFor } from "@/server/shipments";

afterAll(shutdown);

const parcel = (i: number, type: "consumer" | "business", cod = 0) => ({ recipientType: type, recipientName: `Customer ${i}`, recipientPhone: `05${String(10000001 + i).slice(-8)}`, address: `${i} Olaya St, Riyadh`, externalRef: `ORD-${i}`, codCents: cod });
const body = (types: Array<"consumer" | "business">) => ({
  service: "delivery_driver", quantity: 1, shipmentsPerDriver: types.length, vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area",
  startsAt: tomorrow().toISOString(), durationDays: 1, shipments: types.map((t, i) => parcel(i + 1, t, i === 0 ? 5000 : 0)),
});

async function must<T extends { status: number; text: string }>(r: T, what: string, ok: number[] = [200, 201]): Promise<T> { if (!ok.includes(r.status)) throw new Error(`${what}: ${r.status} ${r.text.slice(0, 300)}`); return r; }

/** Reads every view of the job; fails on any 5xx and returns the bodies by name. */
async function readViews(t: { biz: string; drv: string; adm: string; off?: string }, ids: { requestId: string; offerId: string; shipmentId: string; driverId: string; officeId?: string }) {
  const gets: Array<[string, string, string]> = [
    ["driver/overview", t.drv, "/driver/overview"], ["driver/jobs", t.drv, "/driver/jobs"], ["driver/history", t.drv, "/driver/jobs?scope=history"], ["driver/job", t.drv, `/driver/jobs/${ids.offerId}`],
    ["driver/offers", t.drv, "/driver/offers"], ["driver/opportunities", t.drv, "/driver/opportunities"], ["driver/cash", t.drv, "/driver/cash"], ["driver/wallet", t.drv, "/wallet"], ["driver/notifications", t.drv, "/notifications"],
    ["biz/overview", t.biz, "/business/overview"], ["biz/requests", t.biz, "/requests"], ["biz/request", t.biz, `/requests/${ids.requestId}`], ["biz/parcels", t.biz, `/requests/${ids.requestId}/shipments`],
    ["biz/parcel", t.biz, `/shipments/${ids.shipmentId}`], ["biz/cod", t.biz, "/business/cod"], ["biz/remittances", t.biz, "/business/cod/remittances"], ["biz/invoices", t.biz, "/business/invoices"], ["biz/notifications", t.biz, "/notifications"],
    ["adm/requests", t.adm, "/admin/requests"], ["adm/request-overview", t.adm, `/admin/requests/${ids.requestId}/overview`], ["adm/request-offers", t.adm, `/admin/requests/${ids.requestId}/offers`],
    ["adm/request-parcels", t.adm, `/admin/requests/${ids.requestId}/parcels`], ["adm/request-money", t.adm, `/admin/requests/${ids.requestId}/money`], ["adm/request-comm", t.adm, `/admin/requests/${ids.requestId}/communication`],
    ["adm/parcel", t.adm, `/admin/shipments/${ids.shipmentId}/detail`], ["adm/search", t.adm, "/admin/shipments/search?q=ORD-1"], ["adm/today", t.adm, "/admin/ops/today"], ["adm/alerts", t.adm, "/admin/ops/alerts"],
    ["adm/cod", t.adm, "/admin/cod"], ["adm/driver-offers", t.adm, `/admin/drivers/${ids.driverId}/offers`], ["adm/driver-parcels", t.adm, `/admin/drivers/${ids.driverId}/parcels`],
    ["adm/fin-drivers", t.adm, "/admin/finance/drivers"], ["adm/an-operations", t.adm, "/admin/analytics/operations"], ["adm/an-deliveries", t.adm, "/admin/analytics/deliveries"], ["adm/an-cod", t.adm, "/admin/analytics/cod"],
    ["adm/an-drivers", t.adm, "/admin/analytics/drivers"], ["adm/activity", t.adm, `/admin/activity/request/${ids.requestId}`], ["adm/stats", t.adm, "/admin/stats"], ["public/catalog", "", "/catalog"],
    ...(t.off ? [["off/jobs", t.off, "/office/jobs"], ["off/job", t.off, `/office/jobs/${ids.offerId}`], ["off/drivers", t.off, "/office/drivers"], ["off/dashboard", t.off, "/office/dashboard"], ["off/opportunities", t.off, "/office/opportunities"]] as Array<[string, string, string]> : []),
  ];
  const out: Record<string, any> = {}; const bad: string[] = [];
  for (const [name, token, path] of gets) { const r = await call("GET", path, { token: token || undefined }); out[name] = r.json; if (r.status !== 200) bad.push(`${name} ${path}: ${r.status} ${r.text.slice(0, 160)}`); }
  expect(bad).toEqual([]);
  return out;
}

for (const routing of [false, true]) for (const b2b of [false, true]) for (const officeDriver of [false, true]) {
  describe(`routing ${routing ? "ON" : "OFF"} × B2B ${b2b ? "ON" : "OFF"} × ${officeDriver ? "office" : "direct"} driver`, () => {
    beforeEach(async () => { await resetDb(); await setFieldModes({ routing, b2b }); });

    it("a whole job and every view of it", async () => {
      const admin = await mkAdmin(); await mkRule(admin);
      const biz = await mkBusiness({ fundsCents: 5000_00 });
      const office = officeDriver ? await mkOffice() : null;
      const driver = await mkDriver({ officeId: office?.id });
      const T = { biz: await tok(biz), drv: await tok(driver), adm: await tok(admin), off: office ? await tok(office) : undefined };

      // ── B2B switch on the entry point ──
      const mixed = body(["consumer", "business", "consumer", "business"]);
      const refused = await call("POST", "/requests", { token: T.biz, body: { ...mixed, publish: true, termsAccepted: true } });
      if (!b2b) { expect(refused.status).toBe(422); expect(refused.json.error.code).toBe("B2B_DISABLED"); }
      else { expect(refused.status, refused.text).toBe(201); }
      const types = b2b ? (["consumer", "business", "consumer", "business"] as const) : (["consumer", "consumer", "consumer", "consumer"] as const);
      let requestId: string;
      if (b2b) requestId = refused.json.id;
      else { const created = await must(await call("POST", "/requests", { token: T.biz, body: { ...body([...types]), publish: true, termsAccepted: true } }), "create"); requestId = created.json.id; }
      expect((await db.select().from(requests).where(eq(requests.id, requestId)))[0].status).toBe("published");

      const [offer] = await db.select().from(offers).where(eq(offers.requestId, requestId));
      const offerId = offer.id;
      const parcels = await db.select().from(shipments).where(eq(shipments.requestId, requestId)).orderBy(shipments.seq);
      const ids = { requestId, offerId, shipmentId: parcels[0].id, driverId: driver.id, officeId: office?.id };
      await readViews(T as never, ids); // offered

      await must(await call("POST", `/offers/${offerId}/accept`, { token: T.drv, body: { termsAccepted: true } }), "accept");
      await readViews(T as never, ids); // accepted
      await db.update(requests).set({ startsAt: new Date(Date.now() + 3600_000) }).where(eq(requests.id, requestId));
      await must(await call("POST", `/offers/${offerId}/checkin`, { token: T.drv, body: WAREHOUSE }), "checkin");
      await must(await call("POST", `/offers/${offerId}/attendance`, { token: T.biz, body: { present: true } }), "attendance");
      await readViews(T as never, ids); // attendance confirmed

      for (const p of parcels) await must(await call("POST", `/offers/${offerId}/loading/scan`, { token: T.drv, body: { code: p.code } }), "scan");
      const fin = await must(await call("POST", `/offers/${offerId}/loading/finish`, { token: T.drv, body: {} }), "finish loading");
      let v = fin.json.job;
      expect(v.policy).toMatchObject({ routingEnabled: routing, b2bShipmentsEnabled: b2b });
      if (routing) {
        expect(v.routeApprovedAt).toBeNull(); expect(v.actions).toContain("approve_route"); expect(v.route).not.toBeNull();
        // the stops are locked until the route is approved
        expect((await call("POST", `/offers/${offerId}/stops/${parcels[0].id}/arrive`, { token: T.drv, body: {} })).status).toBe(409);
        await must(await call("POST", `/offers/${offerId}/route/approve`, { token: T.drv }), "approve");
      } else {
        expect(v.routeApprovedAt).toBeTruthy(); expect(v.actions).not.toContain("approve_route"); expect(v.route).toBeNull();
        expect((await call("POST", `/offers/${offerId}/route/optimize`, { token: T.drv, body: {} })).json.error.code).toBe("ROUTING_DISABLED");
        expect((await call("POST", `/offers/${offerId}/route/approve`, { token: T.drv })).status).toBe(200); // harmless no-op
      }
      v = (await call("GET", `/driver/jobs/${offerId}`, { token: T.drv })).json;
      expect(v.routeApprovedAt).toBeTruthy(); expect(v.actions).toEqual(["work_stops", "end_route"]);
      await readViews(T as never, ids); // route started — in BOTH modes every reader of routeApprovedAt works

      // ── stops: routing OFF may be worked in any order (last first), routing ON only in order ──
      const order = (await db.select().from(shipments).where(eq(shipments.offerId, offerId))).sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0));
      const last = order[order.length - 1];
      const early = await call("POST", `/offers/${offerId}/stops/${last.id}/arrive`, { token: T.drv, body: {} });
      if (routing) { expect(early.status).toBe(409); expect(early.json.error.code).toBe("STOP_LOCKED"); } else expect(early.status, early.text).toBe(200);
      const walk = routing ? order : [...order].reverse();
      for (const [i, s0] of walk.entries()) {
        const s = (await db.select().from(shipments).where(eq(shipments.id, s0.id)))[0];
        await must(await call("POST", `/offers/${offerId}/stops/${s.id}/arrive`, { token: T.drv, body: {} }), "arrive");
        if (i === 1) { await must(await call("POST", `/offers/${offerId}/stops/${s.id}/fail`, { token: T.drv, body: { reason: "refused" } }), "fail"); continue; }
        const biz2 = s.recipientType === "business";
        const wrong = otpFor(s) === "0000" ? "1111" : "0000";
        expect((await call("POST", `/offers/${offerId}/stops/${s.id}/deliver`, { token: T.drv, body: { code: s.code, otp: wrong, ...(s.codCents ? { cashCollectedCents: s.codCents } : {}) } })).json.error.code).toBe("OTP_INVALID");
        await must(await call("POST", `/offers/${offerId}/stops/${s.id}/deliver`, { token: T.drv, body: { code: s.code, otp: otpFor(s), ...(s.codCents ? { cashCollectedCents: s.codCents } : {}) } }), `deliver${biz2 ? " (B2B)" : ""}`);
        if (i === 0) await readViews(T as never, ids); // mid-route
      }
      const done = await must(await call("POST", `/offers/${offerId}/delivered`, { token: T.drv, body: {} }), "finish route");
      expect(done.json.status).toBe("completed");
      await must(await call("POST", `/offers/${offerId}/returns`, { token: T.biz, body: { all: true } }), "returns");
      await must(await call("POST", `/offers/${offerId}/rate`, { token: T.biz, body: { stars: 5 } }), "rate", [201]);
      const finalViews = await readViews(T as never, ids);

      // ── the finished job in every portal ──
      expect(finalViews["biz/request"].status ?? finalViews["biz/request"].request?.status).toBe("completed");
      const bo = finalViews["biz/request"].offers.find((o: any) => o.id === offerId);
      expect(bo.routeApprovedAt).toBeTruthy(); expect(bo.parcels).toMatchObject({ delivered: 3, failed: 0, returned: 1 });
      const cod = finalViews["biz/cod"].totals; expect(cod.collectedCents).toBe(5000);
      if (officeDriver) {
        expect(finalViews["driver/wallet"]).toMatchObject({ managedByOffice: true, availableCents: null });
        expect(finalViews["driver/job"].earningHidden).toBe(true); expect(finalViews["driver/job"].expectedEarningCents).toBeNull();
        expect(JSON.stringify(finalViews["driver/notifications"])).not.toMatch(/earningCents":\d/);
        expect(finalViews["off/job"].routeApprovedAt).toBeTruthy();
        expect(JSON.stringify(finalViews["off/job"])).not.toMatch(/Customer \d|Olaya/); // the office never sees recipient names or addresses
      } else {
        expect(finalViews["driver/wallet"].availableCents).toBeGreaterThan(0);
        expect(finalViews["driver/job"].expectedEarningCents).toBeGreaterThan(0);
      }
      // B2B parcels (only possible while B2B is on) were delivered by code like the others
      if (b2b) expect((await db.select().from(shipments).where(eq(shipments.requestId, requestId))).filter((p) => p.recipientType === "business")).toHaveLength(2);
      void mkStaff;
    }, 120_000);
  });
}
