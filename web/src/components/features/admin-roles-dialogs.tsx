"use client";
import { useState } from "react";
import { Button, Input, Modal, Notice, Select, Textarea, useAction } from "@/components/ui";
import { api, post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { fullErr } from "./admin-common";
import { describeChange, roleLabel, type RoleItem } from "./admin-roles-lib";

/** What the "Create role" dialog hands over: the editor opens with these values and nothing is saved until Create. */
export interface RoleDraft { name: string; description: string; perms: string[]; from?: string }

/** "Create role" (blank, or a copy of an existing role) and "Duplicate" (the same, with the source and a name filled in). */
export function CreateRoleDialog({ roles, from, onContinue, onClose }: { roles: RoleItem[]; from?: string; onContinue: (d: RoleDraft) => void; onClose: () => void }) {
  const { t } = useI18n(); const me = useUser();
  const src = from ? roles.find((r) => r.key === from) : undefined;
  const [name, setName] = useState(src ? t("rj.copy_suffix", { name: roleLabel(t, src) }) : ""); const [desc, setDesc] = useState(""); const [start, setStart] = useState(from ?? "");
  const source = roles.find((r) => r.key === start);
  const holds = (p: string) => me.role === "admin" || me.permissions.includes(p);
  const perms = source ? source.permissions.filter(holds) : []; const dropped = source ? source.permissions.length - perms.length : 0;
  const taken = roles.some((r) => roleLabel(t, r).toLowerCase() === name.trim().toLowerCase() || r.name.toLowerCase() === name.trim().toLowerCase());
  const ok = name.trim().length >= 2 && !taken;
  const go = () => ok && onContinue({ name: name.trim(), description: desc.trim(), perms, from: source?.key });
  return (
    <Modal open onClose={onClose} title={t("rj.create_title")} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button data-testid="rj-create-continue" disabled={!ok} onClick={go}>{t("rj.continue")}</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <Input data-testid="rj-create-name" label={t("rj.name")} value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} error={taken ? t("rj.name_taken") : undefined} />
        <Textarea data-testid="rj-create-desc" label={t("rj.description")} placeholder={t("rj.description_ph")} value={desc} maxLength={300} onChange={(e) => setDesc(e.target.value)} />
        <Select data-testid="rj-create-from" label={t("rj.start_from")} value={start} onChange={(e) => setStart(e.target.value)}
          options={[{ value: "", label: t("rj.start_blank") }, ...roles.map((r) => ({ value: r.key, label: t("rj.start_copy", { name: roleLabel(t, r), n: r.permissionCount }) }))]} />
        {dropped > 0 && <Notice tone="warn">{t("rj.dropped", { n: dropped })}</Notice>}
      </form>
    </Modal>
  );
}

/** Delete a custom role. While people hold it, they must be moved to another role or detached (they keep their current permissions without a role). */
export function DeleteRoleDialog({ role, roles, onDone, onClose }: { role: RoleItem; roles: RoleItem[]; onDone: () => void; onClose: () => void }) {
  const { t } = useI18n(); const a = useAction();
  const [to, setTo] = useState(""); const [err, setErr] = useState<string | null>(null);
  const others = roles.filter((r) => r.key !== role.key);
  const needs = role.memberCount > 0;
  const run = () => a.run("del", () => api("DELETE", `/admin/roles/${role.key}`, needs ? { reassignTo: to } : undefined), { success: "rj.deleted", onDone, onError: (e) => setErr(fullErr(e, t)) });
  return (
    <Modal open onClose={onClose} busy={a.is("del")} title={t("rj.delete_title", { name: role.name })}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button variant="danger" data-testid="rj-delete-confirm" loading={a.is("del")} disabled={needs && !to} onClick={run}>{t("rj.delete_confirm")}</Button></>}>
      {needs ? (<>
        <Notice tone="warn">{t("rj.delete_body_members", { n: role.memberCount })}</Notice>
        <Select data-testid="rj-delete-to" label={t("rj.reassign_label")} placeholder={t("rj.reassign_choose")} value={to} onChange={(e) => setTo(e.target.value)}
          options={[...others.map((r) => ({ value: r.key, label: t("rj.role_option", { name: roleLabel(t, r), n: r.permissionCount }) })), { value: "custom", label: t("rj.reassign_custom") }]} />
      </>) : <p className="text-sm">{t("rj.delete_body_unused")}</p>}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </Modal>
  );
}

/** Put a system role back to its factory permissions (its members follow). */
export function ResetRoleDialog({ role, onDone, onClose }: { role: RoleItem; onDone: () => void; onClose: () => void }) {
  const { t } = useI18n(); const a = useAction(); const [err, setErr] = useState<string | null>(null);
  const d = describeChange(role.permissions, role.factory ?? role.permissions);
  const run = () => a.run("reset", () => post(`/admin/roles/${role.key}/reset`), { success: "rj.reset_done", onDone, onError: (e) => setErr(fullErr(e, t)) });
  return (
    <Modal open onClose={onClose} busy={a.is("reset")} title={t("rj.reset_title", { name: roleLabel(t, role) })}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button data-testid="rj-reset-confirm" loading={a.is("reset")} onClick={run}>{t("rj.reset")}</Button></>}>
      <p className="text-sm">{t("rj.reset_body", { a: d.added.length, r: d.removed.length, m: role.memberCount })}</p>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </Modal>
  );
}
