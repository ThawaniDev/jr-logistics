import { defineRoutes } from "../router";
import { financeDriversList, financeDriverSummary, financeDriverTable } from "@/server/finance-drivers";
import { financeDriverWorkbook } from "@/server/finance-drivers-workbook";
import type { DetailTable } from "@/server/finance-drivers-cols";
import type { User } from "@/db/schema";

const bo = "backoffice" as const;

/**
 * Finance › Drivers (J7). Needs `finance.view`; `format=csv|xlsx` also `reports.export` (audited `report.export`); phone numbers are masked without `drivers.sensitive`.
 * Filters are read from `ctx.query` (a URLSearchParams): list `q office city status hasCash hasPending sort dir page pageSize from to period=all`; tables `from to period=all page pageSize status kind`.
 * The static path (the list) comes first; the table paths have two segments after the id, so none of them can be mistaken for `/:id`.
 * `…/:id/statement?format=xlsx` is the FULL workbook (Summary + every table + Notes); `&scope=table` gives just the statement sheet.
 */
const table = (name: DetailTable) => ({
  method: "GET" as const, path: `/admin/finance/drivers/:id/${name}`, auth: bo,
  handler: ({ user, params, query }: { user: User; params: Record<string, string>; query: URLSearchParams }) => financeDriverTable(user, params.id, name, query),
});

defineRoutes([
  { method: "GET", path: "/admin/finance/drivers", auth: bo, handler: ({ user, query }) => financeDriversList(user, query) },
  table("settlements"), table("ledger"), table("withdrawals"), table("cash"),
  {
    method: "GET", path: "/admin/finance/drivers/:id/statement", auth: bo,
    handler: ({ user, params, query }) => (query.get("format") === "xlsx" && query.get("scope") !== "table" ? financeDriverWorkbook(user, params.id, query) : financeDriverTable(user, params.id, "statement", query)),
  },
  { method: "GET", path: "/admin/finance/drivers/:id", auth: bo, handler: ({ user, params, query }) => financeDriverSummary(user, params.id, query) },
]);
