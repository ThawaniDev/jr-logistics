import { env } from "@/lib/env";

/**
 * Best-route planning.
 *
 * A driver's parcels are ordered with Google's Routes API (`computeRoutes` + `optimizeWaypointOrder`, traffic-aware). One call accepts at most
 * 25 intermediate waypoints, so a longer route is planned in CHUNKS:
 *   1. every stop is first put in a good global order with a local heuristic (nearest neighbour + 2-opt) — this keeps chunks geographically tight;
 *   2. that order is cut into balanced contiguous chunks of at most `chunkSize` stops (default 25 = 24 optimised intermediates + the destination);
 *   3. each chunk is optimised by Google between its own start (the previous chunk's last stop, or the route origin) and its own last stop.
 * The destination of every chunk is known before any call is made, so chunks are independent and run in parallel (3 at a time).
 * If Google is not configured or a chunk fails, that chunk falls back to the local ordering and the result says so — it never pretends.
 */

export interface LatLng { lat: number; lng: number }
export interface Stop extends LatLng { id: string; label?: string }
export type RouteProvider = "google_routes" | "local_heuristic" | "mixed";
export interface PlanLeg { distanceM: number; durationS: number; /** Google encoded polyline (precision 5) of the leg; absent for an estimate. */ polyline?: string | null }
export interface RoutePlan {
  provider: RouteProvider;
  /** Stop ids in visiting order. */
  order: string[];
  /** Driving leg INTO each stop (from the previous stop, or from the origin for the first). */
  legs: Record<string, PlanLeg>;
  totalDistanceM: number; totalDurationS: number;
  chunks: number; googleCalls: number; fallbackChunks: number;
  /** Machine codes (`ROUTING_PROVIDER_NOT_CONFIGURED`, `ROUTING_PROVIDER_FAILED: …`) — clients map the part before ":" to a translated message. */
  warnings: string[];
}

const R = 6371000;
export function haversine(a: LatLng, b: LatLng) {
  const t = (d: number) => (d * Math.PI) / 180;
  const dLat = t(b.lat - a.lat), dLng = t(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** Straight-line estimate of a drive: ×1.3 for the road network, ~35 km/h in town. Only used when Google did not answer. */
export const estimateLeg = (a: LatLng, b: LatLng): PlanLeg => { const d = haversine(a, b) * 1.3; return { distanceM: Math.round(d), durationS: Math.round(d / 9.7) }; };

/**
 * Local ordering of an open path starting at `origin`: nearest neighbour, then 2-opt until no swap helps (bounded by passes and time).
 * With `last`, that stop is pinned to the end of the path (the chunk's destination).
 */
export function orderLocally(origin: LatLng, stops: Stop[], last?: Stop, budgetMs = 1500): Stop[] {
  const free = last ? stops.filter((s) => s.id !== last.id) : [...stops];
  if (free.length === 0) return last ? [last] : [];
  // distance matrix over [origin, ...free, last?]
  const pts: LatLng[] = [origin, ...free, ...(last ? [last] : [])];
  const n = pts.length;
  const d = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const v = haversine(pts[i], pts[j]); d[i * n + j] = v; d[j * n + i] = v; }
  // nearest neighbour over the free stops (indices 1..free.length)
  const path: number[] = [0];
  const left = new Set<number>(); for (let i = 1; i <= free.length; i++) left.add(i);
  while (left.size) {
    const cur = path[path.length - 1]; let best = -1, bd = Infinity;
    for (const i of left) { const v = d[cur * n + i]; if (v < bd) { bd = v; best = i; } }
    path.push(best); left.delete(best);
  }
  if (last) path.push(n - 1);
  // 2-opt: reverse path[i..j] when it shortens the path. Index 0 (origin) and, when pinned, the final index never move.
  const m = path.length, movableEnd = last ? m - 2 : m - 1;
  const started = Date.now();
  for (let pass = 0, improved = true; improved && pass < 60 && Date.now() - started < budgetMs; pass++) {
    improved = false;
    for (let i = 1; i < movableEnd; i++) {
      for (let j = i + 1; j <= movableEnd; j++) {
        const a = path[i - 1], b = path[i], c = path[j], e = j + 1 < m ? path[j + 1] : -1;
        const before = d[a * n + b] + (e >= 0 ? d[c * n + e] : 0);
        const after = d[a * n + c] + (e >= 0 ? d[b * n + e] : 0);
        if (after + 1e-6 < before) { for (let lo = i, hi = j; lo < hi; lo++, hi--) { const t = path[lo]; path[lo] = path[hi]; path[hi] = t; } improved = true; }
      }
    }
  }
  const all = [...free, ...(last ? [last] : [])];
  return path.slice(1).map((ix) => all[ix - 1]);
}

/** Nearest-neighbour order (+2-opt) with a straight-line estimate of every leg. Used for tiny inputs and as the fallback. */
export function heuristicRoute(origin: LatLng, stops: Stop[]): RouteResult {
  const order = orderLocally(origin, stops);
  const legs: RouteResult["legs"] = []; let prev: LatLng & { id: string } = { ...origin, id: "origin" };
  for (const s of order) { legs.push({ from: prev.id, to: s.id, ...estimateLeg(prev, s) }); prev = s; }
  return {
    provider: "local_heuristic", order: order.map((s) => s.id), legs,
    totalDistanceM: legs.reduce((a, l) => a + l.distanceM, 0), totalDurationS: legs.reduce((a, l) => a + l.durationS, 0),
    note: "Estimated order using straight-line distances. Not traffic-aware.",
  };
}

/** Balanced contiguous chunks of at most `max` (e.g. 30 stops, max 25 → 15 + 15, never 25 + 5). */
export function balancedChunks<T>(list: T[], max: number): T[][] {
  if (list.length === 0) return [];
  const k = Math.ceil(list.length / Math.max(1, max)), base = Math.floor(list.length / k), extra = list.length % k;
  const out: T[][] = []; let at = 0;
  for (let i = 0; i < k; i++) { const size = base + (i < extra ? 1 : 0); out.push(list.slice(at, at + size)); at += size; }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wp = (s: LatLng) => ({ location: { latLng: { latitude: s.lat, longitude: s.lng } } });
const secs = (d: unknown) => { const n = parseInt(String(d ?? "0"), 10); return Number.isFinite(n) ? n : 0; }; // "123s"; proto3 JSON omits a zero

/** A provider answer that retrying cannot improve (bad request, unusable response). */
class Permanent extends Error {}
interface GoogleOpts { fetcher: typeof fetch; key: string; url: string }

/** One computeRoutes call: from → (optimised intermediates) → dest. Throws on anything unusable so the caller can fall back. */
async function googleChunk(from: LatLng, chunk: Stop[], dest: Stop, g: GoogleOpts): Promise<{ order: Stop[]; legs: PlanLeg[] }> {
  const mids = chunk.filter((s) => s.id !== dest.id);
  const body = { origin: wp(from), destination: wp(dest), ...(mids.length ? { intermediates: mids.map(wp) } : {}), travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE", regionCode: "SA", units: "METRIC", ...(mids.length > 1 ? { optimizeWaypointOrder: true } : {}) };
  let lastErr = "error";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(400);
    try {
      const res = await g.fetcher(g.url, {
        method: "POST", signal: AbortSignal.timeout(10_000),
        headers: { "content-type": "application/json", "x-goog-api-key": g.key, "x-goog-fieldmask": "routes.optimizedIntermediateWaypointIndex,routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline,routes.distanceMeters,routes.duration" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await res.json().then((j: { error?: { message?: string } }) => j?.error?.message ?? "").catch(() => "");
        lastErr = `Google Routes HTTP ${res.status}${msg ? `: ${String(msg).slice(0, 100)}` : ""}`;
        if ([429, 500, 502, 503, 504].includes(res.status)) continue; // transient: one more try
        throw new Permanent(lastErr);
      }
      const data = await res.json() as { routes?: Array<{ optimizedIntermediateWaypointIndex?: number[]; legs?: Array<{ distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }> }> };
      const route = data.routes?.[0];
      if (!route) throw new Permanent("Google Routes returned no route");
      const idx = mids.length > 1 ? route.optimizedIntermediateWaypointIndex : mids.map((_, i) => i);
      if (!idx || idx.length !== mids.length || new Set(idx).size !== mids.length || idx.some((i) => !Number.isInteger(i) || i < 0 || i >= mids.length)) throw new Permanent("Google Routes returned an invalid waypoint order");
      const legs = (route.legs ?? []).map((l) => ({ distanceM: Math.round(l.distanceMeters ?? 0), durationS: secs(l.duration), polyline: typeof l.polyline?.encodedPolyline === "string" && l.polyline.encodedPolyline.length <= 200_000 ? l.polyline.encodedPolyline : null }));
      if (legs.length !== mids.length + 1) throw new Permanent("Google Routes returned an unexpected number of legs");
      return { order: [...idx.map((i) => mids[i]), dest], legs };
    } catch (e) {
      if (e instanceof Permanent) throw e;
      lastErr = e instanceof Error ? e.message : "error"; // network error / timeout: one more try
    }
  }
  throw new Error(lastErr);
}

/** Runs `fn` over `items` with at most `n` in flight; results keep the input order. */
async function pool<T, R2>(items: T[], n: number, fn: (x: T, i: number) => Promise<R2>): Promise<R2[]> {
  const out: R2[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

export interface PlanOpts { fetcher?: typeof fetch; key?: string; url?: string; chunkSize?: number }

/** Plans the visiting order of `stops` (all must have coordinates) from `origin`. Never throws for provider problems; see `warnings`. */
export async function planStops(origin: LatLng, stops: Stop[], opts: PlanOpts = {}): Promise<RoutePlan> {
  const empty: RoutePlan = { provider: "local_heuristic", order: [], legs: {}, totalDistanceM: 0, totalDurationS: 0, chunks: 0, googleCalls: 0, fallbackChunks: 0, warnings: [] };
  if (stops.length === 0) return empty;
  const key = opts.key ?? env.googleKey;
  const chunkSize = Math.max(3, Math.min(26, opts.chunkSize ?? env.routeChunkSize));
  const coarse = orderLocally(origin, stops); // global order: keeps each chunk geographically tight
  const chunks = balancedChunks(coarse, chunkSize);

  const localChunk = (from: LatLng, chunk: Stop[], dest: Stop) => {
    const order = orderLocally(from, chunk, dest); const legs: PlanLeg[] = []; let prev: LatLng = from;
    for (const s of order) { legs.push(estimateLeg(prev, s)); prev = s; }
    return { order, legs };
  };

  const warnings: string[] = []; let googleCalls = 0, fallbackChunks = 0, googleChunks = 0;
  if (!key) warnings.push("ROUTING_PROVIDER_NOT_CONFIGURED");
  const g: GoogleOpts | null = key ? { fetcher: opts.fetcher ?? fetch, key, url: opts.url ?? env.googleRoutesUrl } : null;

  // Chunk i starts where chunk i-1 ends (its last stop in the global order) — known up front, so the calls do not depend on each other.
  const results = await pool(chunks, 3, async (chunk, i) => {
    const from = i === 0 ? origin : chunks[i - 1][chunks[i - 1].length - 1];
    const dest = chunk[chunk.length - 1];
    if (g) {
      try { googleCalls++; const r = await googleChunk(from, chunk, dest, g); googleChunks++; return r; }
      catch (e) { fallbackChunks++; if (!warnings.some((w) => w.startsWith("ROUTING_PROVIDER_FAILED"))) warnings.push(`ROUTING_PROVIDER_FAILED: ${e instanceof Error ? e.message : "error"}`); } // one warning, however many chunks failed
    } else fallbackChunks++;
    return localChunk(from, chunk, dest);
  });

  const order: string[] = []; const legs: Record<string, PlanLeg> = {};
  results.forEach((r) => r.order.forEach((s, j) => { order.push(s.id); legs[s.id] = r.legs[j]; }));
  const provider: RouteProvider = googleChunks === 0 ? "local_heuristic" : fallbackChunks === 0 ? "google_routes" : "mixed";
  return {
    provider, order, legs, chunks: chunks.length, googleCalls, fallbackChunks, warnings,
    totalDistanceM: order.reduce((a, id) => a + legs[id].distanceM, 0), totalDurationS: order.reduce((a, id) => a + legs[id].durationS, 0),
  };
}

// ── Compatibility wrapper (kept for the original API; the planner above is what the driver flow uses) ──
export interface RouteResult {
  provider: "google_routes" | "local_heuristic";
  warning?: string;
  order: string[];
  legs: Array<{ from: string; to: string; distanceM: number; durationS: number }>;
  totalDistanceM: number; totalDurationS: number;
  note: string;
}

/** Orders `stops` from `origin`; no limit on the number of stops (chunked). Without a Google key it returns the heuristic with a visible warning. */
export async function optimizeRoute(origin: LatLng, stops: Stop[], fetcher: typeof fetch = fetch): Promise<RouteResult> {
  if (stops.length === 0) return { provider: "local_heuristic", order: [], legs: [], totalDistanceM: 0, totalDurationS: 0, note: "No stops" };
  if (stops.length === 1 && !env.googleKey) return heuristicRoute(origin, stops);
  const p = await planStops(origin, stops, { fetcher });
  const legs: RouteResult["legs"] = []; let prev = "origin";
  for (const id of p.order) { legs.push({ from: prev, to: id, ...p.legs[id] }); prev = id; }
  return {
    provider: p.provider === "google_routes" ? "google_routes" : "local_heuristic", ...(p.warnings[0] ? { warning: p.warnings[0] } : {}),
    order: p.order, legs, totalDistanceM: p.totalDistanceM, totalDurationS: p.totalDurationS,
    note: p.provider === "google_routes" ? "Suggested order from Google Routes. Review before starting navigation." : "Estimated order using straight-line distances. Not traffic-aware.",
  };
}

// ── Geocoding (address → coordinates) so parcels typed without a map pin can still be routed ──
export interface GeocodeHit extends LatLng { approximate: boolean }
/** Returns null when Google has no usable answer for the address; throws on a provider problem (so the caller can tell "unknown address" from "service down"). */
export async function geocodeAddress(address: string, cityName: string, center: LatLng, opts: { fetcher?: typeof fetch; key?: string; url?: string } = {}): Promise<GeocodeHit | null> {
  const key = opts.key ?? env.googleKey; if (!key) return null;
  const u = new URL(opts.url ?? env.googleGeocodeUrl);
  u.searchParams.set("address", `${address}, ${cityName}`); u.searchParams.set("components", "country:SA"); u.searchParams.set("region", "sa"); u.searchParams.set("key", key);
  const res = await (opts.fetcher ?? fetch)(u, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`Google Geocoding HTTP ${res.status}`);
  const j = await res.json() as { status?: string; results?: Array<{ geometry?: { location?: { lat?: number; lng?: number }; location_type?: string }; partial_match?: boolean }> };
  if (j.status === "ZERO_RESULTS") return null;
  if (j.status !== "OK") throw new Error(`Google Geocoding ${j.status ?? "error"}`);
  const r = j.results?.[0]; const loc = r?.geometry?.location;
  if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number") return null;
  if (haversine(center, { lat: loc.lat, lng: loc.lng }) > 100_000) return null; // a match in another town is worse than no match
  return { lat: loc.lat, lng: loc.lng, approximate: r?.geometry?.location_type === "APPROXIMATE" || !!r?.partial_match };
}

// ── WhatsApp hand-off (external app; we never send, track delivery, or read replies) ──
export type WaKind = "contact" | "arriving" | "issue";
const TEMPLATES: Record<string, Record<WaKind, string>> = {
  ar: {
    contact: "السلام عليكم {name}، أنا مندوب التوصيل من JR Logistics بخصوص طلبكم رقم {ref}. هل يمكننا التواصل؟",
    arriving: "السلام عليكم {name}، أنا في الطريق إليكم الآن بخصوص طلبكم رقم {ref}.",
    issue: "السلام عليكم {name}، واجهت مشكلة في توصيل طلبكم رقم {ref}. أرجو الرد لتنسيق التسليم.",
  },
  en: {
    contact: "Hello {name}, I'm your JR Logistics delivery driver regarding order {ref}. Can we coordinate?",
    arriving: "Hello {name}, I'm on my way to you now for order {ref}.",
    issue: "Hello {name}, I had a problem delivering order {ref}. Please reply so we can arrange the handover.",
  },
  ur: {
    contact: "السلام علیکم {name}، میں JR Logistics کا ڈیلیوری ڈرائیور ہوں، آپ کے آرڈر {ref} کے بارے میں۔ کیا ہم رابطہ کر سکتے ہیں؟",
    arriving: "السلام علیکم {name}، میں آپ کے آرڈر {ref} کے لیے ابھی راستے میں ہوں۔",
    issue: "السلام علیکم {name}، آپ کے آرڈر {ref} کی ڈیلیوری میں مسئلہ پیش آیا۔ براہ کرم جواب دیں۔",
  },
};
export function whatsappLink(lang: string, kind: WaKind, vars: { name: string; ref: string; phone: string }) {
  const tpl = (TEMPLATES[lang] ?? TEMPLATES.ar)[kind];
  const text = tpl.replace("{name}", vars.name || "").replace("{ref}", vars.ref);
  const digits = vars.phone.replace(/\D/g, "");
  return { text, url: `https://wa.me/${digits}?text=${encodeURIComponent(text)}` };
}
