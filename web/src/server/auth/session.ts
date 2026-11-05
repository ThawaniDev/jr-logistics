import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/ids";

export const SESSION_COOKIE = "jr_session";
const TTL_MS: Record<string, number> = { web: 7 * 864e5, mobile: 30 * 864e5, api: 864e5 };

export async function createSession(userId: string, client: "web" | "mobile" = "web", userAgent?: string) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + TTL_MS[client]);
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), client, userAgent: userAgent?.slice(0, 200), expiresAt });
  return { token, expiresAt };
}

export async function resolveSession(token: string | null | undefined): Promise<User | null> {
  if (!token) return null;
  const rows = await db.select({ u: users }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
  const u = rows[0]?.u;
  if (!u || u.status !== "active") return null;
  return u;
}

export async function revokeSession(token: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
}
export async function revokeAllSessions(userId: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
