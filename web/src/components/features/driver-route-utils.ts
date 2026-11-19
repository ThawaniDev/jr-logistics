import type { Locale } from "@/i18n/core";
import { fmtDuration, fmtKm } from "@/lib/format";
import { isOpenStop, orderStops, type Stop } from "./driver-stops-shared";

/**
 * Pure helpers of the driver's best-route screens (no React): the Google Maps link, warning parsing and number/time formatting.
 * Kept separate so they can be unit-tested without a DOM.
 */

/** Google Maps directions URLs take a handful of points; the next 9 stops (8 waypoints + the destination) work on every platform. */
export const MAPS_MAX_STOPS = 9;

const round6 = (n: number) => Number(n.toFixed(6));
const point = (s: Pick<Stop, "lat" | "lng">) => `${round6(s.lat as number)},${round6(s.lng as number)}`;
const hasPoint = (s: Pick<Stop, "lat" | "lng">) => s.lat != null && s.lng != null && Number.isFinite(s.lat) && Number.isFinite(s.lng);

export interface MapsRoute {
  /** null when none of the remaining stops has coordinates. */
  url: string | null;
  /** How many stops are in the link (≤ max). */
  included: number;
  /** Remaining stops that have a map location. */
  located: number;
  /** Remaining stops WITHOUT a map location (they are left out of the link). */
  skipped: number;
  /** More located stops remain than fit in one link. */
  truncated: boolean;
}

/**
 * Google Maps Directions link for the NEXT `max` remaining (loaded/pending) stops that have coordinates, in the planned order:
 * `destination` = the last of them, `waypoints` = the ones before it, `origin` omitted (Maps uses the phone's current location).
 */
export function googleMapsRoute(stops: Stop[], max = MAPS_MAX_STOPS): MapsRoute {
  const remaining = orderStops(stops).filter(isOpenStop);
  const located = remaining.filter(hasPoint);
  const take = located.slice(0, max);
  let url: string | null = null;
  if (take.length) {
    const q = new URLSearchParams({ api: "1", destination: point(take[take.length - 1]) });
    if (take.length > 1) q.set("waypoints", take.slice(0, -1).map(point).join("|"));
    q.set("travelmode", "driving");
    url = `https://www.google.com/maps/dir/?${q.toString()}`;
  }
  return { url, included: take.length, located: located.length, skipped: remaining.length - located.length, truncated: located.length > max };
}

/**
 * Server warnings are `CODE` or `CODE:param` (the param is a number for most codes, free detail text for ROUTING_PROVIDER_FAILED).
 * Only the CODE (and a purely numeric param) are ever used; a free-text detail is never shown to the driver.
 */
export function parseWarning(w: string): { code: string; n: string | null } | null {
  const i = w.indexOf(":");
  const code = (i < 0 ? w : w.slice(0, i)).trim();
  if (!/^[A-Z][A-Z0-9_]{1,60}$/.test(code)) return null;
  const param = i < 0 ? "" : w.slice(i + 1).trim();
  return { code, n: /^\d{1,6}$/.test(param) ? param : null };
}

/** Deduplicated, parsed warnings (unparseable ones become `code: ""` = the generic text). */
export function parseWarnings(list: readonly string[] | null | undefined) {
  const seen = new Set<string>(); const out: Array<{ key: string; code: string; n: string | null }> = [];
  for (const w of list ?? []) {
    const p = parseWarning(String(w)) ?? { code: "", n: null };
    const key = `${p.code}:${p.n ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push({ key, ...p });
  }
  return out;
}
/** Warnings that mean "the order is only an estimate". */
export const PROVIDER_WARNINGS: readonly string[] = ["ROUTING_PROVIDER_NOT_CONFIGURED", "ROUTING_PROVIDER_FAILED"];
/** Warnings worth a yellow notice; the rest are informational. */
export const SERIOUS_WARNINGS: readonly string[] = [...PROVIDER_WARNINGS, "ROUTE_UNLOCATED_STOPS"];

/** "5 minutes ago" in the driver's language, Latin digits (same locale tags as lib/format). */
export function relAgo(iso: string | Date | null | undefined, locale: Locale, now = Date.now()): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const tag = locale === "en" ? "en-GB" : locale === "ur" ? "ur-PK-u-nu-latn" : "ar-SA-u-nu-latn-ca-gregory";
  const sec = (ms - now) / 1000; const abs = Math.abs(sec);
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), "hour");
  return rtf.format(Math.round(sec / 86400), "day");
}

/** Driving time: whole minutes, never "0 min" for a real leg. */
export const durText = (sec: number, locale: Locale) => fmtDuration(Math.max(60, sec), locale);
/** Distance in km with one decimal, never "0 km" for a real leg. */
export const kmText = (m: number, locale: Locale) => fmtKm(Math.max(100, m), locale);
