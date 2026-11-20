import type { User } from "@/db/schema";
import { err } from "@/lib/errors";
import { audit } from "./audit";
import { requirePerm } from "./auth/permissions";
import { MAX_CSV_ROWS, pageAll, type DrillColumn } from "./analytics/registry";
import { localeOf, riyadhStamp, translator, type Tr } from "./export/context";
import { drillSheet } from "./export/drill-sheet";
import { buildXlsx, XLSX_MIME, type SheetSpec, type TableSheet, type TextSheet } from "./export/xlsx";
import { toCsv } from "./ops";
import { statementTypeKey, type Period } from "./finance-drivers-lib";
import { TITLE, type DetailTable } from "./finance-drivers-cols";

/**
 * Exports of Finance › Drivers (`format=csv|xlsx`): permission, localization, the Notes sheet and the audit row live here. CSV = raw keys, UTF-8 with BOM, formula-safe (`toCsv`);
 * Excel = localized headers, real number formats, a totals row on the list, then a Notes sheet. Needs `finance.view` AND `reports.export`; audited as `report.export`.
 */
type Row = Record<string, unknown>;
export type ExportFormat = "csv" | "xlsx";
export const formatOf = (query: URLSearchParams): ExportFormat | null => {
  const f = query.get("format");
  if (!f || f === "json") return null;
  if (f === "csv" || f === "xlsx") return f;
  throw err("VALIDATION", "format must be json, csv or xlsx", { field: "format" });
};
/** Refuse before any query runs: `finance.view` + `reports.export`, and a valid `lang` for Excel. */
export function exportGuard(user: User, query: URLSearchParams, format: ExportFormat): Tr | null {
  requirePerm(user, "finance.view");
  requirePerm(user, "reports.export");
  return format === "xlsx" ? translator(localeOf(query, user)) : null;
}
export { pageAll, MAX_CSV_ROWS };

const stamp = (p: Period) => (p.mode === "all" ? "all" : `${p.from}_${p.to}`);
export const periodText = (tr: Tr, p: Period) => (p.mode === "all" ? tr("fdr.period_all") : tr("fdr.period_value", { from: p.from ?? "", to: p.to ?? "", days: p.days ?? 0 }));

/** Statement rows get a readable type (`Payout`, `Cash collected` …) in the viewer's language. */
export function withTypeLabels(tr: Tr, rows: Row[]): Row[] {
  return rows.map((r) => {
    const base = tr(statementTypeKey(String(r.source), String(r.kind)));
    const status = r.source === "settlement" && tr.has(`status.${r.kind}`) ? tr(`status.${r.kind}`) : "";
    return { ...r, typeLabel: status ? `${base} · ${status}` : base };
  });
}
/** The list's officeName / paidViaOffice cells in words (an independent driver, a wallet that is paid through his office). */
export function withListWords(tr: Tr, rows: Row[]): Row[] {
  return rows.map((r) => ({ ...r, officeName: r.officeName ?? tr("fdr.independent"), paidViaOffice: r.paidViaOffice ? tr("fdr.yes") : tr("fdr.no") }));
}

export interface ExportJob {
  user: User; format: ExportFormat; tr: Tr | null;
  /** `finance/drivers` for the list, `finance/drivers/<id>/<table>` for a detail table: the audit entity id. */
  scope: string; table: DetailTable | "drivers";
  columns: DrillColumn[]; rows: Row[]; totals?: Row | null; truncated: boolean; period: Period;
  /** Label / value lines of the Notes sheet (driver, filters …) and the "how to read this" lines. */
  facts: Array<[string, string]>; howTo: string[];
  /** Extra detail for the audit row (filters). */
  detail?: Record<string, unknown>;
}

export function notesSheet(tr: Tr, o: { title: string; facts: Array<[string, string]>; period: Period; rows: number; truncated: boolean; howTo: string[] }): TextSheet {
  const lines: TextSheet["lines"] = [{ label: tr("fr.xl_title", { name: o.title }), style: "title" }, {}];
  for (const [label, text] of o.facts) lines.push({ label, text });
  lines.push({ label: tr("fr.xl_period"), text: periodText(tr, o.period) }, { label: tr("fr.xl_generated"), text: riyadhStamp() }, { label: tr("fr.xl_rows"), text: String(o.rows) });
  if (o.truncated) lines.push({ label: "⚠", text: tr("fr.xl_truncated", { max: MAX_CSV_ROWS }) });
  lines.push({}, { label: tr("fr.xl_howto"), style: "heading" });
  o.howTo.forEach((t, n) => lines.push({ label: String(n + 1), text: t }));
  return { name: tr("fr.sheet_notes"), rtl: tr.rtl, lines };
}
export const howToLines = (tr: Tr, keys: string[]) => keys.map((k) => tr(k));

/** The sheet of one table: localized headers, typed cells, optionally a closing totals row. */
export function dataSheet(tr: Tr, name: string, columns: DrillColumn[], rows: Row[], totals?: Row | null): TableSheet {
  const sheet = drillSheet(tr, { name, columns, rows: totals ? [...rows, totals] : rows });
  return sheet;
}

export async function respond(j: ExportJob): Promise<Response> {
  await audit(j.user, "report.export", "report", j.scope, { rows: j.rows.length, truncated: j.truncated, format: j.format, table: j.table, period: j.period.mode === "all" ? "all" : { from: j.period.from, to: j.period.to }, ...(j.detail ?? {}) });
  const name = `${j.scope.replace(/\//g, "-")}-${stamp(j.period)}`;
  const no = { "cache-control": "no-store" };
  if (j.format === "csv") {
    const body = toCsv(j.columns.map((c) => (c.key === "typeLabel" ? "kind" : c.key)), j.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === "object" ? JSON.stringify(v) : v]))));
    return new Response("﻿" + body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, ...no } });
  }
  const tr = j.tr!;
  const title = tr(TITLE[j.table]);
  const sheets: SheetSpec[] = [dataSheet(tr, title, j.columns, j.rows, j.totals), notesSheet(tr, { title, facts: j.facts, period: j.period, rows: j.rows.length, truncated: j.truncated, howTo: j.howTo })];
  return new Response(new Uint8Array(buildXlsx({ sheets })), { headers: { "content-type": XLSX_MIME, "content-disposition": `attachment; filename="${name}.xlsx"`, ...no } });
}
