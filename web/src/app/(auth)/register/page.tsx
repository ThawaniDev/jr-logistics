"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Truck, Store } from "lucide-react";
import { Button, Checkbox, Input, Select, fieldErrors } from "@/components/ui";
import { useDriverAction } from "@/components/features/driver-action";
import { PasswordField } from "@/components/auth/password-field";
import { UsernameField, useUsernameCheck } from "@/components/auth/username-field";
import { fieldProblems } from "@/components/auth/auth-errors";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { cn } from "@/lib/cn";
import { passwordIssue } from "@/lib/gen-password";
import { useI18n } from "@/i18n/provider";

type Role = "business" | "driver" | "office";
const ROLES: Array<{ key: Role; icon: typeof Store }> = [{ key: "business", icon: Store }, { key: "driver", icon: Truck }, { key: "office", icon: Building2 }];

function RegisterForm() {
  const { t, locale } = useI18n();
  const router = useRouter(); const sp = useSearchParams(); const a = useDriverAction(); const formRef = useRef<HTMLDivElement>(null);
  const { data: cat } = useApi("/catalog");
  const [role, setRole] = useState<Role | null>(ROLES.some((r) => r.key === sp.get("role")) ? (sp.get("role") as Role) : null); // ?role= is untrusted input
  const [f, setF] = useState<Record<string, any>>({ services: ["delivery_driver"], language: locale });
  const [confirm, setConfirm] = useState("");
  const [terms, setTerms] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const uname = useUsernameCheck(f.username ?? "");
  useEffect(() => { if (role) formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [role]); // on a phone the form is below the role cards
  const set = (k: string, v: unknown) => { setF((p) => ({ ...p, [k]: v })); setErrs((p) => { if (!(k in p)) return p; const n = { ...p }; delete n[k]; return n; }); };
  const needTemp = ["van", "dyna"].includes(f.vehicleType);
  const cities = (cat?.cities ?? []).map((c: any) => ({ value: c.key, label: c[locale] }));
  const termsText = role ? cat?.terms?.[role] : "";

  const pwIssue = passwordIssue(f.password ?? "");
  const mismatch = confirm.length > 0 && confirm !== (f.password ?? "");
  const phoneOk = String(f.phone ?? "").replace(/\D/g, "").length >= 9;
  const blocked = !terms || uname === "invalid" || uname === "reserved" || uname === "taken" || !(f.username ?? "").trim();
  /** Checks the sign-in fields before anything is sent (the server checks again). */
  const local = () => {
    const m: Record<string, string> = {};
    if (!(f.username ?? "").trim()) m.username = t("val.required");
    if (!f.password) m.password = t("val.required"); else if (pwIssue) m.password = t(pwIssue === "weak" ? "ja.err_pw_weak" : "ja.err_pw_short");
    if (f.password && confirm !== f.password) m.confirm = t("auth.password_mismatch");
    if (!phoneOk) m.phone = t(f.phone ? "ja.err_phone_invalid" : "val.required");
    return m;
  };
  const submit = () => {
    const m = local();
    if (Object.keys(m).length) { setErrs(m); requestAnimationFrame(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus()); return; }
    void a.run("reg", () => post("/auth/register", { role, termsAccepted: terms, ...f, vehicleTemperature: needTemp ? f.vehicleTemperature : undefined }), {
      onDone: (r) => { router.replace(`/${r.user.role}`); router.refresh(); },
      onError: (e) => {
        // Server messages are English; show a localized hint on the field itself and move focus to the first one.
        const raw = fieldErrors(e); delete raw.field;
        const mapped = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, k === "form" ? v : /required|choose at least/i.test(v) ? t("val.required") : t("ux.d_reg_check_field")]));
        setErrs({ ...mapped, ...fieldProblems(e, t) });
        requestAnimationFrame(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus());
      },
    });
  };
  const E = (k: string) => errs[k];

  return (
    <div className="w-full max-w-2xl">
      <h1 className="mb-1 text-3xl font-extrabold">{t("reg.title")}</h1>
      <p className="mb-6 text-sm text-muted">{t("reg.sub")}</p>
      <div className="mb-6 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t("reg.pick_role")}>
        {ROLES.map(({ key, icon: I }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={role === key}
            onClick={() => setRole(key)}
            className={cn(
              "min-h-20 rounded-2xl border p-4 text-start transition-all",
              role === key
                ? "border-accent bg-accent/15 text-accent shadow-[0_0_20px_color-mix(in_srgb,var(--jr-accent)_15%,transparent)] font-bold"
                : "border-line bg-card/75 text-muted hover:border-line/80 hover:text-ink"
            )}
          >
            <I className={cn("mb-3 size-7", role === key ? "text-accent" : "text-muted")} aria-hidden />
            <p className="font-semibold text-ink">{t(`reg.role_${key}`)}</p>
            <p className="mt-1 text-xs text-muted">{t(`reg.role_${key}_sub`)}</p>
          </button>
        ))}
      </div>
      {role && (
        <div ref={formRef} className="glass-card-elevated scroll-mt-20 rounded-3xl border border-line/80 p-6 sm:p-8 shadow-2xl space-y-5">
          <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); setErrs({}); submit(); }}>
            <fieldset className="space-y-4 rounded-xl border border-line bg-bg2/60 p-4">
              <legend className="px-1 text-sm font-semibold text-ink">{t("ja.reg_signin")}</legend>
              <UsernameField label={t("ja.username")} value={f.username ?? ""} onChange={(v) => set("username", v)} state={uname} error={E("username")} hint={t("ja.reg_username_hint")} required />
              <div className="grid gap-4 sm:grid-cols-2">
                <PasswordField label={t("auth.password")} value={f.password ?? ""} onChange={(v) => set("password", v)} autoComplete="new-password" error={E("password")} hint={t("staff.password_hint")} required testId="reg-password" />
                <PasswordField label={t("auth.confirm_password")} value={confirm} onChange={(v) => { setConfirm(v); setErrs((p) => { const n = { ...p }; delete n.confirm; return n; }); }} autoComplete="new-password" error={E("confirm") ?? (mismatch ? t("auth.password_mismatch") : undefined)} required testId="reg-confirm" />
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label={role === "driver" ? t("reg.full_name") : t("reg.owner_name")} autoComplete="name" value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} error={E("name")} required data-testid="reg-name" />
              <Input label={t("auth.phone")} type="tel" inputMode="tel" autoComplete="tel" ltr placeholder="05XXXXXXXX" hint={t("ja.reg_phone_hint")} value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} error={E("phone")} required data-testid="reg-phone" />
              <Input label={t("reg.email_opt")} type="email" inputMode="email" autoComplete="email" ltr value={f.email ?? ""} onChange={(e) => set("email", e.target.value || null)} error={E("email")} />
              {role !== "driver" && <Input label={role === "office" ? t("reg.office_name") : t("reg.company")} value={f.companyName ?? ""} onChange={(e) => set("companyName", e.target.value)} error={E("companyName")} required />}
              {role !== "driver" && <Input label={t("reg.cr")} ltr inputMode="numeric" autoComplete="off" value={f.crNumber ?? ""} onChange={(e) => set("crNumber", e.target.value)} error={E("crNumber")} />}
              <Select label={t("reg.city")} placeholder={t("common.select")} options={cities} value={f.city ?? ""} onChange={(e) => set("city", e.target.value)} error={E("city")} required />
              {role === "business" && <Input label={t("reg.industry")} value={f.industry ?? ""} onChange={(e) => set("industry", e.target.value)} />}
              {role === "office" && <><Input label={t("reg.address")} value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} /><Input label={t("reg.tax")} ltr inputMode="numeric" autoComplete="off" value={f.taxNumber ?? ""} onChange={(e) => set("taxNumber", e.target.value)} error={E("taxNumber")} /></>}
            </div>
            {role === "driver" && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label={t("reg.national_id")} ltr inputMode="numeric" autoComplete="off" value={f.nationalId ?? ""} onChange={(e) => set("nationalId", e.target.value)} error={E("nationalId")} />
                  <Input label={t("reg.plate")} ltr autoComplete="off" autoCapitalize="characters" value={f.vehiclePlate ?? ""} onChange={(e) => set("vehiclePlate", e.target.value)} error={E("vehiclePlate")} />
                  <Select label={t("reg.vehicle")} placeholder={t("common.select")} options={(cat?.vehicleTypes ?? []).map((v: string) => ({ value: v, label: t(`vehicle.${v}`) }))} value={f.vehicleType ?? ""} onChange={(e) => set("vehicleType", e.target.value)} error={E("vehicleType")} required />
                  {needTemp && <Select label={t("reg.temperature")} placeholder={t("common.select")} options={[{ value: "dry", label: t("temp.dry") }, { value: "cold", label: t("temp.cold") }]} value={f.vehicleTemperature ?? ""} onChange={(e) => set("vehicleTemperature", e.target.value)} error={E("vehicleTemperature")} required />}
                </div>
                <fieldset><legend className="mb-2 text-xs font-medium text-muted">{t("reg.services")}</legend>
                  <div className="flex flex-wrap gap-2">
                    {(cat?.services ?? []).filter((s: any) => !s.driverless).map((s: any) => {
                      const on = f.services?.includes(s.key);
                      return <button key={s.key} type="button" aria-pressed={on} onClick={() => set("services", on ? f.services.filter((x: string) => x !== s.key) : [...(f.services ?? []), s.key])} className={cn("min-h-11 rounded-full border px-4 py-1.5 text-sm", on ? "border-accent bg-accent/10 text-accent" : "border-line text-muted")}>{t(`svc.${s.key}`)}</button>;
                    })}
                  </div>
                  {E("services") && <p role="alert" className="mt-1 text-xs text-danger">{E("services")}</p>}
                </fieldset>
              </div>
            )}
            <div className="rounded-xl border border-line bg-bg2 p-4">
              <p className="mb-2 text-sm font-semibold">{t("reg.terms_title")} <span className="text-xs font-normal text-muted">v{cat?.terms?.version}</span> <a href="/terms" target="_blank" rel="noreferrer" className="text-xs font-normal text-accent underline">{t("landing.terms")}</a></p>
              <div className="mb-3 max-h-28 overflow-y-auto text-xs leading-relaxed text-muted">{termsText || t(`reg.terms_default_${role}`)}</div>
              <Checkbox checked={terms} onChange={(e) => setTerms(e.target.checked)} label={t("reg.terms_accept")} />
            </div>
            {errs.form && <p role="alert" className="text-sm text-danger">{errs.form}</p>}
            <Button type="submit" size="lg" full className="h-14 text-base" disabled={blocked} loading={a.any} data-testid="reg-submit">{t("reg.submit")}</Button>
            <p className="text-center text-sm text-muted">{t("ja.reg_have_account")} <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-cyan hover:underline">{t("auth.login")}</Link></p>
          </form>
        </div>
      )}
    </div>
  );
}
export default function RegisterPage() { return <Suspense><RegisterForm /></Suspense>; }
