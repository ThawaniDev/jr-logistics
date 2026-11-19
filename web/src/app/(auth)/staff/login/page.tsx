"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { Button, Input, Notice, errText, useAction } from "@/components/ui";
import { DemoAccounts } from "@/components/auth/demo-accounts";
import { post } from "@/lib/api";
import { useT } from "@/i18n/provider";

function StaffLoginForm() {
  const t = useT(); const router = useRouter(); const sp = useSearchParams(); const a = useAction();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [err, setErr] = useState<string | null>(null);
  const [mfaToken, setMfaToken] = useState<string | null>(null); const [code, setCode] = useState("");
  const done = (r: { user: { mustChangePassword?: boolean } }) => { router.replace(r.user.mustChangePassword ? "/staff/change-password" : "/admin"); router.refresh(); };
  const submit = () => a.run("login", () => post("/auth/staff/login", { email, password }), {
    onDone: (r) => { if (r.mfaRequired) { setMfaToken(r.mfaToken); setErr(null); } else done(r); }, // password ok, second step next
    onError: (e) => setErr(errText(e, t)),
  });
  const verify = () => a.run("mfa", () => post("/auth/staff/login/mfa", { mfaToken, code }), { onDone: done, onError: (e) => { setErr(errText(e, t)); setCode(""); } });
  return (
    <div className="w-full max-w-md">
      <div className="glass-card-elevated rounded-3xl border border-line/80 p-8 shadow-2xl">
        <div className="mb-6 flex size-14 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
          <LockKeyhole className="size-6" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold text-ink">{t("auth.staff_title")}</h1>
        <p className="mt-1.5 text-sm text-muted">{t("auth.staff_sub")}</p>
        {sp.get("expired") && <div className="mt-4"><Notice tone="warn">{t("auth.session_expired")}</Notice></div>}
        {mfaToken ? (
          <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); verify(); }}>
            <p className="text-sm text-muted">{t("mfa.login_sub")}</p>
            <Input label={t("mfa.code_or_recovery")} ltr autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
            {err && <p role="alert" className="text-sm text-danger">{err}</p>}
            <Button type="submit" full size="lg" loading={a.any} disabled={code.trim().length < 6}>{t("auth.login")}</Button>
            <button type="button" className="w-full text-center text-xs text-muted underline" onClick={() => { setMfaToken(null); setCode(""); setErr(null); }}>{t("common.back")}</button>
          </form>
        ) : (
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Input label={t("auth.email")} type="email" autoComplete="username" ltr value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input label={t("auth.password")} type="password" autoComplete="current-password" ltr value={password} onChange={(e) => setPassword(e.target.value)} required />
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <Button type="submit" full size="lg" loading={a.any}>{t("auth.login")}</Button>
        </form>
        )}
      </div>
      <DemoAccounts staff onPick={(v) => { setEmail(v.email ?? ""); setPassword(v.password ?? ""); }} />
    </div>
  );
}

export default function StaffLogin() { return <Suspense><StaffLoginForm /></Suspense>; }
