"use client";
import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Check, CheckCircle2, Hourglass, MessageCircle, Navigation, PackageCheck, PhoneOff, Star, TriangleAlert, Wallet } from "lucide-react";
import { Button, Card, Checkbox, ErrorState, Input, KV, Modal, Notice, PageHeader, PageLoading, StatusBadge, Textarea } from "@/components/ui";
import { useDriverAction, friendlyErr } from "@/components/features/driver-action";
import { useApi } from "@/components/ui/data";
import { JobChat } from "@/components/features/chat";
import { Timeline } from "@/components/features/timeline";
import { ManifestFlow } from "@/components/features/driver-stops";
import { ArrivalCheckin } from "@/components/features/driver-arrival";
import { JobStatCards } from "@/components/features/driver-job-stats";
import { ApiError, get, post } from "@/lib/api";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

// Finishing the route completes the job at once (the delivery is auto-confirmed and paid), so there are no "reported" / "awaiting payment" steps any more.
const FLOW = ["accepted", "arrived", "attendance_confirmed", "completed"];
const LEGACY_WORKING = ["delivered_reported", "qty_disputed", "pending_settlement"]; // jobs that were already past "working" before the change

export default function DriverJob({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const router = useRouter();
  const { t, locale } = useI18n(); const a = useDriverAction();
  const { data: j, error, mutate } = useApi(`/driver/jobs/${id}`, { refreshInterval: 12000, revalidateOnFocus: true }) // refresh when the driver comes back from Maps / WhatsApp;
  const tl = useApi(`/offers/${id}/timeline`, { refreshInterval: 20000 }); const { data: cat } = useApi("/catalog");
  const [m, setM] = useState<null | "cancel" | "delivered" | "noresponse" | "problem" | "dispute" | "accept">(null); const [terms, setTerms] = useState(false); const [v, setV] = useState<any>({});
  const [rated, setRated] = useState<null | "done" | "already">(null); const [stars, setStars] = useState(5); const [comment, setComment] = useState(""); const [noWorkSent, setNoWorkSent] = useState(false);
  const hasCustody = !!j && !["offered", "rejected", "expired"].includes(j.status);
  const cu = useApi(hasCustody ? `/offers/${id}/custody` : null);
  // A failed background refresh (weak signal) must NOT replace the screen: it would unmount the stop form and lose what the driver typed.
  if (error && !j) return <ErrorState error={error} retry={() => mutate()} />;
  if (!j) return <PageLoading />;
  const done = () => { setM(null); setV({}); mutate(); tl.mutate(); };
  const doIt = (key: string, fn: () => Promise<unknown>, success = "common.saved", onError?: (e: unknown) => void) => a.run(key, fn, { success, onDone: done, onError });
  // the server rejects a billable quantity above the booked/loaded quantity and tells us the ceiling
  const maxOf = (e: unknown) => (e instanceof ApiError && e.code === "VALIDATION" && e.details.max != null ? Number(e.details.max) : null);
  const reportDelivered = () => doIt("dl", () => post(`/offers/${id}/delivered`, { units: Number(v.units) }), "job.delivered_ok", (e) => { const mx = maxOf(e); if (mx != null) setV((p: any) => ({ ...p, maxErr: mx })); });
  const reportNoWork = () => doIt("np", () => post(`/offers/${id}/no-work`, { note: v.note?.trim() || undefined }), "job.reported_ok", (e) => { if (e instanceof ApiError && e.code === "CONFLICT") { setNoWorkSent(true); setM(null); } });
  const submitRating = () => a.run("rate", () => post(`/offers/${id}/rate`, { stars, comment: comment.trim() || undefined }), {
    success: "job.rated_ok", onDone: () => setRated("done"),
    onError: (e) => { if (e instanceof ApiError && e.status === 409) setRated("already"); },
  });
  const ackItem = (itemId: string) => a.run(`cu${itemId}`, () => post(`/custody/${itemId}/acknowledge`), { success: "custody.acked_ok", onDone: () => cu.mutate() });
  const custody: any[] = cu.data?.items ?? [];
  const has = (x: string) => j.actions.includes(x);
  const step = LEGACY_WORKING.includes(j.status) ? FLOW.indexOf("attendance_confirmed") : FLOW.indexOf(j.status);
  const hasShip = j.service === "delivery_driver";
  const manifest = j.manifest === true; // per-parcel job: the whole hand-over → route → stop-by-stop flow is rendered by <ManifestFlow>, legacy jobs keep the count flow below
  const flowActive = manifest && j.status === "attendance_confirmed";
  const ackPending = j.status === "attendance_confirmed" && j.loadedUnits != null;
  const hintKey = ackPending && j.loadedAckByDriver == null ? "job.hint_attendance_confirmed_ack" : ackPending && j.loadedAckByDriver === false ? "job.hint_attendance_disputed" : `job.hint_${j.status}`;

  async function whatsapp(kind: string) {
    try { const r = await get(`/driver/jobs/${id}/whatsapp?kind=${kind}&lang=${locale}`); window.open(r.url, "_blank", "noopener"); } catch (e) { toast.error(e instanceof ApiError ? t("job.wa_unavailable") : friendlyErr(e, t)); }
  }
  const navTarget = manifest ? j.pickup : j.delivery; // per-parcel jobs have no single delivery address: navigation goes to the pickup, each stop has its own map link
  const mapsUrl = navTarget?.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${navTarget.lat},${navTarget.lng}` : navTarget?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(navTarget.address)}` : null;

  return (
    <>
      <Link href="/driver/jobs" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("nav.my_jobs")}</Link>
      <PageHeader title={`${t(`svc.${j.service}`)} · ${j.ref}`} subtitle={j.business ?? undefined} actions={<StatusBadge status={j.status} ns="jobstatus" />} />
      {error && <div className="mb-4"><Notice tone="warn">{t("ux.d_stale")} <button type="button" onClick={() => mutate()} className="min-h-11 font-semibold text-cyan underline">{t("common.retry")}</button></Notice></div>}
      {step >= 0 && <ol className="mb-6 flex gap-1" aria-label={t("a11y.progress")}>{FLOW.map((s, i) => <li key={s} className="flex-1" aria-current={i === step ? "step" : undefined}><div className={cn("h-1.5 rounded-full", i <= step ? "bg-accent" : "bg-line")} /><p className={cn("mt-1 text-xs", i === step ? "block font-semibold text-accent" : "hidden text-muted sm:block")}>{t(`jobstatus.${s}`)}</p></li>)}</ol>}

      {manifest && j.allowPartial === false && ["offered", "accepted", "arrived"].includes(j.status) && <div className="mb-5"><Notice tone="warn">{t("dstop.all_or_nothing")}</Notice></div>}

      {/* E13 — stat cards, outside the stop panels */}
      {manifest && !["offered", "rejected", "expired"].includes(j.status) && <JobStatCards job={j} />}

      {/* E16/E18 — the job is over: the delivery was confirmed and the earnings paid automatically */}
      {j.status === "completed" && (
        <Card data-testid="job-completed" className="mb-5 space-y-3 border-2 border-accent/50 bg-accent/5">
          <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-8 shrink-0 text-accent" aria-hidden /><div><h2 className="text-xl font-bold">{t("fod.job_completed_title")}</h2><p className="mt-1 text-sm text-muted">{t(j.earningHidden ? "fod.job_completed_office" : "fod.job_completed_body")}</p></div></div>
          {!j.earningHidden && <Link href="/driver/wallet" data-testid="job-completed-wallet" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-bg2 px-6 font-semibold hover:border-accent/60"><Wallet className="size-5" aria-hidden />{t("fod.go_wallet")}</Link>}
        </Card>
      )}

      {/* Next step — one clear thing to do */}
      {!flowActive && j.status !== "completed" && <Card className="mb-5 border-2 border-accent/50 bg-accent/5">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent">{t("job.next_step")}</p>
        <p className="mb-4 flex items-start gap-2 text-lg font-semibold">{manifest && j.status === "arrived" && <Hourglass className="mt-1 size-5 shrink-0 text-gold" aria-hidden />}<span data-testid="job-hint">{t(manifest && j.status === "arrived" ? "fod.wait_confirm_arrival" : hintKey)}</span></p>
        <div className="flex flex-wrap gap-2">
          {has("accept") && <Button size="lg" onClick={() => { setTerms(false); setM("accept"); }}>{t("act.accept")}</Button>}
          {has("reject") && <Button size="lg" variant="secondary" loading={a.is("rj")} onClick={() => a.run("rj", () => post(`/offers/${id}/reject`), { success: "common.saved", onDone: () => router.push("/driver/jobs") })}>{t("act.decline")}</Button>}
          {has("checkin") && mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-bg2 px-6 text-base font-semibold hover:border-accent/60"><Navigation className="size-5 rtl:-scale-x-100" aria-hidden />{t(manifest ? "dstop.navigate_pickup" : "job.navigate")}</a>}
          {has("checkin") && <ArrivalCheckin job={j} offerId={id} onDone={() => { void mutate(); void tl.mutate(); }} />}
          {has("ack_loading") && <Button size="lg" loading={a.is("ack")} onClick={() => doIt("ack", () => post(`/offers/${id}/loading-ack`, { ok: true }))}>{t("act.ack_loading", { n: j.loadedUnits })}</Button>}
          {has("dispute_loading") && <Button size="lg" variant="danger" onClick={() => { setV({ reason: "" }); setM("dispute"); }}>{t("act.dispute_loading")}</Button>}
          {has("report_delivered") && <Button size="lg" onClick={() => { setV({ units: String(j.loadedUnits ?? j.expectedUnits) }); setM("delivered"); }}><PackageCheck className="size-5" />{hasShip ? t("act.report_delivered") : t("act.finish_work")}</Button>}
        </div>
      </Card>}

      {manifest && <div className="mb-5"><ManifestFlow job={j} offerId={id} onRefresh={async () => { await mutate(); tl.mutate(); }} onJob={(fresh) => { void mutate(fresh, { revalidate: false }); void tl.mutate(); }} /></div>}

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card><h3 className="mb-2 font-semibold">{t("job.details")}</h3><dl className="divide-y divide-line">
          <KV label={t("req.starts")}>{fmtDateTime(j.startsAt, locale)}</KV>
          {j.vehicleType && <KV label={t("wizard.vehicle")}>{t(`vehicle.${j.vehicleType}`)}{j.temperature ? ` · ${t(`temp.${j.temperature}`)}` : ""}</KV>}
          <KV label={t(hasShip ? "units.exp" : "wizard.days")}>{fmtNum(j.expectedUnits, locale)}</KV>
          {hasShip && <><KV label={t("units.loaded")}>{j.loadedUnits ?? "—"}</KV><KV label={t("units.delivered")}>{j.deliveredUnits ?? "—"}</KV></>}
          {j.finalUnits != null && <KV label={t("units.final")}>{j.finalUnits}</KV>}
          {j.expectedEarningCents != null && <KV label={t("job.expected_earning")}><span className="ltr-num text-accent">{fmtMoney(j.expectedEarningCents, locale)}</span></KV>}
          {j.contents && <KV label={t("wizard.contents")}>{j.contents}</KV>}{j.notes && <KV label={t("wizard.notes")}>{j.notes}</KV>}
          {j.cancelReason && <KV label={t("req.reason")}>{j.cancelReason}</KV>}
        </dl></Card>
        <Card className="space-y-3"><h3 className="font-semibold">{t("job.locations")}</h3>
          {j.pickup || j.delivery ? <>
            <div className="rounded-xl bg-bg2 p-3"><p className="text-xs text-muted">{t("wizard.pickup_address")}</p><p className="text-sm font-medium">{j.pickup?.address ?? "—"}</p></div>
            {manifest
              ? <div className="rounded-xl bg-bg2 p-3"><p className="text-xs text-muted">{t("dstop.stops_label")}</p><p className="text-sm font-medium">{t("dstop.n_stops_in", { n: fmtNum(j.stopsSummary?.total ?? j.expectedUnits, locale), city: t(`city.${j.deliveryCity}`) })}</p><p className="mt-1 text-xs text-muted">{t("dstop.stops_privacy")}</p></div>
              : <div className="rounded-xl bg-bg2 p-3"><p className="text-xs text-muted">{t("wizard.delivery_address")}</p><p className="text-sm font-medium">{j.delivery?.address ?? "—"}</p></div>}
            {mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer"><Button variant="secondary" full><Navigation className="size-4" />{t(manifest ? "dstop.navigate_pickup" : "job.navigate")}</Button></a>}
          </> : <Notice tone="info">{t(j.status === "offered" ? "job.locked_until_accept" : "job.details_hidden")}</Notice>}
          {j.recipient && <div className="space-y-2 border-t border-line pt-3"><p className="text-xs text-muted">{t("job.recipient")}</p><p className="font-medium">{j.recipient.name} <span className="ltr-num text-sm text-muted">{j.recipient.phone}</span></p>
            <div className="grid grid-cols-3 gap-2">{(["contact", "arriving", "issue"] as const).map((k) => <Button key={k} size="sm" variant="secondary" className="h-11" onClick={() => whatsapp(k)}><MessageCircle className="size-4" /><span className="truncate">{t(`wa.${k}`)}</span></Button>)}</div>
            <p className="text-[11px] text-muted">{t("job.wa_note")}</p>
            <Button size="sm" variant="ghost" className="h-11" onClick={() => { setV({ reason: "no_answer" }); setM("noresponse"); }}><PhoneOff className="size-4" />{t("job.cant_reach")}</Button></div>}
        </Card>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {has("cancel") && <Button variant="danger" size="sm" className="h-11" onClick={() => { setV({ reason: "" }); setM("cancel"); }}><Ban className="size-4" />{t("act.cancel_job")}</Button>}
        {has("report_no_work") && !noWorkSent && <Button variant="gold" size="sm" className="h-11" onClick={() => { setV({ note: "" }); setM("problem"); }}><TriangleAlert className="size-4" />{t("act.report_problem")}</Button>}
      </div>
      {noWorkSent && <div className="mb-5"><Notice tone="info">{t("job.no_work_already")}</Notice></div>}

      {custody.length > 0 && (
        <Card className="mb-5 space-y-3">
          <h3 className="font-semibold">{t("custody.title")}</h3>
          <ul className="divide-y divide-line">
            {custody.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div><p className="font-medium">{t(`custody.${c.itemType}`)} <span className="ltr-num text-muted">× {fmtNum(c.qty, locale)}</span></p>{c.description && <p className="text-xs text-muted">{c.description}</p>}</div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={c.status} />
                  {c.status === "handed_over" && <Button size="sm" className="h-11" loading={a.is(`cu${c.id}`)} onClick={() => ackItem(c.id)}><Check className="size-4" />{t("custody.ack")}</Button>}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{t("custody.return_note")}</p>
        </Card>
      )}

      {j.status === "completed" && rated !== "already" && (
        <Card className="mb-5 space-y-3">
          <h3 className="font-semibold">{t("job.rate_title")}</h3>
          {rated === "done" ? <Notice tone="success">{t("job.rated_ok")}</Notice> : <>
            <p className="text-sm text-muted">{t("job.rate_hint")}</p>
            <div className="flex gap-1" role="radiogroup" aria-label={t("job.rate_title")}>{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={t("rate.star", { n })} onClick={() => setStars(n)} className="p-1"><Star className={cn("size-9", n <= stars ? "fill-gold text-gold" : "text-line")} /></button>)}</div>
            <Textarea label={t("rate.comment")} value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} />
            <Button loading={a.is("rate")} onClick={submitRating}>{t("common.submit")}</Button>
          </>}
        </Card>
      )}
      {j.status === "completed" && rated === "already" && <div className="mb-5"><Notice tone="info">{t("job.rated_already")}</Notice></div>}

      {!["offered", "rejected", "expired"].includes(j.status) && <div className="grid gap-4 lg:grid-cols-2"><JobChat offerId={id} closed={["completed", "cancelled", "replaced", "no_show"].includes(j.status)} /><Timeline events={tl.data?.items ?? []} /></div>}

      <Modal open={m === "accept"} onClose={() => setM(null)} title={t("opp.terms_title")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button disabled={!terms} loading={a.is("acc")} onClick={() => a.run("acc", () => post(`/offers/${id}/accept`, { termsAccepted: terms }), { success: "driver.accepted_ok", onDone: () => { setM(null); void mutate(); void tl.mutate(); }, onError: () => { void mutate(); } })}>{t("act.accept_job")}</Button></>}>
        <div className="max-h-40 overflow-y-auto rounded-xl bg-bg2 p-3 text-xs leading-relaxed text-muted">{cat?.terms?.driver || t("opp.terms_default")}</div>
        <Checkbox checked={terms} onChange={(e) => setTerms(e.target.checked)} label={t("opp.terms_accept")} />
      </Modal>
      <Modal open={m === "cancel"} onClose={() => setM(null)} title={t("act.cancel_job")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.back")}</Button><Button variant="danger" loading={a.is("cn")} disabled={v.reason?.trim().length < 3} onClick={() => doIt("cn", () => post(`/offers/${id}/cancel`, { reason: v.reason }), "job.cancelled_ok")}>{t("act.cancel_job")}</Button></>}>
        {cat?.policy?.cancelPolicyEnabled && <Notice tone="warn" title={t("job.cancel_policy_title")}>{t("job.cancel_policy", { warn: cat.policy.cancelWarnAt, suspend: cat.policy.cancelSuspendAt, days: cat.policy.cancelWindowDays, sd: cat.policy.cancelSuspendDays })}</Notice>}
        <Textarea label={t("req.reason")} value={v.reason ?? ""} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </Modal>
      <Modal open={m === "delivered"} onClose={() => setM(null)} title={hasShip ? t("act.report_delivered") : t("act.finish_work")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.is("dl")} disabled={v.units === "" || v.units == null} onClick={reportDelivered}>{t("common.submit")}</Button></>}>
        <Input label={t(hasShip ? "job.how_many_delivered" : "job.days_worked")} type="number" inputMode="numeric" min={0} value={v.units ?? ""} onChange={(e) => setV({ ...v, units: e.target.value, maxErr: undefined })} error={v.maxErr != null ? t("job.max_units", { max: v.maxErr }) : undefined} hint={hasShip ? t("job.delivered_hint", { n: j.loadedUnits ?? j.expectedUnits }) : undefined} autoFocus />
      </Modal>
      <Modal open={m === "dispute"} onClose={() => setM(null)} title={t("job.dispute_title")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button variant="danger" loading={a.is("dis")} disabled={(v.reason ?? "").trim().length < 3} onClick={() => doIt("dis", () => post(`/offers/${id}/loading-ack`, { ok: false, note: v.reason.trim() }))}>{t("act.dispute_loading")}</Button></>}>
        <Notice tone="info">{t("job.dispute_hint")}</Notice>
        <Textarea label={t("job.dispute_reason")} value={v.reason ?? ""} maxLength={300} onChange={(e) => setV({ ...v, reason: e.target.value })} autoFocus />
      </Modal>
      <Modal open={m === "noresponse"} onClose={() => setM(null)} title={t("job.cant_reach")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.is("nr")} onClick={() => doIt("nr", () => post(`/driver/jobs/${id}/contact-exception`, { reason: v.reason, note: v.note }), "job.reported_ok")}>{t("common.submit")}</Button></>}>
        <div className="flex flex-wrap gap-2">{["no_answer", "wrong_number", "refused", "other"].map((k) => <button key={k} aria-pressed={v.reason === k} onClick={() => setV({ ...v, reason: k })} className={cn("rounded-full border px-3 py-1.5 text-sm", v.reason === k ? "border-accent bg-accent/10 text-accent" : "border-line text-muted")}>{t(`contact_ex.${k}`)}</button>)}</div>
        <Textarea label={t("support.details")} value={v.note ?? ""} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </Modal>
      <Modal open={m === "problem"} onClose={() => setM(null)} title={t("act.report_problem")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.is("np")} onClick={reportNoWork}>{t("common.submit")}</Button></>}>
        <Notice tone="info">{t("job.problem_note")}</Notice><Textarea label={t("support.details")} value={v.note ?? ""} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </Modal>
    </>
  );
}
