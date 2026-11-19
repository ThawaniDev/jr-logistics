import { z } from "zod";
import { defineRoutes } from "../router";
import { companyDetail, companyOverview, companySummary, listCompanies, verificationSummary } from "@/server/companies-admin";

const bo = "backoffice" as const;

// Back-office routes for the company (business account) views and the verification workspace. `/summary` is registered before `/:id` (first match wins).
defineRoutes([
  { method: "GET", path: "/admin/companies/summary", auth: bo, handler: ({ user }) => companySummary(user) },
  { method: "GET", path: "/admin/companies", auth: bo, query: z.object({
    q: z.string().max(80).optional(), state: z.string().max(20).optional(), warehouse: z.enum(["missing", "set"]).optional(),
    page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional(),
  }), handler: ({ user, q }) => listCompanies(user, q) },
  { method: "GET", path: "/admin/companies/:id", auth: bo, handler: ({ user, params }) => companyDetail(user, params.id) },
  { method: "GET", path: "/admin/companies/:id/overview", auth: bo, handler: ({ user, params }) => companyOverview(user, params.id) },
  { method: "GET", path: "/admin/verification/summary", auth: bo, handler: ({ user }) => verificationSummary(user) },
]);
