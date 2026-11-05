"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Input, Modal, Notice, PageHeader, PageLoading, Select, Table, Td, useAction, errText, Tabs } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDate, fmtMoney, sarToCents } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser, hasPerm } from "@/components/layout/auth-context";

export default function Pricing() {
  const { t, locale } = useI18n(); const a = useAction(); const me = useUser();
  const [svc, setSvc] = useState("delivery_driver"); const [all, setAll] = useState(false);
  const { data, error, mutate } = useApi(`/admin/pricing?service=${svc}${all ? "&all=1" : ""}`); const { data: cat } = useApi("/catalog"); const biz = useApi("/admin/users?role=business&pageSize=100");
  const [open, setOpen] = useState(false); const [f, setF] = useState<any>({}); const [err, setErr] = useState<string | null>(null);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data || !cat) return <PageLoading />;
  const cities = cat.cities.map((c: any) => ({ value: c.key, label: c[locale] }));
  const needTemp = ["van", "dyna"].includes(f.vehicleType);
  const margin = f.price && f.cost ? sarToCents(f.price) - sarToCents(f.cost) : null;
  const save = () => a.run("sv", () => post("/admin/pricing", { service: svc, vehicleType: f.vehicleType || null, temperature: needTemp ? f.temperature || null : null, pickupCity: f.pickupCity || null, deliveryCity: f.deliveryCity || null, businessId: f.businessId || null, priceCents: sarToCents(f.price), providerCostCents: sarToCents(f.cost), agreementRef: f.ref || null, expiresAt: f.expires ? new Date(f.expires).toISOString() : null }), { success: "common.saved", onDone: () => { setOpen(false); setF({}); setErr(null); mutate(); }, onError: (e) => setErr(errText(e, t)) });
  return (
    <>
      <PageHeader title={t("nav.pricing")} subtitle={t("pricing.sub")} actions={hasPerm(me, "pricing.edit") && <Button onClick={() => { setF({}); setErr(null); setOpen(true); }}><Plus className="size-4" />{t("pricing.new")}</Button>} />
      <Tabs value={svc} onChange={setSvc} tabs={cat.services.map((s: any) => ({ key: s.key, label: t(`svc.${s.key}`) }))} />
      <label className="mb-4 flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="accent-[var(--jr-accent)]" />{t("pricing.show_retired")}</label>
      <div className="mb-4"><Notice tone="info">{t("pricing.resolution_note")}</Notice></div>
      {data.items.length === 0 ? <EmptyState title={t("pricing.none")} hint={t("pricing.none_hint")} /> : (
        <Table head={[t("wizard.vehicle"), t("req.route"), t("pricing.scope"), t("pricing.customer"), t("pricing.provider"), t("admin.margin"), t("pricing.version"), t("common.status"), ""]}>
          {data.items.map((r: any) => <tr key={r.id}><Td>{r.vehicleType ? t(`vehicle.${r.vehicleType}`) : t("pricing.any")}{r.temperature ? ` · ${t(`temp.${r.temperature}`)}` : ""}</Td><Td className="text-muted">{r.pickupCity ? t(`city.${r.pickupCity}`) : t("pricing.any")} → {r.deliveryCity ? t(`city.${r.deliveryCity}`) : t("pricing.any")}</Td>
            <Td>{r.businessId ? <Badge tone="info">{t("pricing.business")}</Badge> : <Badge>{t("pricing.global")}</Badge>}</Td><Td className="ltr-num font-semibold tabular-nums">{fmtMoney(r.priceCents, locale)}</Td><Td className="ltr-num tabular-nums">{fmtMoney(r.providerCostCents, locale)}</Td><Td className="ltr-num tabular-nums text-gold">{fmtMoney(r.priceCents - r.providerCostCents, locale)}</Td>
            <Td className="tabular-nums">v{r.version} <span className="text-xs text-muted">{fmtDate(r.effectiveAt, locale)}</span></Td><Td>{r.status === "approved" ? <Badge tone="success">{t("pricing.active")}</Badge> : <Badge>{t("pricing.retired")}</Badge>}</Td>
            <Td>{r.status === "approved" && hasPerm(me, "pricing.edit") && <Button size="sm" variant="ghost" onClick={() => confirm(t("pricing.retire_confirm")) && a.run(r.id, () => post(`/admin/pricing/${r.id}/retire`), { success: "common.saved", onDone: () => mutate() })}>{t("pricing.retire")}</Button>}</Td></tr>)}
        </Table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t("pricing.new")} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button><Button loading={a.is("sv")} disabled={!(Number(f.price) > 0) || f.cost === undefined || f.cost === ""} onClick={save}>{t("common.save")}</Button></>}>
        <p className="text-xs text-muted">{t(`svc.${svc}`)} · {t("pricing.wildcard_hint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t("wizard.vehicle")} placeholder={t("pricing.any")} options={cat.vehicleTypes.map((v: string) => ({ value: v, label: t(`vehicle.${v}`) }))} value={f.vehicleType ?? ""} onChange={(e) => setF({ ...f, vehicleType: e.target.value })} />
          {needTemp && <Select label={t("reg.temperature")} placeholder={t("pricing.any")} options={[{ value: "dry", label: t("temp.dry") }, { value: "cold", label: t("temp.cold") }]} value={f.temperature ?? ""} onChange={(e) => setF({ ...f, temperature: e.target.value })} />}
          <Select label={t("wizard.pickup_city")} placeholder={t("pricing.any")} options={cities} value={f.pickupCity ?? ""} onChange={(e) => setF({ ...f, pickupCity: e.target.value })} />
          <Select label={t("wizard.delivery_city")} placeholder={t("pricing.any")} options={cities} value={f.deliveryCity ?? ""} onChange={(e) => setF({ ...f, deliveryCity: e.target.value })} />
          <Input label={t("pricing.customer_sar")} type="number" step="0.01" min="0" ltr value={f.price ?? ""} onChange={(e) => setF({ ...f, price: e.target.value })} required />
          <Input label={t("pricing.provider_sar")} type="number" step="0.01" min="0" ltr value={f.cost ?? ""} onChange={(e) => setF({ ...f, cost: e.target.value })} required />
          <Select label={t("pricing.business_override")} placeholder={t("pricing.global")} options={(biz.data?.items ?? []).map((b: any) => ({ value: b.id, label: b.name }))} value={f.businessId ?? ""} onChange={(e) => setF({ ...f, businessId: e.target.value })} />
          <Input label={t("pricing.agreement_ref")} value={f.ref ?? ""} onChange={(e) => setF({ ...f, ref: e.target.value })} />
          <Input label={t("pricing.expires")} type="date" ltr value={f.expires ?? ""} onChange={(e) => setF({ ...f, expires: e.target.value })} />
        </div>
        {margin != null && <p className={`text-sm ${margin < 0 ? "text-danger" : "text-gold"}`}>{t("admin.margin")}: <span className="ltr-num font-bold">{fmtMoney(margin, locale)}</span></p>}
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      </Modal>
    </>
  );
}
