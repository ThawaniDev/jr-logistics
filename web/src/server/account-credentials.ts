/**
 * Staff manage how people sign in (J1d): set a new password for someone who forgot theirs (there is no self-service reset — no e-mail / SMS provider),
 * and change a username. Business, office and driver accounts need `accounts.edit`; a colleague's account needs `staff.manage` (the same rule as the
 * staff screen: nobody manages a colleague who holds permissions they do not). An administrator's own credentials are never touched from here.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { audit } from "./audit";
import { requirePerm } from "./auth/permissions";
import { generatePassword, hashPassword, passwordProblem } from "./auth/password";
import { revokeAllSessions } from "./auth/session";
import { normalizeUsername, usernameProblem, usernameTaken } from "./auth/username";
import { assertCanManage, conflictField } from "./accounts";
import { isAccountKind } from "./account-admin-rules";

type Meta = { ip?: string; correlationId?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The account being managed, after the permission rules above. */
async function target(staff: User, id: string): Promise<User> {
  if (!UUID.test(id)) throw err("NOT_FOUND");
  const [t] = await db.select().from(users).where(eq(users.id, id));
  if (!t || t.role === "admin") throw err("NOT_FOUND");
  if (isAccountKind(t.role)) requirePerm(staff, "accounts.edit");
  else { requirePerm(staff, "staff.manage"); assertCanManage(staff, t); }
  return t;
}

/** The sign-in facts staff see on an account: its username and whether a password is set, temporary or locked. Never the hash. */
export async function credentialsOf(staff: User, id: string) {
  const t = await target(staff, id);
  return {
    id: t.id, role: t.role, username: t.username, hasPassword: !!t.passwordHash, mustChangePassword: t.mustChangePassword,
    failedLogins: t.failedLogins, lockedUntil: t.lockedUntil && t.lockedUntil.getTime() > Date.now() ? t.lockedUntil : null, status: t.status,
    lastLoginAt: t.lastLoginAt, lastLoginClient: t.lastLoginClient,
  };
}

/**
 * Sets a temporary password: the one given (`password`) or — when none is given — a strong generated one, returned ONCE. The person must replace it at the next
 * sign-in; any lockout is lifted and every session ends. The password is never written to the audit log.
 */
export async function resetUserPassword(staff: User, id: string, password?: string | null, meta?: Meta) {
  const t = await target(staff, id);
  if (t.id === staff.id) throw err("FORBIDDEN", "Use Change password for your own account");
  const typed = password?.trim() ? password : null;
  if (typed) { const bad = passwordProblem(typed); if (bad) throw err("VALIDATION", bad, { field: "password" }); }
  const next = typed ?? generatePassword();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: true, failedLogins: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(users.id, t.id));
    await audit(staff, "user.password_reset", "user", t.id, { role: t.role, generated: !typed }, tx, meta);
  });
  await revokeAllSessions(t.id, "password_reset");
  return { id: t.id, username: t.username, mustChangePassword: true as const, generated: !typed, ...(typed ? {} : { password: next }) };
}

/** Renames an account. Same rules as registration (lower-case, 3–30 characters, not reserved) and always unique; the person is not signed out. */
export async function changeUsername(staff: User, id: string, raw: string, meta?: Meta) {
  const t = await target(staff, id);
  const username = normalizeUsername(raw);
  const bad = usernameProblem(username);
  if (bad) throw err("VALIDATION", "Invalid username", { field: "username", username: bad === "reserved" ? "This username is reserved" : "Invalid username", reason: bad });
  if (username === t.username) return { id: t.id, username, changed: false };
  if (await usernameTaken(username, t.id)) throw err("CONFLICT", "This username is already taken", { field: "username" });
  try {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ username, updatedAt: new Date() }).where(eq(users.id, t.id));
      await audit(staff, "user.username_change", "user", t.id, { role: t.role, from: t.username, to: username }, tx, meta);
    });
  } catch (e) {
    if (conflictField(e) === "username") throw err("CONFLICT", "This username is already taken", { field: "username" });
    throw e;
  }
  return { id: t.id, username, changed: true };
}
