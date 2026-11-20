import type { User } from "@/db/schema";
import { err } from "@/lib/errors";
import { audit } from "./audit";
import { can } from "./auth/permissions";
import type { Tr } from "./export/context";
import { buildXlsx, XLSX_MIME, type SheetSpec, type TableSheet } from "./export/xlsx";
import { tableColumns, colLabel, type DetailTable } from "./finance-drivers-cols";
import { dataSheet, exportGuard, howToLines, notesSheet, pageAll, withTypeLabels } from "./finance-drivers-export";
import { FD_COLS, LEDGER_KINDS, resolvePeriod, shapeRow, type Period } from "./finance-drivers-lib";
import { listDriverRecords } from "./finance-drivers-sql";
import { statementTable } from "./finance-drivers-statement";
import { cashTable, ledgerTable, settlementsTable, withdrawalsTable, type TablePage, type TableQuery } from "./finance-drivers-tables";

/**
 * "Download full statement (.xlsx)": ONE workbook for one driver — Summary (every figure of the list row, labelled and typed), then the Statement and one sheet per table (Settlements, Wallet
 * ledger, Withdrawals, Cash on delivery), then Notes. Localized (`lang` / the viewer's language), right to left for Arabic and Urdu; each sheet is capped like every export (50 000 rows).
 * Needs `finance.view` + `reports.export`; audited once as `report.export` with `{ workbook: "driver_statement", id }`.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO = { q: "", office: "", city: "", status: "", hasCash: false, hasPending: false };
const SHEETS: Array<[DetailTable, string, (q: TableQuery) => Promise<TablePage>]> = [
  ["statement", "fdr.tab_statement", statementTable], ["settlements", "fdr.tab_settlements", settlementsTable],
  ["ledger", "fdr.tab_ledger", (q) => ledgerTable(q, LEDGER_KINDS)], ["withdrawals", "fdr.tab_withdrawals", withdrawalsTable], ["cash", "fdr.tab_cash", cashTable],
];

/** The Summary sheet: one line per figure, the value typed per line (money, count, date or text). */
function summarySheet(tr: Tr, row: Record<string, unknown>): TableSheet {
  const rows = FD_COLS.filter((c) => c.ui !== false || c.kind === "int").map((c) => {
    const v = row[c.key];
    if (c.group === "wallet" && v == null) return { item: tr(colLabel(c.key)), value: tr("fdr.paid_via_office"), unit: "text" };
    if (c.key === "officeName") return { item: tr(colLabel(c.key)), value: v ?? tr("fdr.independent"), unit: "text" };
    if (c.kind === "enum") return { item: tr(colLabel(c.key)), value: v == null ? null : tr.has(`${c.ns}.${v}`) ? tr(`${c.ns}.${v}`) : String(v), unit: "text" };
    return { item: tr(colLabel(c.key)), value: v, unit: c.kind === "money" ? "money" : c.kind === "int" ? "int" : c.kind === "date" ? "date" : "text" };
  });
  return { name: tr("fr.sheet_summary"), rtl: tr.rtl, freezeHeader: true, rows, columns: [{ header: tr("fdr.xl_item"), key: "item", type: "text", width: 36 }, { header: tr("fdr.xl_value"), key: "value", type: "text", typeKey: "unit", width: 28 }] };
}

export async function financeDriverWorkbook(user: User, id: string, query: URLSearchParams): Promise<Response> {
  const tr = exportGuard(user, query, "xlsx")!;
  const period: Period = resolvePeriod(query);
  if (!UUID.test(id)) throw err("NOT_FOUND", "Driver not found");
  const [rec] = await listDriverRecords(NO, period, { key: "earnedCents", dir: "desc" }, 1, 0, { id });
  if (!rec) throw err("NOT_FOUND", "Driver not found");
  const row = shapeRow(rec, can(user, "drivers.sensitive"));
  const parts = await Promise.all(SHEETS.map(async ([name, title, fetch]) => {
    const all = await pageAll(async (limit, offset) => (await fetch({ id, period, status: "", kind: "", limit, offset })).rows);
    return { name, title, ...all, rows: name === "statement" ? withTypeLabels(tr, all.rows) : all.rows };
  }));
  const counted = parts.map((p) => ({ sheet: tr(p.title), rows: p.rows.length }));
  const sheets: SheetSpec[] = [summarySheet(tr, row), ...parts.map((p) => dataSheet(tr, tr(p.title), tableColumns(p.name), p.rows))];
  const total = parts.reduce((n, p) => n + p.rows.length, 0), truncated = parts.some((p) => p.truncated);
  sheets.push(notesSheet(tr, {
    title: String(row.name), period, rows: total, truncated,
    facts: [[tr("fr.xl_report"), tr("fdr.workbook_title")], [tr("fdr.f_driver"), `${row.name}${row.username ? ` (${row.username})` : ""}`], [tr("fdr.f_office"), (row.officeName as string | null) ?? tr("fdr.independent")], [tr("fr.xl_rows"), counted.map((c) => `${c.sheet}: ${c.rows}`).join("\n")]],
    howTo: howToLines(tr, ["fdr.note_money", "fdr.note_wallet", "fdr.note_earned", "fdr.note_cash", "fdr.note_period", "fdr.note_statement", "fdr.note_cash_rows", "fdr.note_ledger", "fdr.note_cash_tab"]),
  }));
  await audit(user, "report.export", "report", `finance/drivers/${id}/workbook`, { workbook: "driver_statement", id, format: "xlsx", rows: total, truncated, sheets: counted, period: period.mode === "all" ? "all" : { from: period.from, to: period.to } });
  const stamp = period.mode === "all" ? "all" : `${period.from}_${period.to}`;
  return new Response(new Uint8Array(buildXlsx({ sheets })), { headers: { "content-type": XLSX_MIME, "content-disposition": `attachment; filename="finance-driver-statement-${stamp}.xlsx"`, "cache-control": "no-store" } });
}
