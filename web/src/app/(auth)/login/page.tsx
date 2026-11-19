"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PackageSearch, Phone, ShieldCheck } from "lucide-react";
import { Button, Input, Notice } from "@/components/ui";
import { DemoAccounts } from "@/components/auth/demo-accounts";
import { friendlyErr } from "@/components/features/driver-action";
import { ApiError, post } from "@/lib/api";
import { useT } from "@/i18n/provider";

const homeFor = (role: string) => (role === "admin" || role === "staff" ? "/admin" : `/${role}`);
const RESEND_AFTER = 60; // seconds before another SMS may be requested (the server allows 3 per 10 minutes)
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Specific, kind messages: say what happened and what to do next, never "something went wrong". */
function authErr(e: unknown, t: (k: string, v?: Record<string, string | number>) => string, step: "phone" | "code"): string {
  if (e instanceof ApiError) {
    if (e.code === "RATE_LIMITED") return t("ux.d_auth_rate");
    if (e.code === "DEPENDENCY_UNAVAILABLE") return t("ux.d_auth_sms_down");
    if (e.code === "FORBIDDEN") return t(/staff/i.test(e.message) ? "ux.d_auth_use_staff" : "ux.d_auth_suspended");
    if (e.code === "VALIDATION") return t(step === "phone" ? "ux.d_auth_bad_phone" : "ux.d_auth_bad_code");
  }
  return friendlyErr(e, t);
}

function LoginForm() {
  const t = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [demo, setDemo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "verify" | null>(null);
  const [wait, setWait] = useState(0);
  const lock = useRef(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const phoneOk = phone.replace(/\D/g, "").length >= 9;

  useEffect(() => {
    if (wait <= 0) return;
    const i = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(i);
  }, [wait]);

  // One request at a time (double tap / Enter + click), and the typed values always stay in the form when a request fails.
  async function guarded(kind: "send" | "verify", fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(kind); setErr(null);
    try { await fn(); } finally { lock.current = false; setBusy(null); }
  }
  const send = () => guarded("send", async () => {
    if (!phoneOk) { setErr(t("ux.d_auth_bad_phone")); return; }
    try {
      const r = await post("/auth/otp/send", { phone });
      setDemo(r.demoCode ?? null); setStep("code"); setCode(""); setWait(RESEND_AFTER);
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (e) { setErr(authErr(e, t, "phone")); if (e instanceof ApiError && e.code === "RATE_LIMITED" && step === "code") setWait(RESEND_AFTER); }
  });
  const verify = () => guarded("verify", async () => {
    try {
      const r = await post("/auth/otp/verify", { phone, code });
      if (r.isNew) {
        sessionStorage.setItem("jr_reg", JSON.stringify({ token: r.registrationToken, phone }));
        router.push(`/register${sp.get("role") ? `?role=${sp.get("role")}` : ""}`);
      } else { router.replace(homeFor(r.user.role)); router.refresh(); }
    } catch (e) {
      setErr(authErr(e, t, "code"));
      if (e instanceof ApiError && e.code === "VALIDATION") { setCode(""); codeRef.current?.focus(); }
    }
  });

  return (
    <div className="w-full max-w-md">
      <div className="glass-card-elevated rounded-3xl border border-line/80 p-6 shadow-2xl sm:p-8">
        <div className="mb-6 flex size-14 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent">
          <Phone className="size-6" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold text-ink">{t("auth.login_title")}</h1>
        <p className="mt-1.5 text-sm text-muted">{t("auth.login_sub")}</p>
        {sp.get("expired") && (
          <div className="mt-4">
            <Notice tone="warn">{t("auth.session_expired")}</Notice>
          </div>
        )}
        <form
          className="mt-6 space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (step === "phone") void send(); else void verify();
          }}
        >
          <Input
            label={t("auth.phone")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            enterKeyHint="send"
            ltr
            placeholder="05XXXXXXXX"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setErr(null); }}
            disabled={step === "code"}
            autoFocus
            required
          />
          {step === "code" && (
            <>
              <p role="status" className="text-sm text-muted">{t("ux.d_auth_sent_to", { phone })}</p>
              {demo && (
                <Notice tone="warn" title={t("auth.demo_code")}>
                  <span className="ltr-num text-lg font-bold tracking-widest">{demo}</span>
                  <p className="mt-1 text-xs text-muted">{t("auth.demo_code_hint")}</p>
                </Notice>
              )}
              <Input
                ref={codeRef}
                label={t("auth.code")}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                enterKeyHint="done"
                ltr
                maxLength={6}
                placeholder="••••••"
                value={code}
                onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setErr(null); }}
                className="h-14 text-center text-2xl font-bold tracking-[0.4em]"
                autoFocus
                required
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" className="min-h-11 text-sm text-cyan hover:underline" onClick={() => { setStep("phone"); setCode(""); setDemo(null); setErr(null); setWait(0); }}>
                  {t("auth.change_number")}
                </button>
                <button type="button" disabled={wait > 0 || busy !== null} onClick={() => void send()} className="min-h-11 text-sm font-medium text-cyan hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline">
                  {wait > 0 ? <span>{t("ux.d_auth_resend_in", { time: mmss(wait) })}</span> : t("ux.d_auth_resend")}
                </button>
              </div>
            </>
          )}
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <Button type="submit" full size="lg" className="h-14 text-base" loading={busy !== null} disabled={step === "code" && code.length < 4}>
            {step === "phone" ? t("auth.send_code") : t("auth.verify")}
          </Button>
        </form>
        <p className="mt-6 flex items-center gap-2 text-xs text-muted">
          <ShieldCheck className="size-4 shrink-0 text-accent" aria-hidden />
          {t("auth.secure_note")}
        </p>
      </div>
      <p className="mt-5 flex flex-wrap items-center justify-center gap-x-4 text-center text-sm text-muted">
        <span>
          {t("auth.staff_prompt")}{" "}
          <Link href="/staff/login" className="inline-flex min-h-11 items-center text-cyan hover:underline">{t("auth.staff_link")}</Link>
        </span>
        <Link href="/track" className="inline-flex min-h-11 items-center gap-1.5 text-cyan hover:underline"><PackageSearch className="size-4" aria-hidden />{t("bs.land_track_link")}</Link>
      </p>
      <DemoAccounts onPick={(v) => { setPhone(v.phone ?? ""); setStep("phone"); setCode(""); setErr(null); setWait(0); }} />
    </div>
  );
}
export default function LoginPage() { return <Suspense><LoginForm /></Suspense>; }
