import { z } from "zod";
import { defineRoutes } from "../router";
import { accountsSummary, directoryDrivers, driverJobsPage, driverMoney, driverOverview, DRIVER_STATES, JOB_SCOPES, listOffices, OFFICE_STATES, officeDetail, officeDriversPage, officeJobsPage, officeSettlementsPage, officesSummary, driversSummary } from "@/server/offices-admin";

// Back-office routes for the redesigned admin views: courier offices, drivers and the accounts directory (read-only aggregates).
// Registered after admin.ts / admin-extra.ts, whose `GET /admin/drivers/:id` would shadow a `/admin/drivers/<word>` path, hence the flat `drivers-*` names.
const bo = "backoffice" as const;
const page = z.coerce.number().int().min(1).optional();
const pageSize = z.coerce.number().int().min(1).max(100).optional();
const q = z.string().max(80).optional();

defineRoutes([
  // Courier offices. `/summary` must stay above `/:id` (first match wins).
  { method: "GET", path: "/admin/offices/summary", auth: bo, handler: ({ user }) => officesSummary(user) },
  { method: "GET", path: "/admin/offices", auth: bo, query: z.object({ q, state: z.enum(OFFICE_STATES).optional(), agreement: z.enum(["pending", "none"]).optional(), page, pageSize }), handler: ({ user, q }) => listOffices(user, q) },
  { method: "GET", path: "/admin/offices/:id", auth: bo, handler: ({ user, params }) => officeDetail(user, params.id) },
  { method: "GET", path: "/admin/offices/:id/drivers", auth: bo, query: z.object({ q, state: z.enum(DRIVER_STATES).optional(), page, pageSize }), handler: ({ user, params, q }) => officeDriversPage(user, params.id, q) },
  { method: "GET", path: "/admin/offices/:id/jobs", auth: bo, query: z.object({ scope: z.enum(JOB_SCOPES).optional(), page, pageSize }), handler: ({ user, params, q }) => officeJobsPage(user, params.id, q) },
  { method: "GET", path: "/admin/offices/:id/settlements", auth: bo, query: z.object({ status: z.enum(["pending", "paid", "rejected"]).optional(), page, pageSize }), handler: ({ user, params, q }) => officeSettlementsPage(user, params.id, q) },

  // Drivers
  { method: "GET", path: "/admin/drivers-summary", auth: bo, handler: ({ user }) => driversSummary(user) },
  { method: "GET", path: "/admin/drivers-list", auth: bo, query: z.object({ q, state: z.enum(DRIVER_STATES).optional(), link: z.enum(["office", "direct"]).optional(), officeId: z.string().uuid().optional(), page, pageSize }), handler: ({ user, q }) => directoryDrivers(user, q) },
  { method: "GET", path: "/admin/drivers/:id/overview", auth: bo, handler: ({ user, params }) => driverOverview(user, params.id) },
  { method: "GET", path: "/admin/drivers/:id/jobs", auth: bo, query: z.object({ scope: z.enum(JOB_SCOPES).optional(), page, pageSize }), handler: ({ user, params, q }) => driverJobsPage(user, params.id, q) },
  { method: "GET", path: "/admin/drivers/:id/wallet", auth: bo, handler: ({ user, params }) => driverMoney(user, params.id) },

  // Accounts directory
  { method: "GET", path: "/admin/accounts-summary", auth: bo, handler: ({ user }) => accountsSummary(user) },
]);
