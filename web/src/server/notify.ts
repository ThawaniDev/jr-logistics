import { db, type Exec } from "@/db";
import { and, eq, or, sql } from "drizzle-orm";
import { notifications, users } from "@/db/schema";

/** In-app notifications. `title`/`body` are i18n keys resolved client-side; `data` holds interpolation vars. */
export async function notify(userId: string, type: string, data?: Record<string, unknown>, x: Exec = db) {
  await x.insert(notifications).values({ userId, type, title: type, body: null, data: data ?? null });
}
export async function notifyMany(userIds: string[], type: string, data?: Record<string, unknown>, x: Exec = db) {
  if (!userIds.length) return;
  await x.insert(notifications).values(userIds.map((userId) => ({ userId, type, title: type, body: null, data: data ?? null })));
}

/** Notify every active admin plus staff who hold `permission` (the people who can actually act on it). */
export async function notifyOps(permission: string, type: string, data?: Record<string, unknown>, x: Exec = db) {
  const ids = await x.select({ id: users.id }).from(users).where(and(eq(users.status, "active"), or(eq(users.role, "admin"), and(eq(users.role, "staff"), sql`${permission} = any(${users.permissions})`))));
  await notifyMany(ids.map((i) => i.id), type, data, x);
}
