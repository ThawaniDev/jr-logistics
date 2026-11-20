"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";

/**
 * The Leaflet canvas of the delivery-point density grid. Client only: `GeoZones` loads it through `next/dynamic({ ssr: false })` and Leaflet is imported inside an effect, so
 * nothing here runs on the server. One rectangle per grid cell, drawn in the theme's accent colour (the opacity follows the number of parcels, the outline turns red where
 * deliveries fail often) — colours are CSS variables applied through the element's style, never raw colours. Same tile source as the driver's route map.
 */
export interface MapZone { id: string; south: number; north: number; west: number; east: number; parcels: number; failureRate: number | null; label: string; tip: string }
export interface GeoMapProps { zones: MapZone[]; selectedId: string | null; onSelect: (id: string) => void; tileUrl: string; label: string }

const FAIL_OUTLINE = 0.2;
/** Below this zoom a 5 km square is a speck, so every cell also gets a circle sized by its parcels; from here on the squares themselves are readable. */
const SQUARES_FROM_ZOOM = 11;
const opacityOf = (n: number, max: number) => (max > 0 ? 0.12 + 0.78 * Math.pow(n / max, 0.6) : 0.12);

export default function GeoMap({ zones, selectedId, onSelect, tileUrl, label }: GeoMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const g = useRef<{ L: typeof Leaflet; map: Leaflet.Map; layer: Leaflet.LayerGroup; dots: Leaflet.LayerGroup } | null>(null);
  const live = useRef(onSelect);
  useEffect(() => { live.current = onSelect; });
  const [ready, setReady] = useState(false);
  const fittedFor = useRef("");
  const zonesRef = useRef(zones);
  useEffect(() => { zonesRef.current = zones; });

  useEffect(() => {
    let disposed = false; let map: Leaflet.Map | null = null; let ro: ResizeObserver | null = null;
    (async () => {
      const L = await import("leaflet");
      if (disposed || !el.current) return;
      map = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([24.7136, 46.6753], 9);
      L.tileLayer(tileUrl, { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors' }).addTo(map);
      g.current = { L, map, layer: L.layerGroup().addTo(map), dots: L.layerGroup().addTo(map) };
      if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(() => map?.invalidateSize()); ro.observe(el.current); }
      setReady(true);
    })();
    return () => { disposed = true; ro?.disconnect(); g.current = null; setReady(false); map?.remove(); };
  }, [tileUrl]);

  useEffect(() => {
    const m = g.current; if (!ready || !m) return;
    const { L, layer, dots, map } = m;
    layer.clearLayers(); dots.clearLayers();
    const max = Math.max(0, ...zones.map((z) => z.parcels));
    const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
    for (const z of zones) {
      const hot = z.failureRate != null && z.failureRate >= FAIL_OUTLINE, on = z.id === selectedId;
      const rect = L.rectangle([[z.south, z.west], [z.north, z.east]], { weight: on ? 3 : 1, interactive: true, className: "jr-geo-cell" });
      rect.bindTooltip(esc(z.tip), { sticky: true });
      rect.on("click", () => live.current(z.id));
      rect.addTo(layer);
      const path = rect.getElement() as SVGElement | undefined;
      if (path) {
        path.style.fill = "var(--jr-accent)"; path.style.fillOpacity = String(opacityOf(z.parcels, max));
        path.style.stroke = on ? "var(--jr-text)" : hot ? "var(--jr-danger)" : "var(--jr-accent)"; path.style.strokeOpacity = on || hot ? "1" : "0.55";
        path.setAttribute("data-testid", "geo-cell"); path.setAttribute("data-zone", z.id); path.setAttribute("data-parcels", String(z.parcels));
      }
      const dot = L.circleMarker([(z.south + z.north) / 2, (z.west + z.east) / 2], { radius: 5 + 13 * Math.sqrt(max > 0 ? z.parcels / max : 0), weight: on || hot ? 2 : 1, interactive: true });
      dot.bindTooltip(esc(z.tip), { sticky: true });
      dot.on("click", () => live.current(z.id));
      dot.addTo(dots);
      const el = dot.getElement() as SVGElement | undefined;
      if (el) { el.style.fill = "var(--jr-accent)"; el.style.fillOpacity = String(0.25 + 0.5 * opacityOf(z.parcels, max)); el.style.stroke = on ? "var(--jr-text)" : hot ? "var(--jr-danger)" : "var(--jr-accent)"; el.setAttribute("data-testid", "geo-dot"); }
    }
    const key = zones.map((z) => z.id).join(",");
    if (fittedFor.current !== key && zones.length) {
      fittedFor.current = key;
      map.fitBounds(L.latLngBounds(zones.flatMap((z) => [[z.south, z.west], [z.north, z.east]] as Array<[number, number]>)), { padding: [24, 24], maxZoom: 12 });
    }
  }, [ready, zones, selectedId]);

  // circles while zoomed out, squares once they are big enough to read
  useEffect(() => {
    const m = g.current; if (!ready || !m) return;
    const { map, dots } = m;
    const sync = () => { if (map.getZoom() < SQUARES_FROM_ZOOM) { if (!map.hasLayer(dots)) dots.addTo(map); } else if (map.hasLayer(dots)) map.removeLayer(dots); };
    sync(); map.on("zoomend", sync);
    return () => { map.off("zoomend", sync); };
  }, [ready]);

  // choosing a zone (map or list) brings it into view
  useEffect(() => {
    const m = g.current; if (!ready || !m || !selectedId) return;
    const z = zonesRef.current.find((x) => x.id === selectedId);
    if (z) m.map.fitBounds([[z.south, z.west], [z.north, z.east]], { padding: [60, 60], maxZoom: 13 });
  }, [ready, selectedId]);

  return <div ref={el} data-testid="geo-map" data-ready={ready ? "1" : "0"} data-zones={zones.length} className="h-80 w-full rounded-2xl sm:h-[28rem]" role="application" aria-label={label} />;
}
