/**
 * Pure logic of the order and parcel detail views (decisions G6–G7): milestones, rates, punctuality, alerts, histogram, attempts, offer steps.
 * No database, no React: unit-tested in tests/unit/orders-lib.test.ts and shared by the server modules and the pages.
 */
type D = Date | string | number | null | undefined;
const ms = (d: D): number | null => { if (d == null) return null; const n = d instanceof Date ? d.getTime() : new Date(d).getTime(); return Number.isFinite(n) ? n : null; };
const iso = (d: D): string | null => { const n = ms(d); return n == null ? null : new Date(n).toISOString(); };

/** Whole seconds from `a` to `b` (negative when `b` is earlier); null when either is missing. */
export function secBetween(a: D, b: D): number | null { const x = ms(a), y = ms(b); return x == null || y == null ? null : Math.round((y - x) / 1000); }
/** `n / d` as a fraction, null when nothing could have happened (never 0 % for an empty set). */
export const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null);
export const minutes = (sec: number | null): number | null => (sec == null ? null : Math.round(sec / 60));

// ───────── Milestones ─────────
export const MILESTONE_KEYS = ["created", "published", "first_offer", "first_accepted", "filled", "started", "loaded", "first_delivery", "closed"] as const;
export type MilestoneKey = (typeof MILESTONE_KEYS)[number];
export interface MilestoneTimes { createdAt: D; publishedAt: D; firstOfferAt: D; firstAcceptedAt: D; filledAt: D; startedAt: D; loadedAt: D; firstDeliveryAt: D; closedAt: D }
export interface MilestoneInput { row: Partial<MilestoneTimes>; offers: Partial<MilestoneTimes>; events: Partial<MilestoneTimes> }
/** The request's own milestone columns first, then what the offers say, then the job events (older orders were created before the columns existed). */
export function resolveMilestoneTimes(i: MilestoneInput): MilestoneTimes {
  const pick = (k: keyof MilestoneTimes) => iso(i.row[k]) ?? iso(i.offers[k]) ?? iso(i.events[k]);
  return { createdAt: pick("createdAt"), publishedAt: pick("publishedAt"), firstOfferAt: pick("firstOfferAt"), firstAcceptedAt: pick("firstAcceptedAt"), filledAt: pick("filledAt"), startedAt: pick("startedAt"), loadedAt: pick("loadedAt"), firstDeliveryAt: pick("firstDeliveryAt"), closedAt: pick("closedAt") };
}
export interface Milestone { key: MilestoneKey; at: string | null; fromPrevS: number | null; sinceCreatedS: number | null }
/** The ordered milestone list; `fromPrevS` = time since the previous milestone that was reached (null for the first one and for milestones not reached). */
export function buildMilestones(t: MilestoneTimes): Milestone[] {
  const at: Record<MilestoneKey, string | null> = { created: iso(t.createdAt), published: iso(t.publishedAt), first_offer: iso(t.firstOfferAt), first_accepted: iso(t.firstAcceptedAt), filled: iso(t.filledAt), started: iso(t.startedAt), loaded: iso(t.loadedAt), first_delivery: iso(t.firstDeliveryAt), closed: iso(t.closedAt) };
  let prev: string | null = null;
  return MILESTONE_KEYS.map((key) => {
    const v = at[key];
    const m = { key, at: v, fromPrevS: v && prev ? secBetween(prev, v) : null, sinceCreatedS: v ? secBetween(at.created, v) : null };
    if (v) prev = v;
    return m;
  });
}
/** How the order ended, from its status: the last milestone is "completed", "cancelled" or "expired". */
export const closedKind = (status: string): "completed" | "cancelled" | "expired" | null => (status === "completed" || status === "cancelled" || status === "expired" ? status : null);

// ───────── Punctuality ─────────
export interface Punctuality { firstArrivalAt: string | null; deltaMin: number | null; lastDeltaMin: number | null; arrived: number; late: number; onTime: number; graceMin: number }
/** Arrival against the scheduled start: negative minutes = early. A driver is late when they arrived more than `graceMin` minutes after the start. */
export function punctuality(startsAt: D, arrivals: D[], graceMin: number): Punctuality {
  const list = arrivals.map(ms).filter((x): x is number => x != null).sort((a, b) => a - b);
  const s = ms(startsAt);
  const delta = (x: number | undefined) => (x == null || s == null ? null : Math.round((x - s) / 60000));
  const late = list.filter((x) => s != null && (x - s) / 60000 > graceMin).length;
  return { firstArrivalAt: list.length ? new Date(list[0]).toISOString() : null, deltaMin: delta(list[0]), lastDeltaMin: delta(list[list.length - 1]), arrived: list.length, late, onTime: list.length - late, graceMin };
}
/** Minutes a driver who has not arrived yet is overdue (0 when the start + grace has not passed). */
export const overdueMin = (startsAt: D, graceMin: number, now: D = Date.now()): number => { const s = ms(startsAt), n = ms(now); return s == null || n == null ? 0 : Math.max(0, Math.round((n - s) / 60000) - graceMin); };

// ───────── Distribution ─────────
/** Edges (seconds) of the delivery-time histogram: hand-over → delivery. The last bucket is open ("more than the last edge"). */
export const DELIVERY_EDGES_S = [900, 1800, 3600, 7200, 10800, 14400, 21600, 28800] as const;
export interface HistBucket { from: number; to: number | null; count: number }
export function histogram(values: number[], edges: readonly number[] = DELIVERY_EDGES_S): HistBucket[] {
  const out: HistBucket[] = [{ from: 0, to: edges[0], count: 0 }, ...edges.map((e, i) => ({ from: e, to: edges[i + 1] ?? null, count: 0 }))];
  for (const v of values) { if (!Number.isFinite(v) || v < 0) continue; let i = edges.findIndex((e) => v < e); if (i < 0) i = edges.length; out[i].count += 1; }
  return out;
}
/** Percentile by linear interpolation (null for an empty list). `p` in 0–100. */
export function percentile(values: number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = (v.length - 1) * (Math.min(100, Math.max(0, p)) / 100), lo = Math.floor(k), hi = Math.ceil(k);
  return Math.round(v[lo] + (v[hi] - v[lo]) * (k - lo));
}

// ───────── Alerts ─────────
export type AlertSeverity = "critical" | "warning" | "info";
export interface OrderAlert { key: string; severity: AlertSeverity; params: Record<string, number> }
export interface AlertInput {
  status: string; slotsFilled: number; quantity: number; startsInMin: number; parcels: { total: number; noCoords: number; unassigned: number; incomplete: number; failedOpen: number };
  lateDrivers: number; maxLateMin: number; codOutstandingCents: number | null; openSupport: number | null; manifest: boolean;
}
const LIVE = ["published", "filling", "assigned", "confirmed", "in_progress"];
/** What deserves attention on this order right now, most severe first. Pure: the same input always gives the same list. */
export function orderAlerts(i: AlertInput): OrderAlert[] {
  const out: OrderAlert[] = [];
  const live = LIVE.includes(i.status), done = i.status === "completed";
  if (live && i.slotsFilled < i.quantity && i.startsInMin <= 360) out.push({ key: "unfilled", severity: i.startsInMin <= 60 ? "critical" : "warning", params: { n: i.quantity - i.slotsFilled, min: Math.max(0, i.startsInMin) } });
  if (live && i.lateDrivers > 0) out.push({ key: "driver_late", severity: i.maxLateMin >= 60 ? "critical" : "warning", params: { n: i.lateDrivers, min: i.maxLateMin } });
  if (i.manifest && i.parcels.noCoords > 0 && i.status !== "cancelled") out.push({ key: "no_coords", severity: "warning", params: { n: i.parcels.noCoords } });
  if (i.manifest && live && i.parcels.unassigned > 0) out.push({ key: "unassigned", severity: "warning", params: { n: i.parcels.unassigned } });
  if (i.manifest && live && i.parcels.incomplete > 0) out.push({ key: "details_missing", severity: "warning", params: { n: i.parcels.incomplete } });
  if (i.manifest && (live || done) && i.parcels.failedOpen > 0) out.push({ key: "returns_pending", severity: "info", params: { n: i.parcels.failedOpen } });
  if ((i.codOutstandingCents ?? 0) > 0) out.push({ key: "cod_outstanding", severity: "warning", params: { cents: i.codOutstandingCents ?? 0 } });
  if ((i.openSupport ?? 0) > 0) out.push({ key: "support_open", severity: "info", params: { n: i.openSupport ?? 0 } });
  const rank = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ───────── Parcel attempts ─────────
export interface JourneyEvent { id?: string; type: string; createdAt: D; actorName?: string | null; actorRole?: string | null; offerId?: string | null; payload?: Record<string, unknown> | null }
export interface Attempt { n: number; arrivedAt: string | null; outcome: "delivered" | "failed" | "deferred" | "returned" | null; outcomeAt: string | null; durationS: number | null; reason: string | null; note: string | null; otpFailures: number; offerId: string | null; actorName: string | null }
const OUTCOMES = ["delivered", "failed", "deferred"] as const;
/**
 * A visit = from the driver's arrival at the door to what came of it (delivered, failed or postponed). Wrong code entries in between are counted on the visit.
 * An outcome without a recorded arrival (older parcels) is still one attempt; an arrival with no outcome yet is an open attempt.
 */
export function buildAttempts(events: JourneyEvent[]): Attempt[] {
  const list = [...events].sort((a, b) => (ms(a.createdAt) ?? 0) - (ms(b.createdAt) ?? 0));
  const out: Attempt[] = []; let cur: Attempt | null = null;
  const open = (e: JourneyEvent): Attempt => ({ n: out.length + 1, arrivedAt: iso(e.createdAt), outcome: null, outcomeAt: null, durationS: null, reason: null, note: null, otpFailures: 0, offerId: e.offerId ?? null, actorName: e.actorName ?? null });
  for (const e of list) {
    if (e.type === "arrived") { if (cur) out.push(cur); cur = open(e); continue; }
    if (e.type === "otp_failed") { if (cur) cur.otpFailures += 1; continue; }
    if ((OUTCOMES as readonly string[]).includes(e.type)) {
      const a = cur ?? { ...open(e), arrivedAt: null };
      a.outcome = e.type as Attempt["outcome"]; a.outcomeAt = iso(e.createdAt); a.durationS = secBetween(a.arrivedAt, e.createdAt);
      const pl = e.payload ?? {}; a.reason = typeof pl.reason === "string" ? pl.reason : null; a.note = typeof pl.note === "string" ? pl.note : null; a.actorName = e.actorName ?? a.actorName;
      out.push(a); cur = null;
    }
  }
  if (cur) out.push(cur);
  return out.map((a, i) => ({ ...a, n: i + 1 }));
}
/** Journey events with the time since the previous one (seconds), oldest first. */
export function withElapsed<T extends { createdAt: D }>(events: T[]): Array<T & { fromPrevS: number | null }> {
  const list = [...events].sort((a, b) => (ms(a.createdAt) ?? 0) - (ms(b.createdAt) ?? 0));
  return list.map((e, i) => ({ ...e, fromPrevS: i ? secBetween(list[i - 1].createdAt, e.createdAt) : null }));
}

// ───────── One driver offer ─────────
export interface OfferStep { key: string; at: string | null; fromPrevS: number | null }
export interface OfferStepInput { createdAt: D; acceptedAt: D; arrivedAt: D; attendanceAt: D; loadedAt: D; routeApprovedAt: D; deliveredAt: D; finalAt: D; cancelledAt: D; status: string }
/** The status timeline of one offer (offered → accepted → arrived → attendance → loaded → route approved → delivery reported → final), each with the time since the previous reached step. */
export function offerSteps(o: OfferStepInput): OfferStep[] {
  const raw: Array<[string, D]> = [["offered", o.createdAt], ["accepted", o.acceptedAt], ["arrived", o.arrivedAt], ["attendance", o.attendanceAt], ["loaded", o.loadedAt], ["route_approved", o.routeApprovedAt], ["delivered", o.deliveredAt], ["final", o.finalAt], [o.status === "no_show" ? "no_show" : o.status === "replaced" ? "replaced" : "cancelled", o.cancelledAt]];
  let prev: string | null = null;
  return raw.filter(([, v]) => ms(v) != null).map(([key, v]) => { const at = iso(v); const s = { key, at, fromPrevS: prev ? secBetween(prev, at) : null }; prev = at; return s; });
}

/** "12 min late" / "5 min early" as a signed minute count (positive = late). */
export const signedMin = (m: number | null): string => (m == null ? "—" : `${m > 0 ? "+" : m < 0 ? "−" : ""}${Math.abs(m)}`);

/** Failure reasons sorted by count (ties by name), top `n`, the rest summed as `other`. */
export function topReasons(rows: Array<{ reason: string | null; n: number }>, n = 6): Array<{ reason: string; n: number }> {
  const sorted = rows.map((r) => ({ reason: r.reason ?? "other", n: r.n })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason));
  if (sorted.length <= n) return sorted;
  const head = sorted.slice(0, n - 1), rest = sorted.slice(n - 1).reduce((s, r) => s + r.n, 0);
  return [...head, { reason: "more", n: rest }];
}
