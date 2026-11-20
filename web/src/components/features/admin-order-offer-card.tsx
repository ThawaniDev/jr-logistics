"use client";
import { useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { Badge, Button, Notice, ProgressBar, StatusBadge } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDur } from "@/components/reports/chartTheme";
import { fmtDateTime, fmtKm, fmtMoney, fmtNum, fmtTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { OfferFieldOpsInfo, OfferStaffActions } from "./admin-requests";
import { OrderMap } from "./admin-order-map-view";
import { lateText } from "./admin-order-lib";

const pct = (f: number | null) => (f == null ? "—" : `${Math.round(f * 100)}%`);
function Fact({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return <div className="min-w-0 rounded-xl bg-bg2/60 p-3" data-testid={testId}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 space-y-0.5 text-sm font-medium">{children}</dd></div>;
}
const sub = (c: React.ReactNode) => <span className="block text-xs font-normal text-muted">{c}</span>;

/** The driver's GPS path for this job (sampled once a minute). Personal location data: it needs `drivers.sensitive` and every look is audited, so it is fetched only when asked for. */
function GpsPath({ o }: { o: any }) {
  const { t } = useI18n();
  const [on, setOn] = useState(false); const [now] = useState(() => Date.now());
  const end = new Date(o.finalAt ?? o.deliveredAt ?? o.cancelledAt ?? now).getTime() + 60_000, start = new Date(o.acceptedAt ?? o.createdAt).getTime();
  const q = new URLSearchParams({ offerId: o.id, from: new Date(Math.max(start, end - 30 * 864e5)).toISOString(), to: new Date(end).toISOString() });
  const { data, error } = useApi(on ? `/admin/location-history/${o.driver.id}?${q}` : null, { shouldRetryOnError: false });
  const pts = (data?.points ?? []) as Array<{ lat: number; lng: number }>;
  return (
    <div className="space-y-2">
      <Button size="sm" variant="secondary" aria-expanded={on} data-testid={`dv1-gps-${o.id}`} onClick={() => setOn((v) => !v)}>{on ? t("dv1.gps_hide") : t("dv1.gps_show")}</Button>
      {on && (error ? <Notice tone="danger">{t("uxa.load_failed")}</Notice> : !data ? <p className="text-xs text-muted">{t("uxa.loading")}</p> : <>
        <p className="text-xs text-muted">{t("dv1.gps_points", { n: data.total })}{data.thinned ? ` · ${t("dv1.gps_thinned")}` : ""} · {t("dv1.gps_audited")}</p>
        <OrderMap label={t("dv1.gps_title")} emptyHint={t("dv1.gps_none")} lines={[{ points: pts.map((p) => [p.lat, p.lng] as [number, number]), tone: "accent" }]}
          points={pts.length ? [{ id: "start", lat: pts[0].lat, lng: pts[0].lng, tone: "cyan", big: true, label: t("dv1.gps_start") }, { id: "end", lat: pts.at(-1)!.lat, lng: pts.at(-1)!.lng, tone: "gold", big: true, label: t("dv1.gps_end") }] : []}
          legend={[{ tone: "cyan", label: t("dv1.gps_start") }, { tone: "gold", label: t("dv1.gps_end") }]} />
      </>)}
    </div>
  );
}

/** One driver on the order, in full: who, every step with its timestamp and the time it took, response / arrival / attendance / loading / route / parcel facts, cash, rating, chat, and the staff actions. */
export function OfferCard({ o, order, manifest, sensitive, onDone }: { o: any; order: { id: string; service: string; businessId: string }; manifest: boolean; sensitive: boolean; onDone: () => void }) {
  const { t, locale } = useI18n(); const me = useUser();
  const canDriver = hasPerm(me, "drivers.view"), canOffice = hasPerm(me, "offices.view") || hasPerm(me, "users.view");
  const p = o.parcels, l = o.loading, rt = o.route, ar = o.arrival;
  const lateTone = ar.lateMin == null ? "neutral" : ar.lateMin > 30 ? "danger" : ar.lateMin > 0 ? "warn" : "success";
  return (
    <li className="space-y-4 rounded-card border border-line bg-card p-4 sm:p-5" data-testid={`admin-offer-${o.id}`} data-status={o.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {canDriver ? <Link href={`/admin/drivers/${o.driver.id}`} className="text-accent hover:underline" data-testid={`dv1-driver-link-${o.id}`}>{o.driver.name}</Link> : o.driver.name}
            {o.office && (canOffice ? <Link href={`/admin/offices/${o.office.id}`} className="text-sm font-normal text-cyan hover:underline" data-testid={`dv1-office-link-${o.id}`}>{o.office.name}</Link> : <Badge tone="info">{o.office.name}</Badge>)}
            {o.isReplacement && <Badge tone="warn">{t("req.replacement")}</Badge>}
            <Badge>{t(`dv1.src_${o.source}`)}</Badge>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="ltr-num">{o.driver.phone ?? "—"}</span>
            {o.driver.vehicleType && <span>{t(`vehicle.${o.driver.vehicleType}`)}{o.driver.plate ? <> · <span className="ltr-num">{o.driver.plate}</span></> : null}</span>}
            {o.driver.rating != null && <span className="inline-flex items-center gap-1 text-gold"><Star className="size-3 fill-current" aria-hidden /><span className="ltr-num">{o.driver.rating}</span><span className="text-muted">({o.driver.ratingCount})</span></span>}
            <span>{t("req.jobs_done", { n: o.driver.jobsCompleted })}</span>
          </p>
        </div>
        <StatusBadge status={o.status} />
      </div>

      <ol className="flex flex-wrap gap-2" aria-label={t("dv1.steps_title")} data-testid={`dv1-steps-${o.id}`}>
        {o.steps.map((s: any) => (
          <li key={s.key} className="rounded-xl border border-line px-3 py-1.5 text-xs" data-step={s.key}>
            <span className="block font-medium">{t(`dv1.step_${s.key}`)}</span>
            <span className="text-muted">{fmtDateTime(s.at, locale)}{s.fromPrevS != null && <span className="ltr-num ms-1.5 rounded-full bg-line/50 px-1.5 py-0.5 tabular-nums">+{fmtDur(Math.max(0, s.fromPrevS), locale)}</span>}</span>
          </li>
        ))}
      </ol>

      <dl className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        <Fact label={t("dv1.f_response")}>{o.responseS == null ? "—" : <span className="ltr-num">{fmtDur(o.responseS, locale)}</span>}{sub(t("dv1.f_response_sub"))}</Fact>
        <Fact label={t("dv1.f_arrival")} testId={`dv1-arrival-${o.id}`}>
          {ar.at ? <><span className="inline-flex flex-wrap items-center gap-1.5"><span>{fmtTime(ar.at, locale)}</span><Badge tone={lateTone}>{lateText(ar.lateMin, t, locale)}</Badge></span>{sub(ar.distanceM != null ? t("dv1.f_arrival_dist", { n: fmtNum(ar.distanceM, locale) }) : ar.pinKnown ? t("dv1.f_no_gps") : t("dv1.f_no_pin"))}</> : "—"}
        </Fact>
        <Fact label={t("dv1.f_attendance")}>{o.attendance.at ? <>{fmtTime(o.attendance.at, locale)}{sub(o.attendance.byName ? t("dv1.f_confirmed_by", { name: o.attendance.byName }) : t("dv1.f_confirmed_auto"))}</> : <span className="text-muted">{t("dv1.f_not_confirmed")}</span>}</Fact>
        {manifest && (
          <Fact label={t("dv1.f_loading")} testId={`dv1-loading-${o.id}`}>
            <span className="ltr-num">{t("dv1.f_loading_n", { scanned: l.scanned, assigned: l.assigned })}</span>
            {l.assigned > 0 && <ProgressBar value={l.scanned} max={l.assigned} tone={l.unscanned > 0 ? "gold" : "accent"} label={t("dv1.f_loading")} />}
            {sub(<>{t(l.mode === "driver_scan" ? "foa.load_mode_driver_scan" : "foa.load_mode_warehouse")}{l.unscanned > 0 ? ` · ${t("dv1.f_unscanned", { n: l.unscanned })}` : ""}{l.durationS != null && l.durationS > 0 ? ` · ${t("dv1.f_load_took", { time: fmtDur(l.durationS, locale) })}` : ""}</>)}
            {sub(t("dv1.f_via", { scan: l.viaScan, wh: l.viaWarehouse }))}
          </Fact>
        )}
        {manifest && (
          <Fact label={t("dv1.f_route")} testId={`dv1-route-${o.id}`}>
            {rt ? <>{rt.distanceM != null ? <span className="ltr-num">{fmtKm(rt.distanceM, locale)}{rt.durationS != null && ` · ${fmtDur(rt.durationS, locale)}`}</span> : "—"}
              {sub(<>{t("dv1.f_route_stops", { n: rt.stops ?? 0 })} · {rt.provider ? t(`dv1.provider_${rt.provider}`) : "—"}{rt.manual && <> · <Badge tone="warn">{t("dv1.f_manual_order")}</Badge></>}{rt.warnings > 0 ? ` · ${t("dv1.f_route_warn", { n: rt.warnings })}` : ""}</>)}
              {sub(rt.approvedAt ? t("shipadm.route_approved_at", { time: fmtDateTime(rt.approvedAt, locale) }) : t("shipadm.route_not_approved"))}</> : <span className="text-muted">{t("dv1.f_no_route")}</span>}
          </Fact>
        )}
        {manifest && (
          <Fact label={t("dv1.f_parcels")} testId={`dv1-parcels-${o.id}`}>
            <span className="ltr-num">{t("dv1.f_parcels_n", { delivered: p.delivered, total: p.total })}</span>
            {sub(t("dv1.f_parcels_rest", { failed: p.failed, returned: p.returned, pending: p.pending + p.onBoard }))}
            {sub(t("dv1.f_success", { rate: pct(p.successRate), first: pct(p.firstAttemptRate) }))}
            {(p.defers > 0 || p.avgDwellS != null) && sub(<>{p.defers > 0 ? t("dv1.f_defers", { n: p.defers }) : ""}{p.defers > 0 && p.avgDwellS != null ? " · " : ""}{p.avgDwellS != null ? t("dv1.f_dwell", { time: fmtDur(p.avgDwellS, locale) }) : ""}</>)}
          </Fact>
        )}
        {o.expectedEarningCents != null && <Fact label={t("dv1.f_earning")}><span className="ltr-num">{fmtMoney(o.expectedEarningCents, locale)}</span>{sub(t("dv1.f_units", { exp: o.expectedUnits, fin: o.finalUnits ?? "—" }))}</Fact>}
        <Fact label={t("dv1.f_rating")}>{o.rating ? <><span className="inline-flex items-center gap-1 text-gold"><Star className="size-3.5 fill-current" aria-hidden /><span className="ltr-num">{o.rating.stars}/5</span></span>{o.rating.comment && sub(`“${o.rating.comment}”`)}</> : <span className="text-muted">{t("dv1.f_not_rated")}</span>}</Fact>
        <Fact label={t("dv1.f_chat")}>{o.chat.count > 0 ? <><span className="ltr-num">{t("dv1.f_chat_n", { n: o.chat.count })}</span>{sub(<Link href={`/admin/requests/${order.id}/communication#offer-${o.id}`} className="text-accent hover:underline">{t("dv1.f_chat_open")}</Link>)}</> : <span className="text-muted">{t("dv1.f_chat_none")}</span>}</Fact>
        {o.cancelReason && <Fact label={t("dv1.f_cancel")}><span className="text-danger">{o.cancelReason}</span>{o.cancelledAt && sub(fmtDateTime(o.cancelledAt, locale))}</Fact>}
      </dl>

      <OfferFieldOpsInfo offer={o} businessId={order.businessId} />
      {sensitive ? <GpsPath o={o} /> : <p className="text-xs text-muted" data-testid={`dv1-gps-hidden-${o.id}`}>{t("dv1.gps_hidden")}</p>}
      <OfferStaffActions offer={o} service={order.service} onDone={onDone} />
    </li>
  );
}
