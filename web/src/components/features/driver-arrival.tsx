"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, LocateFixed, LocateOff, MapPin, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { useDriverAction } from "./driver-action";
import { ApiError, post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { arrivalOf, fmtMeters, geofenceState, tooFarDetails, type LatLng } from "./driver-fieldops-utils";

export interface GeoFix extends LatLng { accuracy: number | null; at: number }
export type GeoStatus = "idle" | "locating" | "ok" | "denied" | "unavailable" | "unsupported" | "insecure";

const toFix = (p: GeolocationPosition): GeoFix => ({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null, at: Date.now() });
const statusOf = (e: GeolocationPositionError | { code: number }): GeoStatus => (e.code === 1 ? "denied" : "unavailable");

/**
 * The driver's GPS position. While `active` it follows the position (high accuracy) so the distance hint stays live;
 * `once()` takes a fresh reading right now (≈ 8 s, high accuracy) for the check-in itself, `retry()` restarts watching after the driver fixed the settings.
 */
export function useGeoFix(active: boolean) {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");
  const watch = useRef<number | null>(null);
  const stop = useCallback(() => { if (watch.current != null && typeof navigator !== "undefined") navigator.geolocation?.clearWatch(watch.current); watch.current = null; }, []);
  const start = useCallback(() => {
    stop();
    if (typeof navigator === "undefined" || !navigator.geolocation) { setStatus("unsupported"); return; }
    if (typeof window !== "undefined" && !window.isSecureContext) { setStatus("insecure"); return; }
    setStatus("locating");
    watch.current = navigator.geolocation.watchPosition((p) => { setFix(toFix(p)); setStatus("ok"); }, (e) => setStatus(statusOf(e)), { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  }, [stop]);
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(start, 0); // after mount, never during render
    return () => { clearTimeout(id); stop(); };
  }, [active, start, stop]);
  const once = useCallback((timeoutMs = 8000) => new Promise<{ fix: GeoFix | null; status: GeoStatus }>((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve({ fix: null, status: "unsupported" });
    if (typeof window !== "undefined" && !window.isSecureContext) return resolve({ fix: null, status: "insecure" });
    let done = false;
    const cap = setTimeout(() => { if (!done) { done = true; resolve({ fix: null, status: "unavailable" }); } }, timeoutMs + 1500); // the browser's own timeout does not run while a permission prompt is open
    navigator.geolocation.getCurrentPosition(
      (p) => { if (done) return; done = true; clearTimeout(cap); const f = toFix(p); setFix(f); setStatus("ok"); resolve({ fix: f, status: "ok" }); },
      (e) => { if (done) return; done = true; clearTimeout(cap); const s = statusOf(e); setStatus(s); resolve({ fix: null, status: s }); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  }), []);
  return { fix, status, retry: start, once };
}

type Problem = null | { kind: "location"; why: GeoStatus } | { kind: "far"; distanceM: number | null; radiusM: number | null };

/**
 * "I've arrived at the warehouse" (E1/E2). Reads GPS and sends it; shows how far from the warehouse the driver is (when the pin is known),
 * explains LOCATION_REQUIRED / TOO_FAR_FROM_WAREHOUSE with the numbers, and offers "Retry location". Renders a hint line plus the buttons —
 * place it inside the page's wrapping action row.
 */
export function ArrivalCheckin({ job, offerId, onDone }: { job: unknown; offerId: string; onDone: () => void }) {
  const { t, locale } = useI18n(); const a = useDriverAction();
  const arrival = arrivalOf(job as { arrival?: unknown });
  const enforced = arrival.geofence && arrival.warehouse != null;
  const geo = useGeoFix(enforced);
  const [problem, setProblem] = useState<Problem>(null);
  const state = geofenceState(arrival, geo.fix);

  async function checkin() {
    setProblem(null);
    const r = await geo.once();
    // A fresh reading failed (slow GPS indoors): the position we were following a moment ago is still good enough for the server to judge.
    const fix = r.fix ?? (geo.fix && Date.now() - geo.fix.at < 30_000 ? geo.fix : null);
    // Without any reading the server cannot verify the position: say so (and how to fix it) instead of sending a request that will be refused.
    if (!fix && enforced) { setProblem({ kind: "location", why: r.status }); return null; }
    return post<{ status?: string }>(`/offers/${offerId}/checkin`, fix ? { lat: fix.lat, lng: fix.lng } : {});
  }
  const go = () => a.run("ci", checkin, {
    onDone: (res) => {
      if (!res) return;
      toast.success(t(res.status === "attendance_confirmed" ? "fod.arrival_confirmed" : "job.arrived_ok"));
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "TOO_FAR_FROM_WAREHOUSE") { const d = tooFarDetails(e.details); setProblem({ kind: "far", distanceM: d?.distanceM ?? null, radiusM: d?.radiusM ?? null }); }
      else if (e instanceof ApiError && e.code === "LOCATION_REQUIRED") setProblem({ kind: "location", why: "unavailable" });
      else if (e instanceof ApiError) onDone(); // the job moved on meanwhile: show the truth
    },
  });

  const retry = () => { setProblem(null); geo.retry(); };
  // What the hint line says, strongest first: a refusal from the server, then the live distance, then the state of the GPS.
  let hint: { tone: "ok" | "warn" | "bad" | "info"; text: string; state: string } | null = null;
  if (enforced) {
    const radius = problem?.kind === "far" && problem.radiusM != null ? problem.radiusM : arrival.radiusM;
    const dist = problem?.kind === "far" && problem.distanceM != null ? problem.distanceM : state.distanceM;
    if (problem?.kind === "location" || geo.status === "denied" || geo.status === "unsupported" || geo.status === "insecure" || (geo.status === "unavailable" && dist == null)) {
      const why = problem?.kind === "location" && problem.why !== "ok" && problem.why !== "idle" && problem.why !== "locating" ? problem.why : geo.status;
      hint = { tone: "bad", state: "no-location", text: t(why === "denied" ? "fod.loc_denied" : why === "insecure" ? "fod.loc_insecure" : why === "unsupported" ? "fod.loc_unsupported" : "fod.loc_unavailable") };
    } else if (dist != null) {
      const within = dist <= radius;
      hint = within
        ? { tone: "ok", state: "within", text: t("fod.geo_within", { dist: fmtMeters(dist, locale), radius: fmtMeters(radius, locale) }) }
        : { tone: problem?.kind === "far" ? "bad" : "warn", state: "far", text: t(problem?.kind === "far" ? "fod.too_far" : "fod.geo_far", { dist: fmtMeters(dist, locale), radius: fmtMeters(radius, locale) }) };
    } else hint = { tone: "info", state: "locating", text: t("fod.geo_locating") };
  }
  const canRetry = enforced && (problem != null || geo.status === "denied" || geo.status === "unavailable");
  const acc = enforced && geo.fix?.accuracy != null && geo.fix.accuracy > Math.max(50, arrival.radiusM / 2) ? Math.round(geo.fix.accuracy) : null;

  return (
    <>
      {hint && (
        <div role="status" data-testid="geofence-hint" data-state={hint.state} className={cn("flex basis-full items-start gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium",
          hint.tone === "ok" ? "border-accent/40 bg-accent/10 text-accent" : hint.tone === "info" ? "border-line bg-bg2 text-muted" : hint.tone === "warn" ? "border-gold/40 bg-gold/10 text-gold" : "border-danger/40 bg-danger/10 text-danger")}>
          {hint.tone === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : hint.state === "no-location" ? <LocateOff className="mt-0.5 size-4 shrink-0" aria-hidden /> : <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span>{hint.text}{acc != null && <span className="mt-0.5 block text-xs font-normal text-muted">{t("fod.geo_accuracy", { m: fmtMeters(acc, locale) })}</span>}</span>
        </div>
      )}
      <Button data-testid="checkin" size="lg" loading={a.is("ci")} onClick={go}><LocateFixed className="size-5" aria-hidden />{t("act.checkin")}</Button>
      {canRetry && <Button data-testid="retry-location" size="lg" variant="secondary" onClick={retry}><RefreshCw className="size-5" aria-hidden />{t("fod.loc_retry")}</Button>}
    </>
  );
}
