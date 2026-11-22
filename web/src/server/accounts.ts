import { and, eq, inArray, desc, ilike, ne, or, count, sql } from "drizzle-orm";
import { db, type Exec } from "@/db";
import {
  users, businessProfiles, driverProfiles, officeProfiles, termsConsents, documents, officeInvites,
  type User,
} from "@/db/schema";
import { err } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { randomToken } from "@/lib/ids";
import { ALL_PERMISSIONS, BUSINESS_DOC_TYPES, DRIVER_DOC_TYPES, OFFICE_DOC_TYPES, TEMPERATURE_VEHICLES, VEHICLE_TYPES, type Permission } from "./catalog";
import { getSettings } from "./settings";
import { hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword } from "./auth/password";
import { normalizeUsername, uniqueUsername, usernameFromEmail, usernameProblem, USERNAME_RE } from "./auth/username";
import { env } from "@/lib/env";
import { riyadhDay } from "./analytics/time";
import { hit, isOver } from "./auth/ratelimit";
import { signMfaToken } from "./auth/mfa";
import { openSession, revokeAllSessions, revokeOtherSessions } from "./auth/session";
import { recordLogin, loginFailureReason } from "./data-capture";
import { ensureAccount } from "./wallet";
import { audit } from "./audit";
import { resolveStaffAccess } from "./roles-staff";
import { notify, notifyMany, notifyOps } from "./notify";
import { storage } from "./storage";
import { requirePerm, can } from "./auth/permissions";
import { contains } from "@/lib/sql";

export interface RegisterInput {
  role: "business" | "driver" | "office"; username: string; password: string; phone: string; name: string; email?: string | null; city?: string | null; language?: string;
  companyName?: string; crNumber?: string; industry?: string; address?: string; taxNumber?: string; bankName?: string; iban?: string;
  nationalId?: string; vehicleType?: string; vehicleTemperature?: string; vehiclePlate?: string; services?: string[];
  termsAccepted: boolean;
}

/** Saudi IBAN: SA + 22 digits. Returns the canonical (no spaces, upper-case) form or null. */
export function normalizeIban(raw: string) {
  const v = raw.replace(/\s/g, "").toUpperCase();
  return /^SA\d{22}$/.test(v) ? v : null;
}

/** Which of the unique columns a 23505 error is about. */
const UNIQUE_FIELD: Record<string, "username" | "phone" | "email"> = { users_username_unique: "username", users_phone_unique: "phone", users_email_unique: "email" };
export const conflictField = (e: unknown): "username" | "phone" | "email" | null => {
  const c = (e as { cause?: { code?: string; constraint?: string } }).cause;
  return c?.code === "23505" ? UNIQUE_FIELD[c.constraint ?? ""] ?? null : null;
};
const CONFLICT_TEXT = { username: "This username is already taken", phone: "An account with this phone number already exists", email: "An account with this email already exists" };
export const conflict = (field: "username" | "phone" | "email") => err("CONFLICT", CONFLICT_TEXT[field], { field });

/**
 * Self-registration (J1): username + password + the profile of the role. No code is sent: the phone is a contact number and the account is checked by staff
 * through its documents. `409 CONFLICT` says in `details.field` which of username / phone / email is already taken.
 */
export async function registerUser(i: RegisterInput, ip?: string) {
  const phone = normalizePhone(i.phone);
  if (!phone) throw err("VALIDATION", "Invalid phone", { field: "phone" });
  const username = normalizeUsername(i.username);
  const uBad = usernameProblem(username);
  if (uBad) throw err("VALIDATION", "Invalid username", { field: "username", reason: uBad });
  const pBad = passwordProblem(i.password);
  if (pBad) throw err("VALIDATION", pBad, { field: "password" });
  if (!i.termsAccepted) throw err("TERMS_REQUIRED", "You must accept the terms");
  if (!i.name?.trim()) throw err("VALIDATION", "Name required", { field: "name" });
  const s = await getSettings();
  if (i.city && !s.cities.some((c) => c.key === i.city)) throw err("VALIDATION", "Unknown city", { field: "city" });
  if (i.iban) { const n = normalizeIban(i.iban); if (!n) throw err("VALIDATION", "Invalid Saudi IBAN", { field: "iban" }); i = { ...i, iban: n }; }
  if (i.role !== "driver" && !(i.companyName?.trim())) throw err("VALIDATION", "Company name required", { field: "companyName" });
  if (i.role === "driver") {
    if (!i.vehicleType || !(VEHICLE_TYPES as readonly string[]).includes(i.vehicleType)) throw err("VALIDATION", "Vehicle type required", { field: "vehicleType" });
    if (TEMPERATURE_VEHICLES.includes(i.vehicleType) && !["dry", "cold"].includes(i.vehicleTemperature ?? "")) throw err("VALIDATION", "Temperature required", { field: "vehicleTemperature" });
    if (!i.services?.length || i.services.some((x) => !s.enabledServices.includes(x))) throw err("VALIDATION", "Choose at least one enabled service", { field: "services" });
  }
  const email = i.email?.trim().toLowerCase() || null;
  const clash = await db.select({ username: users.username, phone: users.phone, email: users.email }).from(users)
    .where(or(eq(users.username, username), eq(users.phone, phone), email ? eq(users.email, email) : undefined));
  if (clash.some((r) => r.username === username)) throw conflict("username");
  if (clash.some((r) => r.phone === phone)) throw conflict("phone");
  if (email && clash.some((r) => r.email === email)) throw conflict("email");
  const passwordHash = await hashPassword(i.password);
  try {
    return await db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({
        role: i.role, phone, username, passwordHash, email, name: i.name.trim(), city: i.city ?? null, language: i.language ?? "ar",
      }).returning();
      if (i.role === "business") {
        await tx.insert(businessProfiles).values({ userId: u.id, companyName: i.companyName!, crNumber: i.crNumber, industry: i.industry, address: i.address, responsiblePerson: i.name });
      } else if (i.role === "office") {
        await tx.insert(officeProfiles).values({ userId: u.id, officeName: i.companyName!, crNumber: i.crNumber, address: i.address, city: i.city, bankName: i.bankName, iban: i.iban, taxNumber: i.taxNumber, responsiblePerson: i.name });
      } else {
        await tx.insert(driverProfiles).values({
          userId: u.id, nationalId: i.nationalId, vehicleType: i.vehicleType, vehicleTemperature: TEMPERATURE_VEHICLES.includes(i.vehicleType!) ? i.vehicleTemperature : null,
          vehiclePlate: i.vehiclePlate, services: i.services!, bankName: i.bankName, iban: i.iban,
        });
        // Link any pending office invitations addressed to this phone.
        await tx.update(officeInvites).set({ driverId: u.id }).where(and(eq(officeInvites.phone, phone), eq(officeInvites.status, "pending")));
      }
      await ensureAccount(u.id, tx);
      await tx.insert(termsConsents).values({ userId: u.id, role: i.role, termsVersion: s.termsVersion, context: "registration", ip });
      await audit(u, "user.register", "user", u.id, { role: i.role }, tx);
      await notifyOps("verification.manage", "verification_needed", { name: u.name, role: i.role }, tx);
      return u;
    });
  } catch (e) {
    const f = conflictField(e);
    if (f) throw conflict(f); // lost a race with another registration
    throw e;
  }
}

export async function findByPhone(phone: string) {
  const [u] = await db.select().from(users).where(eq(users.phone, phone));
  return u ?? null;
}

// ───────── Sign-in (every role) ─────────
/** Wrong passwords before the account is locked, and for how long. */
export const MAX_FAILED_LOGINS = 5, LOCK_MINUTES = 15;

/**
 * Username (or, for staff, e-mail address) + password, for every role. Unknown name and wrong password look the same (401 "Invalid credentials", with a dummy
 * compare so they also take the same time); 5 wrong passwords lock the account for 15 minutes; a suspended account is refused (403) once the password was right.
 * Rate limit: 10 attempts / 15 min per ip + name (demo and test deployments are signed into repeatedly by testers and automated runs, so they get a roomy limit).
 */
export async function loginWithPassword(identifierRaw: string, password: string, ip = "unknown", client: "web" | "mobile" = "web", userAgent?: string) {
  const identifier = normalizeUsername(identifierRaw);
  // Only something that can be a username or an e-mail address is written to the sign-in history: people type their PASSWORD into the username box often enough
  // that storing whatever was typed would keep passwords in a log that staff can search.
  const loggable = USERNAME_RE.test(identifier) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier) ? identifier : "[invalid]";
  const failed = (userId: string | null, failureReason: string) => recordLogin({ userId, identifier: loggable, method: "password", success: false, failureReason, ip, userAgent, client });
  // Per ip AND name (10 / 15 min) stops guessing one account; the per-ip count of FAILED attempts (any name) stops one address from trying a few common passwords on every
  // account (password spraying) and bounds the CPU a flood of sign-ins can burn. Shared / unknown addresses are not throttled by it (they would lock everybody out).
  const attributable = ip !== "unknown", FAIL_LIMIT = env.demoMode ? 3000 : 60;
  try {
    if (attributable && (await isOver(`login-fail:${ip}`, FAIL_LIMIT, 900))) throw err("RATE_LIMITED", "Too many attempts. Please try again later.");
    await hit(`login:${ip}:${identifier}`, env.demoMode ? 300 : 10, 900);
  } catch (e) { await failed(null, loginFailureReason(e, "rate_limited")); throw e; }
  const countFailure = async () => { if (attributable) await hit(`login-fail:${ip}`, FAIL_LIMIT, 900).catch(() => {}); };
  const [u] = await db.select().from(users).where(identifier.includes("@") ? eq(users.email, identifier) : eq(users.username, identifier));
  const generic = err("UNAUTHENTICATED", "Invalid credentials");
  if (!u) { await verifyAgainstDummy(password); await failed(null, "unknown_user"); await countFailure(); throw generic; }
  if (u.lockedUntil && u.lockedUntil > new Date()) { await failed(u.id, "locked"); throw err("RATE_LIMITED", "Account temporarily locked"); }
  const ok = u.passwordHash ? await verifyPassword(password, u.passwordHash) : await verifyAgainstDummy(password); // no password set yet: nobody can sign in until staff set one
  if (!ok) {
    await failed(u.id, "bad_password");
    await countFailure();
    // One atomic statement: concurrent guesses each count (a read-modify-write here let parallel requests dodge the lockout). A lock that has run out starts a fresh count.
    const fresh = sql`(${users.lockedUntil} is not null and ${users.lockedUntil} <= now())`;
    await db.update(users).set({
      failedLogins: sql`case when ${fresh} then 1 else ${users.failedLogins} + 1 end`,
      lockedUntil: sql`case when (case when ${fresh} then 1 else ${users.failedLogins} + 1 end) >= ${MAX_FAILED_LOGINS} then now() + make_interval(mins => ${LOCK_MINUTES}) when ${fresh} then null else ${users.lockedUntil} end`,
    }).where(eq(users.id, u.id));
    throw generic;
  }
  if (u.status !== "active") { await failed(u.id, "suspended"); throw err("FORBIDDEN", "Account suspended"); } // only someone who knows the password learns this
  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
  // Password was right. With two-step verification on (staff / admin), no session exists yet: hand back a 5-minute proof for step two.
  if (u.totpEnabledAt) return { mfaRequired: true as const, mfaToken: signMfaToken(u.id) };
  return finishLogin(u, client, { ip, userAgent });
}

export async function finishLogin(u: User, client: "web" | "mobile" = "web", meta: { ip?: string; userAgent?: string } = {}) {
  const sess = await openSession(u, { client, method: "password", ip: meta.ip, userAgent: meta.userAgent });
  await audit(u, "auth.login", "user", u.id);
  return { mfaRequired: false as const, user: u, ...sess };
}

/**
 * Any signed-in user changes their own password. Needs the current one; every other session of the user ends (the one in use stays, so the user is not thrown out).
 * Clears a "choose a new password" flag set by staff.
 */
export async function changePassword(u: User, current: string, next: string, keepToken?: string | null) {
  await hit(`pwchange:${u.id}`, env.demoMode ? 300 : 10, 900); // a stolen session cannot be used to guess the current password
  const bad = passwordProblem(next);
  if (bad) throw err("VALIDATION", bad, { field: "newPassword" });
  if (!(await verifyPassword(current, u.passwordHash))) throw err("UNAUTHENTICATED", "Current password is incorrect");
  if (current === next) throw err("VALIDATION", "SAME_PASSWORD", { field: "newPassword" });
  await db.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false, failedLogins: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(users.id, u.id));
  await revokeOtherSessions(u.id, keepToken, "password_changed");
  await audit(u, "auth.change_password", "user", u.id);
}

export interface StaffInput { name: string; email: string; username?: string; password: string; staffRole?: string; permissions?: Permission[]; phone?: string }
export async function createStaff(admin: User, i: StaffInput) {
  requirePerm(admin, "staff.manage");
  const bad = passwordProblem(i.password);
  if (bad) throw err("VALIDATION", bad, { field: "password" });
  const access = (await resolveStaffAccess(admin, { staffRole: i.staffRole, permissions: i.permissions }))!; // a role's permissions, or the individual list (server/roles-staff.ts)
  const perms = access.permissions;
  if (perms.some((p) => !(ALL_PERMISSIONS as readonly string[]).includes(p))) throw err("VALIDATION", "Unknown permission");
  assertGrantable(admin, perms);
  // The username is the one the form sent, or — when it did not send one — the part of the e-mail before the @ (numbered when taken).
  let username: string;
  if (i.username?.trim()) {
    username = normalizeUsername(i.username);
    const uBad = usernameProblem(username);
    if (uBad) throw err("VALIDATION", "Invalid username", { field: "username", reason: uBad });
    if ((await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1)).length) throw conflict("username");
  } else username = await uniqueUsername(usernameFromEmail(i.email));
  try {
    const [u] = await db.insert(users).values({
      role: "staff", name: i.name, email: i.email.toLowerCase(), username, phone: i.phone ? normalizePhone(i.phone) : null, passwordHash: await hashPassword(i.password),
      staffRole: access.staffRole, permissions: perms, mustChangePassword: true,
    }).returning();
    await audit(admin, "staff.create", "user", u.id, { staffRole: access.staffRole, permissions: perms, username });
    return u;
  } catch (e) {
    const f = conflictField(e);
    if (f === "username") throw conflict("username");
    if (f) throw err("CONFLICT", "Email or phone already used", { field: f });
    if ((e as { cause?: { code?: string } }).cause?.code === "23505") throw err("CONFLICT", "Email or phone already used");
    throw e;
  }
}
/** Nobody can hand out a permission they do not hold themselves (stops staff.manage from becoming a master key). */
function assertGrantable(actor: User, perms: readonly string[]) {
  if (actor.role === "admin") return;
  const missing = perms.filter((p) => !actor.permissions.includes(p));
  if (missing.length) throw err("FORBIDDEN", "You cannot grant permissions you do not have", { missing });
}

/**
 * Managing a colleague's account (reset password / second factor, unlock, suspend, change permissions) is a way of BECOMING them,
 * so a non-admin may only do it for staff whose permissions are all ones they hold themselves.
 */
function assertCanManage(actor: User, target: Pick<User, "permissions">) {
  if (actor.role === "admin") return;
  const missing = target.permissions.filter((p) => !actor.permissions.includes(p));
  if (missing.length) throw err("FORBIDDEN", "This colleague holds permissions you do not have", { missing });
}
export { assertCanManage };

export async function updateStaff(admin: User, id: string, patch: { name?: string; staffRole?: string | null; permissions?: Permission[]; status?: "active" | "suspended" }) {
  requirePerm(admin, "staff.manage");
  const [t] = await db.select().from(users).where(and(eq(users.id, id), eq(users.role, "staff")));
  if (!t) throw err("NOT_FOUND");
  if (admin.id === id && admin.role !== "admin") throw err("FORBIDDEN", "You cannot change your own access");
  assertCanManage(admin, t);
  const set: Partial<typeof users.$inferInsert> = {};
  if (patch.name) set.name = patch.name;
  const access = await resolveStaffAccess(admin, patch, t); // a role gives its permissions, `staffRole: null` individual ones; null = access unchanged (server/roles-staff.ts)
  if (access) Object.assign(set, access);
  if (patch.status) set.status = patch.status;
  const [u] = await db.update(users).set({ ...set, updatedAt: new Date() }).where(eq(users.id, id)).returning();
  if (patch.status === "suspended" || access) await revokeAllSessions(id, patch.status === "suspended" ? "suspended" : "permissions_changed");
  await audit(admin, "staff.update", "user", id, patch);
  return u;
}

/** Set a temporary password for a staff member (forces a change at next sign-in), clear any lockout and end their sessions. */
export async function resetStaffPassword(admin: User, id: string, password: string) {
  requirePerm(admin, "staff.manage");
  const bad = passwordProblem(password);
  if (bad) throw err("VALIDATION", bad, { field: "password" });
  if (admin.id === id) throw err("FORBIDDEN", "Use Change password for your own account");
  const [t] = await db.select().from(users).where(and(eq(users.id, id), eq(users.role, "staff")));
  if (!t) throw err("NOT_FOUND");
  assertCanManage(admin, t);
  await db.update(users).set({ passwordHash: await hashPassword(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(users.id, id));
  await revokeAllSessions(id, "password_reset");
  await audit(admin, "staff.reset_password", "user", id);
}

/** Lift a login lockout without changing the password. */
export async function unlockStaff(admin: User, id: string) {
  requirePerm(admin, "staff.manage");
  const [t] = await db.select().from(users).where(and(eq(users.id, id), eq(users.role, "staff")));
  if (!t) throw err("NOT_FOUND");
  assertCanManage(admin, t);
  await db.update(users).set({ failedLogins: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(users.id, id));
  await audit(admin, "staff.unlock", "user", id);
}

/** Idempotent. Never overwrites an existing admin's password. */
export async function ensureSuperAdmin(email: string, password: string) {
  const [ex] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  if (ex) {
    if (ex.username) return ex;
    const [u] = await db.update(users).set({ username: await uniqueUsername(usernameFromEmail(email)) }).where(eq(users.id, ex.id)).returning(); // an account from before usernames existed
    return u;
  }
  const [u] = await db.insert(users).values({ role: "admin", name: "Super Admin", email: email.toLowerCase(), username: await uniqueUsername(usernameFromEmail(email)), passwordHash: await hashPassword(password), mustChangePassword: true, permissions: [] }).returning();
  return u;
}

// ───────── Documents & verification ─────────
const MAX_BYTES = 8 * 1024 * 1024;
const MIME_OK = ["image/jpeg", "image/png", "application/pdf", "image/webp"];
const docTypesFor = (kind: string) => (kind === "driver" ? DRIVER_DOC_TYPES : kind === "office" ? OFFICE_DOC_TYPES : BUSINESS_DOC_TYPES);

/** Never trust the declared type: check the file header (JPEG, PNG, WEBP, PDF). */
export function matchesMime(b: Buffer, mime: string) {
  const at = (s: string, o = 0) => b.subarray(o, o + s.length).toString("latin1") === s;
  switch (mime) {
    case "image/jpeg": return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png": return b[0] === 0x89 && at("PNG", 1);
    case "image/webp": return at("RIFF") && at("WEBP", 8);
    case "application/pdf": return at("%PDF-");
    default: return false;
  }
}

export async function submitDocument(user: User, i: { type: string; fileName: string; mime: string; data: Buffer; expiresOn?: string | null }) {
  const kind = user.role === "driver" ? "driver" : user.role === "office" ? "office" : user.role === "business" ? "business" : null;
  if (!kind) throw err("FORBIDDEN");
  if (!docTypesFor(kind).some((t) => t.key === i.type)) throw err("VALIDATION", "Unknown document type", { field: "type" });
  if (!MIME_OK.includes(i.mime)) throw err("VALIDATION", "Only JPG, PNG, WEBP or PDF allowed", { field: "file" });
  if (i.data.length === 0 || i.data.length > MAX_BYTES) throw err("VALIDATION", "File must be under 8 MB", { field: "file" });
  if (!matchesMime(i.data, i.mime)) throw err("VALIDATION", "The file content does not match its type", { field: "file" });
  if (i.expiresOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.expiresOn) || Number.isNaN(Date.parse(i.expiresOn))) throw err("VALIDATION", "Invalid expiry date", { field: "expiresOn" });
    if (i.expiresOn < riyadhDay(new Date())) throw err("VALIDATION", "Document is already expired", { field: "expiresOn" }); // YYYY-MM-DD compares as text; "today" is the Riyadh day
  }
  await hit(`doc-upload:${user.id}`, 30, 3600); // storage is not free: a stuck client or an abuser cannot fill it
  const key = `${kind}/${user.id}/${randomToken(12)}`;
  await storage().put(key, i.data);
  const safeName = i.fileName.replace(/[^\w.\- ]/g, "_").slice(0, 120);
  const [d] = await db.insert(documents).values({ ownerId: user.id, ownerKind: kind, type: i.type, storageKey: key, fileName: safeName, mime: i.mime, size: i.data.length, expiresOn: i.expiresOn ?? null }).returning();
  const reviewers = await db.select({ id: users.id }).from(users).where(and(eq(users.status, "active"), or(eq(users.role, "admin"), and(eq(users.role, "staff"), sql`'documents.review' = any(${users.permissions})`))));
  await notifyMany(reviewers.map((r) => r.id), "document_submitted", { type: i.type, owner: user.name });
  return d;
}

export async function listMyDocuments(ownerId: string) {
  return db.select().from(documents).where(eq(documents.ownerId, ownerId)).orderBy(desc(documents.createdAt));
}

export async function readDocument(viewer: User, id: string) {
  const [d] = await db.select().from(documents).where(eq(documents.id, id));
  if (!d) throw err("NOT_FOUND");
  const owner = viewer.id === d.ownerId;
  const reviewer = can(viewer, "documents.review");
  let officeOwns = false;
  if (!owner && !reviewer && viewer.role === "office" && d.ownerKind === "driver") {
    const [p] = await db.select({ o: driverProfiles.officeId }).from(driverProfiles).where(eq(driverProfiles.userId, d.ownerId));
    officeOwns = p?.o === viewer.id;
  }
  if (!owner && !reviewer && !officeOwns) throw err("NOT_FOUND");
  const data = await storage().get(d.storageKey);
  if (!owner) await audit(viewer, "document.view", "document", id);
  return { doc: d, data };
}

/** Driver verification is derived: every required type approved and unexpired. */
export async function recomputeDriverVerification(userId: string, x: Exec = db) {
  const docs = await x.select().from(documents).where(and(eq(documents.ownerId, userId), eq(documents.ownerKind, "driver")));
  const today = riyadhDay(new Date()); // a document that expires ON a date is valid through the end of that Riyadh day (UTC+3), not of the UTC day
  let status = "verified";
  for (const t of DRIVER_DOC_TYPES.filter((d) => d.required)) {
    const mine = docs.filter((d) => d.type === t.key);
    const ok = mine.some((d) => d.status === "approved" && (!d.expiresOn || d.expiresOn >= today));
    if (!ok) {
      const expired = mine.some((d) => d.status === "approved" && d.expiresOn && d.expiresOn < today);
      status = expired ? "expired" : mine.some((d) => d.status === "rejected") && !mine.some((d) => ["submitted", "under_review", "info_requested"].includes(d.status)) ? "rejected" : "pending";
      if (status === "expired") break;
    }
  }
  await x.update(driverProfiles).set({ verificationStatus: status }).where(and(eq(driverProfiles.userId, userId), ne(driverProfiles.verificationStatus, status))); // no write when nothing changes
  return status;
}

export async function reviewDocument(staff: User, id: string, decision: "approved" | "rejected" | "info_requested", note?: string) {
  requirePerm(staff, "documents.review", "verification.manage");
  if (decision !== "approved" && !note?.trim()) throw err("VALIDATION", "A note is required", { field: "note" });
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(documents).where(eq(documents.id, id)).for("update");
    if (!d) throw err("NOT_FOUND");
    const [u] = await tx.update(documents).set({ status: decision, reviewNote: note ?? null, reviewerId: staff.id, reviewedAt: new Date() }).where(eq(documents.id, id)).returning();
    if (d.ownerKind === "driver") await recomputeDriverVerification(d.ownerId, tx);
    await notify(d.ownerId, `document_${decision}`, { type: d.type, note }, tx);
    await audit(staff, `document.${decision}`, "document", id, { note }, tx);
    return u;
  });
}

export async function listDocumentsForReview(f: { status?: string; kind?: string; ownerId?: string; page?: number }) {
  const page = Math.max(f.page ?? 1, 1);
  const where = and(f.status ? eq(documents.status, f.status) : undefined, f.kind ? eq(documents.ownerKind, f.kind) : undefined, f.ownerId ? eq(documents.ownerId, f.ownerId) : undefined);
  const rows = await db.select({ d: documents, owner: users.name }).from(documents).innerJoin(users, eq(users.id, documents.ownerId)).where(where).orderBy(desc(documents.createdAt)).limit(50).offset((page - 1) * 50);
  return rows.map((r) => ({ ...r.d, storageKey: undefined, ownerName: r.owner }));
}

/** Verify/reject/request-info/suspend a business or office account. */
export async function setAccountVerification(staff: User, userId: string, action: "verify" | "reject" | "request_info" | "suspend", note?: string) {
  requirePerm(staff, "verification.manage", "offices.manage");
  if (action !== "verify" && !note?.trim()) throw err("VALIDATION", "A note is required", { field: "note" });
  const [t] = await db.select().from(users).where(eq(users.id, userId));
  if (!t || !["business", "office"].includes(t.role)) throw err("NOT_FOUND");
  const status = { verify: "verified", reject: "rejected", request_info: "info_requested", suspend: "suspended" }[action];
  if (t.role === "business") await db.update(businessProfiles).set({ verificationStatus: status, verificationNote: note ?? null }).where(eq(businessProfiles.userId, userId));
  else {
    if (action === "verify") {
      const docs = await db.select().from(documents).where(and(eq(documents.ownerId, userId), eq(documents.ownerKind, "office")));
      const missing = OFFICE_DOC_TYPES.filter((d) => d.required && !docs.some((x) => x.type === d.key && x.status === "approved"));
      if (missing.length) throw err("VALIDATION", "Required documents are not approved", { missing: missing.map((m) => m.key) });
    }
    await db.update(officeProfiles).set({ verificationStatus: status, verificationNote: note ?? null }).where(eq(officeProfiles.userId, userId));
  }
  await notify(userId, `verification_${status}`, { note });
  await audit(staff, `account.${action}`, "user", userId, { note });
  return { userId, status };
}

export async function setUserStatus(staff: User, userId: string, status: "active" | "suspended", reason?: string) {
  requirePerm(staff, "users.edit");
  const [t] = await db.select().from(users).where(eq(users.id, userId));
  if (!t || ["admin", "staff"].includes(t.role)) throw err("NOT_FOUND");
  await db.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, userId));
  if (status === "suspended") await revokeAllSessions(userId, "suspended");
  await audit(staff, `user.${status}`, "user", userId, { reason });
  return { userId, status };
}

/** `opts.phone`: the viewer may see phone numbers (`drivers.sensitive`). Without it the search must not match the phone — nor a phone-shaped username (`u9665…`): the list masks the number, so searching it would reveal it digit by digit. */
export async function listUsers(f: { role?: string; q?: string; status?: string; verification?: string; page?: number; pageSize?: number }, opts: { phone?: boolean } = {}) {
  const phone = opts.phone ?? true;
  const pageSize = Math.min(f.pageSize ?? 25, 100), page = Math.max(f.page ?? 1, 1);
  const where = and(f.role ? eq(users.role, f.role) : undefined, f.status ? eq(users.status, f.status) : undefined,
    f.verification ? sql`coalesce((select verification_status from business_profiles where user_id = ${users.id}), (select verification_status from office_profiles where user_id = ${users.id}), (select verification_status from driver_profiles where user_id = ${users.id})) = ${f.verification}` : undefined,
    f.q ? or(ilike(users.name, contains(f.q)), phone ? ilike(users.phone, contains(f.q)) : undefined, ilike(users.email, contains(f.q)), phone || !/\d{4}/.test(f.q) ? ilike(users.username, contains(f.q)) : undefined) : undefined);
  const [items, [{ total }]] = await Promise.all([
    db.select({
      id: users.id, role: users.role, name: users.name, username: users.username, phone: users.phone, email: users.email, status: users.status, city: users.city, createdAt: users.createdAt,
      // One column for every role so lists can show/filter the verification state without per-row lookups.
      verificationStatus: sql<string | null>`coalesce((select verification_status from business_profiles where user_id = ${users.id}), (select verification_status from office_profiles where user_id = ${users.id}), (select verification_status from driver_profiles where user_id = ${users.id}))`,
      warehouseSet: sql<boolean | null>`(select (warehouse_lat is not null and warehouse_lng is not null) from business_profiles where user_id = ${users.id})`, // business rows: has the warehouse pin (drivers cannot check in without it)
    }).from(users).where(where).orderBy(desc(users.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(users).where(where),
  ]);
  return { items, page, pageSize, total: Number(total) };
}

/** The caller's own profile. Server-side secrets (webhook signing secret) are never part of it — they are shown once, on creation/rotation. */
export async function profileOf(u: User) {
  if (u.role === "business") {
    const [p] = await db.select().from(businessProfiles).where(eq(businessProfiles.userId, u.id));
    if (!p) return null;
    const { webhookSecret, ...safe } = p;
    return { ...safe, hasWebhookSecret: !!webhookSecret };
  }
  if (u.role === "driver") return (await db.select().from(driverProfiles).where(eq(driverProfiles.userId, u.id)))[0] ?? null;
  if (u.role === "office") return (await db.select().from(officeProfiles).where(eq(officeProfiles.userId, u.id)))[0] ?? null;
  return null;
}

export async function updateProfile(u: User, patch: Record<string, unknown>) {
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === "string" && v.length > (k === "address" ? 300 : 200)) throw err("VALIDATION", `${k} is too long`, { field: k });
    if (Array.isArray(v) && v.length > 10) throw err("VALIDATION", `${k} has too many entries`, { field: k });
  }
  const str = (k: string) => (typeof patch[k] === "string" ? (patch[k] as string).trim() : undefined);
  const cfg = await getSettings();
  await db.transaction(async (tx) => {
    const base: Partial<typeof users.$inferInsert> = {};
    if (str("name")) base.name = str("name");
    if (str("city")) {
      if (!cfg.cities.some((c) => c.key === str("city"))) throw err("VALIDATION", "Unknown city", { field: "city" });
      base.city = str("city");
    }
    if (str("language") && ["ar", "en", "ur"].includes(str("language")!)) base.language = str("language");
    if (patch.email !== undefined && u.role !== "staff" && u.role !== "admin") {
      const e = str("email");
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw err("VALIDATION", "Invalid email", { field: "email" });
      base.email = e ? e.toLowerCase() : null;
    }
    if (Object.keys(base).length) {
      try { await tx.update(users).set({ ...base, updatedAt: new Date() }).where(eq(users.id, u.id)); }
      catch (e) { if ((e as { cause?: { code?: string } }).cause?.code === "23505") throw err("CONFLICT", "This email is already used", { field: "email" }); throw e; }
    }
    const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
    const iban = str("iban") !== undefined && str("iban") !== "" ? normalizeIban(str("iban")!) : undefined;
    if (str("iban") && !iban) throw err("VALIDATION", "Invalid Saudi IBAN", { field: "iban" });
    const payoutChange = async (table: typeof driverProfiles | typeof officeProfiles, set: Record<string, unknown>) => {
      if (set.iban === undefined) return;
      const [cur] = await tx.select({ iban: table.iban }).from(table as typeof driverProfiles).where(eq(table.userId, u.id));
      if (cur?.iban !== set.iban) {
        // Payout destination changes are a fraud signal: leave a trail and tell the account owner.
        await audit(u, "profile.iban_change", "user", u.id, { from: cur?.iban ? `…${cur.iban.slice(-4)}` : null, to: `…${String(set.iban).slice(-4)}` }, tx);
        await notify(u.id, "iban_changed", undefined, tx);
      }
    };
    if (u.role === "business") {
      const set = clean({ companyName: str("companyName"), crNumber: str("crNumber"), industry: str("industry"), address: str("address") });
      if (Object.keys(set).length) await tx.update(businessProfiles).set(set).where(eq(businessProfiles.userId, u.id));
    } else if (u.role === "driver") {
      const [cur] = await tx.select().from(driverProfiles).where(eq(driverProfiles.userId, u.id));
      const set: Record<string, unknown> = clean({ bankName: str("bankName"), iban, vehiclePlate: str("vehiclePlate"), nationalId: str("nationalId") });
      if (str("vehicleType") !== undefined) {
        if (!(VEHICLE_TYPES as readonly string[]).includes(str("vehicleType")!)) throw err("VALIDATION", "Invalid vehicle type", { field: "vehicleType" });
        set.vehicleType = str("vehicleType");
      }
      const vt = (set.vehicleType as string | undefined) ?? cur?.vehicleType;
      if (vt && TEMPERATURE_VEHICLES.includes(vt)) {
        const temp = str("vehicleTemperature") ?? cur?.vehicleTemperature;
        if (!["dry", "cold"].includes(temp ?? "")) throw err("VALIDATION", "Temperature required for this vehicle", { field: "vehicleTemperature" });
        set.vehicleTemperature = temp;
      } else if (vt) set.vehicleTemperature = null;
      if (Array.isArray(patch.services)) {
        const sv = patch.services as string[];
        if (!sv.length || sv.some((x) => !cfg.enabledServices.includes(x as never))) throw err("VALIDATION", "Choose at least one enabled service", { field: "services" });
        set.services = sv;
      }
      // Availability is NOT editable here: going online has its own endpoint with suspension/verification checks and location handling.
      await payoutChange(driverProfiles, set);
      if (Object.keys(set).length) await tx.update(driverProfiles).set(set).where(eq(driverProfiles.userId, u.id));
    } else if (u.role === "office") {
      const set = clean({ officeName: str("officeName") ?? str("companyName"), address: str("address"), bankName: str("bankName"), iban, taxNumber: str("taxNumber"), crNumber: str("crNumber") });
      await payoutChange(officeProfiles, set);
      if (Object.keys(set).length) await tx.update(officeProfiles).set(set).where(eq(officeProfiles.userId, u.id));
    }
  });
}

export { inArray };
