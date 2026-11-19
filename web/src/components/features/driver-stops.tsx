"use client";
import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Flag, Hourglass, List, Map as MapIcon, PackageCheck, PackageOpen, Route, ShieldAlert, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, Modal, Notice, Textarea } from "@/components/ui";
import { useDriverAction } from "./driver-action";
import { post } from "@/lib/api";
import { fmtNum, fmtTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { CurrentStop } from "./driver-stops-current";
import { RouteSummary, StopRouteInfo } from "./driver-route";
import { LoadingScan, LoadingWaiting } from "./driver-loading";
import { ReorderList, ReorderOff, ReorderSection } from "./driver-reorder";
import { RouteMapPanel } from "./route-map-panel";
import { loadingOf, movableStops, policyOf } from "./driver-fieldops-utils";
import { ActionBar, RecipientBadge, Sheet, isFailedStop, isOpenStop, orderStops, progressOf, type RouteInfo, type Stop, type StopsSummary } from "./driver-stops-shared";

const POST_STATUSES = ["delivered_reported", "qty_disputed", "pending_settlement", "completed"];

function Progress({ sum }: { sum: StopsSummary }) {
  const { t, locale } = useI18n();
  const p = progressOf(sum);
  const pct = (n: number) => `${p.total ? (n / p.total) * 100 : 0}%`;
  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm font-semibold">
        <span className="text-accent">{t("dstop.prog_delivered", { n: fmtNum(p.delivered, locale) })}</span>
        <span className={p.failed ? "text-danger" : "text-muted"}>{t("dstop.prog_failed", { n: fmtNum(p.failed, locale) })}</span>
        <span className="text-ink">{t("dstop.prog_remaining", { n: fmtNum(p.remaining, locale) })}</span>
      </div>
      <div role="progressbar" aria-label={t("a11y.progress")} aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done} className="flex h-3 overflow-hidden rounded-full bg-line">
        <div className="bg-accent" style={{ width: pct(p.delivered) }} /><div className="bg-danger" style={{ width: pct(p.failed) }} />
      </div>
    </Card>
  );
}

function Section({ title, n, children }: { title: string; n: number; children: ReactNode }) {
  const { locale } = useI18n();
  return (
    <details className="group rounded-card border border-line bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">{title}<Badge>{fmtNum(n, locale)}</Badge></span><ChevronDown className="size-5 text-muted transition group-open:rotate-180" aria-hidden />
      </summary>
      {n > 0 && <ul className="divide-y divide-line border-t border-line">{children}</ul>}
    </details>
  );
}

/** Read-only "Upcoming" and "Done" lists (collapsed by default). Upcoming stops are numbered by their place in the route (the finished stops and the current one come first). */
export function StopsOverview({ stops, hideUpcoming = false }: { stops: Stop[]; hideUpcoming?: boolean }) {
  const { t, locale } = useI18n();
  const upcoming = stops.filter((s) => isOpenStop(s) && !s.current);
  const done = stops.filter((s) => s.status === "delivered" || isFailedStop(s));
  const firstNo = done.length + (stops.some((s) => s.current) ? 2 : 1);
  return (
    <div className="space-y-3">
      {!hideUpcoming && <Section title={t("dstop.upcoming")} n={upcoming.length}>
        {upcoming.map((s, i) => (
          <li key={s.id} data-testid="route-stop" data-code={s.code} className="flex items-start gap-3 px-4 py-3 text-sm">
            <span className="ltr-num mt-0.5 min-w-8 text-xs font-bold text-muted" aria-label={t("dstop.stop_x_of_n", { x: firstNo + i, n: stops.length })}>#{firstNo + i}</span>
            <div className="min-w-0 flex-1 space-y-1"><p>{s.address}<span className="ltr-num ms-2 text-xs text-muted">{s.code}</span></p><StopRouteInfo stop={s} /></div>
          </li>
        ))}
      </Section>}
      <Section title={t("dstop.done")} n={done.length}>
        {done.map((s) => {
          const ok = s.status === "delivered";
          return (
            <li key={s.id} className="flex items-start gap-3 px-4 py-3 text-sm">
              {ok ? <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-label={t("shipstatus.delivered")} /> : <X className="mt-0.5 size-4 shrink-0 text-danger" aria-label={t("shipstatus.failed")} />}
              <span className="min-w-0 flex-1">
                <span className="block"><span className="ltr-num me-2 text-xs font-bold text-muted">#{s.seq}</span>{s.address}</span>
                <span className={cn("block text-xs", ok ? "text-muted" : "text-danger")}>
                  {ok ? `${s.deliveredAt ? fmtTime(s.deliveredAt, locale) + " · " : ""}${t(s.hasProof ? "dstop.proof_receipt" : "dstop.proof_otp")}` : `${s.failReason ? t(`stopfail.${s.failReason}`) : t("shipstatus.failed")}${s.status === "returned" ? ` · ${t("shipstatus.returned")}` : ""}`}
                </span>
              </span>
            </li>
          );
        })}
      </Section>
    </div>
  );
}

function NextStepCard({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "gold" }) {
  const { t } = useI18n();
  return (
    <Card className={cn("space-y-4 border-2 p-4 sm:p-5", tone === "accent" ? "border-accent/50 bg-accent/5" : "border-gold/50 bg-gold/5")}>
      <p className={cn("text-xs font-semibold uppercase tracking-wider", tone === "accent" ? "text-accent" : "text-gold")}>{t("job.next_step")}</p>
      {children}
    </Card>
  );
}

function WaitingHandover({ disputed }: { disputed: boolean }) {
  const { t } = useI18n();
  return (
    <NextStepCard tone="gold">
      <div className="flex items-start gap-3"><Hourglass className="mt-1 size-7 shrink-0 text-gold" aria-hidden /><div><p className="text-lg font-semibold">{t(disputed ? "job.hint_attendance_disputed" : "dstop.wait_handover")}</p>{!disputed && <p className="mt-1 text-sm text-muted">{t("dstop.wait_handover_hint")}</p>}</div></div>
    </NextStepCard>
  );
}

function AckCard({ job, offerId, onDone }: { job: any; offerId: string; onDone: () => void }) {
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
      <Modal open={dispute} onClose={() => setDispute(false)} title={t("job.dispute_title")} footer={<><Button variant="ghost" onClick={() => setDispute(false)}>{t("common.cancel")}</Button><Button variant="danger" loading={a.is("dis")} disabled={note.trim().length < 3} onClick={() => a.run("dis", () => post(`/offers/${offerId}/loading-ack`, { ok: false, note: note.trim() }), { success: "common.saved", onDone: () => { setDispute(false); onDone(); } })}>{t("act.dispute_loading")}</Button></>}>
        <Notice tone="info">{t("job.dispute_hint")}</Notice>
        <Textarea label={t("job.dispute_reason")} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} autoFocus />
      </Modal>
    </NextStepCard>
  );
}

/** Before approval: the proposed BEST route (planned by the server, optionally re-optimised or re-ordered by the driver) to review, then approve. */
function RouteReview({ job, stops, route, offerId, onAdvanced, onJob, onRefresh }: { job: any; stops: Stop[]; route: RouteInfo | null; offerId: string; onAdvanced: (k: string) => void; onJob?: (job: any) => void; onRefresh: () => void }) {
  const { t, locale } = useI18n(); const a = useDriverAction();
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
                <div className="flex flex-wrap items-center gap-2 pt-0.5"><RecipientBadge type={s.recipientType} /><span className="ltr-num text-xs text-muted">{s.code}</span></div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <ActionBar><Button data-testid="approve-route" size="lg" full className="h-14 text-lg" loading={a.is("appr")} disabled={planning} onClick={() => a.run("appr", () => post(`/offers/${offerId}/route/approve`), { onDone: () => onAdvanced("dstop.route_approved_ok") })}><Route className="size-6" aria-hidden />{t("dstop.approve_route")}</Button></ActionBar>
    </div>
  );
}

function ReturnHint({ n }: { n: number }) {
  const { t, locale } = useI18n();
  return <Notice tone="warn" title={t("dstop.return_title", { n: fmtNum(n, locale) })}>{t("fod.return_hint")}</Notice>;
}

function FinishCard({ sum, offerId, onAdvanced }: { sum: StopsSummary; offerId: string; onAdvanced: (k: string) => void }) {
  const { t, locale } = useI18n(); const a = useDriverAction();
  const p = progressOf(sum);
  return (
    <NextStepCard>
      <div><h2 className="text-xl font-bold">{t("dstop.all_done")}</h2><p className="mt-1 text-sm text-muted">{t("fod.all_done_hint")}</p></div>
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="rounded-xl bg-bg2 p-3"><p className="ltr-num text-3xl font-bold text-accent">{fmtNum(p.delivered, locale)}</p><p className="text-xs text-muted">{t("shipstatus.delivered")}</p></div>
        <div className="rounded-xl bg-bg2 p-3"><p className={cn("ltr-num text-3xl font-bold", p.failed ? "text-danger" : "text-muted")}>{fmtNum(p.failed, locale)}</p><p className="text-xs text-muted">{t("dstop.not_delivered")}</p></div>
      </div>
      {sum.failed > 0 && <ReturnHint n={sum.failed} />}
      <ActionBar><Button data-testid="finish-route" size="lg" full className="h-14 text-lg" loading={a.is("fin")} onClick={() => a.run("fin", () => post(`/offers/${offerId}/delivered`, {}), { onDone: () => onAdvanced("fod.finish_route_ok") })}><Flag className="size-6" aria-hidden />{t("dstop.finish_route")}</Button></ActionBar>
    </NextStepCard>
  );
}

const END_REASONS = ["breakdown", "health", "other"] as const;
function EndRoute({ offerId, remaining, onAdvanced }: { offerId: string; remaining: number; onAdvanced: (k: string) => void }) {
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

function PostRoute({ job, sum }: { job: any; sum: StopsSummary }) {
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

const VIEW_KEY = "jr.driver.routeView";
const readView = (): "list" | "map" => { try { return localStorage.getItem(VIEW_KEY) === "map" ? "map" : "list"; } catch { return "list"; } };

/** List | Map switch of the route stages. The choice is remembered on this device. */
function ViewTabs({ view, onChange }: { view: "list" | "map"; onChange: (v: "list" | "map") => void }) {
  const { t } = useI18n();
  const tab = (v: "list" | "map", icon: ReactNode, label: string) => (
    <button type="button" role="tab" data-testid={`${v}-view-tab`} aria-selected={view === v} onClick={() => onChange(v)}
      className={cn("flex min-h-12 items-center justify-center gap-2 rounded-lg px-3 text-base font-semibold transition", view === v ? "bg-accent text-accent-ink" : "text-muted hover:text-ink")}>{icon}{label}</button>
  );
  return <div role="tablist" aria-label={t("fod.view_label")} className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-bg2 p-1">{tab("list", <List className="size-5" aria-hidden />, t("fod.view_list"))}{tab("map", <MapIcon className="size-5" aria-hidden />, t("fod.view_map"))}</div>;
}

/**
 * The whole driver experience for a per-parcel (`manifest: true`) job, rendered from the server's `actions[]` / `stops[]` / `stopsSummary`.
 * Statuses before hand-over (accepted, arrived) stay with the page's generic "next step" card.
 */
export function ManifestFlow({ job, offerId, onRefresh, onJob }: { job: any; offerId: string; onRefresh: () => unknown; onJob?: (job: any) => void }) {
  const { t } = useI18n();
  const [view, setViewState] = useState<"list" | "map">(readView);
  const setView = (v: "list" | "map") => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };
  const has = (x: string) => (job.actions as string[]).includes(x);
  const stops = orderStops((job.stops ?? []) as Stop[]);
  const sum = job.stopsSummary as StopsSummary | null;
  const route = (job.route ?? null) as RouteInfo | null;
  const policy = policyOf(job);
  const refresh = () => { void onRefresh(); };
  // After any step the next stop becomes current: refresh, confirm briefly, and bring the new stop into view.
  const advanced = (k: string) => { toast.success(t(k)); window.scrollTo({ top: 0, behavior: "smooth" }); void onRefresh(); };

  if (job.status === "attendance_confirmed") {
    // E3: the driver scans the parcels onto the vehicle (the warehouse records nothing)
    if (has("scan_loading") || has("finish_loading")) return <LoadingScan job={job} offerId={offerId} stops={stops} canFinish={has("finish_loading")} onJob={onJob} onRefresh={onRefresh} />;
    if (has("ack_loading")) return <AckCard job={job} offerId={offerId} onDone={refresh} />;
    const routeStage = has("approve_route") || has("work_stops") || (has("report_delivered") && !!sum);
    if (routeStage) {
      const p = sum ? progressOf(sum) : null;
      const body = has("approve_route")
        ? <RouteReview job={job} stops={stops} route={route} offerId={offerId} onAdvanced={advanced} onJob={onJob} onRefresh={refresh} />
        : has("work_stops") && sum && p ? (() => {
            const cur = stops.find((s) => s.current);
            const reorderable = !!route?.canReorder && movableStops(stops).length >= 2;
            return (
              <div className="space-y-4">
                {cur ? <CurrentStop key={cur.id} stop={cur} offerId={offerId} policy={policy} position={p.done + 1} total={p.total} onAdvanced={advanced} onRefresh={refresh} />
                  : <Notice tone="info">{t("dstop.syncing")}</Notice>}
                {route && <RouteSummary route={route} stops={stops} offerId={offerId} approved onJob={onJob} onRefresh={refresh} />}
                <ReorderOff route={route} job={job} />
                {reorderable && <ReorderSection stops={stops} offerId={offerId} onJob={onJob} onRefresh={refresh} />}
                <StopsOverview stops={stops} hideUpcoming={reorderable} />
                {has("end_route") && <EndRoute offerId={offerId} remaining={p.remaining} onAdvanced={advanced} />}
              </div>
            );
          })()
        : sum ? <FinishCard sum={sum} offerId={offerId} onAdvanced={advanced} /> : null;
      const showMap = view === "map" && stops.length > 0 && !has("report_delivered");
      return (
        <div className="space-y-4">
          {!has("report_delivered") && stops.length > 0 && <ViewTabs view={view} onChange={setView} />}
          {sum && (has("work_stops") || has("report_delivered")) && <Progress sum={sum} />}
          {showMap
            ? <RouteMapPanel stops={stops} route={route} offerId={offerId} policy={policy} onAdvanced={advanced} onJob={onJob} onRefresh={refresh} />
            : <>{body}{has("report_delivered") && sum && <StopsOverview stops={stops} />}</>}
          {showMap && has("approve_route") && <RouteReviewBar offerId={offerId} onAdvanced={advanced} />}
          {showMap && has("work_stops") && has("end_route") && p && <EndRoute offerId={offerId} remaining={p.remaining} onAdvanced={advanced} />}
        </div>
      );
    }
    // Only the warehouse-hand-over mode ever waits on the warehouse: in scan mode there is nothing to wait for.
    if (loadingOf(job).mode === "driver_scan") return <LoadingWaiting />;
    return <WaitingHandover disputed={job.loadedAckByDriver === false} />;
  }
  if (POST_STATUSES.includes(job.status) && sum && sum.total > 0) return <div className="space-y-4"><PostRoute job={job} sum={sum} /><StopsOverview stops={stops} /></div>;
  return null;
}

/** "Approve route" while looking at the map (the list view carries its own button). */
function RouteReviewBar({ offerId, onAdvanced }: { offerId: string; onAdvanced: (k: string) => void }) {
  const { t } = useI18n(); const a = useDriverAction();
  return <ActionBar><Button data-testid="approve-route" size="lg" full className="h-14 text-lg" loading={a.is("appr")} onClick={() => a.run("appr", () => post(`/offers/${offerId}/route/approve`), { onDone: () => onAdvanced("dstop.route_approved_ok") })}><Route className="size-6" aria-hidden />{t("dstop.approve_route")}</Button></ActionBar>;
}
