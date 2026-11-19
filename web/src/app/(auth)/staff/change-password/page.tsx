"use client";
import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Button, Input, Notice, errText, useAction } from "@/components/ui";
import { post } from "@/lib/api";
import { useT } from "@/i18n/provider";

/** Shown to staff/admins whose password is temporary. The API refuses everything else until this is done. */
function Form() {
  const t = useT(); const router = useRouter(); const a = useAction();
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [again, setAgain] = useState(""); const [err, setErr] = useState<string | null>(null);
  const mismatch = again.length > 0 && next !== again;
  const submit = () => a.run("pw", () => post("/auth/change-password", { currentPassword: cur, newPassword: next }), {
    success: "settings.pw_changed",
    onDone: () => { router.replace("/staff/login"); router.refresh(); }, // sessions are revoked on change → sign in again
    onError: (e) => setErr(errText(e, t)),
  });
  return (
    <div className="w-full max-w-md">
      <div className="glass-card-elevated rounded-3xl border border-line/80 p-8 shadow-2xl">
        <div className="mb-6 flex size-14 items-center justify-center rounded-2xl border border-gold/30 bg-gold/10 text-gold"><KeyRound className="size-6" aria-hidden /></div>
        <h1 className="text-2xl font-bold text-ink">{t("auth.change_pw_title")}</h1>
        <p className="mt-1.5 text-sm text-muted">{t("auth.change_pw_sub")}</p>
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); if (!mismatch) submit(); }}>
          <Input label={t("settings.current_password")} type="password" ltr autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
          <Input label={t("settings.new_password")} type="password" ltr autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} hint={t("staff.password_hint")} required />
          <Input label={t("auth.confirm_password")} type="password" ltr autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} error={mismatch ? t("auth.password_mismatch") : undefined} required />
          {err && <Notice tone="danger">{err}</Notice>}
          <Button type="submit" full size="lg" loading={a.any} disabled={next.length < 10 || !cur || next !== again}>{t("settings.change_password")}</Button>
        </form>
      </div>
    </div>
  );
}
export default function StaffChangePassword() { return <Suspense><Form /></Suspense>; }
