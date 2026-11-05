import { db, type Exec } from "@/db";
import { notifications } from "@/db/schema";

/** In-app notifications. `title`/`body` are i18n keys resolved client-side; `data` holds interpolation vars. */
export async function notify(userId: string, type: string, data?: Record<string, unknown>, x: Exec = db) {
  await x.insert(notifications).values({ userId, type, title: type, body: null, data: data ?? null });
}
export async function notifyMany(userIds: string[], type: string, data?: Record<string, unknown>, x: Exec = db) {
  if (!userIds.length) return;
  await x.insert(notifications).values(userIds.map((userId) => ({ userId, type, title: type, body: null, data: data ?? null })));
}
