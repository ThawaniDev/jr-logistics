/**
 * Server capabilities added with the audit for the admin / office / driver / business / public UIs. Additive: old shapes keep working.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { offers, shipments, tickets, complaints, auditLogs, driverProfiles, partnerConnections } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkStaff, mkBusiness, mkDriver, mkRule, mkOffice, publishedRequest, mkShipments, reqInput } from "../helpers/factories";
import { work } from "../helpers/work";
import { moneyViolations } from "../helpers/invariants";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { createDraft, publishRequest } from "@/server/requests";
import { currentStopOf } from "@/server/shipments";
import { setSmsProvider } from "@/server/auth/otp";
import { audit } from "@/server/audit";
import { createTicket, fileComplaint } from "@/server/support";
import { ensureAccount } from "@/server/wallet";
import { encryptSecrets } from "@/server/partners/crypto";

beforeEach(resetDb);
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "mobile")).token;
const offerOf = async (requestId: string, driverId: string) => (await db.select().from(offers).where(and(eq(offers.requestId, requestId), eq(offers.driverId, driverId))))[0];
async function setup(funds = 5000_00) { const admin = await mkAdmin(); await mkRule(admin); const biz = await mkBusiness({ fundsCents: funds, name: "Acme Warehouse" }); return { admin, biz }; }

describe("GET /admin/shipments/search", () => {
  it("finds a parcel by code, order reference, phone (full or last 4) and name; masks phones without drivers.sensitive; pages with a total", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz, { shipments: mkShipments(12, { withRefs: true }), shipmentsPerDriver: 12 });
    const o = await offerOf(r.id, d.id); await jobs.acceptOffer(d, o.id, true);
    const all = await db.select().from(shipments).where(eq(shipments.requestId, r.id));
    const target = all.find((s) => s.seq === 7)!;
    const viewer = await mkStaff(["requests.view"]); const t = await tok(viewer);
    const get = (q: string, extra = "") => call("GET", `/admin/shipments/search?q=${encodeURIComponent(q)}${extra}`, { token: t });

    const byCode = await get(target.code);
    expect(byCode.status).toBe(200);
    expect(byCode.json.total).toBe(1);
    expect(byCode.json.items[0]).toMatchObject({ id: target.id, code: target.code, externalRef: "ORD-7", recipientName: target.recipientName, status: "pending", requestId: r.id, requestRef: r.ref, businessName: expect.stringContaining("Acme"), driverName: d.name });
    expect(byCode.json.items[0].recipientPhone).toContain("•••");           // masked
    expect(byCode.json.items[0].recipientPhone).not.toBe(target.recipientPhone);
    expect((await get("ord-7")).json.items.map((i: any) => i.id)).toContain(target.id);                      // order reference, case-insensitive
    expect((await get(target.recipientPhone)).json.items.map((i: any) => i.id)).toEqual([target.id]);       // full phone, any spelling
    expect((await get("0" + target.recipientPhone.slice(4))).json.items.map((i: any) => i.id)).toEqual([target.id]);
    expect((await get(target.recipientPhone.slice(-4))).json.items.map((i: any) => i.id)).toContain(target.id); // last 4 digits
    expect((await get("Customer 7")).json.items.map((i: any) => i.id)).toContain(target.id);                  // name
    const paged = await get("Customer", "&pageSize=5&page=2");
    expect(paged.json).toMatchObject({ page: 2, pageSize: 5, total: 12 }); expect(paged.json.items).toHaveLength(5);
    expect((await get("zzzzzz-nothing")).json).toMatchObject({ total: 0, items: [] });
    expect((await get("ab")).status).toBe(422);
    // wildcards are literal
    expect((await get("%%%")).json.total).toBe(0);

    const sens = await mkStaff(["requests.view", "drivers.sensitive"]);
    expect((await call("GET", `/admin/shipments/search?q=${target.code}`, { token: await tok(sens) })).json.items[0].recipientPhone).toBe(target.recipientPhone);
    // partner mirror fields exist
    expect(byCode.json.items[0]).toHaveProperty("partnerId"); expect(byCode.json.items[0]).toHaveProperty("partnerStatus");
  });

  it("is staff-only and needs requests.view", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    expect((await call("GET", "/admin/shipments/search?q=JR-000001", { token: await tok(biz) })).status).toBe(403);
    expect((await call("GET", "/admin/shipments/search?q=JR-000001", { token: await tok(d) })).status).toBe(403);
    expect((await call("GET", "/admin/shipments/search?q=JR-000001", { token: await tok(await mkStaff(["tickets.view"])) })).status).toBe(403);
  });
});

describe("admin lists", () => {
  it("requests: q also matches the business name / phone; businessId filters", async () => {
    const { biz } = await setup(); const other = await mkBusiness({ fundsCents: 500_00, name: "Zeta Stores" });
    await publishedRequest(biz); await publishedRequest(other);
    const t = await tok(await mkStaff(["requests.view"]));
    expect((await call("GET", "/admin/requests?q=Acme", { token: t })).json.items).toHaveLength(1);
    expect((await call("GET", `/admin/requests?q=${encodeURIComponent(other.phone!.slice(-6))}`, { token: t })).json.items.map((i: any) => i.businessId)).toEqual([other.id]);
    expect((await call("GET", `/admin/requests?businessId=${biz.id}`, { token: t })).json).toMatchObject({ total: 1 });
    expect((await call("GET", "/admin/requests", { token: t })).json.total).toBe(2);
  });

  it("partners: paged, filterable, with a total (no silent 200 cap)", async () => {
    const { biz } = await setup(); const b2 = await mkBusiness({ name: "Other Co" });
    const mk = (businessId: string, name: string, provider: string, o: Partial<typeof partnerConnections.$inferInsert> = {}) => db.insert(partnerConnections).values({ businessId, name, provider, secretsEnc: encryptSecrets({}), ...o });
    await mk(biz.id, "Main WMS", "logestechs"); await mk(biz.id, "Backup", "webhook", { status: "disabled" }); await mk(b2.id, "Broken", "logestechs", { lastError: "401" });
    const t = await tok(await mkStaff(["requests.view"]));
    const g = (qs: string) => call("GET", `/admin/partners${qs}`, { token: t });
    expect((await g("")).json).toMatchObject({ total: 3, page: 1 });
    expect((await g("?pageSize=2&page=2")).json.items).toHaveLength(1);
    expect((await g("?provider=webhook")).json.total).toBe(1);
    expect((await g("?status=disabled")).json.items[0].name).toBe("Backup");
    expect((await g("?problemsOnly=1")).json.items.map((i: any) => i.name)).toEqual(["Broken"]);
    expect((await g("?q=Other")).json.items.map((i: any) => i.name)).toEqual(["Broken"]);
  });

  it("audit: actor name joined; filters by actor, action prefix, date range; total", async () => {
    const a = await mkAdmin(); const s = await mkStaff(["audit.view"]);
    await audit(a, "settlement.approve", "settlement", "x1"); await audit(a, "settlement.pay", "settlement", "x2"); await audit(s, "user.suspended", "user", "u1");
    const t = await tok(s);
    const all = await call("GET", "/admin/audit", { token: t });
    expect(all.json.items.length).toBeGreaterThanOrEqual(3); expect(all.json.total).toBeGreaterThanOrEqual(3);
    expect(all.json.items.find((i: any) => i.action === "user.suspended")).toMatchObject({ actorId: s.id, actorName: s.name });
    expect((await call("GET", `/admin/audit?actorId=${a.id}`, { token: t })).json.items.every((i: any) => i.actorId === a.id)).toBe(true);
    expect((await call("GET", "/admin/audit?action=settlement.", { token: t })).json.total).toBe(2);
    const future = new Date(Date.now() + 86400_000).toISOString();
    expect((await call("GET", `/admin/audit?from=${encodeURIComponent(future)}`, { token: t })).json.total).toBe(0);
    expect((await call("GET", "/admin/audit?entity=user", { token: t })).json.items.every((i: any) => i.entity === "user")).toBe(true);
    void auditLogs;
  });

  it("drivers: status / suspended filters and a total; the old array of `items` still works", async () => {
    await setup();
    const d1 = await mkDriver({ name: "Active Ali" }); const d2 = await mkDriver({ name: "Banned Bob" });
    await db.update(driverProfiles).set({ suspendedUntil: new Date(Date.now() + 86400_000) }).where(eq(driverProfiles.userId, d2.id));
    const t = await tok(await mkStaff(["drivers.view"]));
    const g = (qs: string) => call("GET", `/admin/drivers${qs}`, { token: t });
    expect((await g("")).json).toMatchObject({ total: 2, page: 1 });
    expect((await g("?suspended=1")).json.items.map((i: any) => i.id)).toEqual([d2.id]);
    expect((await g("?suspended=0")).json.items.map((i: any) => i.id)).toEqual([d1.id]);
    expect((await g("?status=active&q=Ali")).json.total).toBe(1);
    expect((await g("?pageSize=1")).json.items).toHaveLength(1);
  });

  it("tickets and complaints: q, priority, requester name, total", async () => {
    const { biz } = await setup(); const d = await mkDriver({ name: "Hassan Driver" });
    const r = await publishedRequest(biz); const o = await offerOf(r.id, d.id); await jobs.acceptOffer(d, o.id, true);
    await createTicket(d, { category: "other", subject: "Fuel receipt problem", offerId: o.id });
    await createTicket(biz, { category: "other", subject: "Invoice question please" });
    await fileComplaint(biz, { category: "damage", description: "The driver damaged the boxes badly", offerId: o.id });
    const t = await tok(await mkStaff(["tickets.view", "complaints.manage"]));
    const tk = await call("GET", "/admin/tickets?q=Hassan", { token: t });
    expect(tk.json.total).toBe(1); expect(tk.json.items[0]).toMatchObject({ openedByName: "Hassan Driver", subject: "Fuel receipt problem" });
    expect((await call("GET", "/admin/tickets", { token: t })).json.total).toBe(2);
    expect((await call("GET", "/admin/tickets?q=invoice", { token: t })).json.total).toBe(1);
    expect((await call("GET", "/admin/tickets?priority=urgent", { token: t })).json.total).toBe(0);
    const cp = await call("GET", "/admin/complaints?priority=urgent&q=damaged", { token: t });
    expect(cp.json.total).toBe(1); expect(cp.json.items[0].filedByName).toBe(biz.name);
    expect((await call("GET", "/admin/complaints?priority=normal", { token: t })).json.total).toBe(0);
    // a user still sees only their own, with the same shape
    const mine = await call("GET", "/tickets", { token: await tok(biz) });
    expect(mine.json.items).toHaveLength(1); expect(mine.json.total).toBe(1);
    void tickets; void complaints;
  });
});

describe("office views", () => {
  async function officeJob() {
    const { biz } = await setup(); const office = await mkOffice(); const other = await mkOffice();
    const d = await mkDriver({ officeId: office.id });
    const r = await publishedRequest(biz, { shipments: mkShipments(6, { withRefs: true }), shipmentsPerDriver: 6 });
    const o = await offerOf(r.id, d.id);
    await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
    return { biz, office, other, d, r, o };
  }

  it("jobs carry per-offer parcel progress, service and last activity; drivers carry their active offer", async () => {
    const { biz, office, d, r, o } = await officeJob();
    const t = await tok(office);
    expect((await call("GET", "/office/drivers", { token: t })).json.items[0]).toMatchObject({ id: d.id, activeOfferId: o.id }); // working: the accepted job is his active one
    await work(biz, d, o.id, 4);
    const jobsRes = await call("GET", "/office/jobs", { token: t });
    expect(jobsRes.status).toBe(200);
    const item = jobsRes.json.items.find((i: any) => i.offerId === o.id);
    expect(item).toMatchObject({ service: "delivery_driver", ref: r.ref, parcels: { total: 6, delivered: 4, failed: 0, returned: 2 } });
    expect(new Date(item.lastActivityAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    const drivers = await call("GET", "/office/drivers", { token: t });
    expect(drivers.json.items[0]).toMatchObject({ id: d.id, activeOfferId: null }); // finished and paid: nothing active any more
    // an idle driver has no active offer
    const idle = await mkDriver({ officeId: office.id });
    expect((await call("GET", "/office/drivers", { token: t })).json.items.find((i: any) => i.id === idle.id)).toMatchObject({ activeOfferId: null, parcels: null });
  });

  it("GET /office/jobs/:id shows the stops without any recipient data and only to the owning office", async () => {
    const { biz, office, other, d, o } = await officeJob();
    await work(biz, d, o.id, 3);
    const res = await call("GET", `/office/jobs/${o.id}`, { token: await tok(office) });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ offerId: o.id, service: "delivery_driver", driver: d.name, parcels: { total: 6, delivered: 3 }, manifest: true });
    expect(res.json.stops).toHaveLength(6);
    expect(res.json.stops[0]).toHaveProperty("code"); expect(res.json.stops.filter((s: any) => s.status === "delivered")).toHaveLength(3);
    const text = JSON.stringify(res.json);
    for (const s of await db.select().from(shipments)) { expect(text).not.toContain(s.recipientPhone); expect(text).not.toContain(s.recipientName); expect(text).not.toContain(s.address); }
    expect((await call("GET", `/office/jobs/${o.id}`, { token: await tok(other) })).status).toBe(404);
    expect((await call("GET", `/office/jobs/${o.id}`, { token: await tok(biz) })).status).toBe(403);
  });
});

describe("driver offers and recipient tracking link", () => {
  it("an offer states when it lapses", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    await publishedRequest(biz);
    const res = await call("GET", "/driver/offers", { token: await tok(d) });
    const exp = new Date(res.json.items[0].expiresAt).getTime();
    expect(exp).toBeGreaterThan(Date.now() + 100 * 60_000); expect(exp).toBeLessThan(Date.now() + 130 * 60_000); // default 120 min
  });

  it("the recipient's SMS link opens their parcel in one tap: it carries ?p=<last 4>, never the full number, and /track accepts it", async () => {
    const sent: Array<{ phone: string; text: string }> = [];
    setSmsProvider({ name: "cap", async send(phone, text) { sent.push({ phone, text }); } });
    try {
      const { biz } = await setup(); const d = await mkDriver();
      const r = await publishedRequest(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2 });
      const o = await offerOf(r.id, d.id); await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
      await jobs.recordLoading(biz, o.id, undefined, { all: true }); await jobs.acknowledgeLoading(d, o.id, true); await stops.approveRoute(d, o.id);
      const cur = (await currentStopOf(db, o.id))!;
      const sms = sent.find((s) => s.phone === cur.recipientPhone)!;
      const link = sms.text.match(/https?:\/\/\S+/)![0];
      expect(link).toMatch(new RegExp(`/track/${cur.code}\\?p=${cur.recipientPhone.slice(-4)}$`));
      expect(sms.text).not.toContain(cur.recipientPhone.replace("+", "")); 
      const url = new URL(link);
      const res = await call("GET", `${url.pathname.replace("/api/v1", "")}${url.search}`.replace(/^\/track/, "/track"));
      expect(res.status).toBe(200); expect(res.json.code).toBe(cur.code);
    } finally { setSmsProvider(null); }
  });
});

describe("business app", () => {
  it("overview counts the failed parcels still awaiting return; wallet shows ledger request refs, the credit line and the top-up ceiling", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz, { shipments: mkShipments(4), shipmentsPerDriver: 4 });
    const o = await offerOf(r.id, d.id); await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
    await jobs.recordLoading(biz, o.id, undefined, { all: true }); await jobs.acknowledgeLoading(d, o.id, true); await stops.approveRoute(d, o.id);
    for (;;) { const s = await currentStopOf(db, o.id); if (!s) break; await stops.arriveAtStop(d, o.id, s.id); await stops.failStop(d, o.id, s.id, { reason: "refused" }); }
    await jobs.reportDelivered(d, o.id);
    const t = await tok(biz);
    expect((await call("GET", "/business/overview", { token: t })).json.returnsPending).toBe(4);
    await stops.confirmReturns(biz, o.id, { all: true });
    expect((await call("GET", "/business/overview", { token: t })).json.returnsPending).toBe(0);
    const w = await call("GET", "/wallet", { token: t });
    expect(w.json).toMatchObject({ creditLimitCents: 0, maxTopupCents: 10_000_000 });
    const reserve = w.json.entries.find((e: any) => e.kind === "reserve");
    expect(reserve).toMatchObject({ requestId: r.id, requestRef: r.ref });
    expect(w.json.entries.find((e: any) => e.kind === "topup").requestRef).toBeNull();
  });

  it("B7 credit line: staff grant it, a business may publish into a negative balance down to the limit and not beyond, books stay balanced", async () => {
    const { biz } = await setup(0); // no funds at all
    const adm = await mkStaff(["wallet.adjust"]); const plain = await mkStaff(["requests.view"]);
    const ta = await tok(adm);
    const draft = async (n: number) => createDraft(biz, reqInput({ shipments: mkShipments(n), shipmentsPerDriver: n }));
    const d1 = await draft(30); // 30 × SAR 10 = 300.00
    await expect(publishRequest(biz, d1.id, { termsAccepted: true })).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect((await call("POST", "/admin/finance/credit-limit", { token: await tok(plain), body: { userId: biz.id, creditLimitCents: 50_000 } })).status).toBe(403);
    expect((await call("POST", "/admin/finance/credit-limit", { token: ta, body: { userId: biz.id, creditLimitCents: 50_000 } })).status).toBe(200); // SAR 500
    await publishRequest(biz, d1.id, { termsAccepted: true });
    let acct = await ensureAccount(biz.id);
    expect(acct).toMatchObject({ availableCents: -30_000, reservedCents: 30_000, creditLimitCents: 50_000 });
    const d2 = await draft(30);
    await expect(publishRequest(biz, d2.id, { termsAccepted: true })).rejects.toMatchObject({ code: "CREDIT_LIMIT_EXCEEDED", details: { creditLimitCents: 50_000 } });
    expect((await call("POST", "/admin/finance/credit-limit", { token: ta, body: { userId: biz.id, creditLimitCents: 10_000 } })).status).toBe(422); // owes SAR 300 > new limit
    expect((await call("GET", "/wallet", { token: await tok(biz) })).json).toMatchObject({ availableCents: -30_000, creditLimitCents: 50_000 });
    expect((await call("POST", "/requests/estimate", { token: await tok(biz), body: { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 15, vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", startsAt: new Date(Date.now() + 864e5).toISOString(), shipmentCount: 15 } })).json.sufficientFunds).toBe(true);
    expect(await moneyViolations()).toEqual([]);
    await import("@/server/requests").then((m) => m.cancelRequest(biz, d1.id, "changed my mind")); // escrow returns; debt stays as the negative balance
    acct = await ensureAccount(biz.id);
    expect(acct).toMatchObject({ availableCents: -30_000 + 30_000, reservedCents: 0 });
    expect(await moneyViolations()).toEqual([]);
  });
});

describe("health", () => {
  it("is public and shallow by default; the cron secret unlocks scheduler freshness and queue depths", async () => {
    const plain = await call("GET", "/health");
    expect(plain.status).toBe(200);
    expect(plain.json).toMatchObject({ status: "ok", db: { ok: true } }); expect(plain.json).not.toHaveProperty("queues");
    const deep = await call("GET", "/health", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(deep.json).toHaveProperty("queues"); expect(deep.json.maintenance.stale).toBe(true); expect(deep.json.status).toBe("degraded"); // never ticked yet
    await call("POST", "/cron/tick", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    const after = await call("GET", "/health", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(after.json).toMatchObject({ status: "ok", maintenance: { stale: false } });
    expect((await call("GET", "/health", { headers: { authorization: "Bearer wrong" } })).json).not.toHaveProperty("queues");
  });
});
