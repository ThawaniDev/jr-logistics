import type { User } from "@/db/schema";
import { err } from "@/lib/errors";
import { STAFF_PRESETS } from "./catalog";
import { ensureRoles, findRole } from "./roles";
import { diffPerms, samePermSet, unknownPerms } from "./roles-catalog";

/**
 * How a staff account gets its access (J8): the permissions of its role, or its own list when it has no role (`staffRole = null`, "Custom").
 * `createStaff` (no `current`) and `updateStaff` (`current` = the account today) call this; it returns the `{ staffRole, permissions }` to store,
 * or `null` when an update changes nothing about access.
 *  - `staffRole = <key>`: the role's permissions. `permissions` may be sent too, but only if they are exactly the role's (older clients send both).
 *  - `staffRole = null` (or ""): individual permissions — the ones sent, else the ones the person has now.
 *  - only `permissions` on an update: kept on the role when they equal it, otherwise the account becomes custom (its role no longer describes it).
 */
export async function resolveStaffAccess(actor: User, i: { staffRole?: string | null; permissions?: readonly string[] }, current?: Pick<User, "staffRole" | "permissions">): Promise<{ staffRole: string | null; permissions: string[] } | null> {
  const perms = i.permissions;
  if (perms) { const bad = unknownPerms(perms); if (bad.length) throw err("VALIDATION", "Unknown permission", { field: "permissions", unknown: bad }); }
  let next: { staffRole: string | null; permissions: string[] };
  if (i.staffRole) {
    let role = await findRole(i.staffRole);
    if (!role && i.staffRole in STAFF_PRESETS) { await ensureRoles(); role = await findRole(i.staffRole); }
    if (!role) throw err("VALIDATION", "Unknown role", { field: "staffRole" });
    if (perms && !samePermSet(perms, role.permissions)) throw err("VALIDATION", "Permissions come from the role; send staffRole null to set them one by one", { field: "permissions" });
    next = { staffRole: role.key, permissions: [...role.permissions] };
  } else if (i.staffRole === null || i.staffRole === "" || !current) next = { staffRole: null, permissions: [...(perms ?? current?.permissions ?? [])] };
  else if (perms) {
    const role = current.staffRole ? await findRole(current.staffRole) : null;
    next = role && samePermSet(perms, role.permissions) ? { staffRole: role.key, permissions: [...role.permissions] } : { staffRole: null, permissions: [...perms] };
  } else return null;
  if (current && next.staffRole === current.staffRole && samePermSet(next.permissions, current.permissions)) return null;
  if (actor.role !== "admin") {
    const missing = diffPerms(current?.permissions ?? [], next.permissions).added.filter((p) => !actor.permissions.includes(p));
    if (missing.length) throw err("FORBIDDEN", "You cannot grant permissions you do not have", { missing });
  }
  return next;
}
