import type { Kpi } from "../analytics/kpi";
import { getSettings } from "../settings";
import type { DrillColumn } from "../analytics/registry";
import type { ResolvedFilters } from "../analytics/filters";
import type { MultiKey } from "../analytics/keys";
import { namesOf, type Tr } from "./context";
import { drillSheet, typesOf } from "./drill-sheet";
import { noteLines, type NoteScope } from "./notes";
import { notesSheet } from "./notes-sheet";
import { buildXlsx, type SheetSpec, type TableSheet, type XlType } from "./xlsx";

type Row = Record<string, unknown>;
export const MAX_DAILY_BY_DRIVER_ROWS = 20_000; // Thawani's cap on the day-by-day block (delegates x days)
export const MAX_DAILY_BY_DRIVER_DRIVERS = 120; // each driver is one query: keeps the export bounded
export const MAX_SHEET_ROWS = 50_000;

/** One registered table as the workbook sees it: the columns the viewer may read and a way to read every row (optionally for a single driver). */
export interface TableHandle {
  title: string;
  columns: DrillColumn[];
  fetch(driverId?: string): Promise<{ rows: Row[]; truncated: boolean }>;
}
/** Where the tables come from (admin registry or office portal registry). `report` is only meaningful for the admin registry. */
export interface TableSource { table(report: string, name: string): TableHandle | undefined }
export type EntityKind = "office" | "driver";

/** The sheets of an entity workbook after the Summary, in order: sheet title key, table name, and the admin report each table is read from. */
const PLAN: Array<{ sheet: string; name: string; report: Record<EntityKind, string | null> }> = [
  { sheet: "fr.sheet_daily", name: "daily", report: { office: "offices", driver: "drivers" } },
  { sheet: "fr.sheet_drivers", name: "perf", report: { office: "drivers", driver: null } },
  { sheet: "fr.sheet_money", name: "money", report: { office: "offices", driver: "drivers" } },
  { sheet: "fr.sheet_money_daily", name: "money_daily", report: { office: "offices", driver: "drivers" } },
  { sheet: "fr.sheet_jobs", name: "jobs", report: { office: "offices", driver: "drivers" } },
  { sheet: "fr.sheet_earnings", name: "earnings", report: { office: "offices", driver: null } },
  { sheet: "fr.sheet_failures", name: "failures", report: { office: "offices", driver: "drivers" } },
];

const UNIT: Record<string, { value: XlType; change: XlType }> = {
  count: { value: "int", change: "dint" }, money: { value: "money", change: "dmoney" }, percent: { value: "percent", change: "dpercent" },
  duration: { value: "duration", change: "dint" }, rate: { value: "number", change: "dnumber" },
};
/** The Summary sheet: every KPI of the entity with current / previous / change, its name and definition in the viewer's language. */
export function summarySheet(tr: Tr, kpis: Kpi[], name: string): TableSheet {
  const rows = kpis.map((k) => {
    const u = UNIT[k.unit] ?? UNIT.rate;
    return {
      label: tr(k.label), value: k.value, prev: k.prev, delta: k.delta, deltaPct: k.deltaPct, unit: u.value, dunit: u.change, definition: tr(k.definition),
      note: k.unfiltered?.length ? tr("rpf.not_filtered_by", { filters: k.unfiltered.map((x) => tr(`rpf.f_${x}`)).join(", ") }) : "",
    };
  });
  return {
    name, rtl: tr.rtl, rows, freezeHeader: true,
    columns: [
      { header: tr("fr.xl_kpi"), key: "label", type: "text", width: 34 },
      { header: tr("fr.xl_current"), key: "value", type: "number", typeKey: "unit", width: 16 },
      { header: tr("fr.xl_previous"), key: "prev", type: "number", typeKey: "unit", width: 16 },
      { header: tr("fr.xl_change"), key: "delta", type: "dnumber", typeKey: "dunit", width: 14 },
      { header: tr("fr.xl_change_pct"), key: "deltaPct", type: "dpercent", width: 12 },
      { header: tr("fr.xl_definition"), key: "definition", type: "text", width: 70 },
      { header: tr("fr.xl_note"), key: "note", type: "text", width: 30 },
    ],
  };
}

export interface WorkbookInput {
  tr: Tr;
  source: TableSource;
  kind: EntityKind;
  /** `drivers` / `offices` for the notes scope, or `portal-office`. */
  report: string;
  summary: Kpi[];
  filters: ResolvedFilters;
  skipFilters?: readonly MultiKey[];
  /** Title of the Notes sheet (the office or driver name). */
  title: string;
  /** Label/value rows of the Notes sheet (the office or driver name). */
  facts: Array<[string, string]>;
  moneyHidden: boolean;
  /** Admin: the `drivers` report holds the per-driver tables; the portal reads `perf` / `daily` from its own registry. */
  dailyReport: string;
}

/** Builds the workbook: Summary, then the tables that exist (in the contract order), Daily by driver (offices, when small enough), Notes. Missing tables are skipped, never an error. */
export async function assembleWorkbook(w: WorkbookInput): Promise<{ file: Buffer; sheets: string[]; truncated: boolean }> {
  const { tr } = w;
  const plan = PLAN.map((p) => ({ ...p, handle: p.report[w.kind] ? w.source.table(p.report[w.kind]!, p.name) : undefined })).filter((p) => p.handle);
  const fetched = await Promise.all(plan.map((p) => p.handle!.fetch()));
  const sheets: SheetSpec[] = [summarySheet(tr, w.summary, tr("fr.sheet_summary"))];
  const counts: Array<{ sheet: string; rows: number; truncated: boolean }> = [];
  const types = new Set<XlType>(w.summary.map((k) => (UNIT[k.unit] ?? UNIT.rate).value));
  const warnings: string[] = [];
  const add = (s: TableSheet, truncated: boolean) => { sheets.push(s); counts.push({ sheet: s.name, rows: s.rows.length, truncated }); };
  for (const [i, p] of plan.entries()) {
    const { rows, truncated } = fetched[i];
    const h = p.handle!;
    add(drillSheet(tr, { name: tr(p.sheet), columns: h.columns, rows }), truncated);
    typesOf(h.columns, rows).forEach((t) => types.add(t));
    if (p.name === "perf" && w.kind === "office") {
      const extra = await dailyByDriver(w, rows);
      if (extra.warning) warnings.push(extra.warning);
      if (extra.sheet) add(extra.sheet, false);
    }
  }
  const scope: NoteScope = {
    report: w.report, workbook: w.kind, tables: plan.map((p) => p.name), filters: w.filters, grace: (await getSettings()).lateGraceMin, skipPeriod: true, types, moneyHidden: w.moneyHidden, summary: true,
  };
  const notes = await notesSheet({
    tr, title: w.title, filters: w.filters, skipFilters: w.skipFilters, max: MAX_SHEET_ROWS, warnings,
    facts: [...w.facts, [tr("fr.xl_sheets"), sheets.map((s) => s.name).concat(tr("fr.sheet_notes")).join(", ")]],
    rowCounts: counts, workbook: true, howTo: noteLines(tr, scope),
  });
  return { file: buildXlsx({ sheets: [...sheets, notes] }), sheets: [...sheets.map((s) => s.name), notes.name], truncated: counts.some((c) => c.truncated) };
}

/** Thawani's "day by day, per delegate" block: one daily table per driver of the office, stacked. Only when drivers x days stays within the limits. */
async function dailyByDriver(w: WorkbookInput, perfRows: Row[]): Promise<{ sheet?: TableSheet; warning?: string }> {
  const daily = w.source.table(w.dailyReport, "daily");
  const ids = perfRows.map((r) => (typeof r.id === "string" ? r.id : null)).filter((x): x is string => !!x);
  if (!daily || !ids.length) return {};
  const days = w.filters.cur.days, total = ids.length * days;
  if (total > MAX_DAILY_BY_DRIVER_ROWS || ids.length > MAX_DAILY_BY_DRIVER_DRIVERS) {
    return { warning: w.tr("fr.xl_omitted_daily_by_driver", { drivers: ids.length, days, rows: total, max: MAX_DAILY_BY_DRIVER_ROWS, maxDrivers: MAX_DAILY_BY_DRIVER_DRIVERS }) };
  }
  const names = await namesOf("driver", ids);
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += 4) {
    const batch = await Promise.all(ids.slice(i, i + 4).map((id) => daily.fetch(id)));
    batch.forEach((b, j) => b.rows.forEach((r) => rows.push({ ...r, _driver: names.get(ids[i + j]) ?? ids[i + j] })));
  }
  const sheet = drillSheet(w.tr, { name: w.tr("fr.sheet_daily_by_driver"), columns: [{ key: "_driver", label: "rpp.col_driver", type: "text" }, ...daily.columns], rows });
  return { sheet };
}
