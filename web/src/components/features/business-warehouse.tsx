"use client";
import { useState } from "react";
import Link from "next/link";
import { ExternalLink, LocateFixed, MapPin, ShieldCheck } from "lucide-react";
import { Badge, Button, ErrorState, Input, Notice, Section, Skeleton, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError, put } from "@/lib/api";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { formatLatLng, isShortMapsLink, mapsUrl, parseCoordinate, parseCoordinates, round6, validateLatLng } from "./business-fieldops-lib";

/** Effective per-warehouse switches (`GET /business/overview` → `ops`, E1/E2/E3/E9/E10). Read-only for the warehouse. */
export interface WarehouseOps { requireArrivalConfirmation?: boolean; requireLoadingRecord?: boolean; requireDeliveryOtp?: boolean; requireSignature?: boolean }

/**
 * Where the warehouse is and how strictly the platform checks drivers against it. `missing` is true only when the server said "no location"
 * (`warehouse: null`) — an older server that does not send the field never shows a warning.
 */
export function useWarehouse() {
  const ov = useApi("/business/overview", { revalidateOnFocus: true }); const cat = useApi("/catalog"); // focus refresh: the owner may have set the pin in another tab
  const policy = (cat.data?.policy ?? {}) as { arrivalRadiusM?: number; arrivalGeofenceEnabled?: boolean };
  const wh: { lat: number; lng: number } | null | undefined = ov.data ? ov.data.warehouse : undefined;
  return {
    ov, loading: !ov.data, saved: wh ?? null, missing: wh === null,
    ops: (ov.data?.ops ?? null) as WarehouseOps | null,
    radiusM: typeof policy.arrivalRadiusM === "number" ? policy.arrivalRadiusM : null,
    geofence: policy.arrivalGeofenceEnabled !== false,
  };
}

/** "Your warehouse has no location yet" — shown wherever that stops an order (wizard, dashboard, a publish that was refused). */
export function WarehouseLocationNotice({ tone = "warn", always = false, newTab = false }: { tone?: "warn" | "danger"; always?: boolean; newTab?: boolean }) {
  const { t } = useI18n(); const w = useWarehouse();
  if (!always && !(w.missing && w.geofence)) return null;
  return (
    <div data-testid="warehouse-missing-notice">
      <Notice tone={tone} title={t("fob.wh_missing_title")}>
        {t("fob.wh_missing_body")} <Link href="/business/profile#warehouse" {...(newTab ? { target: "_blank", rel: "noopener" } : {})} className="font-semibold text-cyan underline">{t("fob.wh_set_now")}</Link>
      </Notice>
    </div>
  );
}

const geoKey = (code: number) => (code === 1 ? "fob.geo_denied" : code === 3 ? "fob.geo_timeout" : "fob.geo_unavailable");

/** Warehouse location card (Profile page). Keyed by the saved point so the form re-initialises after every save. */
export function WarehouseLocationCard() {
  const w = useWarehouse();
  if (w.ov.error) return <div id="warehouse" className="scroll-mt-24"><ErrorState error={w.ov.error} retry={() => w.ov.mutate()} /></div>;
  if (w.loading) return <div id="warehouse" className="scroll-mt-24"><Section title={<Skeleton className="h-5 w-40" />}><Skeleton className="h-40" /></Section></div>;
  return <LocationForm key={w.saved ? `${w.saved.lat},${w.saved.lng}` : "none"} saved={w.saved} known={w.ov.data?.warehouse !== undefined} radiusM={w.radiusM} geofence={w.geofence} reload={() => w.ov.mutate()} />;
}

function LocationForm({ saved, known, radiusM, geofence, reload }: { saved: { lat: number; lng: number } | null; known: boolean; radiusM: number | null; geofence: boolean; reload: () => void }) {
  const { t, locale } = useI18n(); const a = useAction();
  const [lat, setLat] = useState(saved ? String(saved.lat) : ""); const [lng, setLng] = useState(saved ? String(saved.lng) : "");
  const [paste, setPaste] = useState(""); const [touched, setTouched] = useState(false); const [show, setShow] = useState(false);
  const [locating, setLocating] = useState(false); const [geoErr, setGeoErr] = useState<string | null>(null); const [accuracy, setAccuracy] = useState<number | null>(null);
  const [serverErr, setServerErr] = useState<{ lat?: string; lng?: string }>({});

  const v = validateLatLng(lat, lng);
  const dirty = !saved || !v.ok || round6(saved.lat) !== v.lat || round6(saved.lng) !== v.lng;
  const fill = (p: { lat: number; lng: number }) => { setLat(String(p.lat)); setLng(String(p.lng)); setServerErr({}); setGeoErr(null); setAccuracy(null); };
  const parsedPaste = paste.trim() ? parseCoordinates(paste) : null;
  const onPaste = (text: string) => {
    setPaste(text);
    const p = text.trim() ? parseCoordinates(text) : null;
    if (p) fill(p);
  };
  // Pasting a pair ("24.71, 46.67") or a link straight into one of the two boxes fills both.
  const onBoxPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const txt = e.clipboardData.getData("text");
    if (parseCoordinate(txt) != null) return;
    const p = parseCoordinates(txt);
    if (p) { e.preventDefault(); fill(p); setPaste(""); }
  };
  const locate = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) { setGeoErr("fob.geo_unsupported"); return; }
    setLocating(true); setGeoErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { fill({ lat: round6(pos.coords.latitude), lng: round6(pos.coords.longitude) }); setAccuracy(Math.round(pos.coords.accuracy)); setPaste(""); setLocating(false); },
      (err) => { setGeoErr(geoKey(err.code)); setLocating(false); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };
  const save = () => {
    setShow(true);
    if (!v.ok) return;
    return a.run("save", () => put("/business/warehouse", { lat: v.lat, lng: v.lng }), {
      success: "common.saved", onDone: reload,
      onError: (e) => { if (e instanceof ApiError && e.code === "VALIDATION") { const f = String(e.details.field ?? ""); setServerErr({ ...(f.includes("lat") ? { lat: "fob.val_lat" } : {}), ...(f.includes("lng") ? { lng: "fob.val_lng" } : {}) }); } },
    });
  };
  const err = (f: "lat" | "lng") => { const k = serverErr[f] ?? (show ? v.errors[f] : undefined); return k ? t(k) : undefined; };
  const current = v.ok ? { lat: v.lat as number, lng: v.lng as number } : saved;
  const shortLink = !parsedPaste && isShortMapsLink(paste);

  return (
    <div id="warehouse" className="scroll-mt-24" data-testid="warehouse-card">
    <Section title={<span className="flex items-center gap-2"><MapPin className="size-5 text-accent" aria-hidden />{t("fob.wh_title")}</span>} description={t("fob.wh_intro")}
      actions={known ? (saved ? <Badge tone="success"><span data-testid="wh-state">{t("fob.wh_state_set")}</span></Badge> : <Badge tone="warn"><span data-testid="wh-state">{t("fob.wh_state_missing")}</span></Badge>) : undefined}>
    <div className="space-y-4">
      {!geofence
        ? <Notice tone="info">{t("fob.wh_geofence_off")}</Notice>
        : <Notice tone="info"><span data-testid="wh-radius-note">{radiusM != null ? t("fob.wh_radius", { n: fmtNum(radiusM, locale) }) : t("fob.wh_radius_generic")}</span></Notice>}
      {known && !saved && <Notice tone="warn" title={t("fob.wh_missing_title")}>{t("fob.wh_missing_body_short")}</Notice>}
      {saved && <p className="text-sm text-muted">{t("fob.wh_saved_at")}: <span className="ltr-num font-medium text-ink" dir="ltr" data-testid="wh-saved">{formatLatLng(saved.lat, saved.lng)}</span></p>}

      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <Input label={t("fob.wh_paste_label")} ltr dir="ltr" value={paste} onChange={(e) => onPaste(e.target.value)} onBlur={() => setTouched(true)} placeholder="https://www.google.com/maps/@24.7136,46.6753,15z  |  24.7136, 46.6753" hint={t("fob.wh_paste_hint")} autoComplete="off" spellCheck={false} data-testid="wh-paste"
          error={touched && paste.trim() && !parsedPaste && !shortLink ? t("fob.wh_paste_bad") : undefined} />
        {shortLink && <Notice tone="warn">{t("fob.wh_short_link")}</Notice>}
        {parsedPaste && <p role="status" className="text-xs text-accent" data-testid="wh-recognised">{t("fob.wh_recognised", { pos: formatLatLng(parsedPaste.lat, parsedPaste.lng) })}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t("fob.wh_lat")} ltr inputMode="decimal" value={lat} onChange={(e) => { setLat(e.target.value); setServerErr({}); }} onPaste={onBoxPaste} error={err("lat")} placeholder="24.7136" required data-testid="wh-lat" />
          <Input label={t("fob.wh_lng")} ltr inputMode="decimal" value={lng} onChange={(e) => { setLng(e.target.value); setServerErr({}); }} onPaste={onBoxPaste} error={err("lng")} placeholder="46.6753" required data-testid="wh-lng" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" loading={locating} onClick={locate} data-testid="wh-geo"><LocateFixed className="size-4" aria-hidden />{t("fob.wh_use_current")}</Button>
          {current && <a href={mapsUrl(current.lat, current.lng)} target="_blank" rel="noopener noreferrer" data-testid="wh-view-map" className={cn("inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-bg2 px-4 text-sm hover:border-accent/60 hover:bg-card")}><ExternalLink className="size-4" aria-hidden />{t("fob.wh_view_map")}</a>}
          <Button type="submit" loading={a.is("save")} disabled={!dirty && !!saved} className="ms-auto" data-testid="wh-save">{t("fob.wh_save")}</Button>
        </div>
        {geoErr && <Notice tone="warn"><span data-testid="wh-geo-error">{t(geoErr)}</span></Notice>}
        {accuracy != null && <p role="status" className="text-xs text-muted">{t("fob.wh_accuracy", { n: fmtNum(accuracy, locale) })}</p>}
      </form>
    </div>
    </Section>
    </div>
  );
}

const SWITCHES = [
  ["requireArrivalConfirmation", "fob.op_arrival"], ["requireLoadingRecord", "fob.op_loading"], ["requireDeliveryOtp", "fob.op_otp"], ["requireSignature", "fob.op_signature"],
] as const;

/** Read-only "How JR operates your warehouse": the effective switches with a plain sentence each. JR support changes them. */
export function WarehouseOpsCard() {
  const { t } = useI18n(); const w = useWarehouse();
  if (w.loading) return <Section title={<Skeleton className="h-5 w-40" />}><Skeleton className="h-32" /></Section>;
  if (!w.ops) return null;
  const ops = w.ops;
  return (
    <div data-testid="warehouse-ops">
      <Section title={<span className="flex items-center gap-2"><ShieldCheck className="size-5 text-cyan" aria-hidden />{t("fob.ops_title")}</span>} description={t("fob.ops_intro")}>
        <ul className="divide-y divide-line">
          {SWITCHES.map(([k, key]) => {
            const on = !!ops[k];
            return (
              <li key={k} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3 first:pt-0" data-testid={`ops-${k}`} data-on={on ? "1" : "0"}>
                <div className="min-w-0 flex-1"><p className="text-sm font-medium">{t(key)}</p><p className="text-xs text-muted">{t(`${key}_${on ? "on" : "off"}`)}</p></div>
                <Badge tone={on ? "success" : "neutral"}>{t(on ? "fob.on" : "fob.off")}</Badge>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs text-muted">{t("fob.ops_support_note")} <Link href="/business/support" className="font-semibold text-cyan underline">{t("nav.support")}</Link></p>
      </Section>
    </div>
  );
}
