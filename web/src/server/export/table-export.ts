import { getSettings } from "../settings";
import type { DrillColumn } from "../analytics/registry";
import type { ResolvedFilters } from "../analytics/filters";
import type { MultiKey } from "../analytics/keys";
import type { Tr } from "./context";
import { drillSheet, typesOf } from "./drill-sheet";
import { noteLines, type NoteScope } from "./notes";
import { notesSheet } from "./notes-sheet";
import { buildXlsx, XLSX_MIME } from "./xlsx";

export { XLSX_MIME };
type Row = Record<string, unknown>;

export interface TableExport {
  tr: Tr;
  /** `drivers`, `offices` … or `portal-office`. */
  report: string;
  table: string;
  /** i18n key of the table title (`DrillDef.title`). */
  titleKey: string;
  /** The columns the viewer may see (money already removed) and their rows. */
  columns: DrillColumn[];
  rows: Row[];
  truncated: boolean;
  max: number;
  filters: ResolvedFilters;
  skipFilters?: readonly MultiKey[];
  moneyHidden?: boolean;
}

/** `format=xlsx` of one registered table: the data sheet (localized, typed) followed by the Notes sheet. */
export async function tableXlsx(a: TableExport): Promise<Buffer> {
  const { tr } = a;
  const settings = await getSettings();
  const cities = new Map(settings.cities.map((c) => [c.key, c[tr.locale] || c.en]));
  const title = tr(a.titleKey);
  const data = drillSheet(tr, { name: title, columns: a.columns, rows: a.rows, cityName: (k) => cities.get(k) });
  const scope: NoteScope = { report: a.report, table: a.table, tables: [a.table], filters: a.filters, grace: settings.lateGraceMin, skipPeriod: true, types: typesOf(a.columns, a.rows), moneyHidden: a.moneyHidden };
  const reportKey = `fr.xl_report_${a.report.replace("portal-", "portal_")}`;
  const notes = await notesSheet({
    tr, title, filters: a.filters, skipFilters: a.skipFilters, max: a.max,
    facts: [[tr("fr.xl_report"), tr.has(reportKey) ? tr(reportKey) : a.report], [tr("fr.xl_table"), title]],
    rowCounts: [{ sheet: data.name, rows: a.rows.length, truncated: a.truncated }], howTo: noteLines(tr, scope),
  });
  return buildXlsx({ sheets: [data, notes] });
}
