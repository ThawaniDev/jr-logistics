/**
 * Reports › Support & quality (`GET /admin/analytics/support` and its drill-down tables) and the Data explorer (`/admin/analytics/explorer/…`).
 * One small world with exact timestamps: the numbers below are computed by hand from it (see `world()`), so a wrong SLA rule, anchor or filter shows up as a wrong number.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, complaints, offers, ratings, requests, tickets, users } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkStaff } from "../helpers/factories";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import { clearAnalyticsCache } from "@/server/analytics/guard";

beforeEach(async () => { await resetDb(); clearAnalyticsCache(); });
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const get = async (u: { id: string }, path: string) => call("GET", path, { token: await tok(u) });
const kpi = (json: any, key: string) => json.kpis.find((k: any) => k.key === key);
const H = 3600_000, D = 24 * H;
const ago = (ms: number) => new Date(Date.now() - ms);
let n = 0;
const insertRequest = async (biz: { id: string }, o: Partial<typeof requests.$inferInsert> = {}) => (await db.insert(requests).values({
  ref: `SP-${Date.now()}-${++n}`, businessId: biz.id, service: "delivery_driver", quantity: 1, pickupCity: "riyadh", deliveryCity: "riyadh", startsAt: new Date(), status: "published", ...o,
}).returning())[0];
const ticket = async (by: { id: string }, o: Partial<typeof tickets.$inferInsert>) => (await db.insert(tickets).values({ ref: `TK-${Date.now()}-${++n}`, openedBy: by.id, category: "other", subject: `Subject ${n}`, ...o }).returning())[0];

/**
 * Five tickets in the last 30 days (now = test time) and one before them; two complaints; two ratings on one completed job; three orders.
 *   T1 Alpha payment_issue, answered +1 h, resolved +10 h                      → both targets met
 *   T2 Alpha driver_no_show urgent, answered +6 h, resolved +60 h              → both missed
 *   T3 Bravo other, 3 days old, never answered, open, nobody assigned           → both missed (open breach)
 *   T4 driver app_problem, 1 hour old, unanswered, open, unassigned             → nothing due yet
 *   T5 Alpha payment_issue, answered +2 h, was resolved, reopened (open again)  → response met, resolution missed
 *   P1 Alpha, 35 days ago, resolved the next day                                 → the comparison period
 */
async function world() {
  const admin = await mkAdmin();
  const support = (await mkStaff(["tickets.view", "tickets.manage", "complaints.manage"])); // assignee
  const alpha = await mkBusiness({ name: "Alpha Owner" }), bravo = await mkBusiness({ name: "Bravo Owner" }), driver = await mkDriver();
  const r1 = await insertRequest(alpha, { status: "completed" }), r2 = await insertRequest(alpha), r3 = await insertRequest(bravo, { deliveryCity: "jeddah" });
  const [off] = await db.insert(offers).values({ requestId: r1.id, driverId: driver.id, status: "completed", expectedUnits: 10, expectedEarningCents: 7000, acceptedAt: ago(5 * D), finalUnits: 10, finalAt: ago(4 * D) }).returning();
  const t1 = await ticket(alpha, { category: "payment_issue", requestId: r1.id, createdAt: ago(5 * D), firstResponseAt: ago(5 * D - H), status: "resolved", resolvedAt: ago(5 * D - 10 * H), assignedTo: support.id });
  const t2 = await ticket(alpha, { category: "driver_no_show", priority: "urgent", createdAt: ago(3 * D), firstResponseAt: ago(3 * D - 6 * H), status: "resolved", resolvedAt: ago(3 * D - 60 * H), assignedTo: support.id });
  const t3 = await ticket(bravo, { category: "other", createdAt: ago(3 * D), status: "open" });
  const t4 = await ticket(driver, { category: "app_problem", createdAt: ago(H), status: "open" });
  const t5 = await ticket(alpha, { category: "payment_issue", createdAt: ago(6 * D), firstResponseAt: ago(6 * D - 2 * H), status: "open", reopenCount: 1, assignedTo: support.id });
  const p1 = await ticket(alpha, { createdAt: ago(35 * D), firstResponseAt: ago(35 * D - H), status: "resolved", resolvedAt: ago(34 * D) });
  const mk = (by: { id: string; role: string }, o: Partial<typeof complaints.$inferInsert>) => db.insert(complaints).values({ ref: `CP-${Date.now()}-${++n}`, filedBy: by.id, filedByRole: by.role, category: "delay", description: "It was late again today", ...o }).returning().then((r) => r[0]);
  const c1 = await mk(alpha, { createdAt: ago(4 * D), status: "resolved", resolvedAt: ago(3 * D), resolution: "Apologised", firstResponseAt: ago(4 * D - H), requestId: r1.id, offerId: off.id });
  const c2 = await mk(bravo, { createdAt: ago(2 * D), status: "open", holdsSettlement: true, category: "damage", priority: "urgent" });
  await db.insert(ratings).values([{ offerId: off.id, raterId: alpha.id, rateeId: driver.id, stars: 2, comment: "Late and rude" }, { offerId: off.id, raterId: driver.id, rateeId: alpha.id, stars: 5, comment: null }]);
  return { admin, support, alpha, bravo, driver, r1, r2, r3, off, t: { t1, t2, t3, t4, t5, p1 }, c1, c2 };
}

describe("permissions", () => {
  it("the report, its tables and the explorer need reports.view (and the explorer also reports.export)", async () => {
    const { alpha, driver } = await world();
    const paths = ["/admin/analytics/support", "/admin/analytics/support/table/tickets", "/admin/analytics/support/table/low-ratings"];
    for (const p of paths) {
      expect((await call("GET", p)).status, `anonymous ${p}`).toBe(401);
      expect((await get(alpha, p)).status, `business ${p}`).toBe(403);
      expect((await get(driver, p)).status, `driver ${p}`).toBe(403);
      expect((await get(await mkStaff(["tickets.view"]), p)).status, `no reports.view ${p}`).toBe(403);
      expect((await get(await mkStaff(["reports.view"]), p)).status, `reports.view ${p}`).toBe(200);
    }
    for (const p of ["/admin/analytics/explorer/datasets", "/admin/analytics/explorer/tickets"]) {
      expect((await get(await mkStaff(["reports.view"]), p)).status, `view only ${p}`).toBe(403);
      expect((await get(await mkStaff(["reports.export"]), p)).status, `export only ${p}`).toBe(403);
      expect((await get(alpha, p)).status, `business ${p}`).toBe(403);
      expect((await get(await mkStaff(["reports.view", "reports.export"]), p)).status, p).toBe(200);
    }
  });
});

describe("GET /admin/analytics/support", () => {
  it("computes the KPIs of the period from the tickets, complaints and ratings", async () => {
    const { admin } = await world();
    const r = await get(admin, "/admin/analytics/support?compare=prev");
    expect(r.status).toBe(200);
    const j = r.json;
    expect(j.meta).toMatchObject({ bucket: "day", compare: "prev", empty: false, moneyHidden: false });
    expect(j.targets).toEqual({ firstResponseSec: 14400, resolutionSec: 172800, atRiskShare: 0.75 });
    expect(j.kpis).toHaveLength(23);
    expect(kpi(j, "sup_tickets_opened")).toMatchObject({ value: 5, prev: 1, delta: 4, label: "rpq.kpi_sup_tickets_opened", definition: "rpq.def_sup_tickets_opened" });
    expect(kpi(j, "sup_tickets_resolved")).toMatchObject({ value: 2, prev: 1 });
    expect(kpi(j, "sup_backlog")).toMatchObject({ value: 3, prev: 0 });
    expect(kpi(j, "sup_unassigned")).toMatchObject({ value: 2, prev: null });
    expect(kpi(j, "sup_tickets_per_100").value).toBeCloseTo((5 / 3) * 100, 4);
    expect(kpi(j, "sup_urgent_share").value).toBeCloseTo(0.2, 6);
    expect(kpi(j, "sup_reopen_rate").value).toBeCloseTo(1 / 3, 6);
    expect(kpi(j, "sup_sla_response").value).toBeCloseTo(0.5, 6);
    expect(kpi(j, "sup_sla_resolution").value).toBeCloseTo(0.25, 6);
    expect(kpi(j, "sup_breaches").value).toBe(3);
    expect(kpi(j, "sup_first_response_p50").value).toBeCloseTo(2 * 3600, 0);
    expect(kpi(j, "sup_resolution_p50").value).toBeCloseTo(35 * 3600, 0);
    expect(kpi(j, "sup_complaints_filed")).toMatchObject({ value: 2, prev: 0 });
    expect(kpi(j, "sup_complaints_resolved").value).toBe(1);
    expect(kpi(j, "sup_complaints_open").value).toBe(1);
    expect(kpi(j, "sup_held_complaints").value).toBe(1);
    expect(kpi(j, "sup_held_amount").value).toBe(0);
    expect(kpi(j, "sup_rating_avg").value).toBeCloseTo(3.5, 6);
    expect(kpi(j, "sup_ratings_count").value).toBe(2);
    expect(kpi(j, "sup_rating_low_share").value).toBeCloseTo(0.5, 6);
    expect(kpi(j, "sup_rating_response").value).toBeCloseTo(1, 6); // one completed job, both possible ratings given
  });
  it("series are zero-filled and add up to the KPIs; breakdowns, aging, heatmap, workload and rankings agree", async () => {
    const { admin, support, alpha } = await world();
    const j = (await get(admin, "/admin/analytics/support")).json;
    expect(j.series.volume.points).toHaveLength(30); expect(j.series.volume.prev).toHaveLength(30);
    const cats: string[] = j.series.volume.categories;
    expect(j.series.volume.points.reduce((s: number, p: any) => s + cats.reduce((a, c) => a + p[c], 0), 0)).toBe(5);
    expect(j.series.volume.points.reduce((s: number, p: any) => s + p.resolved, 0)).toBe(2);
    expect(j.series.flow.points.reduce((s: number, p: any) => s + p.complaints, 0)).toBe(2);
    expect(j.breakdowns.priority.find((r: any) => r.key === "urgent").value).toBe(1);
    expect(j.breakdowns.role.map((r: any) => [r.key, r.value]).sort()).toEqual([["business", 4], ["driver", 1]]);
    expect(j.breakdowns.category.find((r: any) => r.key === "payment_issue")).toMatchObject({ value: 2, prev: 0 });
    expect(j.breakdowns.complaintCategory.map((r: any) => r.key).sort()).toEqual(["damage", "delay"]);
    expect(j.aging.openNow).toBe(3);
    expect(j.aging.buckets.map((b: any) => b.count)).toEqual([1, 1, 1, 0, 0]); // T4 is 1 hour old, T3 3 days, T5 6 days
    expect(j.aging.alerts[0].state).toBe("breached"); // the oldest open one (T5, 6 days, unresolved) is past its resolution target
    expect(j.aging.alerts.map((a: any) => a.state)).toContain("pending");
    expect(j.heatmap.total).toBe(5); expect(j.heatmap.cells).toHaveLength(7); expect(j.heatmap.cells[0]).toHaveLength(24);
    expect(j.resolution.n).toBe(2); expect(j.resolution.histogram.reduce((s: number, b: any) => s + b.count, 0)).toBe(2);
    expect(j.workload[0]).toMatchObject({ id: support.id, assigned: 3, open: 1, resolved: 2 });
    expect(j.repeat[0]).toMatchObject({ id: alpha.id, tickets: 3, urgent: 1 });
    expect(j.ratings.distribution).toEqual([0, 1, 0, 0, 1]);
    expect(j.ratings.drivers).toMatchObject({ n: 1, avg: 2 }); expect(j.ratings.companies).toMatchObject({ n: 1, avg: 5 });
    expect(j.ratings.lowest.drivers).toEqual([]); // below the 3-ratings guard: one rating never ranks anybody
    expect(j.perOrder.companies).toEqual([]); // below the 5-orders guard
    expect(j.series.quality).toHaveLength(30);
    expect(Array.isArray(j.insights)).toBe(true);
  });
  it("filters narrow every number, a ticket without a request drops out of request-level filters, and an empty selection says so", async () => {
    const { admin, alpha, bravo } = await world();
    const q = async (s: string) => (await get(admin, `/admin/analytics/support?${s}`)).json;
    expect(kpi(await q(`company=${alpha.id}`), "sup_tickets_opened").value).toBe(3);
    expect(kpi(await q(`company=${bravo.id}`), "sup_tickets_opened").value).toBe(1);
    expect(kpi(await q(`company=${alpha.id},${bravo.id}`), "sup_tickets_opened").value).toBe(4);
    expect(kpi(await q("city=riyadh"), "sup_tickets_opened").value).toBe(1); // only T1 is linked to a request
    expect(kpi(await q("city=jeddah"), "sup_tickets_opened").value).toBe(0);
    const none = await q("city=tabuk&compare=none");
    expect(kpi(none, "sup_sla_response").value).toBeNull(); expect(kpi(none, "sup_tickets_per_100").value).toBeNull(); expect(kpi(none, "sup_tickets_opened").value).toBe(0);
    expect(none.meta.compare).toBe("none"); expect(kpi(none, "sup_tickets_opened").prev).toBeNull();
    expect((await get(admin, "/admin/analytics/support?from=2026-01-01")).status).toBe(422);
    expect((await get(admin, "/admin/analytics/support?bucket=hour&preset=12m")).status).toBe(422);
  });
  it("the settlement amount on hold is omitted (not 0) without finance.view", async () => {
    await world();
    const j = (await get(await mkStaff(["reports.view"]), "/admin/analytics/support")).json;
    expect(j.meta.moneyHidden).toBe(true); expect(j.kpis.some((k: any) => k.key === "sup_held_amount")).toBe(false); expect(kpi(j, "sup_held_complaints").value).toBe(1);
    const k = (await get(await mkStaff(["reports.view", "finance.view"]), "/admin/analytics/support")).json;
    expect(kpi(k, "sup_held_amount")).toBeTruthy();
  });
  it("an empty database answers 200 with meta.empty and no invented numbers", async () => {
    const admin = await mkAdmin();
    const j = (await get(admin, "/admin/analytics/support")).json;
    expect(j.meta.empty).toBe(true); expect(kpi(j, "sup_tickets_opened").value).toBe(0); expect(kpi(j, "sup_first_response_p50").value).toBeNull(); expect(kpi(j, "sup_rating_avg").value).toBeNull();
  });
});

describe("support drill-down tables", () => {
  it("each registered view answers its own question", async () => {
    const { admin, t } = await world();
    const total = async (name: string, s = "") => (await get(admin, `/admin/analytics/support/table/${name}?${s}`)).json;
    expect((await total("tickets")).total).toBe(5);
    expect((await total("tickets-open")).total).toBe(3);
    expect((await total("tickets-breached")).total).toBe(3);
    expect((await total("tickets-urgent")).total).toBe(1);
    expect((await total("tickets-reopened")).total).toBe(1);
    expect((await total("tickets-at-risk")).total).toBe(0);
    expect((await total("complaints")).total).toBe(2); expect((await total("complaints-open")).total).toBe(1); expect((await total("complaints-holding")).total).toBe(1);
    expect((await total("low-ratings")).total).toBe(1); expect((await total("ratings")).total).toBe(2);
    const page = await total("tickets", "sort=ref&dir=asc&pageSize=2");
    expect(page.rows).toHaveLength(2); expect(page.columns.map((c: any) => c.key)).toEqual(expect.arrayContaining(["ref", "sla", "firstResponseSecs", "ageSecs"]));
    const urgent = (await total("tickets-urgent")).rows[0];
    expect(urgent).toMatchObject({ id: t.t2.id, priority: "urgent", sla: "breached", reopenCount: 0 }); expect(urgent.firstResponseSecs).toBeCloseTo(6 * 3600, 0); expect(urgent.resolutionSecs).toBeCloseTo(60 * 3600, 0);
    expect((await total("low-ratings")).rows[0]).toMatchObject({ stars: 2, comment: "Late and rude" });
    expect((await get(admin, "/admin/analytics/support/table/tickets?sort=nope")).status).toBe(422);
    expect((await get(admin, "/admin/analytics/support/table/nope")).status).toBe(404);
  });
  it("CSV needs reports.export and is audited; a viewer-only staff member gets 403", async () => {
    const { admin } = await world();
    expect((await get(await mkStaff(["reports.view"]), "/admin/analytics/support/table/tickets?format=csv")).status).toBe(403);
    const r = await get(admin, "/admin/analytics/support/table/tickets?format=csv&headers=keys");
    expect(r.status).toBe(200); expect(r.text.split("\n")[0]).toContain("ref,category,priority,status,sla");
    expect(r.text.trim().split("\n")).toHaveLength(6);
    const [a] = await db.select().from(auditLogs).where(eq(auditLogs.action, "report.export")).orderBy(desc(auditLogs.createdAt));
    expect(a.entityId).toBe("support/tickets");
  });
});

describe("Data explorer", () => {
  it("lists only the datasets the viewer may use, without money columns unless finance.view, with personal data flagged as masked", async () => {
    await world();
    const plain = (await get(await mkStaff(["reports.view", "reports.export"]), "/admin/analytics/explorer/datasets")).json;
    const keys = plain.datasets.map((d: any) => d.key);
    expect(keys).toEqual(expect.arrayContaining(["requests", "parcels", "jobs", "tickets", "complaints", "ratings", "companies", "offices", "drivers", "custody", "documents", "availability", "cancellations", "start-sla"]));
    for (const k of ["settlements", "ledger", "withdrawals", "invoices", "cod", "audit", "logins", "messages", "parcel-events"]) expect(keys, k).not.toContain(k);
    expect(plain.datasets.find((d: any) => d.key === "requests").columns.some((c: any) => c.key === "totalCents")).toBe(false);
    expect(plain.datasets.find((d: any) => d.key === "drivers").columns.find((c: any) => c.key === "phone").masked).toBe(true);
    const all = (await get(await mkAdmin(), "/admin/analytics/explorer/datasets")).json;
    expect(all.datasets).toHaveLength(23);
    expect(all.datasets.find((d: any) => d.key === "requests").columns.some((c: any) => c.key === "totalCents")).toBe(true);
    expect(all.datasets.find((d: any) => d.key === "drivers").columns.find((c: any) => c.key === "phone").masked).toBe(false);
    expect(all.limits).toMatchObject({ pageSize: 100, maxOffset: 10000, exportCap: 100000 });
    const fin = await get(await mkStaff(["reports.view", "reports.export"]), "/admin/analytics/explorer/settlements");
    expect(fin.status).toBe(403);
    expect((await get(await mkAdmin(), "/admin/analytics/explorer/nope")).status).toBe(404);
  });
  it("pages, sorts, filters and searches a dataset; counts honestly; masks personal data", async () => {
    const { admin, alpha, driver } = await world();
    const r = await get(admin, "/admin/analytics/explorer/tickets?cols=ref,status,priority,category&sort=ref&dir=asc&pageSize=2");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ total: 5, totalCapped: false, page: 1, pageSize: 2, sort: { key: "ref", dir: "asc" } });
    expect(r.json.rows).toHaveLength(2); expect(r.json.columns.map((c: any) => c.key)).toEqual(["ref", "status", "priority", "category"]);
    const q = async (s: string) => (await get(admin, `/admin/analytics/explorer/tickets?cols=ref&${s}`)).json.total;
    expect(await q("f.status=open")).toBe(3); expect(await q("f.priority=urgent")).toBe(1); expect(await q("f.unassigned=yes")).toBe(2); expect(await q("f.unassigned=no")).toBe(3);
    expect(await q("f.breached=yes")).toBe(3); expect(await q("f.reopenCount=1..")).toBe(1); expect(await q(`company=${alpha.id}`)).toBe(3); expect(await q("q=Subject")).toBe(5); expect(await q("q=no-such-text")).toBe(0);
    expect(await q("all=1&from=2026-01-01&to=2026-01-02")).toBe(6); // "all time" ignores the period (and includes the old ticket)
    expect((await get(admin, "/admin/analytics/explorer/tickets?cols=nope")).status).toBe(422);
    expect((await get(admin, "/admin/analytics/explorer/tickets?f.nope=1")).status).toBe(422);
    expect((await get(admin, "/admin/analytics/explorer/tickets?page=1000&pageSize=100")).status).toBe(422); // beyond the paging cap
    const staff = await mkStaff(["reports.view", "reports.export"]);
    const d = (await get(staff, "/admin/analytics/explorer/drivers?cols=name,phone,nationalId&all=1")).json;
    expect(d.rows[0].phone).toMatch(/^•••\d{4}$/); expect(d.meta.maskedColumns).toEqual(["phone", "nationalId"]);
    expect((await get(staff, "/admin/analytics/explorer/drivers?sort=phone")).status).toBe(422);
    const own = (await get(await mkStaff(["reports.view", "reports.export", "drivers.sensitive"]), `/admin/analytics/explorer/drivers?cols=name,phone&all=1`)).json;
    expect(own.rows.find((x: any) => x.id === driver.id).phone).toBe((await db.select().from(users).where(eq(users.id, driver.id)))[0].phone);
    expect((await get(staff, "/admin/analytics/explorer/requests?cols=ref,totalCents")).status).toBe(422); // money columns do not exist for them
  });
  it("tells the user which shared filters the dataset does not honour", async () => {
    await world();
    const j = (await get(await mkAdmin(), "/admin/analytics/explorer/availability?city=riyadh&channel=web")).json;
    expect(j.meta.ignored).toEqual(["channel"]);
  });
  it("groups with aggregations", async () => {
    const { admin } = await world();
    const j = (await get(admin, "/admin/analytics/explorer/tickets?group=status&agg=sum:reopenCount,max:reopenCount")).json;
    expect(j.group).toMatchObject({ key: "status" }); expect(j.aggs).toHaveLength(2);
    expect(Object.fromEntries(j.rows.map((r: any) => [r.g, r.n]))).toEqual({ open: 3, resolved: 2 });
    expect(j.rows.find((r: any) => r.g === "open")).toMatchObject({ a0: 1, a1: 1 });
    expect((await get(admin, "/admin/analytics/explorer/tickets?group=createdAt~week")).json.rows.length).toBeGreaterThan(0);
    expect((await get(admin, "/admin/analytics/explorer/tickets?group=subject")).status).toBe(422);
  });
  it("streams a CSV with a BOM and the chosen columns, neutralises formulas, audits it, and rate-limits exports", async () => {
    const { admin, alpha } = await world();
    await db.update(tickets).set({ subject: "=HYPERLINK(\"http://evil\")" }).where(eq(tickets.openedBy, alpha.id));
    expect((await get(await mkStaff(["reports.view"]), "/admin/analytics/explorer/tickets?format=csv")).status).toBe(403);
    const r = await get(admin, "/admin/analytics/explorer/tickets?cols=ref,subject,status&format=csv&sort=ref&dir=asc");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv"); expect(r.headers.get("x-export-rows")).toBe("5"); expect(r.headers.get("x-export-truncated")).toBe("0");
    expect(r.text.startsWith("\uFEFFref,subject,status\n")).toBe(true);
    const lines = r.text.trim().split("\n"); expect(lines).toHaveLength(6);
    expect(r.text).toContain("\"'=HYPERLINK(\"\"http://evil\"\")\""); expect(r.text).not.toMatch(/,=HYPERLINK/);
    const [a] = await db.select().from(auditLogs).where(eq(auditLogs.action, "report.export")).orderBy(desc(auditLogs.createdAt));
    expect(a).toMatchObject({ entity: "report", entityId: "explorer/tickets" });
    expect(a.diff).toMatchObject({ dataset: "tickets", rows: 5, columns: ["ref", "subject", "status"], truncated: false });
    const g = await get(admin, "/admin/analytics/explorer/tickets?group=status&format=csv");
    expect(g.text.split("\n")[0]).toContain("group,count"); expect(g.status).toBe(200);
    let last = 200; for (let i = 0; i < 8 && last === 200; i++) last = (await get(admin, "/admin/analytics/explorer/tickets?cols=ref&format=csv")).status;
    expect(last).toBe(429);
  });
});
