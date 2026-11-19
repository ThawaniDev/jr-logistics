/** Pure helpers shared by the company views and the verification workspace (kept free of React so they can be unit tested). */

export const COMPANY_STATES = ["all", "pending", "verified", "rejected", "info_requested", "suspended"] as const;
export type CompanyState = (typeof COMPANY_STATES)[number];
export const isCompanyState = (s: string | null | undefined): s is CompanyState => !!s && (COMPANY_STATES as readonly string[]).includes(s);

/** Query for GET /admin/companies: empty / "all" values are dropped, so the URL and the cache key stay clean. */
export function companiesQuery(o: { q?: string; state?: string; warehouse?: string; page?: number; pageSize?: number }) {
  const p = new URLSearchParams();
  if (o.q?.trim()) p.set("q", o.q.trim());
  if (o.state && o.state !== "all") p.set("state", o.state);
  if (o.warehouse === "missing" || o.warehouse === "set") p.set("warehouse", o.warehouse);
  if (o.page && o.page > 1) p.set("page", String(o.page));
  if (o.pageSize) p.set("pageSize", String(o.pageSize));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** What the page must warn about for a company (in the order the banners are shown). `ok` means nothing to flag. */
export type CompanyFlag = "account_suspended" | "verification_suspended" | "pending" | "info_requested" | "rejected";
export function companyFlags(c: { status: string; verificationStatus: string }): CompanyFlag[] {
  const out: CompanyFlag[] = [];
  if (c.status === "suspended") out.push("account_suspended");
  if (c.verificationStatus === "suspended") out.push("verification_suspended");
  else if (c.verificationStatus === "pending" || c.verificationStatus === "info_requested" || c.verificationStatus === "rejected") out.push(c.verificationStatus);
  return out;
}

export type CompanyTab = "overview" | "orders" | "warehouse" | "finance" | "documents";
/** The tabs a staff member can open, mirroring the permission each tab's API calls need. */
export function companyTabs(can: (perm: string) => boolean): CompanyTab[] {
  const any = (...p: string[]) => p.some(can);
  const tabs: CompanyTab[] = ["overview"];
  if (can("requests.view")) tabs.push("orders");
  if (any("users.view", "users.edit")) tabs.push("warehouse");
  if (any("finance.view", "wallets.view", "cod.manage")) tabs.push("finance");
  if (any("documents.review", "verification.manage")) tabs.push("documents");
  return tabs;
}
export const companyTabHref = (id: string, tab: CompanyTab) => `/admin/companies/${id}${tab === "overview" ? "" : `/${tab}`}`;

/** Which actions the header offers, from the current states and the viewer's permissions. */
export function companyActions(c: { status: string; verificationStatus: string }, can: (perm: string) => boolean) {
  const review = can("verification.manage") || can("offices.manage");
  const v = c.verificationStatus;
  return {
    verify: review && v !== "verified",
    requestInfo: review && v !== "info_requested",
    reject: review && v !== "rejected",
    suspendVerification: review && v === "verified",
    suspendAccount: can("users.edit") && c.status !== "suspended",
    activateAccount: can("users.edit") && c.status === "suspended",
  };
}

/** The old `/admin/verification?tab=…` URLs map onto the verification workspace's routes. `null` = not an old tab. */
export function verificationTabTarget(tab: string | null | undefined): string | null {
  switch (tab) {
    case "docs": case "documents": return "/admin/verification/documents";
    case "business": return "/admin/verification?kind=business";
    case "offices": case "office": return "/admin/verification?kind=office";
    case "drivers": return "/admin/verification/drivers";
    case "accounts": return "/admin/companies";
    default: return null;
  }
}

/** Where the owner of a document / account lives (null = no entity page the viewer may open). */
export function ownerHref(kind: string, id: string, can: (perm: string) => boolean): string | null {
  if (kind === "business") return can("users.view") || can("offices.view") || can("verification.manage") ? `/admin/companies/${id}` : null;
  if (kind === "office") return can("offices.view") || can("offices.manage") ? `/admin/offices/${id}` : null;
  if (kind === "driver") return can("drivers.view") ? `/admin/drivers/${id}` : null;
  return null;
}

/** Whole-number percentage, 0 when the total is 0. */
export const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

/** SWR keys that hold company or verification data, so one matcher refreshes them all after an action. */
export const isCompanyKey = (k: unknown) => typeof k === "string" && (k.startsWith("/admin/companies") || k.startsWith("/admin/verification") || k.startsWith("/admin/users") || k.startsWith("/admin/documents") || k.startsWith("/admin/offices"));
