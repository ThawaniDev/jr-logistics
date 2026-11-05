"use client";
import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, CheckCheck, MessageSquare, Phone, Siren, Star, Package } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Input, KV, Modal, Notice, PageHeader, PageLoading, Select, StatusBadge, Textarea, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { JobChat } from "@/components/features/chat";
import { Timeline } from "@/components/features/timeline";
import { post } from "@/lib/api";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";

type ModalKind = null | { kind: "cancel" } | { kind: "urgent" } | { kind: "noshow" | "loading" | "confirm" | "dispute" | "custody" | "rate"; offer: any };

export default function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n(); const a = useAction();
  const { data, error, mutate } = useApi(`/requests/${id}`, { refreshInterval: 15000 });
  const { data: cat } = useApi("/catalog");
  const [m, setM] = useState<ModalKind>(null); const [v, setV] = useState<any>({}); const [chat, setChat] = useState<string | null>(null);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const r = data.request; const offers: any[] = data.offers;
  const done = () => { setM(null); setV({}); mutate(); };
  const open = (kind: any, offer?: any, init: any = {}) => { setV(init); setM({ kind, offer } as ModalKind); };
  const act = (key: string, path: string, body: unknown, success = "common.saved") => a.run(key, () => post(path, body), { success, onDone: done });
  const live = ["published", "filling", "assigned", "confirmed", "in_progress"].includes(r.status);
  const canComplete = offers.some((o) => o.status === "pending_settlement") && offers.every((o) => ["pending_settlement", "completed", "cancelled", "rejected", "no_show", "replaced", "expired"].includes(o.status) || o.status === "offered");
  const chatOffer = offers.find((o) => o.id === chat) ?? offers.find((o) => !["offered", "rejected", "expired"].includes(o.status));
  const units = (x: any) => [["exp", x.expectedUnits], ["loaded", x.loadedUnits], ["delivered", x.deliveredUnits], ["final", x.finalUnits]] as const;

  return (
    <>
      <Link href="/business/requests" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("nav.requests")}</Link>
      <PageHeader title={`${t(`svc.${r.service}`)} · ${r.ref}`} subtitle={`${t(`city.${r.pickupCity}`)} → ${t(`city.${r.deliveryCity}`)} · ${fmtDateTime(r.startsAt, locale)}`}
        actions={<>
          <StatusBadge status={r.status} />
          {live && <Button variant="gold" size="sm" onClick={() => open("urgent", undefined, { reason: "" })}><Siren className="size-4" />{t("req.urgent")}</Button>}
          {live && <Button variant="danger" size="sm" onClick={() => open("cancel", undefined, { reason: "" })}><Ban className="size-4" />{t("req.cancel")}</Button>}
          {canComplete && r.status !== "completed" && <Button size="sm" loading={a.is("complete")} onClick={() => a.run("complete", () => post(`/requests/${id}/complete`), { success: "req.completed_ok", onDone: () => mutate() })}><CheckCheck className="size-4" />{t("req.complete")}</Button>}
        </>} />

      {r.status === "draft" && <div className="mb-5"><Notice tone="info">{t("req.draft_note")} <Link href="/business/requests/new" className="font-semibold text-cyan underline">{t("nav.new_request")}</Link></Notice></div>}
      {r.status === "confirmed" && r.service === "car_without_driver" && <div className="mb-5"><Notice tone="info">{t("req.rental_note")}</Notice></div>}
      {r.cancelReason && <div className="mb-5"><Notice tone="danger" title={t("status.cancelled")}>{r.cancelReason}</Notice></div>}

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><dl className="grid gap-x-8 sm:grid-cols-2">
          <KV label={t("wizard.vehicle")}>{r.vehicleType ? t(`vehicle.${r.vehicleType}`) : "—"}{r.temperature ? ` · ${t(`temp.${r.temperature}`)}` : ""}</KV>
          <KV label={t("req.slots")}><span className="tabular-nums">{r.slotsFilled}/{r.quantity}</span></KV>
          {r.shipmentsPerDriver && <KV label={t("wizard.shipments_per_driver")}>{fmtNum(r.shipmentsPerDriver, locale)}</KV>}
          <KV label={t("wizard.days")}>{fmtNum(r.durationDays, locale)}</KV>
          <KV label={t("wizard.pickup_address")}>{r.pickupAddress ?? "—"}</KV><KV label={t("wizard.delivery_address")}>{r.deliveryAddress ?? "—"}</KV>
          {r.recipientName && <KV label={t("wizard.recipient_name")}>{r.recipientName}</KV>}{r.contents && <KV label={t("wizard.contents")}>{r.contents}</KV>}
        </dl>
          {r.status === "published" || r.status === "filling" ? <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg2"><div className="h-full bg-brand-gradient transition-all" style={{ width: `${(r.slotsFilled / r.quantity) * 100}%` }} /></div> : null}
        </Card>
        <Card className="space-y-3">
          <h3 className="font-semibold">{t("req.cost")}</h3>
          {r.pricingSnapshot ? <>
            <KV label={t("wizard.unit_price")}><span className="ltr-num">{fmtMoney(r.pricingSnapshot.unitPriceCents, locale)}</span></KV>
            <KV label={t("req.total")}><span className="ltr-num text-accent">{fmtMoney(r.totalCents, locale)}</span></KV>
            <KV label={t("wallet.reserved")}><span className="ltr-num text-gold">{fmtMoney(r.reservedCents, locale)}</span></KV>
            <p className="text-xs text-muted">{t("req.price_locked", { v: r.pricingSnapshot.ruleVersion })}</p>
          </> : <p className="text-sm text-muted">{t("req.no_price_yet")}</p>}
          {data.invoices?.length > 0 && <div className="border-t border-line pt-3"><p className="mb-1 text-xs text-muted">{t("req.invoices")}</p>{data.invoices.map((i: any) => <p key={i.id} className="text-sm"><span className="ltr-num font-medium">{i.number}</span> · <span className="ltr-num">{fmtMoney(i.totalCents, locale)}</span></p>)}</div>}
        </Card>
      </div>

      <h2 className="mb-3 font-semibold">{t("req.drivers")} {data.offeredCount > 0 && <Badge tone="info" className="ms-2">{t("req.waiting_offers", { n: data.offeredCount })}</Badge>}</h2>
      {offers.length === 0 ? <EmptyState icon={<Package className="size-9" />} title={t("req.no_drivers")} hint={r.status === "published" ? t("req.no_drivers_hint") : undefined} /> : (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {offers.map((o) => (
            <Card key={o.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-semibold">{o.driver.name} {o.isReplacement && <Badge tone="warn" className="ms-1">{t("req.replacement")}</Badge>}</p>
                  <p className="text-xs text-muted">{t(`vehicle.${o.driver.vehicleType}`)} · {o.driver.rating ? `★ ${o.driver.rating}` : t("req.new_driver")} · {t("req.jobs_done", { n: o.driver.jobsCompleted })}</p></div>
                <StatusBadge status={o.status} />
              </div>
              {o.driver.phone && <a href={`tel:${o.driver.phone}`} className="inline-flex items-center gap-1.5 text-sm text-cyan"><Phone className="size-4" /><span className="ltr-num">{o.driver.phone}</span></a>}
              <div className="grid grid-cols-4 gap-2 text-center">
                {units(o).map(([k, val]) => <div key={k} className="rounded-lg bg-bg2 px-1 py-2"><p className="text-[10px] uppercase text-muted">{t(`units.${k}`)}</p><p className="font-bold tabular-nums">{val ?? "—"}</p></div>)}
              </div>
              {o.status === "attendance_confirmed" && o.loadedUnits != null && <p className="text-xs text-muted">{o.loadedAckByDriver === true ? t("req.driver_confirmed_loading") : o.loadedAckByDriver === false ? <span className="text-danger">{t("req.driver_disputed_loading")}</span> : t("req.awaiting_driver_ack")}</p>}
              <div className="flex flex-wrap gap-2">
                {o.actions.includes("confirm_attendance") && <Button size="sm" loading={a.is("att" + o.id)} onClick={() => act("att" + o.id, `/offers/${o.id}/attendance`, { present: true })}>{t("act.confirm_attendance")}</Button>}
                {o.actions.includes("mark_no_show") && <Button size="sm" variant="danger" onClick={() => open("noshow", o, { reason: "" })}>{t("act.no_show")}</Button>}
                {o.actions.includes("record_loading") && <Button size="sm" onClick={() => open("loading", o, { units: String(o.loadedUnits ?? o.expectedUnits) })}>{t("act.record_loading")}</Button>}
                {o.actions.includes("confirm_delivery") && <Button size="sm" onClick={() => open("confirm", o, { units: String(o.deliveredUnits ?? "") })}>{t("act.confirm_delivery")}</Button>}
                {o.actions.includes("dispute_delivery") && <Button size="sm" variant="danger" onClick={() => open("dispute", o, { note: "" })}>{t("act.dispute")}</Button>}
                {o.actions.includes("handover_custody") && <Button size="sm" variant="secondary" onClick={() => open("custody", o, { itemType: "pos_device", qty: 1 })}>{t("act.custody")}</Button>}
                {o.actions.includes("rate") && <Button size="sm" variant="gold" onClick={() => open("rate", o, { stars: 5 })}><Star className="size-4" />{t("act.rate")}</Button>}
                {!["offered", "rejected", "expired"].includes(o.status) && <Button size="sm" variant="ghost" onClick={() => setChat(o.id)}><MessageSquare className="size-4" />{t("chat.title")}</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {chatOffer && <div><p className="mb-2 text-sm text-muted">{t("chat.with", { name: chatOffer.driver.name })}</p><JobChat key={chatOffer.id} offerId={chatOffer.id} closed={["completed", "cancelled"].includes(r.status)} /></div>}
        <Timeline events={data.timeline} />
      </div>

      <Modal open={m?.kind === "cancel"} onClose={() => setM(null)} title={t("req.cancel")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.back")}</Button><Button variant="danger" loading={a.is("cancel")} disabled={v.reason?.trim().length < 3} onClick={() => act("cancel", `/requests/${id}/cancel`, { reason: v.reason }, "req.cancelled_ok")}>{t("req.cancel_confirm")}</Button></>}>
        <Notice tone="info">{t("req.cancel_note")}</Notice><Textarea label={t("req.reason")} value={v.reason ?? ""} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </Modal>
      <Modal open={m?.kind === "urgent"} onClose={() => setM(null)} title={t("req.urgent")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.is("urgent")} disabled={!v.reason} onClick={() => act("urgent", `/requests/${id}/urgent-help`, { reason: t(`urgent.${v.reason}`), note: v.note }, "req.urgent_sent")}>{t("common.submit")}</Button></>}>
        <div className="flex flex-wrap gap-2">{["driver_late", "driver_unreachable", "wrong_count", "safety", "other"].map((k) => <button key={k} onClick={() => setV({ ...v, reason: k })} aria-pressed={v.reason === k} className={cn("rounded-full border px-3 py-1.5 text-sm", v.reason === k ? "border-gold bg-gold/10 text-gold" : "border-line text-muted")}>{t(`urgent.${k}`)}</button>)}</div>
        <Textarea label={t("support.details")} value={v.note ?? ""} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </Modal>
      <Modal open={m?.kind === "noshow"} onClose={() => setM(null)} title={t("act.no_show")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button variant="danger" loading={a.is("ns")} disabled={!v.reason?.trim()} onClick={() => act("ns", `/offers/${(m as any).offer.id}/attendance`, { present: false, reason: v.reason })}>{t("common.confirm")}</Button></>}>
        <Notice tone="info">{t("req.noshow_note")}</Notice><Textarea label={t("req.reason")} value={v.reason ?? ""} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </Modal>
      <Modal open={m?.kind === "loading"} onClose={() => setM(null)} title={t("act.record_loading")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.is("ld")} onClick={() => act("ld", `/offers/${(m as any).offer.id}/loading`, { units: Number(v.units) })}>{t("common.save")}</Button></>}>
        <Input label={t("units.loaded")} type="number" min={0} value={v.units ?? ""} onChange={(e) => setV({ ...v, units: e.target.value })} hint={t("req.loading_hint")} />
      </Modal>
      <Modal open={m?.kind === "confirm"} onClose={() => setM(null)} title={t("act.confirm_delivery")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.is("cf")} disabled={v.units === ""} onClick={() => act("cf", `/offers/${(m as any).offer.id}/delivery-decision`, { action: "confirm", units: Number(v.units) })}>{t("common.confirm")}</Button></>}>
        <Notice tone="info">{t("req.confirm_note", { n: (m as any)?.offer?.deliveredUnits ?? 0 })}</Notice><Input label={t("units.final")} type="number" min={0} value={v.units ?? ""} onChange={(e) => setV({ ...v, units: e.target.value })} />
      </Modal>
      <Modal open={m?.kind === "dispute"} onClose={() => setM(null)} title={t("act.dispute")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button variant="danger" loading={a.is("dp")} disabled={v.note?.trim().length < 3} onClick={() => act("dp", `/offers/${(m as any).offer.id}/delivery-decision`, { action: "dispute", note: v.note })}>{t("act.dispute")}</Button></>}>
        <Notice tone="warn">{t("req.dispute_note")}</Notice><Textarea label={t("req.dispute_reason")} value={v.note ?? ""} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </Modal>
      <Modal open={m?.kind === "custody"} onClose={() => setM(null)} title={t("act.custody")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.is("cu")} onClick={() => act("cu", `/offers/${(m as any).offer.id}/custody`, { items: [{ itemType: v.itemType, qty: Number(v.qty) || 1 }] })}>{t("common.confirm")}</Button></>}>
        <Select label={t("custody.item")} options={(cat?.custodyItemTypes ?? []).map((k: string) => ({ value: k, label: t(`custody.${k}`) }))} value={v.itemType ?? ""} onChange={(e) => setV({ ...v, itemType: e.target.value })} />
        <Input label={t("custody.qty")} type="number" min={1} value={v.qty ?? 1} onChange={(e) => setV({ ...v, qty: e.target.value })} />
      </Modal>
      <Modal open={m?.kind === "rate"} onClose={() => setM(null)} title={t("act.rate")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.is("rt")} onClick={() => act("rt", `/offers/${(m as any).offer.id}/rate`, { stars: v.stars, comment: v.comment })}>{t("common.submit")}</Button></>}>
        <div className="flex justify-center gap-1" role="radiogroup">{[1, 2, 3, 4, 5].map((s) => <button key={s} role="radio" aria-checked={v.stars === s} aria-label={`${s}`} onClick={() => setV({ ...v, stars: s })}><Star className={cn("size-9", s <= (v.stars ?? 0) ? "fill-gold text-gold" : "text-line")} /></button>)}</div>
        <Textarea label={t("rate.comment")} value={v.comment ?? ""} onChange={(e) => setV({ ...v, comment: e.target.value })} />
      </Modal>
    </>
  );
}
