import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { asc, eq, or, sql } from "drizzle-orm";
import { defineRoutes } from "../router";
import { uuid, phone } from "../schemas";
import { db } from "@/db";
import { users } from "@/db/schema";
import { err } from "@/lib/errors";
import { env } from "@/lib/env";
import { verifyPassword } from "@/server/auth/password";
import { hit } from "@/server/auth/ratelimit";
import { openSession, revokeSession, SESSION_COOKIE } from "@/server/auth/session";
import { sessionUser } from "@/server/auth/session-user";
import { usernameAvailability } from "@/server/auth/username";
import { recordLogin } from "@/server/data-capture";
import { readMfaToken, verifyMfaLogin, startMfaSetup, confirmMfaSetup, disableMfa } from "@/server/auth/mfa";
import { registerUser, loginWithPassword, finishLogin, changePassword, profileOf, updateProfile, submitDocument, listMyDocuments, readDocument } from "@/server/accounts";
import { getSettings } from "@/server/settings";
import { listRules } from "@/server/pricing";
import { SERVICES, VEHICLE_TYPES, DRIVER_DOC_TYPES, OFFICE_DOC_TYPES, BUSINESS_DOC_TYPES, TICKET_CATEGORIES, COMPLAINT_CATEGORIES, CUSTODY_ITEM_TYPES } from "@/server/catalog";
import { markNotificationsRead, createTicket, listTickets, getTicket, replyTicket, resolveTicket, reopenTicket, uploadTicketAttachment, readTicketAttachment, fileComplaint, listComplaints, getComplaint, addComplaintNote, ticketFilter } from "@/server/support";
import { topUp, walletView } from "@/server/wallet";
import { listMyNotifications, managedWalletPayload, walletPolicy } from "@/server/driver-wallet-policy";
import { requestWithdrawal } from "@/server/settlement";
import { withdrawals } from "@/db/schema";
import { desc } from "drizzle-orm";

const WEB_AGE = 7 * 86400;
/** Largest single money amount accepted from a client (SAR 10 million) — also keeps values inside Postgres integer range. */
const MAX_CENTS = 1_000_000_000;
const clientOf = (req: Request) => (req.headers.get("x-client") === "mobile" ? "mobile" : "web") as "web" | "mobile";
/** The one published password of the demo accounts (demo deployments only: `/auth/demo-accounts` is a 404 otherwise). */
const DEMO_PASSWORD = "Demo#Pass2026";

/** Shared by `/auth/login` and its `/auth/staff/login` alias: `{ token, user }`, or `{ mfaRequired, mfaToken }` when the account has two-step verification (no session until step two). */
async function signIn(ctx: { req: Request; ip: string; setCookie: (n: string, v: string, age: number) => void }, identifier: string, password: string) {
  const client = clientOf(ctx.req);
  const r = await loginWithPassword(identifier, password, ctx.ip, client, ctx.req.headers.get("user-agent") ?? undefined);
  if (r.mfaRequired) return { mfaRequired: true, mfaToken: r.mfaToken };
  if (client === "web") ctx.setCookie(SESSION_COOKIE, r.token, WEB_AGE);
  return { token: r.token, user: sessionUser(r.user) };
}


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
      policy: { checkinEarlyMin: s.checkinEarlyMin, minWithdrawalCents: s.minWithdrawalCents, cancelPolicyEnabled: s.cancelPolicyEnabled, cancelWarnAt: s.cancelWarnAt, cancelSuspendAt: s.cancelSuspendAt, cancelWindowDays: s.cancelWindowDays, cancelSuspendDays: s.cancelSuspendDays, arrivalGeofenceEnabled: s.arrivalGeofenceEnabled, arrivalRadiusM: s.arrivalRadiusM, driverCanReorderRoute: s.routingEnabled && s.driverCanReorderRoute, stopWaitMin: s.stopWaitMin, routingEnabled: s.routingEnabled, b2bShipmentsEnabled: s.b2bShipmentsEnabled },
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

  // Demo / testing deployments only (404 otherwise): the quick-fill buttons of the sign-in page. Demo accounts share one published password; the super admin is listed
  // too, with its configured password pre-filled — but only while that password still matches, so a changed password is never leaked or wrong.
  { method: "GET", path: "/auth/demo-accounts", auth: "public", handler: async () => {
    if (!env.demoMode) throw err("NOT_FOUND");
    const adminEmail = process.env.SUPER_ADMIN_EMAIL?.toLowerCase();
    const adminPw = process.env.SUPER_ADMIN_PASSWORD;
    const rows = await db.select({ role: users.role, name: users.name, username: users.username, phone: users.phone, email: users.email, passwordHash: users.passwordHash, isDemo: users.isDemo }).from(users)
      .where(adminEmail ? or(eq(users.isDemo, true), eq(users.email, adminEmail)) : eq(users.isDemo, true))
      .orderBy(sql`array_position(array['business','driver','office','staff','admin'], ${users.role})`, asc(users.username));
    const items = await Promise.all(rows.map(async ({ passwordHash, isDemo, ...r }) => {
      if (!r.username) return null; // nobody can sign in without one (run `npm run db:backfill:auth`)
      if (isDemo) return { ...r, password: DEMO_PASSWORD };
      return adminPw && (await verifyPassword(adminPw, passwordHash)) ? { ...r, password: adminPw } : null;
    }));
    return { items: items.filter(Boolean) };
  } },

  // ── Auth: username + password for every role (J1). There is no one-time-code sign-in any more. ──
  // Public and rate limited per ip: is this username valid and free? (the registration form asks while the person types)
  { method: "GET", path: "/auth/username-available", auth: "public", query: z.object({ username: z.string().max(80) }), handler: async ({ q, ip }) => {
    await hit(`uname:${ip}`, env.demoMode ? 1000 : 60, 60);
    return usernameAvailability(q.username);
  } },
  { method: "POST", path: "/auth/login", auth: "public", body: z.object({ username: z.string().min(1).max(200), password: z.string().min(1).max(200) }), handler: (ctx) => signIn(ctx, ctx.input.username, ctx.input.password) },
  // The staff sign-in of before: same thing (the e-mail address is an accepted identifier), so nothing that still calls it breaks.
  { method: "POST", path: "/auth/staff/login", auth: "public", body: z.object({ username: z.string().min(1).max(200).optional(), email: z.string().min(1).max(200).optional(), password: z.string().min(1).max(200) }).refine((b) => !!(b.username || b.email), { message: "username required" }), handler: (ctx) => signIn(ctx, (ctx.input.username ?? ctx.input.email)!, ctx.input.password) },
  { method: "POST", path: "/auth/register", auth: "public", status: 201, body: z.object({
    role: z.enum(["business", "driver", "office"]), username: z.string().min(1).max(60), password: z.string().min(1).max(200), name: z.string().trim().min(2).max(100), phone, email: z.string().email().nullish(),
    city: z.string().max(40).nullish(), language: z.enum(["ar", "en", "ur"]).optional(), companyName: z.string().max(150).optional(), crNumber: z.string().max(30).optional(),
    industry: z.string().max(80).optional(), address: z.string().max(250).optional(), taxNumber: z.string().max(30).optional(), bankName: z.string().max(80).optional(), iban: z.string().max(34).optional(),
    nationalId: z.string().max(20).optional(), vehicleType: z.string().max(20).optional(), vehicleTemperature: z.string().max(10).optional(), vehiclePlate: z.string().max(15).optional(), services: z.array(z.string().max(40)).max(10).optional(), termsAccepted: z.boolean(),
  }), handler: async (ctx) => {
    await hit(`register:${ctx.ip}`, env.demoMode ? 50 : 5, 3600);
    const u = await registerUser(ctx.input, ctx.ip);
    const client = clientOf(ctx.req);
    const s = await openSession(u, { client, userAgent: ctx.req.headers.get("user-agent") ?? undefined, ip: ctx.ip, method: "password" });
    if (client === "web") ctx.setCookie(SESSION_COOKIE, s.token, WEB_AGE);
    return { token: s.token, user: sessionUser(u) };
  } },
  { method: "POST", path: "/auth/staff/login/mfa", auth: "public", body: z.object({ mfaToken: z.string().min(10).max(2000), code: z.string().min(6).max(20) }), handler: async (ctx) => {
    const client = clientOf(ctx.req);
    const ua = ctx.req.headers.get("user-agent") ?? undefined, uid = readMfaToken(ctx.input.mfaToken);
    let u;
    try { u = await verifyMfaLogin(uid, ctx.input.code); }
    catch (e) { await recordLogin({ userId: uid, method: "password", success: false, failureReason: "mfa_failed", ip: ctx.ip, userAgent: ua, client }); throw e; }
    const r = await finishLogin(u, client, { ip: ctx.ip, userAgent: ua });
    if (client === "web") ctx.setCookie(SESSION_COOKIE, r.token, WEB_AGE);
    return { token: r.token, user: sessionUser(r.user) };
  } },
  // Two-step verification for staff/admin: start → confirm (returns one-time recovery codes) → optionally disable.
  { method: "POST", path: "/auth/mfa/setup", auth: ["staff", "admin"], handler: ({ user }) => startMfaSetup(user) },
  { method: "POST", path: "/auth/mfa/enable", auth: ["staff", "admin"], body: z.object({ code: z.string().min(6).max(8) }), handler: ({ user, input }) => confirmMfaSetup(user, input.code) },
  { method: "POST", path: "/auth/mfa/disable", auth: ["staff", "admin"], body: z.object({ password: z.string().min(1).max(200), code: z.string().min(6).max(20) }), handler: async ({ user, input }) => { await disableMfa(user, input.password, input.code, (await getSettings()).requireStaffMfa); return { ok: true }; } },
  { method: "POST", path: "/auth/logout", auth: "user", handler: async (ctx) => { if (ctx.token) await revokeSession(ctx.token); ctx.clearCookie(SESSION_COOKIE); return { ok: true }; } },
  { method: "GET", path: "/auth/me", auth: "user", handler: async ({ user }) => ({ user: sessionUser(user), profile: await profileOf(user) }) },
  // Every role. The other sessions of the user end; the one in use stays signed in.
  { method: "POST", path: "/auth/change-password", auth: "user", body: z.object({ currentPassword: z.string().max(200), newPassword: z.string().min(10).max(200) }), handler: async (ctx) => { await changePassword(ctx.user, ctx.input.currentPassword, ctx.input.newPassword, ctx.token); return { ok: true }; } },

  // ── Profile ──
  { method: "GET", path: "/profile", auth: "user", handler: async ({ user }) => ({ user: sessionUser(user), profile: await profileOf(user) }) },
  { method: "PATCH", path: "/profile", auth: "user", body: z.record(z.string().max(40), z.unknown()), handler: async ({ user, input }) => { await updateProfile(user, input); const [u] = await db.select().from(users).where(eq(users.id, user.id)); return { user: sessionUser(u), profile: await profileOf(u) }; } },

  // ── Notifications ──
  { method: "GET", path: "/notifications", auth: "user", handler: async ({ user, query }) => listMyNotifications(user, (query.get("unread") === "1" || query.get("unreadOnly") === "1"), Math.max(1, Math.floor(Number(query.get("page"))) || 1)) },
  { method: "POST", path: "/notifications/read", auth: "user", body: z.object({ ids: z.array(uuid).optional() }), handler: async ({ user, input }) => { await markNotificationsRead(user, input.ids); return { ok: true }; } },

  // ── Wallet ──
  { method: "GET", path: "/wallet", auth: ["business", "driver", "office"], query: z.object({ page: z.coerce.number().int().min(1).optional(), kind: z.string().max(200).optional() }), handler: async ({ user, q }) => {
    if (user.role === "driver") { const pol = await walletPolicy(user.id); if (pol.managedByOffice) return managedWalletPayload(pol); } // J4: the office manages an office driver's wallet
    const w = await walletView(user.id, q.page, undefined, q.kind?.split(",").map((k: string) => k.trim()).filter(Boolean).slice(0, 12));
    const s = await getSettings();
    return { managedByOffice: false, page: w.page, pageSize: w.pageSize, total: w.total, availableCents: w.account.availableCents, reservedCents: w.account.reservedCents, heldCents: w.account.heldCents,
      creditLimitCents: w.account.creditLimitCents, maxTopupCents: s.maxTopupCents, // B7: available may go down to -creditLimitCents
      entries: w.entries.map((e) => ({ id: e.id, kind: e.kind, requestId: e.requestId, requestRef: e.requestRef, availableDeltaCents: e.availableDeltaCents, reservedDeltaCents: e.reservedDeltaCents, heldDeltaCents: e.heldDeltaCents, simulated: e.simulated, createdAt: e.createdAt })) };
  } },
  { method: "POST", path: "/wallet/topup", auth: ["business"], body: z.object({ amountCents: z.number().int().positive().max(MAX_CENTS), idempotencyKey: z.string().min(8).max(80) }), handler: async ({ user, input }) => {
    const s = await getSettings();
    const a = await topUp(user.id, input.amountCents, input.idempotencyKey, s.maxTopupCents);
    return { availableCents: a.availableCents, reservedCents: a.reservedCents, simulated: a.simulated };
  } },
  { method: "GET", path: "/withdrawals", auth: ["driver", "office"], handler: async ({ user }) => ({ items: user.role === "driver" && (await walletPolicy(user.id)).managedByOffice ? [] : await db.select().from(withdrawals).where(eq(withdrawals.userId, user.id)).orderBy(desc(withdrawals.createdAt)).limit(50) }) },
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
