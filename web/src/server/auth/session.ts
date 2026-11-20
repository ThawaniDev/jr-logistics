import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/ids";
import { logError } from "@/lib/log";
import { recordLogin, type LoginInput } from "../data-capture";

export const SESSION_COOKIE = "jr_session";
const TTL_MS: Record<string, number> = { web: 7 * 864e5, mobile: 30 * 864e5, api: 864e5 };
/** `last_seen_at` is written at most once per session per 5 minutes. */
export const SEEN_EVERY_SEC = 300;

export async function createSession(userId: string, client: "web" | "mobile" = "web", userAgent?: string, ip?: string) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + TTL_MS[client]);
  const [row] = await db.insert(sessions).values({ userId, tokenHash: sha256(token), client, userAgent: userAgent?.slice(0, 200), ip: ip && ip !== "unknown" ? ip : null, expiresAt }).returning({ id: sessions.id });
  return { token, expiresAt, id: row.id };
}

/** Creates the session AND records the successful sign-in (history, last login, count, IP). Every sign-in path goes through here. */
export async function openSession(u: Pick<User, "id" | "phone" | "email"> & { username?: string | null }, o: { client?: "web" | "mobile"; userAgent?: string; ip?: string; method: LoginInput["method"] }) {
  const s = await createSession(u.id, o.client ?? "web", o.userAgent, o.ip);
  await recordLogin({ userId: u.id, identifier: u.username ?? u.phone ?? u.email, method: o.method, success: true, ip: o.ip, userAgent: o.userAgent, client: o.client ?? "web", sessionId: s.id });
  return s;
}

export async function resolveSession(token: string | null | undefined): Promise<User | null> {
  if (!token) return null;
  const rows = await db.select({ u: users, sid: sessions.id, seen: sessions.lastSeenAt }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
  const u = rows[0]?.u;
  if (!u || u.status !== "active") return null;
  if (!rows[0].seen || Date.now() - rows[0].seen.getTime() >= SEEN_EVERY_SEC * 1000) await touchSeen(rows[0].sid, u.id);
  return u;
}

/** Throttled in SQL (the guard is part of the UPDATE), so concurrent requests cannot both write; only the winner touches the user row. */
export async function touchSeen(sessionId: string, userId: string) {
  try {
    const won = await db.update(sessions).set({ lastSeenAt: new Date() })
      .where(and(eq(sessions.id, sessionId), sql`(${sessions.lastSeenAt} is null or ${sessions.lastSeenAt} < now() - make_interval(secs => ${SEEN_EVERY_SEC}))`)).returning({ id: sessions.id });
    if (won.length) await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
  } catch (e) { logError(e, { correlationId: "capture:last_seen" }); }
}

export async function revokeSession(token: string, reason = "logout") {
  await db.update(sessions).set({ revokedAt: new Date(), revokeReason: reason }).where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt)));
}
export async function revokeAllSessions(userId: string, reason = "revoked") {
  await db.update(sessions).set({ revokedAt: new Date(), revokeReason: reason }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
/** Every session of the user except the one holding `keepToken` (a password change ends the other devices, not the one in the user's hand). */
export async function revokeOtherSessions(userId: string, keepToken: string | null | undefined, reason = "password_changed") {
  await db.update(sessions).set({ revokedAt: new Date(), revokeReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), keepToken ? ne(sessions.tokenHash, sha256(keepToken)) : undefined));
}
