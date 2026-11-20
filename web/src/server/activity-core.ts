import type { User } from "@/db/schema";
import type { Permission } from "./catalog";
import { can } from "./auth/permissions";

/**
 * The shared activity log (decision G6): pure types and rules. Everything here is free of I/O so it can be unit-tested;
 * `activity.ts` runs the queries, `activity-sources.ts` holds them.
 */
export const ACTIVITY_ENTITIES = ["request", "offer", "shipment", "user", "ticket", "complaint", "settlement", "withdrawal"] as const;
export type ActivityEntity = (typeof ACTIVITY_ENTITIES)[number];
export const isActivityEntity = (v: unknown): v is ActivityEntity => (ACTIVITY_ENTITIES as readonly unknown[]).includes(v);

/** Source groups = what a permission can hide. */
export const SOURCE_GROUPS = ["events", "chat", "notifications", "finance", "support", "ratings", "notes", "documents", "logins", "availability", "messages", "integration", "audit"] as const;
export type SourceGroup = (typeof SOURCE_GROUPS)[number];
/** Kinds = the filter chips of the UI (one or more sources feed each). */
export const ACTIVITY_KINDS = ["event", "parcel", "audit", "chat", "notification", "money", "support", "rating", "note", "document", "login", "availability", "message", "integration"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityRef { type: ActivityEntity | "company" | "driver" | "office" | "staff"; id: string; label?: string | null; role?: string | null }
export interface ActivityActor { id: string | null; name: string | null; role: string | null }
export interface ActivityItem {
  id: string; at: string; kind: ActivityKind; source: SourceGroup; table: string;
  titleKey: string; params: Record<string, unknown>; actor: ActivityActor | null; refs: ActivityRef[]; details: unknown;
}
export interface ActivityFilters { kinds?: string[]; actorId?: string; q?: string; from?: Date; to?: Date }
export interface ActivityQuery extends ActivityFilters { entity: ActivityEntity; id: string; page?: number; pageSize?: number }
export interface ActivityResult {
  items: ActivityItem[]; total: number; page: number; pageSize: number; kindCounts: Record<string, number>;
  /** Source groups that exist for this entity but that the viewer may not see (permissions). */
  hidden: SourceGroup[];
  /** Tables whose query failed (the rest of the feed is still shown). */ failed: string[];
  /** More rows exist than were read from at least one source (deep pages / exports are cut at the limit). */ truncated: boolean;
  entity: { type: ActivityEntity; id: string; label: string | null };
}

/** Which source groups can hold something about each entity. */
export const RELEVANT_GROUPS: Record<ActivityEntity, SourceGroup[]> = {
  request: ["events", "chat", "notifications", "finance", "support", "ratings", "notes", "messages", "integration", "audit"],
  offer: ["events", "chat", "finance", "support", "ratings", "notes", "audit"],
  shipment: ["events", "notes", "messages", "integration", "audit"],
  user: ["events", "chat", "notifications", "finance", "support", "ratings", "notes", "documents", "logins", "availability", "messages", "integration", "audit"],
  ticket: ["support", "notifications", "notes", "audit"],
  complaint: ["support", "notifications", "notes", "audit"],
  settlement: ["events", "finance", "notes", "audit"],
  withdrawal: ["finance", "notes", "audit"],
};

/** Permissions that open an entity at all (any one of them). */
export const ENTITY_PERMS: Record<ActivityEntity, Permission[]> = {
  request: ["requests.view"], offer: ["requests.view"], shipment: ["requests.view"], user: ["users.view", "drivers.view", "offices.view"],
  ticket: ["tickets.view"], complaint: ["complaints.manage", "tickets.view"], settlement: ["finance.view", "settlements.review"], withdrawal: ["finance.view", "withdrawals.manage"],
};
/** Who may read the internal notes of an entity. */
export const NOTES_READ_PERMS = ENTITY_PERMS;

/** Permissions that unlock one source group (any one of them), possibly depending on the entity being viewed. */
export function groupPerms(group: SourceGroup, entity: ActivityEntity): Permission[] {
  switch (group) {
    case "audit": return ["audit.view"];
    case "events": case "chat": case "ratings": case "integration": return ["requests.view"];
    case "finance": return ["finance.view", "wallets.view", "settlements.review", "withdrawals.manage"];
    case "support": return ["tickets.view", "tickets.manage", "complaints.manage"];
    case "documents": return ["documents.review", "verification.manage", "users.view"];
    case "logins": return ["users.view"];
    case "availability": return ["drivers.view", "users.view"];
    case "notes": return NOTES_READ_PERMS[entity];
    case "notifications": case "messages":
      return entity === "user" ? ["users.view"] : entity === "ticket" || entity === "complaint" ? ["tickets.view", "complaints.manage"] : entity === "settlement" || entity === "withdrawal" ? ["finance.view"] : ["requests.view"];
  }
}
export const canAny = (u: Pick<User, "role" | "permissions">, perms: Permission[]) => perms.some((p) => can(u, p));
export const canOpenEntity = (u: Pick<User, "role" | "permissions">, e: ActivityEntity) => canAny(u, ENTITY_PERMS[e]);

/** Splits the groups relevant to an entity into what the viewer can read and what is hidden from them. */
export function visibleGroups(u: Pick<User, "role" | "permissions">, entity: ActivityEntity): { allowed: Set<SourceGroup>; hidden: SourceGroup[] } {
  const allowed = new Set<SourceGroup>(), hidden: SourceGroup[] = [];
  for (const g of RELEVANT_GROUPS[entity]) { if (canAny(u, groupPerms(g, entity))) allowed.add(g); else hidden.push(g); }
  return { allowed, hidden };
}

// ───────── Merging ─────────
const byNewest = (a: ActivityItem, b: ActivityItem) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
/** Newest first; ties broken by id so a page boundary can never repeat or skip an item. Duplicate ids (same source + row) are dropped. */
export function mergeFeeds(feeds: ActivityItem[][]): ActivityItem[] {
  const seen = new Set<string>(), out: ActivityItem[] = [];
  for (const it of feeds.flat().sort(byNewest)) { const k = `${it.table}:${it.id}`; if (!seen.has(k)) { seen.add(k); out.push(it); } }
  return out;
}
export const pageOf = <T,>(items: T[], page: number, pageSize: number) => items.slice((page - 1) * pageSize, page * pageSize);
export const clampPaging = (page?: number, pageSize?: number) => ({ page: Math.min(Math.max(Math.floor(page ?? 1) || 1, 1), 20), pageSize: Math.min(Math.max(Math.floor(pageSize ?? 30) || 30, 1), 100) });
/** Adds up per-source counts into per-kind counts. */
export function sumCounts(counts: Array<{ kind: string; n: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of counts) if (c.n > 0) out[c.kind] = (out[c.kind] ?? 0) + c.n;
  return out;
}

// ───────── Redaction ─────────
const SENSITIVE_KEYS = new Set(["ip", "userAgent", "lastLoginIp", "device", "lat", "lng", "latitude", "longitude"]);
/** Removes IPs, device strings and coordinates from any nested value (viewers without `drivers.sensitive` see that the field existed, not its value). */
export function redactDeep(v: unknown, depth = 0): unknown {
  if (v == null || depth > 6) return v;
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, depth + 1));
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SENSITIVE_KEYS.has(k) && x != null ? "•••" : redactDeep(x, depth + 1)]));
  return v;
}
export const redactItem = (it: ActivityItem, sensitive: boolean): ActivityItem => (sensitive ? it : { ...it, params: redactDeep(it.params) as Record<string, unknown>, details: redactDeep(it.details) });
export const canSeeSensitive = (u: Pick<User, "role" | "permissions">) => can(u, "drivers.sensitive");

// ───────── CSV ─────────
export const CSV_COLUMNS = ["at", "kind", "source", "event", "actor", "actorRole", "summary", "refs"] as const;
/** One flat row per item for the export (the title key is the stable machine name; the summary is the interesting params). */
export function csvRows(items: ActivityItem[]): Array<Record<(typeof CSV_COLUMNS)[number], unknown>> {
  return items.map((it) => ({
    at: it.at, kind: it.kind, source: it.table, event: it.titleKey, actor: it.actor?.name ?? it.actor?.id ?? "", actorRole: it.actor?.role ?? "",
    summary: Object.entries(it.params).filter(([, v]) => v != null && typeof v !== "object").map(([k, v]) => `${k}=${String(v)}`).join("; ").slice(0, 400),
    refs: it.refs.map((r) => `${r.type}:${r.label ?? r.id}`).join(" "),
  }));
}
