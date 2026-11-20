/** Pure helpers of the user view (`/admin/users/:id`): which sections a viewer may open for which kind of account, and where each kind of person has their own page. */
export const USER_TABS = ["overview", "security", "activity", "notes", "raw"] as const;
export type UserTab = (typeof USER_TABS)[number];
export const isStaffRole = (role: string) => role === "staff" || role === "admin";

/** Sections of the user view for this viewer. Staff and admin accounts are covered by the staff permissions, everyone else by the people permissions (the API enforces the same). */
export function userTabs(role: string, can: (perm: string) => boolean): UserTab[] {
  const any = (...p: string[]) => p.some(can);
  const staff = isStaffRole(role);
  const allowed: Record<UserTab, boolean> = {
    overview: true,
    security: staff ? any("staff.view", "staff.manage") : can("users.view"),
    activity: any("users.view", "drivers.view", "offices.view"),
    notes: any("users.view", "drivers.view", "offices.view"),
    raw: true,
  };
  return USER_TABS.filter((k) => allowed[k]);
}
export const userTabHref = (id: string, tab: UserTab) => `/admin/users/${id}${tab === "overview" ? "" : `/${tab}`}`;

/** The page that shows a person in full: companies, offices and drivers have their own entity views, everyone else the user view. */
export const userEntityHref = (role: string | null | undefined, id: string) => (role === "business" ? `/admin/companies/${id}` : role === "office" ? `/admin/offices/${id}` : role === "driver" ? `/admin/drivers/${id}` : `/admin/users/${id}`);

/** Where an audit entry's target is shown (`null` = no page for it). */
export function auditTargetHref(entity: string, id: string | null): string | null {
  if (!id) return null;
  switch (entity) {
    case "user": return `/admin/users/${id}`;
    case "request": return `/admin/requests/${id}`;
    case "ticket": return `/admin/cases/${id}`;
    case "complaint": return `/admin/complaints/${id}`;
    default: return null;
  }
}
