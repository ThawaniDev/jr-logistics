"use client";
import { useState } from "react";
import { Button, Card, ErrorState, Input, Notice, PageHeader, PageLoading, Select, StatusBadge, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { patch } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";

export function ProfilePage() {
  const { error, data, mutate } = useApi("/profile");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  // keyed so the form re-initialises from the server copy after every save
  return <ProfileForm key={JSON.stringify(data.profile) + data.user.name} data={data} reload={() => mutate()} />;
}

function ProfileForm({ data, reload }: { data: any; reload: () => void }) {
  const { t, locale } = useI18n(); const me = useUser(); const a = useAction();
  const { data: cat } = useApi("/catalog");
  const [f, setF] = useState<Record<string, any>>(() => ({ name: data.user.name, city: data.user.city ?? "", ...flat(data.profile) }));
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const p = data.profile;
  const save = () => a.run("save", () => patch("/profile", f), { success: "common.saved", onDone: () => reload() });
  return (
    <>
      <PageHeader title={t("nav.profile")} actions={p?.verificationStatus && <StatusBadge status={p.verificationStatus} />} />
      {p?.verificationNote && <div className="mb-5"><Notice tone="warn">{p.verificationNote}</Notice></div>}
      <Card className="max-w-3xl">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Input label={t("reg.full_name")} value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} />
          <Input label={t("auth.phone")} value={data.user.phone ?? ""} ltr disabled />
          <Select label={t("reg.city")} options={(cat?.cities ?? []).map((c: any) => ({ value: c.key, label: c[locale] }))} placeholder={t("common.select")} value={f.city ?? ""} onChange={(e) => set("city", e.target.value)} />
          {me.role === "business" && <><Input label={t("reg.company")} value={f.companyName ?? ""} onChange={(e) => set("companyName", e.target.value)} /><Input label={t("reg.cr")} ltr value={f.crNumber ?? ""} onChange={(e) => set("crNumber", e.target.value)} /><Input label={t("reg.industry")} value={f.industry ?? ""} onChange={(e) => set("industry", e.target.value)} /><Input label={t("reg.address")} value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} /></>}
          {me.role === "office" && <><Input label={t("reg.office_name")} value={f.officeName ?? ""} onChange={(e) => set("companyName", e.target.value)} /><Input label={t("reg.address")} value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} /><Input label={t("reg.tax")} ltr value={f.taxNumber ?? ""} onChange={(e) => set("taxNumber", e.target.value)} /></>}
          {me.role === "driver" && <><Input label={t("reg.plate")} ltr value={f.vehiclePlate ?? ""} onChange={(e) => set("vehiclePlate", e.target.value)} /><div className="rounded-xl border border-line bg-bg2 p-3 text-sm"><p className="text-xs text-muted">{t("reg.vehicle")}</p><p className="font-medium">{p?.vehicleType ? t(`vehicle.${p.vehicleType}`) : "—"}{p?.vehicleTemperature ? ` · ${t(`temp.${p.vehicleTemperature}`)}` : ""}</p></div></>}
          {me.role !== "business" && <><Input label={t("profile.bank")} value={f.bankName ?? ""} onChange={(e) => set("bankName", e.target.value)} /><Input label="IBAN" ltr placeholder="SA…" value={f.iban ?? ""} onChange={(e) => set("iban", e.target.value)} hint={t("profile.iban_hint")} /></>}
          <div className="sm:col-span-2"><Button type="submit" loading={a.any}>{t("common.save")}</Button></div>
        </form>
      </Card>
    </>
  );
}
function flat(p: Record<string, any> | null) { return p ? { companyName: p.companyName, officeName: p.officeName, crNumber: p.crNumber, industry: p.industry, address: p.address, taxNumber: p.taxNumber, bankName: p.bankName, iban: p.iban, vehiclePlate: p.vehiclePlate } : {}; }
