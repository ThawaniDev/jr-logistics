import { sql } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { rateLimits } from "@/db/schema";
import { err } from "@/lib/errors";

/** Fixed-window limiter, atomic in Postgres (works across instances). */
export async function hit(key: string, limit: number, windowSec: number, x: Exec = db): Promise<void> {
  const rows = await x.insert(rateLimits).values({ key, count: 1, windowStart: new Date() })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSec}) THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSec}) THEN now() ELSE ${rateLimits.windowStart} END`,
      },
    }).returning({ count: rateLimits.count });
  if (rows[0].count > limit) throw err("RATE_LIMITED", "Too many attempts. Please try again later.");
}
