/**
 * Pure logic of the fleet reports (drivers + courier offices, memory/FLEET_REPORTS.md): haversine, naming rules, the Riyadh day grid and its 366-day refusal, the metric registry and
 * the SQL it builds, the KPI arithmetic (null / zero cases), the notes and the translations of every key the code can ask for. No database.
 */
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import { allKpiDefs, kpiConflicts } from "@/server/analytics/definitions";
import { parseFilters } from "@/server/analytics/filters";
import { alias, camel, currentOnly, dailyKeys, FLEET, haversineM, haversineSql, rowKey, stepOk } from "@/server/analytics/fleet-lib";
import { columnOf, fieldOf, METRICS, metric, moneyFields, selectMetrics, sortOf } from "@/server/analytics/fleet-metrics";
import { fleetKpis, FLEET_DRIVER_KPI_KEYS, FLEET_OFFICE_KPI_KEYS } from "@/server/analytics/fleet-kpis";
import { fleetNotes } from "@/server/analytics/fleet-notes";
import { dxBase } from "@/server/analytics/fleet-sql";
import { startFamily } from "@/server/analytics/fleet-sql-parts";
import { MONEY_BASE } from "@/server/analytics/fleet-sql-money";
import { listTables } from "@/server/analytics/registry";
import "@/server/analytics/fleet-tables-drivers";
import "@/server/analytics/fleet-tables-offices";

const dialect = new PgDialect();
const text = (q: ReturnType<typeof sql>) => dialect.sqlToQuery(q).sql.replace(/\s+/g, " ").trim();
const NOW = new Date("2026-11-19T10:00:00Z");
const P = (cur: number | null, prev: number | null = null) => ({ cur, prev });
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("distance", () => {
  it("haversine: 0.1° of latitude is 11.12 km, Riyadh → Jeddah is about 846 km, a point to itself is 0", () => {
    expect(haversineM(24.7136, 46.6753, 24.8136, 46.6753)).toBeCloseTo(11119.49, 1);
    expect(haversineM(24.7136, 46.6753, 21.4858, 39.1925)).toBeGreaterThan(840_000); expect(haversineM(24.7136, 46.6753, 21.4858, 39.1925)).toBeLessThan(850_000);
    expect(haversineM(24.7, 46.7, 24.7, 46.7)).toBe(0);
    expect(haversineM(0, 0, 0, 180)).toBeCloseTo(Math.PI * FLEET.earthM, 0); // half the circumference
  });
  it("the SQL fragment is the same formula over the four expressions it is given", () => {
    const q = text(haversineSql(sql`a.lat`, sql`a.lng`, sql`b.lat`, sql`b.lng`));
    expect(q).toContain("2 * 6371000 * asin(sqrt(least(1, power(sin(radians((b.lat) - (a.lat)) / 2), 2)");
    expect(q).toContain("cos(radians(a.lat)) * cos(radians(b.lat)) * power(sin(radians((b.lng) - (a.lng)) / 2), 2)");
  });
  it("one job counts at most 16 hours early or late in the lateness averages", () => {
    const inWin = () => sql`true`, late = text(startFamily(30).late_sec(inWin)), delta = text(startFamily(30).delta_sec(inWin));
    expect(late).toContain("sum(least(57600, extract(epoch from (offers.arrived_at - requests.starts_at))))"); expect(delta).toContain("sum(greatest(-57600, least(57600, extract(epoch from (offers.arrived_at - requests.starts_at)))))");
  });
  it("a step is plausible only between zero and the cap", () => {
    expect(text(stepOk(sql`a`, sql`b`, 3600))).toBe("extract(epoch from (b - a)) between 0 and 3600");
  });
});

describe("naming", () => {
  it("camelCase fields: unit suffix kept, money gets Cents", () => {
    expect(camel("late_avg_min")).toBe("lateAvgMin"); expect(camel("stars1")).toBe("stars1"); expect(camel("radius_m")).toBe("radiusM");
    expect(rowKey("cod_held", true)).toBe("codHeldCents"); expect(rowKey("deliv_per_online_hour")).toBe("delivPerOnlineHour");
    expect(fieldOf("cod_held")).toBe("codHeldCents"); expect(fieldOf("earn_per_hour")).toBe("earnPerHourCents"); expect(fieldOf("wait_avg_min")).toBe("waitAvgMin");
    expect(text(alias("lateAvgMin"))).toBe('"lateAvgMin"');
  });
  it("every metric key is unique and every row field is too", () => {
    const keys = METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length); expect(new Set(keys.map(fieldOf)).size).toBe(keys.length);
    expect(() => metric("nope")).toThrow(/Unknown fleet metric/);
  });
});

describe("the Riyadh day grid", () => {
  it("has one key per day and refuses a period longer than 366 days with VALIDATION", () => {
    const f = parseFilters({ from: "2026-05-10", to: "2026-05-12" }, NOW);
    expect(dailyKeys(f)).toEqual(["2026-05-10", "2026-05-11", "2026-05-12"]);
    expect(dailyKeys(parseFilters({ from: "2025-05-10", to: "2026-05-10", bucket: "week" }, NOW))).toHaveLength(366);
    try { dailyKeys(parseFilters({ from: "2025-05-09", to: "2026-05-10", bucket: "week" }, NOW)); expect.unreachable(); }
    catch (e) { expect((e as { code: string }).code).toBe("VALIDATION"); expect((e as { details: { field: string } }).details.field).toBe("to"); }
  });
  it("a table reads one period: the comparison window is dropped", () => {
    const f = currentOnly(parseFilters({ office: "0b8f3d3e-7b53-4c36-9f0c-6a8f0d2a7a11" }, NOW));
    expect(f.prev).toBeNull(); expect(f.compare).toBe("none"); expect(f.office).toHaveLength(1);
  });
});

describe("metric registry → SQL", () => {
  it("averages and ratios divide by NULLIF (no data is NULL, never 0); money ratios round to whole halalas", () => {
    expect(text(metric("late_avg_min").expr("c"))).toContain("nullif(late_c + very_late_c, 0)");
    expect(text(metric("wait_avg_min").expr("c"))).toBe("round(((wait_sec_c)::float8 / nullif(wait_n_c, 0) / 60.0)::numeric, 2)::float8");
    expect(text(metric("decline_rate").expr("c"))).toBe("(declined_c + timedout_c)::float8 / nullif(offered_c, 0)");
    expect(text(metric("earn_per_job").expr("c"))).toBe("round((earn_c)::float8 / nullif(jobs_c, 0))::float8");
    expect(text(metric("deliv_per_online_hour").expr("p"))).toContain("online_p");
  });
  it("select list: one quoted camelCase alias per metric; sort map and columns follow", () => {
    const keys = ["late_avg_min", "cod_held"];
    expect(text(selectMetrics(keys))).toMatch(/as "lateAvgMin", .* as "codHeldCents"$/);
    expect(Object.keys(sortOf(keys))).toEqual(["lateAvgMin", "codHeldCents"]); expect(text(sortOf(keys).lateAvgMin)).toBe('"lateAvgMin"');
    expect(columnOf("cod_held")).toEqual({ key: "codHeldCents", label: "fr.col_cod_held", type: "money", align: "end" });
    expect(columnOf("late", { phone: false })).toMatchObject({ phone: false }); expect(columnOf("late")).not.toHaveProperty("phone");
    expect(moneyFields(["jobs", "earn", "cod_held", "earn_per_job"])).toEqual(["earnCents", "codHeldCents", "earnPerJobCents"]);
  });
  it("every expression only reads base columns that dx (or the day grid) provides", () => {
    const base = new Set([...dxBase(true), "resp_p90", "fleet", "drivers_active", "links", "unlinks", "registered", "online_drivers", "drivers_with_jobs", "answered", "accepted", "first_att", "late_sec", "delta_sec"]);
    for (const m of METRICS) {
      const sqlText = text(m.expr("c"));
      for (const id of sqlText.match(/\b[a-z][a-z0-9_]*_c\b/g) ?? []) expect(base.has(id.slice(0, -2)), `${m.key} reads ${id}`).toBe(true);
    }
    expect(MONEY_BASE).toContain("cod_held"); expect(dxBase(false)).not.toContain("earn"); expect(dxBase(true)).toContain("earn");
  });
});

describe("fleet KPIs", () => {
  const f = parseFilters({}, NOW);
  const totals = {
    punctual: P(6, 4), late: P(3, 1), very_late: P(1, 1), late_sec: P(4 * 1800, 1800), delta_sec: P(600, 3000), wait_sec: P(5400, 0), wait_n: P(4, 0), load_sec: P(2400, 2400), load_n: P(4, 4),
    stop_sec: P(900, 600), stop_n: P(3, 2), parcel_sec: P(3600, 0), parcel_n: P(3, 0), job_sec: P(7200, 3600), job_n: P(2, 1), radius_m: P(12_500, null), route_m: P(null, null),
    declined: P(2, 1), timedout: P(3, 1), offered: P(20, 10), resp_sec: P(1200, 600), resp_n: P(10, 4), active_days: P(12, 6), online_days: P(15, 9), online: P(36_000, 18_000), deliv: P(50, 20), jobs: P(10, 5),
    first_att: P(40, 20), complaints: P(2, 1), cod_held: P(7_500, null),
  };
  const by = (k: Array<{ key: string; value: number | null; prev: number | null; unit: string }>, key: string) => k.find((x) => x.key === key)!;
  it("every KPI is the ratio of the sums, in its own unit", () => {
    const k = fleetKpis(totals, f, true, "offices");
    expect(k.map((x) => x.key)).toEqual([...FLEET_OFFICE_KPI_KEYS]);
    expect(by(k, "fl_late").value).toBe(0.4); expect(by(k, "fl_late").prev).toBeCloseTo(2 / 6, 5); expect(by(k, "fl_very_late").value).toBe(0.1); expect(by(k, "fl_very_late").prev).toBeCloseTo(1 / 6, 5);
    expect(by(k, "fl_late_avg").value).toBe(1800); expect(by(k, "fl_arrival_delta").value).toBe(1); expect(by(k, "fl_arrival_delta").prev).toBeCloseTo(50 / 6, 5); // 600 s ÷ 10 jobs ÷ 60 = 1 min
    expect(by(k, "fl_wait")).toMatchObject({ value: 1350, prev: null }); expect(by(k, "fl_load").value).toBe(600); expect(by(k, "fl_stop_time")).toMatchObject({ value: 300, prev: 300 });
    expect(by(k, "fl_parcel_time").value).toBe(1200); expect(by(k, "fl_job_time")).toMatchObject({ value: 3600, prev: 3600 });
    expect(by(k, "fl_radius")).toMatchObject({ value: 12.5, prev: null, unit: "rate" }); expect(by(k, "fl_route")).toMatchObject({ value: null, prev: null }); // no planned route: no data, never 0 km
    expect(by(k, "fl_decline_rate").value).toBe(0.25); expect(by(k, "fl_timeout_rate").value).toBe(0.15); expect(by(k, "fl_resp_avg")).toMatchObject({ value: 120, prev: 150 });
    expect(by(k, "fl_active_days").value).toBe(12); expect(by(k, "fl_online_days").value).toBe(15); expect(by(k, "fl_efficiency").value).toBe(5); // 50 parcels ÷ 10 online hours
    expect(by(k, "fl_parcels_per_job").value).toBe(5); expect(by(k, "first_attempt")).toMatchObject({ value: 0.8, prev: 1 }); expect(by(k, "fl_complaints")).toMatchObject({ value: 2, prev: 1 });
    expect(by(k, "fl_cod_held")).toMatchObject({ value: 7500, prev: null });
  });
  it("money is dropped without finance access, the Drivers report has the cash KPI already, a missing base is no data", () => {
    expect(fleetKpis(totals, f, false, "offices").map((x) => x.key)).not.toContain("fl_cod_held");
    expect(fleetKpis(totals, f, true, "drivers").map((x) => x.key)).toEqual([...FLEET_DRIVER_KPI_KEYS]); expect(FLEET_DRIVER_KPI_KEYS).not.toContain("fl_cod_held");
    const none = fleetKpis({}, f, true, "drivers");
    for (const key of ["fl_late", "fl_late_avg", "fl_wait", "fl_decline_rate", "fl_resp_avg", "fl_efficiency", "first_attempt", "fl_radius"]) expect(by(none, key).value, key).toBeNull();
    for (const key of ["fl_active_days", "fl_online_days", "fl_complaints"]) expect(by(none, key).value, key).toBe(0);
  });
  it("online and efficiency KPIs say which order filters cannot narrow them", () => {
    const k = fleetKpis(totals, parseFilters({ company: "0b8f3d3e-7b53-4c36-9f0c-6a8f0d2a7a11", driver: "0b8f3d3e-7b53-4c36-9f0c-6a8f0d2a7a12" }, NOW), true, "drivers") as Array<{ key: string; unfiltered?: string[] }>;
    expect(k.find((x) => x.key === "fl_online_days")?.unfiltered).toEqual(["company"]); expect(k.find((x) => x.key === "fl_efficiency")?.unfiltered).toEqual(["company"]);
    expect(k.find((x) => x.key === "fl_late")?.unfiltered).toBeUndefined();
  });
  it("registered once, ratios say what they divide, no clash with another report", () => {
    expect(kpiConflicts()).toEqual([]);
    const mine = allKpiDefs().filter((d) => d.label.startsWith("fr."));
    expect(mine).toHaveLength(20);
    for (const d of mine) {
      expect(d.label).toBe(`fr.kpi_${d.key}`); expect(d.definition).toBe(`fr.def_${d.key}`);
      if (d.unit === "percent" || d.numerator) { expect(d.numerator).toBe(`fr.def_${d.key}_n`); expect(d.denominator).toBe(`fr.def_${d.key}_d`); }
      for (const key of [d.label, d.definition, d.numerator, d.denominator].filter(Boolean) as string[]) { expect(en[key], `en ${key}`).toBeTruthy(); expect(ar[key], `ar ${key}`).toBeTruthy(); expect(ur[key], `ur ${key}`).toBeTruthy(); }
    }
    expect(mine.find((d) => d.key === "fl_cod_held")?.money).toBe(true);
  });
});

describe("notes", () => {
  const f = parseFilters({ from: "2026-05-10", to: "2026-05-12", city: "riyadh" }, NOW);
  const keys = (n: Array<{ key: string }>) => n.map((x) => x.key);
  it("state the period, the comparison, who is counted, the anchors, the distance definitions and the honest gaps", () => {
    const n = fleetNotes("offices", f, { grace: 30 });
    expect(n[0]).toEqual({ key: "fr.note_period", vars: { from: "2026-05-10", to: "2026-05-12", days: 3 } }); expect(n[1]).toMatchObject({ key: "fr.note_compare" });
    expect(keys(n)).toEqual(expect.arrayContaining(["fr.note_filters_online", "fr.note_pop_offices", "fr.note_pop_independent", "fr.note_pop_attribution", "fr.note_anchor_punctuality_g", "fr.note_radius", "fr.note_route", "fr.note_gps",
      "fr.note_money", "fr.note_cod", "fr.note_gap_warehouse", "fr.note_gap_route", "fr.note_gap_gps", "fr.note_gap_fines", "fr.note_gap_promise"]));
    expect(n.find((x) => x.key === "fr.note_anchor_punctuality_g")?.vars).toEqual({ grace: 30 });
    expect(keys(fleetNotes("drivers", parseFilters({ compare: "none" }, NOW))).slice(0, 2)).toEqual(["fr.note_period", "fr.note_pop_drivers"]);
  });
  it("only the lines of the exported tables; the money lines only for finance viewers; an office selection drops the independent row", () => {
    const failures = keys(fleetNotes({ report: "drivers", tables: ["failures"], money: false }, f));
    expect(failures).toContain("fr.note_failures"); expect(failures).not.toContain("fr.note_money"); expect(failures).not.toContain("fr.note_radius");
    expect(keys(fleetNotes({ report: "offices", tables: ["perf"], money: false }, parseFilters({ office: "0b8f3d3e-7b53-4c36-9f0c-6a8f0d2a7a11", compare: "none" }, NOW)))).toContain("fr.note_pop_selected");
    expect(keys(fleetNotes({ report: "drivers", tables: ["daily"] }, f))).toContain("fr.note_daily");
    expect(keys(fleetNotes("drivers", f))).toContain("fr.note_anchor_punctuality"); // without the grace setting the line names no number
  });
  it("every note key exists in en, ar and ur with the same placeholders, and the vars cover them", () => {
    for (const set of [{ report: "drivers" as const }, { report: "offices" as const }]) {
      for (const n of fleetNotes(set, f, { grace: 20 })) {
        for (const d of [en, ar, ur]) expect(d[n.key], n.key).toBeTruthy();
        expect(placeholders(ar[n.key]), n.key).toBe(placeholders(en[n.key])); expect(placeholders(ur[n.key]), n.key).toBe(placeholders(en[n.key]));
        expect(Object.keys(n.vars ?? {}).sort().join(","), n.key).toBe([...new Set(placeholders(en[n.key]).split(",").filter(Boolean))].join(","));
      }
    }
  });
});

describe("translations of the tables", () => {
  const tables = () => listTables().filter((t) => t.report === "drivers" || t.report === "offices").filter((t) => t.title.startsWith("fr."));
  it("the 14 tables are registered", () => {
    expect(tables().map((t) => `${t.report}/${t.name}`).sort()).toEqual([
      "drivers/daily", "drivers/failures", "drivers/jobs", "drivers/money", "drivers/money_daily", "drivers/perf", "drivers/perf_daily",
      "offices/daily", "offices/earnings", "offices/failures", "offices/jobs", "offices/money", "offices/money_daily", "offices/perf"]);
  });
  it("every title, column label and column help exists in en, ar and ur; enums have a dictionary; every sort has a column; money tables need finance.view", () => {
    for (const t of tables()) {
      for (const k of [t.title, ...t.columns.map((c) => c.label), ...t.columns.map((c) => c.label.replace("fr.col_", "fr.help_"))]) { expect(en[k], `en ${k}`).toBeTruthy(); expect(ar[k], `ar ${k}`).toBeTruthy(); expect(ur[k], `ur ${k}`).toBeTruthy(); }
      for (const c of t.columns.filter((c) => c.ns)) expect(Object.keys(en).some((k) => k.startsWith(`${c.ns}.`)), `${t.report}/${t.name}.${c.key} (${c.ns})`).toBe(true);
      for (const key of Object.keys(t.sorts)) expect(t.columns.some((c) => c.key === key), `${t.report}/${t.name} sort ${key}`).toBe(true);
      expect(t.sorts[t.defaultSort.key], `${t.report}/${t.name} default sort`).toBeTruthy();
      if (t.name.startsWith("money") || t.name === "earnings") expect(t.needs, `${t.report}/${t.name}`).toEqual(["finance.view"]);
      for (const m of t.moneyKeys ?? []) expect(t.columns.some((c) => c.key === m), `${t.report}/${t.name} money ${m}`).toBe(true);
    }
  });
  it("every metric has a label and a help sentence, and the help sentences are not copies of each other", () => {
    for (const m of METRICS) for (const k of [`fr.col_${m.key}`, `fr.help_${m.key}`]) { expect(en[k], k).toBeTruthy(); expect(ar[k], k).toBeTruthy(); expect(ur[k], k).toBeTruthy(); }
    const helps = METRICS.filter((m) => !m.key.startsWith("stars")).map((m) => en[`fr.help_${m.key}`]);
    expect(new Set(helps).size).toBe(helps.length);
    for (const k of Object.keys(en).filter((x) => x.startsWith("fr.col_") || x.startsWith("fr.help_"))) { expect(/[؀-ۿ]/.test(ar[k]), `ar ${k}`).toBe(true); expect(/[؀-ۿ]/.test(ur[k]), `ur ${k}`).toBe(true); }
  });
});
