/**
 * Reports framework + the Overview report: `GET /admin/analytics/overview`, `/options` and the drill-down table registry (`/:report/table/:name`, CSV).
 * Covers permissions, that filters narrow the numbers, Riyadh day boundaries, money visibility, the 30 s cache, validation and the CSV export contract.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, offers, requests, settlements } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, mkStaff, publishedRequest } from "../helpers/factories";
import { work } from "../helpers/work";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import * as jobs from "@/server/jobs";
import { clearAnalyticsCache } from "@/server/analytics/guard";
import { defineTable } from "@/server/analytics/registry";

beforeEach(async () => { await resetDb(); clearAnalyticsCache(); });
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const get = async (u: { id: string }, path: string) => call("GET", path, { token: await tok(u) });
let n = 0;
const insertRequest = async (biz: { id: string }, o: Partial<typeof requests.$inferInsert> = {}) => (await db.insert(requests).values({
  ref: `AN-${Date.now()}-${++n}`, businessId: biz.id, service: "delivery_driver", quantity: 1, pickupCity: "riyadh", deliveryCity: "riyadh", startsAt: new Date(), status: "published", ...o,
}).returning())[0];
const kpi = (json: any, key: string) => json.kpis.find((k: any) => k.key === key);

/** Alpha: one completed job (10 parcels delivered, settled). Bravo: one open request and one cancelled. One driver. */
async function world() {
  const admin = await mkAdmin(); await mkRule(admin);
  const alpha = await mkBusiness({ fundsCents: 5000_00, name: "Alpha Owner" }), bravo = await mkBusiness({ fundsCents: 5000_00, name: "Bravo Owner" });
  const driver = await mkDriver();
  const r1 = await publishedRequest(alpha); const [o1] = await db.select().from(offers).where(eq(offers.requestId, r1.id));
  await jobs.acceptOffer(driver, o1.id, true); await jobs.confirmAttendance(alpha, o1.id, true); await work(alpha, driver, o1.id, 10);
  const r2 = await publishedRequest(bravo, { startsAt: new Date(Date.now() + 3 * 864e5) });
  const r3 = await insertRequest(bravo, { status: "cancelled", cancelledAt: new Date(), deliveryCity: "jeddah" });
  const [settlement] = await db.select().from(settlements).where(eq(settlements.requestId, r1.id));
  return { admin, alpha, bravo, driver, r1, r2, r3, settlement };
}

describe("permissions", () => {
  it("only back-office staff with reports.view can read the overview, options and tables", async () => {
    const { alpha, driver } = await world();
    const paths = ["/admin/analytics/overview", "/admin/analytics/options", "/admin/analytics/overview/table/requests"];
    for (const p of paths) {
      expect((await call("GET", p)).status, `anonymous ${p}`).toBe(401);
      expect((await get(alpha, p)).status, `business ${p}`).toBe(403);
      expect((await get(driver, p)).status, `driver ${p}`).toBe(403);
      expect((await get(await mkStaff(["requests.view", "finance.view"]), p)).status, `no reports.view ${p}`).toBe(403);
      expect((await get(await mkStaff(["reports.view"]), p)).status, `reports.view ${p}`).toBe(200);
    }
  });
});

describe("GET /admin/analytics/overview", () => {
  it("computes the KPIs of the period from the real data", async () => {
    const { admin, settlement } = await world();
    const r = await get(admin, "/admin/analytics/overview");
    expect(r.status).toBe(200);
    const j = r.json;
    expect(j.meta).toMatchObject({ bucket: "day", compare: "prev", empty: false, moneyHidden: false });
    expect(j.meta.period.days).toBe(30); expect(j.meta.prevPeriod.days).toBe(30);
    expect(kpi(j, "requests_created").value).toBe(3);
    expect(kpi(j, "requests_completed").value).toBe(1);
    expect(kpi(j, "cancellation_rate").value).toBeCloseTo(1 / 3, 5);
    expect(kpi(j, "parcels_delivered").value).toBe(10);
    expect(kpi(j, "delivery_success").value).toBe(1);
    expect(kpi(j, "first_attempt").value).toBe(1);
    expect(kpi(j, "active_companies").value).toBe(2);
    expect(kpi(j, "active_drivers").value).toBe(1);
    expect(kpi(j, "parcels_per_request").value).toBe(10);
    expect(kpi(j, "new_signups")).toMatchObject({ value: 3, parts: [{ key: "business", value: 2 }, { key: "driver", value: 1 }, { key: "office", value: 0 }] });
    expect(kpi(j, "gmv").value).toBe(settlement.customerCents);
    expect(kpi(j, "revenue").value).toBe(settlement.marginCents);
    expect(kpi(j, "margin_pct").value).toBeCloseTo(settlement.marginCents / settlement.customerCents, 5);
    expect(kpi(j, "aov").value).toBe(settlement.customerCents);
    // nothing happened in the previous 30 days: counts compare with 0, ratios have no previous value and never show 0 %
    expect(kpi(j, "requests_created")).toMatchObject({ prev: 0, delta: 3, deltaPct: null });
    expect(kpi(j, "delivery_success")).toMatchObject({ prev: null, delta: null, deltaPct: null });
    expect(kpi(j, "gmv").label).toBe("rpf.kpi_gmv");
  });

  it("series are zero-filled, add up to the KPIs, and breakdowns / funnel / rankings agree", async () => {
    const { admin, alpha, driver, settlement } = await world();
    const j = (await get(admin, "/admin/analytics/overview")).json;
    expect(j.series.requests.points).toHaveLength(30); expect(j.series.requests.prev).toHaveLength(30);
    expect(j.series.requests.points.reduce((s: number, p: any) => s + p.total, 0)).toBe(3);
    expect(j.series.parcels.points.reduce((s: number, p: any) => s + p.delivered, 0)).toBe(10);
    expect(j.series.money.points.reduce((s: number, p: any) => s + p.gmv, 0)).toBe(settlement.customerCents);
    expect(j.series.requests.points.filter((p: any) => p.total === 0).length).toBeGreaterThanOrEqual(28); // no holes: empty days are present as zeros
    expect(j.breakdowns.city.map((r: any) => [r.key, r.requests])).toEqual(expect.arrayContaining([["riyadh", 2], ["jeddah", 1]]));
    expect(j.breakdowns.service.find((r: any) => r.key === "delivery_driver").requests).toBe(3);
    expect(j.breakdowns.channel.find((r: any) => r.key === "web").requests).toBe(3);
    expect(j.breakdowns.city.reduce((s: number, r: any) => s + r.share, 0)).toBeCloseTo(1, 5);
    expect(j.funnel.map((s: any) => s.key)).toEqual(["published", "accepted", "filled", "started", "completed"]);
    expect(j.funnel.map((s: any) => s.count)).toEqual([3, 1, 1, 1, 1]);
    expect(j.heatmap.total).toBe(10); expect(j.heatmap.cells).toHaveLength(7); expect(j.heatmap.cells[0]).toHaveLength(24);
    expect(j.rankings.companies).toMatchObject({ by: "gmv" });
    expect(j.rankings.companies.rows[0]).toMatchObject({ id: alpha.id, value: settlement.customerCents });
    expect(j.rankings.drivers[0]).toMatchObject({ id: driver.id, deliveries: 10 });
    expect(j.movers.companies.up[0]).toMatchObject({ id: alpha.id });
    expect(Array.isArray(j.insights)).toBe(true);
  });

  it("filters narrow every number (company, city, service, channel, status) and an empty selection says so", async () => {
    const { admin, alpha, bravo } = await world();
    const q = async (s: string) => (await get(admin, `/admin/analytics/overview?${s}`)).json;
    expect(kpi(await q(`company=${alpha.id}`), "requests_created").value).toBe(1);
    expect(kpi(await q(`company=${bravo.id}`), "requests_created").value).toBe(2);
    expect(kpi(await q(`company=${bravo.id}`), "parcels_delivered").value).toBe(0);
    expect(kpi(await q(`company=${alpha.id},${bravo.id}`), "requests_created").value).toBe(3);
    expect(kpi(await q(`company=${alpha.id}&company=${bravo.id}`), "requests_created").value).toBe(3);
    expect(kpi(await q("city=jeddah"), "requests_created").value).toBe(1);
    expect(kpi(await q("city=riyadh,jeddah"), "requests_created").value).toBe(3);
    expect(kpi(await q("status=cancelled"), "requests_created").value).toBe(1);
    expect(kpi(await q("channel=web"), "requests_created").value).toBe(3);
    const none = await q("channel=api");
    expect(kpi(none, "requests_created").value).toBe(0); expect(kpi(none, "delivery_success").value).toBeNull(); expect(kpi(none, "gmv").value).toBe(0);
    const empty = await q("service=car_with_driver&city=tabuk");
    expect(empty.meta.empty).toBe(true);
    // a filter a KPI cannot honour is called out on that KPI
    expect(kpi(await q("service=delivery_driver"), "new_signups").unfiltered).toEqual(["service"]);
    expect(kpi(await q("service=delivery_driver"), "new_signups").value).toBe(3);
    expect(kpi(await q("city=jeddah"), "new_signups").value).toBe(0);
  });

  it("filters by driver", async () => {
    const { admin, driver } = await world(); const other = await mkDriver();
    expect(kpi((await get(admin, `/admin/analytics/overview?driver=${driver.id}`)).json, "parcels_delivered").value).toBe(10);
    expect(kpi((await get(admin, `/admin/analytics/overview?driver=${other.id}`)).json, "parcels_delivered").value).toBe(0);
    expect(kpi((await get(admin, `/admin/analytics/overview?driver=${driver.id}`)).json, "requests_created").value).toBe(1);
  });

  it("buckets in Riyadh time: 23:59:59 and 00:00:00 local fall on different days", async () => {
    const { admin, alpha } = await world();
    await insertRequest(alpha, { createdAt: new Date("2026-03-10T20:59:59Z"), status: "completed" }); // 23:59:59 on 10 March in Riyadh
    await insertRequest(alpha, { createdAt: new Date("2026-03-10T21:00:00Z"), status: "completed" }); // 00:00:00 on 11 March
    const day = async (d: string) => (await get(admin, `/admin/analytics/overview?from=${d}&to=${d}&compare=none`)).json;
    const a = await day("2026-03-10"), b = await day("2026-03-11");
    expect(kpi(a, "requests_created").value).toBe(1); expect(kpi(b, "requests_created").value).toBe(1);
    expect(a.meta.bucket).toBe("hour"); expect(a.series.requests.points).toHaveLength(24);
    expect(a.series.requests.points.find((p: any) => p.t === "2026-03-10T23").total).toBe(1);
    expect(b.series.requests.points.find((p: any) => p.t === "2026-03-11T00").total).toBe(1);
    expect(a.series.requests.prev).toBeNull(); expect(a.movers).toBeNull();
    const week = (await get(admin, "/admin/analytics/overview?from=2026-03-08&to=2026-03-14&bucket=week&compare=none")).json; // Sunday 8 – Saturday 14 March
    expect(week.series.requests.points.map((p: any) => p.t)).toEqual(["2026-03-08"]); expect(week.series.requests.points[0].total).toBe(2);
    const month = (await get(admin, "/admin/analytics/overview?from=2026-02-20&to=2026-04-02&bucket=month&compare=none")).json;
    expect(month.series.requests.points.map((p: any) => p.t)).toEqual(["2026-02-01", "2026-03-01", "2026-04-01"]); expect(month.series.requests.points[1].total).toBe(2);
  });

  it("compare=yoy and compare=none", async () => {
    const { admin } = await world();
    const yoy = (await get(admin, "/admin/analytics/overview?preset=30d&compare=yoy")).json;
    expect(yoy.meta.prevPeriod.from.slice(0, 4)).toBe(String(Number(yoy.meta.period.from.slice(0, 4)) - 1));
    const none = (await get(admin, "/admin/analytics/overview?compare=none")).json;
    expect(none.meta.prevPeriod).toBeNull(); expect(kpi(none, "requests_created")).toMatchObject({ prev: null, delta: null });
  });

  it("money KPIs, series and rankings are omitted without finance.view, everything else stays", async () => {
    const { settlement, alpha } = await world();
    const plain = (await get(await mkStaff(["reports.view"]), "/admin/analytics/overview")).json;
    const keys = plain.kpis.map((k: any) => k.key);
    for (const m of ["gmv", "revenue", "margin_pct", "aov"]) expect(keys).not.toContain(m);
    expect(keys).toEqual(expect.arrayContaining(["requests_created", "parcels_delivered", "delivery_success"]));
    expect(plain.meta.moneyHidden).toBe(true); expect(plain.series.money).toBeNull();
    expect(plain.rankings.companies.by).toBe("requests"); expect(plain.rankings.companies.rows[0].value).toBe(2); // Bravo: one open and one cancelled request outrank Alpha's single one
    expect(plain.breakdowns.city.every((r: any) => r.gmv === null && r.revenue === null)).toBe(true);
    expect(plain.rankings.companies.rows.every((r: any) => r.orders === null)).toBe(true);
    const fin = (await get(await mkStaff(["reports.view", "finance.view"]), "/admin/analytics/overview")).json;
    expect(kpi(fin, "gmv").value).toBe(settlement.customerCents); expect(fin.rankings.companies.rows[0].id).toBe(alpha.id);
  });

  it("caches an identical request for 30 s per permission class", async () => {
    const { admin, alpha } = await world();
    const a = (await get(admin, "/admin/analytics/overview")).json, b = (await get(admin, "/admin/analytics/overview")).json;
    expect(a.meta.cached).toBe(false); expect(b.meta.cached).toBe(true); expect(b.meta.generatedAt).toBe(a.meta.generatedAt);
    await insertRequest(alpha);
    expect(kpi((await get(admin, "/admin/analytics/overview")).json, "requests_created").value).toBe(3); // still the cached number
    expect((await get(admin, "/admin/analytics/overview?channel=web")).json.meta.cached).toBe(false); // other filters, other entry
    const plain = (await get(await mkStaff(["reports.view"]), "/admin/analytics/overview")).json;
    expect(plain.meta.cached).toBe(false); // another permission class never reads the finance entry
    clearAnalyticsCache();
    expect(kpi((await get(admin, "/admin/analytics/overview")).json, "requests_created").value).toBe(4);
  });

  it("rejects invalid filters with a 422 that names the field", async () => {
    const { admin } = await world();
    const bad = async (qs: string) => { const r = await get(admin, `/admin/analytics/overview?${qs}`); return { status: r.status, field: r.json?.error?.details?.field as string | undefined, message: r.json?.error?.details?.[r.json?.error?.details?.field] as string | undefined }; };
    expect(await bad("preset=forever")).toMatchObject({ status: 422, field: "preset" });
    expect(await bad("from=2026-02-31&to=2026-03-01")).toMatchObject({ status: 422, field: "from" });
    expect(await bad("from=2026-03-05&to=2026-03-01")).toMatchObject({ status: 422, field: "to" });
    expect(await bad("from=2024-01-01&to=2026-06-01")).toMatchObject({ status: 422, field: "to" });
    expect(await bad("from=2026-03-05")).toMatchObject({ status: 422, field: "to" });
    expect(await bad("preset=90d&bucket=hour")).toMatchObject({ status: 422, field: "bucket", message: expect.stringContaining("coarser") });
    expect(await bad("compare=later")).toMatchObject({ status: 422, field: "compare" });
    expect(await bad("company=nope")).toMatchObject({ status: 422, field: "company" });
    expect(await bad("channel=fax")).toMatchObject({ status: 422, field: "channel" });
    expect(await bad("service=helicopter")).toMatchObject({ status: 422, field: "service" });
    expect(await bad("page=3&sort=x")).toMatchObject({ status: 200 }); // unrelated parameters are ignored
  });
});

describe("GET /admin/analytics/options", () => {
  it("lists the fixed options and searches accounts by name (20 at most), or resolves ids", async () => {
    const { admin, alpha, bravo, driver } = await world();
    const fixed = (await get(admin, "/admin/analytics/options")).json;
    expect(fixed.cities.map((c: any) => c.key)).toEqual(expect.arrayContaining(["riyadh", "jeddah"]));
    expect(fixed.cities[0]).toMatchObject({ en: expect.any(String), ar: expect.any(String), ur: expect.any(String) });
    expect(fixed.services).toEqual(["delivery_driver", "car_with_driver", "car_without_driver"]);
    expect(fixed.channels).toEqual(["web", "api", "mobile"]); expect(fixed.statuses).not.toContain("draft"); expect(fixed.vehicles).toContain("sedan");
    const co = (await get(admin, "/admin/analytics/options?kind=company&q=Co%20Alpha")).json.items;
    expect(co.map((x: any) => x.id)).toEqual([alpha.id]);
    expect(co[0]).toMatchObject({ name: expect.stringContaining("Alpha") });
    expect((await get(admin, "/admin/analytics/options?kind=company")).json.items.length).toBe(2);
    expect((await get(admin, `/admin/analytics/options?kind=driver&ids=${driver.id},${bravo.id}`)).json.items.map((x: any) => x.id)).toEqual([driver.id]); // only drivers
    expect((await get(admin, "/admin/analytics/options?kind=office")).json.items).toEqual([]);
    expect((await get(admin, "/admin/analytics/options?kind=planet")).status).toBe(422);
    expect((await get(admin, "/admin/analytics/options?kind=driver&ids=nope")).status).toBe(422);
    for (let i = 0; i < 22; i++) await mkDriver({ name: "Many Driver " + i });
    expect((await get(admin, "/admin/analytics/options?kind=driver&q=Many")).json.items).toHaveLength(20);
  });
});

describe("drill-down tables", () => {
  it("pages, sorts and filters like the Overview", async () => {
    const { admin, alpha } = await world();
    const all = (await get(admin, "/admin/analytics/overview/table/requests")).json;
    expect(all.total).toBe(3); expect(all.rows).toHaveLength(3); expect(all.page).toBe(1); expect(all.pageSize).toBe(25);
    expect(all.columns.map((c: any) => c.key)).toEqual(expect.arrayContaining(["ref", "service", "status", "totalCents", "createdAt"]));
    expect(all.columns.find((c: any) => c.key === "ref")).toMatchObject({ sortable: true, type: "link", label: "rpf.col_ref" });
    expect(all.sort).toEqual({ key: "createdAt", dir: "desc" }); expect(all.meta.period.days).toBe(30);
    const p2 = (await get(admin, "/admin/analytics/overview/table/requests?pageSize=2&page=2")).json;
    expect(p2.rows).toHaveLength(1); expect(p2.total).toBe(3);
    const asc = (await get(admin, "/admin/analytics/overview/table/requests?sort=ref&dir=asc")).json.rows.map((r: any) => r.ref);
    expect(asc).toEqual([...asc].sort());
    expect((await get(admin, "/admin/analytics/overview/table/requests?sort=ref&dir=desc")).json.rows.map((r: any) => r.ref)).toEqual([...asc].reverse());
    const mine = (await get(admin, `/admin/analytics/overview/table/requests?company=${alpha.id}`)).json;
    expect(mine.total).toBe(1); expect(mine.rows[0]).toMatchObject({ company: expect.stringContaining("Alpha"), parcels: 10 });
    expect((await get(admin, "/admin/analytics/overview/table/requests?city=jeddah")).json.total).toBe(1);
    expect((await get(admin, "/admin/analytics/overview/table/requests?city=jeddah&compare=none&preset=today")).json.total).toBe(1);
  });
  it("validates sort, paging, format and the table name", async () => {
    const { admin } = await world();
    const status = async (qs: string, path = "/admin/analytics/overview/table/requests") => (await get(admin, `${path}?${qs}`)).status;
    expect(await status("sort=password")).toBe(422); expect(await status("dir=sideways")).toBe(422); expect(await status("page=0")).toBe(422);
    expect(await status("pageSize=101")).toBe(422); expect(await status("pageSize=abc")).toBe(422); expect(await status("format=xml")).toBe(422);
    expect(await status("", "/admin/analytics/overview/table/nope")).toBe(404); expect(await status("", "/admin/analytics/nothing/table/requests")).toBe(404);
  });
  it("hides money columns and the settlements table without finance.view", async () => {
    const { settlement } = await world();
    const plain = await mkStaff(["reports.view"]), fin = await mkStaff(["reports.view", "finance.view"]);
    const a = (await get(plain, "/admin/analytics/overview/table/requests")).json;
    expect(a.columns.map((c: any) => c.key)).not.toContain("totalCents"); expect(a.rows.every((r: any) => !("totalCents" in r))).toBe(true);
    expect((await get(fin, "/admin/analytics/overview/table/requests")).json.columns.map((c: any) => c.key)).toContain("totalCents");
    expect((await get(plain, "/admin/analytics/overview/table/settlements")).status).toBe(403);
    const s = (await get(fin, "/admin/analytics/overview/table/settlements")).json;
    expect(s.total).toBe(1); expect(s.rows[0]).toMatchObject({ customerCents: settlement.customerCents, marginCents: settlement.marginCents });
  });
});

describe("CSV export", () => {
  it("needs reports.export, covers the whole filtered set (not one page), is audited and starts with a BOM and the column keys", async () => {
    const { admin, alpha } = await world();
    const viewer = await mkStaff(["reports.view"]), exporter = await mkStaff(["reports.view", "reports.export"]);
    expect((await get(viewer, "/admin/analytics/overview/table/requests?format=csv")).status).toBe(403);
    const r = await get(exporter, "/admin/analytics/overview/table/requests?format=csv&pageSize=1");
    expect(r.status).toBe(200); expect(r.headers.get("content-type")).toContain("text/csv"); expect(r.headers.get("content-disposition")).toContain("overview-requests.csv");
    expect(r.text.startsWith("﻿")).toBe(true);
    const lines = r.text.slice(1).split("\n");
    expect(lines[0].split(",")).toEqual(expect.arrayContaining(["ref", "service", "status", "createdAt"])); expect(lines[0]).not.toContain("totalCents");
    expect(lines).toHaveLength(1 + 3);
    expect((await get(admin, `/admin/analytics/overview/table/requests?format=csv&company=${alpha.id}`)).text.split("\n")).toHaveLength(2);
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, "report.export")).orderBy(desc(auditLogs.createdAt));
    expect(log).toMatchObject({ entity: "report", entityId: "overview/requests", actorId: expect.any(String) }); expect((log.diff as any).rows).toBeGreaterThan(0);
    expect((await get(exporter, "/admin/analytics/overview/table/settlements?format=csv")).status).toBe(403); // reports.export alone does not unlock money
  });
  it("neutralises spreadsheet formulas in cell values", async () => {
    const { admin } = await world();
    defineTable({
      report: "test", name: "formula", title: "x", columns: [{ key: "id", label: "x" }, { key: "name", label: "x" }], sorts: { id: sql`1` }, defaultSort: { key: "id", dir: "asc" },
      query: async () => ({ rows: [{ id: 1, name: "=HYPERLINK(\"http://evil\")" }, { id: 2, name: "+1+1" }, { id: 3, name: "ok, \"quoted\"" }], total: 3 }),
    });
    const t = (await get(admin, "/admin/analytics/test/table/formula?format=csv")).text.slice(1).split("\n");
    expect(t[1]).toBe("1,\"'=HYPERLINK(\"\"http://evil\"\")\""); expect(t[2]).toBe("2,'+1+1"); expect(t[3]).toBe("3,\"ok, \"\"quoted\"\"\"");
  });
});
