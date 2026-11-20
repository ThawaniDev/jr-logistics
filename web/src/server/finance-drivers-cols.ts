import type { DrillColumn } from "./analytics/registry";
import { FD_COLS, FD_GROUPS, type ColGroup } from "./finance-drivers-lib";

/**
 * The columns of every Finance › Drivers export (CSV keys and Excel headers come from here; `label` is an i18n key). Signed amounts are exported as two non-negative columns
 * (in / out, credit / debit) because the CSV writer protects a leading `-` against spreadsheet formulas, which would turn every negative number into text.
 */
const col = (key: string, label: string, type: DrillColumn["type"] = "text", extra: Partial<DrillColumn> = {}): DrillColumn => ({ key, label, type, ...extra });

export const DRIVERS_TABLE = "drivers";
export const DETAIL_TABLES = ["statement", "settlements", "ledger", "withdrawals", "cash"] as const;
export type DetailTable = (typeof DETAIL_TABLES)[number];

/** Header i18n key of a list column (`fdr.col_<key>`). */
export const colLabel = (key: string) => `fdr.col_${key}`;
export const GROUP_LABEL: Record<ColGroup, string> = Object.fromEntries(FD_GROUPS.map((g) => [g, `fdr.grp_${g}`])) as Record<ColGroup, string>;

/** The list as a table: every catalogue column (plus the office flag, which says why a wallet column is empty). */
export function listColumns(): DrillColumn[] {
  const out: DrillColumn[] = [];
  for (const c of FD_COLS) {
    out.push(col(c.key, colLabel(c.key), c.kind === "money" ? "money" : c.kind === "int" ? "number" : c.kind === "date" ? "date" : c.kind === "enum" ? "enum" : "text", c.ns ? { ns: c.ns } : {}));
    if (c.key === "officeName") out.push(col("paidViaOffice", colLabel("paidViaOffice")));
  }
  return out;
}

const COLUMNS: Record<DetailTable, DrillColumn[]> = {
  statement: [
    col("at", "fdr.c_date", "datetime"), col("source", "fdr.c_source", "enum", { ns: "fdr_src" }), col("typeLabel", "fdr.c_type"), col("ref", "fdr.c_order"), col("note", "fdr.c_note"),
    col("inCents", "fdr.c_in", "money"), col("outCents", "fdr.c_out", "money"), col("balanceCents", "fdr.c_balance", "money"),
  ],
  settlements: [
    col("createdAt", "fdr.c_date", "datetime"), col("ref", "fdr.c_order"), col("business", "fdr.c_company"), col("finalUnits", "fdr.c_units", "number"),
    col("earnedCents", "fdr.c_earned", "money"), col("adjustmentCents", "fdr.c_adjustment", "money"), col("refundCents", "fdr.c_refund", "money"),
    col("status", "fdr.c_status", "enum", { ns: "status" }), col("payeeOffice", "fdr.c_payee"), col("paidAt", "fdr.c_paid_on", "datetime"), col("batch", "fdr.c_batch"),
  ],
  ledger: [
    col("createdAt", "fdr.c_date", "datetime"), col("kind", "fdr.c_type", "enum", { ns: "ledger" }), col("creditCents", "fdr.c_credit", "money"), col("debitCents", "fdr.c_debit", "money"),
    col("balanceCents", "fdr.c_balance", "money"), col("ref", "fdr.c_order"), col("note", "fdr.c_note"), col("actor", "fdr.c_by"),
  ],
  withdrawals: [
    col("createdAt", "fdr.c_requested", "datetime"), col("amountCents", "fdr.c_amount", "money"), col("status", "fdr.c_status", "enum", { ns: "status" }), col("bank", "fdr.c_bank"), col("ibanTail", "fdr.c_iban_tail"),
    col("paymentRef", "fdr.c_payment_ref"), col("note", "fdr.c_note"), col("decidedAt", "fdr.c_decided", "datetime"), col("decidedBy", "fdr.c_by"),
  ],
  cash: [
    col("lastCollectedAt", "fdr.c_last_collected", "datetime"), col("ref", "fdr.c_order"), col("business", "fdr.c_company"), col("warehouse", "fdr.c_warehouse"), col("warehouseCity", "fdr.c_city", "enum", { ns: "city" }),
    col("officeName", "fdr.c_office"), col("parcels", "fdr.c_parcels", "number"), col("collectedCents", "fdr.c_collected", "money"), col("remittedCents", "fdr.c_remitted", "money"), col("outstandingCents", "fdr.c_outstanding", "money"),
  ],
};
export const tableColumns = (t: DetailTable): DrillColumn[] => COLUMNS[t];
export const TITLE: Record<DetailTable | "drivers", string> = {
  drivers: "fdr.title", statement: "fdr.tab_statement", settlements: "fdr.tab_settlements", ledger: "fdr.tab_ledger", withdrawals: "fdr.tab_withdrawals", cash: "fdr.tab_cash",
};
