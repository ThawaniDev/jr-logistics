import { autoBucket, bucketKeys, presetRange, previousRange, windowOf, type Bucket, type Window } from "./analytics/periods";
import { addDays, riyadhDay, type Ymd } from "./analytics/time";
import { safeDiv } from "./analytics/kpi";

/**
 * PURE logic of the driver and courier-office detail views (decisions G6–G7): the period model, online / busy time, risk flags, rankings, GPS path facts.
 * No database and no React in here, so it is unit-tested (`tests/unit/people-detail-*.test.ts`) and shared by the server and the client components.
 */

// ───────── Period ─────────
export const PERIOD_KEYS = ["30d", "90d", "12m", "all"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
export const parsePeriod = (v: unknown): PeriodKey => (PERIOD_KEYS.includes(v as PeriodKey) ? (v as PeriodKey) : "30d");
export interface PeriodInfo { key: PeriodKey; cur: Window; prev: Window | null; bucket: Bucket; keys: string[]; prevKeys: string[] | null }

/** "All time" never reaches further back than this (the chart would need more than 400 points otherwise). */
export const MAX_ALL_DAYS = 1095;
/**
 * The window a period stands for (Riyadh calendar days; `cur.start` inclusive, `cur.end` exclusive). 30 d / 90 d / 12 calendar months end today and are compared with
 * the window right before; "all" starts on the day of `since` (the account's creation) and has no comparison. Charts use days for 30 d, weeks up to 200 days, months beyond.
 */
export function resolvePeriod(key: PeriodKey, now: Date = new Date(), since?: Date | null): PeriodInfo {
  const today = riyadhDay(now);
  let from: Ymd;
  if (key === "all") {
    const floor = addDays(today, -(MAX_ALL_DAYS - 1)); const own = since ? riyadhDay(since) : addDays(today, -29);
    from = own > today ? today : own < floor ? floor : own;
  } else from = presetRange(key, today).from;
  const cur = windowOf(from, today);
  const prev = key === "all" ? null : windowOf(previousRange({ from, to: today }, key).from, previousRange({ from, to: today }, key).to);
  const bucket: Bucket = key === "30d" ? "day" : key === "90d" || key === "12m" ? "week" : cur.days <= 45 ? "day" : autoBucket(cur.days) === "month" ? "month" : "week";
  return { key, cur, prev, bucket, keys: bucketKeys(cur.from, cur.to, bucket), prevKeys: prev ? bucketKeys(prev.from, prev.to, bucket) : null };
}
/** The window as `{ start, end }` instants (what the SQL helpers take). */
export const span = (w: Pick<Window, "start" | "end">) => ({ start: w.start, end: w.end });

// ───────── Paging ─────────
export const clampPage = (q: { page?: number; pageSize?: number }, def = 10, max = 100) => {
  const pageSize = Math.min(Math.max(Math.floor(q.pageSize ?? def) || def, 1), max), page = Math.max(Math.floor(q.page ?? 1) || 1, 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
};

// ───────── Jobs (offers) ─────────
export const JOB_GROUPS = ["all", "active", "completed", "cancelled", "no_show", "declined"] as const;
export type JobGroup = (typeof JOB_GROUPS)[number];
/** Offer statuses behind each filter of the jobs list ("declined" = offered but never taken: rejected or expired; "active" includes offers still waiting for an answer). */
export const GROUP_STATUSES: Record<Exclude<JobGroup, "all">, string[]> = {
  active: ["offered", "accepted", "arrived", "attendance_confirmed", "delivered_reported", "qty_disputed", "pending_settlement"],
  completed: ["completed"], cancelled: ["cancelled", "replaced"], no_show: ["no_show"], declined: ["rejected", "expired"],
};
export const PARCEL_GROUPS = ["all", "delivered", "failed", "returned", "open"] as const;
export type ParcelGroup = (typeof PARCEL_GROUPS)[number];

// ───────── Time intervals (online time, busy time) ─────────
export type Interval = [number, number];
/** Sorted, non-overlapping union of intervals (touching intervals are joined). */
export function mergeIntervals(list: Interval[]): Interval[] {
  const s = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]); const out: Interval[] = [];
  for (const [a, b] of s) { const last = out[out.length - 1]; if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]); }
  return out;
}
export const intervalMs = (list: Interval[]) => list.reduce((n, [a, b]) => n + (b - a), 0);
export function clipIntervals(list: Interval[], from: number, to: number): Interval[] { return list.map(([a, b]): Interval => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a); }

export interface AvailabilityEvent { at: Date | string; to: string }
/**
 * The intervals a driver was "available" inside a window, from the availability log (every change of status, oldest first or not: it is sorted here). The status at the
 * window's start is the one after the last change before it. Returns null when nothing was recorded up to the end of the window (no data, not "0 hours").
 */
export function onlineIntervals(events: AvailabilityEvent[], win: { start: Date; end: Date }, now: Date = new Date()): Interval[] | null {
  const from = win.start.getTime(), to = Math.min(win.end.getTime(), now.getTime());
  const sorted = events.map((e) => ({ t: new Date(e.at).getTime(), to: e.to })).filter((e) => Number.isFinite(e.t) && e.t < to).sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return null;
  if (to <= from) return [];
  let on = false; let i = 0;
  for (; i < sorted.length && sorted[i].t < from; i++) on = sorted[i].to === "available";
  const out: Interval[] = []; let since = from;
  for (; i < sorted.length; i++) {
    const e = sorted[i];
    if (on && e.to !== "available") { out.push([since, e.t]); on = false; }
    else if (!on && e.to === "available") { since = e.t; on = true; }
  }
  if (on) out.push([since, to]);
  return mergeIntervals(out);
}
/**
 * Time on jobs vs time available. `busy` = the union of the driver's job intervals (arrival → delivery / completion) inside the window; the denominator is the time the driver was
 * online OR on a job (a driver who works while the app says "unavailable" is still utilised), so the ratio never exceeds 100 %. `ratio` is null without any recorded time.
 */
export function utilisation(online: Interval[] | null, busy: Interval[]) {
  const b = mergeIntervals(busy), o = online ?? [];
  const busyMs = intervalMs(b), onlineMs = intervalMs(o), unionMs = intervalMs(mergeIntervals([...o, ...b]));
  return { onlineSec: online == null ? null : Math.round(onlineMs / 1000), busySec: Math.round(busyMs / 1000), ratio: safeDiv(busyMs, unionMs) };
}

/**
 * Fleet utilisation of an office: time its drivers spent on jobs ÷ the time they were online or on a job, over every driver with a recorded availability.
 * `events` and `busy` are keyed by driver id; drivers whose availability was never recorded are left out (no data), so one silent driver cannot show as "100 % busy".
 */
export function fleetUtilisation(events: Map<string, AvailabilityEvent[]>, busy: Map<string, Interval[]>, win: { start: Date; end: Date }, now: Date = new Date()) {
  const from = win.start.getTime(), to = Math.min(win.end.getTime(), now.getTime());
  let busyMs = 0, unionMs = 0, onlineMs = 0, drivers = 0;
  for (const [id, ev] of events) {
    const on = onlineIntervals(ev, win, now); if (on == null) continue;
    const b = mergeIntervals(clipIntervals(busy.get(id) ?? [], from, to)); const u = mergeIntervals([...on, ...b]);
    busyMs += intervalMs(b); unionMs += intervalMs(u); onlineMs += intervalMs(on); drivers++;
  }
  return { drivers, onlineSec: drivers ? Math.round(onlineMs / 1000) : null, busySec: Math.round(busyMs / 1000), ratio: safeDiv(busyMs, unionMs) };
}

// ───────── Response time ─────────
/** Seconds between an offer being sent and the driver accepting it. */
export const RESPONSE_EDGES = [60, 300, 900, 3600, 14400];
/** i18n keys of the response-time buckets, same length as `RESPONSE_EDGES.length + 1`. */
export const RESPONSE_LABELS = ["dv2.resp_b0", "dv2.resp_b1", "dv2.resp_b2", "dv2.resp_b3", "dv2.resp_b4", "dv2.resp_b5"];

// ───────── Risk flags ─────────
export const RISK = { noShowMin: 2, noShowRate: 0.1, decidedMin: 5, lowAcceptance: 0.4, docSoonDays: 30, cashDays: 3, neverDays: 14 } as const;
export type RiskKey = "high_no_show" | "low_acceptance" | "expiring_docs" | "active_strikes" | "cash_held_long" | "never_completed";
export interface Risk { key: RiskKey; level: "warn" | "danger"; params: Record<string, number | string> }
export interface RiskFacts {
  now?: Date; joinedAt?: Date | string | null; verified?: boolean;
  completedTotal?: number; acceptedJobs?: number; noShows?: number; decidedOffers?: number; acceptedOffers?: number;
  strikes?: { enabled: boolean; count: number; warnAt: number; suspendAt: number } | null; suspended?: boolean;
  docs?: Array<{ type: string; expiresOn: string | Date | null; status?: string }> | null;
  /** COD cash older than `RISK.cashDays` that was not handed over (cents); null when the viewer may not see money. */
  cashHeldLongCents?: number | null;
}
/** Whole days from now to a date (negative once passed). A date-only value is read as the start of that day (UTC). */
export function daysUntil(d: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!d) return null;
  const t = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T00:00:00Z`) : new Date(d).getTime();
  return Number.isFinite(t) ? Math.floor((t - now.getTime()) / 864e5) : null;
}
/** The reasons a driver deserves a second look. Every rule needs enough data to mean something (a first no-show is not a pattern). Pure: thresholds are the `RISK` constants. */
export function driverRisks(f: RiskFacts): Risk[] {
  const now = f.now ?? new Date(); const out: Risk[] = [];
  const noShowRate = safeDiv(f.noShows ?? 0, f.acceptedJobs ?? 0);
  if ((f.noShows ?? 0) >= RISK.noShowMin && noShowRate != null && noShowRate >= RISK.noShowRate) out.push({ key: "high_no_show", level: "danger", params: { n: f.noShows ?? 0, pct: Math.round(noShowRate * 100) } });
  const acc = safeDiv(f.acceptedOffers ?? 0, f.decidedOffers ?? 0);
  if ((f.decidedOffers ?? 0) >= RISK.decidedMin && acc != null && acc < RISK.lowAcceptance) out.push({ key: "low_acceptance", level: "warn", params: { pct: Math.round(acc * 100), n: f.decidedOffers ?? 0 } });
  const dueDocs = (f.docs ?? []).filter((d) => { const n = daysUntil(d.expiresOn, now); return n != null && n <= RISK.docSoonDays && d.status !== "rejected"; });
  if (dueDocs.length) { const expired = dueDocs.filter((d) => (daysUntil(d.expiresOn, now) ?? 0) < 0).length; out.push({ key: "expiring_docs", level: expired ? "danger" : "warn", params: { n: dueDocs.length, expired } }); }
  const s = f.strikes;
  if (s && ((s.enabled && s.count >= s.warnAt && s.count > 0) || f.suspended)) out.push({ key: "active_strikes", level: f.suspended || s.count >= s.suspendAt ? "danger" : "warn", params: { n: s.count, max: s.suspendAt } });
  if ((f.cashHeldLongCents ?? 0) > 0) out.push({ key: "cash_held_long", level: "warn", params: { cents: f.cashHeldLongCents ?? 0, days: RISK.cashDays } });
  const joinedDays = f.joinedAt ? Math.floor((now.getTime() - new Date(f.joinedAt).getTime()) / 864e5) : 0;
  if (f.verified && (f.completedTotal ?? 0) === 0 && joinedDays >= RISK.neverDays) out.push({ key: "never_completed", level: "warn", params: { days: joinedDays } });
  return out;
}

// ───────── Rankings ─────────
export interface ParetoRow { id: string; name: string; value: number; share: number; cumulative: number }
/** Largest first, each with its share of the total and the running share (the Pareto line). `limit` keeps the top rows and folds the rest into `others` (null when none). */
export function pareto(rows: Array<{ id: string; name: string; value: number }>, limit = 10) {
  const sorted = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const total = sorted.reduce((n, r) => n + r.value, 0); let run = 0;
  const all = sorted.map((r) => { run += r.value; return { ...r, share: total ? r.value / total : 0, cumulative: total ? run / total : 0 }; });
  const top = all.slice(0, limit), rest = all.slice(limit);
  const others = rest.length ? { count: rest.length, value: rest.reduce((n, r) => n + r.value, 0), share: total ? rest.reduce((n, r) => n + r.value, 0) / total : 0 } : null;
  return { rows: top as ParetoRow[], others, total, drivers: all.length };
}
/** How many of the largest contributors make up `share` (0–1) of the total (concentration: "3 drivers deliver 80 %"). */
export function concentration(rows: Array<{ value: number }>, share = 0.8): number | null {
  const v = rows.map((r) => r.value).filter((n) => n > 0).sort((a, b) => b - a); const total = v.reduce((n, x) => n + x, 0);
  if (!total) return null;
  let run = 0;
  for (let i = 0; i < v.length; i++) { run += v[i]; if (run / total >= share - 1e-9) return i + 1; }
  return v.length;
}

// ───────── GPS path ─────────
export interface PathPoint { lat: number; lng: number; at: string | Date; speedMps?: number | null; accuracyM?: number | null }
const R = 6_371_000;
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180, dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Distance, duration and speeds of a sampled path (samples are at most a minute apart; a larger gap is a pause in sharing, so it adds no distance). */
export function pathSummary(points: PathPoint[], maxGapS = 900) {
  let dist = 0, stopped = 0, maxMps = 0, moving = 0;
  for (let i = 1; i < points.length; i++) {
    const gap = (new Date(points[i].at).getTime() - new Date(points[i - 1].at).getTime()) / 1000;
    if (gap <= 0 || gap > maxGapS) continue;
    const d = haversineM(points[i - 1], points[i]); const v = d / gap;
    if (v > 70) continue; // faster than 250 km/h is a GPS jump, not driving
    dist += d; maxMps = Math.max(maxMps, v);
    if (v < 0.5) stopped += gap; else moving += gap;
  }
  const first = points[0] ? new Date(points[0].at).getTime() : null, last = points.length ? new Date(points[points.length - 1].at).getTime() : null;
  return { points: points.length, distanceM: Math.round(dist), durationS: first != null && last != null ? Math.round((last - first) / 1000) : 0, movingS: Math.round(moving), stoppedS: Math.round(stopped), avgKmh: moving > 0 ? (dist / moving) * 3.6 : null, maxKmh: maxMps > 0 ? maxMps * 3.6 : null, firstAt: first != null ? new Date(first) : null, lastAt: last != null ? new Date(last) : null };
}
/** Positions scaled into a 0–100 box (y grows downwards) with the same scale on both axes, so the shape of a route is not stretched. Longitude is scaled by cos(latitude). */
export function projectPath(points: Array<{ lat: number; lng: number }>, pad = 6): Array<{ x: number; y: number }> {
  if (!points.length) return [];
  const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const w = (maxLng - minLng) * k, h = maxLat - minLat;
  if (Math.max(w, h) < 1e-9) return points.map(() => ({ x: 50, y: 50 })); // one place (or a driver who never moved): the middle of the box
  const s = (100 - 2 * pad) / Math.max(w, h);
  const ox = pad + ((100 - 2 * pad) - w * s) / 2, oy = pad + ((100 - 2 * pad) - h * s) / 2;
  return points.map((p) => ({ x: ox + (p.lng - minLng) * k * s, y: oy + (maxLat - p.lat) * s }));
}
/** How old a position is, in seconds (null without one). */
export const ageSeconds = (at: Date | string | null | undefined, now: Date = new Date()): number | null => (at ? Math.max(0, Math.round((now.getTime() - new Date(at).getTime()) / 1000)) : null);

// ───────── Small helpers ─────────
/** Rate with a floor on the sample: a 100 % success rate over 1 parcel is not worth a green badge. */
export const rateOrNull = (n: number, d: number, minD = 1) => (d >= minD ? safeDiv(n, d) : null);
/** Share of `n` in `total` rounded to 1e-6 (JSON-friendly). */
export const share = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 1e6) / 1e6 : null);
