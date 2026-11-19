/**
 * Back-office views for courier offices, drivers and the accounts directory (`routes/admin-offices.ts`, `server/offices-admin.ts`).
 * Read-only aggregates: the tests cover filters, totals, money visibility, sensitive-data masking and permissions.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { driverProfiles, jobEvents, officeAgreements, officeProfiles, offers, settlements, users } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkStaff, mkBusiness, mkDriver, mkOffice, mkRule, publishedRequest } from "../helpers/factories";
import { work } from "../helpers/work";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import * as jobs from "@/server/jobs";

beforeEach(resetDb);
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "mobile")).token;
const get = (path: string, token: string) => call("GET", path, { token });
const FAKE = "00000000-0000-4000-8000-000000000000";

async function completeJob(biz: any, driver: any, offerId: string, units = 10) {
  await jobs.acceptOffer(driver, offerId, true);
  await jobs.confirmAttendance(biz, offerId, true);
  await work(biz, driver, offerId, units);
}

describe("courier offices: summary and list", () => {
  it("counts offices by verification state, suspensions, affiliated drivers and pending agreements", async () => {
    const admin = await mkAdmin();
    const ok = await mkOffice(); // verified, agreement accepted
    await mkOffice({ verified: false, agreement: false }); // pending verification, no agreement
    const rejected = await mkOffice({ verified: false }); await db.update(officeProfiles).set({ verificationStatus: "rejected" }).where(eq(officeProfiles.userId, rejected.id));
    const banned = await mkOffice(); await db.update(users).set({ status: "suspended" }).where(eq(users.id, banned.id));
    const asking = await mkOffice({ agreement: false }); await db.insert(officeAgreements).values({ officeId: asking.id, status: "pending_acceptance", version: 1 });
    await mkDriver({ officeId: ok.id }); await mkDriver({ officeId: ok.id }); await mkDriver();
    const t = await tok(admin);
    const s = await get("/admin/offices/summary", t);
    expect(s.status).toBe(200);
    expect(s.json).toMatchObject({ offices: 5, verified: 3, review: 1, rejected: 1, suspended: 1, pendingAgreements: 1, noAgreement: 1, drivers: 2 });
  });

  it("filters by state, agreement and text; pages with a total; newest first", async () => {
    const admin = await mkAdmin(); const t = await tok(admin);
    const a = await mkOffice(); const b = await mkOffice({ verified: false, agreement: false });
    await db.update(officeProfiles).set({ officeName: "Zamzam Express", crNumber: "7001234567" }).where(eq(officeProfiles.userId, a.id));
    const all = await get("/admin/offices", t);
    expect(all.json).toMatchObject({ total: 2, page: 1, pageSize: 25 });
    expect(all.json.items.map((i: any) => i.id)).toEqual([b.id, a.id]);
    expect((await get("/admin/offices?state=review", t)).json.items.map((i: any) => i.id)).toEqual([b.id]);
    expect((await get("/admin/offices?state=verified", t)).json.items.map((i: any) => i.id)).toEqual([a.id]);
    expect((await get("/admin/offices?agreement=none", t)).json.items.map((i: any) => i.id)).toEqual([b.id]);
    expect((await get("/admin/offices?q=zamzam", t)).json.total).toBe(1);
    expect((await get("/admin/offices?q=7001234", t)).json.total).toBe(1); // CR number
    expect((await get("/admin/offices?q=100%25", t)).json.total).toBe(0); // wildcards are literal
    expect((await get("/admin/offices?pageSize=1&page=2", t)).json.items).toHaveLength(1);
    expect((await get("/admin/offices?state=nonsense", t)).status).toBe(422);
  });

  it("each row carries drivers, active jobs, the agreement and — only for money-capable staff — the pending payout", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const office = await mkOffice(); const d = await mkDriver({ officeId: office.id }); const biz = await mkBusiness({ fundsCents: 2000_00 });
    const r1 = await publishedRequest(biz); const [o1] = await db.select().from(offers).where(eq(offers.requestId, r1.id));
    await completeJob(biz, d, o1.id);
    const r2 = await publishedRequest(biz, { startsAt: new Date(Date.now() + 3 * 864e5) }); const [o2] = await db.select().from(offers).where(eq(offers.requestId, r2.id));
    await jobs.acceptOffer(d, o2.id, true); // busy now
    const row = (await get("/admin/offices", await tok(admin))).json.items[0];
    expect(row).toMatchObject({ id: office.id, drivers: 1, availableDrivers: 1, activeJobs: 1, agreementStatus: "accepted", pendingPayoutCents: 0 });
    // a settlement that is not paid yet counts as a pending payout
    await db.update(settlements).set({ status: "pending_review", paidAt: null }).where(eq(settlements.officeId, office.id));
    const [s] = await db.select().from(settlements).where(eq(settlements.officeId, office.id));
    expect((await get("/admin/offices", await tok(admin))).json.items[0].pendingPayoutCents).toBe(s.providerCents);
    expect((await get("/admin/offices", await tok(await mkStaff(["offices.view"])))).json.items[0].pendingPayoutCents).toBe(s.providerCents);
    expect((await get("/admin/offices", await tok(await mkStaff(["users.view"])))).json.items[0].pendingPayoutCents).toBeNull(); // no money for support-type staff
  });

  it("is refused to staff without any office-related permission and to non-staff", async () => {
    const support = await mkStaff(["tickets.view"]); const drv = await mkDriver();
    for (const p of ["/admin/offices/summary", "/admin/offices"]) {
      expect((await get(p, await tok(support))).status).toBe(403);
      expect((await get(p, await tok(drv))).status).toBe(403);
    }
    for (const perm of ["offices.view", "offices.manage", "users.view", "verification.manage"]) expect((await get("/admin/offices/summary", await tok(await mkStaff([perm])))).status).toBe(200);
  });

  it("`/summary` is not swallowed by `/:id`", async () => {
    const t = await tok(await mkAdmin());
    const r = await get("/admin/offices/summary", t);
    expect(r.status).toBe(200); expect(r.json).toHaveProperty("offices");
  });
});

describe("courier office detail", () => {
  it("returns profile, readiness, counts, agreement and money for an office manager", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const office = await mkOffice(); const d = await mkDriver({ officeId: office.id }); const biz = await mkBusiness({ fundsCents: 1000_00 });
    const r = await publishedRequest(biz); const [o] = await db.select().from(offers).where(eq(offers.requestId, r.id));
    await completeJob(biz, d, o.id);
    const res = await get(`/admin/offices/${office.id}`, await tok(admin));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      id: office.id, status: "active", verificationStatus: "verified", readiness: { ready: true, issues: [] },
      counts: { drivers: 1, availableDrivers: 1, onJob: 0, activeJobs: 0, completedJobs: 1 },
      agreement: { version: 1, status: "accepted" }, documents: { required: 2, approved: 0, total: 0 },
    });
    expect(res.json.money.paidCount).toBe(1);
    expect(res.json.money.walletAvailableCents).toBe(res.json.money.paidCents);
    expect(res.json.money.paidCents).toBeGreaterThan(0);
  });

  it("explains why an office cannot receive jobs", async () => {
    const admin = await mkAdmin(); const t = await tok(admin);
    const fresh = await mkOffice({ verified: false, agreement: false });
    expect((await get(`/admin/offices/${fresh.id}`, t)).json.readiness).toEqual({ ready: false, issues: ["not_verified", "no_agreement"] });
    await db.insert(officeAgreements).values({ officeId: fresh.id, status: "pending_acceptance", version: 1 });
    expect((await get(`/admin/offices/${fresh.id}`, t)).json.readiness.issues).toEqual(["not_verified", "agreement_pending"]);
    const expired = await mkOffice({ agreement: false });
    await db.insert(officeAgreements).values({ officeId: expired.id, status: "accepted", version: 1, acceptedAt: new Date(), expiresAt: new Date(Date.now() - 86400_000) });
    expect((await get(`/admin/offices/${expired.id}`, t)).json.readiness.issues).toEqual(["agreement_expired"]);
    const banned = await mkOffice(); await db.update(users).set({ status: "suspended" }).where(eq(users.id, banned.id));
    expect((await get(`/admin/offices/${banned.id}`, t)).json.readiness).toEqual({ ready: false, issues: ["suspended"] });
  });

  it("withholds phone, IBAN and bank unless the staff member holds drivers.sensitive, and money unless finance-capable", async () => {
    const office = await mkOffice();
    const plain = await mkStaff(["users.view"]); const sensitive = await mkStaff(["users.view", "drivers.sensitive"]);
    const a = (await get(`/admin/offices/${office.id}`, await tok(plain))).json;
    expect(a.iban).toBeUndefined(); expect(a.bankName).toBeUndefined(); expect(a.phone).toContain("•••"); expect(a.money).toBeNull(); expect(a.documents).toBeNull();
    const b = (await get(`/admin/offices/${office.id}`, await tok(sensitive))).json;
    expect(b.iban).toBe("SA0380000000608010167519"); expect(b.phone).toBe((await db.select().from(users).where(eq(users.id, office.id)))[0].phone);
    const reviewer = await mkStaff(["offices.view", "documents.review"]);
    expect((await get(`/admin/offices/${office.id}`, await tok(reviewer))).json.documents).toMatchObject({ required: 2 });
  });

  it("is 404 for unknown ids, for ids that are not offices and for malformed ids", async () => {
    const t = await tok(await mkAdmin()); const drv = await mkDriver();
    for (const id of [FAKE, drv.id, "not-a-uuid"]) expect((await get(`/admin/offices/${id}`, t)).status).toBe(404);
  });

  it("lists the office's drivers with filters and masked phones", async () => {
    const t = await tok(await mkAdmin()); const office = await mkOffice(); const other = await mkOffice();
    const a = await mkDriver({ officeId: office.id, name: "Ali Courier" }); const b = await mkDriver({ officeId: office.id, verified: false, name: "Basim New" }); await mkDriver({ officeId: other.id });
    await db.update(driverProfiles).set({ suspendedUntil: new Date(Date.now() + 86400_000) }).where(eq(driverProfiles.userId, a.id));
    const list = (qs = "", token = t) => get(`/admin/offices/${office.id}/drivers${qs}`, token);
    expect((await list()).json.total).toBe(2);
    expect((await list("?state=pending")).json.items.map((i: any) => i.id)).toEqual([b.id]);
    expect((await list("?state=suspended")).json.items.map((i: any) => i.id)).toEqual([a.id]);
    expect((await list("?state=available")).json.total).toBe(0); // a is suspended, b is unverified
    expect((await list("?q=basim")).json.total).toBe(1);
    const manager = await tok(await mkStaff(["offices.view"]));
    const row = (await list("?q=ali", manager)).json.items[0];
    expect(row).toMatchObject({ office: expect.any(String), officeId: office.id, onJob: false });
    expect(row.phone).toContain("•");
    const sensitive = await tok(await mkStaff(["offices.view", "drivers.sensitive"]));
    expect((await list("?q=ali", sensitive)).json.items[0].phone).not.toContain("•");
    expect((await list("", await tok(await mkStaff(["users.view"])))).status).toBe(403);
  });

  it("lists jobs by scope and payouts by status, each with a total", async () => {
    const admin = await mkAdmin(); await mkRule(admin); const t = await tok(admin);
    const office = await mkOffice(); const d = await mkDriver({ officeId: office.id }); const biz = await mkBusiness({ fundsCents: 2000_00 });
    const r1 = await publishedRequest(biz); const [o1] = await db.select().from(offers).where(eq(offers.requestId, r1.id));
    await completeJob(biz, d, o1.id);
    const r2 = await publishedRequest(biz, { startsAt: new Date(Date.now() + 3 * 864e5) }); const [o2] = await db.select().from(offers).where(eq(offers.requestId, r2.id));
    await jobs.acceptOffer(d, o2.id, true);
    const jobsOf = (qs = "") => get(`/admin/offices/${office.id}/jobs${qs}`, t);
    expect((await jobsOf()).json.total).toBe(2);
    expect((await jobsOf("?scope=completed")).json.items.map((i: any) => i.offerId)).toEqual([o1.id]);
    expect((await jobsOf("?scope=active")).json.items.map((i: any) => i.offerId)).toEqual([o2.id]);
    expect((await jobsOf("?scope=issues")).json.total).toBe(0);
    expect((await jobsOf()).json.items[0]).toMatchObject({ driver: d.name, driverId: d.id, businessId: biz.id, status: expect.any(String) });
    const pay = (qs = "") => get(`/admin/offices/${office.id}/settlements${qs}`, t);
    expect((await pay()).json.total).toBe(1);
    expect((await pay("?status=paid")).json.items[0]).toMatchObject({ status: "paid", driverId: d.id });
    expect((await pay("?status=pending")).json.total).toBe(0);
    await db.update(settlements).set({ status: "pending_review", paidAt: null }).where(eq(settlements.officeId, office.id));
    expect((await pay("?status=pending")).json.total).toBe(1);
    expect((await pay("?status=paid")).json.total).toBe(0);
    // payouts are money: office managers and finance staff only
    expect((await pay()).status).toBe(200);
    expect((await get(`/admin/offices/${office.id}/settlements`, await tok(await mkStaff(["users.view"])))).status).toBe(403);
    expect((await get(`/admin/offices/${office.id}/settlements`, await tok(await mkStaff(["finance.view"])))).status).toBe(200);
    expect((await get(`/admin/offices/${office.id}/jobs`, await tok(await mkStaff(["verification.manage"])))).status).toBe(403);
  });
});

describe("drivers: summary, directory and detail", () => {
  it("summary and directory agree on available / pending / suspended", async () => {
    const t = await tok(await mkAdmin()); const office = await mkOffice();
    const free = await mkDriver({ officeId: office.id }); await mkDriver(); await mkDriver({ available: false });
    const pending = await mkDriver({ verified: false });
    const timed = await mkDriver(); await db.update(driverProfiles).set({ suspendedUntil: new Date(Date.now() + 86400_000) }).where(eq(driverProfiles.userId, timed.id));
    const banned = await mkDriver(); await db.update(users).set({ status: "suspended" }).where(eq(users.id, banned.id));
    const s = (await get("/admin/drivers-summary", t)).json;
    expect(s).toMatchObject({ total: 6, available: 2, pending: 1, suspended: 2, withOffice: 1, direct: 5 });
    const ids = async (qs: string) => (await get(`/admin/drivers-list${qs}`, t)).json;
    expect((await ids("?state=available")).total).toBe(s.available);
    expect((await ids("?state=pending")).items.map((i: any) => i.id)).toEqual([pending.id]);
    expect((await ids("?state=suspended")).total).toBe(s.suspended);
    expect((await ids("?link=office")).items.map((i: any) => i.id)).toEqual([free.id]);
    expect((await ids("?link=direct")).total).toBe(5);
    expect((await ids(`?officeId=${office.id}`)).total).toBe(1);
    expect((await ids("?officeId=not-a-uuid")).error?.code).toBe("VALIDATION");
    expect((await ids("?pageSize=2&page=3")).items).toHaveLength(2);
  });

  it("masks phones and needs drivers.view", async () => {
    await mkDriver({ name: "Hassan Kareem" });
    const viewer = await tok(await mkStaff(["drivers.view"]));
    const row = (await get("/admin/drivers-list?q=hassan", viewer)).json.items[0];
    expect(row).toMatchObject({ name: "Hassan Kareem", office: null, officeId: null, onJob: false });
    expect(row.phone).toContain("•");
    expect((await get("/admin/drivers-list", await tok(await mkStaff(["users.view"])))).status).toBe(403);
    expect((await get("/admin/drivers-summary", await tok(await mkStaff(["users.view"])))).status).toBe(403);
  });

  it("overview adds the office, join date and the cancellations behind the strikes", async () => {
    const admin = await mkAdmin(); await mkRule(admin); const t = await tok(admin);
    const office = await mkOffice(); const d = await mkDriver({ officeId: office.id }); const biz = await mkBusiness({ fundsCents: 1000_00 });
    const r = await publishedRequest(biz); const [o] = await db.select().from(offers).where(eq(offers.requestId, r.id));
    await db.insert(jobEvents).values({ requestId: r.id, offerId: o.id, actorId: d.id, actorRole: "driver", type: "driver_cancelled", payload: { reason: "Van broke down" } });
    const res = await get(`/admin/drivers/${d.id}/overview`, t);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: d.id, officeId: office.id, office: expect.any(String), createdAt: expect.any(String) });
    expect(res.json.strikes).toMatchObject({ policyEnabled: true, warnAt: 2, suspendAt: 4, windowDays: 7 });
    expect(res.json.strikes.recent).toEqual([expect.objectContaining({ ref: r.ref, reason: "Van broke down", requestId: r.id })]);
    expect((await get(`/admin/drivers/${FAKE}/overview`, t)).status).toBe(404);
    expect((await get(`/admin/drivers/${office.id}/overview`, t)).status).toBe(404); // an office is not a driver
    expect((await get(`/admin/drivers/not-a-uuid/overview`, t)).status).toBe(404);
    expect((await get(`/admin/drivers/${d.id}/overview`, await tok(await mkStaff(["offices.view"])))).status).toBe(403);
  });

  it("driver jobs are filterable and paged; the wallet view needs a finance permission", async () => {
    const admin = await mkAdmin(); await mkRule(admin); const t = await tok(admin);
    const d = await mkDriver(); const biz = await mkBusiness({ fundsCents: 1000_00 });
    const r = await publishedRequest(biz); const [o] = await db.select().from(offers).where(eq(offers.requestId, r.id));
    await completeJob(biz, d, o.id);
    const jobsOf = (qs = "") => get(`/admin/drivers/${d.id}/jobs${qs}`, t);
    expect((await jobsOf()).json).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect((await jobsOf("?scope=completed")).json.items[0]).toMatchObject({ ref: r.ref, status: "completed", businessId: biz.id });
    expect((await jobsOf("?scope=issues")).json.total).toBe(0);
    const w = (await get(`/admin/drivers/${d.id}/wallet`, t)).json;
    expect(w.wallet.availableCents).toBeGreaterThan(0);
    expect(w.earnings.paidCents).toBe(w.wallet.availableCents); expect(w.earnings.viaOfficePaidCents).toBe(0);
    expect(w.entries.length).toBeGreaterThan(0);
    expect((await get(`/admin/drivers/${d.id}/wallet`, await tok(await mkStaff(["drivers.view"])))).status).toBe(403);
    expect((await get(`/admin/drivers/${d.id}/wallet`, await tok(await mkStaff(["wallets.view"])))).status).toBe(200);
    expect((await get(`/admin/drivers/${d.id}/jobs`, await tok(await mkStaff(["users.view"])))).status).toBe(200);
  });

  it("earnings of an office driver are reported as paid via the office, not to the driver's wallet", async () => {
    const admin = await mkAdmin(); await mkRule(admin); const t = await tok(admin);
    const office = await mkOffice(); const d = await mkDriver({ officeId: office.id }); const biz = await mkBusiness({ fundsCents: 1000_00 });
    const r = await publishedRequest(biz); const [o] = await db.select().from(offers).where(eq(offers.requestId, r.id));
    await completeJob(biz, d, o.id);
    const w = (await get(`/admin/drivers/${d.id}/wallet`, t)).json;
    expect(w.wallet.availableCents).toBe(0); expect(w.earnings.paidCents).toBe(0); expect(w.earnings.viaOfficePaidCents).toBeGreaterThan(0);
  });
});

describe("accounts directory summary", () => {
  it("counts accounts per role with suspended and awaiting-verification numbers", async () => {
    const admin = await mkAdmin(); const t = await tok(admin);
    await mkBusiness(); await mkBusiness({ verified: false }); await mkDriver(); await mkDriver({ verified: false }); await mkOffice({ verified: false });
    const stopped = await mkDriver(); await db.update(users).set({ status: "suspended" }).where(eq(users.id, stopped.id));
    await mkStaff(["users.view"]);
    const s = (await get("/admin/accounts-summary", t)).json;
    expect(s.roles.business).toEqual({ total: 2, suspended: 0, review: 1 });
    expect(s.roles.driver).toEqual({ total: 3, suspended: 1, review: 1 });
    expect(s.roles.office).toEqual({ total: 1, suspended: 0, review: 1 });
    expect(s.roles.staff.total).toBe(1); expect(s.roles.admin.total).toBe(1);
    expect(s).toMatchObject({ total: 8, suspended: 1 });
    expect((await get("/admin/accounts-summary", await tok(await mkStaff(["drivers.view"])))).status).toBe(403);
    expect((await get("/admin/accounts-summary", await tok(await mkStaff(["users.view"])))).status).toBe(200);
  });
});
