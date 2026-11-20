import { z } from "zod";
import { defineRoutes } from "../router";
import { uuid } from "../schemas";
import { COMPANY_PERIODS } from "@/server/details-pure";
import { companyStats } from "@/server/details-companies";
import { companyMoney, companyProfile, companyRaw } from "@/server/details-companies-b";
import { companyParcels, companyParcelsCsv } from "@/server/details-companies-c";
import { companyIntegrations, companySecurity, companySupport } from "@/server/details-companies-d";
import { userDetail, userRaw, userSecurity } from "@/server/details-users";
import { ticketContext } from "@/server/details-support";
import { complaintContext } from "@/server/details-support-b";

const bo = "backoffice" as const;
const parcelQuery = z.object({
  status: z.string().max(20).optional(), city: z.string().max(40).optional(), q: z.string().trim().max(80).optional(), from: z.string().max(10).optional(), to: z.string().max(10).optional(),
  cod: z.enum(["yes", "no"]).optional(), format: z.enum(["json", "csv"]).optional(), page: z.coerce.number().int().min(1).max(10_000).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

// Company, user, ticket and complaint detail views (decisions G6–G7). Every handler checks its own permissions in the server module and answers 404 for an unknown id.
defineRoutes([
  { method: "GET", path: "/admin/companies/:id/stats", auth: bo, query: z.object({ period: z.enum(COMPANY_PERIODS).optional() }), handler: ({ user, params, q }) => companyStats(user, params.id, q.period ?? "30d") },
  { method: "GET", path: "/admin/companies/:id/profile", auth: bo, handler: ({ user, params }) => companyProfile(user, params.id) },
  { method: "GET", path: "/admin/companies/:id/money", auth: bo, handler: ({ user, params }) => companyMoney(user, params.id) },
  { method: "GET", path: "/admin/companies/:id/parcels", auth: bo, query: parcelQuery, handler: async ({ user, params, q }) => {
    if (q.format !== "csv") return companyParcels(user, params.id, q);
    const r = await companyParcelsCsv(user, params.id, q);
    return new Response(r.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="company-parcels-${params.id.slice(0, 8)}.csv"`, "cache-control": "no-store" } });
  } },
  { method: "GET", path: "/admin/companies/:id/integrations", auth: bo, handler: ({ user, params }) => companyIntegrations(user, params.id) },
  { method: "GET", path: "/admin/companies/:id/security", auth: bo, handler: ({ user, params }) => companySecurity(user, params.id) },
  { method: "GET", path: "/admin/companies/:id/support", auth: bo, handler: ({ user, params }) => companySupport(user, params.id) },
  { method: "GET", path: "/admin/companies/:id/raw", auth: bo, handler: ({ user, params }) => companyRaw(user, params.id) },

  { method: "GET", path: "/admin/users/:id/detail", auth: bo, handler: ({ user, params }) => userDetail(user, params.id) },
  { method: "GET", path: "/admin/users/:id/security", auth: bo, handler: ({ user, params }) => userSecurity(user, params.id) },
  { method: "GET", path: "/admin/users/:id/raw", auth: bo, handler: ({ user, params }) => userRaw(user, params.id) },

  { method: "GET", path: "/admin/tickets/:id/context", auth: bo, handler: ({ user, params }) => ticketContext(user, uuid.safeParse(params.id).success ? params.id : "") },
  { method: "GET", path: "/admin/complaints/:id/context", auth: bo, handler: ({ user, params }) => complaintContext(user, uuid.safeParse(params.id).success ? params.id : "") },
]);
