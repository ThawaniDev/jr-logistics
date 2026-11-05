import { LayoutDashboard, FilePlus2, ListChecks, Wallet, Bell, LifeBuoy, KeyRound, UserCog, Truck, Briefcase, FileText, Users, Building2, ShieldCheck, Settings, ScrollText, BarChart3, Map, Coins, Tag, Handshake, ClipboardList, Gavel, UserRoundCog, Banknote, Radar } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem { href: string; key: string; icon: LucideIcon; perm?: string | string[] }
export interface NavGroup { key?: string; items: NavItem[] }

const common = (base: string): NavItem[] => [
  { href: `${base}/notifications`, key: "nav.notifications", icon: Bell },
  { href: `${base}/support`, key: "nav.support", icon: LifeBuoy },
];

export const NAV: Record<string, NavGroup[]> = {
  business: [
    { items: [
      { href: "/business", key: "nav.dashboard", icon: LayoutDashboard },
      { href: "/business/requests/new", key: "nav.new_request", icon: FilePlus2 },
      { href: "/business/requests", key: "nav.requests", icon: ListChecks },
      { href: "/business/wallet", key: "nav.wallet", icon: Wallet },
    ] },
    { key: "nav.group_more", items: [
      { href: "/business/documents", key: "nav.documents", icon: FileText },
      { href: "/business/api", key: "nav.api", icon: KeyRound },
      { href: "/business/profile", key: "nav.profile", icon: UserCog },
      ...common("/business"),
    ] },
  ],
  driver: [
    { items: [
      { href: "/driver", key: "nav.dashboard", icon: LayoutDashboard },
      { href: "/driver/opportunities", key: "nav.opportunities", icon: Briefcase },
      { href: "/driver/jobs", key: "nav.my_jobs", icon: Truck },
      { href: "/driver/wallet", key: "nav.earnings", icon: Wallet },
    ] },
    { key: "nav.group_more", items: [
      { href: "/driver/documents", key: "nav.documents", icon: FileText },
      { href: "/driver/profile", key: "nav.profile", icon: UserCog },
      ...common("/driver"),
    ] },
  ],
  office: [
    { items: [
      { href: "/office", key: "nav.dashboard", icon: LayoutDashboard },
      { href: "/office/drivers", key: "nav.drivers", icon: Users },
      { href: "/office/opportunities", key: "nav.opportunities", icon: Briefcase },
      { href: "/office/jobs", key: "nav.active_jobs", icon: Truck },
    ] },
    { key: "nav.group_finance", items: [
      { href: "/office/settlements", key: "nav.settlements", icon: Coins },
      { href: "/office/wallet", key: "nav.payouts", icon: Wallet },
      { href: "/office/agreement", key: "nav.agreement", icon: Handshake },
    ] },
    { key: "nav.group_more", items: [
      { href: "/office/documents", key: "nav.documents", icon: FileText },
      { href: "/office/profile", key: "nav.profile", icon: UserCog },
      ...common("/office"),
    ] },
  ],
  admin: [
    { items: [
      { href: "/admin", key: "nav.dashboard", icon: LayoutDashboard, perm: ["requests.view", "finance.view", "users.view", "reports.view"] },
      { href: "/admin/operations", key: "nav.operations", icon: Radar, perm: "requests.view" },
      { href: "/admin/requests", key: "nav.requests", icon: ListChecks, perm: "requests.view" },
      { href: "/admin/map", key: "nav.live_map", icon: Map, perm: "live_location.view" },
    ] },
    { key: "nav.group_people", items: [
      { href: "/admin/verification", key: "nav.verification", icon: ShieldCheck, perm: ["verification.manage", "documents.review", "offices.view"] },
      { href: "/admin/users", key: "nav.users", icon: Users, perm: "users.view" },
      { href: "/admin/drivers", key: "nav.drivers", icon: Truck, perm: "drivers.view" },
      { href: "/admin/offices", key: "nav.offices", icon: Building2, perm: ["offices.view", "offices.manage"] },
    ] },
    { key: "nav.group_finance", items: [
      { href: "/admin/pricing", key: "nav.pricing", icon: Tag, perm: ["pricing.view", "pricing.edit"] },
      { href: "/admin/finance", key: "nav.finance", icon: Banknote, perm: ["finance.view", "settlements.review"] },
      { href: "/admin/reports", key: "nav.reports", icon: BarChart3, perm: "reports.view" },
    ] },
    { key: "nav.group_support", items: [
      { href: "/admin/cases", key: "nav.cases", icon: ClipboardList, perm: ["tickets.view", "complaints.manage"] },
      { href: "/admin/complaints", key: "nav.complaints", icon: Gavel, perm: "complaints.manage" },
    ] },
    { key: "nav.group_system", items: [
      { href: "/admin/staff", key: "nav.staff", icon: UserRoundCog, perm: ["staff.view", "staff.manage"] },
      { href: "/admin/settings", key: "nav.settings", icon: Settings, perm: ["settings.view", "settings.edit"] },
      { href: "/admin/audit", key: "nav.audit", icon: ScrollText, perm: "audit.view" },
      { href: "/admin/notifications", key: "nav.notifications", icon: Bell },
    ] },
  ],
};
NAV.staff = NAV.admin;
