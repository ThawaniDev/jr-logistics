"use client";
import { Suspense, useState } from "react";
import { Plus, ShieldCheck, UserCog, Users, Layers } from "lucide-react";
import { Button, ErrorState, PageHeader, PageLoading, Segmented, Stat, StatGrid } from "@/components/ui";
import { useUrlState } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { SENSITIVE_PERMS } from "@/server/roles-catalog";
import { ConfirmModal } from "./admin-common";
import { useCatalog, useRoleList } from "./admin-roles-data";
import { CreateRoleDialog, type RoleDraft } from "./admin-roles-dialogs";
import { RoleEditor } from "./admin-roles-editor";
import { RoleList } from "./admin-roles-list";
import { RolesMatrix } from "./admin-roles-matrix";

/** Roles & permissions (`/admin/roles`): the roles beside their editor, or the read-only matrix (`?view=matrix`). The selected role is `?role=<key>`. */
export function RolesConsole() { return <Suspense fallback={<PageLoading />}><RolesInner /></Suspense>; }

function RolesInner() {
  const { t } = useI18n(); const me = useUser();
  const list = useRoleList(); const catalog = useCatalog();
  const [view, setView] = useUrlState("view", "roles"); const [sel, setSel] = useUrlState("role", "");
  const [dialog, setDialog] = useState<null | { from?: string }>(null); const [draft, setDraft] = useState<RoleDraft | null>(null);
  const [dirty, setDirty] = useState(false); const [ask, setAsk] = useState<null | (() => void)>(null);
  if (list.error || catalog.error) return <ErrorState error={list.error ?? catalog.error} retry={() => { list.mutate(); catalog.mutate(); }} />;
  if (!list.data || !catalog.data) return <PageLoading />;
  const { items: roles, stats } = list.data; const canManage = hasPerm(me, "staff.manage");
  const selected = sel === "new" && draft ? "new" : roles.find((r) => r.key === sel)?.key ?? roles[0]?.key ?? "";
  const role = selected === "new" ? null : roles.find((r) => r.key === selected) ?? null;
  const guard = (go: () => void) => (dirty ? setAsk(() => go) : go()); // leaving an editor with unsaved changes asks first
  const select = (key: string) => guard(() => { setDraft(null); setSel(key); });
  const sensitiveRoles = roles.filter((r) => r.permissions.some((p) => SENSITIVE_PERMS.has(p))).length;
  const startDraft = (d: RoleDraft) => { setDialog(null); setDirty(false); setDraft(d); setSel("new"); };

  return (
    <>
      <PageHeader title={t("nav.roles")} subtitle={t("rj.sub")} icon={<ShieldCheck className="size-5" />}
        actions={canManage && <Button data-testid="rj-create" onClick={() => guard(() => setDialog({}))}><Plus className="size-4" aria-hidden />{t("rj.create")}</Button>} />
      <StatGrid cols={4} className="mb-6">
        <Stat label={t("rj.k_roles")} value={stats.roles} icon={<Layers className="size-5" aria-hidden />} hint={t("rj.k_roles_hint", { s: stats.system, c: stats.custom })} />
        <Stat label={t("rj.k_staff")} value={stats.staff} tone="cyan" icon={<Users className="size-5" aria-hidden />} href="/admin/staff" hint={t("rj.k_staff_hint", { n: stats.staff - stats.customPermissions })} />
        <Stat label={t("rj.k_custom")} value={stats.customPermissions} tone={stats.customPermissions ? "gold" : "muted"} icon={<UserCog className="size-5" aria-hidden />} href="/admin/staff?role=custom" hint={t("rj.k_custom_hint")} />
        <Stat label={t("rj.k_sensitive")} value={sensitiveRoles} tone={sensitiveRoles ? "danger" : "muted"} icon={<ShieldCheck className="size-5" aria-hidden />} hint={t("rj.k_sensitive_hint")} />
      </StatGrid>
      <div className="mb-4"><Segmented label={t("rj.view_label")} value={view} onChange={(v) => guard(() => setView(v))} options={[{ key: "roles", label: t("rj.view_roles") }, { key: "matrix", label: t("rj.view_matrix") }]} /></div>

      {view === "matrix" ? <RolesMatrix roles={roles} /> : (
        <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <RoleList roles={roles} selected={selected} draftName={draft ? draft.name : null} onSelect={select} />
          <RoleEditor key={selected} role={role} draft={selected === "new" ? draft : null} roles={roles} groups={catalog.data.groups} canManage={canManage}
            onDirty={setDirty} onDuplicate={(key) => guard(() => setDialog({ from: key }))}
            onDiscardDraft={() => { setDraft(null); setDirty(false); setSel(""); }}
            onGone={() => { setSel(""); void list.mutate(); }}
            onSaved={(key) => void list.mutate().then(() => { setDraft(null); setSel(key); })} />
        </div>)}

      {dialog && <CreateRoleDialog roles={roles} from={dialog.from} onClose={() => setDialog(null)} onContinue={startDraft} />}
      <ConfirmModal open={!!ask} onClose={() => setAsk(null)} title={t("rj.leave_title")} confirmLabel={t("rj.leave_confirm")} danger
        onConfirm={() => { const go = ask; setAsk(null); setDirty(false); go?.(); }}><p className="text-sm">{t("rj.leave_body")}</p></ConfirmModal>
    </>
  );
}
