import { defineRoutes } from "../router";
import { companiesReport } from "@/server/analytics/companies";
import { driversReport } from "@/server/analytics/drivers";
import { officesReport } from "@/server/analytics/offices";
import { growthReport } from "@/server/analytics/growth";

const bo = "backoffice" as const;

/**
 * Companies, drivers, courier offices and growth reports (`GET /admin/analytics/<report>`; their drill-down tables are registered by the modules imported here and
 * served by the generic `/admin/analytics/:report/table/:name` route). Filters come from `ctx.query`; `reports.view` is checked inside each report, money needs `finance.view`.
 */
defineRoutes([ // companies · drivers · offices · growth
  { method: "GET", path: "/admin/analytics/companies", auth: bo, handler: ({ user, query }) => companiesReport(user, query) },
  { method: "GET", path: "/admin/analytics/drivers", auth: bo, handler: ({ user, query }) => driversReport(user, query) },
  { method: "GET", path: "/admin/analytics/offices", auth: bo, handler: ({ user, query }) => officesReport(user, query) },
  { method: "GET", path: "/admin/analytics/growth", auth: bo, handler: ({ user, query }) => growthReport(user, query) },
]);
