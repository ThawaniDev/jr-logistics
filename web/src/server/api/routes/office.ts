import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { defineRoutes } from "../router";
import { uuid, phone } from "../schemas";
import { db } from "@/db";
import { settlements } from "@/db/schema";
import { officeDashboard, officeDrivers, inviteDriver, unlinkDriver, officeOpportunities, officeJobs, currentAgreements, acceptAgreement } from "@/server/office";
import { assignDriver, staffReplace } from "@/server/jobs";
import { listSettlements } from "@/server/settlement";
import { err } from "@/lib/errors";
import { offers } from "@/db/schema";
import { requestWithdrawal } from "@/server/settlement";
import { officeReadiness } from "@/server/office";

const off = ["office"] as const;
const needReady = async (id: string) => { const r = await officeReadiness(id); if (!r.ready) throw err("NOT_ELIGIBLE", "Your office must be verified with an accepted agreement", r); };

defineRoutes([
  { method: "GET", path: "/office/dashboard", auth: [...off], handler: ({ user }) => officeDashboard(user) },
  { method: "GET", path: "/office/drivers", auth: [...off], handler: async ({ user }) => ({ items: await officeDrivers(user.id) }) },
  { method: "POST", path: "/office/drivers/invite", auth: [...off], status: 201, body: z.object({ phone }), handler: ({ user, input }) => inviteDriver(user, input.phone) },
  { method: "POST", path: "/office/drivers/:id/unlink", auth: [...off], handler: async ({ user, params }) => { await unlinkDriver(user, params.id); return { ok: true }; } },
  { method: "GET", path: "/office/opportunities", auth: [...off], handler: async ({ user }) => { await needReady(user.id); return { items: await officeOpportunities(user.id) }; } },
  { method: "POST", path: "/office/opportunities/:id/assign", auth: [...off], status: 201, body: z.object({ driverId: uuid }), handler: async ({ user, params, input }) => { await needReady(user.id); return assignDriver(user, params.id, input.driverId, "office"); } },
  { method: "GET", path: "/office/jobs", auth: [...off], handler: async ({ user }) => ({ items: await officeJobs(user.id) }) },
  { method: "POST", path: "/office/jobs/:id/replace", auth: [...off], body: z.object({ reason: z.string().min(3).max(300) }), handler: async ({ user, params, input }) => {
    const [o] = await db.select().from(offers).where(and(eq(offers.id, params.id), eq(offers.officeId, user.id)));
    if (!o) throw err("NOT_FOUND");
    if (!["accepted", "arrived"].includes(o.status)) throw err("INVALID_TRANSITION", "Only jobs that have not started can be replaced");
    return staffReplace({ ...user, role: "admin" } as typeof user, params.id, input.reason); // privileged internal path, scoped by ownership check above
  } },
  { method: "GET", path: "/office/settlements", auth: [...off], query: z.object({ status: z.string().optional(), page: z.coerce.number().optional() }), handler: async ({ user, q }) => {
    const r = await listSettlements({ status: q.status, page: q.page, payeeId: user.id });
    // Offices never see customer price or platform margin.
    return { ...r, items: r.items.map((s) => ({ id: s.id, requestId: s.requestId, driverId: s.driverId, finalUnits: s.finalUnits, amountCents: s.providerCents, status: s.status, createdAt: s.createdAt, paidAt: s.paidAt })) };
  } },
  { method: "GET", path: "/office/agreements", auth: [...off], handler: async ({ user }) => ({ items: await currentAgreements(user.id) }) },
  { method: "POST", path: "/office/agreements/:id/accept", auth: [...off], handler: ({ user, params }) => acceptAgreement(user, params.id) },
  { method: "POST", path: "/office/withdrawals", auth: [...off], status: 201, body: z.object({ amountCents: z.number().int().positive() }), handler: ({ user, input }) => requestWithdrawal(user, input.amountCents) },
]);
export { settlements, desc };
