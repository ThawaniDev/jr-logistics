"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, Notice, Select } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { roleBlurb, roleLabel, type CatalogGroup, type RoleItem } from "./admin-roles-lib";
import { PermissionPicker } from "./admin-roles-picker";
import { samePerms } from "./admin-system-lib";

export interface StaffMeta { roles: RoleItem[]; groups: CatalogGroup[] }
export interface Access { staffRole: string; permissions: string[] }

/** The body a staff create / update sends: a role gives its permissions, "Custom" (no role) sends them one by one. */
export const accessPayload = (f: Access) => (f.staffRole ? { staffRole: f.staffRole } : { staffRole: null, permissions: f.permissions });

/**
 * Role and permissions of a staff member: pick a role from the roles table (system and custom, with their permission counts), or "Custom" to choose
 * this person's permissions one by one. With a role the permissions are the role's and cannot be edited here (change the role itself on Roles & permissions).
 */
export function StaffAccess({ meta, value, had, onChange }: { meta: StaffMeta; value: Access; had: string[]; onChange: (v: Access) => void }) {
  const { t } = useI18n(); const me = useUser();
  const role = value.staffRole ? meta.roles.find((r) => r.key === value.staffRole) : undefined;
  const differs = !!role && had.length > 0 && !samePerms(had, role.permissions);
  const pick = (key: string) => { const r = meta.roles.find((x) => x.key === key); onChange({ staffRole: key, permissions: r ? r.permissions : value.permissions }); };
  const counts = role ? meta.groups.map((g) => ({ id: g.id, n: g.permissions.filter((p) => role.permissions.includes(p.key)).length, of: g.permissions.length })).filter((g) => g.n > 0) : [];
  const options = meta.roles.map((r) => ({ value: r.key, label: t("rj.role_option", { name: roleLabel(t, r), n: r.permissionCount }) }));
  return (
    <div className="space-y-4">
      <Select data-testid="rdb-staff-preset" label={t("rj.role")} placeholder={t("staff.custom")} options={options} value={value.staffRole} onChange={(e) => pick(e.target.value)} hint={role ? undefined : t("rj.custom_hint")} />
      {role && (
        <div className="space-y-3 rounded-xl border border-line bg-bg2/40 p-3" data-testid="rj-staff-role-summary">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{roleLabel(t, role)} <span className="ltr-num text-xs font-normal text-muted">· {t(role.permissionCount === 1 ? "rj.perm_1" : "rj.perms_n", { n: role.permissionCount })}</span></p>
            {(hasPerm(me, "staff.view") || hasPerm(me, "staff.manage")) && <Link data-testid="rj-staff-open-role" href={`/admin/roles?role=${encodeURIComponent(role.key)}`} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">{t("rj.open_role")}<ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden /></Link>}
          </div>
          {roleBlurb(t, role) && <p className="text-xs text-muted">{roleBlurb(t, role)}</p>}
          <div className="flex flex-wrap gap-1.5">{counts.map((g) => <Badge key={g.id}>{t(`rj.group_${g.id}`)} <span className="ltr-num tabular-nums">{g.n}/{g.of}</span></Badge>)}</div>
          <p className="text-xs text-muted">{t("rj.access_from_role")}</p>
          {differs && <Notice tone="warn">{t("rj.staff_differs")}</Notice>}
        </div>)}
      {!role && (
        <div data-testid="rdb-staff-perms">
          <p className="mb-2 text-xs font-medium text-muted">{t("staff.perms")} <span className="ltr-num tabular-nums">({value.permissions.length})</span></p>
          <div className="max-h-80 overflow-y-auto rounded-xl border border-line p-3">
            <PermissionPicker groups={meta.groups} value={value.permissions} onChange={(permissions) => onChange({ ...value, permissions })} testIdPrefix="foa-perm"
              grantable={(p) => hasPerm(me, p) || had.includes(p)} />
          </div>
        </div>)}
    </div>
  );
}
