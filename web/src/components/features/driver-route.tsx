"use client";
import { useEffect, useRef, useState } from "react";
import { Clock, ExternalLink, MapPinOff, MapPinned, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { friendlyErr } from "./driver-action";
import { ApiError, post } from "@/lib/api";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { MAPS_MAX_STOPS, PROVIDER_WARNINGS, SERIOUS_WARNINGS, durText, googleMapsRoute, kmText, parseWarnings, relAgo } from "./driver-route-utils";
import { getPosition, isOpenStop, type RouteInfo, type Stop } from "./driver-stops-shared";

// ───────── per-stop: driving leg + location badges ─────────

/**
 * What the best-route plan says about one stop: the driving leg into it ("≈ 12 min · 4.2 km from previous") and, when the address could not be
 * pinned exactly on the map, why (no location → placed last; approximate → located only from its address).
 */
export function StopRouteInfo({ stop, first = false, hint = false, hideLeg = false, className }: { stop: Stop; first?: boolean; hint?: boolean; hideLeg?: boolean; className?: string }) {
  const { t, locale } = useI18n();
  const unlocated = stop.located === false;
  const approx = !unlocated && stop.geoSource === "geocoded_approx";
  const hasLeg = !hideLeg && stop.legDurationS != null && stop.legDistanceM != null;
  if (!hasLeg && !unlocated && !approx) return null;
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {hasLeg && (
          <p data-testid="stop-leg" data-stop-id={stop.id} className="flex items-center gap-1 text-xs font-medium text-cyan">
            <Clock className="size-3.5 shrink-0" aria-hidden />{t(first ? "rdrv.leg_start" : "rdrv.leg", { time: durText(stop.legDurationS as number, locale), dist: kmText(stop.legDistanceM as number, locale) })}
          </p>
        )}
        {unlocated && <span data-testid="stop-no-location" data-stop-id={stop.id}><Badge tone="warn"><MapPinOff className="size-3" aria-hidden />{t("rdrv.no_location")}</Badge></span>}
        {approx && <span data-testid="stop-approx-location" data-stop-id={stop.id}><Badge tone="info"><MapPinned className="size-3" aria-hidden />{t("rdrv.approx_location")}</Badge></span>}
      </div>
      {unlocated && hint && <p className="text-xs text-gold">{t("rdrv.no_location_hint")}</p>}
    </div>
  );
}

// ───────── re-optimise ─────────

type Phase = "idle" | "locating" | "planning";
interface OptimizeResult { plan: unknown; cached: boolean; changed: boolean; currentId: string | null; job?: unknown }

/**
 * Asks the browser for the position (6 s; denied / unavailable ⇒ carry on without coordinates, the server then starts from the warehouse or the stop
 * the driver is at), re-plans, and hands the fresh job view back so the screen updates without waiting for the next poll.
 */
function useOptimizeRoute({ offerId, approved, currentId, onJob, onRefresh }: { offerId: string; approved: boolean; currentId: string | null; onJob?: (job: any) => void; onRefresh: () => void }) {
  const { t } = useI18n();
  const lock = useRef(false); // a double tap must never start two paid planning calls
  const [phase, setPhase] = useState<Phase>("idle");
  const [noGps, setNoGps] = useState(false);

  async function run() {
    if (lock.current) return;
    lock.current = true; setPhase("locating");
    try {
      const pos = await getPosition(6000);
      setNoGps(pos.lat == null || pos.lng == null);
      setPhase("planning");
      const res = await post<OptimizeResult>(`/offers/${offerId}/route/optimize`, pos);
      if (res.cached) toast.success(t("rdrv.opt_cached"));
      else if (res.changed) toast.success(t(approved && res.currentId && currentId && res.currentId !== currentId ? "rdrv.opt_changed_next" : "rdrv.opt_changed"));
      else toast.success(t("rdrv.opt_same"));
      if (res.job) onJob?.(res.job); else onRefresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "CONFLICT") toast.error(t("rdrv.err_conflict"));
      else if (e instanceof ApiError && e.code === "RATE_LIMITED") toast.error(t("rdrv.err_rate"));
      else toast.error(friendlyErr(e, t));
      if (e instanceof ApiError) onRefresh(); // the job moved on meanwhile (parcels changed, route approved…): show the truth
    } finally { lock.current = false; setPhase("idle"); }
  }
  return { phase, noGps, run };
}

// ───────── route summary card ─────────

function Stat({ label, value, testid }: { label: string; value: string; testid: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd data-testid={testid} className="text-lg font-bold text-ink">{value}</dd>
    </div>
  );
}

/**
 * The best-route card of a per-parcel job: who planned it (Google / local estimate), how long and how far, what is still ahead once the driver is
 * working the stops, honest warnings, and the two route-level actions — re-optimise and open the next stops in Google Maps.
 * `approved` = the driver has approved the route (stops are being worked): totals become "still ahead" and re-ordering only touches unreached stops.
 */
export function RouteSummary({ route, stops, offerId, approved, onJob, onRefresh, onBusyChange }: { route: RouteInfo; stops: Stop[]; offerId: string; approved: boolean; onJob?: (job: any) => void; onRefresh: () => void; onBusyChange?: (busy: boolean) => void }) {
  const { t, locale } = useI18n();
  const open = stops.filter(isOpenStop);
  const currentId = stops.find((s) => s.current)?.id ?? null;
  const opt = useOptimizeRoute({ offerId, approved, currentId, onJob, onRefresh });
  const maps = googleMapsRoute(stops);
  const busy = opt.phase !== "idle";
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]); // lets the screen hold "Approve" while a re-plan is running

  const provider = route.provider;
  const manual = provider === "manual" || route.manual === true; // E5: the driver arranged the order; legs of moved stops are local estimates
  const estimated = provider != null && provider !== "google_routes";
  const mark = estimated ? "≈ " : "";
  const dist = approved ? route.remainingDistanceM : route.totalDistanceM;
  const secs = approved ? route.remainingDurationS : route.totalDurationS;
  const warnings = parseWarnings(route.warnings);
  const providerWarned = warnings.some((w) => PROVIDER_WARNINGS.includes(w.code));
  const planned = relAgo(route.plannedAt, locale);
  const warnText = (w: { code: string; n: string | null }) => {
    const k = `route.warn.${w.code}`;
    const generic = t("rdrv.warn_generic");
    if (!w.code) return generic;
    const txt = t(k);
    if (txt === k) return generic; // unknown code
    if (!txt.includes("{n}")) return txt;
    return w.n ? t(k, { n: fmtNum(Number(w.n), locale) }) : generic;
  };
  const label = !route.planned ? "rdrv.plan_now" : approved ? "rdrv.optimize_after" : "rdrv.optimize";

  return (
    <Card data-testid="route-summary" className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold">{t("rdrv.summary_title")}</h3>
        {provider && <span data-testid="route-provider" data-provider={provider}><Badge tone={manual ? "info" : estimated ? "warn" : "success"} className="whitespace-normal text-center">{t(`route.provider.${provider}`)}</Badge></span>}
      </div>

      {route.planned ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t(approved ? "rdrv.caption_remaining" : "rdrv.caption_total")}</p>
          <dl className="divide-y divide-line rounded-xl bg-bg2 px-3">
            <Stat testid="route-distance" label={t("rdrv.stat_distance")} value={dist > 0 ? `${mark}${kmText(dist, locale)}` : "—"} />
            <Stat testid="route-duration" label={t("rdrv.stat_time")} value={secs > 0 ? `${mark}${durText(secs, locale)}` : "—"} />
            <Stat testid="route-stops" label={t(approved ? "rdrv.stat_stops_left" : "rdrv.stat_stops")} value={fmtNum(approved ? open.length : stops.length, locale)} />
          </dl>
          <div className="space-y-0.5 text-xs text-muted">
            {approved && route.totalDistanceM > 0 && <p>{t("rdrv.whole_route", { dist: `${mark}${kmText(route.totalDistanceM, locale)}`, time: `${mark}${durText(route.totalDurationS, locale)}` })}</p>}
            {planned && route.by && <p data-testid="route-planned" title={fmtDateTime(route.plannedAt, locale)}>{t(route.by === "driver" ? "rdrv.planned_driver" : "rdrv.planned_system", { when: planned })}</p>}
          </div>
        </div>
      ) : route.canOptimize ? <Notice tone="info">{t("rdrv.not_planned")}</Notice> : null}

      {manual && <p data-testid="route-manual" className="text-xs text-muted">{t("fod.route_manual_note")}</p>}

      {(warnings.length > 0 || (estimated && !providerWarned && !manual)) && (
        <div className="space-y-2">
          {warnings.map((w) => <div key={w.key} data-testid="route-warning" data-code={w.code || "UNKNOWN"}><Notice tone={SERIOUS_WARNINGS.includes(w.code) || !w.code ? "warn" : "info"}>{warnText(w)}</Notice></div>)}
          {estimated && !providerWarned && !manual && <div data-testid="route-estimate"><Notice tone="warn" title={t("rdrv.estimate_title")}>{t("rdrv.estimate_generic")}</Notice></div>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {route.canOptimize && (
          <div className="space-y-1.5">
            <Button data-testid="optimize-route" variant="secondary" size="lg" full className="h-14 border-2 text-base" loading={busy} onClick={opt.run}>
              {opt.phase === "idle" && <RefreshCw className="size-5" aria-hidden />}{t(opt.phase === "locating" ? "rdrv.locating" : opt.phase === "planning" ? "rdrv.optimizing" : label)}
            </Button>
            <p className="text-xs text-muted">{t(approved ? "rdrv.optimize_hint_post" : "rdrv.optimize_hint_pre")}</p>
            {opt.noGps && opt.phase === "idle" && <p role="status" className="text-xs text-gold">{t("rdrv.gps_off")}</p>}
          </div>
        )}
        {open.length > 0 && (
          <div className="space-y-1.5">
            {maps.url ? (
              <a data-testid="open-in-maps" href={maps.url} target="_blank" rel="noreferrer" className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-line bg-bg2 px-4 text-center text-base font-semibold text-ink transition hover:border-accent/60 hover:bg-card">
                <ExternalLink className="size-5 shrink-0 rtl:-scale-x-100" aria-hidden />{t("rdrv.open_in_maps")}
              </a>
            ) : <p data-testid="open-in-maps-none" className="text-xs text-muted">{t("rdrv.maps_none")}</p>}
            {maps.url && maps.truncated && <p data-testid="open-in-maps-more" className="text-xs text-muted">{t("rdrv.maps_more", { n: fmtNum(MAPS_MAX_STOPS, locale) })}</p>}
            {maps.url && maps.skipped > 0 && <p className="text-xs text-gold">{t("rdrv.maps_skipped", { n: fmtNum(maps.skipped, locale) })}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}
