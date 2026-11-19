import { and, eq, inArray, desc, ilike, or, count, sql } from "drizzle-orm";
import { db, type Exec } from "@/db";
import {
  users, businessProfiles, driverProfiles, officeProfiles, termsConsents, documents, officeInvites,
  type User,
} from "@/db/schema";
import { err } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { randomToken } from "@/lib/ids";
import { ALL_PERMISSIONS, BUSINESS_DOC_TYPES, DRIVER_DOC_TYPES, OFFICE_DOC_TYPES, STAFF_PRESETS, TEMPERATURE_VEHICLES, VEHICLE_TYPES, type Permission } from "./catalog";
import { getSettings } from "./settings";
import { hashPassword, passwordProblem, verifyPassword } from "./auth/password";
import { hit } from "./auth/ratelimit";
import { signMfaToken } from "./auth/mfa";
import { createSession, revokeAllSessions } from "./auth/session";
import { ensureAccount } from "./wallet";
import { audit } from "./audit";
import { notify, notifyMany, notifyOps } from "./notify";
import { storage } from "./storage";
import { requirePerm, can } from "./auth/permissions";
import { contains } from "@/lib/sql";

export interface RegisterInput {
  role: "business" | "driver" | "office"; name: string; email?: string | null; city?: string | null; language?: string;
  companyName?: string; crNumber?: string; industry?: string; address?: string; taxNumber?: string; bankName?: string; iban?: string;
  nationalId?: string; vehicleType?: string; vehicleTemperature?: string; vehiclePlate?: string; services?: string[];
  termsAccepted: boolean;
}

/** Saudi IBAN: SA + 22 digits. Returns the canonical (no spaces, upper-case) form or null. */
export function normalizeIban(raw: string) {
  const v = raw.replace(/\s/g, "").toUpperCase();
  return /^SA\d{22}$/.test(v) ? v : null;
}

export async function registerUser(phoneRaw: string, i: RegisterInput, ip?: string) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw err("VALIDATION", "Invalid phone", { field: "phone" });
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
  try {
    return await db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({
        role: i.role, phone, email: i.email?.toLowerCase() || null, name: i.name.trim(), city: i.city ?? null, language: i.language ?? "ar",
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
    if ((e as { cause?: { code?: string } }).cause?.code === "23505") throw err("CONFLICT", "An account with this phone or email already exists");
    throw e;
  }
}

export async function findByPhone(phone: string) {
  const [u] = await db.select().from(users).where(eq(users.phone, phone));
  return u ?? null;
}

// ───────── Staff / admin ─────────
export async function loginPassword(emailRaw: string, password: string, ip = "unknown", client: "web" | "mobile" = "web") {
  const email = emailRaw.trim().toLowerCase();
  await hit(`login:${ip}:${email}`, 10, 900);
  const [u] = await db.select().from(users).where(eq(users.email, email));
  const generic = err("UNAUTHENTICATED", "Invalid credentials");
  if (!u || !["admin", "staff"].includes(u.role) || u.status !== "active") { await verifyPassword(password, "$2a$04$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva"); throw generic; }
  if (u.lockedUntil && u.lockedUntil > new Date()) throw err("RATE_LIMITED", "Account temporarily locked");
  if (!(await verifyPassword(password, u.passwordHash))) {
    // One atomic statement: concurrent guesses each count (a read-modify-write here let parallel requests dodge the lockout).
    await db.update(users).set({
      failedLogins: sql`${users.failedLogins} + 1`,
      lockedUntil: sql`case when ${users.failedLogins} + 1 >= 5 then now() + interval '15 minutes' else ${users.lockedUntil} end`,
    }).where(eq(users.id, u.id));
    throw generic;
  }
  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
  // Password was right. With two-step verification on, no session exists yet: hand back a 5-minute proof for step two.
  if (u.totpEnabledAt) return { mfaRequired: true as const, mfaToken: signMfaToken(u.id) };
  return finishLogin(u, client);
}

export async function finishLogin(u: User, client: "web" | "mobile" = "web") {
  const sess = await createSession(u.id, client);
  await audit(u, "auth.login", "user", u.id);
  return { mfaRequired: false as const, user: u, ...sess };
}

export async function changePassword(u: User, current: string, next: string) {
  const bad = passwordProblem(next);
  if (bad) throw err("VALIDATION", bad, { field: "newPassword" });
  if (!(await verifyPassword(current, u.passwordHash))) throw err("UNAUTHENTICATED", "Current password is incorrect");
  await db.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(users.id, u.id));
  await revokeAllSessions(u.id);
  await audit(u, "auth.change_password", "user", u.id);
}

export interface StaffInput { name: string; email: string; password: string; staffRole?: string; permissions?: Permission[]; phone?: string }
export async function createStaff(admin: User, i: StaffInput) {
  requirePerm(admin, "staff.manage");
  const bad = passwordProblem(i.password);
  if (bad) throw err("VALIDATION", bad, { field: "password" });
  const perms = [...new Set([...(i.staffRole ? STAFF_PRESETS[i.staffRole] ?? [] : []), ...(i.permissions ?? [])])];
  if (perms.some((p) => !(ALL_PERMISSIONS as readonly string[]).includes(p))) throw err("VALIDATION", "Unknown permission");
  assertGrantable(admin, perms);
  try {
    const [u] = await db.insert(users).values({
      role: "staff", name: i.name, email: i.email.toLowerCase(), phone: i.phone ? normalizePhone(i.phone) : null, passwordHash: await hashPassword(i.password),
      staffRole: i.staffRole ?? null, permissions: perms, mustChangePassword: true,
    }).returning();
    await audit(admin, "staff.create", "user", u.id, { staffRole: i.staffRole, permissions: perms });
    return u;
  } catch (e) {
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
  if (patch.staffRole !== undefined) set.staffRole = patch.staffRole;
  if (patch.permissions) {
    if (patch.permissions.some((p) => !(ALL_PERMISSIONS as readonly string[]).includes(p))) throw err("VALIDATION", "Unknown permission");
    // Only newly added permissions must be grantable; removing is always fine.
    assertGrantable(admin, patch.permissions.filter((p) => !t.permissions.includes(p)));
    set.permissions = patch.permissions;
  }
  if (patch.status) set.status = patch.status;
  const [u] = await db.update(users).set({ ...set, updatedAt: new Date() }).where(eq(users.id, id)).returning();
  if (patch.status === "suspended" || patch.permissions) await revokeAllSessions(id);
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
  await revokeAllSessions(id);
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
  if (ex) return ex;
  const [u] = await db.insert(users).values({ role: "admin", name: "Super Admin", email: email.toLowerCase(), passwordHash: await hashPassword(password), mustChangePassword: true, permissions: [] }).returning();
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
    if (Date.parse(i.expiresOn) < Date.now() - 864e5) throw err("VALIDATION", "Document is already expired", { field: "expiresOn" });
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
  const today = new Date().toISOString().slice(0, 10);
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
  await x.update(driverProfiles).set({ verificationStatus: status }).where(eq(driverProfiles.userId, userId));
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
  if (status === "suspended") await revokeAllSessions(userId);
  await audit(staff, `user.${status}`, "user", userId, { reason });
  return { userId, status };
}

export async function listUsers(f: { role?: string; q?: string; status?: string; verification?: string; page?: number; pageSize?: number }) {
  const pageSize = Math.min(f.pageSize ?? 25, 100), page = Math.max(f.page ?? 1, 1);
  const where = and(f.role ? eq(users.role, f.role) : undefined, f.status ? eq(users.status, f.status) : undefined,
    f.verification ? sql`coalesce((select verification_status from business_profiles where user_id = ${users.id}), (select verification_status from office_profiles where user_id = ${users.id}), (select verification_status from driver_profiles where user_id = ${users.id})) = ${f.verification}` : undefined,
    f.q ? or(ilike(users.name, contains(f.q)), ilike(users.phone, contains(f.q)), ilike(users.email, contains(f.q))) : undefined);
  const [items, [{ total }]] = await Promise.all([
    db.select({
      id: users.id, role: users.role, name: users.name, phone: users.phone, email: users.email, status: users.status, city: users.city, createdAt: users.createdAt,
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
