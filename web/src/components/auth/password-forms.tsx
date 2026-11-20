"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button, Notice, Section } from "@/components/ui";
import { PasswordField } from "@/components/auth/password-field";
import { fieldProblems } from "@/components/auth/auth-errors";
import { ApiError, post } from "@/lib/api";
import { passwordIssue } from "@/lib/gen-password";
import { useT } from "@/i18n/provider";

/** The three boxes + the request of "change my password" (shared by the full-page screen and the profile card). `onDone` runs after the server accepted the change. */
function usePasswordChange(onDone: () => void) {
  const t = useT();
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [again, setAgain] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const issue = passwordIssue(next); const mismatch = again.length > 0 && next !== again;
  const ready = !!cur && !issue && next === again && cur !== next;
  async function submit() {
    if (busy || !ready) return;
    setBusy(true); setErrs({});
    try {
      await post("/auth/change-password", { currentPassword: cur, newPassword: next });
      setCur(""); setNext(""); setAgain("");
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === "UNAUTHENTICATED") setErrs({ current: t("ja.cp_wrong") });
      else if (e instanceof ApiError && e.code === "RATE_LIMITED") setErrs({ form: t("ux.d_auth_rate") });
      else { const m = fieldProblems(e, t); setErrs({ ...(m.newPassword ? { next: m.newPassword } : {}), ...(Object.keys(m).length ? {} : { form: t("err.INTERNAL") }) }); }
    } finally { setBusy(false); }
  }
  const fields = (
    <>
      <PasswordField label={t("settings.current_password")} value={cur} onChange={(v) => { setCur(v); setErrs((p) => ({ ...p, current: "" })); }} error={errs.current || undefined} required testId="cp-current" />
      <PasswordField label={t("settings.new_password")} value={next} onChange={(v) => { setNext(v); setErrs((p) => ({ ...p, next: "" })); }} autoComplete="new-password" hint={t("staff.password_hint")} error={errs.next || (next && cur && next === cur ? t("ja.cp_same") : undefined)} required testId="cp-new" />
      <PasswordField label={t("auth.confirm_password")} value={again} onChange={setAgain} autoComplete="new-password" error={mismatch ? t("auth.password_mismatch") : undefined} required testId="cp-confirm" />
      {errs.form && <p role="alert" className="text-sm text-danger">{errs.form}</p>}
    </>
  );
  return { fields, submit, busy, ready };
}

/** `/account/change-password`: the screen a person lands on when staff set a temporary password (mustChange), or opens on purpose. Signed in; keeps the session. */
export function ChangePasswordScreen({ mustChange, home }: { mustChange: boolean; home: string }) {
  const t = useT(); const router = useRouter();
  const pw = usePasswordChange(() => { toast.success(t("ja.cp_done")); router.replace(home); router.refresh(); });
  async function signOut() { await post("/auth/logout").catch(() => {}); router.replace("/login"); router.refresh(); }
  return (
    <div className="w-full max-w-md">
      <div className="glass-card-elevated rounded-3xl border border-line/80 p-6 shadow-2xl sm:p-8">
        <div className="mb-6 flex size-14 items-center justify-center rounded-2xl border border-gold/30 bg-gold/10 text-gold"><KeyRound className="size-6" aria-hidden /></div>
        <h1 className="text-2xl font-bold text-ink">{t(mustChange ? "ja.cp_temp_title" : "ja.cp_title")}</h1>
        <p className="mt-1.5 text-sm text-muted">{t(mustChange ? "ja.cp_temp_sub" : "ja.cp_sub")}</p>
        <form className="mt-6 space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void pw.submit(); }} data-testid="cp-form">
          {pw.fields}
          <Button type="submit" full size="lg" loading={pw.busy} disabled={!pw.ready} data-testid="cp-submit">{t("settings.change_password")}</Button>
        </form>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
          {!mustChange && <button type="button" onClick={() => router.back()} className="min-h-11 text-cyan hover:underline">{t("common.back")}</button>}
          <button type="button" onClick={() => void signOut()} className="ms-auto inline-flex min-h-11 items-center gap-1.5 text-muted hover:text-ink" data-testid="cp-signout"><LogOut className="size-4 rtl:-scale-x-100" aria-hidden />{t("auth.logout")}</button>
        </div>
      </div>
    </div>
  );
}

/** The "Password" card of a profile page (business, driver, office): change your own password; your other devices are signed out. */
export function PasswordCard() {
  const t = useT();
  const pw = usePasswordChange(() => toast.success(t("ja.cp_done")));
  return (
    <Section title={t("ja.cp_card_title")} description={t("ja.cp_card_sub")}>
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void pw.submit(); }} data-testid="password-card">
        {pw.fields}
        <Notice tone="info">{t("ja.cp_others_out")}</Notice>
        <Button type="submit" loading={pw.busy} disabled={!pw.ready} data-testid="cp-submit"><KeyRound className="size-4" aria-hidden />{t("settings.change_password")}</Button>
      </form>
    </Section>
  );
}
