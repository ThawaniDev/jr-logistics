import { describeFilters, riyadhStamp, type Tr } from "./context";
import type { ResolvedFilters } from "../analytics/filters";
import type { MultiKey } from "../analytics/keys";
import type { TextLine, TextSheet } from "./xlsx";

export interface NotesInput {
  tr: Tr;
  /** Title row: the report (and table) name. */
  title: string;
  /** Label/value rows after the title (`Report`, `Table`, `Courier office` …). */
  facts: Array<[label: string, value: string]>;
  filters: ResolvedFilters;
  skipFilters?: readonly MultiKey[];
  /** Rows exported per sheet: one entry for a table export, one per sheet for a workbook (the Summary has none). */
  rowCounts: Array<{ sheet: string; rows: number; truncated: boolean }>;
  /** A workbook lists the rows of every sheet and names the sheet that was cut; a single table export just says how many rows. */
  workbook?: boolean;
  max: number;
  /** The "how to read this" lines (already localized). */
  howTo: string[];
  /** Extra warnings (a sheet that was left out). */
  warnings?: string[];
}

/** The Notes sheet: what was exported, for which period and filters, when, how many rows (with a truncation warning), then how to read it (Thawani's "notes" block). */
export async function notesSheet(i: NotesInput): Promise<TextSheet> {
  const { tr } = i;
  const d = await describeFilters(i.filters, tr, i.skipFilters);
  const lines: TextLine[] = [{ label: tr("fr.xl_title", { name: i.title }), style: "title" }, {}];
  for (const [label, text] of i.facts) lines.push({ label, text });
  lines.push({ label: tr("fr.xl_period"), text: d.period });
  if (d.compare) lines.push({ label: tr("fr.xl_prev_period"), text: d.compare });
  lines.push({ label: tr("fr.xl_filters"), text: d.filters.length ? d.filters.join("\n") : tr("fr.xl_no_filters") });
  lines.push({ label: tr("fr.xl_generated"), text: riyadhStamp() });
  const counted = i.rowCounts.filter((r) => r.rows >= 0);
  if (!i.workbook && counted.length === 1) lines.push({ label: tr("fr.xl_rows"), text: String(counted[0].rows) });
  else if (counted.length) lines.push({ label: tr("fr.xl_rows"), text: counted.map((r) => `${r.sheet}: ${r.rows}`).join("\n") });
  for (const r of i.rowCounts) if (r.truncated) lines.push({ label: "⚠", text: i.workbook ? tr("fr.xl_sheet_truncated", { sheet: r.sheet, max: i.max }) : tr("fr.xl_truncated", { max: i.max }) });
  for (const w of i.warnings ?? []) lines.push({ label: "⚠", text: w });
  lines.push({}, { label: tr("fr.xl_howto"), style: "heading" });
  i.howTo.forEach((t, n) => lines.push({ label: String(n + 1), text: t }));
  return { name: tr("fr.sheet_notes"), rtl: tr.rtl, lines };
}
