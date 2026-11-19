"use client";
import { useState } from "react";
import { Camera, ImageOff, PenLine } from "lucide-react";
import { Button, Modal, Notice, Skeleton } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";

/** Evidence the driver attached to a parcel (E7, E10): `GET /shipments/:id/media`, image bytes at `/shipments/:id/media/:mid`. */
export interface MediaItem { id: string; kind: string; note: string | null; createdAt: string; byName: string | null }
export const mediaUrl = (shipmentId: string, mediaId: string) => `/api/v1/shipments/${encodeURIComponent(shipmentId)}/media/${encodeURIComponent(mediaId)}`;
/** Unknown kinds fall back to the neutral label rather than a raw key. */
export const mediaKindKey = (kind: string) => (["defer", "fail", "signature"].includes(kind) ? `fob.media_${kind}` : "fob.media_other");

export interface LightboxTarget { shipmentId: string; mediaId: string; kind?: string; note?: string | null; at?: string | null; by?: string | null }

/** Full-size picture with the driver's note. Mount only while open. */
export function MediaLightbox({ target, onClose }: { target: LightboxTarget; onClose: () => void }) {
  const { t, locale } = useI18n(); const [failed, setFailed] = useState(false);
  return (
    <Modal open onClose={onClose} title={target.kind ? t(mediaKindKey(target.kind)) : t("fob.media_title")} footer={<Button variant="ghost" onClick={onClose} data-testid="media-close">{t("common.close")}</Button>}>
      <div data-testid="media-lightbox" className="space-y-3">
        {failed ? <Notice tone="warn">{t("fob.media_load_failed")}</Notice> : (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin stream, not an optimisable static asset
          <img src={mediaUrl(target.shipmentId, target.mediaId)} alt={t("fob.media_alt")} className={cn("max-h-[70vh] w-full rounded-xl border border-line bg-bg2 object-contain", target.kind === "signature" && "bg-white")} onError={() => setFailed(true)} />
        )}
        {target.note && <p className="whitespace-pre-line rounded-xl bg-bg2 p-3 text-sm" data-testid="media-note">{target.note}</p>}
        {(target.by || target.at) && <p className="text-xs text-muted">{[target.by, target.at ? fmtDateTime(target.at, locale) : null].filter(Boolean).join(" · ")}</p>}
      </div>
    </Modal>
  );
}

/** A small picture that opens the lightbox. Falls back to a camera tile when the file cannot be loaded. */
export function MediaThumb({ shipmentId, mediaId, label, onOpen, className }: { shipmentId: string; mediaId: string; label: string; onOpen: () => void; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <button type="button" onClick={onOpen} aria-label={label} title={label} data-testid="media-thumb" data-media={mediaId}
      className={cn("group relative inline-flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-bg2 hover:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", className)}>
      {failed ? <ImageOff className="size-6 text-muted" aria-hidden /> : (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin stream, not an optimisable static asset
        <img src={mediaUrl(shipmentId, mediaId)} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} />
      )}
    </button>
  );
}

/** "Photos" of one parcel: postponement evidence, failed-attempt photos and the recipient's signature, each with the driver's note. */
export function ShipmentPhotos({ shipmentId, expected, onOpen }: { shipmentId: string; expected: boolean; onOpen: (t: LightboxTarget) => void }) {
  const { t, locale } = useI18n();
  const { data, error } = useApi<{ items: MediaItem[] }>(expected ? `/shipments/${shipmentId}/media` : null, { shouldRetryOnError: false });
  if (!expected || error) return null;
  if (!data) return <Skeleton className="h-24" />;
  if (data.items.length === 0) return null;
  return (
    <section aria-labelledby={`photos-${shipmentId}`} data-testid="shipment-photos">
      <h3 id={`photos-${shipmentId}`} className="mb-2 flex items-center gap-2 text-sm font-semibold"><Camera className="size-4 text-muted" aria-hidden />{t("fob.media_title")} <span className="text-xs font-normal text-muted tabular-nums">({data.items.length})</span></h3>
      <ul className="space-y-3">
        {data.items.map((m) => (
          <li key={m.id} className="flex items-start gap-3" data-testid="shipment-photo" data-kind={m.kind}>
            <MediaThumb shipmentId={shipmentId} mediaId={m.id} label={t(mediaKindKey(m.kind))} onOpen={() => onOpen({ shipmentId, mediaId: m.id, kind: m.kind, note: m.note, at: m.createdAt, by: m.byName })} />
            <div className="min-w-0 flex-1 text-sm">
              <p className="flex items-center gap-1.5 font-medium">{m.kind === "signature" && <PenLine className="size-3.5 text-muted" aria-hidden />}{t(mediaKindKey(m.kind))}</p>
              {m.note && <p className="mt-0.5 whitespace-pre-line text-muted">{m.note}</p>}
              <p className="mt-0.5 text-xs text-muted">{[m.byName, fmtDateTime(m.createdAt, locale)].filter(Boolean).join(" · ")}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
