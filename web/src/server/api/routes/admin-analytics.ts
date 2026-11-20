import { defineRoutes } from "../router";
import { err } from "@/lib/errors";
import { can, requirePerm } from "@/server/auth/permissions";
import { analyticsOptions } from "@/server/analytics/options";
import { overviewReport } from "@/server/analytics/overview";
import { parseFilters } from "@/server/analytics/filters";
import { getSettings } from "@/server/settings";
import { getTable, listTables, RESERVED_REPORTS, runTable } from "@/server/analytics/registry";
import { localeOf, translator } from "@/server/export/context";
import { typesOf } from "@/server/export/drill-sheet";
import { noteLines } from "@/server/export/notes";
import { entityWorkbook } from "@/server/export/workbook";

const bo = "backoffice" as const;

/**
 * Analytics framework routes (see memory/ANALYTICS.md). The filter model is parsed from `ctx.query` (a URLSearchParams, so repeated keys survive; `ctx.q` would keep
 * only the last). Report packs add their own `GET /admin/analytics/<report>` routes in their own files and register drill-down tables with `defineTable()`.
 * Reserved path names: `options`, `overview`, `notes`, `workbook` (a new report cannot be called `options`, `notes` or `workbook`: `defineTable` refuses it), and the `/:report/table/:name` and `/:report/notes` shapes.
 * `GET /admin/analytics/workbook/:kind/:id` (kind = office | driver) is the entity workbook export (`server/export/workbook.ts`); it is declared before the table route on purpose.
 */
defineRoutes([
  { method: "GET", path: "/admin/analytics/options", auth: bo, handler: ({ user, query }) => analyticsOptions(user, query) },
  { method: "GET", path: "/admin/analytics/overview", auth: bo, handler: ({ user, query }) => overviewReport(user, query) },
  { method: "GET", path: "/admin/analytics/workbook/:kind/:id", auth: bo, handler: ({ user, params, query }) => entityWorkbook(user, params.kind, params.id, query) },
  {
    // The "how to read this" lines of a report (or of one table with `?table=`), localized with `?lang=ar|en|ur` (default: the viewer's language).
    method: "GET", path: "/admin/analytics/:report/notes", auth: bo,
    handler: async ({ user, params, query }) => {
      requirePerm(user, "reports.view");
      const tables = RESERVED_REPORTS.includes(params.report) ? [] : listTables(params.report).filter((d) => !query.get("table") || d.name === query.get("table"));
      if (!tables.length) throw err("NOT_FOUND", "Unknown report");
      const money = can(user, "finance.view"), tr = translator(localeOf(query, user));
      const columns = tables.flatMap((d) => d.columns.filter((c) => money || !d.moneyKeys?.includes(c.key)));
      const filters = parseFilters(query);
      return { notes: noteLines(tr, { report: params.report, table: query.get("table") ?? undefined, tables: tables.map((d) => d.name), filters, grace: (await getSettings()).lateGraceMin, types: typesOf(columns), moneyHidden: !money && tables.some((d) => d.moneyKeys?.length) }) };
    },
  },
  {
    method: "GET", path: "/admin/analytics/:report/table/:name", auth: bo,
    handler: ({ user, params, query }) => {
      requirePerm(user, "reports.view");
      const def = getTable(params.report, params.name);
      if (!def) throw err("NOT_FOUND", "Unknown report table");
      return runTable(user, def, query);
    },
  },
]);
