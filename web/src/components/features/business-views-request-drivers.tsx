"use client";
import Link from "next/link";
import { HandCoins, MessageSquare, Phone, Flag, Route as RouteIcon, Siren, Star, Package } from "lucide-react";
import { Avatar, Badge, Button, EmptyState, ProgressBar, Section, StatusBadge } from "@/components/ui";
import { OfferCustody } from "./business-custody";
import { outstandingOf, progressPct } from "./business-fieldops-lib";
import { ACTIVE_OFFER, NO_LOADING, useRequest } from "./business-views-request-ctx";
import { HAS_DRIVER } from "./business-views-lib";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";

/** "12 of 30 parcels scanned by the driver" (E3): the driver scans every parcel onto the vehicle; the warehouse only watches. */
export function LoadingProgress({ loading }: { loading: { mode?: string; assigned?: number; scanned?: number; finished?: boolean } }) {
  const { t, locale } = useI18n();
  const assigned = loading.assigned ?? 0, scanned = loading.scanned ?? 0;
  if (loading.mode === "warehouse") return <p className="text-xs text-muted" data-testid="loading-by-warehouse">{t("fob.loading_by_you")}</p>;
  const label = t("fob.loading_progress", { scanned: fmtNum(scanned, locale), assigned: fmtNum(assigned, locale) });
  return (
    <div className="space-y-1.5" data-testid="loading-progress" data-scanned={scanned} data-assigned={assigned} data-finished={loading.finished ? "1" : "0"}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        {loading.finished ? <Badge tone="success"><span data-testid="loading-finished">{t("fob.loading_finished")}</span></Badge> : <Badge tone="info">{t("fob.loading_ongoing")}</Badge>}
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={assigned} aria-valuenow={Math.min(scanned, assigned)} aria-label={label} className="h-2 overflow-hidden rounded-full bg-bg2">
        <div className={cn("h-full transition-all", loading.finished ? "bg-accent" : "bg-brand-gradient")} style={{ width: `${progressPct(scanned, assigned)}%` }} />
      </div>
    </div>
  );
}

/** Cash this driver collected for the order: collected / received by the warehouse / still with the driver. */
export function OfferCash({ cod, onReceive }: { cod: { collectedCents?: number; receivedCents?: number; outstandingCents?: number }; onReceive: () => void }) {
  const { t, locale } = useI18n();
  const collected = cod.collectedCents ?? 0, received = cod.receivedCents ?? 0, outstanding = outstandingOf(cod);
  if (collected === 0 && received === 0) return null;
  return (
    <div className="space-y-2 rounded-xl border border-line p-3" data-testid="offer-cash">
      <p className="text-xs font-semibold text-muted">{t("fob.cash_title")}</p>
      <dl className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-bg2 px-1 py-2"><dt className="text-[10px] uppercase text-muted">{t("fob.cash_collected")}</dt><dd className="ltr-num font-bold tabular-nums" data-testid="offer-cash-collected">{fmtMoney(collected, locale)}</dd></div>
        <div className="rounded-lg bg-bg2 px-1 py-2"><dt className="text-[10px] uppercase text-muted">{t("fob.cash_received")}</dt><dd className="ltr-num font-bold tabular-nums" data-testid="offer-cash-received">{fmtMoney(received, locale)}</dd></div>
        <div className="rounded-lg bg-bg2 px-1 py-2"><dt className="text-[10px] uppercase text-muted">{t("fob.cash_outstanding")}</dt><dd className={cn("ltr-num font-bold tabular-nums", outstanding > 0 && "text-gold")} data-testid="offer-cash-outstanding">{fmtMoney(outstanding, locale)}</dd></div>
      </dl>
      {outstanding > 0 && <Button size="sm" onClick={onReceive} data-testid="offer-cash-receive"><HandCoins className="size-4" aria-hidden />{t("fob.rcv_title")}</Button>}
    </div>
  );
}

const units = (x: any) => [["exp", x.expectedUnits], ["loaded", x.loadedUnits], ["delivered", x.deliveredUnits], ["final", x.finalUnits]] as const;

/** One driver on the order: who, where the job stands, the parcels / cash / items they carry, and every action the warehouse can take on it. */
function DriverCard({ o }: { o: any }) {
  const { t, locale } = useI18n();
  const { r, base, manifest, live, open, act, busy, openReport } = useRequest();
  const has = HAS_DRIVER(o.status);
  const p = o.parcels;
  return (
    <article className="overflow-hidden rounded-card border border-line bg-card" data-testid="driver-card" data-offer={o.id} data-status={o.status}>
      <div className="flex items-start gap-3 border-b border-line p-4">
        <Avatar name={o.driver.name} size={44} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold"><span className="truncate">{o.driver.name}</span>{o.isReplacement && <Badge tone="warn">{t("req.replacement")}</Badge>}</p>
          <p className="text-xs text-muted">{t(`vehicle.${o.driver.vehicleType}`)} · {o.driver.rating ? `★ ${o.driver.rating}` : t("req.new_driver")} · {t("req.jobs_done", { n: o.driver.jobsCompleted })}</p>
          {o.driver.phone && <a href={`tel:${o.driver.phone}`} className="mt-1 inline-flex items-center gap-1.5 text-sm text-cyan"><Phone className="size-3.5" aria-hidden /><span className="ltr-num">{o.driver.phone}</span></a>}
        </div>
        <StatusBadge status={o.status} />
      </div>
      <div className="space-y-3 p-4">
        {manifest && p ? (
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2 text-center" data-testid="parcel-stats">
              {(["delivered", "failed", "loaded", "pending"] as const).map((k) => <div key={k} className="rounded-lg bg-bg2 px-1 py-2"><p className="text-[10px] uppercase text-muted">{t(`bs.st_${k}`)}</p><p className={cn("font-bold tabular-nums", k === "failed" && p[k] > 0 && "text-danger", k === "delivered" && "text-accent")}>{fmtNum(p[k], locale)}</p></div>)}
            </div>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span>{t("bs.parcels_of", { n: fmtNum(p.total, locale) })}</span>
              {p.returned > 0 && <span>{t("bs.st_returned")}: {fmtNum(p.returned, locale)}</span>}
              {p.missing > 0 && <span className="text-danger">{t("shipstatus.missing")}: {fmtNum(p.missing, locale)}</span>}
              {o.routeApprovedAt ? <Badge tone="success"><RouteIcon className="size-3" aria-hidden />{t("bs.route_approved", { time: fmtDateTime(o.routeApprovedAt, locale) })}</Badge> : p.loaded > 0 && <Badge tone="neutral">{t("bs.route_not_approved")}</Badge>}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 text-center">
            {units(o).map(([k, val]) => <div key={k} className="rounded-lg bg-bg2 px-1 py-2"><p className="text-[10px] uppercase text-muted">{t(`units.${k}`)}</p><p className="font-bold tabular-nums">{val ?? "—"}</p></div>)}
          </div>
        )}
        {manifest && o.loading && !NO_LOADING.includes(o.status) && (o.loading.finished || o.status === "attendance_confirmed" || o.loading.mode === "warehouse") && <LoadingProgress loading={o.loading} />}
        {o.status === "attendance_confirmed" && o.loadedUnits != null && (!o.loading || o.loading.mode === "warehouse") && <p className="text-xs text-muted">{o.loadedAckByDriver === true ? t("req.driver_confirmed_loading") : o.loadedAckByDriver === false ? <span className="text-danger">{t("req.driver_disputed_loading")}</span> : t("req.awaiting_driver_ack")}</p>}
        {o.cod && <OfferCash cod={o.cod} onReceive={() => open("cash", o)} />}
        {has && <OfferCustody offerId={o.id} canReturn />}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line bg-bg2/30 px-4 py-3">
        {o.actions.includes("confirm_attendance") && <Button size="sm" loading={busy("att" + o.id)} onClick={() => act("att" + o.id, `/offers/${o.id}/attendance`, { present: true })}>{t("act.confirm_attendance")}</Button>}
        {o.actions.includes("mark_no_show") && <Button size="sm" variant="danger" onClick={() => open("noshow", o, { reason: "" })}>{t("act.no_show")}</Button>}
        {o.actions.includes("record_loading") && <Button size="sm" onClick={() => manifest ? open("handover", o) : open("loading", o, { units: String(o.loadedUnits ?? o.expectedUnits) })}>{t("act.record_loading")}</Button>}
        {o.actions.includes("confirm_returns") && <Button size="sm" onClick={() => open("returns", o)}>{t("bs.act_confirm_returns")}</Button>}
        {o.actions.includes("handover_custody") && <Button size="sm" variant="secondary" onClick={() => open("custody", o)}>{t("act.custody")}</Button>}
        {o.actions.includes("rate") && <Button size="sm" variant="gold" onClick={() => open("rate", o, { stars: 5 })}><Star className="size-4" aria-hidden />{t("act.rate")}</Button>}
        {has && <Link href={`${base}/activity?driver=${o.id}`}><Button size="sm" variant="ghost" data-testid="driver-chat"><MessageSquare className="size-4" aria-hidden />{t("chat.title")}</Button></Link>}
        {live && ACTIVE_OFFER.includes(o.status) && <Button size="sm" variant="gold" title={t("bz.urgent_for_driver", { name: o.driver.name })} onClick={() => open("urgent", o, { reason: "" })}><Siren className="size-4" aria-hidden />{t("req.urgent")}</Button>}
        <Button size="sm" variant="ghost" title={t("bz.report_for_driver", { name: o.driver.name })} onClick={() => openReport({ requestId: r.id, offerId: o.id, requestRef: r.ref, driverName: o.driver.name })}><Flag className="size-4" aria-hidden />{t("act.report_problem")}</Button>
      </div>
    </article>
  );
}

/** The drivers of the order: filling progress while open, then one card per driver. */
export function DriversSection() {
  const { t } = useI18n(); const { r, data, offers } = useRequest();
  const filling = r.status === "published" || r.status === "filling";
  return (
    <Section title={t("req.drivers")} id="drivers"
      description={r.quantity > 0 ? t("rdz.drivers_filled", { filled: r.slotsFilled, total: r.quantity }) : undefined}
      actions={data.offeredCount > 0 ? <Badge tone="info">{t("req.waiting_offers", { n: data.offeredCount })}</Badge> : undefined}>
      {filling && r.quantity > 0 && <div className="mb-4"><ProgressBar value={r.slotsFilled} max={r.quantity} label={t("req.drivers")} /></div>}
      {offers.length === 0 ? <EmptyState icon={<Package className="size-9" aria-hidden />} title={t("req.no_drivers")} hint={filling ? (data.offeredCount > 0 ? t("bz.offers_pending_hint", { n: data.offeredCount }) : t("bz.no_eligible")) : undefined} /> : (
        <div className="space-y-4">{offers.map((o) => <DriverCard key={o.id} o={o} />)}</div>
      )}
    </Section>
  );
}
