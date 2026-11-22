"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDown, ChevronLeft, ChevronsUp, HandCoins, LocateFixed, MapPin, MessageCircle, Maximize2, Navigation, Phone, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Notice, Skeleton, StatusBadge } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useDriverAction } from "./driver-action";
import { ScanInput } from "./barcode-scanner";
import { useGeoFix } from "./driver-arrival";
import { DeferForm, DeliverForm, FailForm, arriveRequest } from "./driver-stop-forms";
import { makeNextRequest } from "./driver-reorder";
import { StopRouteInfo } from "./driver-route";
import { codDueCents, findStopByScan, legPaths, movableStops, stopHasPoint, type PolicyInfo, type RouteGeometry } from "./driver-fieldops-utils";
import { RecipientBadge, Sheet, isOpenStop, mapsUrl, openWhatsApp, orderStops, type RouteInfo, type Stop } from "./driver-stops-shared";
import type { MapStop } from "./route-map";
import { fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";

// Leaflet touches `window` — it is only ever loaded in the browser.
const RouteMap = dynamic(() => import("./route-map"), { ssr: false, loading: () => <Skeleton className="h-80 w-full sm:h-[28rem]" /> });
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const stateOf = (s: Stop): MapStop["state"] => (s.current ? "current" : isOpenStop(s) ? "todo" : s.status === "delivered" ? "done" : "failed");
const DOT: Record<MapStop["state"], string> = { current: "bg-accent text-accent-ink border-white", todo: "bg-card text-ink border-cyan", done: "bg-slate-500 text-white border-slate-400", failed: "bg-danger/80 text-accent-ink border-danger" };

type Mode = "details" | "deliver" | "fail" | "defer";

/** The popup / bottom sheet of one shipment: its main details and every quick action allowed for it right now. */
function StopSheet({ stop, number, total, stops, route, offerId, policy, onClose, onAdvanced, onJob, onRefresh }: {
  stop: Stop; number: number; total: number; stops: Stop[]; route: RouteInfo | null; offerId: string; policy: PolicyInfo;
  onClose: () => void; onAdvanced: (k: string) => void; onJob?: (job: any) => void; onRefresh: () => void;
}) {
  const { t, locale } = useI18n(); const a = useDriverAction();
  const [mode, setMode] = useState<Mode>("details");
  const arrived = !!stop.arrivedAt; const open = isOpenStop(stop); const cod = codDueCents(stop);
  const movable = movableStops(stops);
  const canMakeNext = !!route?.canReorder && open && !stop.current && movable.length > 1 && movable[0].id !== stop.id && movable.some((s) => s.id === stop.id);
  const back = () => setMode("details");
  const advanced = (k: string) => { onClose(); onAdvanced(k); };
  const arrive = () => a.run("arrive", () => arriveRequest(offerId, stop.id), { success: "dstop.arrived_ok", onDone: () => onRefresh() });
  const makeNext = () => a.run("mk", () => makeNextRequest(offerId, stops, stop.id), {
    onDone: (res) => { toast.success(t("fod.make_next_ok")); onClose(); if (res.job) onJob?.(res.job); else onRefresh(); },
    onError: () => onRefresh(),
  });
  const btn = "h-14 w-full text-base";

  return (
    <div data-testid="map-popup" data-code={stop.code} data-mode={mode} className="space-y-4">
      {mode !== "details" && <button type="button" data-testid="map-popup-back" onClick={back} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cyan"><ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />{t("common.back")}</button>}
      {mode === "details" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="ltr-num font-mono text-lg font-bold">{stop.code}</span>
            <StatusBadge status={stop.status} ns="shipstatus" />
            <RecipientBadge type={stop.recipientType} />
            {stop.current && <Badge tone="success">{t("fod.popup_current")}</Badge>}
            {stop.deferCount > 0 && <Badge tone="warn">{t("dstop.postponed_badge")}</Badge>}
          </div>
          <p className="flex items-start gap-2 text-base font-medium"><MapPin className="mt-0.5 size-5 shrink-0 text-cyan" aria-hidden /><span>{stop.address}{stop.city && <span className="text-muted"> · {t(`city.${stop.city}`)}</span>}</span></p>
          <StopRouteInfo stop={stop} first={number === 1} hint />
          {cod > 0 && <p data-testid="map-popup-cod" className="flex items-center justify-between gap-2 rounded-xl border-2 border-gold bg-gold/10 px-3 py-2.5 text-sm font-semibold text-gold"><span className="flex items-center gap-2"><HandCoins className="size-5" aria-hidden />{t("fod.popup_cod")}</span><span className="ltr-num text-lg font-extrabold text-ink">{fmtMoney(cod, locale)}</span></p>}
          {(stop.recipientName || stop.recipientPhone || stop.contents || stop.notes) && (
            <dl className="space-y-2 rounded-xl bg-bg2 p-3 text-sm">
              {stop.recipientName && <div><dt className="text-xs text-muted">{t("job.recipient")}</dt><dd className="font-medium">{stop.recipientName}{stop.recipientPhone && <span className="ltr-num ms-2 text-muted">{stop.recipientPhone}</span>}</dd></div>}
              {stop.contents && <div><dt className="text-xs text-muted">{t("dstop.contents")}</dt><dd className="font-medium">{stop.contents}</dd></div>}
              {stop.notes && <div><dt className="text-xs text-muted">{t("dstop.notes")}</dt><dd className="font-medium">{stop.notes}</dd></div>}
            </dl>
          )}
          {!stop.current && open && route && route.planned && <p className="text-xs text-muted">{t("fod.popup_locked")}</p>}

          <div className="grid grid-cols-2 gap-2" data-testid="map-popup-actions">
            <a data-testid="map-popup-navigate" href={mapsUrl(stop)} target="_blank" rel="noreferrer" className={cn("inline-flex items-center justify-center gap-2 rounded-xl border-2 border-line bg-bg2 font-semibold hover:border-accent/60", btn)}><Navigation className="size-5 rtl:-scale-x-100" aria-hidden />{t("fod.navigate")}</a>
            {stop.current && stop.recipientPhone && <a data-testid="map-popup-call" href={`tel:${stop.recipientPhone}`} className={cn("inline-flex items-center justify-center gap-2 rounded-xl border-2 border-cyan/60 bg-cyan/10 font-semibold text-cyan", btn)}><Phone className="size-5" aria-hidden />{t("fod.call")}</a>}
            {stop.current && stop.recipientPhone && <Button data-testid="map-popup-whatsapp" type="button" variant="secondary" className={cn("border-2", btn)} onClick={() => openWhatsApp(offerId, stop.id, "contact", locale, t)}><MessageCircle className="size-5" aria-hidden />{t("dstop.whatsapp")}</Button>}
            {stop.current && !arrived && <Button data-testid="map-popup-arrive" className={btn} loading={a.is("arrive")} onClick={arrive}><LocateFixed className="size-5" aria-hidden />{t("act.checkin")}</Button>}
            {stop.current && arrived && <Button data-testid="map-popup-deliver" className={btn} onClick={() => setMode("deliver")}>{t("dstop.deliver")}</Button>}
            {stop.current && <Button data-testid="map-popup-fail" type="button" variant="danger" className={btn} onClick={() => setMode("fail")}><TriangleAlert className="size-5" aria-hidden />{t("dstop.cant_deliver")}</Button>}
            {stop.current && stop.canDefer && <Button data-testid="map-popup-defer" type="button" variant="secondary" className={btn} onClick={() => setMode("defer")}>{t("dstop.postpone")}</Button>}
            {canMakeNext && <Button data-testid="map-popup-make-next" type="button" variant="secondary" className={cn("border-2 border-accent/50 text-accent", btn)} loading={a.is("mk")} onClick={makeNext}><ChevronsUp className="size-5" aria-hidden />{t("fod.make_next")}</Button>}
          </div>
        </>
      )}
      {mode === "deliver" && <DeliverForm key={stop.arrivedAt} embedded stop={stop} offerId={offerId} onAdvanced={advanced} onRefresh={onRefresh} />}
      {mode === "fail" && <FailForm stop={stop} offerId={offerId} policy={policy} arrived={arrived} onAdvanced={advanced} onRefresh={onRefresh} onClose={back} />}
      {mode === "defer" && <DeferForm stop={stop} offerId={offerId} policy={policy} onClose={back} onRefresh={onRefresh} onDone={() => advanced("dstop.deferred_ok")} />}
      <span className="sr-only" aria-live="polite">{t("dstop.stop_x_of_n", { x: number, n: total })}</span>
    </div>
  );
}

/**
 * E6 — the whole route on a map: numbered markers, coloured leg lines (Google geometry, dashed straight lines for estimates), the driver's own
 * position, fit / locate buttons, and a list row per stop with its leg time / distance and a navigate button. A tap on a marker or row opens the shipment popup.
 */
export function RouteMapPanel({ stops, route, offerId, policy, onAdvanced, onJob, onRefresh }: {
  stops: Stop[]; route: RouteInfo | null; offerId: string; policy: PolicyInfo; onAdvanced: (k: string) => void; onJob?: (job: any) => void; onRefresh: () => void;
}) {
  const { t, locale } = useI18n();
  const ordered = useMemo(() => orderStops(stops), [stops]);
  const numberOf = useMemo(() => new Map(ordered.map((s, i) => [s.id, i + 1])), [ordered]);
  const geometry = useApi<RouteGeometry>(`/driver/jobs/${offerId}/route-geometry`, { revalidateOnFocus: false, keepPreviousData: true });
  const gps = useGeoFix(true);
  const [sel, setSel] = useState<string | null>(null);
  const [signals, setSignals] = useState({ fit: 0, locate: 0, focus: 0, focusId: null as string | null });
  const [jump, setJump] = useState("");

  // The order or the set of open stops changed (re-optimise, manual order, a stop finished): the lines on the map must follow.
  const orderSig = ordered.filter(isOpenStop).map((s) => s.id).join(",");
  const seen = useRef(orderSig);
  const reload = geometry.mutate;
  useEffect(() => { if (seen.current !== orderSig) { seen.current = orderSig; void reload(); } }, [orderSig, reload]);

  const mapStops: MapStop[] = ordered.filter(stopHasPoint).map((s) => ({ id: s.id, code: s.code, n: numberOf.get(s.id) ?? 0, lat: s.lat as number, lng: s.lng as number, state: stateOf(s) }));
  const legs = useMemo(() => legPaths(geometry.data?.legs), [geometry.data]);
  const open = ordered.filter(isOpenStop); const finished = ordered.filter((s) => !isOpenStop(s));
  const unplotted = open.filter((s) => !stopHasPoint(s)).length;
  const selected = sel ? ordered.find((s) => s.id === sel) ?? null : null;
  const pick = (id: string) => setSel(id);
  const me = gps.fix ? { lat: gps.fix.lat, lng: gps.fix.lng } : null;
  const locate = () => { if (me) setSignals((s) => ({ ...s, locate: s.locate + 1 })); else { gps.retry(); toast.info(t(gps.status === "denied" ? "fod.loc_denied" : "fod.geo_locating")); } };
  const doJump = (raw: string) => {
    const s = findStopByScan(ordered, raw);
    if (!s) { toast.error(t("fod.jump_none")); return; }
    setJump(""); setSignals((x) => ({ ...x, focus: x.focus + 1, focusId: s.id })); setSel(s.id);
  };

  const row = (s: Stop) => {
    const n = numberOf.get(s.id) ?? 0; const st = stateOf(s); const cod = codDueCents(s);
    return (
      <li key={s.id} data-testid="map-row" data-code={s.code} data-state={st} className={cn("flex items-stretch gap-2 rounded-card border bg-card", s.current ? "border-accent/60" : "border-line", !isOpenStop(s) && "opacity-70")}>
        <button type="button" data-testid="map-row-open" data-code={s.code} onClick={() => pick(s.id)} className="flex min-w-0 flex-1 items-start gap-3 p-3 text-start">
          <span className={cn("ltr-num flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold", DOT[st])} aria-label={t("dstop.stop_x_of_n", { x: n, n: ordered.length })}>{fmtNum(n, locale)}</span>
          <span className="min-w-0 flex-1 space-y-1 text-sm">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="ltr-num font-mono font-bold">{s.code}</span>{s.current && <Badge tone="success">{t("fod.popup_current")}</Badge>}{cod > 0 && <Badge tone="warn"><HandCoins className="size-3" aria-hidden /><span className="ltr-num">{fmtMoney(cod, locale)}</span></Badge>}{!isOpenStop(s) && <StatusBadge status={s.status} ns="shipstatus" />}</span>
            {s.recipientName && <span className="block font-medium">{s.recipientName}</span>}
            <span className="block text-muted">{s.address}</span>
            {isOpenStop(s) && <StopRouteInfo stop={s} first={n === 1} />}
          </span>
        </button>
        <a data-testid="map-row-navigate" data-code={s.code} href={mapsUrl(s)} target="_blank" rel="noreferrer" aria-label={`${t("fod.navigate")} ${s.code}`} className="flex w-14 shrink-0 items-center justify-center rounded-e-card border-s border-line text-cyan hover:bg-bg2"><Navigation className="size-6 rtl:-scale-x-100" aria-hidden /></a>
      </li>
    );
  };

  return (
    <div className="space-y-4" data-testid="route-map-view">
      <ScanInput value={jump} onChange={setJump} onSubmit={doJump} onScan={(c) => { doJump(c); }} fillOnScan={false} label={t("fod.jump_label")} placeholder={t("fod.jump_placeholder")}
        submitLabel={t("fod.jump_go")} testId="jump-input" cameraTestId="jump-camera" submitTestId="jump-submit" inputClassName="h-12 text-base" sheetTitle={t("dstop.scan_title")} />
      <div className="relative isolate z-0 overflow-hidden rounded-2xl border border-line">
        <RouteMap stops={mapStops} legs={legs} origin={geometry.data?.origin ?? null} me={me} selectedId={sel} onSelect={pick} fitSignal={signals.fit} locateSignal={signals.locate} focusId={signals.focusId} focusSignal={signals.focus}
          tileUrl={TILE_URL} labels={{ me: t("fod.map_me"), origin: t("fod.map_origin"), map: t("fod.map_label") }} />
        <div className="absolute end-3 top-3 z-[500] flex flex-col gap-2">
          <button type="button" data-testid="map-fit" onClick={() => setSignals((s) => ({ ...s, fit: s.fit + 1 }))} aria-label={t("fod.map_fit")} className="flex size-11 items-center justify-center rounded-xl border border-line bg-card text-ink shadow-lg"><Maximize2 className="size-5" aria-hidden /></button>
          <button type="button" data-testid="map-locate" onClick={locate} aria-label={t("fod.map_locate")} className={cn("flex size-11 items-center justify-center rounded-xl border bg-card shadow-lg", me ? "border-line text-ink" : "border-gold/60 text-gold")}><LocateFixed className="size-5" aria-hidden /></button>
        </div>
      </div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label={t("fod.map_legend")}>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-accent" aria-hidden />{t("fod.legend_current")}</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-full border-2 border-cyan bg-card" aria-hidden />{t("fod.legend_todo")}</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-slate-500" aria-hidden />{t("fod.legend_done")}</li>
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dashed border-muted" aria-hidden />{t("fod.legend_estimate")}</li>
      </ul>
      {gps.status === "denied" && <p role="status" className="text-xs text-gold">{t("fod.map_loc_denied")}</p>}
      {geometry.error && !geometry.data && <Notice tone="warn">{t("fod.map_no_geometry")}</Notice>}
      {unplotted > 0 && <div data-testid="map-unplotted"><Notice tone="warn">{t("fod.map_unlocated", { n: fmtNum(unplotted, locale) })}</Notice></div>}

      <ol className="space-y-2" data-testid="map-list">{open.map(row)}</ol>
      {finished.length > 0 && (
        <details className="group rounded-card border border-line bg-card">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden"><span className="flex items-center gap-2">{t("dstop.done")}<Badge>{fmtNum(finished.length, locale)}</Badge></span><ChevronDown className="size-5 text-muted transition group-open:rotate-180" aria-hidden /></summary>
          <ol className="space-y-2 border-t border-line p-2">{finished.map(row)}</ol>
        </details>
      )}

      <Sheet open={!!selected} onClose={() => setSel(null)} title={selected ? t("fod.popup_title", { n: numberOf.get(selected.id) ?? 0, code: selected.code }) : ""}>
        {selected && <StopSheet key={selected.id} stop={selected} number={numberOf.get(selected.id) ?? 0} total={ordered.length} stops={ordered} route={route} offerId={offerId} policy={policy}
          onClose={() => setSel(null)} onAdvanced={onAdvanced} onJob={onJob} onRefresh={onRefresh} />}
      </Sheet>
    </div>
  );
}
