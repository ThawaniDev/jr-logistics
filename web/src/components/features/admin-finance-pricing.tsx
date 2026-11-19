"use client";
import { useState } from "react";
import Link from "next/link";
import { AlarmClock, ArrowRight, Building2, Plus, Scale, Tag } from "lucide-react";
import { Badge, Button, CellPair, EmptyState, ErrorState, Input, Modal, Notice, PageHeader, Segmented, Select, Stat, StatGrid, Table, Td, Toolbar, useAction, errText } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDate, riyadhLocalToIso, sarToCents } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { BusinessPicker, ConfirmModal, hasAny } from "./admin-common";
import { ListSkeleton, Money, NoAccess, partyHref, useUrlFilters } from "./admin-finance-parts";

const SOON_MS = 30 * 86_400_000;

/** The company a rule is negotiated for, linked to its page (the name needs `users.view`; without it a plain "Business" badge). */
function RuleScope({ id }: { id: string | null }) {
  const { t } = useI18n(); const me = useUser();
  const canName = hasPerm(me, "users.view");
  const { data } = useApi(id && canName ? `/admin/users/${id}` : null, { shouldRetryOnError: false });
  if (!id) return <Badge>{t("pricing.global")}</Badge>;
  const name = data?.profile?.companyName ?? data?.user?.name;
  return name ? <Link href={partyHref("business", id)!} className="inline-flex items-center gap-1 text-accent hover:underline"><Building2 className="size-3.5 shrink-0" aria-hidden />{name}</Link> : <Badge tone="info">{t("pricing.business")}</Badge>;
}

export function PricingView() {
  const { t, locale } = useI18n(); const a = useAction(); const me = useUser();
  const ok = hasAny(me, "pricing.view", "pricing.edit"); const canEdit = hasPerm(me, "pricing.edit");
  const [f, setF] = useUrlFilters(["service", "all"] as const);
  const cat = useApi("/catalog");
  const svc = cat.data?.services.some((s: any) => s.key === f.service) ? f.service : "delivery_driver"; const all = f.all === "1";
  const rules = useApi(ok ? `/admin/pricing?service=${svc}${all ? "&all=1" : ""}` : null, { keepPreviousData: true });
  const [now] = useState(() => Date.now()); const [retire, setRetire] = useState<any>(null); const [open, setOpen] = useState(false); const [form, setForm] = useState<any>({}); const [err, setErr] = useState<string | null>(null);
  if (!ok) return <NoAccess title={t("nav.pricing")} />;
  if (cat.error || rules.error) return <><PageHeader title={t("nav.pricing")} subtitle={t("pricing.sub")} icon={<Tag className="size-5" />} /><ErrorState error={cat.error ?? rules.error} retry={() => { void cat.mutate(); void rules.mutate(); }} /></>;
  const items: any[] = rules.data?.items ?? []; const active = items.filter((r) => r.status === "approved");
  const margin = (r: any) => r.priceCents - r.providerCostCents;
  const soon = active.filter((r) => r.expiresAt && +new Date(r.expiresAt) - now < SOON_MS).length;
  const thin = active.length ? active.reduce((m, r) => (margin(r) < margin(m) ? r : m), active[0]) : null;
  const loaded = !!cat.data && !!rules.data;
  const cities = (cat.data?.cities ?? []).map((c: any) => ({ value: c.key, label: c[locale] }));
  const needTemp = ["van", "dyna"].includes(form.vehicleType);
  const formMargin = form.price && form.cost ? sarToCents(form.price) - sarToCents(form.cost) : null;
  const where = (r: any) => `${r.pickupCity ? t(`city.${r.pickupCity}`) : t("pricing.any")} → ${r.deliveryCity ? t(`city.${r.deliveryCity}`) : t("pricing.any")}`;
  const save = () => a.run("sv", () => post("/admin/pricing", { service: svc, vehicleType: form.vehicleType || null, temperature: needTemp ? form.temperature || null : null, pickupCity: form.pickupCity || null, deliveryCity: form.deliveryCity || null, businessId: form.business?.id || null, priceCents: sarToCents(form.price), providerCostCents: sarToCents(form.cost), agreementRef: form.ref || null, expiresAt: form.expires ? riyadhLocalToIso(`${form.expires}T23:59`) : null }),
    { success: "common.saved", onDone: () => { setOpen(false); setForm({}); setErr(null); void rules.mutate(); }, onError: (e) => setErr(errText(e, t)) });
  return (
    <>
      <PageHeader title={t("nav.pricing")} subtitle={t("pricing.sub")} icon={<Tag className="size-5" />}
        actions={canEdit && <Button data-testid="fin-pricing-new" onClick={() => { setForm({}); setErr(null); setOpen(true); }}><Plus className="size-4" aria-hidden />{t("pricing.new")}</Button>} />
      <div className="mb-5"><StatGrid cols={4}>
        <Stat label={t("rdf.pr_active")} value={loaded ? <span className="ltr-num">{active.length}</span> : undefined} hint={t(`svc.${svc}`)} icon={<Tag className="size-5" />} tone="accent" loading={!loaded} />
        <Stat label={t("rdf.pr_overrides")} value={loaded ? <span className="ltr-num">{active.filter((r) => r.businessId).length}</span> : undefined} hint={t("rdf.pr_overrides_hint")} icon={<Building2 className="size-5" />} tone="cyan" loading={!loaded} />
        <Stat label={t("rdf.pr_expiring")} value={loaded ? <span className="ltr-num">{soon}</span> : undefined} hint={t("rdf.pr_expiring_hint")} icon={<AlarmClock className="size-5" />} tone={soon > 0 ? "gold" : "muted"} loading={!loaded} />
        <Stat label={t("rdf.pr_thinnest")} value={loaded ? (thin ? <Money c={margin(thin)} /> : "—") : undefined} hint={thin ? where(thin) : t("rdf.pr_no_active")} icon={<Scale className="size-5" />} tone={thin && margin(thin) < 0 ? "danger" : "muted"} loading={!loaded} />
      </StatGrid></div>
      <div className="mb-4"><Notice tone="info">{t("pricing.resolution_note")}</Notice></div>
      <Toolbar>
        <Segmented label={t("req.service")} value={svc} onChange={(k) => setF({ service: k === "delivery_driver" ? "" : k })} options={(cat.data?.services ?? [{ key: "delivery_driver" }]).map((s: any) => ({ key: s.key, label: t(`svc.${s.key}`) }))} />
        <Segmented label={t("common.status")} value={all ? "all" : "active"} onChange={(k) => setF({ all: k === "all" ? "1" : "" })} options={[{ key: "active", label: t("rdf.pr_active_only") }, { key: "all", label: t("rdf.pr_with_retired") }]} />
      </Toolbar>
      {!rules.data ? <ListSkeleton /> : items.length === 0 ? <EmptyState icon={<Tag className="size-9" aria-hidden />} title={t("pricing.none")} hint={t("pricing.none_hint")} action={canEdit ? <Button size="sm" onClick={() => { setForm({}); setErr(null); setOpen(true); }}><Plus className="size-4" aria-hidden />{t("pricing.new")}</Button> : undefined} /> : (
        <Table stack label={t("nav.pricing")} head={[t("wizard.vehicle"), t("req.route"), t("pricing.scope"), { label: t("pricing.customer"), align: "end" }, { label: t("pricing.provider"), align: "end" }, { label: t("admin.margin"), align: "end" }, t("pricing.version"), t("common.status"), { label: t("rdf.actions"), srOnly: true }]}>
          {items.map((r) => (
            <tr key={r.id} data-testid={`fin-pricing-row-${r.id}`} className={r.status !== "approved" ? "opacity-70" : undefined}>
              <Td label={t("wizard.vehicle")}><CellPair title={r.vehicleType ? t(`vehicle.${r.vehicleType}`) : t("pricing.any")} sub={r.temperature ? t(`temp.${r.temperature}`) : undefined} /></Td>
              <Td label={t("req.route")} className="text-muted"><span className="inline-flex flex-wrap items-center gap-1">{r.pickupCity ? t(`city.${r.pickupCity}`) : t("pricing.any")}<ArrowRight className="size-3.5 shrink-0 rtl:rotate-180" aria-hidden />{r.deliveryCity ? t(`city.${r.deliveryCity}`) : t("pricing.any")}</span></Td>
              <Td label={t("pricing.scope")}><RuleScope id={r.businessId} /></Td>
              <Td label={t("pricing.customer")} num className="font-semibold"><Money c={r.priceCents} /></Td>
              <Td label={t("pricing.provider")} num><Money c={r.providerCostCents} /></Td>
              <Td label={t("admin.margin")} num className={r.priceCents < r.providerCostCents ? "font-semibold text-danger" : "text-gold"}><Money c={margin(r)} /></Td>
              <Td label={t("pricing.version")}><CellPair title={<span className="ltr-num">v{r.version}</span>} sub={<span className="whitespace-nowrap">{fmtDate(r.effectiveAt, locale)}{r.expiresAt ? ` → ${fmtDate(r.expiresAt, locale)}` : ""}</span>} /></Td>
              <Td label={t("common.status")}>{r.status === "approved" ? <Badge tone="success">{t("pricing.active")}</Badge> : <Badge>{t("pricing.retired")}</Badge>}</Td>
              <Td>{r.status === "approved" && canEdit && <Button size="sm" variant="ghost" data-testid={`fin-pricing-retire-${r.id}`} onClick={() => setRetire(r)}>{t("pricing.retire")}</Button>}</Td>
            </tr>))}
        </Table>)}
      <ConfirmModal open={!!retire} onClose={() => setRetire(null)} danger busy={a.is(retire?.id ?? "")} title={t("pricing.retire")} confirmLabel={t("pricing.retire")}
        onConfirm={() => retire && a.run(retire.id, () => post(`/admin/pricing/${retire.id}/retire`), { success: "common.saved", onDone: () => { setRetire(null); void rules.mutate(); } })}>
        <p className="text-sm">{t("pricing.retire_confirm")}</p>
        {retire && <dl className="text-sm"><dt className="sr-only">{t("wizard.vehicle")}</dt><dd className="text-muted">{retire.vehicleType ? t(`vehicle.${retire.vehicleType}`) : t("pricing.any")} · {where(retire)} · <Money c={retire.priceCents} /></dd></dl>}
      </ConfirmModal>
      <Modal open={open} onClose={() => setOpen(false)} busy={a.is("sv")} title={t("pricing.new")} footer={<><Button variant="ghost" disabled={a.is("sv")} onClick={() => setOpen(false)}>{t("common.cancel")}</Button><Button data-testid="fin-pricing-save" loading={a.is("sv")} disabled={!(Number(form.price) > 0) || form.cost === undefined || form.cost === ""} onClick={save}>{t("common.save")}</Button></>}>
        <p className="text-xs text-muted">{t(`svc.${svc}`)} · {t("pricing.wildcard_hint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t("wizard.vehicle")} placeholder={t("pricing.any")} options={(cat.data?.vehicleTypes ?? []).map((v: string) => ({ value: v, label: t(`vehicle.${v}`) }))} value={form.vehicleType ?? ""} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })} />
          {needTemp && <Select label={t("reg.temperature")} placeholder={t("pricing.any")} options={[{ value: "dry", label: t("temp.dry") }, { value: "cold", label: t("temp.cold") }]} value={form.temperature ?? ""} onChange={(e) => setForm({ ...form, temperature: e.target.value })} />}
          <Select label={t("wizard.pickup_city")} placeholder={t("pricing.any")} options={cities} value={form.pickupCity ?? ""} onChange={(e) => setForm({ ...form, pickupCity: e.target.value })} />
          <Select label={t("wizard.delivery_city")} placeholder={t("pricing.any")} options={cities} value={form.deliveryCity ?? ""} onChange={(e) => setForm({ ...form, deliveryCity: e.target.value })} />
          <Input label={t("pricing.customer_sar")} type="number" step="0.01" min="0" ltr value={form.price ?? ""} onChange={(e) => setForm({ ...form, price: e.target.value })} required data-testid="fin-pricing-price" />
          <Input label={t("pricing.provider_sar")} type="number" step="0.01" min="0" ltr value={form.cost ?? ""} onChange={(e) => setForm({ ...form, cost: e.target.value })} required data-testid="fin-pricing-cost" />
          {hasPerm(me, "users.view") && <BusinessPicker label={t("pricing.business_override")} placeholder={t("pricing.global")} value={form.business ?? null} onChange={(b) => setForm({ ...form, business: b })} />}
          <Input label={t("pricing.agreement_ref")} value={form.ref ?? ""} onChange={(e) => setForm({ ...form, ref: e.target.value })} />
          <Input label={t("pricing.expires")} type="date" ltr value={form.expires ?? ""} onChange={(e) => setForm({ ...form, expires: e.target.value })} />
        </div>
        {formMargin != null && <p className={`text-sm ${formMargin < 0 ? "text-danger" : "text-gold"}`}>{t("admin.margin")}: <Money c={formMargin} className="font-bold" /></p>}
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      </Modal>
    </>
  );
}
