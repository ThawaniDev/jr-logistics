import type { User } from "@/db/schema";
import { err } from "@/lib/errors";
import { can, requirePerm } from "./auth/permissions";
import { num } from "./analytics/guard";
import type { Tr } from "./export/context";
import { listColumns, tableColumns, type DetailTable, DETAIL_TABLES } from "./finance-drivers-cols";
import { exportGuard, formatOf, howToLines, pageAll, respond, withListWords, withTypeLabels, type ExportFormat } from "./finance-drivers-export";
import {
  FD_DEFAULT_SORT, filtersOf, intParam, LEDGER_KINDS, MAX_PAGE_SIZE, resolvePeriod, shapeRow, shapeTotals, sortOf, STATEMENT_SOURCES, SUMMABLE,
  type FdFilters, type Period, type SortSpec,
} from "./finance-drivers-lib";
import { cityOptions, driverTotals, listDriverRecords, officeOptions } from "./finance-drivers-sql";
import { statementTable } from "./finance-drivers-statement";
import {
  cashTable, ledgerTable, settlementsTable, settlementStatusOk, withdrawalsTable, withdrawalStatusOk, type TablePage, type TableQuery,
} from "./finance-drivers-tables";

/**
 * Finance › Drivers service (J7): the list, one driver's summary and his tables. Every entry needs `finance.view`; `format=csv|xlsx` also needs `reports.export` (audited `report.export`).
 * Phone numbers are masked without `drivers.sensitive`. The routes are in `api/routes/admin-finance-drivers.ts`.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_FILTERS: FdFilters = { q: "", office: "", city: "", status: "", hasCash: false, hasPending: false };
const publicPeriod = (p: Period) => ({ mode: p.mode, from: p.from, to: p.to, days: p.days, isDefault: p.isDefault });

const filterWords = (tr: Tr, f: FdFilters, officeName: string | null): string => {
  const parts = [
    f.q && `${tr("fdr.f_search")}: ${f.q}`, f.office && `${tr("fdr.f_office")}: ${f.office === "independent" ? tr("fdr.independent") : (officeName ?? f.office)}`,
    f.city && `${tr("fdr.f_city")}: ${tr.has(`city.${f.city}`) ? tr(`city.${f.city}`) : f.city}`, f.status && `${tr("fdr.f_status")}: ${tr(`status.${f.status}`)}`,
    f.hasCash && tr("fdr.f_has_cash"), f.hasPending && tr("fdr.f_has_pending"),
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : tr("fr.xl_no_filters");
};

// ───────── the list ─────────
export async function financeDriversList(user: User, query: URLSearchParams): Promise<unknown> {
  requirePerm(user, "finance.view");
  const format = formatOf(query);
  const tr = format ? exportGuard(user, query, format) : null; // refused before any query runs
  const period = resolvePeriod(query), f = filtersOf(query), sort = sortOf(query), sensitive = can(user, "drivers.sensitive");
  if (format) return exportList(user, query, format, tr, { f, period, sort, sensitive });
  const page = intParam(query, "page", 1, 1, 100_000), pageSize = intParam(query, "pageSize", 25, 1, MAX_PAGE_SIZE);
  const [recs, totals, offices, cities] = await Promise.all([listDriverRecords(f, period, sort, pageSize, (page - 1) * pageSize, { phone: sensitive }), driverTotals(f, period, { phone: sensitive }), officeOptions(), cityOptions()]);
  const t = shapeTotals(totals);
  return {
    period: publicPeriod(period), filters: f, sort, page, pageSize, total: t.drivers, rows: recs.map((r) => shapeRow(r, sensitive)), totals: t,
    offices: offices.map((o) => ({ id: o.id, name: o.name, drivers: num(o.drivers) })), cities: cities.map((c) => c.city), generatedAt: new Date().toISOString(),
  };
}

async function exportList(user: User, query: URLSearchParams, format: ExportFormat, tr: Tr | null, c: { f: FdFilters; period: Period; sort: SortSpec; sensitive: boolean }) {
  const all = await pageAll(async (limit, offset) => (await listDriverRecords(c.f, c.period, c.sort, limit, offset, { phone: c.sensitive })).map((r) => shapeRow(r, c.sensitive)));
  const totals = shapeTotals(await driverTotals(c.f, c.period, { phone: c.sensitive }));
  const officeName = c.f.office && c.f.office !== "independent" ? ((await officeOptions()).find((o) => o.id === c.f.office)?.name ?? null) : null;
  const rows = tr ? withListWords(tr, all.rows) : all.rows;
  const totalRow: Record<string, unknown> | null = tr ? { name: tr("fdr.totals"), ...Object.fromEntries(SUMMABLE.map((x) => [x.key, totals[x.key]])) } : null;
  return respond({
    user, format, tr, scope: "finance/drivers", table: "drivers", columns: listColumns(), rows, totals: totalRow, truncated: all.truncated, period: c.period,
    facts: tr ? [[tr("fr.xl_report"), tr("fdr.title")], [tr("fr.xl_filters"), filterWords(tr, c.f, officeName)]] : [],
    howTo: tr ? howToLines(tr, ["fdr.note_money", "fdr.note_wallet", "fdr.note_earned", "fdr.note_cash", "fdr.note_period", "fdr.note_penalties"]) : [],
    detail: { filters: c.f, sort: c.sort, sorted: c.sort.key !== FD_DEFAULT_SORT.key || c.sort.dir !== FD_DEFAULT_SORT.dir },
  });
}

// ───────── one driver ─────────
async function driverRow(user: User, id: string, period: Period) {
  if (!UUID.test(id)) throw err("NOT_FOUND", "Driver not found");
  const [rec] = await listDriverRecords(NO_FILTERS, period, FD_DEFAULT_SORT, 1, 0, { id });
  if (!rec) throw err("NOT_FOUND", "Driver not found");
  return shapeRow(rec, can(user, "drivers.sensitive"));
}

const tq = (id: string, period: Period, over: Partial<TableQuery> = {}): TableQuery => ({ id, period, status: "", kind: "", limit: 25, offset: 0, ...over });
function fetchTable(table: DetailTable, q: TableQuery): Promise<TablePage> {
  switch (table) {
    case "settlements": return settlementsTable(q);
    case "ledger": return ledgerTable(q, LEDGER_KINDS);
    case "withdrawals": return withdrawalsTable(q);
    case "cash": return cashTable(q);
    default: return statementTable(q);
  }
}

/** `GET /admin/finance/drivers/:id` — the same figures as the list row, plus how many rows each tab has for the period. */
export async function financeDriverSummary(user: User, id: string, query: URLSearchParams) {
  requirePerm(user, "finance.view");
  const period = resolvePeriod(query);
  const row = await driverRow(user, id, period);
  const counts = await Promise.all(DETAIL_TABLES.map(async (t) => [t, (await fetchTable(t, tq(id, period, { limit: 1 }))).total] as const));
  return { period: publicPeriod(period), driver: row, counts: Object.fromEntries(counts) };
}

/** Parameters of one detail table, validated: `status` (settlements / withdrawals / cash) and `kind` (ledger kind, or the statement's source). */
function tableQuery(table: DetailTable, id: string, period: Period, query: URLSearchParams): TableQuery {
  const status = query.get("status") ?? "", kind = query.get("kind") ?? "";
  if (table === "settlements" && !settlementStatusOk(status)) throw err("VALIDATION", "Unknown settlement status", { field: "status" });
  if (table === "withdrawals" && status !== "open" && !withdrawalStatusOk(status)) throw err("VALIDATION", "Unknown withdrawal status", { field: "status" });
  if (table === "cash" && status && status !== "all" && status !== "outstanding") throw err("VALIDATION", "status must be all or outstanding", { field: "status" });
  if (table === "ledger" && kind && !(LEDGER_KINDS as readonly string[]).includes(kind)) throw err("VALIDATION", "Unknown ledger kind", { field: "kind" });
  if (table === "statement" && kind && !(STATEMENT_SOURCES as readonly string[]).includes(kind)) throw err("VALIDATION", "Unknown statement source", { field: "kind" });
  return tq(id, period, { status, kind });
}

/** `GET /admin/finance/drivers/:id/<table>` — one page (JSON) or the whole selection as CSV / Excel. */
export async function financeDriverTable(user: User, id: string, table: DetailTable, query: URLSearchParams): Promise<unknown> {
  requirePerm(user, "finance.view");
  const format = formatOf(query);
  const tr = format ? exportGuard(user, query, format) : null;
  const period = resolvePeriod(query), base = tableQuery(table, id, period, query);
  const driver = await driverRow(user, id, period);
  if (format) {
    const all = await pageAll(async (limit, offset) => (await fetchTable(table, { ...base, limit, offset })).rows);
    const sums = (await fetchTable(table, { ...base, limit: 1 })).totals;
    const rows = !tr ? all.rows : table === "statement" ? withTypeLabels(tr, all.rows) : all.rows;
    return respond({
      user, format, tr, scope: `finance/drivers/${id}/${table}`, table, columns: tableColumns(table), rows, truncated: all.truncated, period,
      facts: tr ? [[tr("fr.xl_report"), tr("fdr.title")], [tr("fdr.f_driver"), `${driver.name}${driver.username ? ` (${driver.username})` : ""}`], [tr("fdr.f_office"), (driver.officeName as string | null) ?? tr("fdr.independent")]] : [],
      howTo: tr ? howToLines(tr, ["fdr.note_money", ...(table === "statement" ? ["fdr.note_statement", "fdr.note_cash_rows"] : table === "cash" ? ["fdr.note_cash_tab"] : table === "ledger" ? ["fdr.note_ledger"] : [])]) : [],
      detail: { driverId: id, status: base.status || null, kind: base.kind || null, totals: sums },
    });
  }
  const page = intParam(query, "page", 1, 1, 100_000), pageSize = intParam(query, "pageSize", 25, 1, MAX_PAGE_SIZE);
  const res = await fetchTable(table, { ...base, limit: pageSize, offset: (page - 1) * pageSize });
  return { table, period: publicPeriod(period), paidViaOffice: driver.paidViaOffice, page, pageSize, ...res };
}

