/**
 * Driver and courier-office detail views (`routes/admin-details-2.ts`, `server/details-people*.ts`, decisions G6–G7).
 * Covers: KPIs and charts of a period, the jobs / parcels / reviews lists, location + availability, money, documents, security, the raw record, the office scorecard,
 * link history, job log and agreement history — each with its permissions (money = finance, personal data = drivers.sensitive) and 404 for unknown ids.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs, documents, driverAvailabilityLog, driverLocationHistory, driverProfiles, loginEvents, officeAgreements, officeInvites, offers, ratings, sessions, settlements, shipments, tickets, users, withdrawals,
} from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkStaff, mkBusiness, mkDriver, mkOffice, mkRule, publishedRequest } from "../helpers/factories";
import { work, parcelsOf } from "../helpers/work";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import * as jobs from "@/server/jobs";

beforeEach(resetDb);
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "mobile")).token;
const get = (path: string, token: string) => call("GET", path, { token });
const FAKE = "00000000-0000-4000-8000-000000000000";
const kpi = (json: any, key: string) => json.kpis.find((k: any) => k.key === key);

/** An office with one driver who completed one job (some parcels delivered, some refused), plus a second, direct driver. */
async function world(opts: { refuse?: boolean } = {}) {
  const admin = await mkAdmin(); await mkRule(admin);
  const office = await mkOffice(); const d = await mkDriver({ officeId: office.id, name: "Tariq Detail" }); const biz = await mkBusiness({ fundsCents: 5000_00, name: "Detail Biz" });
  const r = await publishedRequest(biz); const [o] = await db.select().from(offers).where(eq(offers.requestId, r.id));
  await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
  await work(biz, d, o.id, opts.refuse ? 1 : 10);
  const ps = await parcelsOf(o.id);
  return { admin, office, d, biz, r, o, t: await tok(admin), delivered: ps.filter((p) => p.status === "delivered").length, total: ps.length };
}

describe("driver standing and insights", () => {
  it("the KPI strip counts the finished job and its parcels, compares with the previous period and zero-fills the series", async () => {
    const w = await world();
    const res = await get(`/admin/drivers/${w.d.id}/insights?period=30d`, w.t);
    expect(res.status).toBe(200);
    expect(res.json.period).toMatchObject({ key: "30d", days: 30, bucket: "day" }); expect(res.json.period.prevFrom).toBeTruthy();
    expect(res.json.series).toHaveLength(30); expect(res.json.prevSeries).toHaveLength(30);
    expect(kpi(res.json, "drv_jobs")).toMatchObject({ value: 1, prev: 0 }); expect(kpi(res.json, "drv_parcels").value).toBe(w.delivered);
    expect(kpi(res.json, "drv_success").value).toBeCloseTo(w.delivered / w.total, 5); expect(kpi(res.json, "drv_earnings").value).toBeGreaterThan(0); expect(kpi(res.json, "drv_earnings_life").value).toBe(kpi(res.json, "drv_earnings").value);
    expect(res.json.series.reduce((n: number, p: any) => n + p.delivered, 0)).toBe(w.delivered); expect(res.json.series.reduce((n: number, p: any) => n + p.jobs, 0)).toBe(1);
    expect(res.json.heatmap).toHaveLength(7); expect(res.json.heatmap[0]).toHaveLength(24); expect(res.json.heatmap.flat().reduce((a: number, b: number) => a + b, 0)).toBe(w.total);
    expect(res.json.response.buckets).toHaveLength(6); expect(res.json.cities.length).toBeGreaterThan(0); expect(res.json.companies[0]).toMatchObject({ id: w.biz.id, jobs: 1 });
    expect(res.json.moneyHidden).toBe(false);
  });
  it("failed parcels lower the success rate and show their reason", async () => {
    const w = await world({ refuse: true });
    const res = await get(`/admin/drivers/${w.d.id}/insights`, w.t);
    expect(w.total - w.delivered).toBeGreaterThan(0);
    expect(kpi(res.json, "drv_success").value).toBeCloseTo(w.delivered / w.total, 5); expect(kpi(res.json, "drv_first_attempt").value).toBe(1);
    expect(res.json.failures.find((f: any) => f.reason === "refused")?.count).toBe(w.total - w.delivered);
  });
  it("other periods: 12 months uses weeks, all time has no comparison, an unknown period is rejected", async () => {
    const w = await world();
    const y = (await get(`/admin/drivers/${w.d.id}/insights?period=12m`, w.t)).json; expect(y.period.bucket).toBe("week"); expect(y.period.prevFrom).toBeTruthy();
    const all = (await get(`/admin/drivers/${w.d.id}/insights?period=all`, w.t)).json; expect(all.period.prevFrom).toBeNull(); expect(all.prevSeries).toBeNull(); expect(kpi(all, "drv_jobs").value).toBe(1); expect(kpi(all, "drv_jobs").prev).toBeNull();
    expect((await get(`/admin/drivers/${w.d.id}/insights?period=7d`, w.t)).status).toBe(422);
  });
  it("a driver with no work yet shows 'no data', never 0 %", async () => {
    const admin = await mkAdmin(); const d = await mkDriver(); const res = await get(`/admin/drivers/${d.id}/insights`, await tok(admin));
    expect(res.status).toBe(200); expect(res.json.empty).toBe(true);
    for (const k of ["drv_success", "drv_first_attempt", "drv_on_time", "drv_acceptance", "drv_rating", "drv_response", "drv_online", "drv_utilisation"]) expect(kpi(res.json, k).value, k).toBeNull();
    expect(kpi(res.json, "drv_jobs").value).toBe(0);
  });
  it("online hours and utilisation come from the availability log and the job's arrival → delivery time", async () => {
    const w = await world(); const h = 3600_000;
    await db.insert(driverAvailabilityLog).values({ driverId: w.d.id, fromStatus: null, toStatus: "available", source: "driver", reason: "manual", at: new Date(Date.now() - 6 * h) });
    await db.update(offers).set({ arrivedAt: new Date(Date.now() - 3 * h), deliveredAt: new Date(Date.now() - 1 * h), finalAt: new Date(Date.now() - 1 * h) }).where(eq(offers.id, w.o.id));
    const res = (await get(`/admin/drivers/${w.d.id}/insights`, w.t)).json;
    expect(kpi(res, "drv_online").value).toBeGreaterThan(5.9 * 3600); expect(kpi(res, "drv_online").value).toBeLessThan(6.1 * 3600);
    expect(kpi(res, "drv_utilisation").value).toBeGreaterThan(0.3); expect(kpi(res, "drv_utilisation").value).toBeLessThan(0.37); // 2 h on the job out of 6 h available
    const office = (await get(`/admin/offices/${w.office.id}/insights`, w.t)).json;
    expect(kpi(office, "ofc_utilisation").value).toBeGreaterThan(0.3); expect(kpi(office, "ofc_utilisation").value).toBeLessThan(0.37); expect(office.utilisation).toMatchObject({ drivers: 1 });
  });
  it("without any availability record the time is 'no data', not 0 % and not 100 %", async () => {
    const w = await world(); const res = (await get(`/admin/drivers/${w.d.id}/insights`, w.t)).json;
    expect(kpi(res, "drv_online").value).toBeNull(); expect(kpi(res, "drv_utilisation").value).toBeNull();
    expect(kpi((await get(`/admin/offices/${w.office.id}/insights`, w.t)).json, "ofc_utilisation").value).toBeNull();
  });
  it("money needs finance.view: the KPIs are left out, not zeroed", async () => {
    const w = await world(); const ops = await tok(await mkStaff(["drivers.view"]));
    const res = await get(`/admin/drivers/${w.d.id}/insights`, ops);
    expect(res.status).toBe(200); expect(res.json.moneyHidden).toBe(true);
    for (const k of ["drv_earnings", "drv_earnings_life", "drv_cash_held"]) expect(kpi(res.json, k)).toBeUndefined();
    expect(kpi(res.json, "drv_jobs").value).toBe(1);
    const cash = await tok(await mkStaff(["drivers.view", "cod.manage"])); expect(kpi((await get(`/admin/drivers/${w.d.id}/insights`, cash)).json, "drv_cash_held")).toBeDefined();
  });
  it("standing: last activity, strikes with the suspension trail, documents and risk flags", async () => {
    const w = await world();
    await db.update(users).set({ lastSeenAt: new Date(), lastLoginAt: new Date(), loginCount: 3, lastLoginIp: "10.0.0.7", lastLoginClient: "mobile" }).where(eq(users.id, w.d.id));
    await db.insert(auditLogs).values({ actorId: w.admin.id, actorRole: "admin", action: "user.suspended", entity: "user", entityId: w.d.id, diff: { reason: "Repeated complaints" } });
    await db.insert(documents).values({ ownerId: w.d.id, ownerKind: "driver", type: "driving_license", storageKey: "k", fileName: "l.pdf", mime: "application/pdf", size: 10, status: "approved", expiresOn: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) });
    const s = (await get(`/admin/drivers/${w.d.id}/standing`, w.t)).json;
    expect(s).toMatchObject({ id: w.d.id, loginCount: 3, lastLoginClient: "mobile", lastLoginIp: "10.0.0.7", lifetime: { completed: 1 }, strikes: { enabled: true, count: 0 } });
    expect(s.suspension.trail[0]).toMatchObject({ action: "user.suspended", reason: "Repeated complaints" });
    expect(s.documents.items[0]).toMatchObject({ type: "driving_license", status: "approved" }); expect(s.documents.items[0].daysLeft).toBeLessThanOrEqual(5);
    expect(s.risks.map((r: any) => r.key)).toContain("expiring_docs");
    const plain = (await get(`/admin/drivers/${w.d.id}/standing`, await tok(await mkStaff(["drivers.view"])))).json;
    expect(plain.lastLoginIp).toBeNull(); expect(plain.cash).toBeNull(); expect(plain.documents).toBeNull(); // IP, cash and documents each need their own permission
  });
  it("flags a driver with repeated no-shows, and counts them (with cancellations) in the KPI", async () => {
    const w = await world();
    for (let i = 0; i < 2; i++) await db.insert(offers).values({ requestId: w.r.id, driverId: w.d.id, officeId: w.office.id, status: "no_show", source: "manual", expectedUnits: 1, expectedEarningCents: 0, acceptedAt: new Date(), cancelledAt: new Date() });
    const s = (await get(`/admin/drivers/${w.d.id}/standing`, w.t)).json;
    expect(s.lifetime.noShow).toBe(2); expect(s.risks.find((r: any) => r.key === "high_no_show")).toMatchObject({ level: "danger", params: { n: 2 } });
    expect(kpi((await get(`/admin/drivers/${w.d.id}/insights`, w.t)).json, "drv_cancels")).toMatchObject({ value: 2, parts: [{ key: "cancelled", value: 0 }, { key: "no_show", value: 2 }] });
  });
  it("is 404 for unknown ids, offices and malformed ids, and 403 without driver permissions", async () => {
    const w = await world();
    for (const p of ["standing", "insights", "offers", "parcels", "reviews", "location", "documents-log", "security", "raw", "money"]) {
      for (const id of [FAKE, w.office.id, "not-a-uuid"]) expect((await get(`/admin/drivers/${id}/${p}`, w.t)).status, `${p} ${id}`).toBe(404);
      expect((await get(`/admin/drivers/${w.d.id}/${p}`, await tok(await mkStaff(["tickets.view"])))).status, p).toBe(403);
      expect((await get(`/admin/drivers/${w.d.id}/${p}`, await tok(w.d))).status, p).toBe(403);
    }
  });
});

describe("driver jobs, parcels and reviews", () => {
  it("lists every offer with its timeline, counts per group, search and earnings only for finance", async () => {
    const w = await world();
    const all = (await get(`/admin/drivers/${w.d.id}/offers`, w.t)).json;
    expect(all).toMatchObject({ total: 1, counts: { all: 1, completed: 1, active: 0, cancelled: 0, no_show: 0, declined: 0 } });
    expect(all.items[0]).toMatchObject({ offerId: w.o.id, requestId: w.r.id, driverId: w.d.id, status: "completed", businessId: w.biz.id, business: expect.any(String), parcels: { total: w.total, delivered: w.delivered } });
    expect(all.items[0].timeline.offeredAt).toBeTruthy(); expect(all.items[0].timeline.acceptedAt).toBeTruthy(); expect(all.items[0].timeline.attendanceAt).toBeTruthy(); expect(all.items[0].timeline.finalAt).toBeTruthy();
    expect(all.items[0].earningCents).toBeGreaterThan(0); expect(all.items[0].settlementStatus).toBeTruthy();
    expect((await get(`/admin/drivers/${w.d.id}/offers?group=completed`, w.t)).json.total).toBe(1);
    expect((await get(`/admin/drivers/${w.d.id}/offers?group=no_show`, w.t)).json.total).toBe(0);
    expect((await get(`/admin/drivers/${w.d.id}/offers?q=ZZZ-no-match`, w.t)).json.total).toBe(0);
    expect((await get(`/admin/drivers/${w.d.id}/offers?q=${w.r.ref}`, w.t)).json.total).toBe(1);
    expect((await get(`/admin/drivers/${w.d.id}/offers?group=nonsense`, w.t)).status).toBe(422);
    expect((await get(`/admin/drivers/${w.d.id}/offers?period=30d&pageSize=1&page=2`, w.t)).json.items).toHaveLength(0);
    const ops = (await get(`/admin/drivers/${w.d.id}/offers`, await tok(await mkStaff(["drivers.view"])))).json.items[0];
    expect(ops.earningCents).toBeUndefined(); expect(ops.settlementId).toBeUndefined();
  });
  it("lists parcels with outcome and reason, filters, and exports CSV only with reports.export (audited)", async () => {
    const w = await world({ refuse: true });
    const list = (qs = "", token = w.t) => get(`/admin/drivers/${w.d.id}/parcels${qs}`, token);
    const all = (await list()).json;
    expect(all.total).toBe(w.total); expect(all.counts.delivered).toBe(w.delivered); expect(all.counts.failed + all.counts.returned).toBe(w.total - w.delivered);
    expect((await list("?group=delivered")).json.items.every((p: any) => p.status === "delivered" && p.deliveredAt)).toBe(true);
    const bad = (await list("?reason=refused")).json; expect(bad.total).toBe(w.total - w.delivered); expect(bad.items[0].failReason).toBe("refused"); expect(bad.reasons[0]).toMatchObject({ reason: "refused" });
    expect((await list("?q=zzzz")).json.total).toBe(0);
    expect((await list("?format=csv", await tok(await mkStaff(["drivers.view"])))).status).toBe(403);
    const csv = await list("?format=csv"); expect(csv.status).toBe(200); expect(csv.headers.get("content-type")).toContain("text/csv");
    const lines = csv.text.replace(/^﻿/, "").split("\n"); expect(lines[0]).toBe("code,order_ref,business,recipient,city,status,attempts,fail_reason,fail_note,arrived_at,delivered_at,failed_at,returned_at,cod_cents,cod_collected_cents"); expect(lines).toHaveLength(w.total + 1);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "report.export"))).some((a) => a.entity === "driver_parcels" && a.entityId === w.d.id)).toBe(true);
  });
  it("ratings with who gave them, the star filter and support items — hidden without the support permissions", async () => {
    const w = await world();
    await db.insert(ratings).values({ offerId: w.o.id, raterId: w.biz.id, rateeId: w.d.id, stars: 2, comment: "Late again" });
    await db.insert(tickets).values({ ref: "T-1", openedBy: w.d.id, category: "payment_issue", subject: "Where is my payout", offerId: w.o.id });
    const res = (await get(`/admin/drivers/${w.d.id}/reviews`, w.t)).json;
    expect(res).toMatchObject({ count: 1, avg: 2, total: 1 }); expect(res.distribution[1]).toMatchObject({ stars: 2, count: 1 }); expect(res.items[0]).toMatchObject({ stars: 2, comment: "Late again", rater: { id: w.biz.id, role: "business" }, ref: expect.any(String) });
    expect(res.tickets).toHaveLength(1); expect(res.tickets[0]).toMatchObject({ ref: "T-1", byDriver: true, subject: "Where is my payout" }); expect(res.complaints).toEqual([]);
    expect((await get(`/admin/drivers/${w.d.id}/reviews?stars=5`, w.t)).json.items).toHaveLength(0);
    const plain = (await get(`/admin/drivers/${w.d.id}/reviews`, await tok(await mkStaff(["drivers.view"])))).json;
    expect(plain.tickets).toBeNull(); expect(plain.complaints).toBeNull(); expect(plain.items).toHaveLength(1);
  });
});

describe("driver location, security, documents and raw record", () => {
  it("location needs drivers.sensitive; it lists days and jobs with GPS samples, the last position and the availability timeline", async () => {
    const w = await world();
    await db.update(driverProfiles).set({ lat: 24.7, lng: 46.6, locationAt: new Date(Date.now() - 120_000) }).where(eq(driverProfiles.userId, w.d.id));
    await db.insert(driverLocationHistory).values([{ driverId: w.d.id, lat: 24.7, lng: 46.6, offerId: w.o.id, recordedAt: new Date(Date.now() - 300_000) }, { driverId: w.d.id, lat: 24.701, lng: 46.601, offerId: w.o.id, recordedAt: new Date(Date.now() - 240_000) }, { driverId: w.d.id, lat: 24.702, lng: 46.602, recordedAt: new Date(Date.now() - 60_000) }]);
    await db.insert(driverAvailabilityLog).values({ driverId: w.d.id, fromStatus: "available", toStatus: "unavailable", source: "system", reason: "cancel_strikes" });
    expect((await get(`/admin/drivers/${w.d.id}/location`, await tok(await mkStaff(["drivers.view"])))).status).toBe(403);
    const res = (await get(`/admin/drivers/${w.d.id}/location`, w.t)).json;
    expect(res.last).toMatchObject({ lat: 24.7, lng: 46.6 }); expect(res.last.ageSeconds).toBeGreaterThanOrEqual(120); expect(res.samples.last31d).toBe(3);
    expect(res.days[0].points).toBe(3); expect(res.jobs[0]).toMatchObject({ offerId: w.o.id, points: 2, ref: expect.any(String) });
    expect(res.availability[0]).toMatchObject({ to: "unavailable", source: "system", reason: "cancel_strikes" });
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "location.view"))).length).toBeGreaterThan(0);
  });
  it("security shows attempts, sessions, devices and messages to sensitive staff only, and is audited", async () => {
    const w = await world();
    await db.insert(loginEvents).values([{ userId: w.d.id, method: "otp", success: true, ip: "10.1.1.1", client: "mobile", userAgent: "okhttp" }, { userId: w.d.id, method: "otp", success: false, failureReason: "invalid_code", ip: "10.1.1.2", client: "mobile" }]);
    await createSession(w.d.id, "mobile");
    const res = (await get(`/admin/drivers/${w.d.id}/security`, w.t)).json;
    expect(res.summary).toMatchObject({ success30: 1, failed30: 1, ips30: 2, failedTotal: 1 }); expect(res.summary.activeSessions).toBeGreaterThanOrEqual(1);
    expect(res.events[0]).toMatchObject({ ip: expect.any(String), client: "mobile" }); expect(res.events.map((e: any) => e.reason)).toContain("invalid_code"); expect(res.devices[0]).toMatchObject({ client: "mobile", logins: 1 }); expect(res.sessions.length).toBeGreaterThanOrEqual(1);
    expect((await get(`/admin/drivers/${w.d.id}/security`, await tok(await mkStaff(["drivers.view"])))).status).toBe(403);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "user.security_view"))).length).toBe(1);
    expect((await db.select().from(sessions).where(eq(sessions.userId, w.d.id))).length).toBeGreaterThanOrEqual(1);
  });
  it("documents: every submission with each decision from the audit log; reviewers only", async () => {
    const w = await world();
    const [doc] = await db.insert(documents).values({ ownerId: w.d.id, ownerKind: "driver", type: "national_id", storageKey: "k", fileName: "id.png", mime: "image/png", size: 2048, status: "approved", reviewNote: "ok", reviewerId: w.admin.id, reviewedAt: new Date() }).returning();
    await db.insert(auditLogs).values([{ actorId: w.admin.id, actorRole: "admin", action: "document.info_requested", entity: "document", entityId: doc.id, diff: { note: "Photo is blurry" }, createdAt: new Date(Date.now() - 60_000) }, { actorId: w.admin.id, actorRole: "admin", action: "document.approved", entity: "document", entityId: doc.id, diff: { note: "ok" } }]);
    const res = (await get(`/admin/drivers/${w.d.id}/documents-log`, w.t)).json;
    expect(res.items).toHaveLength(1); expect(res.items[0].decisions.map((d: any) => d.action)).toEqual(["info_requested", "approved"]); expect(res.items[0].decisions[0].note).toBe("Photo is blurry");
    expect(res.summary).toMatchObject({ total: 1, approved: 1, pending: 0 }); expect(res.summary.missing.map((m: any) => m.type).sort()).toEqual(["driving_license", "vehicle_registration"]);
    expect((await get(`/admin/drivers/${w.d.id}/documents-log`, await tok(await mkStaff(["drivers.view"])))).status).toBe(403);
    expect((await get(`/admin/drivers/${w.d.id}/documents-log`, await tok(await mkStaff(["drivers.view", "documents.review"])))).status).toBe(200);
  });
  it("the raw record never contains secrets and masks personal fields without drivers.sensitive", async () => {
    const w = await world();
    const full = (await get(`/admin/drivers/${w.d.id}/raw`, w.t)).json;
    expect(full.user).not.toHaveProperty("passwordHash"); expect(full.user).not.toHaveProperty("totpSecret"); expect(full.user.id).toBe(w.d.id); expect(full.driverProfile.iban).toBe("SA0380000000608010167519"); expect(full.counts.offers).toBe(1);
    const plain = (await get(`/admin/drivers/${w.d.id}/raw`, await tok(await mkStaff(["drivers.view"])))).json;
    expect(plain.user.phone).toContain("•••"); expect(plain.driverProfile).not.toHaveProperty("iban"); expect(plain.driverProfile).not.toHaveProperty("nationalId"); expect(plain.walletAccountId).toBeNull();
  });
});

describe("money of a driver and of an office", () => {
  it("summary: wallet, earnings pipeline and withdrawals; each part is paged and permission-checked; unknown parts are 404", async () => {
    const w = await world();
    await db.insert(withdrawals).values({ userId: w.d.id, amountCents: 1000, iban: "SA0380000000608010167519", bankName: "Bank", status: "pending" });
    const s = (await get(`/admin/drivers/${w.d.id}/money`, w.t)).json;
    expect(s.wallet).toMatchObject({ availableCents: expect.any(Number) }); expect(s.earnings.paidCount + s.earnings.pendingCount).toBe(1); expect(s.earnings.viaOfficeCents).toBeGreaterThan(0); expect(s.withdrawals).toMatchObject({ total: 1, pendingCount: 1, pendingCents: 1000 });
    expect(s.pipeline.length).toBeGreaterThan(0); expect(s.cod).toMatchObject({ outstandingCents: 0 });
    const part = (p: string, qs = "", token = w.t) => get(`/admin/drivers/${w.d.id}/money/${p}${qs}`, token);
    expect((await part("settlements")).json).toMatchObject({ total: 1, items: [{ driverId: w.d.id, amountCents: expect.any(Number) }] }); expect((await part("settlements", "?status=pending")).json.total).toBe(0);
    expect((await part("withdrawals")).json.items[0]).toMatchObject({ amountCents: 1000, ibanTail: "7519" }); expect((await part("withdrawals")).json.items[0]).not.toHaveProperty("iban");
    expect((await part("ledger")).json.total).toBeGreaterThanOrEqual(0); expect((await part("cod")).json).toMatchObject({ total: expect.any(Number), totals: { outstandingCents: 0 } }); expect((await part("remittances")).json).toMatchObject({ items: expect.any(Array) });
    expect((await part("nonsense")).status).toBe(404);
    const noMoney = await tok(await mkStaff(["drivers.view"]));
    expect((await get(`/admin/drivers/${w.d.id}/money`, noMoney)).status).toBe(403); expect((await part("ledger", "", noMoney)).status).toBe(403);
    const cashOnly = await tok(await mkStaff(["drivers.view", "cod.manage"]));
    const cs = (await get(`/admin/drivers/${w.d.id}/money`, cashOnly)).json; expect(cs.wallet).toBeNull(); expect(cs.earnings).toBeNull(); expect(cs.cod).not.toBeNull(); expect((await part("cod", "", cashOnly)).status).toBe(200); expect((await part("settlements", "", cashOnly)).status).toBe(403);
  });
  it("an office's money has no cash parts and lists the settlements with the driver", async () => {
    const w = await world();
    const s = (await get(`/admin/offices/${w.office.id}/money`, w.t)).json; expect(s.earnings.paidCount + s.earnings.pendingCount).toBe(1); expect(s.cod).toBeNull(); expect(s.wallet.availableCents).toBeGreaterThan(0);
    const st = (await get(`/admin/offices/${w.office.id}/money/settlements`, w.t)).json; expect(st.items[0]).toMatchObject({ driverId: w.d.id, driver: "Tariq Detail" });
    expect((await get(`/admin/offices/${w.office.id}/money/cod`, w.t)).status).toBe(404); expect((await get(`/admin/offices/${w.office.id}/money/remittances`, w.t)).status).toBe(404);
    expect((await get(`/admin/offices/${w.office.id}/money`, await tok(await mkStaff(["users.view"])))).status).toBe(403);
    expect((await get(`/admin/offices/${w.office.id}/money`, await tok(await mkStaff(["offices.view"])))).status).toBe(200);
  });
});

describe("courier office insights, scorecard, history, jobs and agreements", () => {
  it("insights: the office KPIs, the funnel, the contribution of its drivers and the companies it served", async () => {
    const w = await world();
    const res = await get(`/admin/offices/${w.office.id}/insights?period=30d`, w.t);
    expect(res.status).toBe(200);
    expect(kpi(res.json, "ofc_drivers")).toMatchObject({ value: 1, parts: [{ key: "available" }, { key: "on_job", value: 0 }] }); expect(kpi(res.json, "ofc_jobs").value).toBe(1); expect(kpi(res.json, "ofc_parcels").value).toBe(w.delivered);
    expect(kpi(res.json, "ofc_earnings").value).toBeGreaterThan(0); expect(kpi(res.json, "ofc_agreement_age").value).toBeGreaterThanOrEqual(0); expect(kpi(res.json, "ofc_turnover").value).toBeNull(); // nobody worked in the previous period
    expect(res.json.funnel.map((f: any) => f.key)).toEqual(["offered", "accepted", "arrived", "completed"]); expect(res.json.funnel[3].count).toBe(1);
    expect(res.json.contribution.rows[0]).toMatchObject({ id: w.d.id, value: w.delivered, share: 1, cumulative: 1 }); expect(res.json.companies[0].id).toBe(w.biz.id); expect(res.json.series).toHaveLength(30);
    const plain = (await get(`/admin/offices/${w.office.id}/insights`, await tok(await mkStaff(["users.view"])))).json;
    expect(plain.moneyHidden).toBe(true); for (const k of ["ofc_earnings", "ofc_paid", "ofc_pending"]) expect(kpi(plain, k)).toBeUndefined();
    expect((await get(`/admin/offices/${w.office.id}/insights?period=all`, w.t)).json.period.prevFrom).toBeNull();
  });
  it("turnover counts drivers who worked for the office last period and have since left", async () => {
    const w = await world();
    await db.update(offers).set({ acceptedAt: new Date(Date.now() - 45 * 864e5) }).where(eq(offers.id, w.o.id)); // worked in the previous 30 days
    await db.update(driverProfiles).set({ officeId: null, officeLinkStatus: "direct" }).where(eq(driverProfiles.userId, w.d.id)); // and left
    expect(kpi((await get(`/admin/offices/${w.office.id}/insights`, w.t)).json, "ofc_turnover").value).toBe(1);
  });
  it("scorecard: one row per affiliated driver with metrics, a trend of 8 weeks, sorting, filters and masked phones", async () => {
    const w = await world(); const idle = await mkDriver({ officeId: w.office.id, name: "Idle Driver" });
    const res = (await get(`/admin/offices/${w.office.id}/scorecard`, w.t)).json;
    expect(res).toMatchObject({ total: 2, page: 1, pageSize: 10 }); expect(res.sparkWeeks).toHaveLength(8);
    expect(res.items[0]).toMatchObject({ id: w.d.id, jobs: 1, parcels: w.delivered, success: 1 }); expect(res.items[0].spark).toHaveLength(8); expect(res.items[0].spark.reduce((a: number, b: number) => a + b, 0)).toBe(w.delivered);
    expect(res.items[1]).toMatchObject({ id: idle.id, jobs: 0, parcels: 0, success: null, onTime: null, acceptance: null, rating: null }); expect(res.items[1].flags).toEqual([]);
    expect((await get(`/admin/offices/${w.office.id}/scorecard?sort=name&dir=asc`, w.t)).json.items.map((i: any) => i.name)).toEqual(["Idle Driver", "Tariq Detail"]);
    expect((await get(`/admin/offices/${w.office.id}/scorecard?q=idle`, w.t)).json.total).toBe(1); expect((await get(`/admin/offices/${w.office.id}/scorecard?sort=nonsense`, w.t)).status).toBe(422);
    const mgr = (await get(`/admin/offices/${w.office.id}/scorecard`, await tok(await mkStaff(["offices.view"])))).json; expect(mgr.items[0].phone).toContain("•••"); expect(mgr.items[0].earningsCents).toBeGreaterThan(0);
    const fleet = (await get(`/admin/offices/${w.office.id}/scorecard`, await tok(await mkStaff(["drivers.view"])))).json; expect(fleet.items[0].earningsCents).toBeUndefined();
    expect((await get(`/admin/offices/${w.office.id}/scorecard`, await tok(await mkStaff(["users.view"])))).status).toBe(403);
  });
  it("link history: invitations, links (also by staff) and unlinks attributed to the office", async () => {
    const w = await world(); const staff = await mkStaff(["offices.manage"]);
    await db.insert(officeInvites).values([{ officeId: w.office.id, phone: "+966500000001", status: "pending", createdAt: new Date(Date.now() - 5 * 864e5) }, { officeId: w.office.id, phone: "+966500000002", driverId: w.d.id, status: "accepted", createdAt: new Date(Date.now() - 5 * 864e5), respondedAt: new Date(Date.now() - 86400_000) }]);
    await db.insert(auditLogs).values([
      { actorId: staff.id, actorRole: "staff", action: "office.link_driver", entity: "user", entityId: w.d.id, diff: { officeId: w.office.id, via: "account.create" }, createdAt: new Date(Date.now() - 2 * 864e5) },
      { actorId: w.office.id, actorRole: "office", action: "office.unlink_driver", entity: "user", entityId: w.d.id, createdAt: new Date(Date.now() - 3600_000) },
    ]);
    const h = (await get(`/admin/offices/${w.office.id}/driver-history`, w.t)).json;
    expect(h.invites).toMatchObject({ total: 2, pending: 1, accepted: 1 }); expect(h.invites.pendingList[0].phone).toBe("+966500000001"); // staff with drivers.sensitive (an admin) see the number
    expect((await get(`/admin/offices/${w.office.id}/driver-history`, await tok(await mkStaff(["offices.view"])))).json.invites.pendingList[0].phone).toContain("•••");
    expect(h.events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(["invite_sent", "invite_accepted", "linked", "unlinked"])); expect(h.events[0].kind).toBe("unlinked"); expect(h.events.find((e: any) => e.kind === "linked")).toMatchObject({ via: "account.create", driver: "Tariq Detail" });
    expect(h.current.map((d: any) => d.id)).toEqual([w.d.id]); expect(h.current[0].linkedSince).toBeTruthy();
    // an unlink by staff counts for the office only while its link was the driver's latest
    const other = await mkOffice(); await db.insert(auditLogs).values([{ actorId: staff.id, actorRole: "staff", action: "office.link_driver", entity: "user", entityId: w.d.id, diff: { officeId: other.id }, createdAt: new Date(Date.now() - 1800_000) }, { actorId: staff.id, actorRole: "staff", action: "office.unlink_driver", entity: "user", entityId: w.d.id, createdAt: new Date(Date.now() - 600_000) }]);
    const again = (await get(`/admin/offices/${w.office.id}/driver-history`, w.t)).json; expect(again.events.filter((e: any) => e.kind === "unlinked")).toHaveLength(1);
    expect((await get(`/admin/offices/${w.office.id}/driver-history`, await tok(await mkStaff(["users.view"])))).status).toBe(403);
  });
  it("what the office's drivers did: job events of its offers, newest first, paged, without per-parcel events; needs requests.view", async () => {
    const w = await world();
    const res = (await get(`/admin/offices/${w.office.id}/driver-events`, w.t)).json;
    expect(res.total).toBeGreaterThan(0); expect(res.items[0]).toMatchObject({ driverId: w.d.id, driver: "Tariq Detail", requestId: w.r.id, ref: w.r.ref, type: expect.any(String) });
    const times = res.items.map((e: any) => new Date(e.at).getTime()); expect(times).toEqual([...times].sort((a: number, b: number) => b - a));
    expect(res.items.map((e: any) => e.type)).toContain("driver_accepted");
    expect((await get(`/admin/offices/${w.office.id}/driver-events?pageSize=1&page=2`, w.t)).json.items).toHaveLength(1);
    expect((await get(`/admin/offices/${w.office.id}/driver-events`, await tok(await mkStaff(["offices.view"])))).status).toBe(403);
    expect((await get(`/admin/offices/${w.office.id}/driver-events`, await tok(await mkStaff(["offices.view", "requests.view"])))).status).toBe(200);
    expect((await get(`/admin/offices/${FAKE}/driver-events`, w.t)).status).toBe(404);
  });
  it("job log: every job of the office with filters by driver, group, search and period", async () => {
    const w = await world();
    const log = (qs = "", token = w.t) => get(`/admin/offices/${w.office.id}/job-log${qs}`, token);
    expect((await log()).json).toMatchObject({ total: 1, counts: { all: 1, completed: 1 } }); expect((await log()).json.items[0]).toMatchObject({ offerId: w.o.id, driver: "Tariq Detail", driverId: w.d.id, earningCents: expect.any(Number) });
    expect((await log(`?driverId=${w.d.id}`)).json.total).toBe(1); expect((await log(`?driverId=${FAKE}`)).json.total).toBe(0); expect((await log("?group=cancelled")).json.total).toBe(0); expect((await log("?q=nomatch")).json.total).toBe(0);
    expect((await log("", await tok(await mkStaff(["offices.view"])))).json.items[0].earningCents).toBeGreaterThan(0); expect((await log("", await tok(await mkStaff(["offices.manage"])))).status).toBe(200);
    expect((await log("", await tok(await mkStaff(["users.view"])))).status).toBe(403);
  });
  it("agreement history: every version with who sent it, how long acceptance took and the current state", async () => {
    const admin = await mkAdmin(); const t = await tok(admin); const office = await mkOffice({ agreement: false });
    const sent = new Date(Date.now() - 10 * 864e5);
    await db.insert(officeAgreements).values([
      { officeId: office.id, version: 1, status: "superseded", createdAt: new Date(Date.now() - 30 * 864e5), createdBy: admin.id },
      { officeId: office.id, version: 2, status: "accepted", terms: "Standard terms", createdAt: sent, effectiveAt: sent, acceptedAt: new Date(sent.getTime() + 2 * 864e5), createdBy: admin.id, expiresAt: new Date(Date.now() + 20 * 864e5) },
      { officeId: office.id, version: 3, status: "pending_acceptance", createdAt: new Date(), createdBy: admin.id },
    ]);
    const res = (await get(`/admin/offices/${office.id}/agreement-history`, t)).json;
    expect(res.items.map((a: any) => [a.version, a.state])).toEqual([[3, "pending"], [2, "accepted"], [1, "superseded"]]); expect(res.items[1]).toMatchObject({ daysToAccept: 2, terms: "Standard terms", createdBy: "Admin" }); expect(res.items[1].daysToExpiry).toBeGreaterThanOrEqual(19);
    expect(res.summary).toMatchObject({ total: 3, accepted: 1, pending: 1, superseded: 1, avgDaysToAccept: 2, state: "pending" }); expect(res.summary.ageDays).toBeGreaterThanOrEqual(7);
    expect((await get(`/admin/offices/${office.id}/agreement-history`, await tok(await mkStaff(["users.view"])))).status).toBe(403);
    expect((await get(`/admin/offices/${office.id}/agreement-history`, await tok(await mkStaff(["offices.view"])))).status).toBe(200);
  });
  it("security, documents and raw work for offices; unknown ids, drivers and malformed ids are 404", async () => {
    const w = await world();
    for (const p of ["insights", "scorecard", "driver-history", "driver-events", "job-log", "agreement-history", "documents-log", "security", "raw", "money"]) {
      for (const id of [FAKE, w.d.id, "not-a-uuid"]) expect((await get(`/admin/offices/${id}/${p}`, w.t)).status, `${p} ${id}`).toBe(404);
    }
    expect((await get(`/admin/offices/${w.office.id}/security`, w.t)).status).toBe(200); expect((await get(`/admin/offices/${w.office.id}/security`, await tok(await mkStaff(["offices.view"])))).status).toBe(403);
    expect((await get(`/admin/offices/${w.office.id}/documents-log`, w.t)).json.summary.missing.map((m: any) => m.type).sort()).toEqual(["office_cr", "office_license"]);
    const raw = (await get(`/admin/offices/${w.office.id}/raw`, w.t)).json; expect(raw.officeProfile.officeName).toBeTruthy(); expect(raw.counts).toMatchObject({ drivers: 1, offers: 1 }); expect(raw.user).not.toHaveProperty("passwordHash");
  });
});

describe("data safety", () => {
  it("nothing here writes business data: the settlements and parcels are unchanged by reading every view", async () => {
    const w = await world();
    const before = [(await db.select().from(settlements)).length, (await db.select().from(shipments)).length];
    for (const p of ["standing", "insights", "offers", "parcels", "reviews", "money"]) await get(`/admin/drivers/${w.d.id}/${p}`, w.t);
    for (const p of ["insights", "scorecard", "driver-history", "job-log", "agreement-history", "money"]) await get(`/admin/offices/${w.office.id}/${p}`, w.t);
    expect([(await db.select().from(settlements)).length, (await db.select().from(shipments)).length]).toEqual(before);
  });
});
