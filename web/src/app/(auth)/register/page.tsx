"use client";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Truck, Store } from "lucide-react";
import { Button, Card, Checkbox, Input, Select, errText, fieldErrors, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";

type Role = "business" | "driver" | "office";
const ROLES: Array<{ key: Role; icon: typeof Store }> = [{ key: "business", icon: Store }, { key: "driver", icon: Truck }, { key: "office", icon: Building2 }];

function RegisterForm() {
  const { t, locale } = useI18n();
  const router = useRouter(); const sp = useSearchParams(); const a = useAction();
  const { data: cat } = useApi("/catalog");
  // sessionStorage is client-only: read it through useSyncExternalStore (server snapshot = null) instead of an effect.
  const raw = useSyncExternalStore(() => () => {}, () => sessionStorage.getItem("jr_reg"), () => null);
  const reg = raw ? (JSON.parse(raw) as { token: string; phone: string }) : null;
  const [role, setRole] = useState<Role | null>((sp.get("role") as Role) || null);
  const [f, setF] = useState<Record<string, any>>({ services: ["delivery_driver"], language: locale });
  const [terms, setTerms] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { if (!sessionStorage.getItem("jr_reg")) router.replace("/login"); }, [router]);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  if (!reg) return null;
  const needTemp = ["van", "dyna"].includes(f.vehicleType);
  const cities = (cat?.cities ?? []).map((c: any) => ({ value: c.key, label: c[locale] }));
  const termsText = role ? cat?.terms?.[role] : "";

  const submit = () => a.run("reg", () => post("/auth/register", { registrationToken: reg.token, role, termsAccepted: terms, ...f, vehicleTemperature: needTemp ? f.vehicleTemperature : undefined }), {
    onDone: (r) => { sessionStorage.removeItem("jr_reg"); router.replace(`/${r.user.role}`); router.refresh(); },
    onError: (e) => setErrs(fieldErrors(e)),
  });
  const E = (k: string) => errs[k];

  return (
    <div className="w-full max-w-2xl">
      <h1 className="mb-1 text-3xl font-extrabold">{t("reg.title")}</h1>
      <p className="mb-6 text-sm text-muted">{t("reg.sub")} <span className="ltr-num font-medium text-ink">{reg.phone}</span></p>
      <div className="mb-6 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t("reg.pick_role")}>
        {ROLES.map(({ key, icon: I }) => (
          <button key={key} type="button" role="radio" aria-checked={role === key} onClick={() => setRole(key)} className={cn("rounded-card border p-4 text-start transition", role === key ? "border-accent bg-accent/10" : "border-line bg-card hover:border-accent/50")}>
            <I className={cn("mb-3 size-7", role === key ? "text-accent" : "text-muted")} aria-hidden /><p className="font-semibold">{t(`reg.role_${key}`)}</p><p className="mt-1 text-xs text-muted">{t(`reg.role_${key}_sub`)}</p>
          </button>
        ))}
      </div>
      {role && (
        <Card className="space-y-4 p-6">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setErrs({}); submit(); }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label={role === "driver" ? t("reg.full_name") : t("reg.owner_name")} value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} error={E("name")} required />
              <Input label={t("reg.email_opt")} type="email" ltr value={f.email ?? ""} onChange={(e) => set("email", e.target.value || null)} error={E("email")} />
              {role !== "driver" && <Input label={role === "office" ? t("reg.office_name") : t("reg.company")} value={f.companyName ?? ""} onChange={(e) => set("companyName", e.target.value)} error={E("companyName")} required />}
              {role !== "driver" && <Input label={t("reg.cr")} ltr value={f.crNumber ?? ""} onChange={(e) => set("crNumber", e.target.value)} />}
              <Select label={t("reg.city")} placeholder={t("common.select")} options={cities} value={f.city ?? ""} onChange={(e) => set("city", e.target.value)} required />
              {role === "business" && <Input label={t("reg.industry")} value={f.industry ?? ""} onChange={(e) => set("industry", e.target.value)} />}
              {role === "office" && <><Input label={t("reg.address")} value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} /><Input label={t("reg.tax")} ltr value={f.taxNumber ?? ""} onChange={(e) => set("taxNumber", e.target.value)} /></>}
            </div>
            {role === "driver" && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label={t("reg.national_id")} ltr value={f.nationalId ?? ""} onChange={(e) => set("nationalId", e.target.value)} />
                  <Input label={t("reg.plate")} ltr value={f.vehiclePlate ?? ""} onChange={(e) => set("vehiclePlate", e.target.value)} />
                  <Select label={t("reg.vehicle")} placeholder={t("common.select")} options={(cat?.vehicleTypes ?? []).map((v: string) => ({ value: v, label: t(`vehicle.${v}`) }))} value={f.vehicleType ?? ""} onChange={(e) => set("vehicleType", e.target.value)} error={E("vehicleType")} required />
                  {needTemp && <Select label={t("reg.temperature")} placeholder={t("common.select")} options={[{ value: "dry", label: t("temp.dry") }, { value: "cold", label: t("temp.cold") }]} value={f.vehicleTemperature ?? ""} onChange={(e) => set("vehicleTemperature", e.target.value)} error={E("vehicleTemperature")} required />}
                </div>
                <fieldset><legend className="mb-2 text-xs font-medium text-muted">{t("reg.services")}</legend>
                  <div className="flex flex-wrap gap-2">
                    {(cat?.services ?? []).filter((s: any) => !s.driverless).map((s: any) => {
                      const on = f.services?.includes(s.key);
                      return <button key={s.key} type="button" aria-pressed={on} onClick={() => set("services", on ? f.services.filter((x: string) => x !== s.key) : [...(f.services ?? []), s.key])} className={cn("rounded-full border px-4 py-1.5 text-sm", on ? "border-accent bg-accent/10 text-accent" : "border-line text-muted")}>{t(`svc.${s.key}`)}</button>;
                    })}
                  </div>
                  {E("services") && <p role="alert" className="mt-1 text-xs text-danger">{E("services")}</p>}
                </fieldset>
              </div>
            )}
            <div className="rounded-xl border border-line bg-bg2 p-4">
              <p className="mb-2 text-sm font-semibold">{t("reg.terms_title")} <span className="text-xs font-normal text-muted">v{cat?.terms?.version}</span></p>
              <div className="mb-3 max-h-28 overflow-y-auto text-xs leading-relaxed text-muted">{termsText || t(`reg.terms_default_${role}`)}</div>
              <Checkbox checked={terms} onChange={(e) => setTerms(e.target.checked)} label={t("reg.terms_accept")} />
            </div>
            {errs.form && <p role="alert" className="text-sm text-danger">{errs.form}</p>}
            <Button type="submit" size="lg" full disabled={!terms} loading={a.any}>{t("reg.submit")}</Button>
          </form>
        </Card>
      )}
    </div>
  );
}
export default function RegisterPage() { return <Suspense><RegisterForm /></Suspense>; }
