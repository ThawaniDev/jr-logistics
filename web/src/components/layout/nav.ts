import { LayoutDashboard, FilePlus2, ListChecks, Wallet, Bell, LifeBuoy, KeyRound, UserCog, Truck, Briefcase, FileText, Users, Building2, Factory, ShieldCheck, Settings, ScrollText, Map, Coins, Tag, Handshake, ClipboardList, Gavel, UserRoundCog, Banknote, Radar, Star, Ban, BookOpen, Plug, Receipt, ArrowDownToLine, BookText, PieChart, Activity, PackageCheck, CircleDollarSign, Headset, MapPinned, Database, TrendingUp, Gauge } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

/** `badge` names a live counter the shell fills in (see `BADGES` in shell.tsx); items without one never show a number. */
export type BadgeId = "notifications" | "verification" | "cases" | "complaints" | "withdrawals" | "settlements" | "requests_action" | "incoming_orders";
/** `exact` items (the role dashboards) are active only on their own path, not on every page below it. */
/** `perm`: any one of these is enough; `all`: every one of these is needed (a report that needs both `reports.view` and `finance.view`). */
export interface NavItem { href: string; key: string; icon: LucideIcon; perm?: string | string[]; all?: string[]; badge?: BadgeId; exact?: boolean }
/** `id` is stable (it keys the saved open/closed state); a group without `key` has no heading and cannot be collapsed. */
export interface NavGroup { id: string; key?: string; items: NavItem[] }

const common = (base: string): NavItem[] => [
  { href: `${base}/support`, key: "nav.support", icon: LifeBuoy },
  { href: `${base}/notifications`, key: "nav.notifications", icon: Bell, badge: "notifications" },
];

/**
 * One sidebar per role. Rules the structure follows:
 *  - a *function* (finance, verification, support …) is a sidebar entry with its own page — never a tab bar inside one page;
 *  - a *state of one list* (status, role, period) is a filter on that list (<Segmented>), not a page;
 *  - an *entity* (company, office, driver, order) is a list page + a detail view whose sections are routes (<LinkTabs>).
 */
export const NAV: Record<string, NavGroup[]> = {
  business: [
    { id: "main", items: [{ href: "/business", key: "nav.dashboard", icon: LayoutDashboard, exact: true }] },
    { id: "orders", key: "nav.group_orders", items: [
      { href: "/business/requests/new", key: "nav.new_request", icon: FilePlus2 },
      { href: "/business/requests", key: "nav.requests", icon: ListChecks, badge: "requests_action" },
    ] },
    { id: "finance", key: "nav.group_finance", items: [
      { href: "/business/wallet", key: "nav.wallet", icon: Wallet },
      { href: "/business/cash", key: "nav.cash", icon: Coins },
    ] },
    { id: "reports", key: "nav.group_reports", items: [
      { href: "/business/reports", key: "nav.rep_overview", icon: PieChart, exact: true },
      { href: "/business/reports/deliveries", key: "nav.rep_deliveries", icon: PackageCheck },
      { href: "/business/reports/spending", key: "nav.rep_spending", icon: CircleDollarSign },
    ] },
    { id: "company", key: "nav.group_company", items: [
      { href: "/business/profile", key: "nav.profile_warehouse", icon: Factory },
      { href: "/business/documents", key: "nav.documents", icon: FileText },
      { href: "/business/integrations", key: "nav.integrations", icon: Plug },
      { href: "/business/integrations/orders", key: "iord.nav", icon: Inbox, badge: "incoming_orders" },
      { href: "/business/api", key: "nav.api", icon: KeyRound },
    ] },
    { id: "help", key: "nav.group_help", items: common("/business") },
  ],
  driver: [
    { id: "main", items: [
      { href: "/driver", key: "nav.dashboard", icon: LayoutDashboard, exact: true },
      { href: "/driver/opportunities", key: "nav.opportunities", icon: Briefcase },
      { href: "/driver/jobs", key: "nav.my_jobs", icon: Truck },
    ] },
    { id: "money", key: "nav.group_finance", items: [
      { href: "/driver/wallet", key: "nav.earnings", icon: Wallet },
      { href: "/driver/cash", key: "nav.cash_with_me", icon: Coins },
    ] },
    { id: "account", key: "nav.group_account", items: [
      { href: "/driver/documents", key: "nav.documents", icon: FileText },
      { href: "/driver/profile", key: "nav.profile", icon: UserCog },
      ...common("/driver"),
    ] },
  ],
  office: [
    { id: "main", items: [{ href: "/office", key: "nav.dashboard", icon: LayoutDashboard, exact: true }] },
    { id: "fleet", key: "nav.group_fleet", items: [
      { href: "/office/drivers", key: "nav.drivers", icon: Users },
      { href: "/office/opportunities", key: "nav.opportunities", icon: Briefcase },
      { href: "/office/jobs", key: "nav.jobs", icon: Truck },
    ] },
    { id: "finance", key: "nav.group_finance", items: [
      { href: "/office/settlements", key: "nav.settlements", icon: Receipt },
      { href: "/office/wallet", key: "nav.payouts", icon: Wallet },
      { href: "/office/agreement", key: "nav.agreement", icon: Handshake },
    ] },
    { id: "reports", key: "nav.group_reports", items: [
      { href: "/office/reports", key: "nav.rep_overview", icon: PieChart, exact: true },
      { href: "/office/reports/drivers", key: "nav.rep_drivers", icon: Truck },
      { href: "/office/reports/earnings", key: "nav.rep_earnings", icon: CircleDollarSign },
      { href: "/office/reports/performance", key: "nav.rep_performance", icon: Gauge },
    ] },
    { id: "account", key: "nav.group_account", items: [
      { href: "/office/documents", key: "nav.documents", icon: FileText },
      { href: "/office/profile", key: "nav.profile", icon: UserCog },
      ...common("/office"),
    ] },
  ],
  admin: [
    { id: "main", items: [
      { href: "/admin", key: "nav.dashboard", icon: LayoutDashboard, perm: ["requests.view", "finance.view", "users.view", "reports.view"], exact: true },
      { href: "/admin/operations", key: "nav.operations", icon: Radar, perm: "requests.view" },
      { href: "/admin/map", key: "nav.live_map", icon: Map, perm: "live_location.view" },
    ] },
    { id: "orders", key: "nav.group_orders", items: [
      { href: "/admin/requests", key: "nav.requests", icon: ListChecks, perm: "requests.view" },
      { href: "/admin/cancellations", key: "nav.cancellations", icon: Ban, perm: ["requests.view", "reports.view"] },
    ] },
    { id: "partners", key: "nav.group_partners", items: [
      { href: "/admin/companies", key: "nav.companies", icon: Factory, perm: ["users.view", "verification.manage", "offices.view"] },
      { href: "/admin/offices", key: "nav.offices", icon: Building2, perm: ["offices.view", "offices.manage"] },
      { href: "/admin/drivers", key: "nav.drivers", icon: Truck, perm: "drivers.view" },
      { href: "/admin/users", key: "nav.users", icon: Users, perm: "users.view" },
      { href: "/admin/verification", key: "nav.verification", icon: ShieldCheck, perm: ["verification.manage", "documents.review", "offices.view"], badge: "verification" },
    ] },
    { id: "finance", key: "nav.finance", items: [
      { href: "/admin/finance", key: "nav.fin_overview", icon: Banknote, perm: "finance.view", exact: true },
      { href: "/admin/finance/settlements", key: "nav.settlements", icon: Receipt, perm: ["finance.view", "settlements.review"], badge: "settlements" },
      { href: "/admin/finance/withdrawals", key: "nav.fin_withdrawals", icon: ArrowDownToLine, perm: ["finance.view", "withdrawals.manage"], badge: "withdrawals" },
      { href: "/admin/finance/drivers", key: "nav.fin_drivers", icon: Truck, perm: "finance.view" },
      { href: "/admin/finance/ledger", key: "nav.fin_ledger", icon: BookText, perm: ["finance.view", "wallets.view"] },
      { href: "/admin/finance/invoices", key: "nav.fin_invoices", icon: FileText, perm: "finance.view" },
      { href: "/admin/finance/cod", key: "nav.cod", icon: Coins, perm: ["cod.manage", "finance.view"] },
      { href: "/admin/finance/pricing", key: "nav.pricing", icon: Tag, perm: ["pricing.view", "pricing.edit"] },
    ] },
    { id: "support", key: "nav.group_support", items: [
      { href: "/admin/cases", key: "nav.cases", icon: ClipboardList, perm: "tickets.view", badge: "cases" },
      { href: "/admin/complaints", key: "nav.complaints", icon: Gavel, perm: "complaints.manage", badge: "complaints" },
    ] },
    { id: "reports", key: "nav.group_reports", items: [
      { href: "/admin/reports", key: "nav.rep_overview", icon: PieChart, perm: "reports.view", exact: true },
      { href: "/admin/reports/operations", key: "nav.rep_operations", icon: Activity, perm: "reports.view" },
      { href: "/admin/reports/deliveries", key: "nav.rep_deliveries", icon: PackageCheck, perm: "reports.view" },
      { href: "/admin/reports/finance", key: "nav.rep_finance", icon: CircleDollarSign, all: ["reports.view", "finance.view"] },
      { href: "/admin/reports/companies", key: "nav.rep_companies", icon: Factory, perm: "reports.view" },
      { href: "/admin/reports/drivers", key: "nav.rep_drivers", icon: Truck, perm: "reports.view" },
      { href: "/admin/reports/offices", key: "nav.rep_offices", icon: Building2, perm: "reports.view" },
      { href: "/admin/reports/cod", key: "nav.rep_cod", icon: Coins, perm: "reports.view" },
      { href: "/admin/reports/support", key: "nav.rep_support", icon: Headset, perm: "reports.view" },
      { href: "/admin/reports/geography", key: "nav.rep_geography", icon: MapPinned, perm: "reports.view" },
      { href: "/admin/reports/growth", key: "nav.rep_growth", icon: TrendingUp, perm: "reports.view" },
      { href: "/admin/reports/explorer", key: "nav.rep_explorer", icon: Database, perm: "reports.export" },
      { href: "/admin/ratings", key: "nav.ratings", icon: Star, perm: ["reports.view", "users.view"] },
    ] },
    { id: "system", key: "nav.group_system", items: [
      { href: "/admin/integrations", key: "nav.integrations", icon: Plug, perm: ["integrations.view", "requests.view"] },
      { href: "/admin/integrations/orders", key: "iord.nav", icon: Inbox, perm: ["integrations.view", "requests.view"] },
      { href: "/admin/roles", key: "nav.roles", icon: KeyRound, perm: ["staff.view", "staff.manage"] },
      { href: "/admin/staff", key: "nav.staff", icon: UserRoundCog, perm: ["staff.view", "staff.manage"] },
      { href: "/admin/settings", key: "nav.settings", icon: Settings, perm: ["settings.view", "settings.edit"] },
      { href: "/admin/audit", key: "nav.audit", icon: ScrollText, perm: "audit.view" },
      { href: "/scenarios", key: "nav.scenarios", icon: BookOpen },
      { href: "/admin/notifications", key: "nav.notifications", icon: Bell, badge: "notifications" },
    ] },
  ],
};
NAV.staff = NAV.admin;

/** The groups a user may see: items whose permission they lack are dropped, and so are groups left empty. Admins hold every permission. */
export function visibleNav(role: string, can: (perm: string) => boolean): NavGroup[] {
  const ok = (p?: string | string[]) => !p || (Array.isArray(p) ? p.some(can) : can(p));
  return (NAV[role] ?? []).map((g) => ({ ...g, items: g.items.filter((i) => ok(i.perm) && (!i.all || i.all.every(can))) })).filter((g) => g.items.length > 0);
}

/** The item whose href is the longest prefix of `path` (so `/admin/finance/ledger` lights Ledger, not Overview). `null` when none matches. */
export function activeItem(groups: NavGroup[], path: string): NavItem | null {
  let best: NavItem | null = null;
  for (const g of groups) for (const i of g.items) {
    const hit = i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/");
    if (hit && (!best || i.href.length > best.href.length)) best = i;
  }
  return best;
}

/** Every page of a role as a flat list, for the "jump to a page" palette. */
export const flatNav = (groups: NavGroup[]) => groups.flatMap((g) => g.items.map((item) => ({ item, group: g })));
