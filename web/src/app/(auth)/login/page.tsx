"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Phone, ShieldCheck } from "lucide-react";
import { Button, Card, Input, Notice, errText, useAction } from "@/components/ui";
import { DemoAccounts } from "@/components/auth/demo-accounts";
import { post } from "@/lib/api";
import { useT } from "@/i18n/provider";

const homeFor = (role: string) => (role === "admin" || role === "staff" ? "/admin" : `/${role}`);

function LoginForm() {
  const t = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [demo, setDemo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const a = useAction();

  const send = () => a.run("send", () => post("/auth/otp/send", { phone }), {
    onDone: (r) => { setErr(null); setDemo(r.demoCode ?? null); setStep("code"); },
    onError: (e) => setErr(errText(e, t)),
  });
  const verify = () => a.run("verify", () => post("/auth/otp/verify", { phone, code }), {
    onDone: (r) => {
      if (r.isNew) {
        sessionStorage.setItem("jr_reg", JSON.stringify({ token: r.registrationToken, phone }));
        router.push(`/register${sp.get("role") ? `?role=${sp.get("role")}` : ""}`);
      } else { router.replace(homeFor(r.user.role)); router.refresh(); }
    },
    onError: (e) => setErr(errText(e, t)),
  });

  return (
    <div className="w-full max-w-md">
      <Card className="p-7">
        <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-accent/10 text-accent"><Phone className="size-6" aria-hidden /></div>
        <h1 className="text-2xl font-bold">{t("auth.login_title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("auth.login_sub")}</p>
        {sp.get("expired") && <div className="mt-4"><Notice tone="warn">{t("auth.session_expired")}</Notice></div>}
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); step === "phone" ? send() : verify(); }}>
          <Input label={t("auth.phone")} type="tel" inputMode="tel" autoComplete="tel" ltr placeholder="05XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={step === "code"} required />
          {step === "code" && (
            <>
              {demo && <Notice tone="warn" title={t("auth.demo_code")}><span className="ltr-num text-lg font-bold tracking-widest">{demo}</span><p className="mt-1 text-xs text-muted">{t("auth.demo_code_hint")}</p></Notice>}
              <Input label={t("auth.code")} inputMode="numeric" autoComplete="one-time-code" ltr maxLength={6} placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus required />
              <button type="button" className="text-xs text-cyan hover:underline" onClick={() => { setStep("phone"); setCode(""); setDemo(null); setErr(null); }}>{t("auth.change_number")}</button>
            </>
          )}
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <Button type="submit" full size="lg" loading={a.any}>{step === "phone" ? t("auth.send_code") : t("auth.verify")}</Button>
        </form>
        <p className="mt-6 flex items-center gap-2 text-xs text-muted"><ShieldCheck className="size-4 text-accent" aria-hidden />{t("auth.secure_note")}</p>
      </Card>
      <p className="mt-4 text-center text-sm text-muted">{t("auth.staff_prompt")} <Link href="/staff/login" className="text-cyan hover:underline">{t("auth.staff_link")}</Link></p>
      <DemoAccounts onPick={(v) => { setPhone(v.phone ?? ""); setStep("phone"); }} />
    </div>
  );
}
export default function LoginPage() { return <Suspense><LoginForm /></Suspense>; }
