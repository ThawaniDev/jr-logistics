"use client";
import { useState } from "react";
import { Copy, KeyRound, Pencil, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Modal, Notice, Section, errText } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { PasswordField } from "@/components/auth/password-field";
import { UsernameField, useUsernameCheck } from "@/components/auth/username-field";
import { fieldProblems } from "@/components/auth/auth-errors";
import { patch, post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { generatePassword, passwordIssue } from "@/lib/gen-password";
import { normalizeUsername } from "@/lib/username";
import { useI18n } from "@/i18n/provider";

interface Credentials { id: string; role: string; username: string | null; hasPassword: boolean; mustChangePassword: boolean; failedLogins: number; lockedUntil: string | null; status: string }
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** The account id inside an admin API path (`/admin/users/<id>/security` …). */
export const idFromPath = (path: string) => path.match(UUID)?.[0] ?? null;

/**
 * Sign-in details of an account for the staff who may manage them (J1d): the username (change it), whether the password is temporary / missing / locked, and "Reset password"
 * (a strong one is generated and shown once, or staff type one; the person must replace it at the next sign-in and is signed out everywhere). Renders nothing when the viewer lacks the permission.
 */
export function CredentialsCard({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const { data, mutate, error } = useApi<Credentials>(`/admin/users/${id}/credentials`, { shouldRetryOnError: false });
  const [rename, setRename] = useState(false); const [reset, setReset] = useState(false);
  if (error || !data) return null;
  const locked = !!data.lockedUntil && new Date(data.lockedUntil) > new Date();
  return (
    <Section title={t("ja.cred_title")} description={t("ja.cred_sub")} actions={<>
      <Button size="sm" variant="secondary" onClick={() => setRename(true)} data-testid="cred-rename"><Pencil className="size-4" aria-hidden />{t("ja.cred_change_username")}</Button>
      <Button size="sm" variant="secondary" onClick={() => setReset(true)} data-testid="cred-reset"><KeyRound className="size-4" aria-hidden />{t("ja.cred_reset")}</Button></>}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="cred-card">
        <div><p className="text-xs text-muted">{t("ja.username")}</p><p className="font-mono text-base font-semibold" dir="ltr" data-testid="cred-username">{data.username ?? "—"}</p></div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!data.hasPassword && <Badge tone="danger">{t("ja.cred_no_password")}</Badge>}
          {data.mustChangePassword && <Badge tone="warn" className="whitespace-normal">{t("ja.cred_must_change")}</Badge>}
          {locked && <Badge tone="danger">{t("ja.cred_locked", { when: fmtDateTime(data.lockedUntil!, locale) })}</Badge>}
        </div>
      </div>
      {rename && <RenameDialog data={data} onClose={() => setRename(false)} onDone={() => { setRename(false); void mutate(); }} />}
      {reset && <ResetDialog data={data} onClose={() => { setReset(false); void mutate(); }} />}
    </Section>
  );
}

function RenameDialog({ data, onClose, onDone }: { data: Credentials; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(data.username ?? ""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const same = normalizeUsername(name) === (data.username ?? "");
  const state = useUsernameCheck(name, { skip: same });
  const bad = state === "invalid" || state === "reserved" || state === "taken";
  async function save() {
    setBusy(true); setErr(null);
    try { await patch(`/admin/users/${data.id}/username`, { username: name }); toast.success(t("ja.cred_username_saved")); onDone(); }
    catch (e) { setErr(fieldProblems(e, t).username ?? errText(e, t)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={t("ja.cred_change_username")} busy={busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button><Button onClick={() => void save()} loading={busy} disabled={same || bad || !name.trim()} data-testid="cred-rename-save">{t("common.save")}</Button></>}>
      <p className="text-sm text-muted">{t("ja.cred_rename_hint")}</p>
      <UsernameField label={t("ja.username")} value={name} onChange={(v) => { setName(v); setErr(null); }} state={state} error={err ?? undefined} testId="cred-username-input" autoFocus autoComplete="off" />
    </Modal>
  );
}

function ResetDialog({ data, onClose }: { data: Credentials; onClose: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"generate" | "type">("generate"); const [pw, setPw] = useState("");
  const [done, setDone] = useState<null | { password: string; generated: boolean }>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const issue = mode === "type" && pw ? passwordIssue(pw) : null;
  async function submit() {
    setBusy(true); setErr(null);
    try {
      const r = await post(`/admin/users/${data.id}/reset-password`, mode === "type" ? { password: pw } : {});
      setDone({ password: r.password ?? pw, generated: !!r.generated });
    } catch (e) { setErr(fieldProblems(e, t).password ?? errText(e, t)); } finally { setBusy(false); }
  }
  const copy = (s: string) => void navigator.clipboard?.writeText(s).then(() => toast.success(t("common.copied")), () => {});
  if (done) {
    return (
      <Modal open onClose={onClose} title={t("ja.cred_reset_done")} persistent footer={<Button onClick={onClose} data-testid="cred-reset-close">{t("common.close")}</Button>}>
        <Notice tone="success">{t("ja.cred_reset_done_note")}</Notice>
        <div className="space-y-2 rounded-xl border border-line bg-bg2 p-4">
          <div><p className="text-xs text-muted">{t("ja.username")}</p><p className="font-mono text-base font-semibold" dir="ltr">{data.username}</p></div>
          <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs text-muted">{t("auth.password")}</p><p className="break-all font-mono text-base font-semibold" dir="ltr" data-testid="cred-new-password">{done.password}</p></div>
            <Button type="button" size="sm" variant="secondary" onClick={() => copy(done.password)}><Copy className="size-4" aria-hidden />{t("ja.cf_copy")}</Button></div>
        </div>
        <p className="text-xs font-medium text-gold">{t("ja.cf_once")}</p>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title={t("ja.cred_reset")} busy={busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button><Button onClick={() => void submit()} loading={busy} disabled={mode === "type" && (!pw || !!issue)} data-testid="cred-reset-submit"><KeyRound className="size-4" aria-hidden />{t("ja.cred_reset")}</Button></>}>
      <p className="text-sm text-muted">{t("ja.cred_reset_hint")}</p>
      <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
        {(["generate", "type"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} data-testid={`cred-mode-${m}`}
            className={`min-h-12 rounded-xl border px-3 py-2 text-start text-sm ${mode === m ? "border-accent bg-accent/10 font-semibold text-accent" : "border-line bg-bg2 text-muted hover:border-accent/50"}`}>
            {t(m === "generate" ? "ja.cred_mode_generate" : "ja.cred_mode_type")}
          </button>))}
      </div>
      {mode === "type" && <PasswordField label={t("ja.cf_password")} value={pw} onChange={(v) => { setPw(v); setErr(null); }} autoComplete="off" hint={t("staff.password_hint")} error={err ?? (issue ? t(issue === "weak" ? "ja.err_pw_weak" : "ja.err_pw_short") : undefined)} testId="cred-password-input"
        extra={<button type="button" onClick={() => setPw(generatePassword())} aria-label={t("ja.cf_generate")} title={t("ja.cf_generate")} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:text-accent"><Wand2 className="size-4" aria-hidden /></button>} />}
      {mode === "generate" && err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </Modal>
  );
}
