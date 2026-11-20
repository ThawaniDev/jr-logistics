import { sql } from "drizzle-orm";
import type { User } from "@/db/schema";
import { err } from "@/lib/errors";
import { REQUEST_STATUS, SERVICES, VEHICLE_TYPES } from "../catalog";
import { getSettings } from "../settings";
import { CHANNELS } from "./filters";
import { rows } from "./guard";
import { BUCKETS, COMPARES, PRESETS } from "./periods";
import { PORTAL_KEYS, type PortalRole } from "./portal-scope";

/**
 * `GET /business/analytics/options` and `GET /office/analytics/options`: what the portal's filter bar can offer. The fixed lists are the same as the admin ones, but only the
 * filters the portal supports are filled (`channels` / `statuses` for companies, `drivers` for offices). An office's drivers are its OWN: the drivers linked to it now plus
 * those who worked a job for it (so an old report can still be filtered by a driver who has since left).
 */
export async function portalOptions(user: User, role: PortalRole) {
  if (user.role !== role) throw err("FORBIDDEN", "Role not allowed");
  const s = await getSettings();
  const keys = new Set(PORTAL_KEYS[role]);
  const base = {
    cities: s.cities.map((c) => ({ key: c.key, ar: c.ar, en: c.en, ur: c.ur })), services: SERVICES.map((x) => x.key), vehicles: [...VEHICLE_TYPES],
    channels: keys.has("channel") ? [...CHANNELS] : [], statuses: keys.has("status") ? REQUEST_STATUS.filter((x) => x !== "draft") : [],
    presets: [...PRESETS], buckets: [...BUCKETS], compares: [...COMPARES],
  };
  if (role !== "office") return base;
  const drivers = await rows<{ id: string; name: string; sub: string | null }>(sql`
    select users.id::text as id, users.name, users.city as sub from users
    where users.id in (select driver_profiles.user_id from driver_profiles where driver_profiles.office_id = ${user.id} union select offers.driver_id from offers where offers.office_id = ${user.id})
    order by users.name, users.id limit 500`);
  return { ...base, drivers };
}
