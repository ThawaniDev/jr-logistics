/**
 * Admin company views: list + KPI summary, the header payload of one company, its overview numbers, and the verification workspace's queue sizes.
 * Also pins the contracts the new pages rely on (documents filtered by owner, verification / status actions reflected in the views).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { businessProfiles, documents, offers, requests, shipments, tickets, users } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkOffice, mkRule, mkStaff, mkShipments, publishedRequest, WAREHOUSE } from "../helpers/factories";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { currentStopOf, otpFor } from "@/server/shipments";
import { finishLoading, scanLoad } from "@/server/loading";
import { receiveCash } from "@/server/cod";

beforeEach(resetDb);
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const get = async (u: { id: string }, path: string) => call("GET", path, { token: await tok(u) });
const setVerification = (id: string, status: string) => db.update(businessProfiles).set({ verificationStatus: status }).where(eq(businessProfiles.userId, id));

/** Five companies in every state the list has to tell apart. */
async function fleet() {
  const admin = await mkAdmin(); await mkRule(admin);
  const ok = await mkBusiness({ fundsCents: 1000_00, name: "Alpha Owner" });          // verified, has a location, has money
  const pending = await mkBusiness({ verified: false, noLocation: true, name: "Bravo Owner" });
  const rejected = await mkBusiness({ noLocation: true, name: "Charlie Owner" }); await setVerification(rejected.id, "rejected");
  const info = await mkBusiness({ name: "Delta Owner" }); await setVerification(info.id, "info_requested");
  const suspendedVerification = await mkBusiness({ name: "Echo Owner" }); await setVerification(suspendedVerification.id, "suspended");
  const lockedOut = await mkBusiness({ name: "Foxtrot Owner" }); await db.update(users).set({ status: "suspended" }).where(eq(users.id, lockedOut.id));
  return { admin, ok, pending, rejected, info, suspendedVerification, lockedOut };
}

describe("permissions", () => {
  it("only back-office staff with a people permission can read the company views", async () => {
    const { admin, ok } = await fleet();
    const biz = await mkBusiness(); const driver = await mkDriver();
    for (const path of ["/admin/companies", "/admin/companies/summary", `/admin/companies/${ok.id}`, `/admin/companies/${ok.id}/overview`, "/admin/verification/summary"]) {
      expect((await get(biz, path)).status, `business ${path}`).toBe(403);
      expect((await get(driver, path)).status, `driver ${path}`).toBe(403);
      expect((await call("GET", path)).status, `anonymous ${path}`).toBe(401);
    }
    const finance = await mkStaff(["finance.view", "wallets.view"]);
    for (const path of ["/admin/companies", "/admin/companies/summary", `/admin/companies/${ok.id}`, `/admin/companies/${ok.id}/overview`]) expect((await get(finance, path)).status, `finance ${path}`).toBe(403);
    for (const perm of ["users.view", "offices.view", "verification.manage"]) {
      const s = await mkStaff([perm]);
      expect((await get(s, "/admin/companies")).status, perm).toBe(200);
      expect((await get(s, `/admin/companies/${ok.id}`)).status, perm).toBe(200);
    }
    expect((await get(admin, "/admin/companies")).status).toBe(200);
  });
});

describe("GET /admin/companies/summary", () => {
  it("counts every state, suspended in either sense, companies without a warehouse pin, and open orders", async () => {
    const { admin, ok } = await fleet();
    await publishedRequest(ok);
    const s = (await get(admin, "/admin/companies/summary")).json;
    expect(s).toMatchObject({ total: 6, verified: 2, pending: 1, infoRequested: 1, rejected: 1, suspended: 2, accountSuspended: 1, noWarehouse: 2, openOrders: 1, companiesWithOpenOrders: 1 });
  });
  it("hides order figures from staff who cannot see requests", async () => {
    const { ok } = await fleet(); await publishedRequest(ok);
    const s = (await get(await mkStaff(["users.view"]), "/admin/companies/summary")).json;
    expect(s.total).toBe(6); expect(s.openOrders).toBeNull(); expect(s.companiesWithOpenOrders).toBeNull();
  });
  it("is not confused by other roles", async () => {
    await mkDriver(); await mkOffice(); await mkStaff(["users.view"]);
    const admin = await mkAdmin();
    expect((await get(admin, "/admin/companies/summary")).json.total).toBe(0);
  });
});

describe("GET /admin/companies", () => {
  it("lists companies newest first with company name, contact, verification, warehouse, open orders and wallet", async () => {
    const { admin, ok } = await fleet(); await publishedRequest(ok);
    const r = (await get(admin, "/admin/companies?pageSize=100")).json;
    expect(r).toMatchObject({ total: 6, page: 1, pageSize: 100 });
    const row = r.items.find((x: any) => x.id === ok.id);
    expect(row).toMatchObject({ name: `Co ${ok.name}`, contactName: "Alpha Owner", verificationStatus: "verified", status: "active", warehouseSet: true, city: "riyadh" });
    expect(row.openOrders).toBe(1);
    expect(row.walletCents).toBeGreaterThan(0); // the 1,000 SAR top-up minus whatever the published request reserved
    expect(row.walletCents).toBeLessThanOrEqual(1000_00);
    expect(r.items.map((x: any) => x.createdAt)).toEqual([...r.items.map((x: any) => x.createdAt)].sort().reverse());
  });
  it("filters by verification state, 'suspended' (verification or account), and the warehouse pin", async () => {
    const { admin, ok, pending, rejected, info, suspendedVerification, lockedOut } = await fleet();
    const ids = async (qs: string) => ((await get(admin, `/admin/companies?pageSize=100&${qs}`)).json.items as Array<{ id: string }>).map((x) => x.id).sort();
    expect(await ids("state=pending")).toEqual([pending.id]);
    expect(await ids("state=rejected")).toEqual([rejected.id]);
    expect(await ids("state=info_requested")).toEqual([info.id]);
    expect(await ids("state=suspended")).toEqual([suspendedVerification.id, lockedOut.id].sort());
    expect((await ids("state=verified")).includes(ok.id)).toBe(true);
    expect(await ids("warehouse=missing")).toEqual([pending.id, rejected.id].sort());
    expect((await ids("warehouse=set")).length).toBe(4);
    expect(await ids("state=pending&warehouse=set")).toEqual([]);
    expect((await get(admin, "/admin/companies?warehouse=nowhere")).status).toBe(422);
  });
  it("searches company name, contact, phone, email and CR number, escaping wildcards", async () => {
    const { admin, ok } = await fleet();
    await db.update(businessProfiles).set({ crNumber: "1010555666" }).where(eq(businessProfiles.userId, ok.id));
    const found = async (q: string) => ((await get(admin, `/admin/companies?q=${encodeURIComponent(q)}`)).json.items as Array<{ id: string }>).map((x) => x.id);
    expect(await found("Alpha")).toEqual([ok.id]);
    expect(await found("1010555")).toEqual([ok.id]);
    expect(await found((ok.phone as string).slice(-6))).toEqual([ok.id]);
    expect(await found(`Co ${ok.name}`)).toEqual([ok.id]);
    expect(await found("%")).toEqual([]);
    expect(await found("zzz-none")).toEqual([]);
  });
  it("paginates and reports the total", async () => {
    const { admin } = await fleet();
    const p1 = (await get(admin, "/admin/companies?pageSize=4&page=1")).json, p2 = (await get(admin, "/admin/companies?pageSize=4&page=2")).json;
    expect([p1.items.length, p2.items.length, p1.total, p2.total]).toEqual([4, 2, 6, 6]);
    expect(new Set([...p1.items, ...p2.items].map((x: any) => x.id)).size).toBe(6);
    expect((await get(admin, "/admin/companies?pageSize=101")).status).toBe(422);
  });
  it("masks phones for staff without drivers.sensitive and money / orders for staff without those permissions", async () => {
    const { admin, ok } = await fleet(); await publishedRequest(ok);
    const plain = (await get(await mkStaff(["users.view"]), "/admin/companies?pageSize=100")).json.items.find((x: any) => x.id === ok.id);
    expect(plain.phone).toContain("•••"); expect(plain.phone).not.toBe(ok.phone);
    expect(plain.walletCents).toBeNull(); expect(plain.openOrders).toBeNull();
    const rich = (await get(await mkStaff(["users.view", "drivers.sensitive", "requests.view", "wallets.view"]), "/admin/companies?pageSize=100")).json.items.find((x: any) => x.id === ok.id);
    expect(rich.phone).toBe(ok.phone); expect(rich.openOrders).toBe(1); expect(typeof rich.walletCents).toBe("number");
    expect((await get(admin, "/admin/companies?pageSize=100")).json.items.find((x: any) => x.id === ok.id).phone).toBe(ok.phone);
  });
});

describe("GET /admin/companies/:id", () => {
  it("returns the header payload: contact, profile, warehouse pin and the tab counters", async () => {
    const { admin, ok } = await fleet(); await publishedRequest(ok);
    await db.update(businessProfiles).set({ crNumber: "1010555666", industry: "Food", address: "Olaya St", responsiblePerson: "Sara", verificationNote: "Looks good" }).where(eq(businessProfiles.userId, ok.id));
    await db.insert(documents).values({ ownerId: ok.id, ownerKind: "business", type: "business_cr", storageKey: "k", fileName: "cr.pdf", mime: "application/pdf", size: 10 });
    const c = (await get(admin, `/admin/companies/${ok.id}`)).json;
    expect(c).toMatchObject({ id: ok.id, name: `Co ${ok.name}`, contactName: "Alpha Owner", phone: ok.phone, status: "active", city: "riyadh" });
    expect(c.profile).toMatchObject({ crNumber: "1010555666", industry: "Food", address: "Olaya St", responsiblePerson: "Sara", verificationStatus: "verified", verificationNote: "Looks good", warehouse: WAREHOUSE, hasWebhook: false, rating: null });
    expect(c.counts).toEqual({ orders: 1, docsToReview: 1 });
    expect(c).not.toHaveProperty("passwordHash");
  });
  it("answers 404 for a user who is not a company, an unknown id and a malformed id", async () => {
    const { admin } = await fleet();
    const driver = await mkDriver(), office = await mkOffice();
    for (const id of [driver.id, office.id, admin.id, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      expect((await get(admin, `/admin/companies/${id}`)).status, id).toBe(404);
      expect((await get(admin, `/admin/companies/${id}/overview`)).status, id).toBe(404);
    }
  });
  it("masks the phone and hides counters the viewer has no permission for", async () => {
    const { ok } = await fleet(); await publishedRequest(ok);
    const c = (await get(await mkStaff(["users.view"]), `/admin/companies/${ok.id}`)).json;
    expect(c.phone).toContain("•••"); expect(c.counts).toEqual({ orders: null, docsToReview: null });
  });
  it("shows the state changes made through the existing verification and status endpoints", async () => {
    const { admin, pending } = await fleet();
    const a = await tok(admin);
    expect((await call("POST", `/admin/users/${pending.id}/verification`, { token: a, body: { action: "request_info" } })).status).toBe(422); // a note is required
    expect((await call("POST", `/admin/users/${pending.id}/verification`, { token: a, body: { action: "request_info", note: "Send your CR" } })).status).toBe(200);
    let c = (await get(admin, `/admin/companies/${pending.id}`)).json;
    expect(c.profile).toMatchObject({ verificationStatus: "info_requested", verificationNote: "Send your CR" });
    expect((await call("POST", `/admin/users/${pending.id}/verification`, { token: a, body: { action: "verify" } })).status).toBe(200);
    expect((await get(admin, `/admin/companies/${pending.id}`)).json.profile.verificationStatus).toBe("verified");
    expect((await call("POST", `/admin/users/${pending.id}/status`, { token: a, body: { status: "suspended", reason: "Fraud check" } })).status).toBe(200);
    c = (await get(admin, `/admin/companies/${pending.id}`)).json; expect(c.status).toBe("suspended");
    expect(((await get(admin, "/admin/companies?state=suspended")).json.items as Array<{ id: string }>).some((x) => x.id === pending.id)).toBe(true);
    expect((await call("POST", `/admin/users/${pending.id}/status`, { token: a, body: { status: "active" } })).status).toBe(200);
    expect((await get(admin, `/admin/companies/${pending.id}`)).json.status).toBe("active");
    // staff who may only look cannot act
    const viewer = await tok(await mkStaff(["users.view"]));
    expect((await call("POST", `/admin/users/${pending.id}/verification`, { token: viewer, body: { action: "verify" } })).status).toBe(403);
    expect((await call("POST", `/admin/users/${pending.id}/status`, { token: viewer, body: { status: "suspended" } })).status).toBe(403);
  });
});

describe("GET /admin/companies/:id/overview", () => {
  it("counts orders by state and reports the wallet, spend and recent orders", async () => {
    const { admin, ok } = await fleet();
    const r1 = await publishedRequest(ok), r2 = await publishedRequest(ok, { startsAt: new Date(Date.now() + 3 * 864e5) });
    await db.update(requests).set({ status: "completed" }).where(eq(requests.id, r2.id));
    const o = (await get(admin, `/admin/companies/${ok.id}/overview`)).json;
    expect(o.orders).toMatchObject({ total: 2, open: 1, completed: 1, draft: 0, lost: 0 });
    expect(o.orders.byStatus).toMatchObject({ completed: 1 });
    expect(o.recent).toHaveLength(2); expect(o.recent[0]).toMatchObject({ ref: expect.stringMatching(/^JR-/) });
    expect(o.recent.map((x: any) => x.id).sort()).toEqual([r1.id, r2.id].sort());
    expect(o.wallet).toMatchObject({ creditLimitCents: 0, heldCents: 0 }); expect(o.wallet.availableCents + o.wallet.reservedCents).toBe(1000_00);
    expect(o.spend).toEqual({ billedCents: 0, settlements: 0 });
    expect(o.cod).toEqual({ collectedCents: 0, receivedCents: 0, outstandingCents: 0 });
    expect(o.support).toEqual({ openTickets: 0, openComplaints: 0 });
    expect(o.documents).toEqual({ total: 0, toReview: 0, requiredTotal: 1, requiredApproved: 0 });
  });
  it("counts open tickets and the required documents that are approved", async () => {
    const { admin, ok } = await fleet();
    await db.insert(tickets).values([
      { ref: "T-1", openedBy: ok.id, category: "other", subject: "a", status: "open" }, { ref: "T-2", openedBy: ok.id, category: "other", subject: "b", status: "resolved" },
    ]);
    await db.insert(documents).values([
      { ownerId: ok.id, ownerKind: "business", type: "business_cr", storageKey: "k1", fileName: "cr.pdf", mime: "application/pdf", size: 1, status: "approved" },
      { ownerId: ok.id, ownerKind: "business", type: "tax_certificate", storageKey: "k2", fileName: "tax.pdf", mime: "application/pdf", size: 1, status: "submitted" },
    ]);
    const o = (await get(admin, `/admin/companies/${ok.id}/overview`)).json;
    expect(o.support.openTickets).toBe(1);
    expect(o.documents).toEqual({ total: 2, toReview: 1, requiredTotal: 1, requiredApproved: 1 });
  });
  it("leaves out each section the viewer has no permission for", async () => {
    const { ok } = await fleet(); await publishedRequest(ok);
    const bare = (await get(await mkStaff(["users.view"]), `/admin/companies/${ok.id}/overview`)).json;
    expect(bare).toMatchObject({ orders: null, recent: null, wallet: null, spend: null, cod: null, support: null, documents: null });
    const some = (await get(await mkStaff(["users.view", "requests.view", "wallets.view", "tickets.view", "documents.review"]), `/admin/companies/${ok.id}/overview`)).json;
    expect(some.orders.total).toBe(1); expect(some.wallet).not.toBeNull(); expect(some.spend).toBeNull(); expect(some.cod).toBeNull();
    expect(some.support).toEqual({ openTickets: 0, openComplaints: null }); expect(some.documents).not.toBeNull();
    expect(some.recent[0].totalCents).toBeNull(); // prices only for finance / pricing viewers
    const fin = (await get(await mkStaff(["users.view", "finance.view", "requests.view"]), `/admin/companies/${ok.id}/overview`)).json;
    expect(fin.recent[0].totalCents).toBeGreaterThan(0); expect(fin.spend).not.toBeNull(); expect(fin.cod).not.toBeNull();
  });
  it("tracks cash on delivery: collected on delivered parcels minus what was handed back", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 }); const d = await mkDriver();
    const rows = mkShipments(2, { withRefs: true }).map((s, i) => ({ ...s, codCents: [10_000, 5_000][i] }));
    const r = await publishedRequest(biz, { shipments: rows, shipmentsPerDriver: 2 });
    const off = (await db.select().from(offers).where(and(eq(offers.requestId, r.id), eq(offers.driverId, d.id))))[0];
    await jobs.acceptOffer(d, off.id, true);
    await db.update(requests).set({ startsAt: new Date(Date.now() + 3600_000) }).where(eq(requests.id, r.id));
    await jobs.checkIn(d, off.id, WAREHOUSE); await jobs.confirmAttendance(biz, off.id, true);
    for (const p of await db.select().from(shipments).where(eq(shipments.offerId, off.id)).orderBy(asc(shipments.seq))) await scanLoad(d, off.id, p.code);
    await finishLoading(d, off.id); await stops.approveRoute(d, off.id);
    for (let i = 0; i < 2; i++) {
      const s = (await currentStopOf(db, off.id))!;
      await stops.arriveAtStop(d, off.id, s.id);
      await stops.deliverStop(d, off.id, s.id, { code: s.code, otp: otpFor(s), cashCollectedCents: s.codCents > 0 ? s.codCents : undefined });
    }
    expect((await get(admin, `/admin/companies/${biz.id}/overview`)).json.cod).toEqual({ collectedCents: 15_000, receivedCents: 0, outstandingCents: 15_000 });
    await receiveCash(biz, off.id, 6_000);
    expect((await get(admin, `/admin/companies/${biz.id}/overview`)).json.cod).toEqual({ collectedCents: 15_000, receivedCents: 6_000, outstandingCents: 9_000 });
  });
});

describe("GET /admin/verification/summary", () => {
  it("counts the queues: companies and offices (new / info requested), drivers, and submitted documents by owner kind", async () => {
    const { admin } = await fleet();
    const office = await mkOffice({ verified: false }), driver = await mkDriver({ verified: false });
    const biz = await mkBusiness({ verified: false }); void biz; // a second pending company
    await db.insert(documents).values([
      { ownerId: office.id, ownerKind: "office", type: "office_cr", storageKey: "a", fileName: "a.pdf", mime: "application/pdf", size: 1 },
      { ownerId: driver.id, ownerKind: "driver", type: "national_id", storageKey: "b", fileName: "b.pdf", mime: "application/pdf", size: 1 },
      { ownerId: driver.id, ownerKind: "driver", type: "driving_license", storageKey: "c", fileName: "c.pdf", mime: "application/pdf", size: 1 },
      { ownerId: driver.id, ownerKind: "driver", type: "vehicle_photo", storageKey: "d", fileName: "d.pdf", mime: "application/pdf", size: 1, status: "approved" },
    ]);
    const s = (await get(admin, "/admin/verification/summary")).json;
    expect(s.business).toEqual({ pending: 2, infoRequested: 1 });
    expect(s.offices).toEqual({ pending: 1, infoRequested: 0 });
    expect(s.drivers).toEqual({ pending: 1 });
    expect(s.documents).toEqual({ total: 3, byKind: { office: 1, driver: 2 } });
  });
  it("follows the permissions of the queue and of the documents", async () => {
    await fleet();
    const none = await mkStaff(["finance.view"]);
    expect((await get(none, "/admin/verification/summary")).status).toBe(403);
    expect((await get(await mkStaff(["offices.view"]), "/admin/verification/summary")).json.documents).toBeNull();
    expect((await get(await mkStaff(["documents.review"]), "/admin/verification/summary")).json.documents).toEqual({ total: 0, byKind: {} });
    expect((await get(await mkStaff(["verification.manage"]), "/admin/verification/summary")).status).toBe(200);
  });
});

describe("the documents tab's data (GET /admin/documents filtered by owner)", () => {
  it("returns only the documents of the owner asked for, and applies the status filter on top", async () => {
    const { admin, ok, pending } = await fleet();
    await db.insert(documents).values([
      { ownerId: ok.id, ownerKind: "business", type: "business_cr", storageKey: "1", fileName: "1.pdf", mime: "application/pdf", size: 1, status: "approved" },
      { ownerId: ok.id, ownerKind: "business", type: "tax_certificate", storageKey: "2", fileName: "2.pdf", mime: "application/pdf", size: 1 },
      { ownerId: pending.id, ownerKind: "business", type: "business_cr", storageKey: "3", fileName: "3.pdf", mime: "application/pdf", size: 1 },
    ]);
    const mine = (await get(admin, `/admin/documents?kind=business&ownerId=${ok.id}`)).json.items;
    expect(mine.map((d: any) => d.type).sort()).toEqual(["business_cr", "tax_certificate"]);
    expect(mine.every((d: any) => d.ownerId === ok.id && d.storageKey === undefined)).toBe(true);
    expect((await get(admin, `/admin/documents?kind=business&ownerId=${ok.id}&status=submitted`)).json.items).toHaveLength(1);
    expect((await get(admin, `/admin/documents?ownerId=${pending.id}`)).json.items).toHaveLength(1);
    // reviewing from the tab: approve needs no note, reject does
    const doc = (await get(admin, `/admin/documents?ownerId=${pending.id}`)).json.items[0];
    const a = await tok(admin);
    expect((await call("POST", `/admin/documents/${doc.id}/review`, { token: a, body: { decision: "rejected" } })).status).toBe(422);
    expect((await call("POST", `/admin/documents/${doc.id}/review`, { token: a, body: { decision: "rejected", note: "Blurry" } })).status).toBe(200);
    expect((await get(admin, `/admin/documents?ownerId=${pending.id}`)).json.items[0]).toMatchObject({ status: "rejected", reviewNote: "Blurry" });
    expect((await call("POST", `/admin/documents/${doc.id}/review`, { token: a, body: { decision: "approved" } })).status).toBe(200);
    expect((await get(await mkStaff(["users.view"]), `/admin/documents?ownerId=${pending.id}`)).status).toBe(403);
  });
});
