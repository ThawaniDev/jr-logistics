"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRightCircle, CheckCircle2, Clock, HandCoins, Lock, LocateFixed, MapPin, MessageCircle, Navigation, Phone, TriangleAlert, XCircle } from "lucide-react";
import { Badge, Button, Notice } from "@/components/ui";
import { useDriverAction } from "./driver-action";
import { useI18n } from "@/i18n/provider";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { StopRouteInfo } from "./driver-route";
import { DeferForm, DeliverForm, FailForm, arriveRequest } from "./driver-stop-forms";
import { codDueCents, needsOtpOf, type PolicyInfo } from "./driver-fieldops-utils";
import { statusChip, type ShipAccess } from "./driver-shipments-lib";
import { RecipientBadge, Sheet, mapsUrl, mmss, openWhatsApp, useCountdown, type Stop } from "./driver-stops-shared";

function WaitNote({ sec }: { sec: number }) {
  const { t } = useI18n();
  const { remaining } = useCountdown(sec);
  if (remaining <= 0) return null;
  return <p className="flex items-center gap-1.5 text-sm text-gold" role="timer" aria-live="off"><Clock className="size-4" aria-hidden /><span className="ltr-num">{t("dstop.wait_note", { time: mmss(remaining) })}</span></p>;
}

/** What happened to a finished stop: delivered (when, with what proof) or not delivered (why). */
function Outcome({ stop }: { stop: Stop }) {
  const { t, locale } = useI18n();
  const ok = stop.status === "delivered";
  return (
    <div data-testid="stop-outcome" className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${ok ? "border-accent/40 bg-accent/10 text-accent" : "border-danger/40 bg-danger/10 text-danger"}`}>
      {ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 size-5 shrink-0" aria-hidden />}
      <p className="font-medium">
        {ok ? `${t("shipstatus.delivered")}${stop.deliveredAt ? ` · ${fmtDateTime(stop.deliveredAt, locale)}` : ""} · ${t(stop.hasProof ? "dstop.proof_receipt" : "dstop.proof_otp")}`
          : `${stop.failReason ? t(`stopfail.${stop.failReason}`) : t(`shipstatus.${stop.status}`)}${stop.failNote ? ` — ${stop.failNote}` : ""}`}
      </p>
    </div>
  );
}

/**
 * Everything about ONE shipment, in the sheet that opens from its card: who and where, how to reach the recipient, and — for a stop the driver may act on
 * right now — arrive, deliver (code, cash, signature), can't deliver and postpone. `access`: "act" (actions), "locked" (routing on, not the current stop:
 * read-only + navigate), "done" (finished: the outcome). `position`/`total` are only given while routing is on ("Stop 3 of 12").
 */
export function StopPanel({ stop, offerId, policy, access, routing, showType, position, total, onAdvanced, onRefresh }: {
  stop: Stop; offerId: string; policy: PolicyInfo; access: ShipAccess; routing: boolean; showType: boolean; position?: number; total?: number; onAdvanced: (msgKey: string) => void; onRefresh: () => void;
}) {
  const { t, locale } = useI18n(); const a = useDriverAction();
  const headRef = useRef<HTMLHeadingElement>(null);
  const [failOpen, setFailOpen] = useState(false); const [deferOpen, setDeferOpen] = useState(false);
  const arrived = !!stop.arrivedAt; const cod = codDueCents(stop); const act = access === "act"; const chip = statusChip(stop);
  useEffect(() => { headRef.current?.focus({ preventScroll: true }); }, []);

  const arrive = () => a.run("arrive", () => arriveRequest(offerId, stop.id), { success: "dstop.arrived_ok", onDone: () => onRefresh() });
  const next = !arrived ? "ux.d_next_go" : !needsOtpOf(stop) ? "fod.next_here_scan" : stop.recipientType === "business" ? "ux.d_next_here_biz" : "ux.d_next_here";

  return (
    <section aria-labelledby={`stop-${stop.id}`} className="space-y-4" data-testid={act ? "current-stop" : "stop-detail"} data-code={stop.code} data-access={access}>
      <div>
        {position != null && total != null && <p className="text-sm font-bold uppercase tracking-wider text-accent"><span className="ltr-num">{t("dstop.stop_x_of_n", { x: position, n: total })}</span></p>}
        <h2 id={`stop-${stop.id}`} ref={headRef} tabIndex={-1} className="mt-1 text-2xl font-bold leading-tight outline-none">{stop.recipientName ?? <span className="ltr-num">{stop.code}</span>}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={chip.tone}>{t(`jf2.chip_${chip.key}`)}</Badge>
          <RecipientBadge type={stop.recipientType} show={showType} />
          {cod > 0 && <Badge tone="warn"><HandCoins className="size-3" aria-hidden /><span className="ltr-num">{t("fod.cod_badge", { amount: fmtMoney(cod, locale) })}</span></Badge>}
        </div>
        {act && <p className="mt-3 flex items-start gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2.5 text-base font-semibold" data-testid="stop-next"><ArrowRightCircle className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />{t(next)}</p>}
        {act && !routing && !arrived && <p className="mt-2 text-xs text-muted">{t("jf2.any_order_hint")}</p>}
      </div>

      {access === "done" && <Outcome stop={stop} />}
      {access === "locked" && <Notice tone="info"><span className="flex items-start gap-2"><Lock className="mt-0.5 size-4 shrink-0" aria-hidden />{t(routing ? "jf2.locked_note" : "jf2.pending_note")}</span></Notice>}

      {stop.recipientPhone && access !== "done" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <a href={`tel:${stop.recipientPhone}`} className="inline-flex h-14 items-center justify-center gap-2 rounded-xl border-2 border-cyan/60 bg-cyan/10 text-base font-semibold text-cyan"><Phone className="size-5" aria-hidden /><span className="ltr-num truncate">{stop.recipientPhone}</span></a>
            <Button type="button" variant="secondary" className="h-14 border-2 text-base" onClick={() => openWhatsApp(offerId, stop.id, "contact", locale, t)}><MessageCircle className="size-5" aria-hidden />{t("dstop.whatsapp")}</Button>
          </div>
          {act && <div className="grid grid-cols-2 gap-2">{(["arriving", "issue"] as const).map((k) => <Button key={k} type="button" variant="ghost" size="md" className="h-11 border border-line" onClick={() => openWhatsApp(offerId, stop.id, k, locale, t)}><MessageCircle className="size-4" aria-hidden /><span className="truncate">{t(`wa.${k}`)}</span></Button>)}</div>}
        </div>
      )}

      <div className="space-y-2 rounded-xl bg-bg2 p-3">
        <p className="flex items-start gap-2 text-base font-medium"><MapPin className="mt-0.5 size-5 shrink-0 text-cyan" aria-hidden /><span>{stop.address}{stop.city && <span className="text-muted"> · {t(`city.${stop.city}`)}</span>}</span></p>
        {routing && act && <StopRouteInfo stop={stop} first={position === 1} hint hideLeg={arrived} />}
        <a href={mapsUrl(stop)} target="_blank" rel="noreferrer" className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-line bg-card text-sm font-semibold hover:border-accent/60"><Navigation className="size-4 rtl:-scale-x-100" aria-hidden />{t("dstop.open_maps")}</a>
      </div>
      {(stop.contents || stop.notes) && (
        <dl className="space-y-2 text-sm">
          {stop.contents && <div><dt className="text-xs text-muted">{t("dstop.contents")}</dt><dd className="font-medium">{stop.contents}</dd></div>}
          {stop.notes && <div><dt className="text-xs text-muted">{t("dstop.notes")}</dt><dd className="font-medium">{stop.notes}</dd></div>}
        </dl>
      )}
      {/* The door timer exists only while the platform has it switched on (stopWaitMin > 0). */}
      {act && policy.stopWaitMin > 0 && arrived && stop.waitRemainingSec != null && stop.waitRemainingSec > 0 && <WaitNote key={stop.arrivedAt} sec={stop.waitRemainingSec} />}

      {act && (arrived ? <DeliverForm key={stop.arrivedAt} embedded stop={stop} offerId={offerId} onAdvanced={onAdvanced} onRefresh={onRefresh} /> : (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t(policy.stopWaitMin > 0 ? "dstop.arrive_hint" : "fod.arrive_hint")}</p>
          <div className="sticky bottom-0 z-20 -mx-5 -mb-4 border-t border-line bg-bg2/95 px-5 py-3 backdrop-blur" data-testid="stop-action-bar">
            <Button data-testid="stop-arrive" size="lg" full className="h-14 text-lg" loading={a.is("arrive")} onClick={arrive}><LocateFixed className="size-6" aria-hidden />{t("act.checkin")}</Button>
          </div>
        </div>
      ))}

      {act && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button data-testid="stop-fail" variant="danger" size="lg" onClick={() => setFailOpen(true)}><TriangleAlert className="size-5" aria-hidden />{t("dstop.cant_deliver")}</Button>
          {stop.canDefer && <Button data-testid="stop-defer" variant="secondary" size="lg" onClick={() => setDeferOpen(true)}>{t("dstop.postpone")}</Button>}
        </div>
      )}

      {act && <>
        <Sheet open={failOpen} onClose={() => setFailOpen(false)} title={t("dstop.fail_title")}>
          <FailForm stop={stop} offerId={offerId} policy={policy} arrived={arrived} onAdvanced={onAdvanced} onRefresh={onRefresh} onClose={() => setFailOpen(false)} />
        </Sheet>
        <Sheet open={deferOpen} onClose={() => setDeferOpen(false)} title={t("dstop.postpone_title")}>
          <DeferForm stop={stop} offerId={offerId} policy={policy} onClose={() => setDeferOpen(false)} onRefresh={onRefresh} onDone={() => { setDeferOpen(false); onAdvanced("dstop.deferred_ok"); }} />
        </Sheet>
      </>}
    </section>
  );
}
