import { NAV, activeItem, visibleNav, type NavItem } from "./nav";

/**
 * The sidebar entry that owns `path` when the signed-in user is NOT allowed to see it (so he must not open the page either), else `null`.
 * The match is the same longest-prefix rule as the highlighted sidebar item, over the role's whole menu: `/admin/companies/:id/orders`
 * belongs to Companies, `/admin/finance/ledger` to Wallet ledger. Paths that no entry owns (redirect pages, `/account/…`) are never blocked.
 * The page behind a blocked path is not mounted at all, so it fires no requests that can only answer 403.
 */
/** Landing pages that choose where to send a user who lacks their own permission (Finance → the first finance page he may open; the dashboard): they are never blocked. */
const SELF_LANDING = new Set(["/admin", "/admin/finance"]);

/** Pages the API opens to more permissions than their sidebar entry shows (they are reached from other pages: the verification queue, company pages): the same list as the server (`OFFICE_VIEW` in server/offices-admin.ts). */
const ALSO_OPEN: Record<string, readonly string[]> = { "/admin/offices": ["users.view", "verification.manage"] };

export function blockedNavItem(role: string, can: (perm: string) => boolean, path: string): NavItem | null {
  const owner = activeItem(NAV[role] ?? [], path);
  if (!owner || SELF_LANDING.has(owner.href)) return null;
  if (ALSO_OPEN[owner.href]?.some(can)) return null;
  const allowed = visibleNav(role, can).some((g) => g.items.includes(owner));
  return allowed ? null : owner;
}
