import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessProfiles, officeProfiles, users } from "@/db/schema";
import { err } from "@/lib/errors";
import { contains } from "@/lib/sql";
import { requirePerm } from "../auth/permissions";
import { REQUEST_STATUS, SERVICES, VEHICLE_TYPES } from "../catalog";
import { getSettings } from "../settings";
import { CHANNELS } from "./filters";
import { BUCKETS, COMPARES, PRESETS } from "./periods";

export const OPTION_KINDS = ["company", "office", "driver"] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const OPTION_LIMIT = 20;

/**
 * `GET /admin/analytics/options` — what the filter bar can offer.
 * Without `kind`: the fixed lists (cities from Settings with their three names, services, vehicle types, channels, request statuses, presets, buckets, compare modes).
 * With `kind=company|office|driver`: up to 20 `{ id, name, sub }` (sub = city) matching `q` by name, or exactly the accounts in `ids` (to label the chips of a shared link).
 */
export async function analyticsOptions(user: Parameters<typeof requirePerm>[0], query: URLSearchParams) {
  requirePerm(user, "reports.view");
  const kind = query.get("kind");
  if (!kind) {
    const s = await getSettings();
    return {
      cities: s.cities.map((c) => ({ key: c.key, ar: c.ar, en: c.en, ur: c.ur })),
      services: SERVICES.map((x) => x.key), vehicles: [...VEHICLE_TYPES], channels: [...CHANNELS],
      statuses: REQUEST_STATUS.filter((x) => x !== "draft"), presets: [...PRESETS], buckets: [...BUCKETS], compares: [...COMPARES],
    };
  }
  if (!(OPTION_KINDS as readonly string[]).includes(kind)) throw err("VALIDATION", "kind must be company, office or driver", { field: "kind" });
  const q = (query.get("q") ?? "").trim().slice(0, 80);
  const ids = (query.get("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (ids.length > 50 || ids.some((x) => !UUID.test(x))) throw err("VALIDATION", "ids must be up to 50 valid ids", { field: "ids" });
  const like = q ? contains(q) : null;
  const role = kind === "driver" ? "driver" : kind === "office" ? "office" : "business";
  const label = kind === "office" ? sql<string>`coalesce(${officeProfiles.officeName}, ${users.name})` : kind === "company" ? sql<string>`coalesce(${businessProfiles.companyName}, ${users.name})` : sql<string>`${users.name}`;
  const base = db.select({ id: users.id, name: label, sub: users.city }).from(users);
  const joined = kind === "office" ? base.leftJoin(officeProfiles, eq(officeProfiles.userId, users.id)) : kind === "company" ? base.leftJoin(businessProfiles, eq(businessProfiles.userId, users.id)) : base;
  const match = like ? (kind === "driver" ? ilike(users.name, like) : or(ilike(users.name, like), ilike(kind === "office" ? officeProfiles.officeName : businessProfiles.companyName, like))) : undefined;
  const items = await joined.where(and(eq(users.role, role), ids.length ? inArray(users.id, ids) : undefined, match)).orderBy(asc(label), asc(users.id)).limit(ids.length ? 50 : OPTION_LIMIT);
  return { items };
}
