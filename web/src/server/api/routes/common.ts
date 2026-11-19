import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { eq, or } from "drizzle-orm";
import { defineRoutes } from "../router";
import { uuid, phone } from "../schemas";
import { db } from "@/db";
import { users } from "@/db/schema";
import { err } from "@/lib/errors";
import { env } from "@/lib/env";
import { normalizePhone } from "@/lib/phone";
import { numericCode } from "@/lib/ids";
import { verifyPassword } from "@/server/auth/password";
import { hit } from "@/server/auth/ratelimit";
import { sendOtp, verifyOtp, signRegistrationToken, readRegistrationToken } from "@/server/auth/otp";
import { createSession, revokeSession, SESSION_COOKIE } from "@/server/auth/session";
import { readMfaToken, verifyMfaLogin, startMfaSetup, confirmMfaSetup, disableMfa } from "@/server/auth/mfa";
import { registerUser, findByPhone, loginPassword, finishLogin, changePassword, profileOf, updateProfile, submitDocument, listMyDocuments, readDocument } from "@/server/accounts";
import { getSettings } from "@/server/settings";
import { listRules } from "@/server/pricing";
import { SERVICES, VEHICLE_TYPES, DRIVER_DOC_TYPES, OFFICE_DOC_TYPES, BUSINESS_DOC_TYPES, TICKET_CATEGORIES, COMPLAINT_CATEGORIES, CUSTODY_ITEM_TYPES } from "@/server/catalog";
import { publicUser } from "@/server/views";
import { listNotifications, markNotificationsRead, createTicket, listTickets, getTicket, replyTicket, resolveTicket, reopenTicket, uploadTicketAttachment, readTicketAttachment, fileComplaint, listComplaints, getComplaint, addComplaintNote, ticketFilter } from "@/server/support";
import { topUp, walletView } from "@/server/wallet";
import { requestWithdrawal } from "@/server/settlement";
import { withdrawals } from "@/db/schema";
import { desc } from "drizzle-orm";

const WEB_AGE = 7 * 86400;
/** Largest single money amount accepted from a client (SAR 10 million) — also keeps values inside Postgres integer range. */
const MAX_CENTS = 1_000_000_000;
const clientOf = (req: Request) => (req.headers.get("x-client") === "mobile" ? "mobile" : "web") as "web" | "mobile";


defineRoutes([
  // Public: liveness + database. With the cron secret (`Authorization: Bearer …`) it adds scheduler freshness and queue depths for monitoring.
  { method: "GET", path: "/health", auth: "public", handler: async ({ req }) => {
    const { basicHealth, deepHealth } = await import("@/server/health");
    const given = req.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
    const deep = !!env.cronSecret && given.length === env.cronSecret.length && timingSafeEqual(Buffer.from(given), Buffer.from(env.cronSecret));
    try { return deep ? await deepHealth() : await basicHealth(); }
    catch { throw err("DEPENDENCY_UNAVAILABLE", "Database unavailable"); }
  } },

  { method: "GET", path: "/catalog", auth: "public", handler: async () => {
    const s = await getSettings();
    return {
      services: SERVICES.filter((x) => s.enabledServices.includes(x.key)), vehicleTypes: VEHICLE_TYPES, temperatures: ["dry", "cold"], temperatureVehicles: ["van", "dyna"],
      cities: s.cities, documents: { driver: DRIVER_DOC_TYPES, office: OFFICE_DOC_TYPES, business: BUSINESS_DOC_TYPES },
      ticketCategories: TICKET_CATEGORIES, complaintCategories: COMPLAINT_CATEGORIES, custodyItemTypes: CUSTODY_ITEM_TYPES,
      terms: { version: s.termsVersion, business: s.termsBusiness, driver: s.termsDriver, office: s.termsOffice },
      policy: { checkinEarlyMin: s.checkinEarlyMin, minWithdrawalCents: s.minWithdrawalCents, cancelPolicyEnabled: s.cancelPolicyEnabled, cancelWarnAt: s.cancelWarnAt, cancelSuspendAt: s.cancelSuspendAt, cancelWindowDays: s.cancelWindowDays, cancelSuspendDays: s.cancelSuspendDays, arrivalGeofenceEnabled: s.arrivalGeofenceEnabled, arrivalRadiusM: s.arrivalRadiusM, driverCanReorderRoute: s.driverCanReorderRoute, stopWaitMin: s.stopWaitMin },
      demoMode: env.demoMode,
    };
  } },

  // Indicative public prices = the platform-wide APPROVED rules in force today (never provider cost, never per-business overrides).
  { method: "GET", path: "/pricing/indicative", auth: "public", handler: async () => {
    const now = new Date();
    const rules = (await listRules()).filter((r) => !r.businessId && r.effectiveAt <= now && (!r.expiresAt || r.expiresAt > now));
    return { items: rules.map((r) => ({ service: r.service, vehicleType: r.vehicleType, pickupCity: r.pickupCity, deliveryCity: r.deliveryCity, priceCents: r.priceCents })) };
  } },

  // Public parcel tracking for the person receiving it: parcel code + last 4 digits of their phone, stage only (no address / driver).
  { method: "GET", path: "/track/:code", auth: "public", query: z.object({ p: z.string().max(8) }), handler: async ({ params, q, ip }) => (await import("@/server/stops")).trackShipment(params.code, q.p, ip) },

  { method: "GET", path: "/auth/demo-accounts", auth: "public", handler: async () => {
    if (!env.demoMode) throw err("NOT_FOUND");
    // Demo/testing deployments only (404 otherwise): the super admin is listed too, with its configured password
    // pre-filled — but only while that password still matches, so a changed password is never leaked or wrong.
    const adminEmail = process.env.SUPER_ADMIN_EMAIL?.toLowerCase();
    const adminPw = process.env.SUPER_ADMIN_PASSWORD;
    const rows = await db.select({ role: users.role, name: users.name, phone: users.phone, email: users.email, passwordHash: users.passwordHash, isDemo: users.isDemo }).from(users)
      .where(adminEmail ? or(eq(users.isDemo, true), eq(users.email, adminEmail)) : eq(users.isDemo, true));
    const items = await Promise.all(rows.map(async ({ passwordHash, isDemo, ...r }) =>
      !isDemo && adminPw && (await verifyPassword(adminPw, passwordHash)) ? { ...r, password: adminPw } : isDemo ? r : null));
    return { items: items.filter(Boolean), staffPassword: "Demo#Pass2026" };
  } },

  // ── Auth ──
  { method: "POST", path: "/auth/otp/send", auth: "public", body: z.object({ phone }), handler: async ({ input, ip }) => {
    const p = normalizePhone(input.phone); if (!p) throw err("VALIDATION", "Invalid phone", { field: "phone" });
    const existing = await findByPhone(p);
    // Staff sign in with email+password. Answer exactly like any other number (and send nothing) so this endpoint
    // cannot be used to discover which phone numbers belong to staff.
    if (existing && ["admin", "staff"].includes(existing.role)) {
      await hit(`otp:send:${p}`, 3, 600); await hit(`otp:send:ip:${ip}`, 20, 600);
      return { sent: true, ...(env.demoMode ? { demoCode: numericCode(6) } : {}) };
    }
    const r = await sendOtp(p, ip);
    return { sent: true, ...(r.demoCode ? { demoCode: r.demoCode } : {}) };
  } },
  { method: "POST", path: "/auth/otp/verify", auth: "public", body: z.object({ phone, code: z.string().min(4).max(8) }), handler: async (ctx) => {
    const p = normalizePhone(ctx.input.phone); if (!p) throw err("VALIDATION", "Invalid phone", { field: "phone" });
    await verifyOtp(p, ctx.input.code);
    const u = await findByPhone(p);
    if (!u) return { isNew: true, registrationToken: signRegistrationToken(p) };
    if (u.status !== "active") throw err("FORBIDDEN", "Account suspended");
    if (["admin", "staff"].includes(u.role)) throw err("FORBIDDEN", "Use the staff login");
    const client = clientOf(ctx.req);
    const s = await createSession(u.id, client, ctx.req.headers.get("user-agent") ?? undefined);
    if (client === "web") ctx.setCookie(SESSION_COOKIE, s.token, WEB_AGE);
    return { isNew: false, token: s.token, user: publicUser(u) };
  } },
  { method: "POST", path: "/auth/register", auth: "public", status: 201, body: z.object({
    registrationToken: z.string(), role: z.enum(["business", "driver", "office"]), name: z.string().trim().min(2).max(100), email: z.string().email().nullish(),
    city: z.string().max(40).nullish(), language: z.enum(["ar", "en", "ur"]).optional(), companyName: z.string().max(150).optional(), crNumber: z.string().max(30).optional(),
    industry: z.string().max(80).optional(), address: z.string().max(250).optional(), taxNumber: z.string().max(30).optional(), bankName: z.string().max(80).optional(), iban: z.string().max(34).optional(),
    nationalId: z.string().max(20).optional(), vehicleType: z.string().max(20).optional(), vehicleTemperature: z.string().max(10).optional(), vehiclePlate: z.string().max(15).optional(), services: z.array(z.string().max(40)).max(10).optional(), termsAccepted: z.boolean(),
  }), handler: async (ctx) => {
    const { registrationToken, ...rest } = ctx.input;
    const p = readRegistrationToken(registrationToken);
    const u = await registerUser(p, rest, ctx.ip);
    const client = clientOf(ctx.req);
    const s = await createSession(u.id, client, ctx.req.headers.get("user-agent") ?? undefined);
    if (client === "web") ctx.setCookie(SESSION_COOKIE, s.token, WEB_AGE);
    return { token: s.token, user: publicUser(u) };
  } },
  { method: "POST", path: "/auth/staff/login", auth: "public", body: z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), handler: async (ctx) => {
    const client = clientOf(ctx.req);
    const r = await loginPassword(ctx.input.email, ctx.input.password, ctx.ip, client);
    if (r.mfaRequired) return { mfaRequired: true, mfaToken: r.mfaToken }; // no session until the second step succeeds
    if (client === "web") ctx.setCookie(SESSION_COOKIE, r.token, WEB_AGE);
    return { token: r.token, user: publicUser(r.user) };
  } },
  { method: "POST", path: "/auth/staff/login/mfa", auth: "public", body: z.object({ mfaToken: z.string().min(10).max(2000), code: z.string().min(6).max(20) }), handler: async (ctx) => {
    const client = clientOf(ctx.req);
    const u = await verifyMfaLogin(readMfaToken(ctx.input.mfaToken), ctx.input.code);
    const r = await finishLogin(u, client);
    if (client === "web") ctx.setCookie(SESSION_COOKIE, r.token, WEB_AGE);
    return { token: r.token, user: publicUser(r.user) };
  } },
  // Two-step verification for staff/admin: start → confirm (returns one-time recovery codes) → optionally disable.
  { method: "POST", path: "/auth/mfa/setup", auth: ["staff", "admin"], handler: ({ user }) => startMfaSetup(user) },
  { method: "POST", path: "/auth/mfa/enable", auth: ["staff", "admin"], body: z.object({ code: z.string().min(6).max(8) }), handler: ({ user, input }) => confirmMfaSetup(user, input.code) },
  { method: "POST", path: "/auth/mfa/disable", auth: ["staff", "admin"], body: z.object({ password: z.string().min(1).max(200), code: z.string().min(6).max(20) }), handler: async ({ user, input }) => { await disableMfa(user, input.password, input.code, (await getSettings()).requireStaffMfa); return { ok: true }; } },
  { method: "POST", path: "/auth/logout", auth: "user", handler: async (ctx) => { if (ctx.token) await revokeSession(ctx.token); ctx.clearCookie(SESSION_COOKIE); return { ok: true }; } },
  { method: "GET", path: "/auth/me", auth: "user", handler: async ({ user }) => ({ user: publicUser(user), profile: await profileOf(user) }) },
  { method: "POST", path: "/auth/change-password", auth: ["staff", "admin"], body: z.object({ currentPassword: z.string(), newPassword: z.string().min(10).max(200) }), handler: async (ctx) => { await changePassword(ctx.user, ctx.input.currentPassword, ctx.input.newPassword); ctx.clearCookie(SESSION_COOKIE); return { ok: true }; } },

  // ── Profile ──
  { method: "GET", path: "/profile", auth: "user", handler: async ({ user }) => ({ user: publicUser(user), profile: await profileOf(user) }) },
  { method: "PATCH", path: "/profile", auth: "user", body: z.record(z.string().max(40), z.unknown()), handler: async ({ user, input }) => { await updateProfile(user, input); const [u] = await db.select().from(users).where(eq(users.id, user.id)); return { user: publicUser(u), profile: await profileOf(u) }; } },

  // ── Notifications ──
  { method: "GET", path: "/notifications", auth: "user", handler: async ({ user, query }) => listNotifications(user, (query.get("unread") === "1" || query.get("unreadOnly") === "1"), Math.max(1, Math.floor(Number(query.get("page"))) || 1)) },
  { method: "POST", path: "/notifications/read", auth: "user", body: z.object({ ids: z.array(uuid).optional() }), handler: async ({ user, input }) => { await markNotificationsRead(user, input.ids); return { ok: true }; } },

  // ── Wallet ──
  { method: "GET", path: "/wallet", auth: ["business", "driver", "office"], query: z.object({ page: z.coerce.number().int().min(1).optional(), kind: z.string().max(200).optional() }), handler: async ({ user, q }) => {
    const w = await walletView(user.id, q.page, undefined, q.kind?.split(",").map((k: string) => k.trim()).filter(Boolean).slice(0, 12));
    const s = await getSettings();
    return { page: w.page, pageSize: w.pageSize, total: w.total, availableCents: w.account.availableCents, reservedCents: w.account.reservedCents, heldCents: w.account.heldCents,
      creditLimitCents: w.account.creditLimitCents, maxTopupCents: s.maxTopupCents, // B7: available may go down to -creditLimitCents
      entries: w.entries.map((e) => ({ id: e.id, kind: e.kind, requestId: e.requestId, requestRef: e.requestRef, availableDeltaCents: e.availableDeltaCents, reservedDeltaCents: e.reservedDeltaCents, heldDeltaCents: e.heldDeltaCents, simulated: e.simulated, createdAt: e.createdAt })) };
  } },
  { method: "POST", path: "/wallet/topup", auth: ["business"], body: z.object({ amountCents: z.number().int().positive().max(MAX_CENTS), idempotencyKey: z.string().min(8).max(80) }), handler: async ({ user, input }) => {
    const s = await getSettings();
    const a = await topUp(user.id, input.amountCents, input.idempotencyKey, s.maxTopupCents);
    return { availableCents: a.availableCents, reservedCents: a.reservedCents, simulated: a.simulated };
  } },
  { method: "GET", path: "/withdrawals", auth: ["driver", "office"], handler: async ({ user }) => ({ items: await db.select().from(withdrawals).where(eq(withdrawals.userId, user.id)).orderBy(desc(withdrawals.createdAt)).limit(50) }) },
  { method: "POST", path: "/withdrawals", auth: ["driver", "office"], status: 201, body: z.object({ amountCents: z.number().int().positive().max(MAX_CENTS) }), handler: async ({ user, input }) => requestWithdrawal(user, input.amountCents) },

  // ── Documents ──
  { method: "GET", path: "/documents", auth: ["driver", "office", "business"], handler: async ({ user }) => ({ items: (await listMyDocuments(user.id)).map((d) => ({ ...d, storageKey: undefined })) }) },
  { method: "POST", path: "/documents", auth: ["driver", "office", "business"], status: 201, handler: async ({ user, raw }) => {
    const fd = await raw.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) throw err("VALIDATION", "File required", { field: "file" });
    const d = await submitDocument(user, { type: String(fd.get("type") ?? ""), fileName: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()), expiresOn: (fd.get("expiresOn") as string) || null });
    return { ...d, storageKey: undefined };
  } },
  { method: "GET", path: "/documents/:id/file", auth: "user", handler: async ({ user, params }) => {
    const { doc, data } = await readDocument(user, params.id);
    return new Response(new Uint8Array(data), { headers: { "content-type": doc.mime, "content-disposition": `inline; filename="${doc.fileName}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } },

  // ── Support ──
  { method: "GET", path: "/tickets", auth: "user", handler: async ({ user, query }) => listTickets(user, ticketFilter(query)) },
  { method: "POST", path: "/tickets", auth: ["business", "driver", "office"], status: 201, body: z.object({ category: z.string().max(40), subject: z.string().min(3).max(150), body: z.string().max(2000).optional(), requestId: uuid.optional(), offerId: uuid.optional(), attachmentIds: z.array(uuid).max(3).optional() }), handler: async ({ user, input }) => createTicket(user, input) },
  { method: "GET", path: "/tickets/:id", auth: "user", handler: async ({ user, params }) => getTicket(user, params.id) },
  { method: "POST", path: "/tickets/:id/replies", auth: "user", status: 201, body: z.object({ body: z.string().max(2000).default(""), internal: z.boolean().optional(), attachmentIds: z.array(uuid).max(3).optional() }), handler: async ({ user, params, input }) => replyTicket(user, params.id, input.body, input.internal, input.attachmentIds) },
  { method: "POST", path: "/tickets/:id/resolve", auth: "user", handler: async ({ user, params }) => resolveTicket(user, params.id) },
  { method: "POST", path: "/tickets/:id/reopen", auth: "user", body: z.object({ body: z.string().max(2000).optional(), attachmentIds: z.array(uuid).max(3).optional() }).default({}), handler: async ({ user, params, input }) => reopenTicket(user, params.id, input.body, input.attachmentIds) },
  // Photo / PDF attachments: upload first (unattached), then reference the ids in a ticket message.
  { method: "POST", path: "/uploads/ticket", auth: "user", status: 201, handler: async ({ user, raw }) => {
    const fd = await raw.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) throw err("VALIDATION", "File required", { field: "file" });
    return uploadTicketAttachment(user, { name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()) });
  } },
  { method: "GET", path: "/tickets/attachments/:id", auth: "user", handler: async ({ user, params }) => {
    const { data, mime, name } = await readTicketAttachment(user, params.id);
    return new Response(new Uint8Array(data), { headers: { "content-type": mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": `inline; filename="${name.replace(/["\\]/g, "_")}"` } });
  } },
  { method: "GET", path: "/complaints", auth: "user", handler: async ({ user, query }) => listComplaints(user, ticketFilter(query)) },
  { method: "POST", path: "/complaints", auth: ["business", "driver", "office"], status: 201, body: z.object({ category: z.string().max(40), description: z.string().min(10).max(2000), requestId: uuid.optional(), offerId: uuid.optional() }), handler: async ({ user, input }) => fileComplaint(user, input) },
  { method: "GET", path: "/complaints/:id", auth: "user", handler: async ({ user, params }) => getComplaint(user, params.id) },
  { method: "POST", path: "/complaints/:id/notes", auth: "user", status: 201, body: z.object({ body: z.string().min(1).max(2000) }), handler: async ({ user, params, input }) => addComplaintNote(user, params.id, input.body) },
]);
