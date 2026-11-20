/**
 * Platform update J — J4: a driver of an office sees no earnings and no wallet (cash stays visible); J5: every order card has its stat numbers.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, offers, requests, shipments, type User } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkOffice, mkRule, mkShipments, publishedRequest, WAREHOUSE } from "../helpers/factories";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { currentStopOf, otpFor } from "@/server/shipments";
import { ensureAccount, post } from "@/server/wallet";
import { notify } from "@/server/notify";
import { receiveCash } from "@/server/cod";
import { finishLoading, scanLoad } from "@/server/loading";
import { work } from "../helpers/work";

beforeEach(resetDb);
afterAll(shutdown);

const tok = async (u: { id: string }) => (await createSession(u.id, "mobile")).token;
const fund = async (u: User, cents: number) => { const a = await ensureAccount(u.id); await post(db, { accountId: a.id, kind: "payout", available: cents, idempotencyKey: `t:${u.id}:${cents}` }); };

/** Two drivers (one of an office, one direct) offered the same 6-parcel order: 3 each, two parcels are cash on delivery. */
async function world() {
  const admin = await mkAdmin(); await mkRule(admin);
  const biz = await mkBusiness({ fundsCents: 50_000_00 });
  const office = await mkOffice();
  const od = await mkDriver({ officeId: office.id, name: "Office Omar" }), dd = await mkDriver({ name: "Direct Dana" });
  const rows = mkShipments(6, { withRefs: true }).map((s, i) => ({ ...s, codCents: i === 0 ? 12_050 : i === 3 ? 5_000 : 0 }));
  const r = await publishedRequest(biz, { quantity: 2, shipmentsPerDriver: 3, shipments: rows });
  const offerOf = async (d: User) => (await db.select().from(offers).where(and(eq(offers.requestId, r.id), eq(offers.driverId, d.id))))[0];
  return { admin, biz, office, od, dd, r, offerOf, ot: await tok(od), dt: await tok(dd), bt: await tok(biz), officeTok: await tok(office), adminTok: await tok(admin) };
}
type World = Awaited<ReturnType<typeof world>>;

/** Accepts the offer and takes it to "attendance confirmed". */
async function accept(w: World, d: User) {
  const o = await w.offerOf(d);
  await jobs.acceptOffer(d, o.id, true);
  await db.update(requests).set({ startsAt: new Date(Date.now() + 3600_000) }).where(eq(requests.id, w.r.id));
  await jobs.checkIn(d, o.id, WAREHOUSE); await jobs.confirmAttendance(w.biz, o.id, true);
  return o.id;
}
const parcels = (offerId: string) => db.select().from(shipments).where(eq(shipments.offerId, offerId)).orderBy(asc(shipments.seq));
const jobOf = async (token: string, id: string) => (await call("GET", `/driver/jobs/${id}`, { token })).json;

describe("J4 — drivers of an office: no earnings, no wallet; cash unchanged", () => {
  it("GET /driver/overview: wallet is null and managed by the office, cash is unchanged; a direct driver is untouched", async () => {
    const w = await world();
    await fund(w.od, 40_000); await fund(w.dd, 40_000);
    const od = (await call("GET", "/driver/overview", { token: w.ot })).json;
    expect(od.wallet).toBeNull(); expect(od.walletManagedByOffice).toBe(true); expect(od.officeName).toBe((await db.query.officeProfiles.findFirst({ where: (t, { eq: e }) => e(t.userId, w.office.id) }))!.officeName);
    expect(od.cash).toEqual({ outstandingCents: 0, orders: 0 }); expect(od.activeJob).toBeNull();
    expect(JSON.stringify(od)).not.toMatch(/pending|40000/);
    const dd = (await call("GET", "/driver/overview", { token: w.dt })).json;
    expect(dd.wallet).toEqual({ availableCents: 40_000, heldCents: 0, pendingCents: 0 }); expect(dd.walletManagedByOffice).toBe(false); expect(dd.officeName).toBeNull();
    expect(dd.cash).toEqual({ outstandingCents: 0, orders: 0 });
  });

  it("GET /wallet: the managed payload for the office driver; the normal one for a direct driver, a company and an office", async () => {
    const w = await world();
    await fund(w.od, 40_000); await fund(w.dd, 40_000);
    const m = await call("GET", "/wallet", { token: w.ot });
    expect(m.status).toBe(200);
    expect(m.json).toMatchObject({ managedByOffice: true, availableCents: null, reservedCents: null, heldCents: null, entries: [], total: 0, page: 1, pageSize: 25 });
    expect(m.json.officeName).toBeTruthy();
    expect((await call("GET", "/wallet?kind=payout&page=3", { token: w.ot })).json).toMatchObject({ managedByOffice: true, entries: [], total: 0 });
    const d = (await call("GET", "/wallet", { token: w.dt })).json;
    expect(d).toMatchObject({ managedByOffice: false, availableCents: 40_000 }); expect(d.entries.length).toBeGreaterThan(0);
    expect((await call("GET", "/wallet", { token: w.bt })).json).toMatchObject({ managedByOffice: false });
    await fund(w.office, 9_000);
    expect((await call("GET", "/wallet", { token: w.officeTok })).json).toMatchObject({ managedByOffice: false, availableCents: 9_000 });
  });

  it("withdrawals: refused with 403 WALLET_MANAGED_BY_OFFICE (even with a balance), allowed for a direct driver; the office driver's list is empty", async () => {
    const w = await world();
    await fund(w.od, 40_000); await fund(w.dd, 40_000);
    const no = await call("POST", "/withdrawals", { token: w.ot, body: { amountCents: 20_000 } });
    expect(no.status).toBe(403); expect(no.json.error.code).toBe("WALLET_MANAGED_BY_OFFICE");
    expect((await ensureAccount(w.od.id)).availableCents).toBe(40_000); // nothing was held
    expect((await call("POST", "/withdrawals", { token: w.dt, body: { amountCents: 20_000 } })).status).toBe(201);
    expect((await call("GET", "/withdrawals", { token: w.dt })).json.items).toHaveLength(1);
    expect((await call("GET", "/withdrawals", { token: w.ot })).json.items).toEqual([]);
  });

  it("offers, jobs and history: the office driver never receives an earning; the direct driver still does", async () => {
    const w = await world();
    const o1 = (await call("GET", "/driver/offers", { token: w.ot })).json.items[0], o2 = (await call("GET", "/driver/offers", { token: w.dt })).json.items[0];
    expect(o1.earningHidden).toBe(true); expect(o1.expectedEarningCents).toBeNull();
    expect(o2.earningHidden).toBe(false); expect(o2.expectedEarningCents).toBeGreaterThan(0);
    const op = (await call("GET", "/driver/opportunities", { token: w.ot })).json; expect(JSON.stringify(op)).not.toMatch(/"expectedEarningCents":\d/);
    const oid = await accept(w, w.od), did = await accept(w, w.dd);
    for (const [t, id, hidden] of [[w.ot, oid, true], [w.dt, did, false]] as const) {
      const j = await jobOf(t, id); expect(j.earningHidden).toBe(hidden); expect(j.expectedEarningCents == null).toBe(hidden);
      const list = (await call("GET", "/driver/jobs?scope=active", { token: t })).json.items[0]; expect(list.expectedEarningCents == null).toBe(hidden);
    }
    await work(w.biz, w.od, oid); await work(w.biz, w.dd, did);
    for (const [t, id, hidden] of [[w.ot, oid, true], [w.dt, did, false]] as const) {
      const h = (await call("GET", "/driver/jobs?scope=history", { token: t })).json.items.find((x: any) => x.offerId === id);
      expect(h.status).toBe("completed"); expect(h.earningHidden).toBe(hidden); expect(h.expectedEarningCents == null).toBe(hidden);
    }
    // the direct driver was paid into his wallet; the office driver's job paid the office
    expect((await call("GET", "/driver/overview", { token: w.dt })).json.wallet.availableCents).toBeGreaterThan(0);
    expect((await call("GET", "/wallet", { token: w.officeTok })).json.availableCents).toBeGreaterThan(0);
    expect((await call("GET", "/wallet", { token: w.ot })).json.availableCents).toBeNull();
  });

  it("notifications: no wallet notifications and no earning figure for the office driver (counts follow); cash notifications stay", async () => {
    const w = await world();
    for (const d of [w.od, w.dd]) {
      await notify(d.id, "payout_paid", { amountCents: 7_700 }); await notify(d.id, "wallet_adjusted", { amountCents: 500 }); await notify(d.id, "withdrawal_paid", { amountCents: 100 });
      await notify(d.id, "offer_new", { ref: "R1", parcels: 3, earningCents: 2_100 }); await notify(d.id, "cod_received", { ref: "R1", amountCents: 12_050, amount: "120.50" });
    }
    const types = (r: any) => r.json.items.map((n: any) => n.type).sort();
    const o = await call("GET", "/notifications", { token: w.ot });
    expect(types(o)).toContain("offer_new"); expect(types(o)).toContain("cod_received");
    for (const hidden of ["payout_paid", "wallet_adjusted", "withdrawal_paid"]) expect(types(o)).not.toContain(hidden);
    expect(o.json.total).toBe(types(o).length); expect(o.json.unread).toBe(types(o).length);
    expect(o.json.items.find((n: any) => n.type === "offer_new").data).toEqual({ ref: "R1", parcels: 3 });
    expect(o.json.items.find((n: any) => n.type === "cod_received").data).toMatchObject({ amountCents: 12_050, amount: "120.50" });
    expect((await call("GET", "/notifications?unread=1", { token: w.ot })).json.items).toHaveLength(types(o).length);
    const d = await call("GET", "/notifications", { token: w.dt });
    expect(types(d)).toEqual(expect.arrayContaining(["payout_paid", "wallet_adjusted", "withdrawal_paid", "offer_new", "cod_received"]));
    expect(d.json.items.find((n: any) => n.type === "offer_new").data.earningCents).toBe(2_100);
    // the rows themselves are untouched (hidden at read time, so they come back with the wallet)
    expect((await db.select().from(notifications).where(eq(notifications.userId, w.od.id))).map((n) => n.type)).toEqual(expect.arrayContaining(["payout_paid", "wallet_adjusted", "withdrawal_paid"]));
  });

  it("job timeline: no payout milestone for the office driver; the direct driver and the company still see it", async () => {
    const w = await world();
    const oid = await accept(w, w.od), did = await accept(w, w.dd);
    await work(w.biz, w.od, oid); await work(w.biz, w.dd, did);
    const types = async (t: string, id: string) => (await call("GET", `/offers/${id}/timeline`, { token: t })).json.items.map((e: any) => e.type);
    expect(await types(w.dt, did)).toContain("payout_paid");
    expect(await types(w.ot, oid)).not.toContain("payout_paid"); expect(await types(w.ot, oid)).toContain("request_completed");
    expect(await types(w.bt, did)).toContain("payout_paid");
  });

  it("staff and office views are unchanged: the office keeps seeing its money, staff the driver's wallet", async () => {
    const w = await world();
    await fund(w.od, 40_000);
    const oid = await accept(w, w.od); await work(w.biz, w.od, oid);
    const money = (await call("GET", `/admin/drivers/${w.od.id}/wallet`, { token: w.adminTok }));
    expect(money.status).toBe(200); expect(JSON.stringify(money.json)).toContain("40000");
    const st = (await call("GET", "/office/settlements", { token: w.officeTok })).json;
    expect(st.items.length).toBeGreaterThan(0); expect(st.items[0].amountCents).toBeGreaterThan(0);
    const rep = await call("GET", "/office/reports", { token: w.officeTok }); expect(rep.status).toBe(200);
    const jobs2 = (await call("GET", "/office/jobs", { token: w.officeTok })).json; expect(jobs2.items.length).toBeGreaterThan(0);
  });

  it("the wallet is derived: it disappears when a driver joins an office and comes back when he leaves", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const office = await mkOffice(); const ot = await tok(office);
    const d = await mkDriver({ officeId: office.id }); const dt = await tok(d);
    await fund(d, 30_000);
    expect((await call("GET", "/driver/overview", { token: dt })).json.wallet).toBeNull();
    expect((await call("POST", "/withdrawals", { token: dt, body: { amountCents: 20_000 } })).status).toBe(403);
    expect((await call("POST", `/office/drivers/${d.id}/unlink`, { token: ot })).status).toBe(200);
    const ov = (await call("GET", "/driver/overview", { token: dt })).json;
    expect(ov.wallet).toEqual({ availableCents: 30_000, heldCents: 0, pendingCents: 0 }); expect(ov.walletManagedByOffice).toBe(false);
    expect((await call("GET", "/wallet", { token: dt })).json).toMatchObject({ managedByOffice: false, availableCents: 30_000 });
    expect((await call("POST", "/withdrawals", { token: dt, body: { amountCents: 20_000 } })).status).toBe(201);
    // and he can be invited again: managed once more
    const inv = await call("POST", "/office/drivers/invite", { token: ot, body: { phone: d.phone } }); expect(inv.status).toBe(201);
    const mine = (await call("GET", "/driver/invites", { token: dt })).json.items[0];
    expect((await call("POST", `/driver/invites/${mine.id}/respond`, { token: dt, body: { accept: true } })).status).toBe(200);
    expect((await call("GET", "/driver/overview", { token: dt })).json.walletManagedByOffice).toBe(true);
  });
});

describe("J5 — every order card has its stat numbers", () => {
  it("offered → accepted → working → finished: totals, to deliver, delivered, not delivered and the cash", async () => {
    const w = await world();
    for (const [t, d] of [[w.ot, w.od], [w.dt, w.dd]] as const) {
      // offered: expected parcels, nothing delivered, no cash figures yet
      const offered = (await call("GET", "/driver/offers", { token: t })).json.items[0];
      expect(offered.stats).toEqual({ total: 3, toDeliver: 3, delivered: 0, notDelivered: 0, failed: 0, returned: 0, estimated: true, cod: null });
      // accepted / attendance confirmed, not loaded: the parcels are assigned and all still to deliver
      const id = await accept(w, d);
      const acc = (await jobOf(t, id)).stats;
      expect(acc).toMatchObject({ total: 3, toDeliver: 3, delivered: 0, notDelivered: 0, estimated: false });
      const mine = await parcels(id); const cash = mine.reduce((a, s) => a + s.codCents, 0);
      expect(acc.cod === null ? 0 : acc.cod.toCollectCents).toBe(cash);
      expect(((await call("GET", "/driver/jobs?scope=active", { token: t })).json.items.find((x: any) => x.offerId === id)).stats).toEqual(acc);
      // working: one parcel delivered with its cash
      for (const p of await parcels(id)) await scanLoad(d, id, p.code);
      await finishLoading(d, id); await stops.approveRoute(d, id);
      const s1 = (await currentStopOf(db, id))!; await stops.arriveAtStop(d, id, s1.id);
      await stops.deliverStop(d, id, s1.id, { code: s1.code, otp: otpFor(s1), ...(s1.codCents > 0 ? { cashCollectedCents: s1.codCents } : {}) });
      const act = (await jobOf(t, id)).stats;
      expect(act).toMatchObject({ total: 3, toDeliver: 2, delivered: 1, notDelivered: 0 });
      expect(act.cod?.collectedCents ?? 0).toBe(s1.codCents);
      // finished: the rest delivered but one (a parcel without cash) refused → the history card shows the final result
      let refused = false;
      for (;;) {
        const s = await currentStopOf(db, id); if (!s) break;
        await stops.arriveAtStop(d, id, s.id);
        if (!refused && s.codCents === 0) { await stops.failStop(d, id, s.id, { reason: "refused" }); refused = true; }
        else await stops.deliverStop(d, id, s.id, { code: s.code, otp: otpFor(s), ...(s.codCents > 0 ? { cashCollectedCents: s.codCents } : {}) });
      }
      await jobs.reportDelivered(d, id); await stops.confirmReturns(w.biz, id, { all: true });
      const collected = (await parcels(id)).reduce((a, s) => a + (s.codCollectedCents ?? 0), 0);
      expect(collected).toBeGreaterThan(0);
      await receiveCash(w.biz, id, Math.min(collected, 5_000));
      const hist = (await call("GET", "/driver/jobs?scope=history", { token: t })).json.items.find((x: any) => x.offerId === id).stats;
      expect(hist).toMatchObject({ total: 3, toDeliver: 0, delivered: 2, notDelivered: 1, estimated: false });
      expect(hist.failed + hist.returned).toBe(1);
      expect(hist.cod).toMatchObject({ collectedCents: collected, handedOverCents: Math.min(collected, 5_000), outstandingCents: collected - Math.min(collected, 5_000) });
      // cash is visible to the office driver exactly like to the direct one
      const ov = (await call("GET", "/driver/overview", { token: t })).json; expect(ov.cash.outstandingCents).toBe(collected - Math.min(collected, 5_000));
    }
  });

  it("a rejected or cancelled offer shows what was expected and nothing to deliver; vehicle-day jobs have no stats", async () => {
    const w = await world();
    const o = await w.offerOf(w.dd);
    await call("POST", `/offers/${o.id}/reject`, { token: w.dt });
    const h = (await call("GET", "/driver/jobs?scope=history", { token: w.dt })).json.items[0];
    expect(h.status).toBe("rejected"); expect(h.stats).toMatchObject({ total: 3, toDeliver: 0, delivered: 0, notDelivered: 0, estimated: true });
    const biz = await mkBusiness({ fundsCents: 50_000_00 });
    await mkRule(w.admin, { service: "car_with_driver", priceCents: 30_000, providerCostCents: 20_000 });
    await publishedRequest(biz, { service: "car_with_driver", quantity: 1 });
    const cwd = (await call("GET", "/driver/offers", { token: w.dt })).json.items.find((x: any) => x.service === "car_with_driver");
    expect(cwd).toBeTruthy(); expect(cwd.stats).toBeNull();
  });
});
