import type { NavGroup } from "@/components/layout/nav";

/**
 * J4 — the driver's "Earnings" sidebar entry is called "Wallet & cash" for a driver whose wallet his office manages (he has no earnings to look at).
 * Everything else (href, icon, active state) is the same entry, so deep links and the tests that follow `/driver/wallet` keep working.
 */
export function relabelWalletNav(groups: NavGroup[], managedByOffice: boolean): NavGroup[] {
  if (!managedByOffice) return groups;
  return groups.map((g) => (g.items.some((i) => i.key === "nav.earnings") ? { ...g, items: g.items.map((i) => (i.key === "nav.earnings" ? { ...i, key: "jd.nav_wallet_cash" } : i)) } : g));
}
