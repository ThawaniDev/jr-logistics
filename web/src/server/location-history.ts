import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { driverLocationHistory, users, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { audit } from "./audit";
import { requirePerm } from "./auth/permissions";

export const PATH_MAX_POINTS = 1500, PATH_MAX_DAYS = 31;
/**
 * A driver's sampled path for a time window (default: the last 24 h) — personal location data, so it needs `drivers.sensitive` and every look is audited.
 * More than `PATH_MAX_POINTS` samples are thinned evenly (first and last point kept in spirit: every n-th sample) so the response stays small.
 */
export async function locationPath(viewer: User, driverId: string, q: { from?: Date; to?: Date; offerId?: string } = {}) {
  requirePerm(viewer, "drivers.sensitive");
  const [d] = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.id, driverId));
  if (!d || d.role !== "driver") throw err("NOT_FOUND", "Driver not found");
  const to = q.to ?? new Date(), from = q.from ?? new Date(to.getTime() - 864e5);
  if (from >= to) throw err("VALIDATION", "The start must be before the end", { field: "from" });
  if (to.getTime() - from.getTime() > PATH_MAX_DAYS * 864e5) throw err("VALIDATION", `Choose a window of at most ${PATH_MAX_DAYS} days`, { field: "from" });
  const where = and(eq(driverLocationHistory.driverId, driverId), gte(driverLocationHistory.recordedAt, from), lt(driverLocationHistory.recordedAt, to), q.offerId ? eq(driverLocationHistory.offerId, q.offerId) : undefined);
  const rows = (await db.execute(sql`select lat, lng, accuracy_m as "accuracyM", speed_mps as "speedMps", heading, offer_id as "offerId", recorded_at as "at", total from (
      select driver_location_history.*, row_number() over (order by driver_location_history.recorded_at) rn, count(*) over () total from driver_location_history where ${where}) x
    where (rn - 1) % greatest(1, ceil(total::numeric / ${PATH_MAX_POINTS})::int) = 0 order by "at"`)).rows as Array<Record<string, unknown>>;
  const total = Number(rows[0]?.total ?? 0);
  await audit(viewer, "location.view", "driver_location", driverId, { points: rows.length, from, to });
  return { driver: { id: d.id, name: d.name }, from, to, total, thinned: total > rows.length, points: rows.map(({ total: _t, ...p }) => p) };
}
