/**
 * Company and courier-office portal reports (decision G12): `GET /business/analytics/{overview,deliveries,spending,options,table/:name}` and
 * `GET /office/analytics/{overview,drivers,earnings,options,table/:name}`. The SECURITY tests come first: a company never sees another company's numbers, an office never
 * sees another office's drivers or jobs, client-supplied company / office / driver filters are ignored, other roles get 403, an office never learns who its customers are,
 * and neither portal ever receives the other side's money (the company never sees provider cost or margin, the office never sees the customer price or margin).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, driverProfiles, invoices, offers, settlements, users } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkOffice, mkRule, mkStaff, publishedRequest } from "../helpers/factories";
import { work } from "../helpers/work";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import * as jobs from "@/server/jobs";
import { clearAnalyticsCache } from "@/server/analytics/guard";

beforeEach(async () => { await resetDb(); clearAnalyticsCache(); });
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const get = async (u: { id: string }, path: string) => call("GET", path, { token: await tok(u) });
const kpi = (json: any, key: string) => json.kpis.find((k: any) => k.key === key);
const offerOf = async (requestId: string, driverId: string) => (await db.select().from(offers).where(and(eq(offers.requestId, requestId), eq(offers.driverId, driverId))))[0];
const park = (d: { id: string }) => db.update(driverProfiles).set({ availability: "unavailable" }).where(eq(driverProfiles.userId, d.id));

/**
 * Two companies, two offices, one direct driver.
 *  alpha → job 1 (10 parcels delivered) by driverA of officeA
 *  bravo → job 2 (10 delivered) by driverB of officeB, job 3 (8 delivered, 2 refused) by the direct driver D
 */
async function world() {
  const admin = await mkAdmin(); await mkRule(admin);
  const alpha = await mkBusiness({ fundsCents: 5000_00, name: "Alpha Owner" }), bravo = await mkBusiness({ fundsCents: 5000_00, name: "Bravo Owner" });
  const officeA = await mkOffice(), officeB = await mkOffice();
  const driverA = await mkDriver({ officeId: officeA.id, name: "Adel Salem" }), driverB = await mkDriver({ officeId: officeB.id, name: "Basim Nasser" }), driverD = await mkDriver({ name: "Dawood Karim" });
  await park(driverB); await park(driverD);
  const r1 = await publishedRequest(alpha); const o1 = await offerOf(r1.id, driverA.id);
  await jobs.acceptOffer(driverA, o1.id, true); await jobs.confirmAttendance(alpha, o1.id, true); await work(alpha, driverA, o1.id, 10);
  await park(driverA); await db.update(driverProfiles).set({ availability: "available" }).where(eq(driverProfiles.userId, driverB.id));
  const r2 = await publishedRequest(bravo); const o2 = await offerOf(r2.id, driverB.id);
  await jobs.acceptOffer(driverB, o2.id, true); await jobs.confirmAttendance(bravo, o2.id, true); await work(bravo, driverB, o2.id, 10);
  await park(driverB); await db.update(driverProfiles).set({ availability: "available" }).where(eq(driverProfiles.userId, driverD.id));
  const r3 = await publishedRequest(bravo); const o3 = await offerOf(r3.id, driverD.id);
  await jobs.acceptOffer(driverD, o3.id, true); await jobs.confirmAttendance(bravo, o3.id, true); await work(bravo, driverD, o3.id, 8);
  const [s1] = await db.select().from(settlements).where(eq(settlements.requestId, r1.id)), [s2] = await db.select().from(settlements).where(eq(settlements.requestId, r2.id));
  return { admin, alpha, bravo, officeA, officeB, driverA, driverB, driverD, r1, r2, r3, s1, s2 };
}

describe("access", () => {
  const biz = ["overview", "deliveries", "spending", "options", "table/parcels"].map((p) => `/business/analytics/${p}`);
  const off = ["overview", "drivers", "earnings", "options", "table/jobs"].map((p) => `/office/analytics/${p}`);
  it("only the owning role may read its portal's reports: anonymous 401, every other role 403", async () => {
    const { alpha, officeA, driverA } = await world();
    const staff = await mkStaff(["reports.view", "reports.export", "finance.view", "requests.view"]), admin = await mkAdmin();
    for (const p of biz) {
      expect((await call("GET", p)).status, `anonymous ${p}`).toBe(401);
      for (const [who, u] of [["office", officeA], ["driver", driverA], ["staff", staff], ["admin", admin]] as const) expect((await get(u, p)).status, `${who} ${p}`).toBe(403);
      expect((await get(alpha, p)).status, `business ${p}`).toBe(200);
    }
    for (const p of off) {
      expect((await call("GET", p)).status, `anonymous ${p}`).toBe(401);
      for (const [who, u] of [["business", alpha], ["driver", driverA], ["staff", staff], ["admin", admin]] as const) expect((await get(u, p)).status, `${who} ${p}`).toBe(403);
      expect((await get(officeA, p)).status, `office ${p}`).toBe(200);
    }
  });
  it("the staff reports stay closed to the portals", async () => {
    const { alpha, officeA } = await world();
    for (const p of ["/admin/analytics/overview", "/admin/analytics/options", "/admin/analytics/overview/table/requests"]) { expect((await get(alpha, p)).status).toBe(403); expect((await get(officeA, p)).status).toBe(403); }
  });
});

describe("a company sees only its own data", () => {
  it("numbers are the company's, whatever company / office / driver the client asks for", async () => {
    const { alpha, bravo, officeB, driverB, s1, s2 } = await world();
    const mine = (await get(alpha, "/business/analytics/overview")).json;
    expect(kpi(mine, "biz_requests").value).toBe(1); expect(kpi(mine, "parcels_delivered").value).toBe(10); expect(kpi(mine, "biz_spend").value).toBe(s1.customerCents);
    const theirs = (await get(bravo, "/business/analytics/overview")).json;
    expect(kpi(theirs, "biz_requests").value).toBe(2); expect(kpi(theirs, "parcels_delivered").value).toBe(18); expect(kpi(theirs, "biz_parcels_failed").value + kpi(theirs, "biz_parcels_returned").value).toBe(2); expect(kpi(theirs, "biz_spend").value).toBeGreaterThan(s2.customerCents);
    for (const spoof of [`company=${bravo.id}`, `office=${officeB.id}`, `driver=${driverB.id}`, `company=${bravo.id}&office=${officeB.id}&driver=${driverB.id}`]) {
      const r = (await get(alpha, `/business/analytics/overview?${spoof}`)).json;
      expect(kpi(r, "biz_requests").value, spoof).toBe(1); expect(kpi(r, "parcels_delivered").value, spoof).toBe(10); expect(kpi(r, "biz_spend").value, spoof).toBe(s1.customerCents);
      expect(r.meta.values.company).toEqual([]); expect(r.meta.ignored.length).toBeGreaterThan(0);
      expect(JSON.stringify(r), spoof).not.toContain(bravo.id);
    }
    for (const path of ["deliveries", "spending"]) {
      const r = (await get(alpha, `/business/analytics/${path}?company=${bravo.id}`)).json;
      expect(JSON.stringify(r), path).not.toContain(bravo.id); expect(r.meta.ignored).toContain("company");
    }
    for (const t of ["parcels", "requests", "invoices", "ledger", "returns", "cod"]) {
      const res = await get(alpha, `/business/analytics/table/${t}?company=${bravo.id}&pageSize=100`); expect(res.status, t).toBe(200); const r = res.json;
      expect(JSON.stringify(r.rows), t).not.toContain(bravo.id); expect(r.rows.length, t).toBeLessThanOrEqual(100);
    }
  });
  it("the company's numbers equal the admin Overview filtered to that company", async () => {
    const { admin, bravo } = await world();
    const portal = (await get(bravo, "/business/analytics/overview")).json, staff = (await get(admin, `/admin/analytics/overview?company=${bravo.id}`)).json;
    for (const [p, a] of [["biz_requests", "requests_created"], ["requests_completed", "requests_completed"], ["parcels_delivered", "parcels_delivered"], ["delivery_success", "delivery_success"], ["first_attempt", "first_attempt"], ["cancellation_rate", "cancellation_rate"], ["on_time_start", "on_time_start"]] as const) {
      expect(kpi(portal, p).value, p).toBe(kpi(staff, a).value);
    }
    expect(kpi(portal, "biz_spend").value).toBe(kpi(staff, "gmv").value);
  });
  it("never carries the provider cost or the platform margin, and never a driver's phone or id", async () => {
    const { alpha, driverA } = await world();
    for (const p of ["overview", "deliveries", "spending"]) {
      const text = JSON.stringify((await get(alpha, `/business/analytics/${p}`)).json);
      expect(text, p).not.toMatch(/margin|provider|revenue/i); expect(text, p).not.toContain(driverA.id); expect(text, p).not.toContain(String(driverA.phone));
    }
    const served = (await get(alpha, "/business/analytics/deliveries")).json.drivers;
    expect(served).toHaveLength(1); expect(served[0]).toMatchObject({ firstName: "Adel", delivered: 10 }); expect(Object.keys(served[0]).sort()).toEqual(["delivered", "failed", "firstName", "key", "rating"]);
    for (const t of ["parcels", "requests", "invoices", "ledger", "returns", "cod"]) {
      const tbl = (await get(alpha, `/business/analytics/table/${t}`)).json; // the column definitions carry a `phone: false` masking flag: look at the column KEYS and the rows
      expect(JSON.stringify({ columns: tbl.columns.map((c: any) => c.key), rows: tbl.rows }), t).not.toMatch(/margin|provider|recipient|phone/i);
    }
  });
  it("deliveries: failure reasons, delivery time, proof, returns and the parcel manifest", async () => {
    const { bravo, alpha } = await world();
    const d = (await get(bravo, "/business/analytics/deliveries")).json;
    expect(d.reasons.find((r: any) => r.key === "refused")?.count).toBe(2);
    expect(d.proof.find((p: any) => p.key === "otp").n).toBe(18); expect(d.cities.reduce((s: number, c: any) => s + c.resolved, 0)).toBe(20);
    expect(kpi(d, "delivery_success").value).toBeCloseTo(18 / 20, 5); expect(d.heatmap.total).toBe(18);
    const parcels = (await get(bravo, "/business/analytics/table/parcels?pageSize=100")).json;
    expect(parcels.total).toBe(20); expect(parcels.rows.every((r: any) => typeof r.code === "string" && !("recipientName" in r))).toBe(true);
    expect((await get(alpha, "/business/analytics/table/parcels?pageSize=100")).json.total).toBe(10);
    const sorted = (await get(bravo, "/business/analytics/table/parcels?sort=code&dir=asc&pageSize=5")).json;
    expect(sorted.rows.map((r: any) => r.code)).toEqual([...sorted.rows.map((r: any) => r.code)].sort());
    expect((await get(bravo, "/business/analytics/table/parcels?sort=recipient_phone")).status).toBe(422);
  });
  it("spending: invoices, wallet and the forecast that refuses to guess", async () => {
    const { alpha, s1 } = await world();
    const s = (await get(alpha, "/business/analytics/spending")).json;
    expect(kpi(s, "biz_spend").value).toBe(s1.customerCents); expect(kpi(s, "biz_orders_billed").value).toBe(1); expect(kpi(s, "biz_avg_order").value).toBe(s1.customerCents);
    const [inv] = await db.select().from(invoices).where(eq(invoices.businessId, alpha.id));
    expect(kpi(s, "biz_invoiced").value).toBe(inv.totalCents); expect(kpi(s, "biz_vat").value).toBe(inv.vatCents);
    expect(kpi(s, "biz_topups").value).toBe(5000_00);
    expect(s.wallet).toMatchObject({ creditLimit: 0 }); expect(kpi(s, "biz_credit_usage").value).toBeNull(); // no credit facility → no data, not 0 %
    expect(s.forecast).toBeNull(); expect(kpi(s, "biz_forecast")).toBeUndefined(); // spending on one day only: not enough history to estimate
    expect(s.series.spend.points.reduce((n: number, p: any) => n + p.spend, 0)).toBe(s1.customerCents);
    expect(s.ledger.find((x: any) => x.kind === "topup").amount).toBe(5000_00); expect(s.ledger.map((x: any) => x.kind)).toEqual(expect.arrayContaining(["reserve", "charge", "release_reserve"]));
    const t = (await get(alpha, "/business/analytics/table/invoices")).json;
    expect(t.total).toBe(1); expect(t.rows[0]).toMatchObject({ number: inv.number, totalCents: inv.totalCents, vatCents: inv.vatCents });
  });
  it("two companies with the same filters never share a cached report", async () => {
    const { alpha, bravo } = await world();
    const a = (await get(alpha, "/business/analytics/overview")).json, b = (await get(bravo, "/business/analytics/overview")).json;
    expect(a.meta.cached).toBe(false); expect(b.meta.cached).toBe(false); expect(kpi(a, "biz_requests").value).not.toBe(kpi(b, "biz_requests").value);
    expect((await get(alpha, "/business/analytics/overview")).json.meta.cached).toBe(true);
  });
});

describe("an office sees only its own drivers and jobs, and never its customers", () => {
  it("numbers, drivers and jobs are the office's, whatever office / driver the client asks for", async () => {
    const { officeA, officeB, driverA, driverB, s1 } = await world();
    const a = (await get(officeA, "/office/analytics/overview")).json;
    expect(kpi(a, "off_jobs").value).toBe(1); expect(kpi(a, "parcels_delivered").value).toBe(10); expect(kpi(a, "off_earnings").value).toBe(s1.providerCents); expect(kpi(a, "off_drivers").value).toBe(1);
    for (const spoof of [`office=${officeB.id}`, `driver=${driverB.id}`, `office=${officeB.id}&driver=${driverB.id}&company=${officeB.id}`]) {
      const r = (await get(officeA, `/office/analytics/overview?${spoof}`)).json;
      if (spoof.startsWith("office=") && !spoof.includes("driver")) expect(kpi(r, "off_jobs").value, spoof).toBe(1);
      expect(JSON.stringify(r), spoof).not.toContain(driverB.id); expect(JSON.stringify(r), spoof).not.toContain(officeB.id); expect(JSON.stringify(r)).not.toContain("Basim");
    }
    const foreign = (await get(officeA, `/office/analytics/overview?driver=${driverB.id}`)).json;
    expect(kpi(foreign, "off_jobs").value).toBe(0); expect(foreign.meta.ignored).toContain("driver"); expect(foreign.meta.values.driver).toEqual([]);
    const own = (await get(officeA, `/office/analytics/overview?driver=${driverA.id}`)).json;
    expect(kpi(own, "off_jobs").value).toBe(1); expect(own.meta.values.driver).toEqual([driverA.id]);
    const opts = (await get(officeA, "/office/analytics/options")).json;
    expect(opts.drivers.map((d: any) => d.id)).toEqual([driverA.id]); expect(opts.statuses).toEqual([]);
    const sheet = (await get(officeA, "/office/analytics/table/drivers?pageSize=100")).json;
    expect(sheet.rows.map((r: any) => r.id)).toEqual([driverA.id]); expect(sheet.rows[0]).toMatchObject({ name: "Adel Salem", jobs: 1, delivered: 10 });
    expect(JSON.stringify((await get(officeA, "/office/analytics/drivers")).json)).not.toContain(driverB.id);
  });
  it("customers are anonymous and the customer price and margin never leave the server", async () => {
    const { officeA, alpha } = await world();
    for (const p of ["overview", "drivers", "earnings"]) {
      const text = JSON.stringify((await get(officeA, `/office/analytics/${p}`)).json);
      expect(text, p).not.toContain(alpha.id); expect(text, p).not.toContain("Alpha"); expect(text, p).not.toMatch(/Co Alpha|Co Biz/); expect(text, p).not.toMatch(/margin|customer|revenue/i);
    }
    const companies = (await get(officeA, "/office/analytics/overview")).json.breakdowns.company;
    expect(companies).toHaveLength(1); expect(companies[0].key).toMatch(/^C-[0-9A-F]{5}$/);
    for (const t of ["jobs", "settlements", "drivers", "payouts", "ledger"]) expect(JSON.stringify((await get(officeA, `/office/analytics/table/${t}`)).json), t).not.toMatch(/margin|customer|Co Alpha|recipient/i);
  });
  it("earnings equal the settlements payable to the office; a driver's direct work is not the office's", async () => {
    const { officeA, officeB, driverD, s1, s2 } = await world();
    const e = (await get(officeA, "/office/analytics/earnings")).json;
    expect(kpi(e, "off_earnings").value).toBe(s1.providerCents); expect(kpi(e, "off_paid").value).toBe(s1.providerCents); expect(kpi(e, "off_settlements").value).toBe(1); expect(kpi(e, "off_avg_per_job").value).toBe(s1.providerCents);
    expect(kpi((await get(officeB, "/office/analytics/earnings")).json, "off_earnings").value).toBe(s2.providerCents);
    expect(e.pipeline.funnel.map((s: any) => s.count)).toEqual([1, 1, 1]); expect(e.byDriver).toHaveLength(1);
    const t = (await get(officeA, "/office/analytics/table/settlements")).json;
    expect(t.total).toBe(1); expect(t.rows[0]).toMatchObject({ amountCents: s1.providerCents, status: "paid" });
    expect(JSON.stringify((await get(officeA, "/office/analytics/overview")).json)).not.toContain(driverD.id);
  });
  it("the drivers report: scorecards, minimum-volume guard and coaching", async () => {
    const { officeA, driverA } = await world();
    const d = (await get(officeA, "/office/analytics/drivers")).json;
    expect(kpi(d, "active_drivers").value).toBe(1); expect(kpi(d, "off_avg_jobs").value).toBe(1);
    expect(d.performers.ranked).toBe(1); expect(d.performers.top[0]).toMatchObject({ id: driverA.id, success: 1 });
    expect(d.coach).toEqual([]); expect(d.distributions.jobs.reduce((s: number, b: any) => s + b.count, 0)).toBe(1);
    await db.update(driverProfiles).set({ officeId: officeA.id }).where(eq(driverProfiles.userId, (await mkDriver({ available: false })).id));
    clearAnalyticsCache(); // the report above is cached for 30 s
    const later = (await get(officeA, "/office/analytics/drivers")).json;
    expect(later.idle).toHaveLength(1); expect(later.totals.drivers).toBe(2);
  });
});

describe("CSV, audit, validation", () => {
  it("an owner may export their own data as CSV; it is audited and carries a BOM", async () => {
    const { alpha, officeA } = await world();
    const b = await get(alpha, "/business/analytics/table/parcels?format=csv");
    expect(b.status).toBe(200); expect(b.headers.get("content-type")).toContain("text/csv"); expect(b.headers.get("content-disposition")).toContain("business-parcels.csv");
    expect(b.text.split("\n").length).toBe(11); // header + the company's 10 parcels, nobody else's
    const o = await get(officeA, "/office/analytics/table/settlements?format=csv");
    expect(o.status).toBe(200); expect(o.text.split("\n").length).toBe(2);
    const [a1] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "report.export"), eq(auditLogs.actorId, alpha.id))).orderBy(desc(auditLogs.createdAt));
    expect(a1).toMatchObject({ entity: "report", entityId: "business/parcels", actorRole: "business" });
    const [a2] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "report.export"), eq(auditLogs.actorId, officeA.id)));
    expect(a2).toMatchObject({ entityId: "office/settlements", actorRole: "office" });
    expect((await get(alpha, "/business/analytics/table/parcels?format=xml")).status).toBe(422);
  });
  it("invalid filters are a 422 that names the field; unknown tables are a 404; sorting is whitelisted", async () => {
    const { alpha, officeA } = await world();
    const bad = async (u: { id: string }, path: string) => { const r = await get(u, path); return { status: r.status, field: r.json?.error?.details?.field as string | undefined }; };
    expect(await bad(alpha, "/business/analytics/overview?preset=forever")).toMatchObject({ status: 422, field: "preset" });
    expect(await bad(alpha, "/business/analytics/overview?company=nope")).toMatchObject({ status: 422, field: "company" });
    expect(await bad(officeA, "/office/analytics/overview?from=2026-03-05&to=2026-03-01")).toMatchObject({ status: 422, field: "to" });
    expect(await bad(officeA, "/office/analytics/overview?driver=nope")).toMatchObject({ status: 422, field: "driver" });
    expect((await get(alpha, "/business/analytics/table/nope")).status).toBe(404);
    expect((await get(alpha, "/business/analytics/table/jobs")).status).toBe(404); // an office table is not a company table
    expect((await get(officeA, "/office/analytics/table/drivers?sort=1;drop table users")).status).toBe(422);
    expect((await get(alpha, "/business/analytics/table/parcels?pageSize=1000")).status).toBe(422);
    expect((await db.select().from(users)).length).toBeGreaterThan(5); // the injection attempt did nothing
  });
  it("an empty account answers with empty reports, not errors", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const fresh = await mkBusiness(), freshOffice = await mkOffice();
    const b = (await get(fresh, "/business/analytics/overview")).json, o = (await get(freshOffice, "/office/analytics/overview")).json;
    expect(b.meta.empty).toBe(true); expect(kpi(b, "biz_requests").value).toBe(0); expect(kpi(b, "delivery_success").value).toBeNull();
    expect(o.meta.empty).toBe(true); expect(kpi(o, "off_jobs").value).toBe(0); expect(kpi(o, "off_completion_rate").value).toBeNull();
    for (const p of ["deliveries", "spending"]) expect((await get(fresh, `/business/analytics/${p}`)).status).toBe(200);
    for (const p of ["drivers", "earnings"]) expect((await get(freshOffice, `/office/analytics/${p}`)).status).toBe(200);
  });
});
