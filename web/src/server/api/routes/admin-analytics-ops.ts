import { defineRoutes } from "../router";
import { geographyReport } from "@/server/analytics/geo-report";
import { operationsReport } from "@/server/analytics/ops-report";

/**
 * Operations (with the cancellations deep-dive) and Geography reports (decisions G2–G4). Filters are parsed from `ctx.query` like every analytics route; the drill-down
 * tables of both reports (`/admin/analytics/operations/table/*`, `/geography/table/*`) are served by the generic route in `admin-analytics.ts` once their modules are imported (the report modules do).
 */
const bo = "backoffice" as const;
defineRoutes([
  { method: "GET", path: "/admin/analytics/operations", auth: bo, handler: ({ user, query }) => operationsReport(user, query) },
  { method: "GET", path: "/admin/analytics/geography", auth: bo, handler: ({ user, query }) => geographyReport(user, query) },
]);
