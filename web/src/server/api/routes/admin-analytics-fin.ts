import { defineRoutes } from "../router";
import { codReport } from "@/server/analytics/cod";
import { deliveriesReport } from "@/server/analytics/deliveries";
import { financeReport } from "@/server/analytics/finance";

const bo = "backoffice" as const;

/** Deliveries, cash-on-delivery and finance reports (memory/ANALYTICS.md §5). Their drill-down tables register themselves with `defineTable()` when the report modules are imported here. */
defineRoutes([
  { method: "GET", path: "/admin/analytics/deliveries", auth: bo, handler: ({ user, query }) => deliveriesReport(user, query) },
  { method: "GET", path: "/admin/analytics/cod", auth: bo, handler: ({ user, query }) => codReport(user, query) },
  { method: "GET", path: "/admin/analytics/finance", auth: bo, handler: ({ user, query }) => financeReport(user, query) },
]);
