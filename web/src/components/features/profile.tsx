"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button, ErrorState, Input, Notice, PageHeader, PageLoading, Section, Select, StatusBadge, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError, patch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";

/** Optional: a page `title` / `subtitle`, KPIs or notices (`top`) above the form, and extra cards (`children`) beside it. */
export interface ProfilePageProps { title?: string; subtitle?: string; top?: ReactNode; children?: ReactNode }
export function ProfilePage({ title, subtitle, top, children }: ProfilePageProps = {}) {
  const { error, data, mutate } = useApi("/profile");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  // keyed so the form re-initialises from the server copy after every save
  return <ProfileForm key={JSON.stringify(data.profile) + data.user.name} data={data} reload={() => mutate()} title={title} subtitle={subtitle} top={top}>{children}</ProfileForm>;
}

const IBAN_RE = /^SA\d{22}$/;
const canonIban = (v: string) => v.replace(/\s/g, "").toUpperCase();
const TEMP_VEHICLES = ["van", "dyna"];
/** Server validation errors are keyed by field (details.<field>); show them inline next to the input. */
function serverFieldError(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !["VALIDATION", "CONFLICT"].includes(e.code)) return {};
  const d = e.details as Record<string, unknown>;
  return typeof d.field === "string" ? { [d.field]: String(d[d.field] ?? e.message) } : {};
}

function ProfileForm({ data, reload, title, subtitle, top, children }: { data: any; reload: () => void } & ProfilePageProps) {
  const { t, locale } = useI18n(); const me = useUser(); const a = useAction();
  const { data: cat } = useApi("/catalog");
  const initial = () => ({ name: data.user.name, city: data.user.city ?? "", ...flat(data.profile), ...(me.role === "driver" ? driverFlat(data.profile, data.user.email) : {}) });
  const [f, setF] = useState<Record<string, any>>(initial);
  const [saved0] = useState(() => JSON.stringify(initial()));
  const dirty = JSON.stringify(f) !== saved0;
  // Leaving with edits that were not saved asks the browser to confirm (reload / close tab).
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: string, v: unknown) => { setF((p) => ({ ...p, [k]: v })); setErrs((e) => (e[k] ? { ...e, [k]: "" } : e)); };
  const p = data.profile;
  const isDriver = me.role === "driver";
  const needTemp = isDriver && TEMP_VEHICLES.includes(f.vehicleType);
  const ibanRaw = canonIban(String(f.iban ?? ""));
  const FIELD_MSG: Record<string, string> = { iban: "profile.iban_invalid", email: "profile.invalid_email", vehicleTemperature: "profile.temp_required", services: "profile.services_required" };
  const msgFor = (field: string, raw: string) => (FIELD_MSG[field] ? t(FIELD_MSG[field]) : raw);
  function validate() {
    const e: Record<string, string> = {};
    if (String(f.name ?? "").trim().length < 2) e.name = t("ubz.name_required");
    if (me.role === "business" && String(f.companyName ?? "").trim().length < 2) e.companyName = t("ubz.company_required");
    if (ibanRaw && !IBAN_RE.test(ibanRaw)) e.iban = t("profile.iban_invalid");
    if (isDriver) {
      if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(f.email).trim())) e.email = t("profile.invalid_email");
      if (needTemp && !["dry", "cold"].includes(f.vehicleTemperature)) e.vehicleTemperature = t("profile.temp_required");
      if (!f.services?.length) e.services = t("profile.services_required");
    }
    setErrs(e);
    return Object.keys(e).length === 0;
  }
  const save = () => {
    if (!validate()) return;
    const body: Record<string, any> = { ...f, ...(f.iban !== undefined ? { iban: ibanRaw } : {}) };
    if (isDriver && !needTemp) delete body.vehicleTemperature;
    return a.run("save", () => patch("/profile", body), { success: "common.saved", onDone: () => reload(), onError: (e) => { const fe = serverFieldError(e); setErrs(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, msgFor(k, v)]))); } });
  };
  const sections: Array<{ key: string; title: string; hint?: string; body: React.ReactNode }> = [
    { key: "personal", title: t("rdz.pf_personal"), body: <>
      <Input label={t("reg.full_name")} value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} error={errs.name} required />
      <Input label={t("auth.phone")} value={data.user.phone ?? ""} ltr disabled hint={t("ubz.phone_locked")} />
      <Select label={t("reg.city")} options={(cat?.cities ?? []).map((c: any) => ({ value: c.key, label: c[locale] }))} placeholder={t("common.select")} value={f.city ?? ""} onChange={(e) => set("city", e.target.value)} />
      {isDriver && <Input label={t("profile.email")} type="email" ltr value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} error={errs.email} />}
      {isDriver && <Input label={t("reg.national_id")} ltr inputMode="numeric" value={f.nationalId ?? ""} onChange={(e) => set("nationalId", e.target.value)} error={errs.nationalId} />}
    </> },
    ...(me.role === "business" ? [{ key: "company", title: t("rdz.pf_company"), body: <>
      <Input label={t("reg.company")} value={f.companyName ?? ""} onChange={(e) => set("companyName", e.target.value)} error={errs.companyName} required />
      <Input label={t("reg.cr")} ltr value={f.crNumber ?? ""} onChange={(e) => set("crNumber", e.target.value)} />
      <Input label={t("reg.industry")} value={f.industry ?? ""} onChange={(e) => set("industry", e.target.value)} />
      <Input label={t("reg.address")} value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} />
    </> }] : []),
    ...(me.role === "office" ? [{ key: "office", title: t("rdz.pf_office"), body: <>
      <Input label={t("reg.office_name")} value={f.officeName ?? ""} onChange={(e) => set("officeName", e.target.value)} />
      <Input label={t("reg.address")} value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} />
      <Input label={t("reg.tax")} ltr value={f.taxNumber ?? ""} onChange={(e) => set("taxNumber", e.target.value)} />
    </> }] : []),
    ...(isDriver ? [{ key: "vehicle", title: t("profile.vehicle_section"), body: <>
      <Select label={t("reg.vehicle")} options={(cat?.vehicleTypes ?? []).map((v: string) => ({ value: v, label: t(`vehicle.${v}`) }))} placeholder={t("common.select")} value={f.vehicleType ?? ""} onChange={(e) => set("vehicleType", e.target.value)} error={errs.vehicleType} />
      {needTemp ? <Select label={t("reg.temperature")} options={[{ value: "dry", label: t("temp.dry") }, { value: "cold", label: t("temp.cold") }]} placeholder={t("common.select")} value={f.vehicleTemperature ?? ""} onChange={(e) => set("vehicleTemperature", e.target.value)} error={errs.vehicleTemperature} required /> : <div />}
      <Input label={t("reg.plate")} ltr value={f.vehiclePlate ?? ""} onChange={(e) => set("vehiclePlate", e.target.value)} error={errs.vehiclePlate} />
      <fieldset className="sm:col-span-2"><legend className="mb-2 text-xs font-medium text-muted">{t("reg.services")}</legend>
        <div className="flex flex-wrap gap-2">
          {(cat?.services ?? []).filter((s: any) => !s.driverless).map((s: any) => {
            const on = (f.services ?? []).includes(s.key);
            return <button key={s.key} type="button" aria-pressed={on} onClick={() => set("services", on ? f.services.filter((x: string) => x !== s.key) : [...(f.services ?? []), s.key])} className={cn("rounded-full border px-4 py-1.5 text-sm", on ? "border-accent bg-accent/10 text-accent" : "border-line text-muted")}>{t(`svc.${s.key}`)}</button>;
          })}
        </div>
        {errs.services && <p role="alert" className="mt-1 text-xs text-danger">{errs.services}</p>}
      </fieldset>
    </> }] : []),
    ...(me.role !== "business" ? [{ key: "payout", title: t("profile.payout_section"), body: <>
      <Input label={t("profile.bank")} value={f.bankName ?? ""} onChange={(e) => set("bankName", e.target.value)} error={errs.bankName} />
      <Input label={t("profile.iban")} ltr placeholder="SA…" value={f.iban ?? ""} onChange={(e) => set("iban", e.target.value)} error={errs.iban} hint={t("profile.iban_hint")} maxLength={34} />
      {p?.iban && ibanRaw !== p.iban && <div className="sm:col-span-2"><Notice tone="info">{t("profile.iban_change_warn")}</Notice></div>}
    </> }] : []),
  ];
  return (
    <>
      <PageHeader title={title ?? t("nav.profile")} subtitle={subtitle} actions={p?.verificationStatus && <StatusBadge status={p.verificationStatus} />} />
      {p?.verificationNote && <div className="mb-5"><Notice tone="warn">{p.verificationNote}</Notice></div>}
      {me.role === "business" && p?.verificationStatus && p.verificationStatus !== "verified" && <div className="mb-5"><Notice tone="info">{t("ubz.profile_verify")} <Link href="/business/documents" className="font-semibold text-cyan underline">{t("verify.go_documents")}</Link></Notice></div>}
      {top && <div className="mb-6">{top}</div>}
      <div className={cn("grid items-start gap-6", children ? "xl:grid-cols-2" : "max-w-3xl")}>
        <form className="min-w-0 space-y-6" onSubmit={(e) => { e.preventDefault(); save(); }} data-testid="profile-form">
          {sections.map((s) => <Section key={s.key} title={s.title}><div className="grid gap-4 sm:grid-cols-2">{s.body}</div></Section>)}
          <div className={cn("sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-card border bg-card/95 px-4 py-3 shadow-lg backdrop-blur transition", dirty ? "border-gold/50" : "border-line")}>
            <Button type="submit" loading={a.any} disabled={!dirty}>{t("common.save")}</Button>
            {dirty ? <span className="text-xs text-gold" role="status">{t("ubz.unsaved")}</span> : <span className="text-xs text-muted">{t("rdz.pf_saved_state")}</span>}
          </div>
        </form>
        {children && <div className="min-w-0 space-y-6">{children}</div>}
      </div>
    </>
  );
}
function flat(p: Record<string, any> | null) { return p ? { companyName: p.companyName, officeName: p.officeName, crNumber: p.crNumber, industry: p.industry, address: p.address, taxNumber: p.taxNumber, bankName: p.bankName, iban: p.iban, vehiclePlate: p.vehiclePlate } : {}; }
function driverFlat(p: Record<string, any> | null, email: string | null) { return { email: email ?? "", nationalId: p?.nationalId ?? "", vehicleType: p?.vehicleType ?? "", vehicleTemperature: p?.vehicleTemperature ?? "", services: p?.services ?? [] }; }
