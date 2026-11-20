import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { defineRoutes } from "../router";
import { uuid } from "../schemas";
import { db } from "@/db";
import { officeProfiles, users } from "@/db/schema";
import { requirePerm } from "@/server/auth/permissions";
import { accountForEdit, checkIdentifiers, createAccount, updateAccount } from "@/server/account-admin";
import { changeUsername, credentialsOf, resetUserPassword } from "@/server/account-credentials";
import { contains } from "@/lib/sql";

// Admin-side creation and editing of accounts (decision G1). `check`, `office-options` and `:id` are registered in this order on purpose (first match wins).
const bo = "backoffice" as const;
const text = (n: number) => z.string().max(n).nullish();
const num = z.number().nullish();
/** Every editable field of any kind of account; which ones apply to which kind (and which are sensitive) is decided in server/account-admin-rules.ts. */
const fields = {
  name: text(100), phone: text(25), email: text(160), city: text(40), language: z.enum(["ar", "en", "ur"]).optional(),
  companyName: text(150), contactPerson: text(100), industry: text(80), address: text(300), crNumber: text(40), taxNumber: text(40),
  lat: num, lng: num, bankName: text(80), iban: text(40), nationalId: text(30), vehicleType: text(20), vehicleTemperature: text(10), vehiclePlate: text(20),
  services: z.array(z.string().max(40)).max(10).optional(),
};
const extras = { verifyNow: z.object({ reason: z.string().max(500) }).nullish(), sendSms: z.boolean().optional(), officeId: uuid.nullish(), username: z.string().max(60).nullish(), password: z.string().max(200).nullish() };
const createBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("business"), ...fields, ...extras }).strict(),
  z.object({ kind: z.literal("office"), ...fields, ...extras }).strict(),
  z.object({ kind: z.literal("driver"), ...fields, ...extras }).strict(),
]);
const meta = (c: { ip: string; correlationId: string }) => ({ ip: c.ip, correlationId: c.correlationId });

defineRoutes([
  { method: "POST", path: "/admin/accounts", auth: bo, status: 201, body: createBody, handler: ({ user, input, ip, correlationId }) => {
    const { kind, verifyNow, sendSms, officeId, username, password, ...rest } = input;
    return createAccount(user, { kind, fields: rest, verifyNow, sendSms, officeId, username, password }, meta({ ip, correlationId }));
  } },
  // Live duplicate check of the phone / email boxes of the form.
  { method: "GET", path: "/admin/accounts/check", auth: bo, query: z.object({ phone: z.string().max(40).optional(), email: z.string().max(200).optional(), exceptId: uuid.optional() }), handler: ({ user, q }) => checkIdentifiers(user, q) },
  // Active courier offices a new driver can be placed in (the person also needs offices.manage to do it).
  { method: "GET", path: "/admin/accounts/office-options", auth: bo, query: z.object({ q: z.string().max(80).optional() }), handler: async ({ user, q }) => {
    requirePerm(user, "offices.manage");
    const c = q.q?.trim() ? contains(q.q) : null;
    const rows = await db.select({ id: users.id, name: officeProfiles.officeName, city: users.city, verification: officeProfiles.verificationStatus }).from(users).innerJoin(officeProfiles, eq(officeProfiles.userId, users.id))
      .where(and(eq(users.role, "office"), eq(users.status, "active"), c ? sql`${officeProfiles.officeName} ilike ${c}` : undefined)).orderBy(asc(officeProfiles.officeName)).limit(100);
    return { items: rows };
  } },
  { method: "GET", path: "/admin/accounts/:id", auth: bo, handler: ({ user, params }) => accountForEdit(user, params.id) },
  { method: "PATCH", path: "/admin/accounts/:id", auth: bo, body: z.object(fields).strict(), handler: ({ user, params, input, ip, correlationId }) => updateAccount(user, params.id, input, meta({ ip, correlationId })) },

  // How people sign in (J1d). Business / office / driver accounts need `accounts.edit`, a colleague's account `staff.manage`.
  { method: "GET", path: "/admin/users/:id/credentials", auth: bo, handler: ({ user, params }) => credentialsOf(user, params.id) },
  // `password` empty → a strong one is generated and returned once as `password`; either way the person must change it at the next sign-in and every session ends.
  { method: "POST", path: "/admin/users/:id/reset-password", auth: bo, body: z.object({ password: z.string().max(200).nullish() }).default({}), handler: ({ user, params, input, ip, correlationId }) => resetUserPassword(user, params.id, input.password, meta({ ip, correlationId })) },
  { method: "PATCH", path: "/admin/users/:id/username", auth: bo, body: z.object({ username: z.string().min(1).max(60) }), handler: ({ user, params, input, ip, correlationId }) => changeUsername(user, params.id, input.username, meta({ ip, correlationId })) },
]);
