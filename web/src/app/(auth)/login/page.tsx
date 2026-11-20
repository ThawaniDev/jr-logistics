"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LogIn, PackageSearch, ShieldCheck } from "lucide-react";
import { Button, Input, Notice } from "@/components/ui";
import { DemoAccounts } from "@/components/auth/demo-accounts";
import { PasswordField } from "@/components/auth/password-field";
import { loginErr } from "@/components/auth/auth-errors";
import { post } from "@/lib/api";
import { useT } from "@/i18n/provider";

const homeFor = (role: string) => (role === "admin" || role === "staff" ? "/admin" : `/${role}`);

/** One sign-in for everybody (business, driver, office, staff, admin): username + password. Staff with two-step verification get a second step on the same card. */
function LoginForm() {
  const t = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const role = sp.get("role");
  // The landing page sends people who want to join as `/login?role=driver`: they have no account yet, so go straight to the registration form.
  useEffect(() => { if (role === "business" || role === "driver" || role === "office") router.replace(`/register?role=${role}`); }, [role, router]);

  // One request at a time (double tap / Enter + click); the typed values stay in the form when a request fails.
  async function guarded(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setErr(null);
    try { await fn(); } finally { lock.current = false; setBusy(false); }
  }
  const done = (r: { user: { role: string; mustChangePassword?: boolean } }) => {
    router.replace(r.user.mustChangePassword ? "/account/change-password" : homeFor(r.user.role));
    router.refresh();
  };
  const submit = () => guarded(async () => {
    try {
      const r = await post("/auth/login", { username, password });
      if (r.mfaRequired) { setMfaToken(r.mfaToken); setCode(""); } else done(r); // password ok → second step, or signed in
    } catch (e) { setErr(loginErr(e, t)); }
  });
  const verify = () => guarded(async () => {
    try { done(await post("/auth/staff/login/mfa", { mfaToken, code })); }
    catch (e) { setErr(loginErr(e, t)); setCode(""); }
  });

  return (
    <div className="w-full max-w-md">
      <div className="glass-card-elevated rounded-3xl border border-line/80 p-6 shadow-2xl sm:p-8">
        <div className="mb-6 flex size-14 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent">
          <LogIn className="size-6" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold text-ink">{t("auth.login_title")}</h1>
        <p className="mt-1.5 text-sm text-muted">{t("auth.login_sub")}</p>
        {sp.get("expired") && <div className="mt-4"><Notice tone="warn">{t("auth.session_expired")}</Notice></div>}
        {mfaToken ? (
          <form className="mt-6 space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void verify(); }}>
            <p className="text-sm text-muted">{t("mfa.login_sub")}</p>
            <Input label={t("mfa.code_or_recovery")} ltr autoComplete="one-time-code" value={code} onChange={(e) => { setCode(e.target.value); setErr(null); }} autoFocus required data-testid="login-mfa-code" />
            {err && <p role="alert" className="text-sm text-danger">{err}</p>}
            <Button type="submit" full size="lg" className="h-14 text-base" loading={busy} disabled={code.trim().length < 6}>{t("auth.login")}</Button>
            <button type="button" className="min-h-11 w-full text-center text-xs text-muted underline" onClick={() => { setMfaToken(null); setCode(""); setErr(null); }}>{t("common.back")}</button>
          </form>
        ) : (
          <form className="mt-6 space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); if (username.trim() && password) void submit(); }}>
            <Input label={t("ja.username")} ltr autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" value={username}
              onChange={(e) => { setUsername(e.target.value); setErr(null); }} autoFocus required data-testid="login-username" />
            <PasswordField label={t("auth.password")} value={password} onChange={(v) => { setPassword(v); setErr(null); }} required testId="login-password" />
            {err && <p role="alert" className="text-sm text-danger" data-testid="login-error">{err}</p>}
            <Button type="submit" full size="lg" className="h-14 text-base" loading={busy} disabled={!username.trim() || !password}>{t("auth.login")}</Button>
            <p className="text-xs text-muted">{t("ja.login_forgot")}</p>
          </form>
        )}
        <p className="mt-6 flex items-center gap-2 text-xs text-muted">
          <ShieldCheck className="size-4 shrink-0 text-accent" aria-hidden />
          {t("auth.secure_note")}
        </p>
      </div>
      <p className="mt-5 flex flex-wrap items-center justify-center gap-x-4 text-center text-sm text-muted">
        <span>
          {t("ja.login_new")}{" "}
          <Link href="/register" className="inline-flex min-h-11 items-center font-medium text-cyan hover:underline" data-testid="login-register-link">{t("ja.login_create")}</Link>
        </span>
        <Link href="/track" className="inline-flex min-h-11 items-center gap-1.5 text-cyan hover:underline"><PackageSearch className="size-4" aria-hidden />{t("bs.land_track_link")}</Link>
      </p>
      <DemoAccounts onPick={(v) => { setUsername(v.username); setPassword(v.password); setMfaToken(null); setErr(null); }} />
    </div>
  );
}
export default function LoginPage() { return <Suspense><LoginForm /></Suspense>; }
