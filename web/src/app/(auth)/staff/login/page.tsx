"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { Button, Card, Input, errText, useAction } from "@/components/ui";
import { DemoAccounts } from "@/components/auth/demo-accounts";
import { post } from "@/lib/api";
import { useT } from "@/i18n/provider";

export default function StaffLogin() {
  const t = useT(); const router = useRouter(); const a = useAction();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [err, setErr] = useState<string | null>(null);
  const submit = () => a.run("login", () => post("/auth/staff/login", { email, password }), {
    onDone: (r) => { router.replace(r.user.mustChangePassword ? "/admin/settings?change_password=1" : "/admin"); router.refresh(); },
    onError: (e) => setErr(errText(e, t)),
  });
  return (
    <div className="w-full max-w-md">
      <Card className="p-7">
        <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-gold/10 text-gold"><LockKeyhole className="size-6" aria-hidden /></div>
        <h1 className="text-2xl font-bold">{t("auth.staff_title")}</h1><p className="mt-1 text-sm text-muted">{t("auth.staff_sub")}</p>
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Input label={t("auth.email")} type="email" autoComplete="username" ltr value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input label={t("auth.password")} type="password" autoComplete="current-password" ltr value={password} onChange={(e) => setPassword(e.target.value)} required />
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <Button type="submit" full size="lg" loading={a.any}>{t("auth.login")}</Button>
        </form>
      </Card>
      <DemoAccounts staff onPick={(v) => { setEmail(v.email ?? ""); setPassword(v.password ?? ""); }} />
    </div>
  );
}
