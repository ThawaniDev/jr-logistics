"use client";
import { useState } from "react";
import { Wand2 } from "lucide-react";
import { Button, Input, Modal, Notice, Section, useAction } from "@/components/ui";
import { PasswordField } from "@/components/auth/password-field";
import { UsernameField, useUsernameCheck } from "@/components/auth/username-field";
import { generatePassword, passwordIssue } from "@/lib/gen-password";
import { patch, post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { fullErr } from "./admin-common";
import { StaffAccess, accessPayload, type StaffMeta } from "./admin-system-staff-access";

export type { StaffMeta };
export interface StaffEdit { id?: string; had?: string[]; name?: string; staffRole?: string | null; permissions?: string[] }

/** Add or edit a staff member: account details, role (or custom permissions). Mount it only while open (the state starts fresh each time). */
export function StaffFormModal({ edit, meta, onClose, onSaved }: { edit: StaffEdit; meta: StaffMeta; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n(); const me = useUser(); const a = useAction();
  const [f, setF] = useState({ name: edit.name ?? "", email: "", username: "", password: "", staffRole: edit.staffRole && meta.roles.some((r) => r.key === edit.staffRole) ? edit.staffRole : "", permissions: edit.permissions ?? [] }); // a role key that matches no role (older data) edits as custom
  const [err, setErr] = useState<string | null>(null);
  const isNew = !edit.id;
  const uname = useUsernameCheck(f.username, { skip: !isNew || !f.username.trim() });
  const pwIssue = isNew && f.password ? passwordIssue(f.password) : null;
  const save = () => a.run("s", () => edit.id
    ? patch(`/admin/staff/${edit.id}`, { name: f.name, ...accessPayload(f) })
    : post("/admin/staff", { name: f.name, email: f.email, username: f.username.trim() || undefined, password: f.password, ...accessPayload(f) }),
  { success: "common.saved", onDone: () => { onSaved(); onClose(); }, onError: (e) => setErr(fullErr(e, t)) });
  return (
    <Modal open onClose={onClose} busy={a.is("s")} title={isNew ? t("staff.add") : t("common.edit")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button data-testid="rdb-staff-save" loading={a.is("s")} disabled={!f.name || (isNew && (!f.email || !f.password || !!pwIssue || uname === "invalid" || uname === "reserved" || uname === "taken"))} onClick={save}>{t("common.save")}</Button></>}>
      {edit.id === me.id && me.role !== "admin" && <Notice tone="warn">{t("adm.cannot_edit_self")}</Notice>}
      <Section title={t("rdb.staff_account")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input data-testid="rdb-staff-name" label={t("common.name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          {isNew && <Input data-testid="rdb-staff-email" label={t("auth.email")} type="email" ltr value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}
          {isNew && <UsernameField label={t("ja.username")} value={f.username} onChange={(v) => setF({ ...f, username: v })} state={uname} testId="rdb-staff-username" autoComplete="off" hint={t("ja.cf_staff_username_hint")} />}
          {isNew && <PasswordField label={t("staff.temp_password")} value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" hint={t("staff.password_hint")} error={pwIssue ? t(pwIssue === "weak" ? "ja.err_pw_weak" : "ja.err_pw_short") : undefined} testId="rdb-staff-password"
            extra={<button type="button" onClick={() => setF({ ...f, password: generatePassword() })} aria-label={t("ja.cf_generate")} title={t("ja.cf_generate")} data-testid="rdb-staff-generate" className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:text-accent pointer-coarse:size-10"><Wand2 className="size-4" aria-hidden /></button>} />}
        </div>
      </Section>
      <Section title={t("rdb.staff_access")} description={t("adm.grant_note")}>
        <StaffAccess meta={meta} value={f} had={edit.had ?? []} onChange={(v) => setF({ ...f, ...v })} />
      </Section>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </Modal>
  );
}
