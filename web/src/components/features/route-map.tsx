"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import type { LatLng, LegPath } from "./driver-fieldops-utils";

/**
 * The Leaflet canvas of the driver's route map. Client only: it is loaded through `next/dynamic({ ssr: false })` by route-map-panel.tsx and imports
 * Leaflet inside an effect, so nothing here ever runs on the server. Markers are numbered `divIcon`s; the whole map is driven by props.
 */
export interface MapStop { id: string; code: string; n: number; lat: number; lng: number; state: "current" | "todo" | "done" | "failed" }
export interface RouteMapProps {
  stops: MapStop[]; legs: LegPath[]; origin: LatLng | null; me: LatLng | null;
  selectedId: string | null; onSelect: (id: string) => void;
  /** Bump to fit the whole route / to centre on the driver / to centre on `focusId`. */
  fitSignal: number; locateSignal: number; focusId: string | null; focusSignal: number;
  tileUrl: string; labels: { me: string; origin: string; map: string };
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const COLORS = { current: { bg: "#05e5a3", fg: "#04221a", ring: "#ffffff", size: 38 }, todo: { bg: "#151d34", fg: "#f8fafc", ring: "#00c5d5", size: 32 }, done: { bg: "#64748b", fg: "#e2e8f0", ring: "#94a3b8", size: 26 }, failed: { bg: "#7f1d1d", fg: "#fecaca", ring: "#f87171", size: 26 } } as const;

function stopIcon(L: typeof Leaflet, s: MapStop, selected: boolean) {
  const c = COLORS[s.state]; const size = c.size + (selected ? 6 : 0);
  const html = `<div data-testid="map-marker" data-code="${esc(s.code)}" data-state="${s.state}" data-current="${s.state === "current" ? "1" : "0"}" data-selected="${selected ? "1" : "0"}" style="width:${size}px;height:${size}px;border-radius:9999px;background:${c.bg};color:${c.fg};border:3px solid ${selected ? "#f59e0b" : c.ring};display:flex;align-items:center;justify-content:center;font:700 ${s.state === "current" ? 15 : 13}px/1 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.5);direction:ltr">${s.n}</div>`;
  return L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

export default function RouteMap(props: RouteMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const g = useRef<{ L: typeof Leaflet; map: Leaflet.Map; layer: Leaflet.LayerGroup; meLayer: Leaflet.LayerGroup } | null>(null);
  const live = useRef(props);
  useEffect(() => { live.current = props; });
  const [ready, setReady] = useState(false);
  const fittedFor = useRef<string>("");

  // create the map once per tile source
  useEffect(() => {
    let disposed = false; let map: Leaflet.Map | null = null; let ro: ResizeObserver | null = null;
    (async () => {
      const L = await import("leaflet");
      if (disposed || !el.current) return;
      map = L.map(el.current, { zoomControl: true, attributionControl: true, preferCanvas: true }).setView([24.7136, 46.6753], 11);
      L.tileLayer(props.tileUrl, { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors' }).addTo(map);
      g.current = { L, map, layer: L.layerGroup().addTo(map), meLayer: L.layerGroup().addTo(map) };
      // the box can change size after creation (orientation, the toolbar wrapping): tell Leaflet, or tiles stay grey at the edges
      if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(() => map?.invalidateSize()); ro.observe(el.current); }
      setReady(true);
    })();
    return () => { disposed = true; ro?.disconnect(); g.current = null; setReady(false); map?.remove(); };
  }, [props.tileUrl]);

  // (re)draw the route
  const { stops, legs, origin, selectedId } = props;
  useEffect(() => {
    const m = g.current; if (!ready || !m) return;
    const { L, layer, map } = m;
    layer.clearLayers();
    for (const l of legs) L.polyline(l.path, { color: l.color, weight: 5, opacity: 0.9, dashArray: l.dashed ? "8 8" : undefined, lineCap: "round", interactive: false }).addTo(layer);
    if (origin) L.marker([origin.lat, origin.lng], { icon: L.divIcon({ html: `<div data-testid="map-origin" title="${esc(props.labels.origin)}" style="width:16px;height:16px;border-radius:4px;background:#f8fafc;border:3px solid #0b132b;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`, className: "", iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, keyboard: false }).addTo(layer);
    // done stops first so the ones still to do are drawn on top of them
    const order = { done: 0, failed: 0, todo: 1, current: 2 } as const;
    for (const s of [...stops].sort((a, b) => order[a.state] - order[b.state])) {
      const mk = L.marker([s.lat, s.lng], { icon: stopIcon(L, s, s.id === selectedId), title: s.code, alt: s.code, riseOnHover: true, zIndexOffset: s.state === "current" ? 1000 : s.state === "todo" ? 500 : 0 });
      mk.on("click", () => live.current.onSelect(s.id));
      mk.addTo(layer);
    }
    // fit when the set of plotted points first appears or changes, never on every refresh (the driver may be panning)
    const key = `${stops.map((s) => s.id).join(",")}|${origin ? 1 : 0}`;
    if (fittedFor.current !== key && (stops.length || origin)) {
      fittedFor.current = key;
      const pts: Array<[number, number]> = stops.filter((s) => s.state === "current" || s.state === "todo").map((s) => [s.lat, s.lng]);
      if (!pts.length) stops.forEach((s) => pts.push([s.lat, s.lng]));
      if (origin) pts.push([origin.lat, origin.lng]);
      if (pts.length === 1) map.setView(pts[0], 15); else if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [32, 32], maxZoom: 16 });
    }
  }, [ready, stops, legs, origin, selectedId, props.labels.origin]);

  // the driver's own position
  const { me } = props;
  useEffect(() => {
    const m = g.current; if (!ready || !m) return;
    m.meLayer.clearLayers();
    if (me) m.L.marker([me.lat, me.lng], { icon: m.L.divIcon({ html: `<div data-testid="map-me" title="${esc(props.labels.me)}" style="width:20px;height:20px;border-radius:9999px;background:#2563eb;border:4px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25)"></div>`, className: "", iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false, keyboard: false, zIndexOffset: 2000 }).addTo(m.meLayer);
  }, [ready, me, props.labels.me]);

  // toolbar actions (counters, so the same click twice works)
  useEffect(() => {
    const m = g.current; if (!ready || !m || props.fitSignal === 0) return;
    const { L, map } = m; const p = live.current;
    const pts: Array<[number, number]> = p.stops.map((s) => [s.lat, s.lng]); if (p.origin) pts.push([p.origin.lat, p.origin.lng]);
    if (pts.length === 1) map.setView(pts[0], 15); else if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [32, 32], maxZoom: 16 });
  }, [ready, props.fitSignal]);
  useEffect(() => {
    const m = g.current; if (!ready || !m || props.locateSignal === 0 || !live.current.me) return;
    m.map.setView([live.current.me.lat, live.current.me.lng], Math.max(m.map.getZoom(), 15));
  }, [ready, props.locateSignal]);
  useEffect(() => {
    const m = g.current; if (!ready || !m || props.focusSignal === 0) return;
    const s = live.current.stops.find((x) => x.id === live.current.focusId);
    if (s) m.map.setView([s.lat, s.lng], Math.max(m.map.getZoom(), 15));
  }, [ready, props.focusSignal]);

  return <div ref={el} data-testid="route-map" data-ready={ready ? "1" : "0"} className="h-80 w-full rounded-2xl sm:h-[28rem]" role="application" aria-label={props.labels.map} />;
}
