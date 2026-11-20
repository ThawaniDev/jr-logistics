import { ALL_PERMISSIONS, type Permission } from "./catalog";

/**
 * The permission catalogue as the Roles & permissions pages show it (J8): areas, dependencies and sensitivity. Pure (no database), so the pages and the tests use the very same tables.
 * Labels and one-line descriptions are i18n keys: `rjp.<permission>` and `rjp.<permission>.d`; the group names are `rj.group_<id>`.
 */
export interface PermGroup { id: string; perms: readonly Permission[] }

/** Every permission sits in exactly one group (unit test). The order is the order of the matrix. */
export const PERM_GROUPS: readonly PermGroup[] = [
  { id: "people", perms: ["users.view", "users.edit", "drivers.view", "drivers.sensitive", "accounts.create", "accounts.edit", "offices.view", "offices.manage", "verification.manage", "documents.review"] },
  { id: "orders", perms: ["requests.view", "requests.edit", "requests.assign", "attendance.edit", "replacements.manage", "live_location.view", "custody.view"] },
  { id: "integrations", perms: ["integrations.view", "integrations.manage"] },
  { id: "support", perms: ["tickets.view", "tickets.manage", "complaints.manage", "notes.manage"] },
  { id: "finance", perms: ["finance.view", "wallets.view", "wallet.adjust", "settlements.review", "settlements.approve", "payouts.execute", "withdrawals.manage", "cod.manage", "refunds.manage"] },
  { id: "pricing", perms: ["pricing.view", "pricing.edit"] },
  { id: "reports", perms: ["reports.view", "reports.export"] },
  { id: "admin", perms: ["staff.view", "staff.manage", "settings.view", "settings.edit", "audit.view", "broadcast.send"] },
];

/** `a: [b]` — holding `a` is pointless without `b` (the pages open through `b`). Saving a role adds the missing ones; the editor says so. */
export const PERM_REQUIRES: Readonly<Partial<Record<Permission, readonly Permission[]>>> = {
  "users.edit": ["users.view"],
  "drivers.sensitive": ["drivers.view"],
  "requests.edit": ["requests.view"], "requests.assign": ["requests.view"],
  "attendance.edit": ["requests.view"], "replacements.manage": ["requests.view"],
  "tickets.manage": ["tickets.view"],
  "wallet.adjust": ["wallets.view"],
  "settlements.approve": ["settlements.review"], "payouts.execute": ["settlements.review"],
  "pricing.edit": ["pricing.view"],
  "reports.export": ["reports.view"],
  "offices.manage": ["offices.view"],
  "integrations.manage": ["integrations.view"],
  "settings.edit": ["settings.view"],
  "staff.manage": ["staff.view"],
};

/** Money, personal data, access control and mass messages: the marks the picker shows next to them. */
export const SENSITIVE_PERMS: ReadonlySet<string> = new Set<Permission>([
  "drivers.sensitive", "accounts.edit", "wallet.adjust", "settlements.approve", "payouts.execute", "withdrawals.manage", "cod.manage", "refunds.manage",
  "pricing.edit", "reports.export", "audit.view", "broadcast.send", "settings.edit", "staff.manage",
]);

const ORDER = new Map<string, number>(ALL_PERMISSIONS.map((p, i) => [p, i]));
const known = (p: string): p is Permission => ORDER.has(p);

/** The permissions of the list that exist, without duplicates, in the canonical (catalogue) order. */
export const normalizePerms = (perms: readonly string[]): Permission[] => [...new Set(perms)].filter(known).sort((a, b) => ORDER.get(a)! - ORDER.get(b)!);
export const unknownPerms = (perms: readonly string[]): string[] => [...new Set(perms)].filter((p) => !known(p));

/** The list plus everything it needs (`users.edit` brings `users.view`); `added` is what was missing, in catalogue order. */
export function closeDependencies(perms: readonly string[]): { permissions: Permission[]; added: Permission[] } {
  const have = new Set(normalizePerms(perms));
  const added: Permission[] = [];
  const queue = [...have];
  while (queue.length) {
    for (const need of PERM_REQUIRES[queue.pop()!] ?? []) if (!have.has(need)) { have.add(need); added.push(need); queue.push(need); }
  }
  return { permissions: normalizePerms([...have]), added: normalizePerms(added) };
}

/** Everything that (directly or through another permission) needs `perm`: unticking `users.view` unticks `users.edit` as well. */
export function dependentsOf(perm: string): Permission[] {
  const out = new Set<Permission>();
  const walk = (p: string) => { for (const [k, needs] of Object.entries(PERM_REQUIRES) as Array<[Permission, readonly Permission[]]>) if (needs.includes(p as Permission) && !out.has(k)) { out.add(k); walk(k); } };
  walk(perm);
  return normalizePerms([...out]);
}

export function diffPerms(before: readonly string[], after: readonly string[]): { added: string[]; removed: string[] } {
  const b = new Set(before), a = new Set(after);
  return { added: [...a].filter((p) => !b.has(p)), removed: [...b].filter((p) => !a.has(p)) };
}
export const samePermSet = (a: readonly string[], b: readonly string[]) => { const x = new Set(a), y = new Set(b); return x.size === y.size && [...x].every((p) => y.has(p)); };

/** The catalogue as `GET /admin/roles/catalog` returns it. */
export function catalogView() {
  return {
    groups: PERM_GROUPS.map((g) => ({ id: g.id, permissions: g.perms.map((key) => ({ key, sensitive: SENSITIVE_PERMS.has(key), requires: [...(PERM_REQUIRES[key] ?? [])] })) })),
    total: ALL_PERMISSIONS.length,
  };
}

/** Keys the pages use as URL values (`/admin/staff?role=custom`), so no role may take them. */
export const RESERVED_ROLE_KEYS: readonly string[] = ["custom", "none", "all", "new"];
/** A slug from the name (letters and digits, `_` between), unique among `taken`; a name without Latin letters (Arabic, Urdu) becomes `role`, `role_2` … */
export function roleKeyFrom(name: string, taken: ReadonlySet<string>): string {
  const base = (name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32).replace(/_+$/, "")) || "role";
  const free = (k: string) => !taken.has(k) && !RESERVED_ROLE_KEYS.includes(k);
  if (free(base)) return base;
  for (let n = 2; ; n++) { const k = `${base}_${n}`; if (free(k)) return k; }
}

/** Names and descriptions the database stores for the six system roles (the pages show the translated `preset.<key>` label instead). */
export const SYSTEM_ROLE_INFO: Readonly<Record<string, { name: string; description: string }>> = {
  support: { name: "Support", description: "Answers customers: tickets, complaints and account lookups." },
  operations: { name: "Operations", description: "Runs the day: requests, assignment, attendance, live tracking, documents and cash on delivery." },
  finance: { name: "Finance", description: "Settlements, payouts, withdrawals, refunds and financial reports." },
  hr_verification: { name: "Verification", description: "Verifies drivers, companies and courier offices and reviews their documents." },
  account_manager: { name: "Account manager", description: "Looks after company accounts: requests, pricing, reports and support cases." },
  reports: { name: "Reports", description: "Read-only analytics, exports and the audit log." },
};
