import { describe, it, expect } from "vitest";
import { googleMapsRoute, parseWarnings, parseWarning, relAgo, durText, kmText, MAPS_MAX_STOPS } from "@/components/features/driver-route-utils";

const stop = (i: number, o: Record<string, unknown> = {}) => ({ id: `s${i}`, seq: i, stopOrder: i, status: "loaded", lat: 24.6 + i / 100, lng: 46.6 + i / 100, ...o }) as never;
const stops = (n: number) => Array.from({ length: n }, (_, i) => stop(i + 1));

describe("Google Maps link for the next stops", () => {
  it("destination = the last of the next 9, waypoints = the 8 before it, no origin, pipes and commas encoded", () => {
    const r = googleMapsRoute(stops(30));
    expect(MAPS_MAX_STOPS).toBe(9);
    expect(r).toMatchObject({ included: 9, located: 30, skipped: 0, truncated: true });
    const u = new URL(r.url!);
    expect(u.origin + u.pathname).toBe("https://www.google.com/maps/dir/");
    expect(u.searchParams.get("api")).toBe("1"); expect(u.searchParams.get("travelmode")).toBe("driving"); expect(u.searchParams.has("origin")).toBe(false);
    expect(u.searchParams.get("destination")).toBe("24.69,46.69");
    expect(u.searchParams.get("waypoints")!.split("|")).toHaveLength(8);
    expect(r.url).toContain("%7C"); expect(r.url).not.toContain("|");
  });
  it("follows the planned order (stopOrder), skips finished stops and stops without a map location", () => {
    const list = [stop(3, { stopOrder: 1 }), stop(1, { stopOrder: 2, lat: null, lng: null }), stop(2, { stopOrder: 3 }), stop(4, { stopOrder: 0, status: "delivered" })];
    const r = googleMapsRoute(list);
    expect(r).toMatchObject({ included: 2, located: 2, skipped: 1, truncated: false });
    const u = new URL(r.url!);
    expect(u.searchParams.get("waypoints")).toBe("24.63,46.63"); expect(u.searchParams.get("destination")).toBe("24.62,46.62");
  });
  it("a single stop has no waypoints; nothing located → no link", () => {
    expect(new URL(googleMapsRoute([stop(1)]).url!).searchParams.has("waypoints")).toBe(false);
    expect(googleMapsRoute([stop(1, { lat: null, lng: null })])).toMatchObject({ url: null, included: 0, skipped: 1 });
    expect(googleMapsRoute([]).url).toBeNull();
  });
});

describe("route warnings", () => {
  it("keeps the code (and a numeric parameter) and never the free-text provider detail", () => {
    expect(parseWarning("ROUTE_UNLOCATED_STOPS:3")).toEqual({ code: "ROUTE_UNLOCATED_STOPS", n: "3" });
    expect(parseWarning("ROUTING_PROVIDER_FAILED: Google Routes HTTP 503: quota")).toEqual({ code: "ROUTING_PROVIDER_FAILED", n: null });
    expect(parseWarning("not a code!")).toBeNull();
  });
  it("de-duplicates and turns unknown text into the generic entry", () => {
    const w = parseWarnings(["ROUTING_PROVIDER_FAILED: a", "ROUTING_PROVIDER_FAILED: b", "ROUTE_UNLOCATED_STOPS:2", "???"]);
    expect(w.map((x) => x.code)).toEqual(["ROUTING_PROVIDER_FAILED", "ROUTE_UNLOCATED_STOPS", ""]);
    expect(parseWarnings(null)).toEqual([]);
  });
});

describe("formatting", () => {
  it("never shows a zero-length leg; relative times use Latin digits", () => {
    expect(durText(5, "en")).toMatch(/1/); expect(kmText(20, "en")).toMatch(/0\.1/);
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(relAgo(new Date(now - 5 * 60_000).toISOString(), "en", now)).toBe("5 minutes ago");
    expect(relAgo(new Date(now - 5 * 60_000).toISOString(), "ar", now)).toMatch(/5/);
    expect(relAgo(null, "en")).toBeNull(); expect(relAgo("nope", "en")).toBeNull();
  });
});
