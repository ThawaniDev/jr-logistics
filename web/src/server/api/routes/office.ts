import { z } from "zod";
import { defineRoutes } from "../router";
import { uuid, phone } from "../schemas";
import { pendingInvites, revokeInvite, officeDashboard, officeDrivers, inviteDriver, unlinkDriver, officeOpportunities, officeJobs, officeSettlements, officeReport, currentAgreements, acceptAgreement } from "@/server/office";
import { assignDriver, officeReplace } from "@/server/jobs";
import { err } from "@/lib/errors";
import { requestWithdrawal } from "@/server/settlement";
import { officeJobDetail } from "@/server/office";
import { officeReadiness } from "@/server/office";

const off = ["office"] as const;
const needReady = async (id: string) => { const r = await officeReadiness(id); if (!r.ready) throw err("NOT_ELIGIBLE", "Your office must be verified with an accepted agreement", r); };

defineRoutes([
  { method: "GET", path: "/office/dashboard", auth: [...off], handler: ({ user }) => officeDashboard(user) },
  { method: "GET", path: "/office/drivers", auth: [...off], handler: async ({ user }) => ({ items: await officeDrivers(user.id) }) },
  { method: "GET", path: "/office/invites", auth: [...off], handler: async ({ user }) => ({ items: await pendingInvites(user.id) }) },
  { method: "POST", path: "/office/invites/:id/revoke", auth: [...off], handler: async ({ user, params }) => { await revokeInvite(user, params.id); return { ok: true }; } },
  { method: "POST", path: "/office/drivers/invite", auth: [...off], status: 201, body: z.object({ phone }), handler: ({ user, input }) => inviteDriver(user, input.phone) },
  { method: "POST", path: "/office/drivers/:id/unlink", auth: [...off], handler: async ({ user, params }) => { await unlinkDriver(user, params.id); return { ok: true }; } },
  { method: "GET", path: "/office/opportunities", auth: [...off], handler: async ({ user }) => { await needReady(user.id); return { items: await officeOpportunities(user.id) }; } },
  { method: "POST", path: "/office/opportunities/:id/assign", auth: [...off], status: 201, body: z.object({ driverId: uuid }), handler: async ({ user, params, input }) => { await needReady(user.id); return assignDriver(user, params.id, input.driverId, "office"); } },
  { method: "GET", path: "/office/jobs", auth: [...off], query: z.object({ scope: z.enum(["active", "all"]).default("all"), page: z.coerce.number().int().min(1).optional() }), handler: ({ user, q }) => officeJobs(user.id, q) },
  { method: "GET", path: "/office/jobs/:id", auth: [...off], handler: ({ user, params }) => officeJobDetail(user.id, params.id) },
  { method: "POST", path: "/office/jobs/:id/replace", auth: [...off], body: z.object({ reason: z.string().min(3).max(300) }), handler: ({ user, params, input }) => officeReplace(user, params.id, input.reason) },
  { method: "GET", path: "/office/settlements", auth: [...off], query: z.object({ status: z.string().optional(), page: z.coerce.number().int().min(1).optional() }), handler: ({ user, q }) => officeSettlements(user.id, q) },
  { method: "GET", path: "/office/reports", auth: [...off], query: z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), handler: ({ user, q }) => officeReport(user.id, q.from, q.to) },
  { method: "GET", path: "/office/agreements", auth: [...off], handler: async ({ user }) => ({ items: await currentAgreements(user.id) }) },
  { method: "POST", path: "/office/agreements/:id/accept", auth: [...off], handler: ({ user, params }) => acceptAgreement(user, params.id) },
  { method: "POST", path: "/office/withdrawals", auth: [...off], status: 201, body: z.object({ amountCents: z.number().int().positive().max(1_000_000_000) }), handler: ({ user, input }) => requestWithdrawal(user, input.amountCents) },
]);
