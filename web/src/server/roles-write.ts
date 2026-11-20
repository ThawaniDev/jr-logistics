import { and, eq } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { roles, users, type RoleRow, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { audit } from "./audit";
import { requirePerm } from "./auth/permissions";
import { STAFF_PRESETS } from "./catalog";
import { closeDependencies, diffPerms, normalizePerms, roleKeyFrom, unknownPerms } from "./roles-catalog";
import { ensureRoles, mustFindRole, roleView } from "./roles";

/** Writes of the Roles & permissions pages (J8). A role's permissions are the effective permissions of its members, so every change of them rewrites `users.permissions` of the members in the same transaction. */

/** Nobody hands out a permission they do not hold themselves (the same rule as for staff accounts). */
function assertGrantable(actor: User, perms: readonly string[]) {
  if (actor.role === "admin") return;
  const missing = perms.filter((p) => !actor.permissions.includes(p));
  if (missing.length) throw err("FORBIDDEN", "You cannot grant permissions you do not have", { missing });
}
/** A staff member with `staff.manage` may not take it away from their own role (they would lose the very page they are on). The super admin cannot lock themselves out. */
function assertNoSelfLockout(actor: User, roleKey: string, after: readonly string[]) {
  if (actor.role !== "admin" && actor.staffRole === roleKey && !after.includes("staff.manage")) throw err("SELF_LOCKOUT", "You cannot remove staff.manage from your own role", { permission: "staff.manage" });
}
/** Known permissions only, dependencies added, never empty. `added` lists what the closure had to add. */
function cleanPerms(input: readonly string[]) {
  const bad = unknownPerms(input);
  if (bad.length) throw err("VALIDATION", "Unknown permission", { field: "permissions", unknown: bad });
  const c = closeDependencies(input);
  if (!c.permissions.length) throw err("VALIDATION", "A role needs at least one permission", { field: "permissions" });
  return c;
}
function cleanName(raw: string) {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) throw err("VALIDATION", "The name must have 2 to 60 characters", { field: "name" });
  return name;
}
const cleanDescription = (d: string | null | undefined) => (d?.trim() ? d.trim().slice(0, 300) : null);
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const membersOf = (key: string) => and(eq(users.role, "staff"), eq(users.staffRole, key));
async function propagate(x: Exec, key: string, permissions: string[]): Promise<number> {
  return (await x.update(users).set({ permissions, updatedAt: new Date() }).where(membersOf(key)).returning({ id: users.id })).length;
}
async function memberCount(x: Exec, key: string): Promise<number> {
  return (await x.select({ id: users.id }).from(users).where(membersOf(key))).length;
}

export interface RoleInput { name: string; description?: string | null; permissions?: string[]; copyFrom?: string }
/** `POST /admin/roles`: blank, or a copy of another role (`copyFrom`: its id or key; `permissions` given explicitly win over the copy). The key is generated from the name. */
export async function createRole(actor: User, i: RoleInput) {
  requirePerm(actor, "staff.manage");
  await ensureRoles();
  const name = cleanName(i.name);
  const src = i.copyFrom ? await mustFindRole(i.copyFrom) : null;
  const { permissions, added } = cleanPerms(i.permissions ?? src?.permissions ?? []);
  assertGrantable(actor, permissions);
  return db.transaction(async (tx) => {
    const all = await tx.select({ key: roles.key, name: roles.name }).from(roles);
    if (all.some((r) => sameName(r.name, name))) throw err("CONFLICT", "A role with this name already exists", { field: "name" });
    const [r] = await tx.insert(roles).values({ key: roleKeyFrom(name, new Set(all.map((r) => r.key))), name, description: cleanDescription(i.description), permissions, isSystem: false, createdBy: actor.id }).returning();
    await audit(actor, "role.create", "role", r.id, { key: r.key, name, permissions, copyFrom: src?.key ?? null }, tx);
    return { ...roleView(r, 0), autoAdded: added };
  });
}

/** `PATCH /admin/roles/:id`. System roles keep their name and description (the pages show the translated label); their permissions can change and be reset. */
export async function updateRole(actor: User, idOrKey: string, patch: { name?: string; description?: string | null; permissions?: string[] }) {
  requirePerm(actor, "staff.manage");
  return db.transaction(async (tx) => {
    const r = await mustFindRole(idOrKey, tx, true);
    const set: Partial<typeof roles.$inferInsert> = {}; const diff: Record<string, unknown> = {};
    if (patch.name !== undefined && patch.name.trim().replace(/\s+/g, " ") !== r.name) {
      if (r.isSystem) throw err("ROLE_SYSTEM", "System roles keep their name");
      const name = cleanName(patch.name);
      if ((await tx.select({ key: roles.key, name: roles.name }).from(roles)).some((o) => o.key !== r.key && sameName(o.name, name))) throw err("CONFLICT", "A role with this name already exists", { field: "name" });
      set.name = name; diff.name = { from: r.name, to: name };
    }
    if (patch.description !== undefined && cleanDescription(patch.description) !== r.description) {
      if (r.isSystem) throw err("ROLE_SYSTEM", "System roles keep their description");
      set.description = cleanDescription(patch.description); diff.description = { from: r.description, to: set.description };
    }
    let members: number | null = null; let autoAdded: string[] = [];
    if (patch.permissions !== undefined) {
      const c = cleanPerms(patch.permissions); autoAdded = c.added;
      const { added, removed } = diffPerms(r.permissions, c.permissions);
      if (added.length || removed.length) {
        assertNoSelfLockout(actor, r.key, c.permissions); assertGrantable(actor, added);
        set.permissions = c.permissions; members = await propagate(tx, r.key, c.permissions);
        Object.assign(diff, { added, removed, members, ...(autoAdded.length ? { autoAdded } : {}) });
      }
    }
    if (!Object.keys(set).length) return { ...roleView(r, await memberCount(tx, r.key)), autoAdded, changed: false };
    const [u] = await tx.update(roles).set({ ...set, updatedAt: new Date() }).where(eq(roles.id, r.id)).returning();
    await audit(actor, "role.update", "role", r.id, { key: r.key, ...diff }, tx);
    return { ...roleView(u, members ?? (await memberCount(tx, r.key))), autoAdded, changed: true };
  });
}

/**
 * `DELETE /admin/roles/:id` (custom roles only). While staff hold the role it is refused (`ROLE_IN_USE`) unless `reassignTo` names another role (id or key)
 * — or is `"custom"`: the members keep the permissions they have now, without a role.
 */
export async function deleteRole(actor: User, idOrKey: string, reassignTo?: string | null) {
  requirePerm(actor, "staff.manage");
  return db.transaction(async (tx) => {
    const r = await mustFindRole(idOrKey, tx, true);
    if (r.isSystem) throw err("ROLE_SYSTEM", "System roles cannot be deleted; reset them to their defaults instead");
    const members = await memberCount(tx, r.key);
    let to: string | null = null;
    if (members) {
      if (!reassignTo) throw err("ROLE_IN_USE", "Staff members still hold this role", { members });
      if (reassignTo === "custom") { await tx.update(users).set({ staffRole: null, updatedAt: new Date() }).where(membersOf(r.key)); to = "custom"; }
      else {
        const target = await mustFindRole(reassignTo, tx);
        if (target.id === r.id) throw err("VALIDATION", "Choose another role", { field: "reassignTo" });
        assertNoSelfLockout(actor, r.key, target.permissions); assertGrantable(actor, diffPerms(r.permissions, target.permissions).added);
        await tx.update(users).set({ staffRole: target.key, permissions: target.permissions, updatedAt: new Date() }).where(membersOf(r.key));
        to = target.key;
      }
    }
    await tx.delete(roles).where(eq(roles.id, r.id));
    await audit(actor, "role.delete", "role", r.id, { key: r.key, name: r.name, permissions: r.permissions, members, reassignedTo: to }, tx);
    return { ok: true, members, reassignedTo: to };
  });
}

/** `POST /admin/roles/:id/reset`: a system role goes back to its factory permissions (`STAFF_PRESETS`), and so do its members. */
export async function resetRole(actor: User, idOrKey: string) {
  requirePerm(actor, "staff.manage");
  return db.transaction(async (tx) => {
    const r: RoleRow = await mustFindRole(idOrKey, tx, true);
    if (!r.isSystem || !STAFF_PRESETS[r.key]) throw err("VALIDATION", "Only system roles have factory defaults", { field: "id" });
    const factory = normalizePerms(STAFF_PRESETS[r.key]);
    const { added, removed } = diffPerms(r.permissions, factory);
    if (!added.length && !removed.length) return { ...roleView(r, await memberCount(tx, r.key)), changed: false };
    assertNoSelfLockout(actor, r.key, factory); assertGrantable(actor, added);
    const [u] = await tx.update(roles).set({ permissions: factory, updatedAt: new Date() }).where(eq(roles.id, r.id)).returning();
    const members = await propagate(tx, r.key, factory);
    await audit(actor, "role.reset", "role", r.id, { key: r.key, added, removed, members }, tx);
    return { ...roleView(u, members), changed: true };
  });
}
