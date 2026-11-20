"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";

/**
 * The Leaflet canvas of the order and parcel views. Client only (loaded through next/dynamic by admin-order-map-view.tsx). Colours are read from the design tokens
 * (`--jr-*` custom properties) when the map is created, so the map follows the theme and no colour is written here.
 */
export type MapTone = "accent" | "cyan" | "gold" | "danger" | "muted";
export interface MapPoint { id: string; lat: number; lng: number; tone: MapTone; label?: string; big?: boolean; href?: string }
export interface MapLine { points: Array<[number, number]>; tone: MapTone; dashed?: boolean }
export interface OrderMapProps { points: MapPoint[]; lines?: MapLine[]; onSelect?: (p: MapPoint) => void; tileUrl: string; label: string; height?: string }

const TOKEN: Record<MapTone, string> = { accent: "--jr-accent", cyan: "--jr-cyan", gold: "--jr-gold", danger: "--jr-danger", muted: "--jr-muted" };
const colorOf = (tone: MapTone) => { try { return getComputedStyle(document.documentElement).getPropertyValue(TOKEN[tone]).trim() || "currentColor"; } catch { return "currentColor"; } };

export default function OrderMapCanvas({ points, lines = [], onSelect, tileUrl, label, height = "h-72 sm:h-96" }: OrderMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const g = useRef<{ L: typeof Leaflet; map: Leaflet.Map; layer: Leaflet.LayerGroup } | null>(null);
  const live = useRef({ onSelect, points, lines });
  useEffect(() => { live.current = { onSelect, points, lines }; });
  // redraw (and re-fit) only when what is plotted really changed, not on every refresh of the page's data
  const sig = `${points.map((p) => `${p.id}:${p.lat}:${p.lng}:${p.tone}`).join("|")}#${lines.map((l) => `${l.tone}:${l.points.length}:${l.points[0]?.join(",") ?? ""}:${l.points.at(-1)?.join(",") ?? ""}`).join("|")}`;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false; let map: Leaflet.Map | null = null; let ro: ResizeObserver | null = null;
    (async () => {
      const L = await import("leaflet");
      if (disposed || !el.current) return;
      map = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([24.7136, 46.6753], 10);
      L.tileLayer(tileUrl, { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors' }).addTo(map);
      g.current = { L, map, layer: L.layerGroup().addTo(map) };
      if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(() => map?.invalidateSize()); ro.observe(el.current); }
      setReady(true);
    })();
    return () => { disposed = true; ro?.disconnect(); g.current = null; setReady(false); map?.remove(); };
  }, [tileUrl]);

  useEffect(() => {
    const m = g.current; if (!ready || !m) return;
    const { L, layer, map } = m; const { points, lines } = live.current;
    layer.clearLayers();
    for (const l of lines) L.polyline(l.points, { color: colorOf(l.tone), weight: 3, opacity: 0.85, dashArray: l.dashed ? "6 6" : undefined, interactive: false }).addTo(layer);
    const bounds: Array<[number, number]> = lines.flatMap((l) => l.points);
    for (const p of points) {
      const c = colorOf(p.tone);
      const mk = L.circleMarker([p.lat, p.lng], { radius: p.big ? 9 : 6, color: colorOf("muted"), weight: 1, fillColor: c, fillOpacity: 0.95, bubblingMouseEvents: false });
      if (p.label) mk.bindTooltip(p.label, { direction: "top" });
      if (live.current.onSelect) mk.on("click", () => live.current.onSelect?.(p));
      mk.addTo(layer); bounds.push([p.lat, p.lng]);
    }
    if (bounds.length === 1) map.setView(bounds[0], 15); else if (bounds.length) map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 16 });
  }, [ready, sig]);

  return <div ref={el} data-testid="dv1-map" data-ready={ready ? "1" : "0"} role="application" aria-label={label} className={`${height} w-full rounded-xl`} />;
}
