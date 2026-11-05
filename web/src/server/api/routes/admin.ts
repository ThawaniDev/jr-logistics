import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { defineRoutes } from "../router";
import { uuid, pageQuery } from "../schemas";
import { db } from "@/db";
import { users, driverProfiles, businessProfiles, officeProfiles, withdrawals, tickets, offers, requests } from "@/db/schema";
import { err } from "@/lib/errors";
import { ALL_PERMISSIONS, STAFF_PRESETS, SERVICES } from "@/server/catalog";
import { requirePerm, can } from "@/server/auth/permissions";
import { getSettings, updateSettings } from "@/server/settings";
import { audit } from "@/server/audit";
import { adminStats, opsAlerts, opsToday, liveMap, smartSuggest, rematch, driverDirectory, clearSuspension, report, toCsv, auditTrail, type ReportType } from "@/server/ops";
import { listUsers, setUserStatus, setAccountVerification, reviewDocument, listDocumentsForReview, createStaff, updateStaff, profileOf } from "@/server/accounts";
import { createRule, listRules, retireRule } from "@/server/pricing";
import * as settle from "@/server/settlement";
import * as jobs from "@/server/jobs";
import { listRequests, viewRequest } from "@/server/requests";
import { createAgreement, currentAgreements, unlinkDriver } from "@/server/office";
import { listTickets, updateComplaint, listComplaints } from "@/server/support";
import { notifyMany } from "@/server/notify";
import { withdrawals as wd } from "@/db/schema";

const bo = "backoffice" as const;

defineRoutes([
  { method: "GET", path: "/admin/stats", auth: bo, handler: async ({ user }) => { requirePerm(user, "requests.view", "finance.view", "users.view", "reports.view"); return adminStats(); } },
  { method: "GET", path: "/admin/meta", auth: bo, handler: async () => ({ permissions: ALL_PERMISSIONS, presets: STAFF_PRESETS, services: SERVICES }) },

  // Settings (admin/settings.edit)
  { method: "GET", path: "/admin/settings", auth: bo, handler: async ({ user }) => { requirePerm(user, "settings.view", "settings.edit"); return getSettings(); } },
  { method: "PATCH", path: "/admin/settings", auth: bo, body: z.object({
    enabledServices: z.array(z.enum(["delivery_driver", "car_with_driver", "car_without_driver"])).min(1).optional(), vatPct: z.number().min(0).max(30).optional(),
    settlementPeriod: z.enum(["weekly", "monthly"]).optional(), cancelPolicyEnabled: z.boolean().optional(), cancelWarnAt: z.number().int().min(1).max(20).optional(),
    cancelSuspendAt: z.number().int().min(1).max(30).optional(), cancelWindowDays: z.number().int().min(1).max(90).optional(), cancelSuspendDays: z.number().int().min(1).max(90).optional(),
    lateGraceMin: z.number().int().min(0).max(240).optional(), checkinEarlyMin: z.number().int().min(0).max(1440).optional(), officeWindowMin: z.number().int().min(0).max(1440).optional(),
    overlapPolicy: z.enum(["time_window", "single_active"]).optional(), requireBusinessVerification: z.boolean().optional(), requireDriverVerification: z.boolean().optional(),
    separationOfDuties: z.boolean().optional(), minWithdrawalCents: z.number().int().min(0).optional(), termsVersion: z.string().max(20).optional(),
    termsBusiness: z.string().max(10000).optional(), termsDriver: z.string().max(10000).optional(), termsOffice: z.string().max(10000).optional(),
    cities: z.array(z.object({ key: z.string(), ar: z.string(), en: z.string(), ur: z.string(), lat: z.number(), lng: z.number(), pickup: z.boolean(), delivery: z.boolean() })).optional(),
  }), handler: async ({ user, input }) => { requirePerm(user, "settings.edit"); const u = await updateSettings(input, user.id); await audit(user, "settings.update", "settings", "platform", input); return u; } },

  // Users & verification
  { method: "GET", path: "/admin/users", auth: bo, query: pageQuery.extend({ role: z.string().optional() }), handler: async ({ user, q }) => { requirePerm(user, "users.view"); return listUsers(q); } },
  { method: "GET", path: "/admin/users/:id", auth: bo, handler: async ({ user, params }) => {
    requirePerm(user, "users.view");
    const [u] = await db.select().from(users).where(eq(users.id, params.id)); if (!u) throw err("NOT_FOUND");
    return { user: { id: u.id, role: u.role, name: u.name, phone: u.phone, email: u.email, city: u.city, status: u.status, createdAt: u.createdAt, staffRole: u.staffRole, permissions: u.permissions }, profile: await profileOf(u) };
  } },
  { method: "POST", path: "/admin/users/:id/status", auth: bo, body: z.object({ status: z.enum(["active", "suspended"]), reason: z.string().max(300).optional() }), handler: ({ user, params, input }) => setUserStatus(user, params.id, input.status, input.reason) },
  { method: "POST", path: "/admin/users/:id/verification", auth: bo, body: z.object({ action: z.enum(["verify", "reject", "request_info", "suspend"]), note: z.string().max(500).optional() }), handler: ({ user, params, input }) => setAccountVerification(user, params.id, input.action, input.note) },
  { method: "GET", path: "/admin/verification-queue", auth: bo, handler: async ({ user }) => {
    requirePerm(user, "verification.manage", "offices.view", "documents.review");
    const biz = await db.select({ u: users, p: businessProfiles }).from(businessProfiles).innerJoin(users, eq(users.id, businessProfiles.userId)).where(inArray(businessProfiles.verificationStatus, ["pending", "info_requested"]));
    const offices = await db.select({ u: users, p: officeProfiles }).from(officeProfiles).innerJoin(users, eq(users.id, officeProfiles.userId)).where(inArray(officeProfiles.verificationStatus, ["pending", "info_requested"]));
    const drivers = await db.select({ u: users, p: driverProfiles }).from(driverProfiles).innerJoin(users, eq(users.id, driverProfiles.userId)).where(eq(driverProfiles.verificationStatus, "pending"));
    return {
      business: biz.map((b) => ({ id: b.u.id, name: b.u.name, company: b.p.companyName, cr: b.p.crNumber, status: b.p.verificationStatus, createdAt: b.u.createdAt })),
      offices: offices.map((b) => ({ id: b.u.id, name: b.p.officeName, cr: b.p.crNumber, status: b.p.verificationStatus, createdAt: b.u.createdAt })),
      drivers: drivers.map((b) => ({ id: b.u.id, name: b.u.name, vehicleType: b.p.vehicleType, createdAt: b.u.createdAt })),
    };
  } },
  { method: "GET", path: "/admin/documents", auth: bo, query: z.object({ status: z.string().optional(), kind: z.string().optional(), page: z.coerce.number().optional() }), handler: async ({ user, q }) => { requirePerm(user, "documents.review", "verification.manage"); return { items: await listDocumentsForReview(q) }; } },
  { method: "POST", path: "/admin/documents/:id/review", auth: bo, body: z.object({ decision: z.enum(["approved", "rejected", "info_requested"]), note: z.string().max(500).optional() }), handler: ({ user, params, input }) => reviewDocument(user, params.id, input.decision, input.note) },
  { method: "GET", path: "/admin/drivers", auth: bo, query: z.object({ q: z.string().optional(), verification: z.string().optional(), page: z.coerce.number().optional() }), handler: async ({ user, q }) => ({ items: await driverDirectory(user, q) }) },
  { method: "POST", path: "/admin/drivers/:id/clear-suspension", auth: bo, handler: async ({ user, params }) => { await clearSuspension(user, params.id); return { ok: true }; } },
  { method: "POST", path: "/admin/drivers/:id/unlink-office", auth: bo, handler: async ({ user, params }) => { await unlinkDriver(user, params.id); return { ok: true }; } },
  { method: "POST", path: "/admin/offices/:id/agreements", auth: bo, status: 201, body: z.object({ terms: z.string().max(10000).optional(), expiresAt: z.coerce.date().nullish() }), handler: ({ user, params, input }) => createAgreement(user, params.id, input) },
  { method: "GET", path: "/admin/offices/:id/agreements", auth: bo, handler: async ({ user, params }) => { requirePerm(user, "offices.view"); return { items: await currentAgreements(params.id) }; } },

  // Staff
  { method: "GET", path: "/admin/staff", auth: bo, handler: async ({ user }) => { requirePerm(user, "staff.view", "staff.manage"); return { items: await db.select({ id: users.id, name: users.name, email: users.email, staffRole: users.staffRole, permissions: users.permissions, status: users.status }).from(users).where(eq(users.role, "staff")).orderBy(desc(users.createdAt)) }; } },
  { method: "POST", path: "/admin/staff", auth: bo, status: 201, body: z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(10), staffRole: z.string().optional(), permissions: z.array(z.string()).optional() }), handler: async ({ user, input }) => { const u = await createStaff(user, input as never); return { id: u.id, email: u.email }; } },
  { method: "PATCH", path: "/admin/staff/:id", auth: bo, body: z.object({ name: z.string().optional(), staffRole: z.string().nullable().optional(), permissions: z.array(z.string()).optional(), status: z.enum(["active", "suspended"]).optional() }), handler: async ({ user, params, input }) => { const u = await updateStaff(user, params.id, input as never); return { id: u.id }; } },

  // Pricing
  { method: "GET", path: "/admin/pricing", auth: bo, query: z.object({ service: z.string().optional(), businessId: z.string().optional(), all: z.string().optional() }), handler: async ({ user, q }) => { requirePerm(user, "pricing.view", "pricing.edit"); return { items: await listRules({ service: q.service, businessId: q.businessId, includeRetired: q.all === "1" }) }; } },
  { method: "POST", path: "/admin/pricing", auth: bo, status: 201, body: z.object({
    service: z.enum(["delivery_driver", "car_with_driver", "car_without_driver"]), vehicleType: z.string().nullish(), temperature: z.string().nullish(), pickupCity: z.string().nullish(), deliveryCity: z.string().nullish(),
    businessId: uuid.nullish(), priceCents: z.number().int().positive(), providerCostCents: z.number().int().min(0), agreementRef: z.string().max(80).nullish(), effectiveAt: z.coerce.date().optional(), expiresAt: z.coerce.date().nullish(), notes: z.string().max(300).nullish(),
  }), handler: async ({ user, input }) => { requirePerm(user, "pricing.edit"); return createRule(user, input); } },
  { method: "POST", path: "/admin/pricing/:id/retire", auth: bo, handler: async ({ user, params }) => { requirePerm(user, "pricing.edit"); return retireRule(user, params.id); } },

  // Requests & operations
  { method: "GET", path: "/admin/requests", auth: bo, query: pageQuery.extend({ city: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }), handler: async ({ user, q }) => { requirePerm(user, "requests.view"); const r = await listRequests(q); return { ...r, items: r.items.map((x) => viewRequest(x, user)) }; } },
  { method: "GET", path: "/admin/ops/today", auth: bo, handler: async ({ user }) => { requirePerm(user, "requests.view"); return opsToday(); } },
  { method: "GET", path: "/admin/ops/alerts", auth: bo, handler: async ({ user }) => { requirePerm(user, "requests.view"); return { items: await opsAlerts() }; } },
  { method: "GET", path: "/admin/ops/map", auth: bo, handler: async ({ user }) => ({ items: await liveMap(user) }) },
  { method: "GET", path: "/admin/requests/:id/suggest", auth: bo, handler: async ({ user, params }) => ({ items: await smartSuggest(user, params.id) }) },
  { method: "POST", path: "/admin/requests/:id/assign", auth: bo, status: 201, body: z.object({ driverId: uuid, reason: z.string().min(3).max(300) }), handler: async ({ user, params, input }) => { requirePerm(user, "requests.assign"); return jobs.assignDriver(user, params.id, input.driverId, "manual", input.reason); } },
  { method: "POST", path: "/admin/requests/:id/rematch", auth: bo, handler: ({ user, params }) => rematch(user, params.id) },
  { method: "POST", path: "/admin/requests/:id/fulfil-rental", auth: bo, handler: ({ user, params }) => jobs.fulfilRental(user, params.id) },
  { method: "POST", path: "/admin/offers/:id/replace", auth: bo, body: z.object({ reason: z.string().min(3).max(300) }), handler: ({ user, params, input }) => jobs.staffReplace(user, params.id, input.reason) },
  { method: "POST", path: "/admin/offers/:id/resolve-dispute", auth: bo, body: z.object({ finalUnits: z.number().int().min(0), resolution: z.string().min(3).max(500) }), handler: ({ user, params, input }) => jobs.resolveDispute(user, params.id, input.finalUnits, input.resolution) },
  { method: "GET", path: "/admin/tickets", auth: bo, handler: async ({ user, query }) => { requirePerm(user, "tickets.view"); return listTickets(user, { status: query.get("status") ?? undefined }); } },
  { method: "GET", path: "/admin/complaints", auth: bo, handler: async ({ user, query }) => { requirePerm(user, "complaints.manage"); return listComplaints(user, { status: query.get("status") ?? undefined }); } },
  { method: "PATCH", path: "/admin/complaints/:id", auth: bo, body: z.object({ status: z.string().optional(), resolution: z.string().max(1000).optional(), assignToMe: z.boolean().optional() }), handler: ({ user, params, input }) => updateComplaint(user, params.id, input) },
  { method: "POST", path: "/admin/broadcast", auth: bo, body: z.object({ role: z.enum(["business", "driver", "office"]), message: z.string().min(3).max(300) }), handler: async ({ user, input }) => {
    requirePerm(user, "broadcast.send");
    const ids = await db.select({ id: users.id }).from(users).where(and(eq(users.role, input.role), eq(users.status, "active")));
    await notifyMany(ids.map((i) => i.id), "broadcast", { message: input.message });
    await audit(user, "broadcast", "users", null, { role: input.role, count: ids.length });
    return { sent: ids.length };
  } },

  // Finance
  { method: "GET", path: "/admin/finance/settlements", auth: bo, query: z.object({ status: z.string().optional(), page: z.coerce.number().optional() }), handler: async ({ user, q }) => { requirePerm(user, "finance.view", "settlements.review"); return settle.listSettlements(q); } },
  { method: "POST", path: "/admin/finance/settlements/:id/review", auth: bo, handler: ({ user, params }) => settle.reviewSettlement(user, params.id) },
  { method: "POST", path: "/admin/finance/settlements/:id/approve", auth: bo, handler: ({ user, params }) => settle.approveSettlement(user, params.id) },
  { method: "POST", path: "/admin/finance/settlements/:id/reject", auth: bo, body: z.object({ reason: z.string().min(3).max(300) }), handler: ({ user, params, input }) => settle.rejectSettlement(user, params.id, input.reason) },
  { method: "POST", path: "/admin/finance/settlements/:id/pay", auth: bo, handler: ({ user, params }) => settle.payoutSettlement(user, params.id) },
  { method: "POST", path: "/admin/finance/settlements/:id/retry", auth: bo, handler: ({ user, params }) => settle.retryFailed(user, params.id) },
  { method: "POST", path: "/admin/finance/payout-batches", auth: bo, status: 201, handler: ({ user }) => settle.runPayoutBatch(user) },
  { method: "GET", path: "/admin/finance/summary", auth: bo, handler: async ({ user }) => { requirePerm(user, "finance.view"); return settle.platformSummary(); } },
  { method: "GET", path: "/admin/finance/withdrawals", auth: bo, query: z.object({ status: z.string().optional() }), handler: async ({ user, q }) => { requirePerm(user, "finance.view", "withdrawals.manage"); return { items: await db.select({ w: wd, name: users.name }).from(wd).innerJoin(users, eq(users.id, wd.userId)).where(q.status ? eq(wd.status, q.status) : undefined).orderBy(desc(wd.createdAt)).limit(100).then((r) => r.map((x) => ({ ...x.w, userName: x.name }))) }; } },
  { method: "POST", path: "/admin/finance/withdrawals/:id/decision", auth: bo, body: z.object({ decision: z.enum(["paid", "rejected"]), paymentRef: z.string().max(80).optional(), note: z.string().max(300).optional() }), handler: ({ user, params, input }) => settle.decideWithdrawal(user, params.id, input.decision, input) },

  // Reports & audit
  { method: "GET", path: "/admin/reports/:type", auth: bo, query: z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), page: z.coerce.number().optional(), format: z.enum(["json", "csv"]).optional() }), handler: async ({ user, params, q }) => {
    const r = await report(user, params.type as ReportType, q);
    if (q.format === "csv") {
      requirePerm(user, "reports.export");
      await audit(user, "report.export", "report", params.type, { rows: r.rows.length });
      return new Response(toCsv(r.columns, r.rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${params.type}.csv"` } });
    }
    return r;
  } },
  { method: "GET", path: "/admin/audit", auth: bo, query: z.object({ entity: z.string().optional(), page: z.coerce.number().optional() }), handler: async ({ user, q }) => ({ items: await auditTrail(user, q) }) },
]);
export { tickets, offers, requests, can };
