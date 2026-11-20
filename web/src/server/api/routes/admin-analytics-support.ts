import { defineRoutes } from "../router";
import { explorerCatalog, explorerQuery } from "@/server/analytics/explorer";
import { supportReport } from "@/server/analytics/support";

const bo = "backoffice" as const;

// Support & quality report (`GET /admin/analytics/support`; its drill-down tables are `/admin/analytics/support/table/<name>` through the framework route) and the data
// explorer (`/admin/analytics/explorer/datasets` = the catalogue, `/admin/analytics/explorer/:dataset` = a page, a group summary or — `format=csv` — the streamed export;
// see server/analytics/explorer.ts). This file is already registered in ./index.ts. The catalogue route is declared first so `datasets` is never read as a dataset key.
defineRoutes([
  { method: "GET", path: "/admin/analytics/support", auth: bo, handler: ({ user, query }) => supportReport(user, query) },
  { method: "GET", path: "/admin/analytics/explorer/datasets", auth: bo, handler: ({ user }) => explorerCatalog(user) },
  { method: "GET", path: "/admin/analytics/explorer/:dataset", auth: bo, handler: ({ user, params, query }) => explorerQuery(user, params.dataset, query) },
]);
