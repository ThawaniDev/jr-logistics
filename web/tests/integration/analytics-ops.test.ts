/**
 * Reports › Operations and Geography (`GET /admin/analytics/operations`, `/geography` and their drill-down tables).
 * One deterministic world built with direct inserts (every timestamp is relative to "now", so the numbers below are exact): demand and fill, punctuality, loading,
 * the offers funnel, cancellations by party / stage / reason, strikes, refunds, supply snapshots, parcels and the delivery grid. Covers permissions, that filters narrow
 * the numbers, money visibility, the section-failure contract (`meta.failed` is empty when every query ran), CSV and the cache.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries, metricSnapshots, notifications, offers, requests, shipments, walletAccounts } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkStaff, WAREHOUSE } from "../helpers/factories";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import { clearAnalyticsCache } from "@/server/analytics/guard";

beforeEach(async () => { await resetDb(); clearAnalyticsCache(); });
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const get = async (u: { id: string }, path: string) => call("GET", path, { token: await tok(u) });
const kpi = (json: any, key: string) => json.kpis.find((k: any) => k.key === key);
const H = 3600e3, D = 864e5, MIN = 60e3;
const now = Date.now();
let n = 0;

const mkRequest = async (biz: { id: string }, o: Partial<typeof requests.$inferInsert> & { published: number }) => {
  const { published, ...rest } = o;
  const [r] = await db.insert(requests).values({
    ref: `OP-${Date.now()}-${++n}`, businessId: biz.id, service: "delivery_driver", quantity: 1, pickupCity: "riyadh", deliveryCity: "riyadh", startsAt: new Date(now + D), status: "published",
    createdAt: new Date(published), publishedAt: new Date(published), pricingSnapshot: { quantity: o.quantity ?? 1 } as never, ...rest,
  }).returning();
  return r;
};
const mkOffer = async (r: { id: string; createdAt: Date }, driver: { id: string }, o: Partial<typeof offers.$inferInsert> = {}) => (await db.insert(offers).values({
  requestId: r.id, driverId: driver.id, status: "accepted", source: "system", expectedUnits: 10, expectedEarningCents: 1000, createdAt: r.createdAt, ...o,
}).returning())[0];

/**
 * A: 2 drivers, completed, one on time and one 50 minutes late · B: expired, nobody came · C: cancelled by its business before any driver · D: cancelled by its business after a driver accepted ·
 * E: a driver cancelled · F: a driver did not show · G: all-or-nothing, called off · H: still open (starts in 5 days).
 */
async function world() {
  const admin = await mkAdmin();
  const alpha = await mkBusiness({ name: "Alpha Owner" }), bravo = await mkBusiness({ name: "Bravo Owner" });
  const d1 = await mkDriver({ name: "Driver One" }), d2 = await mkDriver({ name: "Driver Two" }), d3 = await mkDriver({ name: "Driver Three" });
  const pubA = now - 5 * D, startA = now - 4 * D;
  const A = await mkRequest(alpha, { published: pubA, quantity: 2, startsAt: new Date(startA), status: "completed", slotsFilled: 2, pickupLat: WAREHOUSE.lat, pickupLng: WAREHOUSE.lng,
    firstOfferAt: new Date(pubA + 60e3), firstAcceptedAt: new Date(pubA + 600e3), filledAt: new Date(pubA + 1800e3), startedAt: new Date(startA + 10 * MIN), completedAt: new Date(startA + 3 * H) });
  const a1 = await mkOffer(A, d1, { status: "completed", acceptedAt: new Date(pubA + 600e3), arrivedAt: new Date(startA + 10 * MIN), arrivedLat: WAREHOUSE.lat, arrivedLng: WAREHOUSE.lng, attendanceAt: new Date(startA + 12 * MIN),
    loadedAt: new Date(startA + 40 * MIN), loadedUnits: 10, routeApprovedAt: new Date(startA + 45 * MIN), deliveredAt: new Date(startA + 165 * MIN) });
  const a2 = await mkOffer(A, d2, { status: "completed", source: "manual", acceptedAt: new Date(pubA + 1800e3), arrivedAt: new Date(startA + 50 * MIN), arrivedLat: WAREHOUSE.lat + 0.001, arrivedLng: WAREHOUSE.lng, attendanceAt: new Date(startA + 55 * MIN),
    loadedAt: new Date(startA + 100 * MIN), loadedUnits: 20, routeApprovedAt: new Date(startA + 105 * MIN), deliveredAt: new Date(startA + 225 * MIN) });
  const B = await mkRequest(alpha, { published: now - 6 * D, quantity: 3, deliveryCity: "jeddah", startsAt: new Date(now - 5 * D), status: "expired" });
  await mkOffer(B, d3, { status: "rejected", updatedAt: new Date(B.createdAt.getTime() + 120e3) });
  await mkOffer(B, d1, { status: "expired" });
  const C = await mkRequest(bravo, { published: now - 3 * D, startsAt: new Date(now + 2 * D), status: "cancelled", cancelledBy: bravo.id, cancelReason: "Changed plans", cancelledAt: new Date(now - 2 * D) });
  const Dd = await mkRequest(bravo, { published: now - 2 * D, startsAt: new Date(now + D), status: "cancelled", cancelledBy: bravo.id, cancelReason: "Changed plans", cancelledAt: new Date(now - D), slotsFilled: 1 });
  await mkOffer(Dd, d2, { status: "cancelled", cancelReason: "request_cancelled", acceptedAt: new Date(Dd.createdAt.getTime() + 300e3), cancelledAt: new Date(now - D) });
  const E = await mkRequest(alpha, { published: now - 2 * D, startsAt: new Date(now + D), status: "filling" });
  await mkOffer(E, d3, { status: "cancelled", cancelReason: "car broke down", acceptedAt: new Date(E.createdAt.getTime() + 300e3), cancelledAt: new Date(now - H) });
  const startF = now - 3 * D;
  const F = await mkRequest(bravo, { published: now - 4 * D, startsAt: new Date(startF), status: "filling" });
  await mkOffer(F, d3, { status: "no_show", cancelReason: "did not show", acceptedAt: new Date(F.createdAt.getTime() + 600e3), cancelledAt: new Date(startF + H) });
  const G = await mkRequest(alpha, { published: now - 7 * D, quantity: 2, allowPartial: false, startsAt: new Date(now - 6 * D), status: "cancelled", cancelReason: "not_fully_staffed", cancelledAt: new Date(now - 6 * D), slotsFilled: 1 });
  await mkOffer(G, d1, { status: "cancelled", cancelReason: "not_fully_staffed", acceptedAt: new Date(G.createdAt.getTime() + 300e3), cancelledAt: new Date(now - 6 * D) });
  await mkRequest(alpha, { published: now - H, startsAt: new Date(now + 5 * D), status: "published" });
  // supply snapshots: three hours of the platform row (and one Riyadh row)
  const hour = Math.floor(now / H) * H;
  for (const i of [1, 2, 3]) await db.insert(metricSnapshots).values({ at: new Date(hour - i * H), scope: "hour", city: null, metrics: { drivers_available: 4, drivers_busy: 1, requests_open: 2, slots_unfilled: 3 } });
  await db.insert(metricSnapshots).values({ at: new Date(hour - H), scope: "hour", city: "riyadh", metrics: { drivers_available: 4, drivers_busy: 1, requests_open: 2, slots_unfilled: 3 } });
  // strikes and refunds
  await db.insert(notifications).values([{ userId: d3.id, type: "cancel_warning", title: "w" }, { userId: d3.id, type: "cancel_suspended", title: "s" }]);
  const [acct] = await db.select().from(walletAccounts).where(eq(walletAccounts.ownerId, bravo.id));
  await db.insert(ledgerEntries).values({ accountId: acct.id, kind: "release_reserve", availableDeltaCents: 5000, reservedDeltaCents: -5000, requestId: C.id, idempotencyKey: `cancel-release:${C.id}` });
  // parcels: A carried 2 delivered (one hour / three hours after loading) and 1 failed; B had one parcel in Jeddah
  const parcel = (r: { id: string }, seq: number, o: Partial<typeof shipments.$inferInsert>) => ({ requestId: r.id, seq, code: `${r.id.slice(0, 8)}-${seq}`, recipientName: "R", recipientPhone: "0500000000", address: "x", city: "riyadh", ...o });
  const dl = startA + 165 * MIN;
  await db.insert(shipments).values([
    parcel(A, 1, { offerId: a1.id, status: "delivered", lat: 24.7136, lng: 46.6753, loadedAt: new Date(dl - H), deliveredAt: new Date(dl) }),
    parcel(A, 2, { offerId: a1.id, status: "delivered", lat: 24.714, lng: 46.676, loadedAt: new Date(dl - 3 * H), deliveredAt: new Date(dl) }),
    parcel(A, 3, { offerId: a2.id, status: "failed", failedAt: new Date(dl) }),
    parcel(B, 1, { status: "cancelled", city: "jeddah", lat: 21.52, lng: 39.23 }),
  ]);
  return { admin, alpha, bravo, d1, d2, d3, A, B, C, Dd, E, F, G };
}

describe("permissions", () => {
  it("only back-office staff with reports.view can read the reports and their tables", async () => {
    const { alpha, d1 } = await world();
    const paths = ["/admin/analytics/operations", "/admin/analytics/geography", "/admin/analytics/operations/table/late-jobs", "/admin/analytics/geography/table/cities"];
    for (const p of paths) {
      expect((await call("GET", p)).status, `anonymous ${p}`).toBe(401);
      expect((await get(alpha, p)).status, `business ${p}`).toBe(403);
      expect((await get(d1, p)).status, `driver ${p}`).toBe(403);
      expect((await get(await mkStaff(["requests.view", "finance.view"]), p)).status, `no reports.view ${p}`).toBe(403);
      expect((await get(await mkStaff(["reports.view"]), p)).status, `reports.view ${p}`).toBe(200);
    }
  });
});

describe("GET /admin/analytics/operations", () => {
  it("every query runs: no section failed, the response has the documented shape", async () => {
    const { admin } = await world();
    const r = await get(admin, "/admin/analytics/operations");
    expect(r.status).toBe(200);
    const j = r.json;
    expect(j.meta).toMatchObject({ bucket: "day", compare: "prev", empty: false, moneyHidden: false, failed: [], grace: 30 });
    expect(j.meta.period.days).toBe(30);
    expect(j.kpis.length).toBeGreaterThanOrEqual(30);
    for (const k of ["series", "speed", "funnel", "outcomes", "response", "execution", "supply", "pressure", "cancellations", "groups", "insights"]) expect(j[k], k).toBeTruthy();
    expect(j.series.demand.points).toHaveLength(30); expect(j.series.demand.prev).toHaveLength(30); expect(j.series.execution.points).toHaveLength(30);
    expect(j.pressure.unfilled.cells).toHaveLength(7); expect(j.pressure.unfilled.cells[0]).toHaveLength(24);
    for (const k of j.kpis) { expect(k.label).toMatch(/^rp[fo]\.kpi_/); expect(k.definition).toMatch(/^rp[fo]\.def_/); }
  });

  it("demand and fill: counts, fill rate over the requests whose outcome is known, expiry, all-or-nothing, assignment mix", async () => {
    const { admin } = await world();
    const j = (await get(admin, "/admin/analytics/operations")).json;
    expect(kpi(j, "requests_created").value).toBe(8); expect(kpi(j, "ops_published").value).toBe(8);
    // known outcome: A, B, D, F, G (C was withdrawn by its business, E and H are still open); slots 2+3+1+1+2 = 9, filled 2+0+1+0+1 = 4
    expect(kpi(j, "ops_fill_rate").value).toBeCloseTo(4 / 9, 5); expect(kpi(j, "ops_fully_filled").value).toBeCloseTo(2 / 5, 5); expect(kpi(j, "ops_unfilled_slots").value).toBe(5);
    expect(kpi(j, "ops_expiry_rate").value).toBeCloseTo(1 / 8, 5); expect(kpi(j, "ops_aon_failed").value).toBe(1); expect(kpi(j, "cancellation_rate").value).toBeCloseTo(3 / 8, 5);
    expect(kpi(j, "ops_manual_share").value).toBeCloseTo(1 / 6, 5); expect(kpi(j, "ops_replacement_rate").value).toBeCloseTo(2 / 6, 5);
    expect(kpi(j, "ops_offer_acceptance").value).toBeCloseTo(6 / 8, 5);
    // nothing happened in the previous 30 days: counts compare with 0, ratios have no previous value (never 0 %)
    expect(kpi(j, "requests_created")).toMatchObject({ prev: 0, delta: 8 }); expect(kpi(j, "ops_fill_rate")).toMatchObject({ prev: null, delta: null });
    // milestones: A has the capture columns (first offer 60 s, first acceptance 600 s, fully staffed 1800 s); the others fall back to their offers (offer at publishing = 0 s, accepted 300 / 600 s later).
    // Only A and D (1 of 1 slots, later cancelled) were ever fully staffed: 1800 s and 300 s.
    expect(j.speed.offer.p50.cur).toBe(0); expect(j.speed.offer.n).toBe(6); expect(j.speed.accept.p50.cur).toBe(300); expect(j.speed.accept.n).toBe(5);
    expect(j.speed.fill.n).toBe(2); expect(j.speed.fill.p50.cur).toBe(1050); expect(j.speed.fill.p90.cur).toBeCloseTo(1650, 3);
    expect(kpi(j, "ops_fill_p50").value).toBe(1050); expect(kpi(j, "ops_first_accept_p50").value).toBe(300); expect(kpi(j, "ops_first_offer_p50").value).toBe(0);
    expect(j.speed.fillHistogram.reduce((s: number, b: any) => s + b.count, 0)).toBe(2);
    expect(j.series.demand.points.reduce((s: number, p: any) => s + p.created, 0)).toBe(8);
    expect(j.series.demand.points.reduce((s: number, p: any) => s + p.slots, 0)).toBe(9); expect(j.series.demand.points.reduce((s: number, p: any) => s + p.filled, 0)).toBe(4);
  });

  it("execution: punctuality under the start-SLA rule, no-shows, check-in distance, loading, route approval, job duration, completion", async () => {
    const { admin } = await world();
    const j = (await get(admin, "/admin/analytics/operations")).json;
    // jobs due: A1 (10 min after the start: on time), A2 (50 min: late), F1 (no-show)
    expect(kpi(j, "on_time_start").value).toBeCloseTo(1 / 3, 5); expect(kpi(j, "ops_no_show_rate").value).toBeCloseTo(1 / 3, 5);
    expect(j.execution.delay.p50.cur).toBe(1800); expect(j.execution.delay.p90.cur).toBeCloseTo(2760, 3);
    expect(j.execution.delay.histogram.reduce((s: number, b: any) => s + b.count, 0)).toBe(2);
    expect(kpi(j, "ops_arrival_distance").value).toBeGreaterThan(40); expect(kpi(j, "ops_arrival_distance").value).toBeLessThan(70); // 0 m and ≈111 m → median ≈ 55 m
    expect(kpi(j, "ops_loading_p50").value).toBe(2400); expect(kpi(j, "ops_route_approval_p50").value).toBe(300); expect(kpi(j, "ops_job_duration_p50").value).toBe(7200);
    expect(kpi(j, "ops_parcels_per_job").value).toBe(15); expect(kpi(j, "ops_completion_rate").value).toBe(1);
    expect(kpi(j, "ops_stops_per_hour").value).toBeCloseTo(0.75, 5); // 3 stops resolved (2 delivered + 1 failed) over two 2-hour routes
    expect(j.execution.scan).toMatchObject({ scan: { cur: 0 }, warehouse: { cur: 0 } }); expect(kpi(j, "ops_scan_share").value).toBeNull();
    expect(j.series.execution.points.reduce((s: number, p: any) => s + p.due, 0)).toBe(3); expect(j.series.execution.points.reduce((s: number, p: any) => s + p.on_time, 0)).toBe(1);
    // the same number the Overview reports
    expect(kpi((await get(admin, "/admin/analytics/overview")).json, "on_time_start").value).toBeCloseTo(1 / 3, 5);
  });

  it("offers funnel and outcomes add up, and drivers' answers are timed", async () => {
    const { admin } = await world();
    const j = (await get(admin, "/admin/analytics/operations")).json;
    expect(j.funnel.map((s: any) => s.key)).toEqual(["offered", "accepted", "arrived", "loaded", "completed"]); expect(j.funnel.map((s: any) => s.count)).toEqual([8, 6, 2, 2, 2]);
    const out = Object.fromEntries(j.outcomes.map((o: any) => [o.key, o.count]));
    expect(out).toMatchObject({ completed: 2, rejected: 1, expired: 1, cancelled: 1, no_show: 1, replaced: 0, request_ended: 2, active: 0 });
    expect(j.outcomes.reduce((s: number, o: any) => s + o.count, 0)).toBe(8);
    expect(j.response.n).toBeGreaterThanOrEqual(7); expect(j.response.histogram.reduce((s: number, b: any) => s + b.count, 0)).toBe(j.response.n);
    expect(kpi(j, "ops_response_p50").value).toBeGreaterThan(0);
  });

  it("cancellations: by party, stage, kind, reason and lead time; repeat cancellers; strikes; refunds only with finance", async () => {
    const { admin, bravo, d3 } = await world();
    const c = (await get(admin, "/admin/analytics/operations")).json.cancellations;
    expect(Object.fromEntries(c.parties.map((x: any) => [x.key, x.count]))).toEqual({ business: 2, driver: 2, platform: 1 });
    expect(Object.fromEntries(c.stages.map((x: any) => [x.key, x.count]))).toEqual({ before_accept: 1, after_accept: 4, after_arrival: 0, mid_route: 0 });
    expect(Object.fromEntries(c.kinds.map((x: any) => [x.key, x.count]))).toEqual({ request: 3, driver_cancel: 1, no_show: 1, replaced: 0 });
    expect(c.reasons[0]).toMatchObject({ reason: "changed plans", count: 2, business: 2 }); expect(c.reasons.map((r: any) => r.reason)).toEqual(expect.arrayContaining(["car broke down", "did not show", "not_fully_staffed"]));
    expect(c.lead.histogram.map((b: any) => b.count)).toEqual([1, 1, 0, 0, 2, 1]); // no-show 1 h after its start · called off at its start · two 1–3 days ahead · one 4 days ahead
    expect(c.rankings.companies[0]).toMatchObject({ id: bravo.id, value: 2 }); expect(c.rankings.drivers[0]).toMatchObject({ id: d3.id, value: 2, noShows: 1 });
    expect(c.strikes.warnings.cur).toBe(1); expect(c.strikes.suspensions.cur).toBe(1);
    const j = (await get(admin, "/admin/analytics/operations")).json;
    expect(kpi(j, "ops_cancelled_requests").value).toBe(3); expect(kpi(j, "ops_driver_cancels").value).toBe(1); expect(kpi(j, "ops_late_cancel_share").value).toBeCloseTo(2 / 3, 5); expect(kpi(j, "ops_strikes").value).toBe(2);
    expect(kpi(j, "ops_refunds_released").value).toBe(5000); expect(c.refunds.cur).toBe(5000);
    expect(j.series.cancellations.points.reduce((s: number, p: any) => s + p.business + p.driver + p.platform, 0)).toBe(5);
    const plain = (await get(await mkStaff(["reports.view"]), "/admin/analytics/operations")).json;
    expect(plain.kpis.map((k: any) => k.key)).not.toContain("ops_refunds_released"); expect(plain.cancellations.refunds).toBeNull(); expect(plain.meta.moneyHidden).toBe(true);
    expect(kpi(plain, "ops_cancelled_requests").value).toBe(3); // everything else stays
  });

  it("supply vs demand reads the hourly snapshots, the city filter selects the city rows, other filters say they cannot narrow it", async () => {
    const { admin } = await world();
    const j = (await get(admin, "/admin/analytics/operations")).json;
    expect(kpi(j, "ops_drivers_available").value).toBe(4); expect(kpi(j, "ops_slots_open").value).toBe(3); expect(kpi(j, "ops_utilisation").value).toBeCloseTo(0.2, 5);
    expect(j.supply.cities.map((c: any) => c.city)).toEqual(["riyadh"]); expect(j.supply.cities[0]).toMatchObject({ available: 4, busy: 1, utilisation: 0.2 });
    expect(j.series.supply.points.reduce((s: number, p: any) => s + p.n, 0)).toBe(3); expect(j.series.supply.points.filter((p: any) => p.n === 0).every((p: any) => p.available === null)).toBe(true);
    const sa = (await get(admin, "/admin/analytics/operations?service=delivery_driver")).json;
    expect(kpi(sa, "ops_utilisation").unfiltered).toEqual(["service"]); expect(kpi(sa, "ops_fill_rate").unfiltered).toBeUndefined();
    const jeddah = (await get(admin, "/admin/analytics/operations?city=jeddah")).json; // there is no Jeddah snapshot: no data, not 0
    expect(kpi(jeddah, "ops_drivers_available").value).toBeNull(); expect(jeddah.meta.failed).toEqual([]);
  });

  it("filters narrow every number and an empty selection says so", async () => {
    const { admin, alpha, bravo, d1 } = await world();
    const q = async (s: string) => (await get(admin, `/admin/analytics/operations?${s}`)).json;
    expect(kpi(await q(`company=${alpha.id}`), "requests_created").value).toBe(5); expect(kpi(await q(`company=${bravo.id}`), "requests_created").value).toBe(3);
    expect(kpi(await q(`company=${bravo.id}`), "ops_cancelled_requests").value).toBe(2); expect(kpi(await q(`company=${alpha.id}`), "ops_cancelled_requests").value).toBe(1);
    expect(kpi(await q("city=jeddah"), "requests_created").value).toBe(1); expect(kpi(await q("city=jeddah"), "ops_expiry_rate").value).toBe(1);
    expect(kpi(await q(`driver=${d1.id}`), "on_time_start").value).toBe(1); // d1 was the on-time driver of A
    expect(kpi(await q("channel=api"), "requests_created").value).toBe(0); expect(kpi(await q("channel=api"), "ops_fill_rate").value).toBeNull();
    expect((await q("service=car_with_driver&city=tabuk")).meta.empty).toBe(true);
    expect((await q("compare=none")).kpis.every((k: any) => k.prev === null)).toBe(true); expect((await q("compare=none")).series.demand.prev).toBeNull();
    for (const s of ["", "city=riyadh", `company=${alpha.id}`, "service=delivery_driver&status=cancelled", "preset=7d", "bucket=week&preset=90d"]) expect((await q(s)).meta.failed, s).toEqual([]);
  });

  it("performance by city / service / vehicle / company and the rankings", async () => {
    const { admin, alpha } = await world();
    const g = (await get(admin, "/admin/analytics/operations")).json.groups;
    const city = Object.fromEntries(g.breakdowns.city.map((r: any) => [r.key, r]));
    expect(city.riyadh.requests).toBe(7); expect(city.jeddah.requests).toBe(1); expect(city.jeddah.expired).toBe(1); expect(city.riyadh.p50Fill).toBe(1050); expect(city.riyadh).toMatchObject({ slots: 6, filled: 4 });
    expect(g.breakdowns.service[0]).toMatchObject({ key: "delivery_driver", requests: 8 }); expect(g.breakdowns.vehicle).toHaveLength(1);
    expect(g.companies.find((c: any) => c.id === alpha.id)).toMatchObject({ requests: 5, name: expect.stringContaining("Alpha") });
    // ranked only with at least 3 requests: Riyadh, Alpha (5 requests, 1800 s) and Bravo (3 requests, 300 s); no driver arrived 3 times
    expect(g.rankings.slowCities).toEqual([{ key: "riyadh", name: "riyadh", value: 1050, n: 7 }]); expect(g.rankings.slowCompanies.map((c: any) => [c.name.includes("Alpha"), c.value])).toEqual([[true, 1800], [false, 300]]);
    expect(g.rankings.lateDrivers).toEqual([]); expect(g.rankings.fastCities.map((c: any) => c.key)).toEqual(["riyadh"]);
  });

  it("is cached for 30 s per permission class, and rejects invalid filters with a 422", async () => {
    const { admin, alpha } = await world();
    const a = (await get(admin, "/admin/analytics/operations")).json, b = (await get(admin, "/admin/analytics/operations")).json;
    expect(a.meta.cached).toBe(false); expect(b.meta.cached).toBe(true); expect(b.meta.generatedAt).toBe(a.meta.generatedAt);
    await mkRequest(alpha, { published: now - H });
    expect(kpi((await get(admin, "/admin/analytics/operations")).json, "requests_created").value).toBe(8); // still the cached number
    expect((await get(await mkStaff(["reports.view"]), "/admin/analytics/operations")).json.meta.cached).toBe(false);
    clearAnalyticsCache();
    expect(kpi((await get(admin, "/admin/analytics/operations")).json, "requests_created").value).toBe(9);
    for (const [qs, field] of [["preset=forever", "preset"], ["from=2026-03-05&to=2026-03-01", "to"], ["city=" + "x".repeat(50), "city"], ["compare=later", "compare"]] as const) {
      const r = await get(admin, `/admin/analytics/operations?${qs}`);
      expect(r.status, qs).toBe(422); expect(r.json.error.details.field, qs).toBe(field);
    }
  });
});

describe("operations drill-down tables", () => {
  it("late jobs, unfilled requests, cancellations, slow loads and slow fills list exactly what the KPIs count", async () => {
    const { admin, A, B, F } = await world();
    const t = async (name: string, qs = "") => (await get(admin, `/admin/analytics/operations/table/${name}${qs}`)).json;
    const late = await t("late-jobs");
    expect(late.total).toBe(2); expect(late.rows.map((r: any) => r.delayMin)).toEqual([50, null]); // sorted by delay, the no-show has none
    expect(late.rows[0]).toMatchObject({ ref: A.ref, driver: "Driver Two", status: "completed" }); expect(late.rows[1]).toMatchObject({ ref: F.ref, status: "no_show" });
    expect(late.columns.find((c: any) => c.key === "ref")).toMatchObject({ type: "link", href: "/admin/requests/{requestId}", sortable: true });
    const unfilled = await t("unfilled"); expect(unfilled.total).toBe(3); expect(unfilled.rows[0]).toMatchObject({ ref: B.ref, slots: 3, filled: 0, unfilled: 3, status: "expired" });
    const cancels = await t("cancellations"); expect(cancels.total).toBe(5);
    expect(cancels.rows.map((r: any) => r.kind).sort()).toEqual(["driver_cancel", "no_show", "request", "request", "request"]);
    expect(cancels.rows.find((r: any) => r.kind === "no_show")).toMatchObject({ party: "driver", stage: "after_accept", driver: "Driver Three", leadHours: null, afterHours: 1 });
    expect((await t("slow-loads")).rows.map((r: any) => r.loadingSecs)).toEqual([3000, 1800]);
    const fills = await t("slow-fills"); expect(fills.total).toBe(2); expect(fills.rows.map((r: any) => r.fillSecs)).toEqual([1800, 300]); expect(fills.rows[0]).toMatchObject({ ref: A.ref, acceptSecs: 600 });
    const asc = (await t("late-jobs", "?sort=ref&dir=asc")).rows.map((r: any) => r.ref);
    expect(asc).toHaveLength(2); expect((await t("late-jobs", "?sort=ref&dir=desc")).rows.map((r: any) => r.ref)).toEqual([...asc].reverse());
    expect((await t("late-jobs", "?company=" + A.businessId)).total).toBe(1);
    expect((await get(admin, "/admin/analytics/operations/table/late-jobs?sort=password")).status).toBe(422);
    expect((await get(admin, "/admin/analytics/operations/table/nope")).status).toBe(404);
  });
  it("CSV needs reports.export, covers the whole filtered set and is audited like every other table", async () => {
    await world();
    const viewer = await mkStaff(["reports.view"]), exporter = await mkStaff(["reports.view", "reports.export"]);
    expect((await get(viewer, "/admin/analytics/operations/table/cancellations?format=csv")).status).toBe(403);
    const r = await get(exporter, "/admin/analytics/operations/table/cancellations?format=csv&pageSize=1");
    expect(r.status).toBe(200); expect(r.headers.get("content-type")).toContain("text/csv"); expect(r.headers.get("content-disposition")).toContain("operations-cancellations.csv");
    expect(r.text.startsWith("﻿")).toBe(true); expect(r.text.slice(1).split("\n")).toHaveLength(1 + 5);
  });
});

describe("GET /admin/analytics/geography", () => {
  it("every query runs and the numbers agree with the parcels, requests and grid", async () => {
    const { admin } = await world();
    const r = await get(admin, "/admin/analytics/geography");
    expect(r.status).toBe(200);
    const j = r.json;
    expect(j.meta).toMatchObject({ failed: [], empty: false, moneyHidden: false, gridDeg: 0.05, located: 3, registered: 4 });
    expect(kpi(j, "requests_created").value).toBe(8); expect(kpi(j, "parcels_delivered").value).toBe(2); expect(kpi(j, "delivery_success").value).toBeCloseTo(2 / 3, 5);
    expect(kpi(j, "geo_avg_delivery").value).toBe(7200); expect(kpi(j, "geo_cities_served").value).toBe(2); expect(kpi(j, "geo_top_city_share").value).toBe(0.75);
    expect(kpi(j, "geo_cross_city").value).toBeCloseTo(1 / 8, 5); expect(kpi(j, "geo_geocoded").value).toBe(0.75); expect(kpi(j, "geo_active_zones")).toMatchObject({ value: 2, prev: 0 });
    expect(kpi(j, "geo_unserved_slots").value).toBe(5); expect(kpi(j, "geo_supply_demand").value).toBeCloseTo(3 / 9, 5);
    expect(kpi(j, "gmv").value).toBe(0);
    expect(kpi(j, "requests_created")).toMatchObject({ prev: 0, delta: 8 }); expect(kpi(j, "delivery_success")).toMatchObject({ prev: null });
    const city = Object.fromEntries(j.cities.map((c: any) => [c.key, c]));
    expect(city.riyadh).toMatchObject({ parcels: 3, delivered: 2, failed: 1, requests: 7, successRate: 2 / 3, failureRate: 1 / 3, avgDeliverySecs: 7200, slots: 6, filled: 4, unserved: 2, drivers: 3, activeDrivers: 3, activeCompanies: 2 });
    expect(city.jeddah).toMatchObject({ parcels: 1, delivered: 0, requests: 1, slots: 3, filled: 0, unserved: 3, successRate: null });
    expect(j.cities[0].key).toBe("riyadh"); expect(j.cities.reduce((s: number, c: any) => s + c.share, 0)).toBeCloseTo(1, 5);
    expect(j.routes.map((x: any) => [x.pickup, x.delivery, x.requests, x.crossCity])).toEqual([["riyadh", "riyadh", 7, false], ["riyadh", "jeddah", 1, true]]);
    expect(j.zones.map((z: any) => [z.id, z.parcels])).toEqual([["494:933", 2], ["430:784", 1]]);
    expect(j.zones[0]).toMatchObject({ south: 24.7, north: 24.75, west: 46.65, east: 46.7, delivered: 2, successRate: 1, share: 2 / 3, city: "riyadh" });
    expect(j.series.cities).toEqual(["riyadh"]); expect(j.series.points).toHaveLength(30); expect(j.series.points.reduce((s: number, p: any) => s + p.c0, 0)).toBe(2);
    expect(Array.isArray(j.insights)).toBe(true);
  });
  it("billed amounts need finance.view, filters narrow the report, an empty selection says so", async () => {
    const { admin, alpha, bravo } = await world();
    const plain = (await get(await mkStaff(["reports.view"]), "/admin/analytics/geography")).json;
    expect(plain.kpis.map((k: any) => k.key)).not.toContain("gmv"); expect(plain.meta.moneyHidden).toBe(true); expect(plain.cities.every((c: any) => c.gmv === null)).toBe(true); expect(plain.routes.every((x: any) => x.gmv === null)).toBe(true);
    expect((await get(await mkStaff(["reports.view"]), "/admin/analytics/geography/table/cities")).json.columns.map((c: any) => c.key)).not.toContain("gmv");
    expect((await get(admin, "/admin/analytics/geography/table/cities")).json.columns.map((c: any) => c.key)).toContain("gmv");
    const q = async (s: string) => (await get(admin, `/admin/analytics/geography?${s}`)).json;
    expect(kpi(await q(`company=${bravo.id}`), "parcels_delivered").value).toBe(0); expect(kpi(await q(`company=${alpha.id}`), "parcels_delivered").value).toBe(2);
    expect(kpi(await q("city=jeddah"), "requests_created").value).toBe(1); expect((await q("city=jeddah")).zones.map((z: any) => z.id)).toEqual(["430:784"]);
    expect((await q("channel=api")).meta.empty).toBe(true);
    for (const s of ["", "compare=none", "preset=7d", "bucket=week&preset=90d", `driver=${(await mkDriver()).id}`]) expect((await q(s)).meta.failed, s).toEqual([]);
  });
  it("cities, routes and zones tables sort, page and export the same numbers", async () => {
    await world();
    const admin = await mkAdmin(); const exporter = await mkStaff(["reports.view", "reports.export"]);
    const t = async (name: string, qs = "") => (await get(admin, `/admin/analytics/geography/table/${name}${qs}`)).json;
    const cities = await t("cities"); expect(cities.total).toBe(2); expect(cities.rows.map((r: any) => r.city)).toEqual(["riyadh", "jeddah"]); expect(cities.rows[0]).toMatchObject({ parcels: 3, failedAll: 1, successRate: 2 / 3 });
    expect((await t("cities", "?sort=successRate&dir=desc")).rows.map((r: any) => r.city)).toEqual(["riyadh", "jeddah"]); // missing rates sort last
    expect((await t("cities", "?pageSize=1&page=2")).rows.map((r: any) => r.city)).toEqual(["jeddah"]);
    expect((await t("routes")).total).toBe(2); const zones = await t("zones"); expect(zones.total).toBe(2); expect(zones.rows[0]).toMatchObject({ zone: "24.725, 46.675", parcels: 2 });
    expect((await get(admin, "/admin/analytics/geography/table/cities?sort=nope")).status).toBe(422);
    const csv = await get(exporter, "/admin/analytics/geography/table/zones?format=csv");
    expect(csv.status).toBe(200); expect(csv.text.startsWith("﻿")).toBe(true); expect(csv.text.slice(1).split("\n")).toHaveLength(3); expect(csv.headers.get("content-disposition")).toContain("geography-zones.csv");
  });
});
