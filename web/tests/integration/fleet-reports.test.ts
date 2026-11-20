/**
 * Fleet reports (drivers + courier offices): the new drill-down tables `perf daily money money_daily jobs failures` (+ `earnings` for offices) and the `fl_*` KPIs, against a small world
 * whose every number is worked out by hand (tests/helpers/fleet-world.ts: period 10–12 May 2026, three drivers, one office with two of them, one independent driver).
 * Covers exact values of every metric, null-not-zero, the zero-filled Riyadh day grid and its 366-day refusal, money masking and permissions, the Independent-drivers row, filters and CSV.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { resetDb, shutdown, mkStaff } from "../helpers/factories";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import { clearAnalyticsCache } from "@/server/analytics/guard";
import { FLEET_DRIVER_KPI_KEYS, FLEET_OFFICE_KPI_KEYS } from "@/server/analytics/fleet-kpis";
import { haversineM } from "@/server/analytics/fleet-lib";
import { PIN, Q, seedFleetWorld } from "../helpers/fleet-world";

type W = Awaited<ReturnType<typeof seedFleetWorld>>;
let w: W;
beforeAll(async () => { await resetDb(); w = await seedFleetWorld(); });
beforeEach(() => clearAnalyticsCache());
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const get = async (u: { id: string }, path: string) => call("GET", path, { token: await tok(u) });
const tbl = async (u: { id: string }, report: string, name: string, qs = Q, extra = "") => (await get(u, `/admin/analytics/${report}/table/${name}?${qs}&pageSize=100${extra}`)).json;
const byId = (j: { rows: Array<Record<string, any>> }, id: string) => j.rows.find((r) => r.id === id)!;
const kpi = (j: any, key: string) => j.kpis.find((k: any) => k.key === key);
const km = (steps: number) => haversineM(PIN.lat, PIN.lng, PIN.lat + 0.1 * steps, PIN.lng); // metres for `steps` × 0.1° due north of the pickup pin
const close = (v: number, expected: number) => expect(Math.abs(v - expected)).toBeLessThanOrEqual(1);
const noFinance = () => mkStaff(["reports.view"]);

describe("permissions and validation", () => {
  it("every table needs reports.view; money tables also finance.view; CSV needs reports.export", async () => {
    const names: Array<[string, string]> = [["drivers", "perf"], ["drivers", "daily"], ["drivers", "jobs"], ["drivers", "failures"], ["offices", "perf"], ["offices", "daily"], ["offices", "jobs"], ["offices", "failures"]];
    const money: Array<[string, string]> = [["drivers", "money"], ["drivers", "money_daily"], ["offices", "money"], ["offices", "money_daily"], ["offices", "earnings"]];
    const nobody = await mkStaff(["requests.view"]), viewer = await noFinance();
    for (const [r, n] of [...names, ...money]) {
      expect((await call("GET", `/admin/analytics/${r}/table/${n}?${Q}`)).status, `anonymous ${r}/${n}`).toBe(401);
      expect((await get(nobody, `/admin/analytics/${r}/table/${n}?${Q}`)).status, `no reports.view ${r}/${n}`).toBe(403);
      expect((await get(w.admin, `/admin/analytics/${r}/table/${n}?${Q}`)).status, `admin ${r}/${n}`).toBe(200);
    }
    for (const [r, n] of names) expect((await get(viewer, `/admin/analytics/${r}/table/${n}?${Q}`)).status, `viewer ${r}/${n}`).toBe(200);
    for (const [r, n] of money) expect((await get(viewer, `/admin/analytics/${r}/table/${n}?${Q}`)).status, `viewer ${r}/${n}`).toBe(403);
    expect((await get(viewer, `/admin/analytics/drivers/table/perf?${Q}&format=csv`)).status).toBe(403);
    const csv = await get(await mkStaff(["reports.view", "reports.export"]), `/admin/analytics/drivers/table/perf?${Q}&format=csv`);
    expect(csv.status).toBe(200); expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    const cols = (await tbl(w.admin, "drivers", "perf")).columns.map((c: any) => c.key);
    expect(csv.text.split("\n")[0].replace("﻿", "").split(",")).toEqual(cols);
  });
  it("refuses a daily table over more than 366 days with a 422 naming the field, accepts exactly 366", async () => {
    for (const [r, n] of [["drivers", "daily"], ["drivers", "money_daily"], ["offices", "daily"], ["offices", "money_daily"]]) {
      const bad = await get(w.admin, `/admin/analytics/${r}/table/${n}?from=2025-05-09&to=2026-05-10&bucket=week`);
      expect(bad.status, `${r}/${n}`).toBe(422); expect(bad.json.error.details.field).toBe("to");
      const ok = await tbl(w.admin, r, n, "from=2025-05-10&to=2026-05-10&bucket=week&compare=none");
      expect(ok.total, `${r}/${n}`).toBe(366); expect(ok.rows).toHaveLength(100);
    }
    expect((await get(w.admin, `/admin/analytics/drivers/table/perf?from=2025-05-09&to=2026-05-10&bucket=week&compare=none`)).status).toBe(200); // other tables have no such limit
    expect((await get(w.admin, `/admin/analytics/drivers/table/daily?${Q}&sort=nope`)).status).toBe(422);
    expect((await get(w.admin, `/admin/analytics/drivers/table/nope?${Q}`)).status).toBe(404);
  });
});

describe("drivers › perf", () => {
  it("every metric of every driver, worked out by hand", async () => {
    const j = await tbl(w.admin, "drivers", "perf");
    expect(j.total).toBe(3); expect(j.rows.map((r: any) => r.id)).toEqual([w.d1.id, w.d2.id, w.d3.id]); // delivered desc: 4, 3, 2
    const d1 = byId(j, w.d1.id), d2 = byId(j, w.d2.id), d3 = byId(j, w.d3.id);
    expect(d1).toMatchObject({
      name: "Driver One", office: expect.any(String), offered: 4, declined: 1, timedout: 1, declineRate: 0.5, acceptance: 0.5, respAvg: 120, respP90: 168,
      jobs: 2, activeDays: 1, onlineDays: 2, jobsPerActiveDay: 2, parcelsPerActiveDay: 4, online: 39600, delivPerOnlineHour: 0.36, parcelsPerJob: 2,
      punctual: 1, late: 1, veryLate: 0, onTime: 1, lateAvgMin: 20, arrivalDeltaAvgMin: 5, attendAvgMin: 7.5, loadAvgMin: 15, waitAvgMin: 22.5, planAvgMin: 5,
      stopAvgMin: 8.75, parcelAvgMin: 70, jobAvgMin: 115, routeM: 3500, gpsM: null, delivered: 4, failed: 1, returned: 1, pendingParcels: 1, firstAttempt: 0.75, deferrals: 1,
      proofOtp: 3, proofReceipt: 1, codParcels: 1, rating: 4, ratingCount: 2, stars1: 0, stars3: 1, stars5: 1, complaints: 1, complaintsOpen: 1, strikes: 0, suspensions: 0,
    });
    expect(d1.success).toBeCloseTo(4 / 6, 5); close(d1.radiusM, km(7));
    expect(d2).toMatchObject({
      offered: 3, declined: 0, timedout: 0, declineRate: 0, acceptance: 1, respAvg: 740, respP90: 1500, jobs: 2, activeDays: 1, onlineDays: 1, online: 21600, delivPerOnlineHour: 0.5, parcelsPerJob: 1.5,
      punctual: 1, late: 0, veryLate: 1, onTime: 0.5, lateAvgMin: 45, arrivalDeltaAvgMin: 22.5, attendAvgMin: null, loadAvgMin: 22.5, waitAvgMin: 22.5, planAvgMin: null,
      stopAvgMin: 8.33, parcelAvgMin: 60, jobAvgMin: 142.5, routeM: null, gpsM: null, delivered: 3, failed: 0, returned: 0, pendingParcels: 0, success: 1, deferrals: 0, proofOtp: 3, codParcels: 1,
      rating: null, ratingCount: 0, complaints: 1, complaintsOpen: 0, strikes: 1, suspensions: 1,
    });
    expect(d2.firstAttempt).toBeCloseTo(2 / 3, 5); close(d2.radiusM, km(4));
    expect(d3).toMatchObject({
      offered: 2, declined: 0, timedout: 1, declineRate: 0.5, acceptance: 0.5, respAvg: 600, respP90: 600, jobs: 1, onlineDays: 1, online: 21600, delivPerOnlineHour: 0.33, parcelsPerJob: 2,
      punctual: 1, late: 0, veryLate: 0, onTime: 1, lateAvgMin: null, arrivalDeltaAvgMin: -30, attendAvgMin: null, loadAvgMin: null, waitAvgMin: null, planAvgMin: null, stopAvgMin: 7.5, parcelAvgMin: null,
      jobAvgMin: 90, routeM: null, delivered: 2, failed: 1, returned: 0, firstAttempt: 1, rating: null, complaints: 0, strikes: 0,
    });
    expect(d3.success).toBeCloseTo(2 / 3, 5); close(d3.radiusM, km(2));
  });
  it("tells the Independent office apart, and money never appears in perf", async () => {
    const j = await tbl(w.admin, "drivers", "perf");
    expect(byId(j, w.d3.id).office).toBe("direct"); expect(byId(j, w.d1.id).office).not.toBe("direct");
    for (const r of j.rows) expect(Object.keys(r).filter((k) => k.endsWith("Cents"))).toEqual([]);
    expect(j.columns.map((c: any) => c.key)).toEqual(expect.arrayContaining(["lateAvgMin", "radiusM", "delivPerOnlineHour"]));
    expect(j.columns.every((c: any) => /^fr\.col_/.test(c.label) || /^rpp\./.test(c.label))).toBe(true);
  });
  it("GPS distance exists only when an office or driver filter narrows the selection: A→B→C counted, the gap, the jump and the inaccurate fix dropped", async () => {
    const { A, B, C } = w.track;
    const want = haversineM(A.lat, A.lng, B.lat, B.lng) + haversineM(B.lat, B.lng, C.lat, C.lng);
    close(byId(await tbl(w.admin, "drivers", "perf", `${Q}&driver=${w.d1.id}`), w.d1.id).gpsM, want);
    close(byId(await tbl(w.admin, "drivers", "perf", `${Q}&office=${w.o1.id}`), w.d1.id).gpsM, want);
    expect(byId(await tbl(w.admin, "drivers", "perf", `${Q}&office=${w.o1.id}`), w.d2.id).gpsM).toBeNull(); // no fixes: no data, not 0 m
    expect(byId(await tbl(w.admin, "drivers", "perf"), w.d1.id).gpsM).toBeNull(); // not narrowed
  });
  it("filters narrow it: a driver, an office; a delivery city narrows offers and parcels but not online time", async () => {
    expect((await tbl(w.admin, "drivers", "perf", `${Q}&driver=${w.d2.id}`)).rows.map((r: any) => r.id)).toEqual([w.d2.id]);
    expect((await tbl(w.admin, "drivers", "perf", `${Q}&office=${w.o1.id}`)).rows.map((r: any) => r.id).sort()).toEqual([w.d1.id, w.d2.id].sort());
    const jed = await tbl(w.admin, "drivers", "perf", `${Q}&city=jeddah`);
    expect(byId(jed, w.d1.id)).toMatchObject({ offered: 0, jobs: 0, delivered: 0, declineRate: null, lateAvgMin: null, onlineDays: 2, online: 39600 });
    expect((await tbl(w.admin, "drivers", "perf", `${Q}&office=${w.o2.id}`)).total).toBe(0);
  });
  it("sorting works on every column and the default is delivered, descending", async () => {
    const j = await tbl(w.admin, "drivers", "perf");
    for (const c of j.columns.filter((c: any) => c.sortable)) expect((await get(w.admin, `/admin/analytics/drivers/table/perf?${Q}&sort=${c.key}&dir=asc`)).status, c.key).toBe(200);
    expect((await tbl(w.admin, "drivers", "perf", Q, "&sort=lateAvgMin&dir=desc")).rows.map((r: any) => r.id)).toEqual([w.d2.id, w.d1.id, w.d3.id]); // nulls last
    expect((await tbl(w.admin, "drivers", "perf", Q, "&sort=name&dir=asc")).rows.map((r: any) => r.name)).toEqual(["Driver One", "Driver Three", "Driver Two"]);
  });
  it("ties to the existing Drivers report: jobs, parcels, acceptance and on-time agree", async () => {
    const cards = await tbl(w.admin, "drivers", "scorecards"), perf = await tbl(w.admin, "drivers", "perf");
    for (const id of [w.d1.id, w.d2.id, w.d3.id]) {
      const c = byId(cards, id), p = byId(perf, id);
      expect(p.jobs, id).toBe(c.jobs); expect(p.delivered, id).toBe(c.delivered); expect(p.acceptance, id).toBe(c.acceptance); expect(p.onTime, id).toBe(c.onTime); expect(p.success, id).toBe(c.success);
      expect(p.rating, id).toBe(c.rating); expect(p.online, id).toBe(c.online);
    }
  });
});

describe("drivers › daily and money", () => {
  it("one zero-filled row per Riyadh day, each measure on its own date", async () => {
    const j = await tbl(w.admin, "drivers", "daily", Q, "&sort=date&dir=asc");
    expect(j.total).toBe(3); expect(j.rows.map((r: any) => r.date)).toEqual(["2026-05-10", "2026-05-11", "2026-05-12"]);
    const [a, b, c] = j.rows;
    expect([a, b, c].map((r) => [r.registered, r.onlineDrivers, r.driversWithJobs, r.online])).toEqual([[0, 1, 1, 28800], [0, 2, 1, 32400], [0, 1, 1, 21600]]);
    expect([a, b, c].map((r) => [r.offered, r.declined, r.timedout, r.cancelled, r.jobs])).toEqual([[4, 0, 1, 1, 2], [4, 1, 1, 0, 2], [1, 0, 0, 0, 1]]);
    expect([a, b, c].map((r) => [r.delivered, r.failed, r.returned])).toEqual([[4, 1, 1], [3, 0, 0], [2, 1, 0]]);
    expect([a, b, c].map((r) => [r.punctual, r.late, r.veryLate])).toEqual([[1, 1, 0], [1, 0, 1], [1, 0, 0]]);
    expect([a, b, c].map((r) => r.lateAvgMin)).toEqual([20, 45, null]); expect([a, b, c].map((r) => r.waitAvgMin)).toEqual([22.5, 22.5, null]);
    expect([a, b, c].map((r) => r.stopAvgMin)).toEqual([8.75, 8.33, 7.5]); expect([a, b, c].map((r) => r.delivPerOnlineHour)).toEqual([0.5, 0.33, 0.33]);
    close(a.radiusM, km(7)); close(b.radiusM, km(4)); close(c.radiusM, km(2));
    expect((await tbl(w.admin, "drivers", "daily")).rows.map((r: any) => r.date)).toEqual(["2026-05-12", "2026-05-11", "2026-05-10"]); // newest first by default
  });
  it("a longer period is filled with zero rows (null for averages), and a day without data is never missing", async () => {
    const j = await tbl(w.admin, "drivers", "daily", "from=2026-05-08&to=2026-05-14&compare=none", "&sort=date&dir=asc");
    expect(j.rows.map((r: any) => r.date)).toHaveLength(7);
    const quiet = j.rows[0];
    expect(quiet).toMatchObject({ date: "2026-05-08", onlineDrivers: 0, online: 0, offered: 0, jobs: 0, delivered: 0, lateAvgMin: null, waitAvgMin: null, radiusM: null });
    expect(j.rows[6]).toMatchObject({ date: "2026-05-14", jobs: 0 });
  });
  it("a day starts at midnight in Riyadh: 21:00 UTC belongs to the next day", async () => {
    const j = await tbl(w.admin, "drivers", "daily", "from=2026-05-10&to=2026-05-10&compare=none"); // the 10th only: nothing of the 11th leaks in
    expect(j.total).toBe(1); expect(j.rows[0]).toMatchObject({ jobs: 2, delivered: 4, offered: 4 });
  });
  it("perf_daily: one row per driver and day that had something (the Daily-by-driver sheet), summing to the daily table", async () => {
    const j = await tbl(w.admin, "drivers", "perf_daily", Q, "&sort=date&dir=asc");
    const row = (d: { id: string }, date: string) => j.rows.find((r: any) => r.driverId === d.id && r.date === date);
    expect(j.total).toBe(6); expect(j.rows.map((r: any) => `${r.driver}|${r.date}`).sort()).toEqual(["Driver One|2026-05-10", "Driver One|2026-05-11", "Driver Three|2026-05-10", "Driver Three|2026-05-12", "Driver Two|2026-05-10", "Driver Two|2026-05-11"]);
    expect(new Set(j.rows.map((r: any) => r.id)).size).toBe(6);
    expect(row(w.d1, "2026-05-10")).toMatchObject({ online: 28800, offered: 2, jobs: 2, delivered: 4, failed: 1, returned: 1, punctual: 1, late: 1, lateAvgMin: 20, waitAvgMin: 22.5, stopAvgMin: 8.75, delivPerOnlineHour: 0.5 });
    expect(row(w.d1, "2026-05-11")).toMatchObject({ online: 10800, offered: 2, declined: 1, timedout: 1, jobs: 0, delivered: 0, lateAvgMin: null, delivPerOnlineHour: 0 });
    expect(row(w.d2, "2026-05-10")).toMatchObject({ online: 0, offered: 1, cancelled: 1, jobs: 0 });
    expect(row(w.d2, "2026-05-11")).toMatchObject({ online: 21600, offered: 2, jobs: 2, delivered: 3, punctual: 1, veryLate: 1, lateAvgMin: 45 });
    expect(row(w.d3, "2026-05-10")).toMatchObject({ offered: 1, timedout: 1, jobs: 0, office: "direct" });
    expect(row(w.d3, "2026-05-12")).toMatchObject({ jobs: 1, delivered: 2, failed: 1, arrivalDeltaAvgMin: -30 });
    const sum = (k: string) => j.rows.reduce((s: number, r: any) => s + r[k], 0), daily = (await tbl(w.admin, "drivers", "daily")).rows.reduce((s: number, r: any) => s + r.jobs, 0);
    expect(sum("jobs")).toBe(daily); expect(sum("delivered")).toBe(9); expect(sum("online")).toBe(28800 + 10800 + 21600 + 21600);
    expect((await tbl(w.admin, "drivers", "perf_daily", `${Q}&driver=${w.d3.id}`)).total).toBe(2);
    expect((await get(w.admin, `/admin/analytics/drivers/table/perf_daily?from=2025-05-09&to=2026-05-10&bucket=week`)).status).toBe(422);
  });
  it("money per driver (finance.view): settlement figures, cash on delivery and the ratios", async () => {
    const j = await tbl(w.admin, "drivers", "money");
    expect(j.rows.map((r: any) => r.id)).toEqual([w.d1.id, w.d2.id, w.d3.id]);
    expect(byId(j, w.d1.id)).toMatchObject({ jobs: 2, delivered: 4, customerCents: 5000, earnCents: 3500, marginCents: 1500, vatCents: 750, refundCents: 100, adjustCents: 50, paidCents: 2100, pendingCents: 1400,
      codCollectedCents: 5000, codRemittedCents: 3000, codHeldCents: 2000, earnPerJobCents: 1750, earnPerParcelCents: 875, earnPerHourCents: 318 });
    expect(byId(j, w.d2.id)).toMatchObject({ customerCents: 3500, earnCents: 2450, marginCents: 1050, vatCents: 525, paidCents: 1750, pendingCents: 700, codCollectedCents: 8000, codRemittedCents: 0, codHeldCents: 8000,
      earnPerJobCents: 1225, earnPerParcelCents: 817, earnPerHourCents: 408 });
    expect(byId(j, w.d3.id)).toMatchObject({ customerCents: 1500, earnCents: 1050, paidCents: 1050, pendingCents: 0, codCollectedCents: 0, codHeldCents: 0, earnPerJobCents: 1050, earnPerParcelCents: 525, earnPerHourCents: 175 });
  });
  it("money by day: created / paid / collected / handed in each on their own day", async () => {
    const j = await tbl(w.admin, "drivers", "money_daily", Q, "&sort=date&dir=asc");
    expect(j.rows.map((r: any) => [r.customerCents, r.earnCents, r.marginCents, r.vatCents, r.refundCents, r.adjustCents])).toEqual([[5000, 3500, 1500, 750, 100, 50], [3500, 2450, 1050, 525, 0, 0], [1500, 1050, 450, 225, 0, 0]]);
    expect(j.rows.map((r: any) => r.paidCents)).toEqual([0, 2100, 2800]); expect(j.rows.map((r: any) => r.codCollectedCents)).toEqual([5000, 8000, 0]); expect(j.rows.map((r: any) => r.codRemittedCents)).toEqual([0, 3000, 0]);
    expect(j.rows.map((r: any) => [r.jobs, r.delivered])).toEqual([[2, 4], [2, 3], [1, 2]]);
    expect(j.rows.map((r: any) => r.earnPerJobCents)).toEqual([1750, 1225, 1050]); expect(j.rows.map((r: any) => r.earnPerParcelCents)).toEqual([875, 817, 525]); expect(j.rows.map((r: any) => r.earnPerHourCents)).toEqual([438, 272, 175]);
  });
});

describe("drivers › jobs and failures", () => {
  it("one row per kept job with its warehouse times, parcels, distance, cash and earning", async () => {
    const j = await tbl(w.admin, "drivers", "jobs");
    expect(j.total).toBe(5); expect(j.rows.map((r: any) => r.id)).toEqual([w.o31.id, w.o22.id, w.o21.id, w.o12.id, w.o11.id]); // start time, newest first; the cancelled offer is not a job
    expect(byId(j, w.o12.id)).toMatchObject({ driver: "Driver One", driverId: w.d1.id, requestId: w.r2.id, lateMin: 20, waitMin: 30, loadMin: 20, planMin: 5, expected: 4, delivered: 1, failed: 0, returned: 1, codCollectedCents: null, codRemittedCents: null, earnCents: 1400, status: "completed" });
    expect(byId(j, w.o12.id).office).not.toBe("direct"); close(byId(j, w.o12.id).radiusM, km(1));
    expect(byId(j, w.o11.id)).toMatchObject({ lateMin: 0, waitMin: 15, loadMin: 10, planMin: 5, delivered: 3, failed: 1, returned: 0, codCollectedCents: 5000, codRemittedCents: 3000, earnCents: 2100 });
    expect(byId(j, w.o31.id)).toMatchObject({ office: "direct", lateMin: 0, waitMin: null, loadMin: null, planMin: null, delivered: 2, failed: 1, radiusM: expect.any(Number) });
    expect(byId(j, w.o21.id)).toMatchObject({ lateMin: 45, waitMin: 15, loadMin: 15, planMin: null });
  });
  it("money columns are removed without finance.view", async () => {
    const viewer = await noFinance(), j = await tbl(viewer, "drivers", "jobs");
    for (const k of ["codCollectedCents", "codRemittedCents", "earnCents"]) { expect(j.columns.map((c: any) => c.key)).not.toContain(k); expect(j.rows.every((r: any) => !(k in r))).toBe(true); }
    expect(j.rows).toHaveLength(5); expect(byId(j, w.o12.id).delivered).toBe(1);
  });
  it("failure reasons: count, share and drivers affected", async () => {
    const j = await tbl(w.admin, "drivers", "failures", Q, "&sort=reason&dir=asc");
    expect(j.rows.map((r: any) => r.reason)).toEqual(["closed", "refused", "wrong_address"]);
    for (const r of j.rows) { expect(r.count).toBe(1); expect(r.drivers).toBe(1); expect(r.share).toBeCloseTo(1 / 3, 5); }
    expect((await tbl(w.admin, "drivers", "failures", `${Q}&driver=${w.d1.id}`)).rows.map((r: any) => [r.reason, r.share]).sort()).toEqual([["closed", 0.5], ["refused", 0.5]]);
    expect((await tbl(w.admin, "drivers", "failures", "from=2026-05-01&to=2026-05-02&compare=none")).total).toBe(0);
  });
});

describe("offices › perf with the Independent drivers row", () => {
  it("one row per office plus one for drivers with no office, sums of their drivers", async () => {
    const j = await tbl(w.admin, "offices", "perf");
    expect(j.rows.map((r: any) => r.id)).toEqual([w.o1.id, "direct", w.o2.id]); expect(j.total).toBe(3); // delivered desc: 7, 2, 0
    const o1 = byId(j, w.o1.id), direct = byId(j, "direct"), o2 = byId(j, w.o2.id);
    expect(direct.name).toBe("direct"); expect(o1.name).not.toBe("direct"); expect(direct.agreement).toBeNull(); expect(o1.agreement).toBe("accepted");
    expect(o1).toMatchObject({
      fleet: 2, driversActive: 2, links: 0, unlinks: 0, offered: 7, declined: 1, timedout: 1, acceptance: 5 / 7, respAvg: 492, jobs: 4, activeDays: 2, onlineDays: 3, online: 61200,
      delivPerOnlineHour: 0.41, parcelsPerJob: 1.75, punctual: 2, late: 1, veryLate: 1, onTime: 0.75, lateAvgMin: 32.5, arrivalDeltaAvgMin: 13.75, attendAvgMin: 7.5, loadAvgMin: 18.75, waitAvgMin: 22.5, planAvgMin: 5,
      stopAvgMin: 8.57, parcelAvgMin: 65.71, jobAvgMin: 128.75, routeM: 3500, gpsM: null, delivered: 7, failed: 1, returned: 1, pendingParcels: 1, deferrals: 1, proofOtp: 6, proofReceipt: 1, codParcels: 2,
      rating: 4, ratingCount: 2, complaints: 2, complaintsOpen: 1, strikes: 1, suspensions: 1,
    });
    expect(o1.respP90).toBeCloseTo(1200, 6); expect(o1.declineRate).toBeCloseTo(2 / 7, 5); expect(o1.success).toBeCloseTo(7 / 9, 5); expect(o1.firstAttempt).toBeCloseTo(5 / 7, 5); close(o1.radiusM, km(11));
    expect(direct).toMatchObject({ fleet: 1, driversActive: 1, offered: 2, timedout: 1, jobs: 1, delivered: 2, failed: 1, onlineDays: 1, online: 21600, arrivalDeltaAvgMin: -30, respP90: 600 }); close(direct.radiusM, km(2));
    expect(o2).toMatchObject({ fleet: 0, driversActive: 0, offered: 0, jobs: 0, delivered: 0, online: 0, declineRate: null, acceptance: null, respAvg: null, respP90: null, lateAvgMin: null, waitAvgMin: null, radiusM: null, routeM: null, success: null, rating: null });
  });
  it("an office filter leaves only that office; a driver filter only the office (or the independent bucket) that has the driver", async () => {
    expect((await tbl(w.admin, "offices", "perf", `${Q}&office=${w.o1.id}`)).rows.map((r: any) => r.id)).toEqual([w.o1.id]);
    expect((await tbl(w.admin, "offices", "perf", `${Q}&office=${w.o2.id}`)).rows.map((r: any) => r.id)).toEqual([w.o2.id]);
    expect((await tbl(w.admin, "offices", "perf", `${Q}&driver=${w.d3.id}`)).rows.map((r: any) => r.id)).toEqual(["direct"]);
    const one = await tbl(w.admin, "offices", "perf", `${Q}&driver=${w.d1.id}`);
    expect(one.rows.map((r: any) => r.id)).toEqual([w.o1.id]); expect(one.rows[0]).toMatchObject({ fleet: 1, jobs: 2, delivered: 4 }); close(one.rows[0].gpsM, haversineM(w.track.A.lat, w.track.A.lng, w.track.B.lat, w.track.B.lng) + haversineM(w.track.B.lat, w.track.B.lng, w.track.C.lat, w.track.C.lng));
  });
  it("ties to the Offices report: jobs, parcels and the settlement figures agree", async () => {
    const cards = byId(await tbl(w.admin, "offices", "scorecards"), w.o1.id), perf = byId(await tbl(w.admin, "offices", "perf"), w.o1.id), money = byId(await tbl(w.admin, "offices", "money"), w.o1.id);
    expect(perf.jobs).toBe(cards.jobs); expect(perf.delivered).toBe(cards.delivered); expect(perf.onTime).toBe(cards.onTime); expect(perf.rating).toBe(cards.rating);
    expect(money.earnCents).toBe(cards.earnedCents); expect(money.paidCents).toBe(cards.paidCents); expect(money.pendingCents).toBe(cards.pendingCents);
  });
});

describe("offices › money, daily, earnings, jobs, failures", () => {
  it("money per office (settlements keyed by the payee office) and for the independent drivers", async () => {
    const j = await tbl(w.admin, "offices", "money");
    expect(j.rows.map((r: any) => r.id)).toEqual([w.o1.id, "direct", w.o2.id]);
    expect(byId(j, w.o1.id)).toMatchObject({ jobs: 4, delivered: 7, customerCents: 8500, earnCents: 5950, marginCents: 2550, vatCents: 1275, refundCents: 100, adjustCents: 50, paidCents: 3850, pendingCents: 2100,
      codCollectedCents: 13000, codRemittedCents: 3000, codHeldCents: 10000, earnPerJobCents: 1488, earnPerParcelCents: 850, earnPerHourCents: 350 });
    expect(byId(j, "direct")).toMatchObject({ customerCents: 1500, earnCents: 1050, marginCents: 450, vatCents: 225, paidCents: 1050, pendingCents: 0, codCollectedCents: 0, codHeldCents: 0 });
    expect(byId(j, w.o2.id)).toMatchObject({ customerCents: 0, earnCents: 0, paidCents: 0, earnPerJobCents: null, earnPerParcelCents: null, earnPerHourCents: null });
  });
  it("daily counts only work done through an office (independent drivers are in the Drivers report)", async () => {
    const j = await tbl(w.admin, "offices", "daily", Q, "&sort=date&dir=asc");
    expect(j.rows.map((r: any) => [r.onlineDrivers, r.online, r.offered, r.timedout, r.jobs, r.delivered, r.failed, r.returned])).toEqual([[1, 28800, 3, 0, 2, 4, 1, 1], [2, 32400, 4, 1, 2, 3, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]]);
    expect(j.rows.map((r: any) => r.lateAvgMin)).toEqual([20, 45, null]);
    expect((await tbl(w.admin, "offices", "daily", `${Q}&office=${w.o2.id}`)).rows.every((r: any) => r.jobs === 0 && r.delivered === 0 && r.online === 0)).toBe(true);
    const money = await tbl(w.admin, "offices", "money_daily", Q, "&sort=date&dir=asc");
    expect(money.rows.map((r: any) => r.earnCents)).toEqual([3500, 2450, 0]); expect(money.rows.map((r: any) => r.paidCents)).toEqual([0, 2100, 1750]);
  });
  it("earnings: one row per billed settlement paid to an office", async () => {
    const j = await tbl(w.admin, "offices", "earnings");
    expect(j.total).toBe(4); const sum = (k: string) => j.rows.reduce((s: number, r: any) => s + r[k], 0);
    expect([sum("customerCents"), sum("earnCents"), sum("marginCents"), sum("vatCents"), sum("refundCents")]).toEqual([8500, 5950, 2550, 1275, 100]);
    expect(j.rows.map((r: any) => r.status).sort()).toEqual(["approved", "paid", "paid", "pending_review"]);
    expect(j.rows.every((r: any) => r.office !== "direct" && r.ref && r.driver && r.createdAt)).toBe(true);
    expect((await tbl(w.admin, "offices", "earnings", `${Q}&office=${w.o2.id}`)).total).toBe(0);
  });
  it("jobs and failures cover the offices' work only", async () => {
    expect((await tbl(w.admin, "offices", "jobs")).rows.map((r: any) => r.id).sort()).toEqual([w.o11.id, w.o12.id, w.o21.id, w.o22.id].sort());
    const f = await tbl(w.admin, "offices", "failures", Q, "&sort=reason&dir=asc");
    expect(f.rows.map((r: any) => [r.reason, r.share, r.drivers])).toEqual([["closed", 0.5, 1], ["refused", 0.5, 1]]);
  });
  it("money columns and tables are hidden from a viewer without finance.view; the rest still works", async () => {
    const viewer = await noFinance();
    const perf = await tbl(viewer, "offices", "perf");
    expect(perf.total).toBe(3); for (const r of perf.rows) expect(Object.keys(r).filter((k) => k.endsWith("Cents"))).toEqual([]);
    expect(byId(perf, w.o1.id).jobs).toBe(4);
  });
});

describe("fleet KPIs on the reports", () => {
  it("the Drivers report appends the fl_* KPIs after its own, with the exact values", async () => {
    const j = (await get(w.admin, `/admin/analytics/drivers?${Q}`)).json;
    const keys = j.kpis.map((k: any) => k.key);
    expect(keys.slice(-FLEET_DRIVER_KPI_KEYS.length)).toEqual([...FLEET_DRIVER_KPI_KEYS]); expect(keys.slice(0, 3)).toEqual(["active_drivers", "flt_available", "flt_online_hours"]); expect(j.partial).toEqual([]);
    const v = (k: string) => kpi(j, k).value;
    expect(v("fl_late")).toBe(0.4); expect(v("fl_very_late")).toBe(0.2); expect(v("fl_late_avg")).toBe(1950); expect(v("fl_arrival_delta")).toBe(5); expect(v("fl_wait")).toBe(1350); expect(v("fl_load")).toBe(1125); expect(v("fl_stop_time")).toBe(500);
    expect(v("fl_parcel_time")).toBeCloseTo(27600 / 7, 4); expect(v("fl_job_time")).toBe(7260); expect(v("fl_radius")).toBeCloseTo(km(13) / 1000, 3); expect(v("fl_route")).toBe(3.5);
    expect(v("fl_decline_rate")).toBeCloseTo(1 / 3, 5); expect(v("fl_timeout_rate")).toBeCloseTo(2 / 9, 5); expect(v("fl_resp_avg")).toBe(510); expect(v("fl_active_days")).toBe(3); expect(v("fl_online_days")).toBe(4);
    expect(v("fl_efficiency")).toBeCloseTo(9 / 23, 5); expect(v("fl_parcels_per_job")).toBe(1.8); expect(v("first_attempt")).toBeCloseTo(7 / 9, 5); expect(v("fl_complaints")).toBe(2);
    expect(keys).not.toContain("fl_cod_held"); expect(kpi(j, "fl_late")).toMatchObject({ label: "fr.kpi_fl_late", definition: "fr.def_fl_late", numerator: "fr.def_fl_late_n", denominator: "fr.def_fl_late_d", unit: "percent", prev: null });
  });
  it("the Offices report counts the offices' work only and adds the COD balance", async () => {
    const j = (await get(w.admin, `/admin/analytics/offices?${Q}`)).json;
    expect(j.kpis.map((k: any) => k.key).slice(-FLEET_OFFICE_KPI_KEYS.length)).toEqual([...FLEET_OFFICE_KPI_KEYS]);
    const v = (k: string) => kpi(j, k).value;
    expect(v("fl_late")).toBe(0.5); expect(v("fl_very_late")).toBe(0.25); expect(v("fl_late_avg")).toBe(1950); expect(v("fl_arrival_delta")).toBe(13.75); expect(v("fl_job_time")).toBe(7725); expect(v("fl_radius")).toBeCloseTo(km(11) / 1000, 3);
    expect(v("fl_decline_rate")).toBeCloseTo(2 / 7, 5); expect(v("fl_resp_avg")).toBe(492); expect(v("fl_active_days")).toBe(2); expect(v("fl_online_days")).toBe(3); expect(v("fl_efficiency")).toBeCloseTo(7 / 17, 5); expect(v("fl_parcels_per_job")).toBe(1.75);
    expect(v("fl_cod_held")).toBe(10000); expect(v("fl_complaints")).toBe(2);
  });
  it("without finance.view the COD KPI is absent and the money-hidden flag is set; with a comparison the previous period has counts and no ratios", async () => {
    const viewer = await noFinance();
    const o = (await get(viewer, `/admin/analytics/offices?${Q}`)).json;
    expect(o.kpis.map((k: any) => k.key)).not.toContain("fl_cod_held"); expect(o.meta.moneyHidden).toBe(true); expect(kpi(o, "fl_late").value).toBe(0.5);
    const j = (await get(w.admin, "/admin/analytics/drivers?from=2026-05-10&to=2026-05-12")).json; // compare = previous 3 days: nothing happened
    expect(kpi(j, "fl_active_days").prev).toBe(0); expect(kpi(j, "fl_late").prev).toBeNull(); expect(kpi(j, "fl_efficiency").prev).toBeNull(); expect(kpi(j, "fl_radius").prev).toBeNull();
  });
  it("an empty selection shows no data, not zero, in every ratio", async () => {
    const j = (await get(w.admin, `/admin/analytics/drivers?from=2026-01-01&to=2026-01-05&compare=none`)).json;
    for (const k of ["fl_late", "fl_late_avg", "fl_wait", "fl_stop_time", "fl_decline_rate", "fl_resp_avg", "fl_efficiency", "fl_parcels_per_job", "first_attempt", "fl_radius", "fl_route"]) expect(kpi(j, k).value, k).toBeNull();
    for (const k of ["fl_active_days", "fl_online_days", "fl_complaints"]) expect(kpi(j, k).value, k).toBe(0);
  });
});
