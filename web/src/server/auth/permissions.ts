import type { User } from "@/db/schema";
import { err } from "@/lib/errors";
import type { Permission, Role } from "../catalog";

export const isBackoffice = (u: Pick<User, "role">) => u.role === "admin" || u.role === "staff";

export function can(u: Pick<User, "role" | "permissions">, perm: Permission): boolean {
  if (u.role === "admin") return true;
  if (u.role === "staff") return u.permissions.includes(perm);
  return false;
}
export function requirePerm(u: Pick<User, "role" | "permissions">, ...perms: Permission[]) {
  if (!perms.some((p) => can(u, p))) throw err("FORBIDDEN", "Missing permission");
}
export function requireRole(u: Pick<User, "role">, ...roles: Role[]) {
  if (!roles.includes(u.role as Role)) throw err("FORBIDDEN", "Role not allowed");
}
