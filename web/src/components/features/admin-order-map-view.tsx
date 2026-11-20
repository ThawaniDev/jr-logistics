"use client";
import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";
import { EmptyState, Skeleton } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import type { MapLine, MapPoint, MapTone } from "./admin-order-map";

// Leaflet touches `window`: it is only ever loaded in the browser.
const Canvas = dynamic(() => import("./admin-order-map"), { ssr: false, loading: () => <Skeleton className="h-72 w-full sm:h-96" /> });
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DOT: Record<MapTone, string> = { accent: "bg-accent", cyan: "bg-cyan", gold: "bg-gold", danger: "bg-danger", muted: "bg-muted" };

export type { MapLine, MapPoint, MapTone };
/** A small map with a legend. `legend` lists the colours used (tone + text); with no points an empty state explains why. */
export function OrderMap({ points, lines, legend, onSelect, label, emptyHint, height }: {
  points: MapPoint[]; lines?: MapLine[]; legend?: Array<{ tone: MapTone; label: string }>; onSelect?: (p: MapPoint) => void; label: string; emptyHint?: string; height?: string;
}) {
  const { t } = useI18n();
  if (!points.length && !(lines ?? []).some((l) => l.points.length)) return <EmptyState icon={<MapPin className="size-9" aria-hidden />} title={t("dv1.map_empty")} hint={emptyHint} />;
  return (
    <div className="space-y-2">
      <div className="relative isolate z-0 overflow-hidden rounded-xl border border-line"><Canvas points={points} lines={lines} onSelect={onSelect} tileUrl={TILE_URL} label={label} height={height} /></div>
      {legend && legend.length > 0 && (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label={t("dv1.map_legend")}>
          {legend.map((l) => <li key={l.label} className="flex items-center gap-1.5"><span className={cn("size-2.5 rounded-full", DOT[l.tone])} aria-hidden />{l.label}</li>)}
        </ul>
      )}
    </div>
  );
}
