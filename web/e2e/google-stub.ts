import http from "node:http";

/**
 * A stand-in for Google's Routes + Geocoding APIs, so the best-route feature can be exercised end to end without a key or network.
 * It enforces the REAL limits (≤ 25 intermediates, API key header, field mask must ask for the optimised order) and answers with a genuine
 * nearest-neighbour ordering of the intermediates, so a planned route differs from the manifest order.
 *
 * Geocoding answers ZERO_RESULTS for everything except addresses containing "GEO-OK" (→ central Riyadh): the pre-existing flows type
 * addresses without map pins and must keep their manifest order, so they must not suddenly be "located".
 */
export const STUB_PORT = 3199;
export const STUB_KEY = "e2e-google-key";
export interface StubCall { kind: "routes" | "geocode"; intermediates?: number; optimize?: boolean; origin?: [number, number]; destination?: [number, number]; address?: string }
const calls: StubCall[] = [];

const R = 6371000; const rad = (d: number) => (d * Math.PI) / 180;
const hav = (a: [number, number], b: [number, number]) => { const x = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
type Wp = { location: { latLng: { latitude: number; longitude: number } } };
const pt = (w: Wp): [number, number] => [w.location.latLng.latitude, w.location.latLng.longitude];

export function startGoogleStub(): Promise<() => Promise<void>> {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url!, "http://stub");
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (u.pathname === "/__calls") return send(200, calls);
    if (u.pathname === "/__reset") { calls.length = 0; return send(200, {}); }
    if (u.pathname === "/geocode") {
      if (u.searchParams.get("key") !== STUB_KEY) return send(200, { status: "REQUEST_DENIED", results: [] });
      const address = u.searchParams.get("address") ?? ""; calls.push({ kind: "geocode", address });
      return send(200, address.includes("GEO-OK") ? { status: "OK", results: [{ geometry: { location: { lat: 24.7136, lng: 46.6753 }, location_type: "ROOFTOP" } }] } : { status: "ZERO_RESULTS", results: [] });
    }
    if (u.pathname === "/routes" && req.method === "POST") {
      let raw = ""; req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (req.headers["x-goog-api-key"] !== STUB_KEY) return send(403, { error: { message: "API key not valid" } });
        const b = JSON.parse(raw) as { origin: Wp; destination: Wp; intermediates?: Wp[]; optimizeWaypointOrder?: boolean };
        const mids = (b.intermediates ?? []).map(pt);
        calls.push({ kind: "routes", intermediates: mids.length, optimize: !!b.optimizeWaypointOrder, origin: pt(b.origin), destination: pt(b.destination) });
        if (mids.length > 25) return send(400, { error: { message: "Maximum number of intermediate waypoints exceeded (25)" } }); // Google's real limit
        if (b.optimizeWaypointOrder && !String(req.headers["x-goog-fieldmask"] ?? "").includes("routes.optimizedIntermediateWaypointIndex")) return send(400, { error: { message: "Field mask must include optimized_intermediate_waypoint_index" } });
        // nearest-neighbour order of the intermediates from the origin
        const left = mids.map((_, i) => i); const idx: number[] = []; let cur = pt(b.origin);
        while (left.length) { let bi = 0; left.forEach((k, j) => { if (hav(cur, mids[k]) < hav(cur, mids[left[bi]])) bi = j; }); const [k] = left.splice(bi, 1); idx.push(k); cur = mids[k]; }
        const seq = [pt(b.origin), ...idx.map((k) => mids[k]), pt(b.destination)];
        const legs = seq.slice(1).map((p, i) => { const d = Math.round(hav(seq[i], p) * 1.2); return { distanceMeters: d, duration: `${Math.max(60, Math.round(d / 9))}s` }; });
        send(200, { routes: [{ ...(mids.length > 1 ? { optimizedIntermediateWaypointIndex: idx } : {}), legs }] });
      });
      return;
    }
    send(404, {});
  });
  return new Promise((ok) => server.listen(STUB_PORT, "127.0.0.1", () => ok(() => new Promise<void>((done) => server.close(() => done())))));
}
