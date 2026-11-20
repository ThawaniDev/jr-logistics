"use client";
import { useEffect, useState } from "react";
import { Copy, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, Input, Notice, Section, Textarea, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { patch, post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { fullErr } from "./admin-common";
import { UnsavedBar } from "./admin-roles-bar";
import { DeleteRoleDialog, ResetRoleDialog, type RoleDraft } from "./admin-roles-dialogs";
import { describeChange, roleBlurb, roleLabel, type CatalogGroup, type RoleItem, type RoleMember } from "./admin-roles-lib";
import { MembersCard } from "./admin-roles-members";
import { PermissionPicker } from "./admin-roles-picker";

/**
 * The editor of one role (`role`), or of a role that does not exist yet (`draft`, no `role`): name and description (custom roles), the permission matrix,
 * the unsaved-changes bar with Save / Discard, Duplicate / Reset / Delete, and the members. Mount it with `key` = the role key so its state starts fresh.
 */
export function RoleEditor({ role, draft, roles, groups, canManage, onSaved, onGone, onDuplicate, onDiscardDraft, onDirty }: {
  role: RoleItem | null; draft: RoleDraft | null; roles: RoleItem[]; groups: CatalogGroup[]; canManage: boolean;
  onSaved: (key: string) => void; onGone: () => void; onDuplicate: (key: string) => void; onDiscardDraft: () => void; onDirty: (dirty: boolean) => void;
}) {
  const { t } = useI18n(); const me = useUser(); const a = useAction();
  const isNew = !role;
  const [name, setName] = useState(role ? role.name : draft?.name ?? ""); const [desc, setDesc] = useState(role ? role.description ?? "" : draft?.description ?? "");
  const [perms, setPerms] = useState<string[]>(role ? role.permissions : draft?.perms ?? []);
  const [err, setErr] = useState<string | null>(null); const [dlg, setDlg] = useState<null | "reset" | "delete">(null);
  const detail = useApi<{ members: RoleMember[] }>(role ? `/admin/roles/${role.key}` : null);
  const editMeta = canManage && !role?.isSystem; // custom roles (and a new one) can be renamed; system roles keep their translated name
  const change = describeChange(role?.permissions ?? [], perms);
  const meta = [editMeta && role && name.trim() !== role.name && t("rj.name_changed"), editMeta && role && desc.trim() !== (role.description ?? "") && t("rj.desc_changed")].filter(Boolean) as string[];
  const dirty = isNew || change.changed || meta.length > 0;
  useEffect(() => onDirty(canManage && dirty), [canManage, dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirty(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  const grantable = (p: string) => me.role === "admin" || me.permissions.includes(p) || !!role?.permissions.includes(p);
  const canSave = isNew ? name.trim().length >= 2 && perms.length > 0 : perms.length > 0 && (!editMeta || name.trim().length >= 2);

  const save = () => a.run("save", () => isNew
    ? post<RoleItem>("/admin/roles", { name: name.trim(), description: desc.trim() || null, permissions: perms, copyFrom: draft?.from })
    : patch<RoleItem>(`/admin/roles/${role.key}`, { permissions: perms, ...(role.isSystem ? {} : { name: name.trim(), description: desc.trim() || null }) }),
  { success: "rj.saved", onDone: (r) => { setErr(null); detail.mutate(); onSaved(r.key); }, onError: (e) => setErr(fullErr(e, t)) });
  const discard = () => { if (isNew) return onDiscardDraft(); setPerms(role.permissions); setName(role.name); setDesc(role.description ?? ""); setErr(null); };

  const badges = <>
    {role ? <Badge tone={role.isSystem ? "info" : "neutral"}>{t(role.isSystem ? "rj.badge_system" : "rj.badge_custom")}</Badge> : <Badge tone="success">{t("rj.badge_new")}</Badge>}
    {role?.modified && <Badge tone="warn">{t("rj.badge_modified")}</Badge>}
  </>;
  return (
    <div className="space-y-6" data-testid="rj-editor" data-role={role?.key ?? "new"}>
      <Section title={<span className="inline-flex flex-wrap items-center gap-2"><ShieldCheck className="size-5 text-accent" aria-hidden /><span data-testid="rj-editor-title">{role ? roleLabel(t, role) : name.trim() || t("rj.new_title")}</span>{badges}</span>}
        description={role ? roleBlurb(t, role) : t("rj.new_note")}
        actions={role && canManage ? <>
          <Button size="sm" variant="secondary" data-testid="rj-duplicate" onClick={() => onDuplicate(role.key)}><Copy className="size-4" aria-hidden />{t("rj.duplicate")}</Button>
          {role.isSystem && <Button size="sm" variant="secondary" data-testid="rj-reset" disabled={!role.modified} title={role.modified ? undefined : t("rj.reset_none")} onClick={() => setDlg("reset")}><RotateCcw className="size-4" aria-hidden />{t("rj.reset")}</Button>}
          {!role.isSystem && <Button size="sm" variant="danger" data-testid="rj-delete" onClick={() => setDlg("delete")}><Trash2 className="size-4" aria-hidden />{t("rj.delete")}</Button>}
        </> : undefined}>
        <div className="space-y-5">
          {!canManage && <Notice tone="info">{t("rj.read_only")}</Notice>}
          {role?.isSystem && <Notice tone="info">{t("rj.system_note")}</Notice>}
          {editMeta && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Input data-testid="rj-name" label={t("rj.name")} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <Textarea data-testid="rj-desc" label={t("rj.description")} placeholder={t("rj.description_ph")} className="min-h-10" rows={2} value={desc} maxLength={300} onChange={(e) => setDesc(e.target.value)} />
            </div>)}
          <PermissionPicker groups={groups} value={perms} onChange={setPerms} readOnly={!canManage} grantable={grantable} />
        </div>
      </Section>
      {canManage && <UnsavedBar added={change.added} removed={change.removed} meta={meta} total={perms.length} isNew={isNew} dirty={dirty} canSave={canSave} busy={a.is("save")} error={err} onSave={save} onDiscard={discard} />}
      {role && <MembersCard roleKey={role.key} members={detail.data?.members} />}
      {dlg === "reset" && role && <ResetRoleDialog role={role} onClose={() => setDlg(null)} onDone={() => { setDlg(null); setPerms(role.factory ?? role.permissions); onSaved(role.key); detail.mutate(); }} />}
      {dlg === "delete" && role && <DeleteRoleDialog role={role} roles={roles} onClose={() => setDlg(null)} onDone={() => { setDlg(null); onGone(); }} />}
    </div>
  );
}
