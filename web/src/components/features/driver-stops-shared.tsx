"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Badge, errText } from "@/components/ui";
import { ApiError, get } from "@/lib/api";
import { useT } from "@/i18n/provider";

/** One stop of a per-parcel job, exactly as `GET /driver/jobs/:id` returns it (see memory/SHIPMENTS_API.md). */
export interface Stop {
  id: string; seq: number; stopOrder: number; code: string; status: string; recipientType: "consumer" | "business";
  address: string; city: string | null; lat: number | null; lng: number | null; contents: string | null; notes: string | null;
  /** Best route: has coordinates (false = placed last, address needs checking), where they came from, and the driving leg INTO this stop. */
  located?: boolean; geoSource?: "given" | "geocoded" | "geocoded_approx" | null; legDistanceM?: number | null; legDurationS?: number | null;
  recipientName: string | null; recipientPhone: string | null; current: boolean; attempts: number; deferCount: number; canDefer: boolean;
  arrivedAt: string | null; waitRemainingSec: number | null; proofMode: "code" | "code_or_receipt" | "scan"; hasProof: boolean;
  otpAttemptsLeft: number; canResend: boolean; deliveredAt: string | null; failReason: string | null; failNote: string | null;
  /** Field operations (E9, E10, E17): delivery code required?, signature required?, cash to collect / already collected (halalas). */
  needsOtp?: boolean; needsSignature?: boolean; codCents?: number | null; codCollectedCents?: number | null;
}
/** `route` of a per-parcel job (`GET /driver/jobs/:id`, `POST /offers/:id/route/optimize` → job.route). */
export interface RouteInfo {
  planned: boolean; provider: "google_routes" | "local_heuristic" | "mixed" | "manual" | null; plannedAt: string | null; by: "system" | "driver" | null;
  totalDistanceM: number; totalDurationS: number; remainingDistanceM: number; remainingDurationS: number; chunks: number;
  unlocated: number; approximate: number; warnings: string[]; googleConfigured: boolean; canOptimize: boolean;
  /** E5: the driver may re-order the remaining stops; `manual` = the current order was set by hand. */
  canReorder?: boolean; manual?: boolean;
}
export interface StopsSummary { total: number; pending: number; loaded: number; delivered: number; failed: number; returned: number; missing: number }

/** Server order is already stopOrder, seq — sorted again so a re-ordered response can never reshuffle the route on screen. */
export const orderStops = (stops: Stop[]) => [...stops].sort((a, b) => a.stopOrder - b.stopOrder || a.seq - b.seq);
export const isOpenStop = (s: Stop) => s.status === "loaded" || s.status === "pending";
export const isFailedStop = (s: Stop) => ["failed", "returned", "missing"].includes(s.status);

/** Delivered / not delivered / still to do, derived from the server's own summary (never typed by the driver). */
export function progressOf(sum: StopsSummary) {
  const delivered = sum.delivered;
  const failed = sum.failed + sum.returned + sum.missing;
  const remaining = Math.max(0, sum.total - delivered - failed);
  return { total: sum.total, delivered, failed, remaining, done: delivered + failed };
}

/**
 * Best-effort position. Never blocks the driver: denied / unavailable / slow all resolve to "no location".
 * The browser's own timeout does not run while a permission prompt is open, so a hard cap guarantees we never wait longer than `timeoutMs` + 1.5 s.
 */
export async function getPosition(timeoutMs = 4000): Promise<{ lat?: number; lng?: number }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (typeof navigator === "undefined" || !navigator.geolocation) return {};
    const geo = new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: timeoutMs, maximumAge: 120_000 }));
    const cap = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("position timeout")), timeoutMs + 1500); });
    const p = await Promise.race([geo, cap]);
    return { lat: p.coords.latitude, lng: p.coords.longitude };
  } catch { return {}; } finally { clearTimeout(timer); }
}

/** Google Maps universal link: opens the Google Maps app on Android/iOS when installed, otherwise the web map (which offers Apple Maps on iOS). */
export function mapsUrl(s: { lat: number | null; lng: number | null; address: string; city?: string | null }) {
  if (s.lat != null && s.lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`;
}

/** Opens a WhatsApp chat with the CURRENT stop's recipient (the server refuses any other stop: STOP_LOCKED). */
export async function openWhatsApp(offerId: string, stopId: string, kind: "contact" | "arriving" | "issue", locale: string, t: (k: string, v?: Record<string, string | number>) => string) {
  try { const r = await get(`/driver/jobs/${offerId}/whatsapp?shipmentId=${stopId}&kind=${kind}&lang=${locale}`); window.open(r.url, "_blank", "noopener"); }
  catch (e) { toast.error(e instanceof ApiError && e.code === "STOP_LOCKED" ? errText(e, t) : t("job.wa_unavailable")); }
}

export function RecipientBadge({ type }: { type: string }) {
  const t = useT();
  return <Badge tone={type === "business" ? "info" : "success"}>{t(`rtype.${type}`)}</Badge>;
}

export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/**
 * Live countdown. `initialSec` is read once when the component mounts (mount it when the data is fresh — e.g. when a sheet opens);
 * `restart` re-arms it from a server value (WAIT_REQUIRED details). null = nothing to wait for.
 */
export function useCountdown(initialSec: number | null) {
  const [end, setEnd] = useState<number | null>(() => (initialSec == null ? null : Date.now() + initialSec * 1000));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (end == null) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [end]);
  const remaining = end == null ? 0 : Math.max(0, Math.ceil((end - now) / 1000));
  const restart = (sec: number) => { const n = Date.now(); setNow(n); setEnd(n + sec * 1000); };
  return { remaining, restart };
}

/**
 * Bottom sheet on phones, centred dialog on larger screens. Native <dialog>: focus trap, ESC and inert background for free.
 * Children are mounted only while open, so their local state (form fields, countdowns, camera) resets on every open.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal(); else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-label={title}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border border-line bg-card p-0 text-ink backdrop:bg-black/75 sm:m-auto sm:max-w-lg sm:rounded-3xl">
      {open && (
        <div>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-card px-5 py-4"><h2 className="text-lg font-bold">{title}</h2><button type="button" onClick={onClose} className="rounded-lg p-2 text-muted hover:text-ink" aria-label={t("common.close")}><X className="size-5" /></button></div>
          <div className="space-y-4 px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/** Sticky bottom action bar: the one primary button of the current step stays under the thumb while the list scrolls. */
export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-bg2/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border" data-testid="stop-action-bar">{children}</div>;
}

/** Same look as the ui-kit inputs, but big enough for a phone held in one hand in direct sun. */
export const fieldCls = "w-full rounded-xl border-2 border-line bg-bg2 px-3 text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none disabled:opacity-60 aria-[invalid=true]:border-danger";
