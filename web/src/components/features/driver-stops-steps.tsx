"use client";
import { useState, type ReactNode } from "react";
import { Flag, Hourglass, List, Map as MapIcon, PackageCheck, PackageOpen, Route, ShieldAlert, Undo2 } from "lucide-react";
import { Badge, Button, Card, Modal, Notice, Textarea } from "@/components/ui";
import { useDriverAction } from "./driver-action";
import { post } from "@/lib/api";
import { fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { RouteSummary, StopRouteInfo } from "./driver-route";
import { ReorderList, ReorderOff } from "./driver-reorder";
import { movableStops } from "./driver-fieldops-utils";
import { useRouteView, type RouteView } from "./driver-route-view";
import { ActionBar, RecipientBadge, Sheet, progressOf, type RouteInfo, type Stop, type StopsSummary } from "./driver-stops-shared";

/** The single "what to do now" card of the stages around the stop list (hand-over wait, acknowledge, review the route, finish). */
export function NextStepCard({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "gold" }) {
  const { t } = useI18n();
  return (
    <Card className={cn("space-y-4 border-2 p-4 sm:p-5", tone === "accent" ? "border-accent/50 bg-accent/5" : "border-gold/50 bg-gold/5")}>
      <p className={cn("text-xs font-semibold uppercase tracking-wider", tone === "accent" ? "text-accent" : "text-gold")}>{t("job.next_step")}</p>
      {children}
    </Card>
  );
}

export function WaitingHandover({ disputed }: { disputed: boolean }) {
  const { t } = useI18n();
  return (
    <NextStepCard tone="gold">
      <div className="flex items-start gap-3"><Hourglass className="mt-1 size-7 shrink-0 text-gold" aria-hidden /><div><p className="text-lg font-semibold">{t(disputed ? "job.hint_attendance_disputed" : "dstop.wait_handover")}</p>{!disputed && <p className="mt-1 text-sm text-muted">{t("dstop.wait_handover_hint")}</p>}</div></div>
    </NextStepCard>
  );
}

export function AckCard({ job, offerId, onDone }: { job: any; offerId: string; onDone: () => void }) {
  const { t, locale } = useI18n(); const a = useDriverAction();
  const [dispute, setDispute] = useState(false); const [note, setNote] = useState("");
  return (
    <NextStepCard>
      <div><p className="ltr-num text-5xl font-bold text-accent">{fmtNum(job.loadedUnits, locale)}</p><p className="mt-1 text-lg font-semibold">{t("dstop.handed_over", { n: job.loadedUnits })}</p></div>
      <p className="text-sm text-muted">{t("dstop.ack_hint")}</p>
      <ActionBar>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" className="h-14 text-base" loading={a.is("ack")} onClick={() => a.run("ack", () => post(`/offers/${offerId}/loading-ack`, { ok: true }), { success: "common.saved", onDone })}><PackageCheck className="size-5" aria-hidden />{t("act.ack_loading", { n: job.loadedUnits })}</Button>
          <Button size="lg" variant="danger" className="h-14 text-base" onClick={() => { setNote(""); setDispute(true); }}>{t("act.dispute_loading")}</Button>
        </div>
      </ActionBar>
      <Modal busy={a.is("dis")} open={dispute} onClose={() => setDispute(false)} title={t("job.dispute_title")} footer={<><Button variant="ghost" onClick={() => setDispute(false)}>{t("common.cancel")}</Button><Button variant="danger" loading={a.is("dis")} disabled={note.trim().length < 3} onClick={() => a.run("dis", () => post(`/offers/${offerId}/loading-ack`, { ok: false, note: note.trim() }), { success: "common.saved", onDone: () => { setDispute(false); onDone(); } })}>{t("act.dispute_loading")}</Button></>}>
        <Notice tone="info">{t("job.dispute_hint")}</Notice>
        <Textarea label={t("job.dispute_reason")} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} autoFocus />
      </Modal>
    </NextStepCard>
  );
}

/** "Approve route" while looking at the map (the list view carries its own button). */
export function RouteReviewBar({ offerId, onAdvanced, disabled = false }: { offerId: string; onAdvanced: (k: string) => void; disabled?: boolean }) {
  const { t } = useI18n(); const a = useDriverAction();
  return <ActionBar><Button data-testid="approve-route" size="lg" full className="h-14 text-lg" loading={a.is("appr")} disabled={disabled} onClick={() => a.run("appr", () => post(`/offers/${offerId}/route/approve`), { onDone: () => onAdvanced("dstop.route_approved_ok") })}><Route className="size-6" aria-hidden />{t("dstop.approve_route")}</Button></ActionBar>;
}

/** Routing on, before approval: the proposed BEST route (planned by the server, optionally re-optimised or re-ordered by the driver) to review, then approve. */
export function RouteReview({ job, stops, route, offerId, showType, onAdvanced, onJob, onRefresh }: { job: any; stops: Stop[]; route: RouteInfo | null; offerId: string; showType: boolean; onAdvanced: (k: string) => void; onJob?: (job: any) => void; onRefresh: () => void }) {
  const { t, locale } = useI18n();
  const [planning, setPlanning] = useState(false); // a re-plan is running: approving now would lock in the old order
  const reorderable = !!route?.canReorder && movableStops(stops).length >= 2;
  return (
    <div className="space-y-4">
      <NextStepCard>
        <div>
          <Badge tone="warn" className="whitespace-normal">{t("rdrv.proposed")}</Badge>
          <h2 data-testid="route-review-title" className="mt-2 text-xl font-bold">{t("rdrv.review_title", { n: fmtNum(stops.length, locale) })}</h2>
          <p className="mt-1 text-sm text-muted">{t("rdrv.review_hint")}</p>
        </div>
        <Notice tone="info" title={t("rdrv.review_note_title")}>{t("rdrv.review_note")}</Notice>
      </NextStepCard>
      {route && <RouteSummary route={route} stops={stops} offerId={offerId} approved={false} onJob={onJob} onRefresh={onRefresh} onBusyChange={setPlanning} />}
      <ReorderOff route={route} job={job} />
      {reorderable ? <ReorderList stops={stops} offerId={offerId} firstNo={1} onJob={onJob} onRefresh={onRefresh} /> : (
        <ol className="space-y-2">
          {stops.map((s, i) => (
            <li key={s.id} data-testid="route-stop" data-code={s.code} className="flex gap-3 rounded-card border border-line bg-card p-3">
              <span className="ltr-num flex size-9 shrink-0 items-center justify-center rounded-full bg-bg2 text-sm font-bold text-accent" aria-label={t("dstop.stop_x_of_n", { x: i + 1, n: stops.length })}>{i + 1}</span>
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <p className="font-medium">{s.address}{s.city && <span className="text-muted"> · {t(`city.${s.city}`)}</span>}</p>
                <StopRouteInfo stop={s} first={i === 0} hint />
                {s.contents && <p className="text-muted">{s.contents}</p>}
                {s.notes && <p className="text-xs text-gold">{s.notes}</p>}
                <div className="flex flex-wrap items-center gap-2 pt-0.5"><RecipientBadge type={s.recipientType} show={showType} /><span className="ltr-num text-xs text-muted">{s.code}</span></div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <RouteReviewBar offerId={offerId} onAdvanced={onAdvanced} disabled={planning} />
    </div>
  );
}

function ReturnHint({ n }: { n: number }) {
  const { t, locale } = useI18n();
  return <Notice tone="warn" title={t("dstop.return_title", { n: fmtNum(n, locale) })}>{t("fod.return_hint")}</Notice>;
}

/** Every stop is resolved: summary + the one big "Finish route" button (sticky at the bottom). A driver of an office is told nothing about earnings (`earningHidden`). */
export function FinishCard({ sum, offerId, earningHidden = false, onAdvanced }: { sum: StopsSummary; offerId: string; earningHidden?: boolean; onAdvanced: (k: string) => void }) {
  const { t, locale } = useI18n(); const a = useDriverAction();
  const p = progressOf(sum);
  return (
    <NextStepCard>
      <div><h2 className="text-xl font-bold">{t("dstop.all_done")}</h2><p className="mt-1 text-sm text-muted">{t(earningHidden ? "jd.finish_hint_office" : "fod.all_done_hint")}</p></div>
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="rounded-xl bg-bg2 p-3"><p className="ltr-num text-3xl font-bold text-accent">{fmtNum(p.delivered, locale)}</p><p className="text-xs text-muted">{t("shipstatus.delivered")}</p></div>
        <div className="rounded-xl bg-bg2 p-3"><p className={cn("ltr-num text-3xl font-bold", p.failed ? "text-danger" : "text-muted")}>{fmtNum(p.failed, locale)}</p><p className="text-xs text-muted">{t("dstop.not_delivered")}</p></div>
      </div>
      {sum.failed > 0 && <ReturnHint n={sum.failed} />}
      <ActionBar><Button data-testid="finish-route" size="lg" full className="h-14 text-lg" loading={a.is("fin")} onClick={() => a.run("fin", () => post(`/offers/${offerId}/delivered`, {}), { onDone: () => onAdvanced(earningHidden ? "jd.finish_ok_office" : "fod.finish_route_ok") })}><Flag className="size-6" aria-hidden />{t("dstop.finish_route")}</Button></ActionBar>
    </NextStepCard>
  );
}

const END_REASONS = ["breakdown", "health", "other"] as const;
/** "I can't finish the route" — ends it early (breakdown, health, other); the unfinished parcels go back to the warehouse. */
export function EndRoute({ offerId, remaining, onAdvanced }: { offerId: string; remaining: number; onAdvanced: (k: string) => void }) {
  const { t, locale } = useI18n(); const a = useDriverAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(""); const [note, setNote] = useState("");
  const ok = reason !== "" && (reason !== "other" || note.trim().length >= 3);
  return (
    <>
      <Button variant="ghost" size="lg" full className="border border-danger/40 text-danger" onClick={() => { setReason(""); setNote(""); setOpen(true); }}><ShieldAlert className="size-5" aria-hidden />{t("dstop.end_route")}</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("dstop.end_route")}>
        <Notice tone="danger" title={t("dstop.end_warn_title")}>{t("dstop.end_warn", { n: fmtNum(remaining, locale) })}</Notice>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">{t("dstop.end_reason")}</legend>
          {END_REASONS.map((r) => (
            <label key={r} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-accent/10">
              <input type="radio" name="end-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="size-5 shrink-0 accent-[var(--jr-accent)]" /><span className="font-medium">{t(`dstop.end_reason_${r}`)}</span>
            </label>
          ))}
        </fieldset>
        <Textarea label={t(reason === "other" ? "dstop.end_note_req" : "dstop.end_note")} value={note} maxLength={500} required={reason === "other"} onChange={(e) => setNote(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button variant="danger" size="lg" disabled={!ok} loading={a.is("end")} onClick={() => a.run("end", () => post(`/offers/${offerId}/end-route`, { reason, note: note.trim() || undefined }), { onDone: () => { setOpen(false); onAdvanced("dstop.route_ended_ok"); }, onError: () => setOpen(false) })}>{t("dstop.end_confirm")}</Button>
        </div>
      </Sheet>
    </>
  );
}

/** The job is over: how many were delivered / not delivered, and what goes back to the warehouse. */
export function PostRoute({ job, sum }: { job: any; sum: StopsSummary }) {
  const { t, locale } = useI18n();
  const p = progressOf(sum);
  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold"><PackageOpen className="size-5 text-accent" aria-hidden />{t("dstop.summary_title")}</h2>
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="rounded-xl bg-bg2 p-3"><p className="ltr-num text-3xl font-bold text-accent">{fmtNum(job.deliveredUnits ?? p.delivered, locale)}</p><p className="text-xs text-muted">{t("shipstatus.delivered")}</p></div>
        <div className="rounded-xl bg-bg2 p-3"><p className={cn("ltr-num text-3xl font-bold", p.failed ? "text-danger" : "text-muted")}>{fmtNum(p.failed, locale)}</p><p className="text-xs text-muted">{t("dstop.not_delivered")}</p></div>
      </div>
      {sum.failed > 0 && <ReturnHint n={sum.failed} />}
      {sum.returned > 0 && <p className="flex items-center gap-1.5 text-sm text-muted"><Undo2 className="size-4" aria-hidden />{t("dstop.returned_n", { n: fmtNum(sum.returned, locale) })}</p>}
    </Card>
  );
}

/** List | Map switch of the route stages (routing on). The choice is remembered on this device. */
export function ViewTabs({ view, onChange }: { view: RouteView; onChange: (v: RouteView) => void }) {
  const { t } = useI18n();
  const tab = (v: RouteView, icon: ReactNode, label: string) => (
    <button type="button" role="tab" data-testid={`${v}-view-tab`} aria-selected={view === v} onClick={() => onChange(v)}
      className={cn("flex min-h-12 items-center justify-center gap-2 rounded-lg px-3 text-base font-semibold transition", view === v ? "bg-accent text-accent-ink" : "text-muted hover:text-ink")}>{icon}{label}</button>
  );
  return <div role="tablist" aria-label={t("fod.view_label")} className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-bg2 p-1">{tab("list", <List className="size-5" aria-hidden />, t("fod.view_list"))}{tab("map", <MapIcon className="size-5" aria-hidden />, t("fod.view_map"))}</div>;
}

/** The route icon in the job page's header (routing on only): flips between the shipment list and the route map. */
export function RouteToggle() {
  const { t } = useI18n(); const [view, setView] = useRouteView();
  const map = view === "map";
  return (
    <button type="button" data-testid="job-route-toggle" aria-pressed={map} aria-label={t("fod.map_label")} title={t("fod.map_label")} onClick={() => setView(map ? "list" : "map")}
      className={cn("flex size-11 items-center justify-center rounded-xl border-2 transition", map ? "border-accent bg-accent text-accent-ink" : "border-line bg-bg2 text-cyan hover:border-accent/60")}><Route className="size-5" aria-hidden /></button>
  );
}
