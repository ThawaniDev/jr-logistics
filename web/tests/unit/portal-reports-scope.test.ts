/**
 * SECURITY of the portal reports (decision G12), proven without a database: every report and every drill-down table is run against a recording fake of the database and
 * EVERY statement it executes must be bound to the signed-in owner. Client-supplied company / office / driver filters never reach the SQL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const dialect = new PgDialect();
const executed: Array<{ sql: string; params: unknown[] }> = [];
let answer: (q: { sql: string; params: unknown[] }) => Array<Record<string, unknown>> = () => [];
const tx = { execute: vi.fn(async (q: Parameters<PgDialect["sqlToQuery"]>[0]) => { const r = dialect.sqlToQuery(q); if (!/set_config/.test(r.sql)) executed.push(r); return { rows: answer(r) }; }) };
vi.mock("@/db", () => ({ db: { transaction: async (cb: (t: typeof tx) => unknown) => cb(tx) } }));
vi.mock("@/server/settings", () => ({ getSettings: async () => ({ lateGraceMin: 15, cities: [{ key: "riyadh", ar: "الرياض", en: "Riyadh", ur: "ریاض" }] }) }));
vi.mock("@/server/office", () => ({ officeReport: async () => ({ jobs: { total: 0, completed: 0, inProgress: 0, cancelled: 0, noShow: 0, replaced: 0 }, shipmentsDelivered: 0, completionRate: null, money: { paidCents: 0, approvedCents: 0, pendingCents: 0, failedCents: 0, rejectedCents: 0 }, byStatus: [] }) }));
const audit = vi.fn(async () => {});
vi.mock("@/server/audit", () => ({ audit: (...a: unknown[]) => (audit as (...x: unknown[]) => Promise<void>)(...a) }));

const { clearAnalyticsCache } = await import("@/server/analytics/guard");
const { portalCtx, NIL_ID } = await import("@/server/analytics/portal-scope");
const { businessOverviewReport } = await import("@/server/analytics/portal-company");
const { businessDeliveriesReport, businessSpendingReport } = await import("@/server/analytics/portal-company-reports");
const { officeOverviewReport } = await import("@/server/analytics/portal-office");
const { officeDriversReport, officeEarningsReport } = await import("@/server/analytics/portal-office-reports");
const { runPortalTable, listPortalTables } = await import("@/server/analytics/portal-registry");
const { portalOptions } = await import("@/server/analytics/portal-options");

const ME_BIZ = "11111111-1111-4111-8111-111111111111", ME_OFF = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333", OTHER_DRIVER = "44444444-4444-4444-8444-444444444444", OWN_DRIVER = "55555555-5555-4555-8555-555555555555";
const biz = { id: ME_BIZ, role: "business", permissions: [] } as never, off = { id: ME_OFF, role: "office", permissions: [] } as never;
const qs = (o: Record<string, string>) => new URLSearchParams(o);
const strings = (r: { sql: string; params: unknown[] }) => r.params.map(String);

beforeEach(() => { clearAnalyticsCache(); executed.length = 0; answer = () => []; audit.mockClear(); });

describe("the owner comes from the session, never from the request", () => {
  it("a company's company / office / driver filters are replaced and reported as ignored", async () => {
    const c = await portalCtx(biz, qs({ company: OTHER, office: OTHER, driver: OTHER_DRIVER, city: "riyadh" }), "business");
    expect(c.f.company).toEqual([ME_BIZ]);
    expect(c.f.office).toEqual([]); expect(c.f.driver).toEqual([]);
    expect(c.ignored.sort()).toEqual(["company", "driver", "office"]);
    expect(c.f.active).toEqual(["city"]); // the forced owner is not a user filter
    expect(c.f.canonical).toContain(ME_BIZ); // the cache key carries the owner
  });
  it("a company cannot use the office-only filters, an office cannot use the company-only ones", async () => {
    const c = await portalCtx(biz, qs({ channel: "api", status: "completed" }), "business");
    expect(c.f.channel).toEqual(["api"]);
    const o = await portalCtx(off, qs({ channel: "api", status: "completed", company: OTHER, office: OTHER }), "office");
    expect(o.f.channel).toEqual([]); expect(o.f.status).toEqual([]); expect(o.f.company).toEqual([]);
    expect(o.f.office).toEqual([ME_OFF]);
    expect(o.ignored.sort()).toEqual(["channel", "company", "status"].sort().concat("office").sort());
  });
  it("an office keeps only drivers that belong to it; somebody else's driver matches nothing", async () => {
    answer = (q) => (/driver_profiles/.test(q.sql) && /union/.test(q.sql) ? [{ id: OWN_DRIVER }] : []);
    const mixed = await portalCtx(off, qs({ driver: `${OWN_DRIVER},${OTHER_DRIVER}` }), "office");
    expect(mixed.f.driver).toEqual([OWN_DRIVER]); expect(mixed.ignored).toContain("driver");
    answer = () => [];
    const foreign = await portalCtx(off, qs({ driver: OTHER_DRIVER }), "office");
    expect(foreign.f.driver).toEqual([NIL_ID]);
  });
  it("a role mismatch is refused and invalid filters are a validation error", async () => {
    await expect(portalCtx(off, qs({}), "business")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(portalCtx(biz, qs({ company: "not-an-id" }), "business")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(portalCtx(biz, qs({ preset: "bogus" }), "business")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("every statement of every report is bound to the owner", () => {
  const evil = { company: OTHER, office: OTHER, driver: OTHER_DRIVER };
  const reports: Array<[string, () => Promise<unknown>, string]> = [
    ["business overview", () => businessOverviewReport(biz, qs(evil)), ME_BIZ], ["business deliveries", () => businessDeliveriesReport(biz, qs(evil)), ME_BIZ], ["business spending", () => businessSpendingReport(biz, qs(evil)), ME_BIZ],
    ["office overview", () => officeOverviewReport(off, qs({ company: OTHER, office: OTHER })), ME_OFF], ["office drivers", () => officeDriversReport(off, qs({ company: OTHER, office: OTHER })), ME_OFF], ["office earnings", () => officeEarningsReport(off, qs({ company: OTHER, office: OTHER })), ME_OFF],
  ];
  for (const [name, run, me] of reports) {
    it(name, async () => {
      const res = (await run()) as { meta: { values: Record<string, string[]>; ignored: string[]; failed: string[] } };
      expect(executed.length).toBeGreaterThan(5);
      for (const q of executed) {
        expect(strings(q), q.sql.slice(0, 120)).toContain(me);
        expect(strings(q), q.sql.slice(0, 120)).not.toContain(OTHER);
        expect(strings(q)).not.toContain(OTHER_DRIVER);
      }
      expect(res.meta.values.company).toEqual([]); expect(res.meta.values.office).toEqual([]);
      expect(res.meta.failed).toEqual([]);
    });
  }
  it("an office's driver filter is narrowed to its own drivers before it reaches a report", async () => {
    answer = (q) => (/driver_profiles/.test(q.sql) && /union/.test(q.sql) ? [{ id: OWN_DRIVER }] : []);
    await officeDriversReport(off, qs({ driver: `${OWN_DRIVER},${OTHER_DRIVER}` }));
    const scoped = executed.filter((q) => !/union select distinct offers.driver_id/.test(q.sql));
    expect(scoped.length).toBeGreaterThan(5);
    for (const q of scoped) { expect(strings(q)).not.toContain(OTHER_DRIVER); expect(strings(q)).toContain(ME_OFF); }
    expect(scoped.some((q) => strings(q).includes(OWN_DRIVER))).toBe(true);
  });
  it("two owners with the same filters never share a cached report", async () => {
    const other = { id: OTHER, role: "business", permissions: [] } as never;
    await businessOverviewReport(biz, qs({}));
    const n = executed.length; executed.length = 0;
    await businessOverviewReport(other, qs({}));
    expect(executed.length).toBe(n);
    for (const q of executed) { expect(strings(q)).toContain(OTHER); expect(strings(q)).not.toContain(ME_BIZ); }
    executed.length = 0;
    await businessOverviewReport(other, qs({}));
    expect(executed.length).toBe(0); // the same owner IS served from the cache
  });
});

describe("sections degrade one at a time", () => {
  it("a failing section is null and listed, the rest still answers, and the partial report is not cached", async () => {
    answer = (q) => { if (/from message_log/.test(q.sql)) throw new Error("boom"); return []; };
    const r = (await businessDeliveriesReport(biz, qs({}))) as { meta: { failed: string[] }; sms: unknown; kpis: Array<{ key: string }> };
    expect(r.meta.failed.sort()).toEqual(["sms", "sms_status"]);
    expect(r.sms).toBeNull();
    expect(r.kpis.map((k) => k.key)).toContain("delivery_success");
    expect(r.kpis.map((k) => k.key)).not.toContain("biz_sms_failure_rate");
    executed.length = 0; answer = () => [];
    const again = (await businessDeliveriesReport(biz, qs({}))) as { meta: { failed: string[] } };
    expect(executed.length).toBeGreaterThan(5); expect(again.meta.failed).toEqual([]);
  });
  it("when every section fails the error is raised so the page can offer a retry", async () => {
    answer = () => { throw Object.assign(new Error("down"), { code: "57P01" }); };
    await expect(businessOverviewReport(biz, qs({}))).rejects.toThrow();
  });
});

describe("drill-down tables", () => {
  it("every registered table is bound to the owner, sorts only by its whitelist and pages", async () => {
    const tables = listPortalTables();
    expect(tables.filter((t) => t.portal === "business").map((t) => t.name).sort()).toEqual(["cod", "invoices", "ledger", "parcels", "requests", "returns"]);
    expect(tables.filter((t) => t.portal === "office").map((t) => t.name).sort()).toEqual(["daily", "drivers", "earnings", "failures", "jobs", "ledger", "money", "money_daily", "payouts", "perf", "settlements"]); // + the fleet tables (memory/FLEET_REPORTS.md I8)
    for (const t of tables) {
      executed.length = 0;
      const user = t.portal === "business" ? biz : off, me = t.portal === "business" ? ME_BIZ : ME_OFF;
      const res = (await runPortalTable(user, t.portal, t.name, qs({ company: OTHER, office: OTHER, page: "1", pageSize: "10" }))) as { columns: Array<{ key: string; sortable: boolean }>; rows: unknown[] };
      expect(executed.length, `${t.portal}/${t.name}`).toBeGreaterThan(0);
      for (const q of executed) { expect(strings(q), `${t.portal}/${t.name}`).toContain(me); expect(strings(q)).not.toContain(OTHER); }
      expect(res.columns.length).toBeGreaterThan(3);
      await expect(runPortalTable(user, t.portal, t.name, qs({ sort: "password_hash" }))).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(runPortalTable(user, t.portal, t.name, qs({ sort: "__proto__" }))).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(runPortalTable(user, t.portal, t.name, qs({ dir: "sideways" }))).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(runPortalTable(user, t.portal, t.name, qs({ pageSize: "5000" }))).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });
  it("an unknown table is a 404, another portal's table does not exist for you", async () => {
    await expect(runPortalTable(biz, "business", "jobs", qs({}))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(runPortalTable(off, "office", "parcels", qs({}))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(runPortalTable(off, "business", "parcels", qs({}))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("CSV is allowed for the owner, audited, neutralises formulas and carries a BOM", async () => {
    answer = (q) => (/count\(\*\)::int as n/.test(q.sql) && !/select n/.test(q.sql) ? [{ n: 1 }] : [{ id: "x", ref: "=cmd|' /C calc'!A0", code: "JR-1", status: "delivered" }]);
    const res = (await runPortalTable(biz, "business", "parcels", qs({ format: "csv" }))) as Response;
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("business-parcels.csv");
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM so Excel reads Arabic
    expect(await res.text()).toContain("'=cmd");
    expect(audit).toHaveBeenCalledWith(biz, "report.export", "report", "business/parcels", expect.objectContaining({ rows: expect.any(Number) }));
  });
});

describe("options", () => {
  it("a company gets request statuses and channels, an office gets its own drivers", async () => {
    const b = (await portalOptions(biz, "business")) as { statuses: string[]; channels: string[]; drivers?: unknown };
    expect(b.statuses).toContain("completed"); expect(b.statuses).not.toContain("draft"); expect(b.channels).toContain("api"); expect(b.drivers).toBeUndefined();
    answer = () => [{ id: OWN_DRIVER, name: "Omar", sub: "riyadh" }];
    const o = (await portalOptions(off, "office")) as { statuses: string[]; drivers: Array<{ id: string }> };
    expect(o.statuses).toEqual([]); expect(o.drivers).toEqual([{ id: OWN_DRIVER, name: "Omar", sub: "riyadh" }]);
    expect(strings(executed.at(-1)!)).toContain(ME_OFF);
    await expect(portalOptions(biz, "office")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
