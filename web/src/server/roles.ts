import { and, asc, eq, sql } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { roles, users, type RoleRow, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { STAFF_PRESETS } from "./catalog";
import { requirePerm } from "./auth/permissions";
import { SYSTEM_ROLE_INFO, samePermSet } from "./roles-catalog";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FACTORY_ORDER = Object.keys(STAFF_PRESETS);

/** Puts the six system roles back when they are missing (the migration seeds them; a database emptied by the test helpers has none). Existing rows are never touched. */
export async function ensureRoles(x: Exec = db) {
  await x.insert(roles).values(FACTORY_ORDER.map((key) => ({
    key, name: SYSTEM_ROLE_INFO[key]?.name ?? key, description: SYSTEM_ROLE_INFO[key]?.description ?? null, permissions: [...STAFF_PRESETS[key]], isSystem: true,
  }))).onConflictDoNothing({ target: roles.key });
}

/** A role by its id or its key (the pages put the key in the URL). */
export async function findRole(idOrKey: string, x: Exec = db, lock = false): Promise<RoleRow | null> {
  const q = x.select().from(roles).where(UUID.test(idOrKey) ? eq(roles.id, idOrKey) : eq(roles.key, idOrKey));
  const [r] = lock ? await q.for("update") : await q;
  return r ?? null;
}
export async function mustFindRole(idOrKey: string, x: Exec = db, lock = false): Promise<RoleRow> {
  let r = await findRole(idOrKey, x, lock);
  if (!r && FACTORY_ORDER.includes(idOrKey)) { await ensureRoles(x); r = await findRole(idOrKey, x, lock); }
  if (!r) throw err("NOT_FOUND", "Role not found");
  return r;
}

export interface RoleView {
  id: string; key: string; name: string; description: string | null; permissions: string[]; permissionCount: number; isSystem: boolean; memberCount: number;
  /** System roles: the factory permissions, and whether the role no longer matches them (the Reset button). */
  factory: string[] | null; modified: boolean; createdAt: Date; updatedAt: Date;
}
export function roleView(r: RoleRow, memberCount: number): RoleView {
  const factory = r.isSystem && STAFF_PRESETS[r.key] ? [...STAFF_PRESETS[r.key]] : null;
  return { id: r.id, key: r.key, name: r.name, description: r.description, permissions: r.permissions, permissionCount: r.permissions.length, isSystem: r.isSystem, memberCount, factory, modified: !!factory && !samePermSet(factory, r.permissions), createdAt: r.createdAt, updatedAt: r.updatedAt };
}
/** System roles first in their factory order, then custom roles by name. */
const byOrder = (a: RoleRow, b: RoleRow) => (a.isSystem === b.isSystem ? (a.isSystem ? FACTORY_ORDER.indexOf(a.key) - FACTORY_ORDER.indexOf(b.key) : a.name.localeCompare(b.name)) : a.isSystem ? -1 : 1);

async function memberCounts(): Promise<Map<string, number>> {
  const rows = await db.select({ key: users.staffRole, n: sql<number>`count(*)::int` }).from(users).where(eq(users.role, "staff")).groupBy(users.staffRole);
  return new Map(rows.filter((r) => r.key).map((r) => [r.key!, r.n]));
}

/** `GET /admin/roles`: every role with its permissions and member count, plus how many staff hold individual (custom) permissions. */
export async function listRoles(actor: User) {
  requirePerm(actor, "staff.view", "staff.manage");
  await ensureRoles();
  const [rows, counts] = await Promise.all([db.select().from(roles), memberCounts()]);
  const items = rows.sort(byOrder).map((r) => roleView(r, counts.get(r.key) ?? 0));
  const [{ n: staff }] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.role, "staff"));
  const withRole = items.reduce((s, r) => s + r.memberCount, 0);
  return { items, stats: { roles: items.length, system: items.filter((r) => r.isSystem).length, custom: items.filter((r) => !r.isSystem).length, staff, customPermissions: staff - withRole } };
}

export interface RoleMember { id: string; name: string; email: string | null; status: string; differs: boolean }
export async function roleMembers(r: Pick<RoleRow, "key" | "permissions">, x: Exec = db): Promise<RoleMember[]> {
  const rows = await x.select({ id: users.id, name: users.name, email: users.email, status: users.status, permissions: users.permissions }).from(users).where(and(eq(users.role, "staff"), eq(users.staffRole, r.key))).orderBy(asc(users.name));
  return rows.map((u) => ({ id: u.id, name: u.name, email: u.email, status: u.status, differs: !samePermSet(u.permissions, r.permissions) }));
}

/** `GET /admin/roles/:id`: the role and who holds it. `differs` marks members whose own permissions are not the role's (saved before roles existed): the next save of the role aligns them. */
export async function getRole(actor: User, idOrKey: string) {
  requirePerm(actor, "staff.view", "staff.manage");
  const r = await mustFindRole(idOrKey);
  const members = await roleMembers(r);
  return { ...roleView(r, members.length), members };
}

/** The label data of one role key (the user page shows who holds which role); `null` when the key matches no role. */
export async function roleLabel(key: string | null) {
  if (!key) return null;
  const r = await findRole(key);
  return r ? { key: r.key, name: r.name, isSystem: r.isSystem, permissionCount: r.permissions.length } : null;
}
