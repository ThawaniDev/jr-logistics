/**
 * Reports › Companies, Drivers, Courier offices, Growth & onboarding: `GET /admin/analytics/{companies,drivers,offices,growth}` and their drill-down tables.
 * Covers permissions, that filters narrow the numbers, the arithmetic of the KPIs against real work (a delivered job, an accepted one, a cancelled request), money and personal
 * data being omitted/masked without the right permission, the CSV contract, validation, and sparse / empty data.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, documents, driverAvailabilityLog, driverProfiles, loginEvents, officeInvites, offers, ratings, requests, settlements } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkOffice, mkRule, mkStaff, publishedRequest } from "../helpers/factories";
import { work } from "../helpers/work";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import * as jobs from "@/server/jobs";
import { clearAnalyticsCache } from "@/server/analytics/guard";
import { FLEET_DRIVER_KPI_KEYS, FLEET_OFFICE_KPI_KEYS } from "@/server/analytics/fleet-kpis";

beforeEach(async () => { await resetDb(); clearAnalyticsCache(); });
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const get = async (u: { id: string }, path: string) => call("GET", path, { token: await tok(u) });
let n = 0;
const daysAgo = (d: number) => new Date(Date.now() - d * 864e5);
const insertRequest = async (biz: { id: string }, o: Partial<typeof requests.$inferInsert> = {}) => (await db.insert(requests).values({
  ref: `PP-${Date.now()}-${++n}`, businessId: biz.id, service: "delivery_driver", quantity: 1, pickupCity: "riyadh", deliveryCity: "riyadh", startsAt: new Date(), status: "completed", ...o,
}).returning())[0];
const kpi = (json: any, key: string) => json.kpis.find((k: any) => k.key === key);
/** The offer the platform made to this driver for this request (matching offers every eligible driver, so the test picks its own). */
const offerOf = async (requestId: string, driverId: string) => {
  const o = (await db.select().from(offers).where(eq(offers.requestId, requestId))).find((x) => x.driverId === driverId);
  if (!o) throw new Error("matching made no offer to this driver");
  return o;
};

/**
 * Office X has one driver (O) who delivered all 10 parcels of Alpha's request (settled to the office, still pending review). Driver D works direct and accepted a job of Bravo's but did not
 * work it yet. Bravo also has a cancelled request. Driver E is verified and has never worked. Three days of sign-ins and one rating.
 */
async function world() {
  const admin = await mkAdmin(); await mkRule(admin);
  const alpha = await mkBusiness({ fundsCents: 5000_00, name: "Alpha Owner" }), bravo = await mkBusiness({ fundsCents: 5000_00, name: "Bravo Owner" });
  const office = await mkOffice(); const driverO = await mkDriver({ officeId: office.id, name: "Driver Office" });
  const r1 = await publishedRequest(alpha); const o1 = await offerOf(r1.id, driverO.id);
  await jobs.acceptOffer(driverO, o1.id, true); await jobs.confirmAttendance(alpha, o1.id, true); await work(alpha, driverO, o1.id, 10);
  const driverD = await mkDriver({ name: "Driver Direct" });
  const r2 = await publishedRequest(bravo, { startsAt: new Date(Date.now() + 3 * 864e5) }); const o2 = await offerOf(r2.id, driverD.id);
  await jobs.acceptOffer(driverD, o2.id, true);
  const r3 = await insertRequest(bravo, { status: "cancelled", cancelledAt: new Date(), deliveryCity: "jeddah" });
  const driverE = await mkDriver({ name: "Driver Idle" }); // registered after every request was published: never offered anything
  const [settlement] = await db.select().from(settlements).where(eq(settlements.requestId, r1.id));
  await db.insert(ratings).values({ offerId: o1.id, raterId: alpha.id, rateeId: driverO.id, stars: 5 });
  return { admin, alpha, bravo, office, driverO, driverD, driverE, r1, r2, r3, o1, o2, settlement };
}

describe("permissions", () => {
  it("only back-office staff with reports.view can read the four reports and their tables", async () => {
    const { alpha, driverO } = await world();
    const paths = ["companies", "drivers", "offices", "growth"].flatMap((r) => [`/admin/analytics/${r}`]).concat([
      "/admin/analytics/companies/table/leaderboard", "/admin/analytics/drivers/table/scorecards", "/admin/analytics/offices/table/scorecards", "/admin/analytics/growth/table/signups"]);
    for (const p of paths) {
      expect((await call("GET", p)).status, `anonymous ${p}`).toBe(401);
      expect((await get(alpha, p)).status, `business ${p}`).toBe(403);
      expect((await get(driverO, p)).status, `driver ${p}`).toBe(403);
      expect((await get(await mkStaff(["requests.view", "finance.view"]), p)).status, `no reports.view ${p}`).toBe(403);
      expect((await get(await mkStaff(["reports.view"]), p)).status, `reports.view ${p}`).toBe(200);
    }
  });
  it("rejects invalid filters with a 422 that names the field (the same parser as the Overview)", async () => {
    const { admin } = await world();
    for (const r of ["companies", "drivers", "offices", "growth"]) {
      const bad = await get(admin, `/admin/analytics/${r}?preset=forever`);
      expect(bad.status, r).toBe(422); expect(bad.json.error.details.field, r).toBe("preset");
      expect((await get(admin, `/admin/analytics/${r}?company=nope`)).status, r).toBe(422);
    }
  });
});

describe("GET /admin/analytics/companies", () => {
  it("computes the KPIs from the real data and agrees with the Overview", async () => {
    const { admin, settlement } = await world();
    const j = (await get(admin, "/admin/analytics/companies")).json;
    expect(j.meta).toMatchObject({ bucket: "day", compare: "prev", empty: false, moneyHidden: false });
    expect(j.partial).toEqual([]); // every section was computed
    expect(j.kpis.map((k: any) => k.key)).toEqual(["active_companies", "cmp_new", "cmp_returning", "cmp_churned", "cmp_at_risk", "cmp_orders_per", "cmp_parcels_per", "gmv", "aov", "delivery_success", "cancellation_rate",
      "cmp_cod_share", "cmp_api_share", "cmp_repeat", "cmp_order_gap", "cmp_credit_util", "cmp_verified", "cmp_located"]);
    const ov = (await get(admin, "/admin/analytics/overview")).json;
    for (const key of ["active_companies", "gmv", "aov", "delivery_success", "cancellation_rate"]) expect(kpi(j, key).value, key).toBe(kpi(ov, key).value);
    expect(kpi(j, "active_companies").value).toBe(2); expect(kpi(j, "cmp_new").value).toBe(2); expect(kpi(j, "cmp_returning").value).toBe(0);
    expect(kpi(j, "cmp_orders_per").value).toBe(1.5); expect(kpi(j, "cmp_parcels_per").value).toBe(10);
    expect(kpi(j, "gmv").value).toBe(settlement.customerCents); expect(kpi(j, "cmp_cod_share").value).toBe(0); expect(kpi(j, "cmp_api_share").value).toBe(0);
    expect(kpi(j, "cmp_repeat").value).toBe(0.5); // Bravo has two requests, Alpha one
    expect(kpi(j, "cmp_verified").value).toBe(1); expect(kpi(j, "cmp_located").value).toBe(1);
    expect(kpi(j, "cmp_churned")).toMatchObject({ value: 0, parts: [{ key: "d30", value: 0 }, { key: "d60", value: 0 }, { key: "d90", value: 0 }] });
    expect(kpi(j, "cmp_credit_util").value).toBeNull(); // nobody has a credit limit: no data, never 0 %
    expect(kpi(j, "cmp_orders_per")).toMatchObject({ prev: null, label: "rpp.kpi_cmp_orders_per", definition: "rpp.def_cmp_orders_per" });
  });
  it("series, concentration, cohorts, segments, channels and health are consistent with the KPIs", async () => {
    const { admin, alpha } = await world();
    const j = (await get(admin, "/admin/analytics/companies")).json;
    expect(j.series.points).toHaveLength(30); expect(j.series.prev).toHaveLength(30);
    expect(j.series.points.reduce((s: number, p: any) => s + p.orders, 0)).toBe(3); expect(j.series.points.reduce((s: number, p: any) => s + p.firsts, 0)).toBe(2); expect(j.series.points.reduce((s: number, p: any) => s + p.signups, 0)).toBe(2);
    expect(j.concentration.parcels.total).toBe(20); expect(j.concentration.parcels.rows.reduce((s: number, r: any) => s + r.value, 0)).toBe(20); expect(j.concentration.parcels.top10Share).toBe(1);
    expect(j.concentration.gmv.rows[0]).toMatchObject({ id: alpha.id, share: 1, cumulative: 1 });
    const last = j.cohorts.rows[j.cohorts.rows.length - 1];
    expect(j.cohorts.rows).toHaveLength(12); expect(last).toMatchObject({ size: 2 }); expect(last.cells[0]).toBe(2); expect(last.cells[1]).toBeNull(); // both signed up and ordered this month; next month is not observable
    expect(j.segments.map((s: any) => s.key)).toEqual(["small", "medium", "large"]); expect(j.segments[0]).toMatchObject({ companies: 2, parcels: 20 });
    expect(j.channels).toEqual([{ key: "web", requests: 3, prev: 0 }]);
    expect(j.health.live).toBe(2); expect(j.health.buckets.reduce((s: number, b: any) => s + b.count, 0)).toBe(2); expect(j.health.weights).toEqual({ recency: 30, frequency: 20, success: 25, cancel: 15, support: 10 });
    expect(j.wallets).toMatchObject({ accounts: expect.any(Number), utilisation: null }); expect(Array.isArray(j.insights)).toBe(true);
    expect(j.movers.up[0]).toMatchObject({ id: alpha.id });
  });
  it("filters narrow every number and an empty selection says so", async () => {
    const { admin, alpha, bravo } = await world();
    const q = async (s: string) => (await get(admin, `/admin/analytics/companies?${s}`)).json;
    expect(kpi(await q(`company=${alpha.id}`), "active_companies").value).toBe(1);
    expect(kpi(await q(`company=${alpha.id}`), "cmp_parcels_per").value).toBe(10);
    expect(kpi(await q(`company=${bravo.id}`), "gmv").value).toBe(0);
    expect(kpi(await q("city=jeddah"), "active_companies").value).toBe(1);
    expect(kpi(await q("status=cancelled"), "cancellation_rate").value).toBe(1);
    expect(kpi(await q("channel=api"), "active_companies").value).toBe(0);
    const empty = await q("service=car_with_driver&city=tabuk");
    expect(empty.meta.empty).toBe(true); expect(kpi(empty, "cmp_orders_per").value).toBeNull(); expect(kpi(empty, "delivery_success").value).toBeNull();
    expect(kpi(await q("city=riyadh"), "cmp_credit_util").unfiltered).toEqual(["city"]); // a filter a KPI cannot honour is called out
    expect((await q("compare=none")).kpis.every((k: any) => k.prev === null)).toBe(true);
  });
  it("money (GMV, AOV, credit, wallets, concentration by GMV, billed columns) is omitted without finance.view", async () => {
    await world();
    const plain = await mkStaff(["reports.view"]);
    const j = (await get(plain, "/admin/analytics/companies")).json;
    const keys = j.kpis.map((k: any) => k.key);
    for (const m of ["gmv", "aov", "cmp_credit_util"]) expect(keys).not.toContain(m);
    expect(keys).toEqual(expect.arrayContaining(["cmp_new", "cmp_orders_per", "delivery_success"]));
    expect(j.meta.moneyHidden).toBe(true); expect(j.wallets).toBeNull(); expect(j.concentration.gmv).toBeNull(); expect(j.segments.every((s: any) => s.gmv === null)).toBe(true); expect(j.movers.by).toBe("requests");
    const t = (await get(plain, "/admin/analytics/companies/table/leaderboard")).json;
    expect(t.columns.map((c: any) => c.key)).not.toContain("gmvCents"); expect(t.rows.every((r: any) => !("gmvCents" in r) && !("aovCents" in r))).toBe(true);
    // sorting by a money column must not reveal the ranking
    const sorted = await get(plain, "/admin/analytics/companies/table/leaderboard?sort=gmvCents&dir=desc");
    const ids = sorted.json.rows.map((r: any) => r.id);
    expect(sorted.status).toBe(200); expect(ids).toEqual([...ids].sort()); // every hidden value is equal, so the order falls back to the tie-break: nothing leaks
  });
  it("tells churned companies, companies at risk and new companies apart, and lists them", async () => {
    const { admin, alpha, bravo } = await world();
    const charlie = await mkBusiness({ name: "Charlie Owner" }), dormant = await mkBusiness({ name: "Dormant Owner" });
    for (const d of [45, 40, 20]) await insertRequest(charlie, { createdAt: daysAgo(d) });
    await insertRequest(dormant, { createdAt: daysAgo(100) });
    const q = "preset=7d&compare=none";
    const j = (await get(admin, `/admin/analytics/companies?${q}`)).json;
    expect(kpi(j, "active_companies").value).toBe(2); // Alpha and Bravo ordered in the last 7 days
    expect(kpi(j, "cmp_at_risk").value).toBe(1);      // Charlie: 3 requests, silent for 20 days
    expect(kpi(j, "cmp_churned")).toMatchObject({ value: 1, parts: [{ key: "d30", value: 1 }, { key: "d60", value: 1 }, { key: "d90", value: 1 }] }); // Dormant: silent for 100 days
    const risk = (await get(admin, `/admin/analytics/companies/table/at-risk?${q}`)).json;
    expect(risk.total).toBe(2); expect(risk.rows.map((r: any) => [r.name, r.state, r.orders])).toEqual([[expect.stringContaining("Charlie"), "at_risk", 3], [expect.stringContaining("Dormant"), "churned", 1]]);
    expect(risk.rows[0].silentDays).toBeGreaterThanOrEqual(19); expect(risk.rows[0].silentDays).toBeLessThanOrEqual(21);
    const fresh = (await get(admin, `/admin/analytics/companies/table/new?${q}`)).json;
    expect(fresh.rows.map((r: any) => r.id).sort()).toEqual([alpha.id, bravo.id].sort()); // companies whose first request fell in the period
    expect(fresh.rows.every((r: any) => r.toFirst >= 0)).toBe(true);
  });
  it("leaderboard: all metrics, sortable by every column, CSV needs reports.export", async () => {
    const { admin, alpha } = await world();
    const t = (await get(admin, "/admin/analytics/companies/table/leaderboard")).json;
    expect(t.total).toBe(2); expect(t.sort).toEqual({ key: "requests", dir: "desc" });
    expect(t.rows[0]).toMatchObject({ requests: 2, parcels: 10 }); // Bravo has the most requests
    expect(t.rows.every((r: any) => typeof r.health === "number" && r.health >= 0 && r.health <= 100)).toBe(true);
    for (const c of t.columns.filter((c: any) => c.sortable)) expect((await get(admin, `/admin/analytics/companies/table/leaderboard?sort=${c.key}&dir=asc`)).status, c.key).toBe(200);
    expect((await get(admin, "/admin/analytics/companies/table/leaderboard?sort=password")).status).toBe(422);
    expect((await get(admin, `/admin/analytics/companies/table/leaderboard?company=${alpha.id}`)).json.total).toBe(1);
    expect((await get(await mkStaff(["reports.view"]), "/admin/analytics/companies/table/leaderboard?format=csv")).status).toBe(403);
    const csv = await get(await mkStaff(["reports.view", "reports.export"]), "/admin/analytics/companies/table/leaderboard?format=csv&headers=keys");
    expect(csv.status).toBe(200); expect(csv.text.startsWith("﻿name,")).toBe(true); expect(csv.text.slice(1).split("\n")).toHaveLength(1 + 2); expect(csv.headers.get("content-disposition")).toContain("companies-leaderboard.csv");
    expect(csv.text.split("\n")[0]).not.toContain("gmvCents"); // reports.export alone does not unlock money
  });
});

describe("GET /admin/analytics/drivers", () => {
  it("computes the fleet KPIs from the real jobs", async () => {
    const { admin } = await world();
    const j = (await get(admin, "/admin/analytics/drivers")).json;
    expect(j.kpis.map((k: any) => k.key)).toEqual(["active_drivers", "flt_available", "flt_online_hours", "flt_jobs_per", "flt_parcels_per", "flt_success", "on_time_start", "flt_acceptance", "flt_resp_p50", "flt_resp_p90",
      "flt_cancel", "flt_replaced", "flt_rating", "flt_earn_per", "flt_earn_hour", "flt_util", "flt_cash", "flt_strikes", "flt_suspensions", "flt_churned", "flt_flagged", ...FLEET_DRIVER_KPI_KEYS]); // the fleet KPIs come after the report's own
    const ov = (await get(admin, "/admin/analytics/overview")).json;
    expect(kpi(j, "active_drivers").value).toBe(kpi(ov, "active_drivers").value); expect(kpi(j, "on_time_start").value).toBe(kpi(ov, "on_time_start").value);
    expect(kpi(j, "active_drivers").value).toBe(2); expect(kpi(j, "flt_jobs_per").value).toBe(1); expect(kpi(j, "flt_parcels_per").value).toBe(5); expect(kpi(j, "flt_success").value).toBe(1);
    expect(kpi(j, "flt_acceptance").value).toBeGreaterThan(0); expect(kpi(j, "flt_acceptance").value).toBeLessThanOrEqual(1); expect(kpi(j, "flt_cancel").value).toBe(0); expect(kpi(j, "flt_replaced").value).toBe(0); expect(kpi(j, "flt_strikes").value).toBe(0);
    expect(kpi(j, "flt_available").value).toBeGreaterThanOrEqual(1); expect(kpi(j, "flt_available").value).toBeLessThanOrEqual(3); // verified drivers who are available right now
    expect(kpi(j, "flt_resp_p50").value).toBeGreaterThanOrEqual(0); expect(kpi(j, "flt_earn_per").value).toBeGreaterThan(0);
    expect(kpi(j, "flt_cash").value).toBe(0); expect(kpi(j, "flt_online_hours").value).toBe(0); expect(kpi(j, "flt_util").value).toBeNull(); // no availability log yet: no data, never 0 %
  });
  it("rating, distributions, leaderboard (minimum volume), mixes, funnel and heatmap shapes", async () => {
    const { admin, driverO, driverD } = await world();
    const j = (await get(admin, "/admin/analytics/drivers")).json;
    expect(j.distributions.stars[4]).toBeGreaterThanOrEqual(1); expect(j.distributions.ratings).toBeGreaterThanOrEqual(1);
    expect(j.leaders.minVolume).toBe(10); expect(j.leaders.top[0]).toMatchObject({ id: driverO.id, resolved: 10, value: 1 }); expect(j.leaders.top.map((x: any) => x.id)).not.toContain(driverD.id); // D resolved nothing: under the guard
    expect(j.mix.vehicle).toEqual([{ key: "sedan", value: 2 }]); expect(j.mix.city).toEqual([{ key: "riyadh", value: 2 }]);
    expect(j.reliability.cells).toHaveLength(4); expect(j.reliability.cells.every((r: number[]) => r.length === 4)).toBe(true);
    expect(j.heatmap.cells).toHaveLength(7); expect(j.heatmap.cells[0]).toHaveLength(24); expect(["log", "snapshots", "none"]).toContain(j.heatmap.source);
    expect(j.funnel.steps.map((s: any) => s.key)).toEqual(["registered", "docs", "verified", "first_job", "active"]); expect(j.funnel.steps[0].count).toBe(3);
    expect(j.funnel.steps.map((s: any) => s.count)).toEqual([3, 3, 3, 2, 2]); // every driver is verified; two accepted a job and are still active
    expect(j.fleet).toMatchObject({ total: 3, verified: 3 });
    expect(j.series.volume.points).toHaveLength(30); expect(j.series.quality.points).toHaveLength(30); expect(j.series.quality.points[0]).toHaveProperty("acceptance");
  });
  it("online time, utilisation and the heatmap come from the availability log; automatic suspensions are counted", async () => {
    const { admin, driverO } = await world();
    await db.insert(driverAvailabilityLog).values([
      { driverId: driverO.id, fromStatus: null, toStatus: "available", source: "driver", reason: "manual", at: new Date(Date.now() - 2 * 3600e3) },
      { driverId: driverO.id, fromStatus: "available", toStatus: "unavailable", source: "system", reason: "cancel_strikes", at: new Date(Date.now() - 3600e3) },
    ]);
    const j = (await get(admin, "/admin/analytics/drivers?compare=none")).json;
    expect(kpi(j, "flt_online_hours").value).toBeGreaterThan(3500); expect(kpi(j, "flt_online_hours").value).toBeLessThan(3700); // one hour between the two entries
    expect(kpi(j, "flt_suspensions").value).toBe(1);
    expect(j.heatmap.source).toBe("log"); expect(j.heatmap.cells.flat().some((v: number) => v > 0)).toBe(true);
    expect(kpi(j, "flt_util").value).not.toBeNull();
    expect(kpi((await get(admin, `/admin/analytics/drivers?compare=none&driver=${driverO.id}`)).json, "flt_online_hours").value).toBeGreaterThan(3500);
    expect(kpi((await get(admin, "/admin/analytics/drivers?compare=none&driver=0b8f3d3e-7b53-4c36-9f0c-6a8f0d2a7a11")).json, "flt_online_hours").value).toBe(0);
  });
  it("filters narrow the work: by driver, by company and by city", async () => {
    const { admin, driverO, driverD, alpha, bravo } = await world();
    const q = async (s: string) => (await get(admin, `/admin/analytics/drivers?${s}`)).json;
    expect(kpi(await q(`driver=${driverO.id}`), "active_drivers").value).toBe(1); expect(kpi(await q(`driver=${driverO.id}`), "flt_parcels_per").value).toBe(10);
    expect(kpi(await q(`driver=${driverD.id}`), "flt_parcels_per").value).toBe(0);
    expect(kpi(await q(`company=${alpha.id}`), "active_drivers").value).toBe(1); expect(kpi(await q(`company=${bravo.id}`), "active_drivers").value).toBe(1);
    expect(kpi(await q("city=jeddah"), "active_drivers").value).toBe(0);
    expect((await q("compare=none&service=car_with_driver")).kpis.find((k: any) => k.key === "flt_online_hours").unfiltered).toEqual(["service"]);
  });
  it("tables: scorecards, drivers to review, inactive drivers — identity masked without drivers.sensitive", async () => {
    const { admin, driverO, driverD, driverE } = await world();
    await db.update(driverProfiles).set({ suspendedUntil: new Date(Date.now() + 7 * 864e5), nationalId: "1234567890" }).where(eq(driverProfiles.userId, driverD.id));
    const staff = await mkStaff(["reports.view"]), sensitive = await mkStaff(["reports.view", "drivers.sensitive", "finance.view"]);
    const cards = (await get(sensitive, "/admin/analytics/drivers/table/scorecards")).json;
    expect(cards.total).toBe(2); expect(cards.rows.find((r: any) => r.id === driverO.id)).toMatchObject({ delivered: 10, jobs: 1, success: 1 }); expect(cards.rows.find((r: any) => r.id === driverO.id).phone).toBe(driverO.phone);
    expect(cards.rows.find((r: any) => r.id === driverD.id).nationalId).toBe("1234567890");
    const masked = (await get(staff, "/admin/analytics/drivers/table/scorecards")).json;
    for (const r of masked.rows) { expect(r.phone).toContain("•••"); expect(r.phone).not.toBe(driverO.phone); if (r.nationalId) expect(r.nationalId).toMatch(/^••••\d{3}$/); }
    expect(masked.columns.map((c: any) => c.key)).not.toContain("earnCents");
    const review = (await get(admin, "/admin/analytics/drivers/table/unreliable")).json;
    expect(review.rows.map((r: any) => [r.id, r.reason, r.flags])).toEqual([[driverD.id, "suspended", 1]]);
    const idle = (await get(admin, "/admin/analytics/drivers/table/inactive")).json;
    expect(idle.rows.map((r: any) => r.id)).toEqual([driverE.id]); expect(idle.rows[0].daysIdle).toBe(0); expect(idle.rows[0].lastJobAt).toBeNull();
    for (const [name, def] of [["scorecards", cards], ["unreliable", review], ["inactive", idle]] as const) for (const c of def.columns.filter((c: any) => c.sortable)) expect((await get(admin, `/admin/analytics/drivers/table/${name}?sort=${c.key}&dir=desc`)).status, `${name}.${c.key}`).toBe(200);
  });
  it("earnings, earnings per hour and cash held are omitted without finance.view", async () => {
    await world();
    const keys = (await get(await mkStaff(["reports.view"]), "/admin/analytics/drivers")).json.kpis.map((k: any) => k.key);
    for (const m of ["flt_earn_per", "flt_earn_hour", "flt_cash"]) expect(keys).not.toContain(m);
    expect(keys).toEqual(expect.arrayContaining(["flt_acceptance", "flt_success", "flt_rating"]));
  });
});

describe("GET /admin/analytics/offices", () => {
  it("computes the office KPIs from the real work and settlements", async () => {
    const { admin, office, settlement } = await world();
    await db.insert(officeInvites).values({ officeId: office.id, phone: "+966500000099", status: "accepted", respondedAt: new Date() });
    await db.insert(auditLogs).values({ actorId: office.id, actorRole: "office", action: "office.unlink_driver", entity: "user", entityId: office.id });
    const j = (await get(admin, "/admin/analytics/offices")).json;
    expect(j.kpis.map((k: any) => k.key)).toEqual(["cof_active", "cof_fleet", "cof_active_drivers", "cof_jobs", "cof_parcels", "cof_success", "cof_ontime", "cof_rating", "cof_util", "cof_earned", "cof_paid", "cof_pending", "cof_links", "cof_unlinks", "cof_agreed", ...FLEET_OFFICE_KPI_KEYS]);
    expect(kpi(j, "cof_active").value).toBe(1); expect(kpi(j, "cof_fleet").value).toBe(1); expect(kpi(j, "cof_active_drivers").value).toBe(1); expect(kpi(j, "cof_jobs").value).toBe(1);
    expect(kpi(j, "cof_parcels").value).toBe(10); expect(kpi(j, "cof_success").value).toBe(1); expect(kpi(j, "cof_util").value).toBe(1); expect(kpi(j, "cof_rating").value).toBe(5);
    // E18: a settlement is paid the moment it exists, so everything earned is already paid and nothing is pending
    expect(kpi(j, "cof_earned").value).toBe(settlement.providerCents); expect(kpi(j, "cof_paid").value).toBe(settlement.providerCents); expect(kpi(j, "cof_pending").value).toBe(0);
    expect(kpi(j, "cof_links").value).toBe(1); expect(kpi(j, "cof_unlinks").value).toBe(1); expect(kpi(j, "cof_agreed").value).toBe(1);
    expect(j.agreements).toEqual([{ key: "accepted", value: 1 }, { key: "pending_acceptance", value: 0 }, { key: "expired", value: 0 }, { key: "none", value: 0 }]);
    expect(j.fleet).toMatchObject({ offices: 1, total: 1 }); expect(j.leaders.byParcels[0]).toMatchObject({ id: office.id, parcels: 10 }); expect(j.drivers).toBeNull(); // no office filter: no per-office breakdown
    expect(j.series.activity.points).toHaveLength(30); expect(j.series.money.points.reduce((s: number, p: any) => s + p.earned, 0)).toBe(settlement.providerCents);
  });
  it("an office filter narrows to its drivers and fills the driver breakdown; an unknown office is empty", async () => {
    const { admin, office, driverO } = await world();
    const j = (await get(admin, `/admin/analytics/offices?office=${office.id}`)).json;
    expect(j.drivers.map((d: any) => d.id)).toEqual([driverO.id]); expect(j.drivers[0]).toMatchObject({ parcels: 10, jobs: 1 });
    const other = await mkOffice();
    const o = (await get(admin, `/admin/analytics/offices?office=${other.id}`)).json;
    expect(kpi(o, "cof_jobs").value).toBe(0); expect(kpi(o, "cof_success").value).toBeNull(); expect(o.drivers).toEqual([]);
    const t = (await get(admin, `/admin/analytics/offices/table/drivers?office=${office.id}`)).json;
    expect(t.rows.map((r: any) => r.id)).toEqual([driverO.id]); expect(t.rows[0].office).toContain("Off");
    expect((await get(admin, "/admin/analytics/offices/table/scorecards")).json.total).toBe(2);
    expect((await get(admin, `/admin/analytics/offices/table/scorecards?office=${office.id}`)).json.total).toBe(1);
  });
  it("earnings, payouts and pending money are omitted without finance.view; sorting still works", async () => {
    await world();
    const plain = await mkStaff(["reports.view"]);
    const j = (await get(plain, "/admin/analytics/offices")).json;
    const keys = j.kpis.map((k: any) => k.key);
    for (const m of ["cof_earned", "cof_paid", "cof_pending"]) expect(keys).not.toContain(m);
    expect(j.series.money).toBeNull(); expect(j.meta.moneyHidden).toBe(true);
    const t = (await get(plain, "/admin/analytics/offices/table/scorecards")).json;
    for (const m of ["earnedCents", "paidCents", "pendingCents"]) { expect(t.columns.map((c: any) => c.key)).not.toContain(m); expect(t.rows.every((r: any) => !(m in r))).toBe(true); }
    for (const c of t.columns.filter((c: any) => c.sortable)) expect((await get(plain, `/admin/analytics/offices/table/scorecards?sort=${c.key}`)).status, c.key).toBe(200);
  });
});

describe("GET /admin/analytics/growth", () => {
  it("counts signups by role and source, the verification funnel, activation and sign-in activity", async () => {
    const { admin, alpha, driverO } = await world();
    await db.insert(loginEvents).values([
      { userId: alpha.id, identifier: "a", method: "otp", success: true, client: "web" }, { userId: driverO.id, identifier: "b", method: "otp", success: true, client: "mobile" },
      { userId: null, identifier: "c", method: "otp", success: false, failureReason: "invalid_code", client: "web" },
    ]);
    const j = (await get(admin, "/admin/analytics/growth")).json;
    expect(j.kpis.map((k: any) => k.key)).toEqual(["new_signups", "gro_verified", "gro_verify_rate", "gro_ttv_p50", "gro_ttv_p90", "gro_doc_reject", "gro_company_activation", "gro_first_order", "gro_driver_activation", "gro_first_job",
      "gro_dau", "gro_wau", "gro_mau", "gro_stickiness", "gro_login_fail", "gro_backlog", "gro_backlog_age", "gro_stalled"]);
    expect(kpi(j, "new_signups")).toMatchObject({ value: 6, parts: [{ key: "business", value: 2 }, { key: "driver", value: 3 }, { key: "office", value: 1 }] });
    expect(j.series.signups.points.reduce((s: number, p: any) => s + p.business + p.driver + p.office, 0)).toBe(6);
    expect(j.sources).toEqual([{ key: "self", value: 6, prev: 0 }]); expect(j.geography.cities[0]).toMatchObject({ key: "riyadh", value: 6 });
    expect(j.funnels.map((f: any) => [f.role, f.steps.map((s: any) => s.count)])).toEqual([["business", [2, 2, 2]], ["driver", [3, 3, 3]], ["office", [1, 1, 1]]]);
    expect(kpi(j, "gro_verify_rate").value).toBe(1); expect(kpi(j, "gro_verified").value).toBe(0); // verified accounts without a verification event are not "newly verified"
    expect(kpi(j, "gro_company_activation").value).toBe(1); expect(kpi(j, "gro_first_order").value).toBeGreaterThanOrEqual(0);
    expect(kpi(j, "gro_driver_activation").value).toBeNull(); // no driver was verified by a document approval in the period
    expect(kpi(j, "gro_login_fail").value).toBeCloseTo(1 / 3, 5); expect(j.logins.clients.map((c: any) => c.key).sort()).toEqual(["mobile", "web"]); expect(j.logins.failures).toEqual([{ key: "invalid_code", value: 1 }]);
    expect(kpi(j, "gro_dau").value).toBe(2); expect(kpi(j, "gro_mau").value).toBe(2); expect(kpi(j, "gro_stickiness").value).toBe(1);
    expect(j.active.roles.business).toEqual({ dau: 1, wau: 1, mau: 1 }); expect(j.active.roles.driver.dau).toBe(1);
  });
  it("time to verify, document rejection reasons and the verification backlog", async () => {
    const { admin } = await world();
    const waiting = await mkBusiness({ verified: false, name: "Waiting Owner" });
    await db.insert(documents).values([
      { ownerId: waiting.id, ownerKind: "business", type: "business_cr", storageKey: "k1", fileName: "cr.pdf", mime: "application/pdf", size: 10, status: "submitted", createdAt: daysAgo(5) },
      { ownerId: waiting.id, ownerKind: "business", type: "tax_certificate", storageKey: "k2", fileName: "tax.pdf", mime: "application/pdf", size: 10, status: "rejected", reviewNote: "Blurry photo", reviewedAt: new Date() },
    ]);
    const j = (await get(admin, "/admin/analytics/growth")).json;
    expect(kpi(j, "gro_backlog").value).toBe(1); expect(j.backlog.total).toBe(1); expect(j.backlog.oldestDays).toBeGreaterThan(4.9); expect(j.backlog.buckets.map((b: any) => b.count)).toEqual([0, 0, 1, 0, 0]);
    expect(kpi(j, "gro_backlog_age").value).toBeGreaterThan(4.9 * 86400);
    expect(j.documents.reasons).toEqual([{ reason: "blurry photo", n: 1 }]); expect(kpi(j, "gro_doc_reject")).toMatchObject({ value: 1 });
    expect(j.documents.types.find((t: any) => t.key === "tax_certificate")).toMatchObject({ rejected: 1, rate: 1 });
    const pending = (await get(admin, "/admin/analytics/growth/table/pending")).json;
    expect(pending.rows.map((r: any) => [r.id, r.waiting, r.role])).toEqual([[waiting.id, 1, "business"]]); expect(pending.rows[0].ageDays).toBeGreaterThanOrEqual(4);
    // a staff verification is a verification event with a time to verify
    await db.insert(auditLogs).values({ actorId: admin.id, actorRole: "admin", action: "account.verify", entity: "user", entityId: waiting.id });
    clearAnalyticsCache();
    const v = (await get(admin, "/admin/analytics/growth")).json;
    expect(kpi(v, "gro_verified").value).toBe(1); expect(kpi(v, "gro_ttv_p50").value).toBeGreaterThanOrEqual(0); expect(v.verification.byRole.find((r: any) => r.role === "business").n).toBe(1);
  });
  it("finds stalled onboardings and says why", async () => {
    const { admin } = await world();
    const silent = await mkBusiness({ verified: false, name: "Silent Owner" });
    const idleCompany = await mkBusiness({ name: "Idle Verified" });
    await db.execute(sql.raw(`update users set created_at = now() - interval '10 days' where id in ('${silent.id}', '${idleCompany.id}')`));
    const j = (await get(admin, "/admin/analytics/growth")).json;
    expect(kpi(j, "gro_stalled").value).toBe(2);
    const t = (await get(admin, "/admin/analytics/growth/table/stalled")).json;
    expect(Object.fromEntries(t.rows.map((r: any) => [r.id, r.reason]))).toEqual({ [silent.id]: "no_documents", [idleCompany.id]: "not_ordered" });
    for (const c of t.columns.filter((c: any) => c.sortable)) expect((await get(admin, `/admin/analytics/growth/table/stalled?sort=${c.key}`)).status, c.key).toBe(200);
  });
  it("signups table lists the accounts of the period with the city filter, masks phones without drivers.sensitive, exports CSV", async () => {
    const { admin, driverO } = await world();
    const t = (await get(await mkStaff(["reports.view"]), "/admin/analytics/growth/table/signups")).json;
    expect(t.total).toBe(6); expect(t.rows.every((r: any) => String(r.phone).includes("•••"))).toBe(true);
    const full = (await get(await mkStaff(["reports.view", "drivers.sensitive"]), "/admin/analytics/growth/table/signups")).json;
    expect(full.rows.find((r: any) => r.id === driverO.id).phone).toBe(driverO.phone);
    expect((await get(admin, "/admin/analytics/growth/table/signups?city=jeddah")).json.total).toBe(0);
    expect((await get(admin, "/admin/analytics/growth?city=jeddah")).json.kpis.find((k: any) => k.key === "new_signups").value).toBe(0);
    expect((await get(await mkStaff(["reports.view", "reports.export"]), "/admin/analytics/growth/table/signups?format=csv")).text.slice(1).split("\n")).toHaveLength(1 + 6);
    expect((await get(admin, "/admin/analytics/growth?service=delivery_driver")).json.kpis.find((k: any) => k.key === "gro_verify_rate").unfiltered).toEqual(["service"]);
  });
});

describe("sparse and empty data, caching", () => {
  it("an empty platform answers every report with empty = true and no division by zero", async () => {
    const admin = await mkAdmin();
    for (const r of ["companies", "drivers", "offices", "growth"]) {
      const j = (await get(admin, `/admin/analytics/${r}`)).json;
      expect(j.meta.empty, r).toBe(true);
      for (const k of j.kpis) if (k.unit === "percent") expect(k.value === null || (k.value >= 0 && k.value <= 1), `${r} ${k.key}`).toBe(true);
    }
    for (const t of ["companies/table/leaderboard", "companies/table/at-risk", "companies/table/new", "drivers/table/scorecards", "drivers/table/unreliable", "drivers/table/inactive", "offices/table/scorecards", "offices/table/drivers", "growth/table/signups", "growth/table/pending", "growth/table/stalled"]) {
      const r = await get(admin, `/admin/analytics/${t}`);
      expect(r.status, t).toBe(200); expect(r.json.rows, t).toEqual([]); expect(r.json.total, t).toBe(0);
    }
  });
  it("caches an identical request for 30 s per permission class and filter set", async () => {
    const { admin, alpha } = await world();
    const a = (await get(admin, "/admin/analytics/companies")).json, b = (await get(admin, "/admin/analytics/companies")).json;
    expect(a.meta.cached).toBe(false); expect(b.meta.cached).toBe(true); expect(b.meta.generatedAt).toBe(a.meta.generatedAt);
    await insertRequest(alpha);
    expect(kpi((await get(admin, "/admin/analytics/companies")).json, "cmp_orders_per").value).toBe(1.5); // still the cached number
    expect((await get(admin, "/admin/analytics/companies?channel=web")).json.meta.cached).toBe(false);
    expect((await get(await mkStaff(["reports.view"]), "/admin/analytics/companies")).json.meta.cached).toBe(false);
    clearAnalyticsCache();
    expect(kpi((await get(admin, "/admin/analytics/companies")).json, "cmp_orders_per").value).toBe(2);
  });
});
