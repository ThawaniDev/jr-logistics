"use client";
import { useState } from "react";
import { Button, Checkbox, Input, Modal, Notice, Section, Select, useAction } from "@/components/ui";
import { patch, post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { fullErr } from "./admin-common";
import { groupPermissions, samePerms } from "./admin-system-lib";

/** One-line explanations for permissions whose raw key alone is not self-explanatory (the list shows the key plus this hint). */
const PERM_HINT: Record<string, string> = { "cod.manage": "foa.perm_cod_manage" };
export interface StaffMeta { permissions: string[]; presets: Record<string, string[]> }
export interface StaffEdit { id?: string; had?: string[]; name?: string; staffRole?: string | null; permissions?: string[] }

/** Permissions grouped by area with a "select all" per group. What the signed-in person does not hold cannot be granted (the server enforces the same). */
function PermissionPicker({ meta, value, onChange, grantable }: { meta: StaffMeta; value: string[]; onChange: (v: string[]) => void; grantable: (p: string) => boolean }) {
  const { t } = useI18n();
  const toggle = (p: string) => onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  return (
    <div className="max-h-60 space-y-4 overflow-y-auto rounded-xl border border-line p-3" data-testid="rdb-staff-perms">
      {groupPermissions(meta.permissions).map((g) => {
        const own = g.perms.filter(grantable); const all = own.length > 0 && own.every((p) => value.includes(p));
        return (
          <div key={g.area} role="group" aria-label={t(`rdb.perm_area_${g.area}`)} className="space-y-2">
            <div className="flex w-full items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
              <span>{t(`rdb.perm_area_${g.area}`)}</span>
              {own.length > 0 && <button type="button" className="rounded px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-accent hover:underline"
                onClick={() => onChange(all ? value.filter((p) => !own.includes(p)) : [...new Set([...value, ...own])])}>{t(all ? "rdb.perm_clear_area" : "rdb.perm_select_area")}</button>}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {g.perms.map((p) => <Checkbox key={p} data-testid={`foa-perm-${p}`} checked={value.includes(p)} disabled={!grantable(p)} onChange={() => toggle(p)}
                label={<><span className="ltr-num text-xs">{p}</span>{PERM_HINT[p] && <span className="block text-[11px] text-muted">{t(PERM_HINT[p])}</span>}</>} />)}
            </div>
          </div>);
      })}
    </div>
  );
}

/** Add or edit a staff member: account details, role preset and permissions. Mount it only while open (the state starts fresh each time). */
export function StaffFormModal({ edit, meta, onClose, onSaved }: { edit: StaffEdit; meta: StaffMeta; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n(); const me = useUser(); const a = useAction();
  const [f, setF] = useState({ name: edit.name ?? "", email: "", password: "", staffRole: edit.staffRole ?? "", permissions: edit.permissions ?? [] });
  const [err, setErr] = useState<string | null>(null);
  const isNew = !edit.id;
  const grantable = (p: string) => hasPerm(me, p) || (edit.had ?? []).includes(p);
  const preset = f.staffRole ? meta.presets[f.staffRole] : undefined;
  const custom = !!preset && !samePerms(preset, f.permissions);
  const pickPreset = (k: string) => setF((p) => ({ ...p, staffRole: k, permissions: k ? meta.presets[k] ?? [] : p.permissions }));
  const save = () => a.run("s", () => edit.id
    ? patch(`/admin/staff/${edit.id}`, { name: f.name, staffRole: f.staffRole || null, permissions: f.permissions })
    : post("/admin/staff", { name: f.name, email: f.email, password: f.password, staffRole: f.staffRole || undefined, permissions: f.permissions }),
  { success: "common.saved", onDone: () => { onSaved(); onClose(); }, onError: (e) => setErr(fullErr(e, t)) });
  return (
    <Modal open onClose={onClose} busy={a.is("s")} title={isNew ? t("staff.add") : t("common.edit")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button data-testid="rdb-staff-save" loading={a.is("s")} disabled={!f.name || (isNew && (!f.email || !f.password))} onClick={save}>{t("common.save")}</Button></>}>
      {edit.id === me.id && me.role !== "admin" && <Notice tone="warn">{t("adm.cannot_edit_self")}</Notice>}
      <Section title={t("rdb.staff_account")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input data-testid="rdb-staff-name" label={t("common.name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          {isNew && <Input data-testid="rdb-staff-email" label={t("auth.email")} type="email" ltr value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}
          {isNew && <div className="sm:col-span-2"><Input data-testid="rdb-staff-password" label={t("staff.temp_password")} type="password" ltr autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} hint={t("staff.password_hint")} /></div>}
        </div>
      </Section>
      <Section title={t("rdb.staff_access")} description={t("adm.grant_note")}>
        <div className="space-y-4">
          <Select data-testid="rdb-staff-preset" label={t("staff.preset")} placeholder={t("staff.custom")} options={Object.keys(meta.presets).map((k) => ({ value: k, label: t(`preset.${k}`) }))} value={f.staffRole} onChange={(e) => pickPreset(e.target.value)}
            hint={custom ? t("rdb.staff_customised") : undefined} />
          <div>
            <p className="mb-2 text-xs font-medium text-muted">{t("staff.perms")} <span className="ltr-num tabular-nums">({f.permissions.length})</span></p>
            <PermissionPicker meta={meta} value={f.permissions} onChange={(v) => setF({ ...f, permissions: v })} grantable={grantable} />
          </div>
        </div>
      </Section>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </Modal>
  );
}
