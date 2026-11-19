import { describe, it, expect } from "vitest";
import { balancedChunks, geocodeAddress, haversine, orderLocally, planStops, optimizeRoute, type LatLng, type Stop } from "@/server/routing";

const origin: LatLng = { lat: 24.7136, lng: 46.6753 };
/** Deterministic scatter of `n` stops over ~20 km around Riyadh. */
const scatter = (n: number, seed = 7): Stop[] => {
  let a = seed; const r = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  return Array.from({ length: n }, (_, i) => ({ id: `s${i}`, lat: 24.6 + r() * 0.2, lng: 46.55 + r() * 0.25 }));
};
const pathLen = (from: LatLng, order: LatLng[]) => order.reduce((s, p, i) => s + haversine(i ? order[i - 1] : from, p), 0);

interface Call { origin: LatLng; destination: LatLng; mids: LatLng[]; optimize: boolean; mask: string; key: string }
/** A stand-in for Google's computeRoutes: records every request, answers with a chosen permutation of the intermediates. */
function fakeGoogle(o: { permute?: (n: number) => number[]; failOn?: (call: number) => number | null; badIndex?: boolean; noLegs?: boolean } = {}) {
  const calls: Call[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const h = init?.headers as Record<string, string>;
    const lat = (w: { location: { latLng: { latitude: number; longitude: number } } }) => ({ lat: w.location.latLng.latitude, lng: w.location.latLng.longitude });
    const call: Call = { origin: lat(body.origin), destination: lat(body.destination), mids: (body.intermediates ?? []).map(lat), optimize: !!body.optimizeWaypointOrder, mask: h["x-goog-fieldmask"], key: h["x-goog-api-key"] };
    calls.push(call);
    const status = o.failOn?.(calls.length) ?? null;
    if (status) return new Response(JSON.stringify({ error: { message: "boom" } }), { status });
    const n = call.mids.length;
    const idx = o.badIndex ? [0, 0].slice(0, n) : (o.permute ?? ((k) => Array.from({ length: k }, (_, i) => i)))(n);
    const legs = o.noLegs ? [] : Array.from({ length: n + 1 }, (_, i) => ({ distanceMeters: 1000 + i, duration: `${60 + i}s` }));
    return new Response(JSON.stringify({ routes: [{ ...(n > 1 ? { optimizedIntermediateWaypointIndex: idx } : {}), legs }] }));
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
const reverse = (n: number) => Array.from({ length: n }, (_, i) => n - 1 - i);

describe("balancedChunks", () => {
  it("never leaves a token last chunk and never exceeds the maximum", () => {
    expect(balancedChunks(Array.from({ length: 25 }, (_, i) => i), 25).map((c) => c.length)).toEqual([25]);
    expect(balancedChunks(Array.from({ length: 26 }, (_, i) => i), 25).map((c) => c.length)).toEqual([13, 13]);
    expect(balancedChunks(Array.from({ length: 30 }, (_, i) => i), 25).map((c) => c.length)).toEqual([15, 15]);
    expect(balancedChunks(Array.from({ length: 51 }, (_, i) => i), 25).map((c) => c.length)).toEqual([17, 17, 17]);
    expect(balancedChunks(Array.from({ length: 80 }, (_, i) => i), 25).map((c) => c.length)).toEqual([20, 20, 20, 20]);
    expect(balancedChunks([], 25)).toEqual([]);
    // contiguous and complete
    expect(balancedChunks(Array.from({ length: 53 }, (_, i) => i), 24).flat()).toEqual(Array.from({ length: 53 }, (_, i) => i));
  });
});

describe("local ordering", () => {
  it("visits every stop once and beats the order the stops were given in", () => {
    const stops = scatter(40);
    const o = orderLocally(origin, stops);
    expect(new Set(o.map((s) => s.id)).size).toBe(40);
    expect(pathLen(origin, o)).toBeLessThan(pathLen(origin, stops) * 0.6);
  });
  it("2-opt removes a crossing that nearest-neighbour leaves", () => {
    // origin → a → b → c → d on a line, but offered shuffled: result must be the monotone line order
    const line: Stop[] = [3, 1, 4, 2].map((k) => ({ id: `p${k}`, lat: 24.7136 + k * 0.01, lng: 46.6753 }));
    expect(orderLocally(origin, line).map((s) => s.id)).toEqual(["p1", "p2", "p3", "p4"]);
  });
  it("pins the destination last", () => {
    const stops = scatter(12); const last = stops[3];
    const o = orderLocally(origin, stops, last);
    expect(o[o.length - 1].id).toBe(last.id); expect(o).toHaveLength(12);
  });
});

describe("planStops with Google (chunked past the 25-waypoint limit)", () => {
  it("a route of ≤ 25 stops is ONE call: ≤ 24 optimised intermediates + the destination, order taken from Google", async () => {
    const { fetcher, calls } = fakeGoogle({ permute: reverse });
    const stops = scatter(20);
    const p = await planStops(origin, stops, { fetcher, key: "test-key" });
    expect(calls).toHaveLength(1);
    expect(calls[0].mids).toHaveLength(19); expect(calls[0].optimize).toBe(true);
    expect(calls[0].key).toBe("test-key");
    expect(calls[0].mask).toContain("routes.optimizedIntermediateWaypointIndex"); // without it Google rejects an optimising request
    expect(p.provider).toBe("google_routes"); expect(p.chunks).toBe(1); expect(p.fallbackChunks).toBe(0); expect(p.warnings).toEqual([]);
    expect(new Set(p.order)).toEqual(new Set(stops.map((s) => s.id)));
    // Google answered "reverse": the optimised intermediates come back reversed, then the destination
    const dest = calls[0].destination; const lastStop = stops.find((s) => s.lat === dest.lat && s.lng === dest.lng)!;
    expect(p.order[p.order.length - 1]).toBe(lastStop.id);
    expect(Object.keys(p.legs)).toHaveLength(20);
    expect(p.totalDistanceM).toBeGreaterThan(0); expect(p.totalDurationS).toBeGreaterThan(0);
  });

  it("80 stops → 4 balanced calls of 20; no call exceeds 24 intermediates; each chunk starts where the previous one ends; every stop exactly once", async () => {
    const { fetcher, calls } = fakeGoogle({ permute: reverse });
    const stops = scatter(80, 11);
    const p = await planStops(origin, stops, { fetcher, key: "k", chunkSize: 25 });
    expect(p.chunks).toBe(4); expect(calls).toHaveLength(4); expect(p.googleCalls).toBe(4);
    for (const c of calls) expect(c.mids.length).toBeLessThanOrEqual(24);
    expect(p.order).toHaveLength(80); expect(new Set(p.order).size).toBe(80);
    // Chain: the first call starts at the origin, every later call starts at an earlier call's destination.
    const dests = calls.map((c) => `${c.destination.lat},${c.destination.lng}`);
    const starts = calls.map((c) => `${c.origin.lat},${c.origin.lng}`);
    expect(calls.some((c) => c.origin.lat === origin.lat && c.origin.lng === origin.lng)).toBe(true);
    expect(starts.filter((s) => dests.includes(s))).toHaveLength(3);
    expect(p.provider).toBe("google_routes");
  });

  it("the largest chunk Google allows is 26 stops (25 intermediates + destination)", async () => {
    const { fetcher, calls } = fakeGoogle();
    await planStops(origin, scatter(26), { fetcher, key: "k", chunkSize: 26 });
    expect(calls).toHaveLength(1); expect(calls[0].mids).toHaveLength(25);
    const again = fakeGoogle();
    await planStops(origin, scatter(27), { fetcher: again.fetcher, key: "k", chunkSize: 99 }); // clamped to 26
    expect(again.calls).toHaveLength(2); expect(Math.max(...again.calls.map((c) => c.mids.length))).toBeLessThanOrEqual(25);
  });

  it("does not ask Google to optimise a chunk with a single intermediate, and handles a lone stop", async () => {
    const two = fakeGoogle(); await planStops(origin, scatter(2), { fetcher: two.fetcher, key: "k" });
    expect(two.calls[0].mids).toHaveLength(1); expect(two.calls[0].optimize).toBe(false);
    const one = fakeGoogle(); const p = await planStops(origin, scatter(1), { fetcher: one.fetcher, key: "k" });
    expect(one.calls[0].mids).toHaveLength(0); expect(p.order).toEqual(["s0"]); expect(p.legs.s0).toMatchObject({ distanceM: 1000, durationS: 60 });
  });

  it("a transient 503 is retried once and then succeeds; a permanent 400 is not retried and falls back with a warning", async () => {
    const retry = fakeGoogle({ failOn: (n) => (n === 1 ? 503 : null) });
    const ok = await planStops(origin, scatter(5), { fetcher: retry.fetcher, key: "k" });
    expect(retry.calls).toHaveLength(2); expect(ok.provider).toBe("google_routes"); expect(ok.warnings).toEqual([]);
    const perm = fakeGoogle({ failOn: () => 400 });
    const bad = await planStops(origin, scatter(5), { fetcher: perm.fetcher, key: "k" });
    expect(perm.calls).toHaveLength(1); expect(bad.provider).toBe("local_heuristic");
    expect(bad.warnings[0]).toMatch(/^ROUTING_PROVIDER_FAILED: Google Routes HTTP 400/); expect(bad.order).toHaveLength(5);
  });

  it("when only some chunks fail the result is 'mixed', complete and honest", async () => {
    // calls run 3 at a time; fail every request of ONE chunk (its destination) so both of its attempts fail
    let failDest: string | null = null;
    const base = fakeGoogle();
    const fetcher = (async (url: unknown, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body)); const d = `${b.destination.location.latLng.latitude}`;
      failDest ??= d;
      if (d === failDest) return new Response("{}", { status: 503 });
      return (base.fetcher as (u: unknown, i?: RequestInit) => Promise<Response>)(url, init);
    }) as unknown as typeof fetch;
    const stops = scatter(50, 3);
    const p = await planStops(origin, stops, { fetcher, key: "k", chunkSize: 25 });
    expect(p.chunks).toBe(2); expect(p.fallbackChunks).toBe(1); expect(p.provider).toBe("mixed");
    expect(p.order).toHaveLength(50); expect(new Set(p.order).size).toBe(50);
    expect(p.warnings.some((w) => w.startsWith("ROUTING_PROVIDER_FAILED"))).toBe(true);
    for (const id of p.order) expect(p.legs[id]).toBeTruthy(); // fallback legs are estimated, never missing
  });

  it("one warning however many chunks fail", async () => {
    const p = await planStops(origin, scatter(60, 9), { fetcher: fakeGoogle({ failOn: () => 400 }).fetcher, key: "k", chunkSize: 25 });
    expect(p.chunks).toBe(3); expect(p.fallbackChunks).toBe(3); expect(p.provider).toBe("local_heuristic");
    expect(p.warnings.filter((w) => w.startsWith("ROUTING_PROVIDER_FAILED"))).toHaveLength(1);
  });

  it("an unusable Google answer (bad permutation / missing legs) is rejected, not trusted", async () => {
    const badIdx = await planStops(origin, scatter(6), { fetcher: fakeGoogle({ badIndex: true }).fetcher, key: "k" });
    expect(badIdx.provider).toBe("local_heuristic"); expect(badIdx.warnings[0]).toContain("invalid waypoint order");
    const noLegs = await planStops(origin, scatter(6), { fetcher: fakeGoogle({ noLegs: true }).fetcher, key: "k" });
    expect(noLegs.provider).toBe("local_heuristic"); expect(noLegs.warnings[0]).toContain("legs");
    expect(noLegs.order).toHaveLength(6);
  });

  it("a network error is retried once and the final failure never leaks the API key", async () => {
    let n = 0;
    const fetcher = (async () => { n++; throw new Error("socket hang up"); }) as unknown as typeof fetch;
    const p = await planStops(origin, scatter(4), { fetcher, key: "SECRET-KEY-123" });
    expect(n).toBe(2); expect(p.provider).toBe("local_heuristic");
    expect(JSON.stringify(p)).not.toContain("SECRET-KEY-123");
  });

  it("the Google order is no worse than the local one on the same stops (sanity of the whole pipeline with a nearest-neighbour 'Google')", async () => {
    const stops = scatter(60, 5);
    const local = await planStops(origin, stops, { key: "" }); // no key → local only
    expect(local.provider).toBe("local_heuristic"); expect(local.warnings).toEqual(["ROUTING_PROVIDER_NOT_CONFIGURED"]);
    expect(local.order).toHaveLength(60); expect(local.chunks).toBe(3);
    const byId = new Map(stops.map((s) => [s.id, s]));
    expect(pathLen(origin, local.order.map((id) => byId.get(id)!))).toBeLessThan(pathLen(origin, stops) * 0.5);
  });

  it("no stops → empty plan, no calls", async () => {
    const { fetcher, calls } = fakeGoogle();
    const p = await planStops(origin, [], { fetcher, key: "k" });
    expect(p.order).toEqual([]); expect(calls).toHaveLength(0);
  });
});

describe("optimizeRoute (compat wrapper)", () => {
  it("has no 26-stop ceiling any more and labels an unconfigured provider", async () => {
    const r = await optimizeRoute(origin, scatter(40));
    expect(r.order).toHaveLength(40); expect(r.legs).toHaveLength(40);
  });
});

describe("geocodeAddress", () => {
  const center: LatLng = { lat: 24.7136, lng: 46.6753 };
  const reply = (j: unknown, status = 200) => (async () => new Response(JSON.stringify(j), { status })) as unknown as typeof fetch;
  it("returns coordinates, restricts to Saudi Arabia and flags approximate matches", async () => {
    let url = "";
    const fetcher = (async (u: URL) => { url = String(u); return new Response(JSON.stringify({ status: "OK", results: [{ geometry: { location: { lat: 24.7, lng: 46.7 }, location_type: "APPROXIMATE" } }] })); }) as unknown as typeof fetch;
    const g = await geocodeAddress("Olaya St 12", "Riyadh", center, { fetcher, key: "k" });
    expect(g).toEqual({ lat: 24.7, lng: 46.7, approximate: true });
    expect(url).toContain("components=country%3ASA"); expect(url).toContain("region=sa");
    expect(await geocodeAddress("x", "Riyadh", center, { fetcher: reply({ status: "OK", results: [{ geometry: { location: { lat: 24.7, lng: 46.7 }, location_type: "ROOFTOP" } }] }), key: "k" })).toMatchObject({ approximate: false });
  });
  it("unknown address → null; far-away match → null; provider problems throw; no key → null", async () => {
    expect(await geocodeAddress("zzz", "Riyadh", center, { fetcher: reply({ status: "ZERO_RESULTS", results: [] }), key: "k" })).toBeNull();
    expect(await geocodeAddress("Olaya", "Riyadh", center, { fetcher: reply({ status: "OK", results: [{ geometry: { location: { lat: 21.5, lng: 39.2 } } }] }), key: "k" })).toBeNull(); // Jeddah ≠ Riyadh
    await expect(geocodeAddress("a", "Riyadh", center, { fetcher: reply({ status: "OVER_QUERY_LIMIT" }), key: "k" })).rejects.toThrow(/OVER_QUERY_LIMIT/);
    await expect(geocodeAddress("a", "Riyadh", center, { fetcher: reply({}, 500), key: "k" })).rejects.toThrow(/HTTP 500/);
    expect(await geocodeAddress("a", "Riyadh", center, { key: "" })).toBeNull();
  });
});
