"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Notice, errText, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { useT } from "@/i18n/provider";

/** Two-step verification: add the key to an authenticator app, prove it with a code, save the recovery codes. */
export default function StaffMfa() {
  const t = useT(); const router = useRouter(); const a = useAction();
  const { data: me } = useApi<{ user: { mfaEnabled: boolean } }>("/auth/me");
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState(""); const [err, setErr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [off, setOff] = useState({ password: "", code: "" });

  const start = () => a.run("start", () => post("/auth/mfa/setup"), { onDone: (r) => { setSetup(r); setErr(null); }, onError: (e) => setErr(errText(e, t)) });
  const confirm = () => a.run("confirm", () => post("/auth/mfa/enable", { code }), { onDone: (r) => { setCodes(r.recoveryCodes); setSetup(null); }, onError: (e) => setErr(errText(e, t)) });
  const disable = () => a.run("off", () => post("/auth/mfa/disable", off), { success: "common.saved", onDone: () => { setOff({ password: "", code: "" }); router.refresh(); location.reload(); }, onError: (e) => setErr(errText(e, t)) });
  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast.success(t("common.copied")));

  return (
    <div className="w-full max-w-lg">
      <div className="glass-card-elevated space-y-5 rounded-3xl border border-line/80 p-8 shadow-2xl">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-accent"><ShieldCheck className="size-6" aria-hidden /></div>
        <div>
          <h1 className="text-2xl font-bold">{t("mfa.title")}</h1>
          <p className="mt-1.5 text-sm text-muted">{t("mfa.sub")}</p>
        </div>

        {codes ? (
          <div className="space-y-3">
            <Notice tone="warn" title={t("mfa.recovery_title")}>{t("mfa.recovery_body")}</Notice>
            <ul className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-bg2 p-4 font-mono text-sm ltr-num" dir="ltr">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => copy(codes.join("\n"))}><Copy className="size-4" />{t("mfa.copy_codes")}</Button>
              <Button onClick={() => { router.replace("/admin"); router.refresh(); }}>{t("mfa.saved_continue")}</Button>
            </div>
          </div>
        ) : me?.user.mfaEnabled ? (
          <div className="space-y-3">
            <Notice tone="success">{t("mfa.is_on")}</Notice>
            <p className="text-sm text-muted">{t("mfa.disable_hint")}</p>
            <Input label={t("settings.current_password")} type="password" ltr autoComplete="current-password" value={off.password} onChange={(e) => setOff({ ...off, password: e.target.value })} />
            <Input label={t("mfa.code")} ltr inputMode="numeric" autoComplete="one-time-code" value={off.code} onChange={(e) => setOff({ ...off, code: e.target.value })} />
            {err && <Notice tone="danger">{err}</Notice>}
            <Button variant="danger" loading={a.is("off")} disabled={!off.password || off.code.length < 6} onClick={disable}>{t("mfa.disable")}</Button>
          </div>
        ) : setup ? (
          <div className="space-y-4">
            <ol className="list-decimal space-y-1 ps-5 text-sm text-muted"><li>{t("mfa.step1")}</li><li>{t("mfa.step2")}</li><li>{t("mfa.step3")}</li></ol>
            <div className="rounded-xl border border-line bg-bg2 p-4">
              <p className="mb-1 text-xs text-muted">{t("mfa.key")}</p>
              <div className="flex items-center justify-between gap-2" dir="ltr"><code className="break-all text-sm font-semibold tracking-wider">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
                <button type="button" className="shrink-0 rounded-lg p-2 text-muted hover:text-ink" aria-label={t("common.copied")} onClick={() => copy(setup.secret)}><Copy className="size-4" /></button></div>
              <a href={setup.otpauth} className="mt-2 inline-block text-xs text-accent underline">{t("mfa.open_app")}</a>
            </div>
            <Input label={t("mfa.code")} ltr inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            {err && <Notice tone="danger">{err}</Notice>}
            <Button full size="lg" loading={a.is("confirm")} disabled={code.replace(/\s/g, "").length < 6} onClick={confirm}>{t("mfa.turn_on")}</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Notice tone="info">{t("mfa.why")}</Notice>
            {err && <Notice tone="danger">{err}</Notice>}
            <Button full size="lg" loading={a.is("start")} onClick={start}>{t("mfa.start")}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
