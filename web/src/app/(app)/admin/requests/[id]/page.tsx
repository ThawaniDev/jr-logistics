"use client";
import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Input, KV, Modal, Notice, PageHeader, PageLoading, Select, StatusBadge, Textarea, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { Timeline } from "@/components/features/timeline";
import { post } from "@/lib/api";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser, hasPerm } from "@/components/layout/auth-context";

export default function AdminRequest({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n(); const a = useAction(); const me = useUser();
  const { data, error, mutate } = useApi(`/requests/${id}`, { refreshInterval: 20000 });
  const [m, setM] = useState<null | { kind: string; offer?: any }>(null); const [v, setV] = useState<any>({});
  const sug = useApi(m?.kind === "assign" ? `/admin/requests/${id}/suggest` : null);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const r = data.request; const live = ["published", "filling", "assigned", "confirmed", "in_progress"].includes(r.status);
  const done = () => { setM(null); setV({}); mutate(); };
  const go = (key: string, path: string, body?: unknown) => a.run(key, () => post(path, body), { success: "common.saved", onDone: done });
  const can = (p: string) => hasPerm(me, p);
  return (
    <>
      <Link href="/admin/requests" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("nav.requests")}</Link>
      <PageHeader title={`${t(`svc.${r.service}`)} · ${r.ref}`} subtitle={`${t(`city.${r.pickupCity}`)} → ${t(`city.${r.deliveryCity}`)} · ${fmtDateTime(r.startsAt, locale)}`}
        actions={<><StatusBadge status={r.status} />
          {can("requests.assign") && ["published", "filling"].includes(r.status) && <><Button size="sm" onClick={() => { setM({ kind: "assign" }); setV({}); }}>{t("admin.assign_driver")}</Button><Button size="sm" variant="secondary" loading={a.is("rm")} onClick={() => go("rm", `/admin/requests/${id}/rematch`)}>{t("ops.rematch")}</Button></>}
          {can("requests.edit") && r.status === "confirmed" && r.service === "car_without_driver" && <Button size="sm" loading={a.is("fr")} onClick={() => go("fr", `/admin/requests/${id}/fulfil-rental`)}>{t("admin.fulfil_rental")}</Button>}
          {can("requests.edit") && live && <Button size="sm" variant="danger" onClick={() => { setM({ kind: "cancel" }); setV({ reason: "" }); }}>{t("req.cancel")}</Button>}</>} />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><dl className="grid gap-x-8 sm:grid-cols-2"><KV label={t("req.slots")}>{r.slotsFilled}/{r.quantity}</KV><KV label={t("wizard.vehicle")}>{r.vehicleType ? t(`vehicle.${r.vehicleType}`) : "—"}</KV><KV label={t("wizard.pickup_address")}>{r.pickupAddress ?? "—"}</KV><KV label={t("wizard.delivery_address")}>{r.deliveryAddress ?? "—"}</KV><KV label={t("wizard.recipient_name")}>{r.recipientName ?? "—"}</KV><KV label={t("wizard.notes")}>{r.notes ?? "—"}</KV></dl></Card>
        <Card className="space-y-2"><h3 className="font-semibold">{t("req.cost")}</h3>
          {r.pricingSnapshot && <><KV label={t("req.total")}><span className="ltr-num">{fmtMoney(r.totalCents, locale)}</span></KV>
            {r.pricingSnapshot.providerCostCents != null && <><KV label={t("admin.provider_cost")}><span className="ltr-num">{fmtMoney(r.pricingSnapshot.providerTotalCents, locale)}</span></KV><KV label={t("admin.margin")}><span className="ltr-num text-gold">{fmtMoney(r.pricingSnapshot.marginCents, locale)}</span></KV></>}
            <KV label={t("wallet.reserved")}><span className="ltr-num">{fmtMoney(r.reservedCents, locale)}</span></KV></>}</Card>
      </div>
      <h2 className="mb-3 font-semibold">{t("req.drivers")}</h2>
      {data.offers.length === 0 ? <EmptyState title={t("req.no_drivers")} /> : <div className="mb-6 grid gap-4 lg:grid-cols-2">{data.offers.map((o: any) => (
        <Card key={o.id} className="space-y-3"><div className="flex justify-between"><div><p className="font-semibold">{o.driver.name} {o.officeId && <Badge tone="info">{t("admin.office_driver")}</Badge>}</p><p className="ltr-num text-xs text-muted">{o.driver.phone}</p></div><StatusBadge status={o.status} /></div>
          <p className="text-xs text-muted">{t("units.exp")} {o.expectedUnits} · {t("units.loaded")} {o.loadedUnits ?? "—"} · {t("units.delivered")} {o.deliveredUnits ?? "—"} · {t("units.final")} {o.finalUnits ?? "—"}</p>
          <div className="flex flex-wrap gap-2">
            {can("replacements.manage") && ["accepted", "arrived", "attendance_confirmed"].includes(o.status) && <Button size="sm" variant="danger" onClick={() => { setM({ kind: "replace", offer: o }); setV({ reason: "" }); }}>{t("office.replace")}</Button>}
            {can("requests.edit") && o.status === "qty_disputed" && <Button size="sm" onClick={() => { setM({ kind: "resolve", offer: o }); setV({ finalUnits: String(o.deliveredUnits ?? ""), resolution: "" }); }}>{t("admin.resolve_dispute")}</Button>}
          </div></Card>))}</div>}
      <Timeline events={data.timeline} />
      <Modal open={m?.kind === "assign"} onClose={() => setM(null)} title={t("admin.assign_driver")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.is("as")} disabled={!v.driverId || (v.reason ?? "").trim().length < 3} onClick={() => go("as", `/admin/requests/${id}/assign`, { driverId: v.driverId, reason: v.reason })}>{t("office.assign")}</Button></>}>
        <div className="max-h-56 space-y-1 overflow-y-auto">{!sug.data ? <p className="text-sm text-muted">…</p> : sug.data.items.map((c: any) => (
          <button key={c.driverId} disabled={c.reasons.length > 0} onClick={() => setV({ ...v, driverId: c.driverId })} className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-start text-sm ${v.driverId === c.driverId ? "border-accent bg-accent/10" : "border-line"} disabled:opacity-60`}>
            <span>{c.name}</span>{c.reasons.length ? <span className="text-xs text-danger">{c.reasons.map((x: string) => t(`reason.${x}`)).join(" · ")}</span> : <Badge tone="success">{t("admin.score", { n: c.score })}</Badge>}
          </button>))}</div>
        <Textarea label={t("admin.assign_reason")} value={v.reason ?? ""} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </Modal>
      <Modal open={m?.kind === "replace"} onClose={() => setM(null)} title={t("office.replace")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button variant="danger" loading={a.is("rp")} disabled={(v.reason ?? "").trim().length < 3} onClick={() => go("rp", `/admin/offers/${m!.offer.id}/replace`, { reason: v.reason })}>{t("common.confirm")}</Button></>}><Textarea label={t("req.reason")} value={v.reason ?? ""} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Modal>
      <Modal open={m?.kind === "cancel"} onClose={() => setM(null)} title={t("req.cancel")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.back")}</Button><Button variant="danger" loading={a.is("cn")} disabled={(v.reason ?? "").trim().length < 3} onClick={() => go("cn", `/requests/${id}/cancel`, { reason: v.reason })}>{t("req.cancel_confirm")}</Button></>}><Notice tone="info">{t("req.cancel_note")}</Notice><Textarea label={t("req.reason")} value={v.reason ?? ""} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Modal>
      <Modal open={m?.kind === "resolve"} onClose={() => setM(null)} title={t("admin.resolve_dispute")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.is("rs")} disabled={v.finalUnits === "" || (v.resolution ?? "").trim().length < 3} onClick={() => go("rs", `/admin/offers/${m!.offer.id}/resolve-dispute`, { finalUnits: Number(v.finalUnits), resolution: v.resolution })}>{t("common.confirm")}</Button></>}>
        <Input label={t("units.final")} type="number" min={0} value={v.finalUnits ?? ""} onChange={(e) => setV({ ...v, finalUnits: e.target.value })} /><Textarea label={t("support.resolution")} value={v.resolution ?? ""} onChange={(e) => setV({ ...v, resolution: e.target.value })} />
      </Modal>
    </>
  );
}
