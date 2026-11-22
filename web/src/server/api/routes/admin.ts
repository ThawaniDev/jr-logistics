import { z } from "zod";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { defineRoutes } from "../router";
import { uuid, pageQuery } from "../schemas";
import { db } from "@/db";
import { users, driverProfiles, businessProfiles, officeProfiles, tickets, offers, requests } from "@/db/schema";
import { err } from "@/lib/errors";
import { maskPhoneUsername } from "@/lib/username";
import { ALL_PERMISSIONS, STAFF_PRESETS, SERVICES } from "@/server/catalog";
import { requirePerm, can } from "@/server/auth/permissions";
import { getSettings, updateSettings } from "@/server/settings";
import { patchWarehouseAdmin, warehouseAdminView } from "@/server/warehouse";
import { adminCod, listRemittances, receiveCash } from "@/server/cod";
import { audit } from "@/server/audit";
import { REPORT_TYPES, adminStats, opsAlerts, opsToday, liveMap, smartSuggest, rematch, driverDirectoryPage, clearSuspension, report, toCsv, auditPage } from "@/server/ops";
import { resetStaffMfa } from "@/server/auth/mfa";
import { listUsers, setUserStatus, setAccountVerification, reviewDocument, listDocumentsForReview, createStaff, updateStaff, resetStaffPassword, unlockStaff, profileOf } from "@/server/accounts";
import { createRule, listRules, retireRule } from "@/server/pricing";
import * as settle from "@/server/settlement";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { listRequests, viewRequest } from "@/server/requests";
import { createAgreement, currentAgreements, unlinkDriver } from "@/server/office";
import { listTickets, updateComplaint, listComplaints, ticketFilter, getTicket, staffUpdateTicket, ticketAssignees } from "@/server/support";
import { notifyMany } from "@/server/notify";
import { withdrawals as wd } from "@/db/schema";

const bo = "backoffice" as const;
const maskPhone = (p: string | null) => (p ? p.slice(0, 4) + "•••" + p.slice(-2) : null);
const stripSensitive = <T,>(p: T): T => (p && typeof p === "object" ? { ...(p as object), nationalId: undefined, iban: undefined, bankName: undefined, taxNumber: undefined } as T : p);

defineRoutes([
  { method: "GET", path: "/admin/stats", auth: bo, handler: async ({ user }) => { requirePerm(user, "requests.view", "finance.view", "users.view", "reports.view"); return adminStats(user); } },
  { method: "GET", path: "/admin/meta", auth: bo, handler: async () => ({ permissions: ALL_PERMISSIONS, presets: STAFF_PRESETS, services: SERVICES }) },

  // Settings (admin/settings.edit)
  { method: "GET", path: "/admin/settings", auth: bo, handler: async ({ user }) => { requirePerm(user, "settings.view", "settings.edit"); return getSettings(); } },
  { method: "PATCH", path: "/admin/settings", auth: bo, body: z.object({
    enabledServices: z.array(z.enum(["delivery_driver", "car_with_driver", "car_without_driver"])).min(1).optional(), vatPct: z.number().int().min(0).max(30).optional(), // whole percent: invoices.vat_pct is an integer column (a 7.5 here made every payout fail)
    settlementPeriod: z.enum(["weekly", "monthly"]).optional(), cancelPolicyEnabled: z.boolean().optional(), cancelWarnAt: z.number().int().min(1).max(20).optional(),
    cancelSuspendAt: z.number().int().min(1).max(30).optional(), cancelWindowDays: z.number().int().min(1).max(90).optional(), cancelSuspendDays: z.number().int().min(1).max(90).optional(),
    lateGraceMin: z.number().int().min(0).max(240).optional(), checkinEarlyMin: z.number().int().min(0).max(1440).optional(), officeWindowMin: z.number().int().min(0).max(1440).optional(), stopWaitMin: z.number().int().min(0).max(120).optional(),
    overlapPolicy: z.enum(["time_window", "single_active"]).optional(), requireBusinessVerification: z.boolean().optional(), requireDriverVerification: z.boolean().optional(),
    arrivalGeofenceEnabled: z.boolean().optional(), arrivalRadiusM: z.number().int().min(20).max(5000).optional(), driverCanReorderRoute: z.boolean().optional(),
    routingEnabled: z.boolean().optional(), b2bShipmentsEnabled: z.boolean().optional(), // J2 / J3: super-admin master switches (route planning + one-stop-at-a-time; B2B recipients)
    rescheduleEvidenceText: z.boolean().optional(), rescheduleEvidencePhoto: z.boolean().optional(), driverSingleActiveJob: z.boolean().optional(), stopFailStrictRules: z.boolean().optional(),
    warehouseDefaults: z.object({ requireArrivalConfirmation: z.boolean().optional(), requireLoadingRecord: z.boolean().optional(), requireDeliveryOtp: z.boolean().optional(), requireSignature: z.boolean().optional() }).optional(),
    separationOfDuties: z.boolean().optional(), requireStaffMfa: z.boolean().optional(), minWithdrawalCents: z.number().int().min(0).max(1_000_000_000).optional(), termsVersion: z.string().max(20).optional(),
    termsBusiness: z.string().max(10000).optional(), termsDriver: z.string().max(10000).optional(), termsOffice: z.string().max(10000).optional(),
    cities: z.array(z.object({ key: z.string().min(2).max(40), ar: z.string().max(80), en: z.string().max(80), ur: z.string().max(80), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), pickup: z.boolean(), delivery: z.boolean() })).max(100).optional(),
  }), handler: async ({ user, input }) => {
    requirePerm(user, "settings.edit");
    const before = (await getSettings()) as unknown as Record<string, unknown>;
    const u = await updateSettings(input, user.id);
    // Audit what actually changed (old → new), not the whole payload the form re-sends.
    const changed = Object.fromEntries(Object.entries(input).filter(([k, v]) => JSON.stringify(before[k]) !== JSON.stringify(v)).map(([k, v]) => [k, { from: before[k], to: v }]));
    if (Object.keys(changed).length) await audit(user, "settings.update", "settings", "platform", changed);
    return u;
  } },

  // Per-warehouse location + operating switches (E1/E2/E3/E9/E10)
  { method: "GET", path: "/admin/businesses/:id/warehouse", auth: bo, handler: async ({ user, params }) => { requirePerm(user, "users.view", "users.edit"); return warehouseAdminView(params.id); } },
  { method: "PATCH", path: "/admin/businesses/:id/warehouse", auth: bo, body: z.object({
    lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish(),
    ops: z.object({ requireArrivalConfirmation: z.boolean().nullable().optional(), requireLoadingRecord: z.boolean().nullable().optional(), requireDeliveryOtp: z.boolean().nullable().optional(), requireSignature: z.boolean().nullable().optional() }).optional(),
  }), handler: ({ user, params, input }) => patchWarehouseAdmin(user, params.id, input) },

  // Cash on delivery (E17): who holds the cash, and "Receive money from driver" on behalf of a warehouse
  { method: "GET", path: "/admin/cod", auth: bo, query: z.object({ businessId: uuid.optional(), driverId: uuid.optional(), offerId: uuid.optional(), q: z.string().max(80).optional(), onlyOutstanding: z.enum(["1", "0"]).optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional() }), handler: ({ user, q }) => adminCod(user, { ...q, onlyOutstanding: q.onlyOutstanding === "1" }) },
  { method: "POST", path: "/admin/cod/receive", auth: bo, status: 201, body: z.object({ offerId: uuid, amountCents: z.number().int().min(1).max(1_000_000_000), note: z.string().max(300).nullish() }), handler: ({ user, input }) => receiveCash(user, input.offerId, input.amountCents, input.note) },
  { method: "GET", path: "/admin/cod/remittances", auth: bo, query: z.object({ businessId: uuid.optional(), driverId: uuid.optional(), page: z.coerce.number().int().min(1).optional() }), handler: async ({ user, q }) => { requirePerm(user, "cod.manage", "finance.view"); return listRemittances(q); } },

  // Users & verification
  { method: "GET", path: "/admin/users", auth: bo, query: pageQuery.extend({ role: z.string().optional(), verification: z.string().optional() }), handler: async ({ user, q }) => { if (q.role === "office" || q.role === "business") requirePerm(user, "users.view", "offices.view", "verification.manage"); else requirePerm(user, "users.view");
    // The list used to return every phone number as stored: the same masking rule as the single-user view and the driver directory applies (decision A8).
    const sensitive = can(user, "drivers.sensitive"); const r = await listUsers(q, { phone: sensitive });
    return sensitive ? r : { ...r, items: r.items.map((i) => ({ ...i, phone: maskPhone(i.phone), username: maskPhoneUsername(i.username) })) }; } },
  { method: "GET", path: "/admin/users/:id", auth: bo, handler: async ({ user, params }) => {
    requirePerm(user, "users.view");
    const [u] = await db.select().from(users).where(eq(users.id, params.id)); if (!u) throw err("NOT_FOUND");
    // National ID, IBAN and full phone only for staff cleared for sensitive data (same rule as the driver directory).
    const sensitive = can(user, "drivers.sensitive"); const profile = await profileOf(u);
    return { user: { id: u.id, role: u.role, name: u.name, phone: sensitive ? u.phone : maskPhone(u.phone), email: u.email, city: u.city, status: u.status, createdAt: u.createdAt, staffRole: u.staffRole, permissions: u.permissions }, profile: sensitive ? profile : stripSensitive(profile) };
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
  { method: "GET", path: "/admin/documents", auth: bo, query: z.object({ status: z.string().optional(), kind: z.string().optional(), ownerId: uuid.optional(), page: z.coerce.number().optional() }), handler: async ({ user, q }) => { requirePerm(user, "documents.review", "verification.manage"); return { items: await listDocumentsForReview(q) }; } },
  { method: "POST", path: "/admin/documents/:id/review", auth: bo, body: z.object({ decision: z.enum(["approved", "rejected", "info_requested"]), note: z.string().max(500).optional() }), handler: ({ user, params, input }) => reviewDocument(user, params.id, input.decision, input.note) },
  { method: "GET", path: "/admin/drivers", auth: bo, query: z.object({ q: z.string().max(80).optional(), verification: z.string().max(30).optional(), status: z.enum(["active", "suspended"]).optional(), suspended: z.enum(["0", "1"]).optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional() }), handler: async ({ user, q }) => driverDirectoryPage(user, { ...q, suspended: q.suspended === undefined ? undefined : q.suspended === "1" }) },
  { method: "POST", path: "/admin/drivers/:id/clear-suspension", auth: bo, handler: async ({ user, params }) => { await clearSuspension(user, params.id); return { ok: true }; } },
  { method: "POST", path: "/admin/drivers/:id/unlink-office", auth: bo, handler: async ({ user, params }) => { await unlinkDriver(user, params.id); return { ok: true }; } },
  { method: "POST", path: "/admin/offices/:id/agreements", auth: bo, status: 201, body: z.object({ terms: z.string().max(10000).optional(), expiresAt: z.coerce.date().nullish() }), handler: ({ user, params, input }) => createAgreement(user, params.id, input) },
  { method: "GET", path: "/admin/offices/:id/agreements", auth: bo, handler: async ({ user, params }) => { requirePerm(user, "offices.view"); return { items: await currentAgreements(params.id) }; } },

  // Staff
  { method: "GET", path: "/admin/staff", auth: bo, handler: async ({ user }) => { requirePerm(user, "staff.view", "staff.manage"); return { items: await db.select({ id: users.id, name: users.name, email: users.email, username: users.username, staffRole: users.staffRole, permissions: users.permissions, status: users.status, lockedUntil: users.lockedUntil, totpEnabledAt: users.totpEnabledAt, mustChangePassword: users.mustChangePassword, createdAt: users.createdAt }).from(users).where(eq(users.role, "staff")).orderBy(desc(users.createdAt)) }; } },
  { method: "POST", path: "/admin/staff", auth: bo, status: 201, body: z.object({ name: z.string().min(2).max(100), email: z.string().email().max(160), username: z.string().max(60).optional(), password: z.string().min(10).max(200), staffRole: z.string().max(40).optional(), permissions: z.array(z.string().max(60)).max(100).optional() }), handler: async ({ user, input }) => { const u = await createStaff(user, input as never); return { id: u.id, email: u.email, username: u.username }; } },
  { method: "PATCH", path: "/admin/staff/:id", auth: bo, body: z.object({ name: z.string().max(100).optional(), staffRole: z.string().max(40).nullable().optional(), permissions: z.array(z.string().max(60)).max(100).optional(), status: z.enum(["active", "suspended"]).optional() }), handler: async ({ user, params, input }) => { const u = await updateStaff(user, params.id, input as never); return { id: u.id }; } },

  { method: "POST", path: "/admin/staff/:id/reset-password", auth: bo, body: z.object({ password: z.string().min(10).max(100) }), handler: async ({ user, params, input }) => { await resetStaffPassword(user, params.id, input.password); return { ok: true }; } },
  { method: "POST", path: "/admin/staff/:id/reset-mfa", auth: bo, handler: async ({ user, params }) => { await resetStaffMfa(user, params.id); return { ok: true }; } },
  { method: "POST", path: "/admin/staff/:id/unlock", auth: bo, handler: async ({ user, params }) => { await unlockStaff(user, params.id); return { ok: true }; } },

  // Pricing
  { method: "GET", path: "/admin/pricing", auth: bo, query: z.object({ service: z.string().optional(), businessId: z.string().optional(), all: z.string().optional() }), handler: async ({ user, q }) => { requirePerm(user, "pricing.view", "pricing.edit"); return { items: await listRules({ service: q.service, businessId: q.businessId, includeRetired: q.all === "1" }) }; } },
  { method: "POST", path: "/admin/pricing", auth: bo, status: 201, body: z.object({
    service: z.enum(["delivery_driver", "car_with_driver", "car_without_driver"]), vehicleType: z.string().nullish(), temperature: z.string().nullish(), pickupCity: z.string().nullish(), deliveryCity: z.string().nullish(),
    businessId: uuid.nullish(), priceCents: z.number().int().positive().max(100_000_000), providerCostCents: z.number().int().min(0).max(100_000_000), agreementRef: z.string().max(80).nullish(), effectiveAt: z.coerce.date().optional(), expiresAt: z.coerce.date().nullish(), notes: z.string().max(300).nullish(),
  }), handler: async ({ user, input }) => { requirePerm(user, "pricing.edit"); return createRule(user, input); } },
  { method: "POST", path: "/admin/pricing/:id/retire", auth: bo, handler: async ({ user, params }) => { requirePerm(user, "pricing.edit"); return retireRule(user, params.id); } },

  // Requests & operations
  { method: "GET", path: "/admin/requests", auth: bo, query: pageQuery.extend({ city: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), businessId: uuid.optional() }), handler: async ({ user, q }) => { requirePerm(user, "requests.view"); const r = await listRequests({ ...q, matchBusiness: true });
    const ids = [...new Set(r.items.map((x) => x.businessId))];
    const biz = ids.length ? await db.select({ id: users.id, name: users.name, phone: users.phone, company: businessProfiles.companyName }).from(users).leftJoin(businessProfiles, eq(businessProfiles.userId, users.id)).where(inArray(users.id, ids)) : [];
    const nm = new Map(biz.map((b) => [b.id, b]));
    return { ...r, items: r.items.map((x) => ({ ...viewRequest(x, user), businessName: nm.get(x.businessId)?.company ?? nm.get(x.businessId)?.name ?? null, businessPhone: can(user, "drivers.sensitive") ? nm.get(x.businessId)?.phone ?? null : maskPhone(nm.get(x.businessId)?.phone ?? null) })) }; } },
  { method: "GET", path: "/admin/shipments/search", auth: bo, query: z.object({ q: z.string().max(80), status: z.string().max(20).optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional() }), handler: ({ user, q }) => stops.searchShipments(user, q) },
  { method: "GET", path: "/admin/ops/today", auth: bo, handler: async ({ user }) => { requirePerm(user, "requests.view"); return opsToday(); } },
  { method: "GET", path: "/admin/ops/alerts", auth: bo, handler: async ({ user }) => { requirePerm(user, "requests.view"); return { items: await opsAlerts() }; } },
  { method: "GET", path: "/admin/ops/map", auth: bo, handler: async ({ user }) => ({ items: await liveMap(user) }) },
  { method: "GET", path: "/admin/requests/:id/suggest", auth: bo, handler: async ({ user, params }) => ({ items: await smartSuggest(user, params.id) }) },
  { method: "POST", path: "/admin/requests/:id/assign", auth: bo, status: 201, body: z.object({ driverId: uuid, reason: z.string().min(3).max(300) }), handler: async ({ user, params, input }) => { requirePerm(user, "requests.assign"); return jobs.assignDriver(user, params.id, input.driverId, "manual", input.reason); } },
  { method: "POST", path: "/admin/requests/:id/rematch", auth: bo, handler: ({ user, params }) => rematch(user, params.id) },
  { method: "POST", path: "/admin/requests/:id/fulfil-rental", auth: bo, handler: ({ user, params }) => jobs.fulfilRental(user, params.id) },
  { method: "POST", path: "/admin/offers/:id/replace", auth: bo, body: z.object({ reason: z.string().min(3).max(300) }), handler: ({ user, params, input }) => jobs.staffReplace(user, params.id, input.reason) },
  { method: "POST", path: "/admin/offers/:id/resolve-dispute", auth: bo, body: z.object({ finalUnits: z.number().int().min(0).max(100000), resolution: z.string().min(3).max(500) }), handler: ({ user, params, input }) => jobs.resolveDispute(user, params.id, input.finalUnits, input.resolution) },
  { method: "GET", path: "/admin/tickets", auth: bo, handler: async ({ user, query }) => { requirePerm(user, "tickets.view"); return listTickets(user, ticketFilter(query)); } },
  { method: "GET", path: "/admin/tickets/assignees", auth: bo, handler: ({ user }) => ticketAssignees(user) },
  { method: "GET", path: "/admin/tickets/:id", auth: bo, handler: async ({ user, params }) => { requirePerm(user, "tickets.view"); return getTicket(user, params.id); } },
  { method: "PATCH", path: "/admin/tickets/:id", auth: bo, body: z.object({ status: z.enum(["open", "in_review", "resolved"]).optional(), priority: z.enum(["normal", "urgent"]).optional(), assignTo: uuid.nullable().optional(), assignToMe: z.boolean().optional() }), handler: ({ user, params, input }) => staffUpdateTicket(user, params.id, input) },
  { method: "GET", path: "/admin/complaints", auth: bo, handler: async ({ user, query }) => { requirePerm(user, "complaints.manage"); return listComplaints(user, ticketFilter(query)); } },
  { method: "PATCH", path: "/admin/complaints/:id", auth: bo, body: z.object({ status: z.string().optional(), resolution: z.string().max(1000).optional(), assignToMe: z.boolean().optional(), assignTo: uuid.optional(), holdsSettlement: z.boolean().optional() }), handler: ({ user, params, input }) => updateComplaint(user, params.id, input) },
  { method: "POST", path: "/admin/broadcast", auth: bo, body: z.object({ role: z.enum(["all", "business", "driver", "office"]), message: z.string().min(3).max(300) }), handler: async ({ user, input }) => {
    requirePerm(user, "broadcast.send");
    const ids = await db.select({ id: users.id }).from(users).where(and(input.role === "all" ? inArray(users.role, ["business", "driver", "office"]) : eq(users.role, input.role), eq(users.status, "active")));
    await notifyMany(ids.map((i) => i.id), "broadcast", { message: input.message });
    await audit(user, "broadcast", "users", null, { role: input.role, count: ids.length });
    return { sent: ids.length };
  } },

  // Finance
  { method: "GET", path: "/admin/finance/settlements", auth: bo, query: z.object({ status: z.string().optional(), q: z.string().max(80).optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional(), payeeId: uuid.optional(), businessId: uuid.optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }), handler: async ({ user, q }) => { requirePerm(user, "finance.view", "settlements.review"); return settle.listSettlements(q); } },
  { method: "GET", path: "/admin/finance/summary", auth: bo, handler: async ({ user }) => { requirePerm(user, "finance.view"); return settle.platformSummary(); } },
  { method: "GET", path: "/admin/finance/withdrawals", auth: bo, query: z.object({ status: z.string().optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional() }), handler: async ({ user, q }) => {
    requirePerm(user, "finance.view", "withdrawals.manage");
    const size = q.pageSize ?? 25, p = q.page ?? 1, where = q.status ? eq(wd.status, q.status) : undefined;
    const [rows, [{ n }]] = await Promise.all([
      db.select({ w: wd, name: users.name, role: users.role, balance: sql<number>`(select available_cents::float8 from wallet_accounts where owner_id = ${wd.userId})` }).from(wd).innerJoin(users, eq(users.id, wd.userId)).where(where).orderBy(desc(wd.createdAt)).limit(size).offset((p - 1) * size),
      db.select({ n: count() }).from(wd).where(where),
    ]);
    // The full IBAN is for the people who pay the withdrawal (and HR with `drivers.sensitive`); anyone else with `finance.view` sees the last four digits (decision A8).
    const fullIban = can(user, "withdrawals.manage") || can(user, "drivers.sensitive");
    return { page: p, pageSize: size, total: Number(n), items: rows.map((x) => ({ ...x.w, iban: fullIban ? x.w.iban : `•••• ${x.w.iban.slice(-4)}`, userName: x.name, userRole: x.role, balanceCents: x.balance })) };
  } },
  { method: "POST", path: "/admin/finance/withdrawals/:id/decision", auth: bo, body: z.object({ decision: z.enum(["paid", "rejected"]), paymentRef: z.string().max(80).optional(), note: z.string().max(300).optional() }), handler: ({ user, params, input }) => settle.decideWithdrawal(user, params.id, input.decision, input) },

  // Reports & audit
  { method: "GET", path: "/admin/reports/:type", auth: bo, query: z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(1000).optional(), format: z.enum(["json", "csv"]).optional() }), handler: async ({ user, params, q }) => {
    const type = z.enum(REPORT_TYPES).safeParse(params.type);
    if (!type.success) throw err("NOT_FOUND", "Unknown report");
    if (q.format === "csv") {
      requirePerm(user, "reports.export");
      // The export is the whole period, not the first page: walk every page (hard ceiling guards memory).
      const first = await report(user, type.data, { ...q, page: 1, pageSize: 1000 });
      let rows: Array<Record<string, unknown>> = first.rows;
      for (let page = 2; rows.length === (page - 1) * 1000 && page <= 100; page++) rows = rows.concat((await report(user, type.data, { ...q, page, pageSize: 1000 })).rows);
      await audit(user, "report.export", "report", params.type, { rows: rows.length });
      return new Response(toCsv(first.columns, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${params.type}.csv"` } });
    }
    return report(user, type.data, q);
  } },
  { method: "GET", path: "/admin/audit", auth: bo, query: z.object({ entity: z.string().max(40).optional(), actorId: uuid.optional(), action: z.string().max(60).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional() }), handler: async ({ user, q }) => auditPage(user, q) },
]);
export { tickets, offers, requests, can };
