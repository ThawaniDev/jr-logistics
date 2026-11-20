import { defineRoutes } from "../router";
import { portalOptions } from "@/server/analytics/portal-options";
import { businessOverviewReport } from "@/server/analytics/portal-company";
import { businessDeliveriesReport, businessSpendingReport } from "@/server/analytics/portal-company-reports";
import { officeDriversReport, officeEarningsReport } from "@/server/analytics/portal-office-reports";
import { officeOverviewReport } from "@/server/analytics/portal-office";
import { portalCtx } from "@/server/analytics/portal-scope";
import { getSettings } from "@/server/settings";
import { listPortalTables, runPortalTable } from "@/server/analytics/portal-registry";
import { localeOf, translator } from "@/server/export/context";
import { typesOf } from "@/server/export/drill-sheet";
import { noteLines } from "@/server/export/notes";
import { portalOfficeWorkbook } from "@/server/export/workbook-portal";

const biz = ["business"] as const;
const off = ["office"] as const;

/**
 * Company and courier-office portal reports (decision G12, see memory/ANALYTICS.md). The owner is ALWAYS the signed-in account: `company` / `office` / `driver` query values
 * are never trusted (see `analytics/portal-scope.ts`). Filters are read from `ctx.query` (a URLSearchParams) so repeated keys survive.
 * `GET /office/analytics/workbook` is the office's own Excel workbook and `GET /office/analytics/notes?table=&lang=` the "how to read this" lines of its tables (`server/export/`).
 */
defineRoutes([
  { method: "GET", path: "/business/analytics/options", auth: [...biz], handler: ({ user }) => portalOptions(user, "business") },
  { method: "GET", path: "/business/analytics/overview", auth: [...biz], handler: ({ user, query }) => businessOverviewReport(user, query) },
  { method: "GET", path: "/business/analytics/deliveries", auth: [...biz], handler: ({ user, query }) => businessDeliveriesReport(user, query) },
  { method: "GET", path: "/business/analytics/spending", auth: [...biz], handler: ({ user, query }) => businessSpendingReport(user, query) },
  { method: "GET", path: "/business/analytics/table/:name", auth: [...biz], handler: ({ user, params, query }) => runPortalTable(user, "business", params.name, query) },
  { method: "GET", path: "/office/analytics/options", auth: [...off], handler: ({ user }) => portalOptions(user, "office") },
  { method: "GET", path: "/office/analytics/overview", auth: [...off], handler: ({ user, query }) => officeOverviewReport(user, query) },
  { method: "GET", path: "/office/analytics/drivers", auth: [...off], handler: ({ user, query }) => officeDriversReport(user, query) },
  { method: "GET", path: "/office/analytics/earnings", auth: [...off], handler: ({ user, query }) => officeEarningsReport(user, query) },
  { method: "GET", path: "/office/analytics/table/:name", auth: [...off], handler: ({ user, params, query }) => runPortalTable(user, "office", params.name, query) },
  { method: "GET", path: "/office/analytics/workbook", auth: [...off], handler: ({ user, query }) => portalOfficeWorkbook(user, query) },
  {
    method: "GET", path: "/office/analytics/notes", auth: [...off],
    handler: async ({ user, query }) => {
      const tables = listPortalTables("office").filter((d) => !query.get("table") || d.name === query.get("table"));
      const c = await portalCtx(user, query, "office");
      return { notes: noteLines(translator(localeOf(query, user)), { report: "portal-office", table: query.get("table") ?? undefined, tables: tables.map((d) => d.name), filters: c.f, grace: (await getSettings()).lateGraceMin, types: typesOf(tables.flatMap((d) => d.columns)), moneyHidden: false }) };
    },
  },
]);
