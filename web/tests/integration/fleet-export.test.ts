/**
 * Excel export of reports (decision I6): `format=xlsx` on the generic drill route and on the portal route, `GET /admin/analytics/:report/notes`, the entity workbook
 * `GET /admin/analytics/workbook/:kind/:id` and the office portal workbook. Covers permissions, the audit trail, localized headers per `lang`, real number formats, money removed
 * without `finance.view`, the Notes sheet, 404s, that tables which do not exist are skipped, the "Daily by driver" cap — and that CSV did not change.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, officeProfiles, offers, users } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkOffice, mkRule, mkStaff, publishedRequest } from "../helpers/factories";
import { work } from "../helpers/work";
import { call } from "../helpers/api";
import { readXlsx, sheetOf, type ReadSheet } from "../helpers/xlsx-read";
import { createSession } from "@/server/auth/session";
import { dispatch } from "@/server/api/router";
import * as jobs from "@/server/jobs";
import { clearAnalyticsCache } from "@/server/analytics/guard";
import { defineTable, getTable, MAX_CSV_ROWS, pageAll, CSV_PAGE, type DrillColumn } from "@/server/analytics/registry";
import { FLEET } from "@/server/analytics/fleet-lib";
import { translate } from "@/i18n/core";
import { dictionaries } from "@/i18n/dictionaries";
import { translator } from "@/server/export/context";
import { assembleWorkbook, type TableHandle } from "@/server/export/workbook-core";
import { XLSX_MIME } from "@/server/export/xlsx";

beforeEach(async () => { await resetDb(); clearAnalyticsCache(); });
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const get = async (u: { id: string }, path: string) => call("GET", path, { token: await tok(u) });
/** The raw bytes of a response (`call()` decodes as UTF-8, which would corrupt a zip). */
async function bin(u: { id: string }, path: string) {
  const res = await dispatch(new Request(`http://localhost/api/v1${path}`, { headers: { host: "localhost", authorization: `Bearer ${await tok(u)}` } }));
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buf, json: res.status === 200 ? null : JSON.parse(buf.toString("utf8")) };
}
const sheetsOf = async (u: { id: string }, path: string) => { const r = await bin(u, path); expect(r.status, path).toBe(200); return readXlsx(r.buf); };
const t = (lang: "ar" | "en" | "ur", key: string, vars?: Record<string, string | number>) => translate(dictionaries[lang], dictionaries.en, key, vars);
const offerOf = async (requestId: string, driverId: string) => (await db.select().from(offers).where(and(eq(offers.requestId, requestId), eq(offers.driverId, driverId))))[0];
const lastExport = async () => (await db.select().from(auditLogs).where(eq(auditLogs.action, "report.export")).orderBy(desc(auditLogs.createdAt)).limit(1))[0];
const exportStaff = (extra: string[] = ["finance.view"]) => mkStaff(["reports.view", "reports.export", ...extra]);
const col = (s: ReadSheet, header: string) => s.rows[0].indexOf(header);

/** Office X (an Arabic name) with driver O who delivered all 10 parcels of Alpha's request; office Y with a driver and no work. */
async function world() {
  const admin = await mkAdmin(); await mkRule(admin);
  const alpha = await mkBusiness({ fundsCents: 5000_00, name: "Alpha Owner" });
  const office = await mkOffice(); await db.update(officeProfiles).set({ officeName: "مكتب النور" }).where(eq(officeProfiles.userId, office.id));
  const driverO = await mkDriver({ officeId: office.id, name: "Driver Office" });
  const r1 = await publishedRequest(alpha); const o1 = await offerOf(r1.id, driverO.id);
  await jobs.acceptOffer(driverO, o1.id, true); await jobs.confirmAttendance(alpha, o1.id, true); await work(alpha, driverO, o1.id, 10);
  const office2 = await mkOffice(); const driver2 = await mkDriver({ officeId: office2.id, name: "Other Driver" });
  return { admin, alpha, office, office2, driverO, driver2, r1, o1 };
}

describe("format=xlsx on a registered table", () => {
  it("needs reports.view and reports.export, refuses a bad lang or format, and is audited as report.export with format xlsx", async () => {
    const { admin, alpha, office } = await world();
    const p = "/admin/analytics/offices/table/scorecards?format=xlsx";
    expect((await call("GET", p)).status).toBe(401);
    expect((await get(alpha, p)).status).toBe(403);
    expect((await get(office, p)).status).toBe(403);
    expect((await get(await mkStaff(["finance.view"]), p)).status).toBe(403); // no reports.view
    expect((await get(await mkStaff(["reports.view"]), p)).status).toBe(403); // no reports.export
    const bad = await get(admin, `${p}&lang=de`); expect(bad.status).toBe(422); expect(bad.json.error.details.field).toBe("lang");
    const fmt = await get(admin, "/admin/analytics/offices/table/scorecards?format=pdf"); expect(fmt.status).toBe(422); expect(fmt.json.error.details.field).toBe("format");
    expect((await get(admin, "/admin/analytics/offices/table/nope?format=xlsx")).status).toBe(404);
    const staff = await exportStaff();
    const ok = await bin(staff, p);
    expect(ok.status).toBe(200); expect(ok.headers.get("content-type")).toBe(XLSX_MIME); expect(ok.headers.get("content-disposition")).toMatch(/^attachment; filename="offices-scorecards-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx"$/); expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.buf.subarray(0, 2).toString()).toBe("PK");
    const a = await lastExport();
    expect(a).toMatchObject({ action: "report.export", entity: "report", entityId: "offices/scorecards", actorId: staff.id });
    expect(a.diff).toMatchObject({ format: "xlsx", truncated: false });
    expect((a.diff as { rows: number }).rows).toBeGreaterThan(0);
  });

  it("headers follow lang (ar | en | ur) and default to the viewer's language; ar and ur sheets run right to left", async () => {
    const { admin } = await world();
    const p = "/admin/analytics/offices/table/scorecards?format=xlsx";
    for (const lang of ["ar", "en", "ur"] as const) {
      const [data, notes] = await sheetsOf(admin, `${p}&lang=${lang}`);
      expect(data.rows[0][0], lang).toBe(t(lang, "rpp.col_office")); expect(data.rows[0]).toContain(t(lang, "rpp.col_jobs"));
      expect(data.name).toBe(t(lang, "rpp.tbl_off_cards").slice(0, 31)); expect(notes.name).toBe(t(lang, "fr.sheet_notes"));
      expect(data.rtl, lang).toBe(lang !== "en"); expect(notes.rtl).toBe(lang !== "en");
    }
    expect(t("ar", "rpp.col_office")).not.toBe(t("en", "rpp.col_office"));
    const dflt = (await sheetsOf(admin, p))[0]; expect(dflt.rows[0][0]).toBe(t("ar", "rpp.col_office")); // users.language defaults to ar
    await db.update(users).set({ language: "ur" }).where(eq(users.id, admin.id));
    expect((await sheetsOf(admin, p))[0].rows[0][0]).toBe(t("ur", "rpp.col_office"));
    expect((await sheetsOf(admin, `${p}&lang=en`))[0].rows[0][0]).toBe(t("en", "rpp.col_office"));
  });

  it("every cell equals the JSON table: halalas become SAR, percentages stay fractions, enums are translated, Arabic names survive", async () => {
    const { admin, office } = await world();
    const json = (await get(admin, "/admin/analytics/offices/table/scorecards?pageSize=100")).json;
    const [data] = await sheetsOf(admin, "/admin/analytics/offices/table/scorecards?format=xlsx&lang=en");
    expect(data.rows).toHaveLength(json.total + 1); expect(data.frozen).toBe(true); expect(data.autoFilter).toMatch(/^A1:[A-Z]+\d+$/);
    const mine = json.rows.find((r: any) => r.id === office.id); const idx = json.rows.indexOf(mine);
    const row = data.rows[idx + 1];
    expect(row[0]).toBe("مكتب النور"); expect(mine.earnedCents).toBeGreaterThan(0);
    const earned = col(data, t("en", "rpp.col_earned") + " (SAR)"); expect(earned).toBeGreaterThan(0);
    expect(row[earned]).toBeCloseTo(mine.earnedCents / 100, 2); expect(data.cells.get(`${String.fromCharCode(65 + earned)}${idx + 2}`)!.fmt).toBe("#,##0.00");
    const succ = col(data, t("en", "rpp.col_success")); expect(row[succ]).toBeCloseTo(mine.success, 6); expect(data.cells.get(`${String.fromCharCode(65 + succ)}${idx + 2}`)!.fmt).toBe("0.0%");
    const delivered = col(data, t("en", "rpp.col_delivered")); expect(row[delivered]).toBe(10); expect(data.cells.get(`${String.fromCharCode(65 + delivered)}${idx + 2}`)!.fmt).toBe("#,##0");
    const agr = col(data, t("en", "rpp.col_agreement")); expect(row[agr]).toBe(t("en", `rpp.agr.${mine.agreement}`)); expect(row[agr]).not.toBe(mine.agreement);
    const city = col(data, t("en", "rpp.col_city")); expect(row[city]).toBe(t("en", `city.${mine.city}`));
  });

  it("removes money columns the viewer cannot see (as for CSV) and says so in the Notes", async () => {
    await world();
    const p = "/admin/analytics/offices/table/scorecards?format=xlsx&lang=en";
    const rich = await sheetsOf(await exportStaff(["finance.view"]), p), poor = await sheetsOf(await exportStaff([]), p);
    const money = ["rpp.col_earned", "rpp.col_paid", "rpp.col_pending"].map((k) => t("en", k) + " (SAR)");
    for (const h of money) { expect(rich[0].rows[0], h).toContain(h); expect(poor[0].rows[0], h).not.toContain(h); }
    expect(poor[0].rows[0]).toContain(t("en", "rpp.col_jobs")); expect(poor[0].rows[0].length).toBe(rich[0].rows[0].length - 3);
    expect(JSON.stringify(poor[1].rows)).toContain(t("en", "fr.xl_note_hidden_money")); expect(JSON.stringify(rich[1].rows)).not.toContain(t("en", "fr.xl_note_hidden_money"));
    const csv = await get(await exportStaff([]), "/admin/analytics/offices/table/scorecards?format=csv");
    expect(csv.text).not.toContain("earnedCents"); // the CSV removes the same keys
  });

  it("the Notes sheet names the report and table, the period and filters in words, when it was generated, how many rows, and how to read it", async () => {
    const { admin, office } = await world();
    const [data, notes] = await sheetsOf(admin, `/admin/analytics/offices/table/scorecards?format=xlsx&lang=en&from=2026-10-01&to=2026-10-31&compare=none&city=riyadh&office=${office.id}`);
    const text = notes.rows.map((r) => r.filter((x) => x != null).join(" | ")).join("\n");
    expect(notes.rows[0][0]).toBe(t("en", "fr.xl_title", { name: t("en", "rpp.tbl_off_cards") }));
    expect(text).toContain(`Report | ${t("en", "fr.xl_report_offices")}`); expect(text).toContain(`Table | ${t("en", "rpp.tbl_off_cards")}`);
    expect(text).toContain("2026-10-01 to 2026-10-31 (31 days)"); expect(text).not.toContain(t("en", "fr.xl_prev_period"));
    expect(text).toContain(`${t("en", "rpf.f_city")}: Riyadh`); expect(text).toContain(`${t("en", "rpf.f_office")}: مكتب النور`);
    expect(text).toMatch(/Generated at \(Riyadh time\) \| \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(text).toContain(`${t("en", "fr.xl_rows")} | ${data.rows.length - 1}`);
    expect(text).toContain(t("en", "fr.xl_howto")); expect(text).toContain(t("en", "fr.xl_note_tz")); expect(text).toContain(t("en", "fr.xl_note_money")); expect(text).toContain(t("en", "fr.xl_note_percent"));
    const withCompare = (await sheetsOf(admin, "/admin/analytics/offices/table/scorecards?format=xlsx&lang=en&preset=7d&compare=prev"))[1];
    expect(JSON.stringify(withCompare.rows)).toContain(t("en", "fr.xl_prev_period"));
    const noFilter = (await sheetsOf(admin, "/admin/analytics/offices/table/scorecards?format=xlsx&lang=ar"))[1];
    expect(JSON.stringify(noFilter.rows)).toContain(t("ar", "fr.xl_no_filters"));
  });

  it("the CSV did not change: raw keys, UTF-8 BOM, no format key in the audit diff, same permission", async () => {
    const { admin } = await world();
    const csv = await get(admin, "/admin/analytics/offices/table/scorecards?format=csv");
    expect(csv.status).toBe(200); expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8"); expect(csv.headers.get("content-disposition")).toBe('attachment; filename="offices-scorecards.csv"');
    expect(csv.text.startsWith("﻿")).toBe(true);
    expect(csv.text.slice(1).split("\n")[0]).toBe("name,city,agreement,fleet,activeDrivers,utilisation,jobs,delivered,success,onTime,rating,earnedCents,paidCents,pendingCents,links,unlinks,verification");
    expect(csv.text).toContain("مكتب النور");
    const a = await lastExport(); expect(a.diff).toEqual({ rows: expect.any(Number), truncated: false, filters: expect.any(String) }); expect(a.diff).not.toHaveProperty("format");
    expect((await get(await mkStaff(["reports.view"]), "/admin/analytics/offices/table/scorecards?format=csv")).status).toBe(403);
  });

  it("a driver table exports too (the generic route, any registered report)", async () => {
    const { admin } = await world();
    const [d] = await sheetsOf(admin, "/admin/analytics/drivers/table/scorecards?format=xlsx&lang=en");
    expect(d.rows.length).toBeGreaterThan(1); expect(d.rows[0]).toContain(t("en", "rpp.col_driver"));
    const dur = col(d, t("en", "rpp.col_online")); expect(dur).toBeGreaterThan(0); expect(d.cells.get(`${String.fromCharCode(65 + dur)}2`)?.fmt ?? "[h]:mm:ss").toBe("[h]:mm:ss");
  });
});

describe("export cap", () => {
  it("pageAll walks in pages and cuts at the same 50 000 rows as the CSV, flagging the truncation", async () => {
    const calls: number[] = [];
    const big = await pageAll(async (limit, offset) => { calls.push(offset); return Array.from({ length: limit }, (_, i) => ({ n: offset + i })); });
    expect(big.truncated).toBe(true); expect(big.rows).toHaveLength(MAX_CSV_ROWS); expect(calls).toHaveLength(MAX_CSV_ROWS / CSV_PAGE);
    const small = await pageAll(async (limit, offset) => (offset === 0 ? Array.from({ length: limit }, (_, i) => ({ n: i })) : Array.from({ length: 5 }, (_, i) => ({ n: limit + i }))));
    expect(small).toMatchObject({ truncated: false }); expect(small.rows).toHaveLength(CSV_PAGE + 5);
    expect(await pageAll(async () => [])).toEqual({ rows: [], truncated: false });
  });
  it("the workbook warns on the Notes sheet when a sheet was cut", async () => {
    const tr = translator("en"), cols: DrillColumn[] = [{ key: "n", label: "rpp.col_jobs", type: "number" }];
    const h: TableHandle = { title: "x", columns: cols, fetch: async () => ({ rows: [{ n: 1 }], truncated: true }) };
    const r = await assembleWorkbook({ tr, kind: "driver", report: "drivers", dailyReport: "drivers", summary: [], filters: (await import("@/server/analytics/filters")).parseFilters(new URLSearchParams()), title: "T", facts: [], moneyHidden: false, source: { table: (_r, name) => (name === "daily" ? h : undefined) } });
    const notes = readXlsx(r.file).at(-1)!;
    expect(r.truncated).toBe(true); expect(notes.rows.flat()).toContain(t("en", "fr.xl_sheet_truncated", { sheet: t("en", "fr.sheet_daily"), max: 50_000 }));
  });
});

describe("GET /admin/analytics/:report/notes", () => {
  it("returns the localized how-to-read lines for a report, permission reports.view", async () => {
    await world();
    expect((await call("GET", "/admin/analytics/offices/notes")).status).toBe(401);
    expect((await get(await mkStaff(["finance.view"]), "/admin/analytics/offices/notes")).status).toBe(403);
    const staff = await mkStaff(["reports.view"]); // no export right needed to read the notes
    for (const lang of ["ar", "en", "ur"] as const) {
      const r = await get(staff, `/admin/analytics/offices/notes?lang=${lang}`);
      expect(r.status).toBe(200); expect(r.json.notes.length).toBeGreaterThan(2); expect(r.json.notes.every((x: unknown) => typeof x === "string" && x.length > 5)).toBe(true);
      expect(r.json.notes).toContain(t(lang, "fr.xl_note_tz"));
    }
    const en = (await get(staff, "/admin/analytics/offices/notes?lang=en")).json.notes as string[], fin = (await get(await exportStaff(), "/admin/analytics/offices/notes?lang=en")).json.notes as string[];
    expect(en).toContain(t("en", "fr.xl_note_hidden_money")); expect(fin).not.toContain(t("en", "fr.xl_note_hidden_money")); expect(fin).toContain(t("en", "fr.xl_note_money"));
    expect((await get(staff, "/admin/analytics/offices/notes?lang=xx")).status).toBe(422);
    expect((await get(staff, "/admin/analytics/offices/notes?table=scorecards&lang=en")).status).toBe(200);
    expect((await get(staff, "/admin/analytics/offices/notes?table=nope")).status).toBe(404);
  });
  it("the fleet reports contribute their own lines (fleet-notes), limited to the tables asked for, and the export Notes sheet prints them without repeating the period", async () => {
    const { admin } = await world();
    const all = (await get(admin, "/admin/analytics/drivers/notes?lang=en")).json.notes as string[];
    const daily = (await get(admin, "/admin/analytics/drivers/notes?lang=en&table=daily")).json.notes as string[];
    const failures = (await get(admin, "/admin/analytics/drivers/notes?lang=en&table=failures")).json.notes as string[];
    const prefix = t("en", "fr.note_period", { from: "FROM", to: "TO", days: 1 }).split("FROM")[0]; // "Period: "
    expect(all).toContain(t("en", "fr.note_anchor_jobs")); expect(all.some((l) => l.startsWith(prefix))).toBe(true); // the notes endpoint quotes the period itself
    expect(daily).toContain(t("en", "fr.note_daily", { max: FLEET.maxDailyDays })); expect(failures).not.toContain(t("en", "fr.note_daily", { max: FLEET.maxDailyDays }));
    expect(failures).toContain(t("en", "fr.note_failures")); expect(daily).not.toContain(t("en", "fr.note_failures"));
    expect(all.length).toBeGreaterThan(daily.length);
    const [, notes] = await sheetsOf(admin, "/admin/analytics/drivers/table/daily?format=xlsx&lang=en");
    const lines = notes.rows.flat().filter((x) => typeof x === "string") as string[];
    expect(lines).toContain(t("en", "fr.note_daily", { max: FLEET.maxDailyDays })); expect(lines).toContain(t("en", "fr.xl_note_tz"));
    expect(lines.some((l) => l.startsWith(prefix))).toBe(false); // the Notes sheet has its own Period row: the fleet note is not printed twice
  });
  it("cannot collide with a report called notes or workbook: reserved names are refused and 404", async () => {
    const staff = await mkStaff(["reports.view"]);
    for (const r of ["unknown", "notes", "workbook", "options", "explorer"]) expect((await get(staff, `/admin/analytics/${r}/notes`)).status, r).toBe(404);
    expect((await get(staff, "/admin/analytics/overview/notes")).status).toBe(200); // the Overview is a report with tables of its own
    for (const name of ["notes", "workbook", "options"]) expect(() => defineTable({ report: name, name: "x", title: "x", columns: [], sorts: { a: sql`1` }, defaultSort: { key: "a", dir: "asc" }, query: async () => ({ rows: [], total: 0 }) })).toThrow(/reserved/);
    expect((await get(staff, "/admin/analytics/workbook/table/x")).status).toBe(404); // the table route cannot swallow the workbook path
    expect((await get(await mkAdmin(), "/admin/analytics/explorer/datasets")).status).toBe(200); // the existing sibling routes still answer
  });
});

/** Stand-ins for the tables the core worker registers (only when not registered yet), so the workbook order and permissions are tested either way. */
function stubTables(driverIds: () => string[]) {
  const cols: DrillColumn[] = [{ key: "day", label: "rpp.col_city", type: "date" }, { key: "earnCents", label: "rpp.col_earned", type: "money", align: "end" }, { key: "n", label: "rpp.col_jobs", type: "number" }];
  const add = (report: string, name: string, rows: () => Array<Record<string, unknown>>, needs?: "finance.view"[]) => {
    if (getTable(report, name)) return;
    defineTable({ report, name, title: "rpp.tbl_off_cards", columns: name === "perf" ? [{ key: "name", label: "rpp.col_driver", type: "text" }, ...cols] : cols, sorts: { n: sql`1` }, defaultSort: { key: "n", dir: "asc" }, ...(needs ? { needs, moneyKeys: ["earnCents"] } : { moneyKeys: ["earnCents"] }), query: async () => ({ rows: rows(), total: rows().length }) });
  };
  const days = [{ id: "d1", day: "2026-11-01", earnCents: 12_345, n: 3 }, { id: "d2", day: "2026-11-02", earnCents: 0, n: 1 }];
  for (const r of ["offices", "drivers"]) { add(r, "daily", () => days); add(r, "jobs", () => days); add(r, "money", () => days, ["finance.view"]); add(r, "money_daily", () => days, ["finance.view"]); add(r, "failures", () => days); }
  add("offices", "earnings", () => days, ["finance.view"]);
  add("drivers", "perf", () => driverIds().map((id) => ({ id, name: "ignored", day: "2026-11-01", earnCents: 1, n: 1 })));
}
const ORDER = [["daily", "fr.sheet_daily", "offices"], ["perf", "fr.sheet_drivers", "drivers"], ["money", "fr.sheet_money", "offices"], ["money_daily", "fr.sheet_money_daily", "offices"], ["jobs", "fr.sheet_jobs", "offices"], ["earnings", "fr.sheet_earnings", "offices"], ["failures", "fr.sheet_failures", "offices"]] as const;

describe("GET /admin/analytics/workbook/:kind/:id", () => {
  it("an office workbook: Summary first, the registered tables in contract order, Notes last; permissions, 404s and the audit entry", async () => {
    const { admin, alpha, office, office2, driverO, driver2 } = await world();
    stubTables(() => [driverO.id]);
    const p = `/admin/analytics/workbook/office/${office.id}`;
    expect((await call("GET", p)).status).toBe(401);
    expect((await get(alpha, p)).status).toBe(403);
    expect((await get(await mkStaff(["finance.view"]), p)).status).toBe(403);
    expect((await get(await mkStaff(["reports.view"]), p)).status).toBe(403); // reports.export is needed as well
    const nf = "00000000-0000-4000-8000-000000000001";
    for (const bad of [`/admin/analytics/workbook/office/${nf}`, "/admin/analytics/workbook/office/not-a-uuid", `/admin/analytics/workbook/office/${driverO.id}`, `/admin/analytics/workbook/driver/${office.id}`, `/admin/analytics/workbook/company/${alpha.id}`]) expect((await get(admin, bad)).status, bad).toBe(404);
    expect((await get(admin, `${p}?lang=zz`)).status).toBe(422);
    const r = await bin(admin, `${p}?lang=en`);
    expect(r.status).toBe(200); expect(r.headers.get("content-type")).toBe(XLSX_MIME); expect(r.headers.get("content-disposition")).toMatch(new RegExp(`^attachment; filename="office-${office.id.slice(0, 8)}-\\d{4}-\\d{2}-\\d{2}_\\d{4}-\\d{2}-\\d{2}\\.xlsx"$`));
    const sheets = readXlsx(r.buf), names = sheets.map((s) => s.name);
    const expected = ["Summary"];
    for (const [name, key, report] of ORDER) {
      if (!getTable(report, name)) continue;
      expected.push(t("en", key));
      if (name === "perf" && getTable("drivers", "daily")) expected.push(t("en", "fr.sheet_daily_by_driver")); // one driver x 30 days: well within the cap
    }
    expect(names).toEqual([...expected, "Notes"]);
    expect(names[0]).toBe("Summary"); expect(names.at(-1)).toBe("Notes");
    // Summary: the office KPIs with current / previous / change and the localized definitions
    const sum = sheetOf(sheets, "Summary"); expect(sum.rows[0]).toEqual(["Indicator", "Current period", "Previous period", "Change", "Change %", "Definition", "Note"]);
    const kpi = (label: string) => sum.rows.find((x) => x[0] === label)!;
    expect(kpi(t("en", "rpp.kpi_cof_parcels"))[1]).toBe(10); expect(kpi(t("en", "rpp.kpi_cof_jobs"))[1]).toBe(1); expect(kpi(t("en", "rpp.kpi_cof_fleet"))[1]).toBe(1); // office X only, not office Y
    const earnedRow = sum.rows.findIndex((x) => x[0] === t("en", "rpp.kpi_cof_earned")); expect(earnedRow).toBeGreaterThan(0);
    expect(sum.cells.get(`B${earnedRow + 1}`)!.fmt).toBe("#,##0.00"); expect(Number(sum.rows[earnedRow][1])).toBeGreaterThan(0);
    expect(sum.cells.get(`B${sum.rows.findIndex((x) => x[0] === t("en", "rpp.kpi_cof_success")) + 1}`)!.fmt).toBe("0.0%");
    expect(String(kpi(t("en", "rpp.kpi_cof_jobs"))[5]).length).toBeGreaterThan(10);
    const notes = sheets.at(-1)!, text = JSON.stringify(notes.rows);
    expect(text).toContain("مكتب النور"); expect(text).toContain(t("en", "fr.xl_entity_office")); expect(text).toContain(names.slice(0, -1).join(", "));
    const a = await lastExport();
    expect(a).toMatchObject({ action: "report.export", entityId: `workbook/office/${office.id}`, actorId: admin.id }); expect(a.diff).toMatchObject({ workbook: "office", id: office.id, format: "xlsx" });
    if (getTable("drivers", "perf") && getTable("drivers", "daily")) { // Daily by driver is stacked per driver of the office, named, with a driver column in front
      const dd = sheetOf(sheets, t("en", "fr.sheet_daily_by_driver")); expect(dd.rows[0][0]).toBe(t("en", "rpp.col_driver")); expect(dd.rows.slice(1).every((x) => x[0] === "Driver Office")).toBe(true);
      expect(JSON.stringify(dd.rows)).not.toContain("Other Driver"); expect(driver2.id).not.toBe(driverO.id); expect(office2.id).not.toBe(office.id);
    }
  });

  it("money sheets are left out without finance.view, and Arabic sheet names and Summary labels follow lang", async () => {
    const { office, driverO } = await world();
    stubTables(() => [driverO.id]);
    const p = `/admin/analytics/workbook/office/${office.id}?lang=ar`;
    const poor = (await sheetsOf(await exportStaff([]), p)).map((s) => s.name), rich = (await sheetsOf(await exportStaff(["finance.view"]), p)).map((s) => s.name);
    for (const key of ["fr.sheet_money", "fr.sheet_money_daily", "fr.sheet_earnings"]) { expect(poor, key).not.toContain(t("ar", key)); expect(rich, key).toContain(t("ar", key)); }
    expect(poor[0]).toBe("الملخص"); expect(poor.at(-1)).toBe("ملاحظات");
    const sheets = await sheetsOf(await exportStaff([]), p);
    expect(sheets.every((s) => s.rtl)).toBe(true);
    const sum = sheetOf(sheets, "الملخص"); expect(sum.rows.some((x) => x[0] === t("ar", "rpp.kpi_cof_earned"))).toBe(false); expect(sum.rows.some((x) => x[0] === t("ar", "rpp.kpi_cof_jobs"))).toBe(true);
    expect(JSON.stringify(sheets.at(-1)!.rows)).toContain(t("ar", "fr.xl_note_hidden_money"));
  });

  it("a driver workbook has no Drivers or Earnings sheet; the period filters pass through; the entity cannot be widened by an office filter", async () => {
    const { admin, driverO, driver2, office2 } = await world();
    stubTables(() => [driverO.id]);
    const sheets = await sheetsOf(admin, `/admin/analytics/workbook/driver/${driverO.id}?lang=en&from=2026-10-01&to=2026-10-31&compare=none&office=${office2.id}`);
    const names = sheets.map((s) => s.name);
    expect(names).not.toContain("Drivers"); expect(names).not.toContain("Earnings"); expect(names).not.toContain("Daily by driver"); expect(names[0]).toBe("Summary");
    const text = JSON.stringify(sheets.at(-1)!.rows);
    expect(text).toContain("Driver Office"); expect(text).toContain("2026-10-01 to 2026-10-31 (31 days)"); expect(text).not.toContain(t("en", "rpf.f_office")); // the office filter was dropped, only the driver counts
    const sum = sheetOf(sheets, "Summary"); expect(sum.rows[1][2]).toBeNull(); // compare=none: no previous period
    expect((await get(admin, `/admin/analytics/workbook/driver/${driver2.id}`)).status).toBe(200);
    expect((await get(admin, "/admin/analytics/workbook/driver/zzz")).status).toBe(404);
    expect((await get(admin, `/admin/analytics/workbook/driver/${driverO.id}?preset=forever`)).status).toBe(422);
  });
});

describe("assembleWorkbook", () => {
  const tr = translator("en");
  const cols: DrillColumn[] = [{ key: "day", label: "rpp.col_city", type: "date" }, { key: "n", label: "rpp.col_jobs", type: "number" }];
  const filters = async (q = "") => (await import("@/server/analytics/filters")).parseFilters(new URLSearchParams(q));
  it("skips tables that are not registered, never crashes on a missing one, and keeps the order", async () => {
    const some: Record<string, TableHandle> = { jobs: { title: "j", columns: cols, fetch: async () => ({ rows: [{ day: "2026-11-01", n: 1 }], truncated: false }) }, daily: { title: "d", columns: cols, fetch: async () => ({ rows: [], truncated: false }) } };
    const r = await assembleWorkbook({ tr, kind: "driver", report: "drivers", dailyReport: "drivers", summary: [], filters: await filters(), title: "T", facts: [["Driver", "T"]], moneyHidden: false, source: { table: (_r, name) => some[name] } });
    expect(readXlsx(r.file).map((s) => s.name)).toEqual(["Summary", "Daily", "Jobs", "Notes"]);
    const none = await assembleWorkbook({ tr, kind: "office", report: "offices", dailyReport: "drivers", summary: [], filters: await filters(), title: "T", facts: [], moneyHidden: false, source: { table: () => undefined } });
    expect(readXlsx(none.file).map((s) => s.name)).toEqual(["Summary", "Notes"]);
  });
  it("adds Daily by driver only when drivers x days is within 20 000 rows, otherwise says so on the Notes sheet (as Thawani does)", async () => {
    const { driverO, driver2 } = await world();
    const perf = (ids: string[]): TableHandle => ({ title: "p", columns: [{ key: "name", label: "rpp.col_driver", type: "text" }], fetch: async () => ({ rows: ids.map((id) => ({ id, name: "x" })), truncated: false }) });
    const daily: TableHandle = { title: "d", columns: cols, fetch: async (driver) => ({ rows: [{ day: "2026-11-01", n: driver === driverO.id ? 5 : 7 }], truncated: false }) };
    const src = (ids: string[]) => ({ table: (_r: string, name: string) => (name === "perf" ? perf(ids) : name === "daily" ? daily : undefined) });
    const base = { tr, kind: "office" as const, report: "offices", dailyReport: "drivers", summary: [], title: "T", facts: [], moneyHidden: false };
    const small = readXlsx((await assembleWorkbook({ ...base, filters: await filters("from=2026-11-01&to=2026-11-30&compare=none"), source: src([driverO.id, driver2.id]) })).file);
    expect(small.map((s) => s.name)).toEqual(["Summary", "Daily", "Drivers", "Daily by driver", "Notes"]);
    const dbd = sheetOf(small, "Daily by driver"); expect(dbd.rows.map((r) => [r[0], r[2]])).toEqual([["Driver", "Jobs"], ["Driver Office", 5], ["Other Driver", 7]]);
    // 700 drivers x 30 days = 21 000 rows > 20 000: left out, with the numbers in the Notes
    const many = Array.from({ length: 700 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const big = readXlsx((await assembleWorkbook({ ...base, filters: await filters("from=2026-11-01&to=2026-11-30&compare=none"), source: src(many) })).file);
    expect(big.map((s) => s.name)).toEqual(["Summary", "Daily", "Drivers", "Notes"]);
    expect(big.at(-1)!.rows.flat().join("\n")).toContain("700 drivers x 30 days = 21000 rows");
    // within the row limit but above the per-export driver cap (121 x 2 days)
    const wide = readXlsx((await assembleWorkbook({ ...base, filters: await filters("from=2026-11-01&to=2026-11-02&compare=none"), source: src(many.slice(0, 121)) })).file);
    expect(wide.map((s) => s.name)).not.toContain("Daily by driver"); expect(wide.at(-1)!.rows.flat().join("\n")).toContain("121 drivers x 2 days = 242 rows");
  });
});

describe("company portal", () => {
  it("exports its own table as xlsx with the portal rules (session owner, 403 for other roles, audited)", async () => {
    const { alpha, driverO } = await world();
    const p = "/business/analytics/table/requests?format=xlsx&lang=en";
    expect((await get(driverO, p)).status).toBe(403); expect((await call("GET", p)).status).toBe(401);
    const [d, n] = await sheetsOf(alpha, p);
    expect(d.rows.length).toBeGreaterThan(1); expect(d.rtl).toBe(false); expect(n.name).toBe("Notes");
    expect(n.rows.flat()).toContain(t("en", "fr.xl_report_portal_business"));
    expect(await lastExport()).toMatchObject({ entityId: "business/requests", actorId: alpha.id });
  });
});

describe("office portal", () => {
  it("exports its own workbook and tables as xlsx, never another office's; a company or a driver cannot", async () => {
    const { office, office2, driverO, driver2, alpha } = await world();
    const p = "/office/analytics/workbook?lang=en";
    expect((await call("GET", p)).status).toBe(401);
    expect((await get(alpha, p)).status).toBe(403); expect((await get(driverO, p)).status).toBe(403); expect((await get(await mkStaff(["reports.view", "reports.export"]), p)).status).toBe(403);
    const mine = await sheetsOf(office, `${p}&office=${office2.id}`); // a foreign office is ignored: the owner is the session
    const foreign = await sheetsOf(office, `${p}&driver=${driver2.id}`); // a foreign driver matches nothing: no numbers leak
    expect(mine[0].name).toBe("Summary"); expect(mine.at(-1)!.name).toBe("Notes");
    const sum = mine[0]; const kpiRow = (label: string) => sum.rows.find((r) => r[0] === label)!;
    expect(sum.rows.length).toBeGreaterThan(5); expect(JSON.stringify(mine.at(-1)!.rows)).toContain("مكتب النور"); expect(JSON.stringify(mine.at(-1)!.rows)).not.toContain("Other Driver");
    const ov = (await get(office, "/office/analytics/overview")).json.kpis as Array<{ key: string; label: string; value: number | null }>;
    const jobsKpi = ov.find((k) => k.key === "off_jobs")!; expect(jobsKpi.value).toBe(1);
    expect(kpiRow(t("en", jobsKpi.label))[1]).toBe(1); expect(foreign[0].rows.find((r) => r[0] === t("en", jobsKpi.label))![1]).toBe(0); // the foreign driver's id matches no work of this office expect(kpiRow(t("en", ov.find((k) => k.key === "off_earnings")!.label))[1]).toBeGreaterThan(0);
    const a = await lastExport(); expect(a).toMatchObject({ entityId: `workbook/office/${office.id}`, actorId: office.id }); expect(a.diff).toMatchObject({ workbook: "office", id: office.id });
    const other = await sheetsOf(office2, p); expect(JSON.stringify(other.at(-1)!.rows)).not.toContain("مكتب النور");
    // portal table export: same contract as the admin one, owner = the session
    const r = await bin(office, "/office/analytics/table/drivers?format=xlsx&lang=ar");
    expect(r.status).toBe(200); expect(r.headers.get("content-type")).toBe(XLSX_MIME);
    const [d, n] = readXlsx(r.buf); expect(d.rtl).toBe(true); expect(d.rows.length).toBe(2); expect(JSON.stringify(d.rows)).toContain("Driver Office"); expect(JSON.stringify(d.rows)).not.toContain("Other Driver");
    expect(n.name).toBe(t("ar", "fr.sheet_notes"));
    expect((await lastExport()).diff).toMatchObject({ format: "xlsx" });
    expect((await get(office, "/office/analytics/table/drivers?format=xlsx&lang=qq")).status).toBe(422);
    const csv = await get(office, "/office/analytics/table/drivers?format=csv"); expect(csv.text.startsWith("﻿")).toBe(true);
    const notes = await get(office, "/office/analytics/notes?lang=ar"); expect(notes.status).toBe(200); expect(notes.json.notes).toContain(t("ar", "fr.xl_note_tz")); expect((await get(alpha, "/office/analytics/notes")).status).toBe(403);
  });
});
