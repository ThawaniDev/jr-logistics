import { z } from "zod";
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
import { registerUser, findByPhone, loginPassword, changePassword, profileOf, updateProfile, submitDocument, listMyDocuments, readDocument } from "@/server/accounts";
import { getSettings } from "@/server/settings";
import { SERVICES, VEHICLE_TYPES, DRIVER_DOC_TYPES, OFFICE_DOC_TYPES, BUSINESS_DOC_TYPES, TICKET_CATEGORIES, COMPLAINT_CATEGORIES, CUSTODY_ITEM_TYPES } from "@/server/catalog";
import { publicUser } from "@/server/views";
import { listNotifications, markNotificationsRead, createTicket, listTickets, getTicket, replyTicket, resolveTicket, fileComplaint, listComplaints, getComplaint, addComplaintNote } from "@/server/support";
import { topUp, walletView } from "@/server/wallet";
import { requestWithdrawal } from "@/server/settlement";
import { withdrawals } from "@/db/schema";
import { desc } from "drizzle-orm";

const WEB_AGE = 7 * 86400;
const clientOf = (req: Request) => (req.headers.get("x-client") === "mobile" ? "mobile" : "web") as "web" | "mobile";

defineRoutes([
  { method: "GET", path: "/health", auth: "public", handler: async () => { await db.execute("select 1" as never).catch(() => { throw err("DEPENDENCY_UNAVAILABLE", "Database unavailable"); }); return { status: "ok", time: new Date().toISOString() }; } },

  { method: "GET", path: "/catalog", auth: "public", handler: async () => {
    const s = await getSettings();
    return {
      services: SERVICES.filter((x) => s.enabledServices.includes(x.key)), vehicleTypes: VEHICLE_TYPES, temperatures: ["dry", "cold"], temperatureVehicles: ["van", "dyna"],
      cities: s.cities, documents: { driver: DRIVER_DOC_TYPES, office: OFFICE_DOC_TYPES, business: BUSINESS_DOC_TYPES },
      ticketCategories: TICKET_CATEGORIES, complaintCategories: COMPLAINT_CATEGORIES, custodyItemTypes: CUSTODY_ITEM_TYPES,
      terms: { version: s.termsVersion, business: s.termsBusiness, driver: s.termsDriver, office: s.termsOffice },
      policy: { checkinEarlyMin: s.checkinEarlyMin, minWithdrawalCents: s.minWithdrawalCents, cancelPolicyEnabled: s.cancelPolicyEnabled, cancelWarnAt: s.cancelWarnAt, cancelSuspendAt: s.cancelSuspendAt, cancelWindowDays: s.cancelWindowDays, cancelSuspendDays: s.cancelSuspendDays },
      demoMode: env.demoMode,
    };
  } },

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
    nationalId: z.string().max(20).optional(), vehicleType: z.string().optional(), vehicleTemperature: z.string().optional(), vehiclePlate: z.string().max(15).optional(), services: z.array(z.string()).optional(), termsAccepted: z.boolean(),
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
    if (client === "web") ctx.setCookie(SESSION_COOKIE, r.token, WEB_AGE);
    return { token: r.token, user: publicUser(r.user) };
  } },
  { method: "POST", path: "/auth/logout", auth: "user", handler: async (ctx) => { if (ctx.token) await revokeSession(ctx.token); ctx.clearCookie(SESSION_COOKIE); return { ok: true }; } },
  { method: "GET", path: "/auth/me", auth: "user", handler: async ({ user }) => ({ user: publicUser(user), profile: await profileOf(user) }) },
  { method: "POST", path: "/auth/change-password", auth: ["staff", "admin"], body: z.object({ currentPassword: z.string(), newPassword: z.string().min(10).max(200) }), handler: async (ctx) => { await changePassword(ctx.user, ctx.input.currentPassword, ctx.input.newPassword); ctx.clearCookie(SESSION_COOKIE); return { ok: true }; } },

  // ── Profile ──
  { method: "GET", path: "/profile", auth: "user", handler: async ({ user }) => ({ user: publicUser(user), profile: await profileOf(user) }) },
  { method: "PATCH", path: "/profile", auth: "user", body: z.record(z.string(), z.unknown()), handler: async ({ user, input }) => { await updateProfile(user, input); const [u] = await db.select().from(users).where(eq(users.id, user.id)); return { user: publicUser(u), profile: await profileOf(u) }; } },

  // ── Notifications ──
  { method: "GET", path: "/notifications", auth: "user", handler: async ({ user, query }) => listNotifications(user, query.get("unread") === "1") },
  { method: "POST", path: "/notifications/read", auth: "user", body: z.object({ ids: z.array(uuid).optional() }), handler: async ({ user, input }) => { await markNotificationsRead(user, input.ids); return { ok: true }; } },

  // ── Wallet ──
  { method: "GET", path: "/wallet", auth: ["business", "driver", "office"], handler: async ({ user }) => {
    const w = await walletView(user.id);
    return { availableCents: w.account.availableCents, reservedCents: w.account.reservedCents, heldCents: w.account.heldCents, entries: w.entries.map((e) => ({ id: e.id, kind: e.kind, availableDeltaCents: e.availableDeltaCents, reservedDeltaCents: e.reservedDeltaCents, heldDeltaCents: e.heldDeltaCents, simulated: e.simulated, createdAt: e.createdAt })) };
  } },
  { method: "POST", path: "/wallet/topup", auth: ["business"], body: z.object({ amountCents: z.number().int().positive(), idempotencyKey: z.string().min(8).max(80) }), handler: async ({ user, input }) => {
    const s = await getSettings();
    const a = await topUp(user.id, input.amountCents, input.idempotencyKey, s.maxTopupCents);
    return { availableCents: a.availableCents, reservedCents: a.reservedCents, simulated: a.simulated };
  } },
  { method: "GET", path: "/withdrawals", auth: ["driver", "office"], handler: async ({ user }) => ({ items: await db.select().from(withdrawals).where(eq(withdrawals.userId, user.id)).orderBy(desc(withdrawals.createdAt)).limit(50) }) },
  { method: "POST", path: "/withdrawals", auth: ["driver", "office"], status: 201, body: z.object({ amountCents: z.number().int().positive() }), handler: async ({ user, input }) => requestWithdrawal(user, input.amountCents) },

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
  { method: "GET", path: "/tickets", auth: "user", handler: async ({ user, query }) => listTickets(user, { status: query.get("status") ?? undefined }) },
  { method: "POST", path: "/tickets", auth: ["business", "driver", "office"], status: 201, body: z.object({ category: z.string(), subject: z.string().min(3).max(150), body: z.string().max(2000).optional(), requestId: uuid.optional(), offerId: uuid.optional() }), handler: async ({ user, input }) => createTicket(user, input) },
  { method: "GET", path: "/tickets/:id", auth: "user", handler: async ({ user, params }) => getTicket(user, params.id) },
  { method: "POST", path: "/tickets/:id/replies", auth: "user", status: 201, body: z.object({ body: z.string().min(1).max(2000), internal: z.boolean().optional() }), handler: async ({ user, params, input }) => replyTicket(user, params.id, input.body, input.internal) },
  { method: "POST", path: "/tickets/:id/resolve", auth: "user", handler: async ({ user, params }) => resolveTicket(user, params.id) },
  { method: "GET", path: "/complaints", auth: "user", handler: async ({ user, query }) => listComplaints(user, { status: query.get("status") ?? undefined }) },
  { method: "POST", path: "/complaints", auth: ["business", "driver", "office"], status: 201, body: z.object({ category: z.string(), description: z.string().min(10).max(2000), requestId: uuid.optional(), offerId: uuid.optional() }), handler: async ({ user, input }) => fileComplaint(user, input) },
  { method: "GET", path: "/complaints/:id", auth: "user", handler: async ({ user, params }) => getComplaint(user, params.id) },
  { method: "POST", path: "/complaints/:id/notes", auth: "user", status: 201, body: z.object({ body: z.string().min(1).max(2000) }), handler: async ({ user, params, input }) => addComplaintNote(user, params.id, input.body) },
]);
