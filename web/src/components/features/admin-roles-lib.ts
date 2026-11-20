import { PERM_GROUPS, closeDependencies, dependentsOf, diffPerms, normalizePerms } from "@/server/roles-catalog";

/** Shapes and pure helpers of the Roles & permissions pages (`/admin/roles`). */
export interface RoleItem {
  id: string; key: string; name: string; description: string | null; permissions: string[]; permissionCount: number; isSystem: boolean; memberCount: number;
  factory: string[] | null; modified: boolean;
}
export interface RoleMember { id: string; name: string; email: string | null; status: string; differs: boolean }
export interface RoleStats { roles: number; system: number; custom: number; staff: number; customPermissions: number }
export interface CatalogPerm { key: string; sensitive: boolean; requires: string[] }
export interface CatalogGroup { id: string; permissions: CatalogPerm[] }
type T = (k: string, v?: Record<string, string | number>) => string;

/** System roles show their translated `preset.<key>` label (the stored name is the English default); custom roles their own name. */
export function roleLabel(t: T, r: Pick<RoleItem, "key" | "name" | "isSystem">): string {
  if (!r.isSystem) return r.name;
  const v = t(`preset.${r.key}`);
  return v === `preset.${r.key}` ? r.name : v;
}
export function roleBlurb(t: T, r: Pick<RoleItem, "key" | "description" | "isSystem">): string {
  if (!r.isSystem) return r.description ?? "";
  const v = t(`rj.preset_${r.key}_d`);
  return v === `rj.preset_${r.key}_d` ? r.description ?? "" : v;
}

/** What an unsaved edit changes, in catalogue order. */
export function describeChange(before: readonly string[], after: readonly string[]) {
  const d = diffPerms(normalizePerms(before), normalizePerms(after));
  return { added: normalizePerms(d.added) as string[], removed: normalizePerms(d.removed) as string[], changed: d.added.length > 0 || d.removed.length > 0 };
}

export interface Note { added: string[]; removed: string[] }
/** Ticks or unticks one permission. Ticking brings what it needs, unticking drops what needs it; `note` says which extra permissions moved (the editor shows it). */
export function togglePerm(sel: readonly string[], key: string, on: boolean): { next: string[]; note: Note } {
  if (on) { const c = closeDependencies([...sel, key]); return { next: c.permissions, note: { added: c.added.filter((p) => p !== key), removed: [] } }; }
  const drop = [key, ...dependentsOf(key)];
  return { next: sel.filter((p) => !drop.includes(p)), note: { added: [], removed: dependentsOf(key).filter((p) => sel.includes(p)) } };
}
/** Ticks or clears a whole group (what the "select all" of a group does), with the same dependency rules. */
export function setMany(sel: readonly string[], keys: readonly string[], on: boolean): { next: string[]; note: Note } {
  if (on) { const c = closeDependencies([...sel, ...keys]); return { next: c.permissions, note: { added: c.added.filter((p) => !keys.includes(p)), removed: [] } }; }
  const drop = new Set([...keys, ...keys.flatMap(dependentsOf)]);
  return { next: sel.filter((p) => !drop.has(p)), note: { added: [], removed: [...drop].filter((p) => sel.includes(p) && !keys.includes(p)) } };
}

/** The permissions whose label, key or description contains the search text (all of them for an empty search). */
export function searchPerms(perms: readonly string[], q: string, label: (p: string) => string, desc: (p: string) => string): string[] {
  const n = q.trim().toLowerCase();
  return n ? perms.filter((p) => `${label(p)} ${p} ${desc(p)}`.toLowerCase().includes(n)) : [...perms];
}

/** One row of the read-only matrix: the permission and, per role (in the order given), whether the role holds it. */
export function matrixRows(roles: ReadonlyArray<{ permissions: readonly string[] }>) {
  return PERM_GROUPS.flatMap((g) => g.perms.map((key) => ({ group: g.id, key, has: roles.map((r) => r.permissions.includes(key)) })));
}
const cell = (v: string) => { const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** The matrix as CSV (UTF-8 with a BOM, so Excel reads Arabic): role names and labels are user text, so formula starters are neutralised. */
export function csvOfMatrix(roles: ReadonlyArray<{ permissions: readonly string[]; label: string }>, groupLabel: (id: string) => string, permLabel: (key: string) => string, heads: readonly [string, string, string] = ["Group", "Permission", "Key"]): string {
  const lines = [[...heads, ...roles.map((r) => r.label)].map(cell).join(",")];
  for (const r of matrixRows(roles)) lines.push([groupLabel(r.group), permLabel(r.key), r.key, ...r.has.map((h) => (h ? "1" : "0"))].map(cell).join(","));
  return "﻿" + lines.join("\n");
}
