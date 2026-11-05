"use client";
import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, LocateFixed, MapPinned, MessageCircle, Navigation, PackageCheck, PhoneOff, TriangleAlert } from "lucide-react";
import { Button, Card, ErrorState, Input, KV, Modal, Notice, PageHeader, PageLoading, StatusBadge, Textarea, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { JobChat } from "@/components/features/chat";
import { Timeline } from "@/components/features/timeline";
import { get, post } from "@/lib/api";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const FLOW = ["accepted", "arrived", "attendance_confirmed", "delivered_reported", "pending_settlement", "completed"];

export default function DriverJob({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const router = useRouter();
  const { t, locale } = useI18n(); const a = useAction();
  const { data: j, error, mutate } = useApi(`/driver/jobs/${id}`, { refreshInterval: 12000 });
  const tl = useApi(`/offers/${id}/timeline`, { refreshInterval: 20000 }); const { data: cat } = useApi("/catalog");
  const [m, setM] = useState<null | "cancel" | "delivered" | "noresponse" | "problem">(null); const [v, setV] = useState<any>({}); const [terms, setTerms] = useState(false);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!j) return <PageLoading />;
  const done = () => { setM(null); setV({}); mutate(); tl.mutate(); };
  const doIt = (key: string, fn: () => Promise<unknown>, success = "common.saved") => a.run(key, fn, { success, onDone: done });
  const has = (x: string) => j.actions.includes(x);
  const step = FLOW.indexOf(j.status);
  const hasShip = j.service === "delivery_driver";

  async function checkin() {
    let loc: { lat?: number; lng?: number } = {};
    try { const p = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000 })); loc = { lat: p.coords.latitude, lng: p.coords.longitude }; } catch { /* location optional */ }
    return post(`/offers/${id}/checkin`, loc);
  }
  async function whatsapp(kind: string) {
    try { const r = await get(`/driver/jobs/${id}/whatsapp?kind=${kind}&lang=${locale}`); window.open(r.url, "_blank", "noopener"); } catch { toast.error(t("job.wa_unavailable")); }
  }
  const mapsUrl = j.delivery?.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${j.delivery.lat},${j.delivery.lng}` : j.delivery?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.delivery.address)}` : null;

  return (
    <>
      <Link href="/driver/jobs" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("nav.my_jobs")}</Link>
      <PageHeader title={`${t(`svc.${j.service}`)} · ${j.ref}`} subtitle={j.business ?? undefined} actions={<StatusBadge status={j.status} ns="jobstatus" />} />
      {step >= 0 && <ol className="mb-6 flex gap-1" aria-label="progress">{FLOW.map((s, i) => <li key={s} className="flex-1"><div className={cn("h-1.5 rounded-full", i <= step ? "bg-accent" : "bg-line")} /><p className={cn("mt-1 hidden text-[10px] sm:block", i === step ? "text-accent" : "text-muted")}>{t(`jobstatus.${s}`)}</p></li>)}</ol>}

      {/* Next step — one clear thing to do */}
      <Card className="mb-5 border-2 border-accent/50 bg-accent/5">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent">{t("job.next_step")}</p>
        <p className="mb-4 text-lg font-semibold">{t(`job.hint_${j.status}${j.status === "attendance_confirmed" && j.loadedUnits != null && j.loadedAckByDriver == null ? "_ack" : ""}`)}</p>
        <div className="flex flex-wrap gap-2">
          {has("accept") && <Button size="lg" onClick={() => router.push("/driver/opportunities")}>{t("act.accept")}</Button>}
          {has("checkin") && <Button size="lg" loading={a.is("ci")} onClick={() => doIt("ci", checkin, "job.arrived_ok")}><LocateFixed className="size-5" />{t("act.checkin")}</Button>}
          {has("ack_loading") && <><Button size="lg" loading={a.is("ack")} onClick={() => doIt("ack", () => post(`/offers/${id}/loading-ack`, { ok: true }))}>{t("act.ack_loading", { n: j.loadedUnits })}</Button><Button size="lg" variant="danger" loading={a.is("dis")} onClick={() => doIt("dis", () => post(`/offers/${id}/loading-ack`, { ok: false, note: "count differs" }))}>{t("act.dispute_loading")}</Button></>}
          {has("report_delivered") && <Button size="lg" onClick={() => { setV({ units: String(j.loadedUnits ?? j.expectedUnits) }); setM("delivered"); }}><PackageCheck className="size-5" />{hasShip ? t("act.report_delivered") : t("act.finish_work")}</Button>}
        </div>
      </Card>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card><h3 className="mb-2 font-semibold">{t("job.details")}</h3><dl className="divide-y divide-line">
          <KV label={t("req.starts")}>{fmtDateTime(j.startsAt, locale)}</KV>
          {j.vehicleType && <KV label={t("wizard.vehicle")}>{t(`vehicle.${j.vehicleType}`)}{j.temperature ? ` · ${t(`temp.${j.temperature}`)}` : ""}</KV>}
          <KV label={t(hasShip ? "units.exp" : "wizard.days")}>{fmtNum(j.expectedUnits, locale)}</KV>
          {hasShip && <><KV label={t("units.loaded")}>{j.loadedUnits ?? "—"}</KV><KV label={t("units.delivered")}>{j.deliveredUnits ?? "—"}</KV></>}
          {j.finalUnits != null && <KV label={t("units.final")}>{j.finalUnits}</KV>}
          {j.expectedEarningCents != null && <KV label={t("job.expected_earning")}><span className="ltr-num text-accent">{fmtMoney(j.expectedEarningCents, locale)}</span></KV>}
          {j.contents && <KV label={t("wizard.contents")}>{j.contents}</KV>}{j.notes && <KV label={t("wizard.notes")}>{j.notes}</KV>}
        </dl></Card>
        <Card className="space-y-3"><h3 className="font-semibold">{t("job.locations")}</h3>
          {j.pickup || j.delivery ? <>
            <div className="rounded-xl bg-bg2 p-3"><p className="text-xs text-muted">{t("wizard.pickup_address")}</p><p className="text-sm font-medium">{j.pickup?.address ?? "—"}</p></div>
            <div className="rounded-xl bg-bg2 p-3"><p className="text-xs text-muted">{t("wizard.delivery_address")}</p><p className="text-sm font-medium">{j.delivery?.address ?? "—"}</p></div>
            {mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer"><Button variant="secondary" full><Navigation className="size-4" />{t("job.navigate")}</Button></a>}
          </> : <Notice tone="info">{t("job.locked_until_accept")}</Notice>}
          {j.recipient && <div className="space-y-2 border-t border-line pt-3"><p className="text-xs text-muted">{t("job.recipient")}</p><p className="font-medium">{j.recipient.name} <span className="ltr-num text-sm text-muted">{j.recipient.phone}</span></p>
            <div className="grid grid-cols-3 gap-2">{(["contact", "arriving", "issue"] as const).map((k) => <Button key={k} size="sm" variant="secondary" onClick={() => whatsapp(k)}><MessageCircle className="size-4" /><span className="truncate">{t(`wa.${k}`)}</span></Button>)}</div>
            <p className="text-[11px] text-muted">{t("job.wa_note")}</p>
            <Button size="sm" variant="ghost" onClick={() => { setV({ reason: "no_answer" }); setM("noresponse"); }}><PhoneOff className="size-4" />{t("job.cant_reach")}</Button></div>}
        </Card>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {has("cancel") && <Button variant="danger" size="sm" onClick={() => { setV({ reason: "" }); setM("cancel"); }}><Ban className="size-4" />{t("act.cancel_job")}</Button>}
        {has("report_no_work") && <Button variant="gold" size="sm" onClick={() => { setV({ note: "" }); setM("problem"); }}><TriangleAlert className="size-4" />{t("act.report_problem")}</Button>}
      </div>

      {!["offered", "rejected", "expired"].includes(j.status) && <div className="grid gap-4 lg:grid-cols-2"><JobChat offerId={id} closed={["completed", "cancelled", "replaced", "no_show"].includes(j.status)} /><Timeline events={tl.data?.items ?? []} /></div>}

      <Modal open={m === "cancel"} onClose={() => setM(null)} title={t("act.cancel_job")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.back")}</Button><Button variant="danger" loading={a.is("cn")} disabled={v.reason?.trim().length < 3} onClick={() => doIt("cn", () => post(`/offers/${id}/cancel`, { reason: v.reason }), "job.cancelled_ok")}>{t("act.cancel_job")}</Button></>}>
        {cat?.policy?.cancelPolicyEnabled && <Notice tone="warn" title={t("job.cancel_policy_title")}>{t("job.cancel_policy", { warn: cat.policy.cancelWarnAt, suspend: cat.policy.cancelSuspendAt, days: cat.policy.cancelWindowDays, sd: cat.policy.cancelSuspendDays })}</Notice>}
        <Textarea label={t("req.reason")} value={v.reason ?? ""} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </Modal>
      <Modal open={m === "delivered"} onClose={() => setM(null)} title={hasShip ? t("act.report_delivered") : t("act.finish_work")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.is("dl")} disabled={v.units === ""} onClick={() => doIt("dl", () => post(`/offers/${id}/delivered`, { units: Number(v.units) }), "job.delivered_ok")}>{t("common.submit")}</Button></>}>
        <Input label={t(hasShip ? "job.how_many_delivered" : "job.days_worked")} type="number" min={0} value={v.units ?? ""} onChange={(e) => setV({ ...v, units: e.target.value })} hint={hasShip ? t("job.delivered_hint", { n: j.loadedUnits ?? j.expectedUnits }) : undefined} autoFocus />
      </Modal>
      <Modal open={m === "noresponse"} onClose={() => setM(null)} title={t("job.cant_reach")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.is("nr")} onClick={() => doIt("nr", () => post(`/driver/jobs/${id}/contact-exception`, { reason: v.reason, note: v.note }), "job.reported_ok")}>{t("common.submit")}</Button></>}>
        <div className="flex flex-wrap gap-2">{["no_answer", "wrong_number", "refused", "other"].map((k) => <button key={k} aria-pressed={v.reason === k} onClick={() => setV({ ...v, reason: k })} className={cn("rounded-full border px-3 py-1.5 text-sm", v.reason === k ? "border-accent bg-accent/10 text-accent" : "border-line text-muted")}>{t(`contact_ex.${k}`)}</button>)}</div>
        <Textarea label={t("support.details")} value={v.note ?? ""} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </Modal>
      <Modal open={m === "problem"} onClose={() => setM(null)} title={t("act.report_problem")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.is("np")} onClick={() => doIt("np", () => post(`/offers/${id}/no-work`, { note: v.note }), "job.reported_ok")}>{t("common.submit")}</Button></>}>
        <Notice tone="info">{t("job.problem_note")}</Notice><Textarea label={t("support.details")} value={v.note ?? ""} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </Modal>
    </>
  );
}
