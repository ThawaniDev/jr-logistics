/**
 * Pure logic of the fleet report centre (components/reports/fleet, decisions I7–I9): which views a viewer gets, which registered table each view reads, the period → range maths,
 * every URL the centre calls (tables, downloads, notes, workbook, KPI strip), file names from `Content-Disposition`, and the KPI groups ("More metrics" catches every KPI no group
 * names). No React, no database.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  API_PREFIX, entityQs, FLEET_PRESETS, fileNameFrom, isDailyView, isMoneyView, kpiPath, MAX_DAILY_DAYS, notesPath, pageSizeOf, periodQs, rangeLimits, rangeOf, resolveView, tableDownload,
  tableFor, tablePath, tooLong, VIEW_ORDER, viewsFor, workbookDownload, type FleetScope, type PeriodLike, type FleetView,
} from "@/components/reports/fleet/fleet-lib";
import { DRIVER_GROUPS, groupKpis, HIDE_FOR_ENTITY, MORE_GROUP, OFFICE_GROUPS, PORTAL_GROUPS } from "@/components/reports/fleet/kpi-groups";
import { ar, en, ur } from "@/i18n/fragments/rd-fleet-ui";
import { FLEET_DRIVER_KPI_KEYS, FLEET_OFFICE_KPI_KEYS } from "@/server/analytics/fleet-kpis";
import type { Kpi } from "@/server/analytics/kpi";
import { presetRange, PRESETS } from "@/server/analytics/periods";

const P30: PeriodLike = { preset: "30d", from: "2026-10-22", to: "2026-11-20", compare: "prev" };
const CUSTOM: PeriodLike = { preset: "custom", from: "2026-01-01", to: "2026-03-31", compare: "none" };
const OFFICE: FleetScope = { kind: "office", id: "11111111-1111-1111-1111-111111111111" };
const DRIVER: FleetScope = { kind: "driver", id: "22222222-2222-2222-2222-222222222222" };
const PORTAL: FleetScope = { kind: "portal" };
const all = { finance: true }, none = { finance: false };
const kpi = (key: string): Kpi => ({ key, label: `rpp.kpi_${key}`, definition: `rpp.def_${key}`, unit: "count", good: "higher", value: 1, prev: null, delta: null, deltaPct: null }) as unknown as Kpi;

describe("views per kind and permission", () => {
  it("an office and the portal get seven views, a driver five (no Drivers, no Earnings)", () => {
    expect(viewsFor("office", all)).toEqual(["daily", "drivers", "money", "money_daily", "jobs", "earnings", "failures"]);
    expect(viewsFor("portal", all)).toEqual(viewsFor("office", all));
    expect(viewsFor("driver", all)).toEqual(["daily", "money", "money_daily", "jobs", "failures"]);
  });
  it("without finance.view the money views (money, money by day, earnings) are gone, the rest stays in order", () => {
    expect(viewsFor("office", none)).toEqual(["daily", "drivers", "jobs", "failures"]);
    expect(viewsFor("driver", none)).toEqual(["daily", "jobs", "failures"]);
    for (const k of ["office", "driver", "portal"] as const) for (const v of viewsFor(k, none)) expect(isMoneyView(v), `${k}/${v}`).toBe(false);
    expect(VIEW_ORDER.office.filter(isMoneyView)).toEqual(["money", "money_daily", "earnings"]);
  });
  it("resolveView keeps a valid ?view=, and falls back to Daily for an unknown, forbidden or missing one", () => {
    expect(resolveView("jobs", "office", all)).toBe("jobs");
    expect(resolveView("drivers", "driver", all)).toBe("daily");        // drivers have no Drivers view
    expect(resolveView("earnings", "driver", all)).toBe("daily");
    expect(resolveView("money", "office", none)).toBe("daily");          // no finance.view
    expect(resolveView("money", "portal", all)).toBe("money");
    for (const raw of [undefined, null, "", "bogus", "__proto__", "DAILY"]) expect(resolveView(raw, "office", all)).toBe("daily");
  });
  it("which views are day-by-day (the ones capped at 366 days)", () => {
    expect(["daily", "money_daily"].every((v) => isDailyView(v as FleetView))).toBe(true);
    expect(["drivers", "money", "jobs", "earnings", "failures"].some((v) => isDailyView(v as FleetView))).toBe(false);
    expect(pageSizeOf("daily")).toBe(31); expect(pageSizeOf("jobs")).toBe(15);
  });
});

describe("which registered table a view reads (contract §4)", () => {
  it("office page: its own tables from the offices report; its drivers and their money from the drivers report narrowed to the office", () => {
    expect(tableFor("office", "daily")).toEqual({ portal: false, report: "offices", name: "daily" });
    expect(tableFor("office", "drivers")).toEqual({ portal: false, report: "drivers", name: "perf" });
    expect(tableFor("office", "money")).toEqual({ portal: false, report: "drivers", name: "money" });
    for (const n of ["money_daily", "jobs", "earnings", "failures"] as const) expect(tableFor("office", n)).toEqual({ portal: false, report: "offices", name: n });
  });
  it("driver page: everything from the drivers report", () => {
    for (const v of VIEW_ORDER.driver) expect(tableFor("driver", v)).toEqual({ portal: false, report: "drivers", name: v });
  });
  it("portal: the portal tables (Drivers = perf), one name per view; every name is one of the seven registered ones", () => {
    const names = VIEW_ORDER.portal.map((v) => tableFor("portal", v));
    expect(names.every((t) => t.portal)).toBe(true);
    expect(names.map((t) => t.name)).toEqual(["daily", "perf", "money", "money_daily", "jobs", "earnings", "failures"]);
  });
  it("every table name the centre can ask for is one of the contract's", () => {
    const drivers = new Set(["perf", "daily", "money", "money_daily", "jobs", "failures"]), offices = new Set(["perf", "daily", "money", "money_daily", "earnings", "jobs", "failures"]);
    for (const kind of ["office", "driver", "portal"] as const) for (const v of VIEW_ORDER[kind]) {
      const t = tableFor(kind, v);
      if (!t.portal) expect((t.report === "drivers" ? drivers : offices).has(t.name), `${kind}/${v} -> ${t.report}/${t.name}`).toBe(true);
    }
  });
});

describe("period maths", () => {
  it("the bar offers today, 7 / 30 / 90 days and month to date, all valid server presets", () => {
    expect([...FLEET_PRESETS]).toEqual(["today", "7d", "30d", "90d", "mtd"]);
    for (const p of FLEET_PRESETS) expect((PRESETS as readonly string[]).includes(p)).toBe(true);
  });
  it("preset → inclusive Riyadh day range and day count", () => {
    expect(rangeOf({ preset: "today", from: "", to: "" }, "2026-11-20")).toEqual({ from: "2026-11-20", to: "2026-11-20", days: 1 });
    expect(rangeOf({ preset: "7d", from: "", to: "" }, "2026-11-20")).toEqual({ from: "2026-11-14", to: "2026-11-20", days: 7 });
    expect(rangeOf({ preset: "30d", from: "", to: "" }, "2026-11-20")).toEqual({ from: "2026-10-22", to: "2026-11-20", days: 30 });
    expect(rangeOf({ preset: "90d", from: "", to: "" }, "2026-11-20")).toEqual({ from: "2026-08-23", to: "2026-11-20", days: 90 });
    expect(rangeOf({ preset: "mtd", from: "", to: "" }, "2026-11-20")).toEqual({ from: "2026-11-01", to: "2026-11-20", days: 20 });
    expect(rangeOf({ preset: "mtd", from: "", to: "" }, "2026-03-01")).toEqual({ from: "2026-03-01", to: "2026-03-01", days: 1 });
    expect(rangeOf({ preset: "30d", from: "", to: "" }, "2026-11-20")).toEqual({ ...presetRange("30d", "2026-11-20"), days: 30 });
    expect(rangeOf(CUSTOM, "2026-11-20")).toEqual({ from: "2026-01-01", to: "2026-03-31", days: 90 });
  });
  it("366 days is the longest period the daily tables accept", () => {
    expect(MAX_DAILY_DAYS).toBe(366);
    expect(tooLong(366)).toBe(false); expect(tooLong(367)).toBe(true); expect(tooLong(1)).toBe(false);
    const { minFrom, maxTo } = rangeLimits("2026-01-01", "2026-03-31");
    expect(rangeOf({ preset: "custom", from: minFrom, to: "2026-03-31" }, "2026-11-20").days).toBe(366);
    expect(rangeOf({ preset: "custom", from: "2026-01-01", to: maxTo }, "2026-11-20").days).toBe(366);
  });
});

describe("URLs", () => {
  it("period query: a preset or a custom range, always with the comparison", () => {
    expect(periodQs(P30)).toBe("preset=30d&compare=prev");
    expect(periodQs(CUSTOM)).toBe("from=2026-01-01&to=2026-03-31&compare=none");
    expect(periodQs({ ...P30, compare: "yoy" })).toBe("preset=30d&compare=yoy");
  });
  it("entity query: the office / driver is injected as a filter; the portal sends none (the server scopes it to the session)", () => {
    expect(entityQs(OFFICE, P30)).toBe(`preset=30d&compare=prev&office=${OFFICE.kind === "office" ? OFFICE.id : ""}`);
    expect(entityQs(DRIVER, CUSTOM)).toBe(`from=2026-01-01&to=2026-03-31&compare=none&driver=${DRIVER.kind === "driver" ? DRIVER.id : ""}`);
    expect(entityQs(PORTAL, P30)).toBe("preset=30d&compare=prev");
    expect(entityQs({ kind: "office", id: "a b&c" }, P30)).toContain("office=a%20b%26c"); // an id can never smuggle another parameter
  });
  it("table paths: the platform report or the owner's portal", () => {
    const qs = entityQs(OFFICE, P30);
    expect(tablePath(tableFor("office", "daily"), qs)).toBe(`/admin/analytics/offices/table/daily?${qs}`);
    expect(tablePath(tableFor("office", "drivers"), qs)).toBe(`/admin/analytics/drivers/table/perf?${qs}`);
    expect(tablePath(tableFor("portal", "drivers"), "preset=7d&compare=none")).toBe("/office/analytics/table/perf?preset=7d&compare=none");
  });
  it("downloads: the same query plus format and the language of the headers, under /api/v1", () => {
    const qs = entityQs(OFFICE, P30);
    expect(tableDownload(tableFor("office", "jobs"), qs, "xlsx", "ar")).toBe(`${API_PREFIX}/admin/analytics/offices/table/jobs?${qs}&format=xlsx&lang=ar`);
    expect(tableDownload(tableFor("driver", "money"), entityQs(DRIVER, P30), "csv", "en")).toBe(`${API_PREFIX}/admin/analytics/drivers/table/money?${entityQs(DRIVER, P30)}&format=csv&lang=en`);
    expect(tableDownload(tableFor("portal", "earnings"), entityQs(PORTAL, CUSTOM), "xlsx", "ur")).toBe(`${API_PREFIX}/office/analytics/table/earnings?from=2026-01-01&to=2026-03-31&compare=none&format=xlsx&lang=ur`);
  });
  it("notes are those of the table on screen for the selected period and entity; workbook takes the period only (the entity is in the path or the session)", () => {
    const qs = entityQs(OFFICE, P30);
    expect(notesPath(tableFor("office", "drivers"), qs, "ar")).toBe(`/admin/analytics/drivers/notes?${qs}&table=perf&lang=ar`);
    expect(notesPath(tableFor("office", "daily"), qs, "en")).toBe(`/admin/analytics/offices/notes?${qs}&table=daily&lang=en`);
    expect(notesPath(tableFor("portal", "money_daily"), "preset=7d&compare=none", "ur")).toBe("/office/analytics/notes?preset=7d&compare=none&table=money_daily&lang=ur");
    expect(workbookDownload(OFFICE, P30, "en")).toBe(`${API_PREFIX}/admin/analytics/workbook/office/${OFFICE.kind === "office" ? OFFICE.id : ""}?preset=30d&compare=prev&lang=en`);
    expect(workbookDownload(DRIVER, CUSTOM, "ar")).toBe(`${API_PREFIX}/admin/analytics/workbook/driver/${DRIVER.kind === "driver" ? DRIVER.id : ""}?from=2026-01-01&to=2026-03-31&compare=none&lang=ar`);
    expect(workbookDownload(PORTAL, P30, "ur")).toBe(`${API_PREFIX}/office/analytics/workbook?preset=30d&compare=prev&lang=ur`);
    expect(workbookDownload(OFFICE, P30, "en")).not.toContain("office=");
  });
  it("the KPI strip reads the offices / drivers report narrowed to the entity, or the portal overview", () => {
    expect(kpiPath(OFFICE, "q=1")).toBe("/admin/analytics/offices?q=1");
    expect(kpiPath(DRIVER, "q=1")).toBe("/admin/analytics/drivers?q=1");
    expect(kpiPath(PORTAL, "q=1")).toBe("/office/analytics/overview?q=1");
  });
});

describe("file names", () => {
  it("from Content-Disposition: quoted, bare, RFC 5987 (Arabic names), or the fallback", () => {
    expect(fileNameFrom('attachment; filename="office-daily.xlsx"', "x.xlsx")).toBe("office-daily.xlsx");
    expect(fileNameFrom("attachment; filename=report.csv", "x.csv")).toBe("report.csv");
    expect(fileNameFrom("attachment; filename=\"fallback.xlsx\"; filename*=UTF-8''%D9%85%D9%83%D8%AA%D8%A8.xlsx", "x")).toBe("مكتب.xlsx");
    expect(fileNameFrom(null, "fallback.xlsx")).toBe("fallback.xlsx");
    expect(fileNameFrom("attachment", "fallback.xlsx")).toBe("fallback.xlsx");
    expect(fileNameFrom("attachment; filename*=UTF-8''%E0%A4%A", "fb.xlsx")).toBe("fb.xlsx"); // a broken escape never throws
  });
});

describe("KPI groups: nothing a report returns is ever hidden", () => {
  const keys = (g: Array<{ kpis: Kpi[] }>) => g.flatMap((x) => x.kpis.map((k) => k.key));
  it("known keys land in their group in the order of the group; each KPI appears once", () => {
    const g = groupKpis([kpi("flt_rating"), kpi("flt_success"), kpi("active_drivers"), kpi("flt_acceptance")], DRIVER_GROUPS);
    expect(g.map((x) => x.id)).toEqual(["fleet", "reliability", "offers", "quality"]);
    expect(keys(g)).toEqual(["active_drivers", "flt_success", "flt_acceptance", "flt_rating"]);
    const dupe = groupKpis([kpi("a"), kpi("b")], [{ id: "x", title: "t1", keys: ["a", "b"] }, { id: "y", title: "t2", keys: ["b"] }]);
    expect(dupe).toHaveLength(1); expect(keys(dupe)).toEqual(["a", "b"]);
  });
  it("a KPI no group names goes to the final More metrics group (a KPI added to a report later is not lost)", () => {
    const g = groupKpis([kpi("flt_success"), kpi("flt_brand_new"), kpi("another_new")], DRIVER_GROUPS);
    expect(g.at(-1)).toMatchObject({ id: MORE_GROUP.id, title: "fr.grp_more" });
    expect(keys([g.at(-1)!])).toEqual(["flt_brand_new", "another_new"]);
    expect(keys(g).sort()).toEqual(["another_new", "flt_brand_new", "flt_success"]);
  });
  it("empty groups are not shown, hidden keys are skipped, nothing at all gives no group", () => {
    expect(groupKpis([], DRIVER_GROUPS)).toEqual([]);
    expect(groupKpis([kpi("cof_active")], OFFICE_GROUPS, HIDE_FOR_ENTITY.office)).toEqual([]);
    expect(keys(groupKpis([kpi("active_drivers"), kpi("flt_success")], DRIVER_GROUPS, HIDE_FOR_ENTITY.driver))).toEqual(["flt_success"]);
    expect(groupKpis([kpi("flt_success")], DRIVER_GROUPS).some((x) => x.kpis.length === 0)).toBe(false);
  });
  it("every KPI key of the reports as they are today (including the fl_* fleet KPIs) has a group — More metrics stays empty — and no key is in two groups", () => {
    const D = ["active_drivers", "flt_available", "flt_online_hours", "flt_jobs_per", "flt_parcels_per", "flt_success", "on_time_start", "flt_acceptance", "flt_resp_p50", "flt_resp_p90", "flt_cancel", "flt_replaced", "flt_rating", "flt_earn_per", "flt_earn_hour", "flt_util", "flt_cash", "flt_strikes", "flt_suspensions", "flt_churned", "flt_flagged", ...FLEET_DRIVER_KPI_KEYS];
    const O = ["cof_active", "cof_fleet", "cof_active_drivers", "cof_jobs", "cof_parcels", "cof_success", "cof_ontime", "cof_rating", "cof_util", "cof_earned", "cof_paid", "cof_pending", "cof_links", "cof_unlinks", "cof_agreed", ...FLEET_OFFICE_KPI_KEYS];
    const R = ["off_drivers", "active_drivers", "off_utilisation", "off_rating", "off_jobs", "off_completion_rate", "parcels_delivered", "delivery_success", "on_time_start", "off_earnings", "off_paid", "off_pending"];
    for (const [ks, groups] of [[D, DRIVER_GROUPS], [O, OFFICE_GROUPS], [R, PORTAL_GROUPS]] as const) {
      const g = groupKpis(ks.map(kpi), groups);
      expect(g.some((x) => x.id === MORE_GROUP.id), "nothing falls into More metrics").toBe(false);
      expect(keys(g).sort()).toEqual([...ks].sort());
      const named = groups.flatMap((x) => x.keys);
      expect(new Set(named).size, "a key is named by one group only").toBe(named.length);
    }
  });
  it("group ids are unique per report and every title is an fr.grp_ key", () => {
    for (const groups of [DRIVER_GROUPS, OFFICE_GROUPS, PORTAL_GROUPS]) {
      expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length);
      for (const g of groups) expect(g.title).toMatch(/^fr\.grp_/);
    }
  });
});

describe("translations", () => {
  const FILES = [...readdirSync("src/components/reports/fleet").filter((f) => /\.tsx?$/.test(f)).map((f) => `src/components/reports/fleet/${f}`), "src/components/features/admin-offices-reports.tsx", "src/components/features/admin-drivers-reports.tsx", "src/components/features/admin-offices-shell.tsx", "src/components/features/admin-drivers-shell.tsx"];
  const used = new Set<string>();
  for (const f of FILES) for (const m of readFileSync(f, "utf8").matchAll(/["`'](fr\.[a-z0-9_]+)["`']/g)) used.add(m[1]);
  // keys built from a view name: fr.view_<view>, fr.hint_<view>, fr.hint_perf_<report>, fr.perf_sub_<report>
  const views = [...new Set([...VIEW_ORDER.office, ...VIEW_ORDER.driver, "perf"])];
  for (const v of views) { used.add(`fr.view_${v}`); if (v !== "perf") used.add(`fr.hint_${v}`); }
  for (const r of ["drivers", "offices"]) { used.add(`fr.hint_perf_${r}`); used.add(`fr.perf_sub_${r}`); }
  for (const g of [...DRIVER_GROUPS, ...OFFICE_GROUPS, ...PORTAL_GROUPS]) used.add(g.title);
  used.add("fr.grp_more");
  it("every fr. key the screens use exists in English, Arabic and Urdu with the same placeholders", () => {
    expect(used.size).toBeGreaterThan(30);
    for (const k of used) {
      for (const [lang, d] of [["en", en], ["ar", ar], ["ur", ur]] as const) expect(d[k], `${lang}: ${k}`).toBeTruthy();
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      expect(ph(ar[k]), `${k} placeholders (ar)`).toBe(ph(en[k]));
      expect(ph(ur[k]), `${k} placeholders (ur)`).toBe(ph(en[k]));
    }
  });
  it("the sidebar item and the three languages have the same key set", () => {
    expect(en["nav.rep_performance"]).toBe("Performance");
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(ur).sort()).toEqual(Object.keys(en).sort());
  });
});
