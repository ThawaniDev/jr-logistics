/**
 * Staff create and edit accounts (decision G1 / G1a). A created account is exactly what a self-registration would have produced (user, profile, wallet,
 * pending-invitation link) with `users.source = 'admin'` and `users.created_by = <staff>`; the person signs in with the username and the temporary password the
 * staff member gave them (J1) and must choose a new password at the first sign-in. Nothing here ever touches staff/admin accounts or changes a role.
 * Pure rules live in account-admin-rules.ts; password resets and username changes live in account-credentials.ts.
 */
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { businessProfiles, driverProfiles, officeInvites, officeProfiles, users, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { logError } from "@/lib/log";
import { env } from "@/lib/env";
import { normalizePhone } from "@/lib/phone";
import { translate } from "@/i18n/core";
import { getSettings } from "./settings";
import { audit } from "./audit";
import { notify, notifyOps } from "./notify";
import { ensureAccount } from "./wallet";
import { can, requirePerm } from "./auth/permissions";
import { hit } from "./auth/ratelimit";
import { activeSmsProvider } from "./auth/otp";
import { generatePassword, hashPassword, passwordProblem } from "./auth/password";
import { normalizeUsername, uniqueUsername, usernameFromPhone, usernameProblem, usernameTaken } from "./auth/username";
import { revokeAllSessions } from "./auth/session";
import { setWarehouseLocation } from "./warehouse";
import { profileOf } from "./accounts";
import {
  PROFILE_FIELDS, checkFields, diffFields, isAccountKind, latinDigits, maskDiff, maskPhone, sensitiveIn,
  type AccountKind, type Cleaned,
} from "./account-admin-rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Meta = { ip?: string; correlationId?: string };
export interface CreateInput {
  kind: AccountKind; fields: Record<string, unknown>;
  /** Mark the account verified now (needs `verification.manage` and a reason that is kept in the audit log). */
  verifyNow?: { reason: string } | null;
  /** Driver only: put the driver in this courier office's fleet right away (needs `offices.manage`). */
  officeId?: string | null;
  /** Text the person a sign-in link. Never blocks creation. */
  sendSms?: boolean;
  /** The name the person signs in with. Left out: `u` + the digits of the phone, numbered when taken. */
  username?: string | null;
  /** The temporary password (the person must replace it at the first sign-in). Left out: a strong one is generated and returned once as `generatedPassword`. */
  password?: string | null;
}
export type SmsResult = "sent" | "demo" | "unavailable" | "failed" | "skipped";

const fail = (errors: Record<string, string>) => err("VALIDATION", "Invalid input", errors);
const dupMessage = { phone: "An account with this phone number already exists", email: "An account with this email already exists", username: "This username is already taken" };

async function ruleContext() {
  const s = await getSettings();
  return { cityKeys: s.cities.map((c) => c.key), enabledServices: s.enabledServices as readonly string[] };
}
function needSensitive(staff: User, kind: AccountKind, fields: Record<string, unknown>) {
  const found = sensitiveIn(kind, fields);
  if (found.length && !can(staff, "drivers.sensitive")) throw err("FORBIDDEN", "Personal and payout details need the drivers.sensitive permission", { field: found[0], fields: found });
}

/** Who already holds this phone / email (staff and admins included — they only ever show up as "taken", never by name). */
export async function findDuplicates(staff: Pick<User, "role" | "permissions">, o: { phone?: string | null; email?: string | null; exceptId?: string }) {
  const out: { phone?: DupInfo; email?: DupInfo } = {};
  const look = async (col: typeof users.phone | typeof users.email, v: string): Promise<DupInfo> => {
    const [r] = await db.select({ id: users.id, role: users.role, name: users.name }).from(users).where(and(eq(col, v), o.exceptId ? ne(users.id, o.exceptId) : undefined)).limit(1);
    if (!r) return { taken: false };
    const named = can(staff, "users.view") && isAccountKind(r.role);
    return { taken: true, account: named ? { id: r.id, role: r.role as AccountKind, name: r.name } : null };
  };
  if (o.phone) out.phone = await look(users.phone, o.phone);
  if (o.email) out.email = await look(users.email, o.email.toLowerCase());
  return out;
}
export interface DupInfo { taken: boolean; account?: { id: string; role: AccountKind; name: string } | null }

/** `GET /admin/accounts/check`: live duplicate check for the form's phone and email boxes. */
export async function checkIdentifiers(staff: User, q: { phone?: string; email?: string; exceptId?: string }) {
  requirePerm(staff, "accounts.create", "accounts.edit");
  await hit(`acct-check:${staff.id}`, 240, 60); // the form asks while typing (debounced); this still bounds number-probing by a rogue session
  const phone = q.phone ? normalizePhone(latinDigits(q.phone)) : null;
  const email = q.email?.trim() || null;
  const emailOk = !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const dup = await findDuplicates(staff, { phone, email: emailOk ? email : null, exceptId: q.exceptId });
  return {
    phone: q.phone ? { valid: !!phone, normalized: phone, taken: !!dup.phone?.taken, account: dup.phone?.account ?? null } : undefined,
    email: email ? { valid: emailOk, taken: !!dup.email?.taken, account: dup.email?.account ?? null } : undefined,
  };
}

async function sendSignInSms(phone: string, language: string, username: string, meta?: Meta): Promise<SmsResult> {
  const p = activeSmsProvider();
  if (!p) return "unavailable";
  try {
    const { dictionaries } = await import("@/i18n/dictionaries");
    const d = dictionaries[(["ar", "en", "ur"].includes(language) ? language : "ar") as "ar" | "en" | "ur"];
    await p.send(phone, translate(d, dictionaries.en, "acr.sms_welcome", { url: env.appUrl, username }));
    return p.name === "demo" ? "demo" : "sent";
  } catch (e) { logError(e, { correlationId: meta?.correlationId ?? "account-sms" }); return "failed"; }
}

/** What the staff member who created / edited the account may see of it: sensitive profile fields only with `drivers.sensitive`. */
export async function viewAccount(staff: User, u: User) {
  const raw = (await profileOf(u)) as Record<string, unknown> | null;
  const sens = can(staff, "drivers.sensitive");
  const hide = ["nationalId", "iban", "bankName", ...(u.role === "business" ? [] : ["taxNumber"])]; // a company's VAT number is not personal or payout data
  const profile = raw && isAccountKind(u.role) && !sens ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, hide.includes(k) ? null : v])) : raw;
  return { user: { id: u.id, role: u.role, name: u.name, username: u.username, phone: sens ? u.phone : maskPhone(u.phone), email: u.email, city: u.city, language: u.language, status: u.status, source: u.source, createdBy: u.createdBy, createdAt: u.createdAt }, profile };
}

export async function createAccount(staff: User, input: CreateInput, meta?: Meta) {
  requirePerm(staff, "accounts.create");
  const { kind, fields } = input;
  if (!isAccountKind(kind)) throw err("VALIDATION", "Unknown kind of account", { kind: "Unknown kind of account" });
  needSensitive(staff, kind, fields);
  if (input.verifyNow) requirePerm(staff, "verification.manage");
  const { values, errors } = checkFields(kind, fields, await ruleContext());
  const reason = input.verifyNow?.reason?.trim();
  if (input.verifyNow && (!reason || reason.length < 3)) errors.verifyReason = "A reason is required to mark an account verified";
  const typedUsername = input.username?.trim() ? normalizeUsername(input.username) : null;
  if (typedUsername) { const bad = usernameProblem(typedUsername); if (bad) errors.username = bad === "reserved" ? "This username is reserved" : "Invalid username"; }
  const typedPassword = input.password ? input.password : null;
  if (typedPassword) { const bad = passwordProblem(typedPassword); if (bad) errors.password = bad; }
  if (Object.keys(errors).length) throw fail(errors);
  let office: { id: string; name: string } | null = null;
  if (input.officeId) {
    if (kind !== "driver") throw fail({ officeId: "Only drivers can join a courier office" });
    requirePerm(staff, "offices.manage");
    const [o] = await db.select({ id: users.id, status: users.status, name: officeProfiles.officeName }).from(users).innerJoin(officeProfiles, eq(officeProfiles.userId, users.id)).where(and(eq(users.id, input.officeId), eq(users.role, "office")));
    if (!o || o.status !== "active") throw fail({ officeId: "Choose an active courier office" });
    office = { id: o.id, name: o.name };
  }
  const phone = values.phone as string; const email = (values.email as string | null) ?? null; const language = (values.language as string) ?? "ar";
  const dup = await findDuplicates(staff, { phone, email });
  if (dup.phone?.taken || dup.email?.taken) {
    const d: Record<string, unknown> = { field: dup.phone?.taken ? "phone" : "email" };
    if (dup.phone?.taken) { d.phone = dupMessage.phone; d.existing = dup.phone.account; }
    if (dup.email?.taken) { d.email = dupMessage.email; d.existing ??= dup.email.account; }
    throw err("CONFLICT", dup.phone?.taken ? dupMessage.phone : dupMessage.email, d);
  }
  if (typedUsername && (await usernameTaken(typedUsername))) throw err("CONFLICT", dupMessage.username, { field: "username", username: dupMessage.username });
  const username = typedUsername ?? (await uniqueUsername(usernameFromPhone(phone)));
  const generatedPassword = typedPassword ? null : generatePassword();
  const passwordHash = await hashPassword(typedPassword ?? generatedPassword!);
  const s = (k: string) => (values[k] as string | null | undefined) ?? null;
  let created: User;
  try {
    created = await db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({ role: kind, phone, email, username, passwordHash, mustChangePassword: true, name: values.name as string, city: s("city"), language, source: "admin", createdBy: staff.id }).returning();
      if (kind === "business") {
        await tx.insert(businessProfiles).values({
          userId: u.id, companyName: s("companyName")!, crNumber: s("crNumber"), taxNumber: s("taxNumber"), industry: s("industry"), address: s("address"), responsiblePerson: s("contactPerson") ?? u.name,
          warehouseLat: (values.lat as number | null | undefined) ?? null, warehouseLng: (values.lng as number | null | undefined) ?? null, // `ops` stays empty: every switch inherits the platform default
          verificationStatus: input.verifyNow ? "verified" : "pending", verificationNote: reason ?? null,
        });
        if (values.lat != null) await audit(staff, "warehouse.location", "business", u.id, { from: null, to: { lat: values.lat, lng: values.lng } }, tx, meta);
      } else if (kind === "office") {
        await tx.insert(officeProfiles).values({
          userId: u.id, officeName: s("companyName")!, crNumber: s("crNumber"), responsiblePerson: s("contactPerson") ?? u.name, address: s("address"), city: s("city"),
          bankName: s("bankName"), iban: s("iban"), taxNumber: s("taxNumber"), verificationStatus: input.verifyNow ? "verified" : "pending", verificationNote: reason ?? null,
        });
      } else {
        await tx.insert(driverProfiles).values({
          userId: u.id, nationalId: s("nationalId"), vehicleType: s("vehicleType"), vehicleTemperature: s("vehicleTemperature"), vehiclePlate: s("vehiclePlate"),
          services: values.services as string[], bankName: s("bankName"), iban: s("iban"), verificationStatus: input.verifyNow ? "verified" : "pending",
          officeId: office?.id ?? null, officeLinkStatus: office ? "linked" : "direct", // availability stays "unavailable": the driver goes online from the app
        });
        // Same as a registration: invitations already sent to this number become the driver's own.
        await tx.update(officeInvites).set({ driverId: u.id }).where(and(eq(officeInvites.phone, phone), eq(officeInvites.status, "pending")));
        if (office) {
          await tx.insert(officeInvites).values({ officeId: office.id, phone, driverId: u.id, status: "accepted", respondedAt: new Date() });
          await audit(staff, "office.link_driver", "user", u.id, { officeId: office.id, office: office.name, via: "account.create" }, tx, meta);
        }
      }
      await ensureAccount(u.id, tx);
      await audit(staff, "account.create", "user", u.id, { role: kind, source: "admin", staffRole: staff.staffRole, verified: !!input.verifyNow, officeId: office?.id ?? null, language, username, passwordGenerated: !typedPassword }, tx, meta);
      if (input.verifyNow) {
        await audit(staff, "account.verify", "user", u.id, { note: reason, via: "account.create", ...(kind === "office" ? { documentsNotChecked: true } : {}) }, tx, meta);
        if (kind !== "driver") await notify(u.id, "verification_verified", { note: reason }, tx);
      } else await notifyOps("verification.manage", "verification_needed", { name: u.name, role: kind }, tx);
      return u;
    });
  } catch (e) {
    const f = (e as { cause?: { code?: string; constraint?: string } }).cause;
    if (f?.code === "23505") { const field = f.constraint === "users_username_unique" ? "username" : "phone"; throw err("CONFLICT", dupMessage[field], { field, [field]: dupMessage[field] }); } // lost a race with a registration
    throw e;
  }
  let sms: SmsResult = "skipped";
  if (input.sendSms) { try { await hit(`acct-sms:${staff.id}`, 60, 3600); sms = await sendSignInSms(phone, language, username, meta); } catch { sms = "failed"; } }
  const view = await viewAccount(staff, created);
  // the creator has just typed this number: echo it back in full (later views mask it unless the viewer holds drivers.sensitive).
  // A generated password is returned here and never again; one the staff member typed is not echoed.
  return { ...view, user: { ...view.user, phone: created.phone }, sms, verification: input.verifyNow ? "verified" : "pending", credentials: { username, mustChangePassword: true, ...(generatedPassword ? { generatedPassword } : {}) } };
}

// ───────── Editing ─────────
/** The editable snapshot of an account, flat (the form's field names). Sensitive fields come back `null` for staff without `drivers.sensitive`. */
export async function accountForEdit(staff: User, id: string) {
  requirePerm(staff, "accounts.edit");
  if (!UUID.test(id)) throw err("NOT_FOUND");
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u || !isAccountKind(u.role)) throw err("NOT_FOUND");
  const kind = u.role; const sens = can(staff, "drivers.sensitive");
  const flat = await flatProfile(u);
  const hidden = new Set<string>(sens ? [] : ["nationalId", "iban", "bankName", ...(kind === "business" ? [] : ["taxNumber"])]);
  const fields: Record<string, unknown> = { name: u.name, email: u.email, city: u.city, language: u.language, ...Object.fromEntries(Object.entries(flat.fields).map(([k, v]) => [k, hidden.has(k) ? null : v])) };
  let office: { id: string; name: string } | null = null;
  if (kind === "driver" && flat.officeId) { const [o] = await db.select({ name: officeProfiles.officeName }).from(officeProfiles).where(eq(officeProfiles.userId, flat.officeId)); office = { id: flat.officeId, name: o?.name ?? "—" }; }
  return { id: u.id, kind, username: u.username, status: u.status, source: u.source, createdAt: u.createdAt, fields, phone: sens ? u.phone : null, phoneMasked: maskPhone(u.phone), sensitiveAllowed: sens, verificationStatus: flat.verification, office };
}
async function flatProfile(u: User): Promise<{ fields: Record<string, unknown>; verification: string; officeId?: string | null }> {
  if (u.role === "business") {
    const [p] = await db.select().from(businessProfiles).where(eq(businessProfiles.userId, u.id));
    return { verification: p?.verificationStatus ?? "pending", fields: { companyName: p?.companyName, contactPerson: p?.responsiblePerson ?? u.name, industry: p?.industry, address: p?.address, crNumber: p?.crNumber, taxNumber: p?.taxNumber, lat: p?.warehouseLat ?? null, lng: p?.warehouseLng ?? null } };
  }
  if (u.role === "office") {
    const [p] = await db.select().from(officeProfiles).where(eq(officeProfiles.userId, u.id));
    return { verification: p?.verificationStatus ?? "pending", fields: { companyName: p?.officeName, contactPerson: p?.responsiblePerson ?? u.name, crNumber: p?.crNumber, taxNumber: p?.taxNumber, address: p?.address, bankName: p?.bankName, iban: p?.iban } };
  }
  const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, u.id));
  return { verification: p?.verificationStatus ?? "pending", officeId: p?.officeId, fields: { nationalId: p?.nationalId, vehicleType: p?.vehicleType, vehicleTemperature: p?.vehicleTemperature, vehiclePlate: p?.vehiclePlate, services: p?.services ?? [], bankName: p?.bankName, iban: p?.iban } };
}

export async function updateAccount(staff: User, userId: string, patch: Record<string, unknown>, meta?: Meta) {
  requirePerm(staff, "accounts.edit");
  if (!UUID.test(userId)) throw err("NOT_FOUND");
  const [t] = await db.select().from(users).where(eq(users.id, userId));
  if (!t || !isAccountKind(t.role)) throw err("NOT_FOUND"); // staff and admin accounts are never edited here, and a role never changes
  const kind = t.role;
  needSensitive(staff, kind, patch);
  if ((patch.lat !== undefined || patch.lng !== undefined) && kind === "business") requirePerm(staff, "users.edit"); // moving a warehouse pin has always needed this (see patchWarehouseAdmin)
  const flat = await flatProfile(t);
  const before: Record<string, unknown> = { name: t.name, phone: t.phone, email: t.email, city: t.city, language: t.language, ...flat.fields };
  const { values, errors } = checkFields(kind, patch, await ruleContext(), { partial: true, current: before });
  if (Object.keys(errors).length) throw fail(errors);
  if (kind === "business" && values.lat === null && before.lat != null) throw fail({ lat: "A warehouse location cannot be removed, only moved" });
  const changes = diffFields(before, values);
  if (!Object.keys(changes).length) return { changed: [] as string[], ...(await viewAccount(staff, t)), sessionsRevoked: false };
  const dup = await findDuplicates(staff, { phone: changes.phone ? (values.phone as string) : null, email: changes.email ? (values.email as string | null) : null, exceptId: userId });
  if (dup.phone?.taken || dup.email?.taken) {
    const f = dup.phone?.taken ? "phone" : "email";
    throw err("CONFLICT", dupMessage[f], { field: f, [f]: dupMessage[f], existing: dup[f]?.account ?? null });
  }
  const pick = (keys: readonly string[]) => Object.fromEntries(Object.entries(changes).filter(([k]) => keys.includes(k)).map(([k, d]) => [k, d.to])) as Record<string, string | string[] | number | null>;
  const base = pick(["name", "phone", "email", "city", "language"]); const prof = pick(PROFILE_FIELDS[kind]);
  let updated: User;
  try {
    updated = await db.transaction(async (tx) => {
      const set: Partial<typeof users.$inferInsert> = { ...(base as Partial<typeof users.$inferInsert>), updatedAt: new Date() };
      const [u] = await tx.update(users).set(set).where(eq(users.id, userId)).returning();
      const row = profileRow(kind, prof, base);
      if (Object.keys(row).length) {
        if (kind === "business") await tx.update(businessProfiles).set(row).where(eq(businessProfiles.userId, userId));
        else if (kind === "office") await tx.update(officeProfiles).set(row).where(eq(officeProfiles.userId, userId));
        else await tx.update(driverProfiles).set(row).where(eq(driverProfiles.userId, userId));
      }
      await audit(staff, "account.update", "user", userId, { role: kind, changes: maskDiff(changes) }, tx, meta);
      if (changes.phone) await audit(staff, "account.phone_change", "user", userId, { from: changes.phone.from, to: changes.phone.to }, tx, meta);
      if (changes.iban) { // a payout destination change is a fraud signal: same trail and owner notification as when the owner edits it
        await audit(staff, "profile.iban_change", "user", userId, { from: tailOf(changes.iban.from), to: tailOf(changes.iban.to) }, tx, meta);
        await notify(userId, "iban_changed", undefined, tx);
      }
      return u;
    });
  } catch (e) {
    if ((e as { cause?: { code?: string } }).cause?.code === "23505") throw err("CONFLICT", dupMessage.phone, { field: changes.phone ? "phone" : "email", [changes.phone ? "phone" : "email"]: dupMessage[changes.phone ? "phone" : "email"] });
    throw e;
  }
  if (changes.phone) await revokeAllSessions(userId); // whoever held the old number must not stay signed in
  if (kind === "business" && (changes.lat || changes.lng)) await setWarehouseLocation(staff, userId, values.lat as number, values.lng as number); // live requests that inherited the old pin follow it
  return { changed: Object.keys(changes), ...(await viewAccount(staff, updated)), sessionsRevoked: !!changes.phone };
}
const tailOf = (v: unknown) => (typeof v === "string" && v ? `…${v.slice(-4)}` : null);

/** The column values of the profile row for the changed fields (the pin of a business is written by `setWarehouseLocation`, not here). */
function profileRow(kind: AccountKind, prof: Cleaned, base: Cleaned): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  const has = (k: string) => k in prof;
  if (kind === "business") {
    if (has("companyName")) r.companyName = prof.companyName;
    if (has("contactPerson")) r.responsiblePerson = prof.contactPerson;
    for (const k of ["industry", "address", "crNumber", "taxNumber"]) if (has(k)) r[k] = prof[k];
  } else if (kind === "office") {
    if (has("companyName")) r.officeName = prof.companyName;
    if (has("contactPerson")) r.responsiblePerson = prof.contactPerson;
    for (const k of ["crNumber", "taxNumber", "address", "bankName", "iban"]) if (has(k)) r[k] = prof[k];
    if ("city" in base) r.city = base.city; // an office keeps its city on the profile as well
  } else for (const k of ["nationalId", "vehicleType", "vehicleTemperature", "vehiclePlate", "services", "bankName", "iban"]) if (has(k)) r[k] = prof[k];
  return r;
}
