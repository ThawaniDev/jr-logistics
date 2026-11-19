import type { Locale } from "@/i18n/core";
import { fmtKm, fmtNum } from "@/lib/format";

/**
 * Pure helpers of the driver's field-operations screens (decisions E1–E18): geofence maths, polyline decoding, manual re-ordering,
 * evidence / cash / proof gating, scan-code normalisation, stat-card maths and notification de-duplication.
 * No React, no DOM — unit-tested in tests/unit/driver-fieldops.test.ts.
 */

// ───────── contract types (memory/SHIPMENTS_API.md → Addendum E) ─────────
export interface LatLng { lat: number; lng: number }
export type LatLngTuple = [number, number];
/** `job.arrival` — `warehouse` is null when the pin is unknown (check-in is then not enforced). */
export interface ArrivalInfo { geofence: boolean; radiusM: number; warehouse: LatLng | null }
/** `job.loading` */
export interface LoadingInfo { mode: "driver_scan" | "warehouse"; assigned: number; scanned: number; finished: boolean }
/** `job.policy` */
export interface PolicyInfo { canReorderRoute: boolean; rescheduleEvidenceText: boolean; rescheduleEvidencePhoto: boolean; stopWaitMin: number; failStrict: boolean }
/** `job.cod` */
export interface CodInfo { toCollectCents: number; collectedCents: number; parcels: number }
/** `GET /driver/jobs/:id/route-geometry` */
export interface RouteLeg { stopId: string; order: number; from: LatLng | null; to: LatLng | null; polyline: string | null; distanceM: number; durationS: number }
export interface RouteGeometry { origin: LatLng | null; provider: string | null; legs: RouteLeg[] }

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPoint = (p: unknown): p is LatLng => !!p && typeof p === "object" && num((p as LatLng).lat) && num((p as LatLng).lng);

/** Tolerant readers: an older server that does not send a block yet must never crash the screen. */
export function arrivalOf(job: { arrival?: unknown } | null | undefined): ArrivalInfo {
  const a = (job?.arrival ?? {}) as Partial<ArrivalInfo>;
  return { geofence: a.geofence === true, radiusM: num(a.radiusM) ? a.radiusM : 200, warehouse: isPoint(a.warehouse) ? a.warehouse : null };
}
export function policyOf(job: { policy?: unknown } | null | undefined): PolicyInfo {
  const p = (job?.policy ?? {}) as Partial<PolicyInfo>;
  return {
    canReorderRoute: p.canReorderRoute === true, rescheduleEvidenceText: p.rescheduleEvidenceText === true, rescheduleEvidencePhoto: p.rescheduleEvidencePhoto === true,
    stopWaitMin: num(p.stopWaitMin) ? Math.max(0, p.stopWaitMin) : 0, failStrict: p.failStrict === true,
  };
}
export function loadingOf(job: { loading?: unknown } | null | undefined): LoadingInfo {
  const l = (job?.loading ?? {}) as Partial<LoadingInfo>;
  return { mode: l.mode === "driver_scan" ? "driver_scan" : "warehouse", assigned: num(l.assigned) ? l.assigned : 0, scanned: num(l.scanned) ? l.scanned : 0, finished: l.finished === true };
}

// ───────── geofence (E1) ─────────
const EARTH_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
export interface GeofenceState {
  /** The server will enforce the check-in radius (geofence on AND the warehouse pin is known). */
  enforced: boolean; radiusM: number;
  /** null while there is no fix yet. */
  distanceM: number | null; within: boolean | null;
}
/** Where the driver stands relative to the check-in radius, from the last GPS fix. */
export function geofenceState(arrival: ArrivalInfo, pos: LatLng | null | undefined): GeofenceState {
  const enforced = arrival.geofence && arrival.warehouse != null;
  if (!enforced || !arrival.warehouse || !pos) return { enforced, radiusM: arrival.radiusM, distanceM: null, within: null };
  const d = Math.round(haversineM(pos, arrival.warehouse));
  return { enforced, radiusM: arrival.radiusM, distanceM: d, within: d <= arrival.radiusM };
}
/** "340 m" / "1.2 km" in the driver's language. */
export function fmtMeters(m: number, l: Locale): string {
  if (m >= 1000) return fmtKm(m, l);
  return `${fmtNum(Math.max(0, Math.round(m)), l)} ${l === "en" ? "m" : l === "ur" ? "میٹر" : "م"}`;
}
/** Details of a `422 TOO_FAR_FROM_WAREHOUSE {distanceM, radiusM}`; null when the server sent no numbers. */
export function tooFarDetails(details: Record<string, unknown> | undefined): { distanceM: number; radiusM: number } | null {
  const d = Number(details?.distanceM); const r = Number(details?.radiusM);
  return Number.isFinite(d) && Number.isFinite(r) ? { distanceM: Math.round(d), radiusM: Math.round(r) } : null;
}

// ───────── polyline (E6) ─────────
/**
 * Google encoded polyline → [lat, lng][]. Precision 5 for Routes/Directions. A truncated or garbled string returns the points decoded so far
 * (never throws, never loops forever).
 */
export function decodePolyline(encoded: string | null | undefined, precision = 5): LatLngTuple[] {
  if (!encoded || typeof encoded !== "string") return [];
  const factor = 10 ** precision; const out: LatLngTuple[] = [];
  let i = 0; let lat = 0; let lng = 0;
  const readValue = (): number | null => {
    let result = 0; let shift = 0; let b: number;
    do {
      if (i >= encoded.length) return null;
      b = encoded.charCodeAt(i++) - 63;
      if (b < 0 || b > 63) return null;
      result += (b & 0x1f) * 2 ** shift; // plain arithmetic: `<<` would overflow 32 bits on long deltas
      shift += 5;
    } while (b >= 0x20 && shift < 40);
    if (b >= 0x20) return null; // a value this long is garbage
    return result % 2 === 1 ? -(Math.floor(result / 2) + 1) : Math.floor(result / 2);
  };
  while (i < encoded.length) {
    const dLat = readValue(); if (dLat == null) break;
    const dLng = readValue(); if (dLng == null) break;
    lat += dLat; lng += dLng;
    out.push([lat / factor, lng / factor]);
  }
  return out;
}

/** One drawable line per leg: the decoded polyline, or a straight dashed line from→to when the server only has an estimate. */
export interface LegPath { stopId: string; order: number; path: LatLngTuple[]; dashed: boolean; color: string }
export const LEG_COLORS = ["#00c5d5", "#05e5a3", "#f59e0b", "#a78bfa", "#fb7185", "#38bdf8"] as const;
export const legColor = (i: number) => LEG_COLORS[((i % LEG_COLORS.length) + LEG_COLORS.length) % LEG_COLORS.length];
export function legPaths(legs: RouteLeg[] | null | undefined): LegPath[] {
  const out: LegPath[] = [];
  (legs ?? []).forEach((leg, i) => {
    const decoded = decodePolyline(leg.polyline);
    if (decoded.length >= 2) { out.push({ stopId: leg.stopId, order: leg.order, path: decoded, dashed: false, color: legColor(i) }); return; }
    if (isPoint(leg.from) && isPoint(leg.to)) out.push({ stopId: leg.stopId, order: leg.order, path: [[leg.from.lat, leg.from.lng], [leg.to.lat, leg.to.lng]], dashed: true, color: legColor(i) });
  });
  return out;
}

// ───────── stops on the map ─────────
interface PointStop { id: string; lat: number | null; lng: number | null }
export const stopHasPoint = (s: Pick<PointStop, "lat" | "lng">) => num(s.lat) && num(s.lng);
/** Plot the ones with coordinates; the rest stay in the list flagged "no location". */
export function splitPlottable<T extends PointStop>(stops: T[]): { plotted: T[]; unplotted: T[] } {
  return { plotted: stops.filter(stopHasPoint), unplotted: stops.filter((s) => !stopHasPoint(s)) };
}

/** Finds the stop a scanned / typed value refers to (parcel code, warehouse order reference or the manifest number) — "jump to parcel". */
export function findStopByScan<T extends { code: string; seq: number; externalRef?: string | null }>(stops: T[], raw: string): T | null {
  const v = normalizeScanCode(raw);
  if (!v) return null;
  const exact = stops.find((s) => normalizeScanCode(s.code) === v || (s.externalRef ? normalizeScanCode(s.externalRef) === v : false));
  if (exact) return exact;
  return /^\d{1,4}$/.test(v) ? stops.find((s) => s.seq === Number(v)) ?? null : null;
}

// ───────── manual route order (E5) ─────────
interface OrderStop { id: string; status: string; arrivedAt?: string | null; stopOrder: number; seq: number }
const OPEN = ["loaded", "pending"];
const sortStops = <T extends OrderStop>(stops: T[]) => [...stops].sort((a, b) => a.stopOrder - b.stopOrder || a.seq - b.seq);
export const isResolvedStop = (s: Pick<OrderStop, "status">) => !OPEN.includes(s.status);
/** The stop the driver has arrived at stays first and is not part of the order the server accepts. */
export const isPinnedStop = (s: Pick<OrderStop, "status" | "arrivedAt">) => !isResolvedStop(s) && !!s.arrivedAt;
/** Stops the driver may re-order: still to do and not pinned, in the current route order. */
export const movableStops = <T extends OrderStop>(stops: T[]): T[] => sortStops(stops).filter((s) => !isResolvedStop(s) && !isPinnedStop(s));
/** `order` for `POST /offers/:id/route/reorder` — exactly the ids of the movable stops, in the wanted sequence. */
export const reorderPayload = (ids: string[]) => ({ order: [...ids] });
export function moveStopBy(ids: string[], id: string, delta: -1 | 1): string[] {
  const i = ids.indexOf(id); const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const next = [...ids]; [next[i], next[j]] = [next[j], next[i]];
  return next;
}
/** "Make next": the stop goes to the front of the movable list (the pinned stop, if any, is still served first by the server). */
export function makeNextIds(ids: string[], id: string): string[] {
  if (!ids.includes(id)) return ids;
  return [id, ...ids.filter((x) => x !== id)];
}
export const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
/** Merge a draft order (from earlier) with the stops that exist now: unknown ids drop out, new stops go to the end. */
export function reconcileDraft(draft: string[], currentIds: string[]): string[] {
  const live = new Set(currentIds);
  const kept = draft.filter((id) => live.has(id));
  return [...kept, ...currentIds.filter((id) => !kept.includes(id))];
}

// ───────── postpone / can't-deliver evidence (E7, E14) ─────────
export interface EvidenceNeeds { note: boolean; photo: boolean }
export const MIN_EVIDENCE_NOTE = 3;
/** What the policy asks for, plus whatever the server said is still missing (`EVIDENCE_REQUIRED {note, photo}`). */
export function evidenceNeeds(policy: Pick<PolicyInfo, "rescheduleEvidenceText" | "rescheduleEvidencePhoto">, server?: { note?: unknown; photo?: unknown } | null): EvidenceNeeds {
  return { note: policy.rescheduleEvidenceText || server?.note === true, photo: policy.rescheduleEvidencePhoto || server?.photo === true };
}
export function evidenceGate(needs: EvidenceNeeds, given: { note: string; hasPhoto: boolean }) {
  const missingNote = needs.note && given.note.trim().length < MIN_EVIDENCE_NOTE;
  const missingPhoto = needs.photo && !given.hasPhoto;
  return { ok: !missingNote && !missingPhoto, missingNote, missingPhoto };
}

export const FAIL_REASONS = ["unreachable", "refused", "closed", "no_otp", "damaged", "gate_access", "wrong_address", "out_of_zone", "other"] as const;
export const FAIL_NEEDS_ARRIVAL: readonly string[] = ["unreachable", "refused", "closed", "no_otp", "damaged", "gate_access"];
export const FAIL_NEEDS_NOTE: readonly string[] = ["wrong_address", "damaged", "other"];
/**
 * Why a "can't deliver" reason cannot be chosen right now (null = selectable). Without `failStrict` every reason is selectable at any time;
 * the unreachable-recipient wait only exists while the platform's door timer is on (`stopWaitMin > 0`).
 */
export function failBlock(reason: string, o: { strict: boolean; arrived: boolean; waitMin: number; remainingSec: number }): null | "arrival" | "wait" {
  if (o.strict && FAIL_NEEDS_ARRIVAL.includes(reason) && !o.arrived) return "arrival";
  if (reason === "unreachable" && (o.strict || o.waitMin > 0)) {
    if (!o.arrived) return "arrival";
    if (o.remainingSec > 0) return "wait";
  }
  return null;
}
/** A note is mandatory only under the strict rules (the server may still ask for one: the screen then shows the field as required). */
export const failNeedsNote = (reason: string, strict: boolean, serverAsked = false) => serverAsked || (strict && FAIL_NEEDS_NOTE.includes(reason));

// ───────── delivery proof, signature, cash (E9, E10, E17) ─────────
export interface DeliverStopLike { proofMode?: string; needsOtp?: boolean; needsSignature?: boolean; codCents?: number | null }
/** `needsOtp` is false when the warehouse turned the delivery code off (proofMode `scan`). Older servers never send it: the code is needed. */
export const needsOtpOf = (s: DeliverStopLike) => (typeof s.needsOtp === "boolean" ? s.needsOtp : s.proofMode !== "scan");
export const needsSignatureOf = (s: DeliverStopLike) => s.needsSignature === true;
/** The business "signed receipt photo" alternative exists only while a code is required and the server offers it. */
export const receiptAllowed = (s: DeliverStopLike) => needsOtpOf(s) && s.proofMode === "code_or_receipt";
export const codDueCents = (s: DeliverStopLike) => (typeof s.codCents === "number" && s.codCents > 0 ? Math.trunc(s.codCents) : 0);

export interface DeliverInput { code: string; otp: string; mode: "code" | "receipt"; receiverName: string; hasReceiptPhoto: boolean; cashConfirmed: boolean; hasSignature: boolean }
export type DeliverIssue = "code" | "otp" | "name" | "photo" | "cash" | "signature";
/** Everything the form can check before it talks to the server. Pure so the rules are testable. */
export function deliverIssues(s: DeliverStopLike, i: DeliverInput): DeliverIssue[] {
  const out: DeliverIssue[] = [];
  if (!i.code.trim()) out.push("code");
  if (needsOtpOf(s) && i.mode === "code" && !/^\d{4}$/.test(i.otp)) out.push("otp");
  if (needsOtpOf(s) && i.mode === "receipt") { if (!i.hasReceiptPhoto) out.push("photo"); if (i.receiverName.trim().length < 2) out.push("name"); }
  if (needsSignatureOf(s) && !i.hasSignature) out.push("signature");
  if (codDueCents(s) > 0 && !i.cashConfirmed) out.push("cash");
  return out;
}
/** The deliver request body (without location). `cashCollectedCents` is always exactly what is due — never typed. */
export function deliverBody(s: DeliverStopLike, i: DeliverInput, signatureMediaId?: string | null) {
  const body: Record<string, unknown> = { code: normalizeScanCode(i.code) };
  if (needsOtpOf(s)) { if (i.mode === "receipt") { body.proof = "receipt"; body.receiverName = i.receiverName.trim(); } else body.otp = i.otp; }
  if (needsSignatureOf(s) && signatureMediaId) body.signatureMediaId = signatureMediaId;
  if (codDueCents(s) > 0) body.cashCollectedCents = codDueCents(s);
  return body;
}

// ───────── scanning (E3, E4) ─────────
/** Printable ASCII control characters (including the barcode group separator) and zero-width / BOM marks that scanners and keyboards inject. */
const INVISIBLE = /[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\ufeff]/g;
/**
 * What the scanner or keyboard produced → the code the server matches. Mirrors the server (`trim`, no inner spaces, upper-case) and also
 * understands a QR code that holds a tracking link (`…/track/<code>` or `?code=<code>`).
 */
export function normalizeScanCode(raw: string | null | undefined): string {
  let v = String(raw ?? "").replace(INVISIBLE, " ").trim();
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      const q = u.searchParams.get("code") ?? u.searchParams.get("c");
      const last = u.pathname.split("/").filter(Boolean).pop();
      v = q ?? (last ? decodeURIComponent(last) : v);
    } catch { /* not a URL after all: keep the text */ }
  }
  return v.replace(/\s+/g, "").toUpperCase();
}
/** Repeated reads of the same code within `windowMs` count once (a camera sees the same label for many frames). */
export function createDeduper(windowMs = 2500) {
  const seen = new Map<string, number>();
  return {
    accept(code: string, now = Date.now()): boolean {
      if (!code) return false;
      const at = seen.get(code);
      if (at != null && now - at < windowMs) return false;
      seen.set(code, now);
      if (seen.size > 50) for (const [k, t] of seen) if (now - t > windowMs) seen.delete(k);
      return true;
    },
    reset() { seen.clear(); },
  };
}
export const BARCODE_FORMATS = ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "codabar", "data_matrix", "pdf417"] as const;

// ───────── stat cards (E13) ─────────
interface SummaryLike { total: number; pending?: number; loaded: number; delivered: number; failed: number; returned: number; missing: number }
export interface JobStats { total: number; toDeliver: number; delivered: number; notDelivered: number; cod: null | { toCollectCents: number; collectedCents: number; parcels: number } }
/** total · to deliver (`loaded`) · delivered · not delivered (failed + returned + missing) · COD when any parcel carries cash. */
export function jobStats(sum: SummaryLike | null | undefined, cod?: Partial<CodInfo> | null): JobStats | null {
  if (!sum) return null;
  const toCollect = Math.max(0, Math.trunc(Number(cod?.toCollectCents) || 0)); const collected = Math.max(0, Math.trunc(Number(cod?.collectedCents) || 0)); const parcels = Math.max(0, Math.trunc(Number(cod?.parcels) || 0));
  return {
    total: sum.total, toDeliver: sum.loaded, delivered: sum.delivered, notDelivered: sum.failed + sum.returned + sum.missing,
    cod: parcels > 0 || toCollect > 0 || collected > 0 ? { toCollectCents: toCollect, collectedCents: collected, parcels } : null,
  };
}

// ───────── images ─────────
/** Target size of a photo that fits inside `max` × `max` (never enlarged). */
export function fitWithin(w: number, h: number, max = 1600): { width: number; height: number; scale: number } {
  const scale = Math.min(1, max / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

// ───────── offers hidden while busy / new-offer alerts (E11, E12) ─────────
export interface ActiveJobRef { offerId: string; requestId: string; ref: string; status: string }
export function offersHidden(res: { hidden?: unknown; activeJob?: ActiveJobRef | null } | null | undefined): { hidden: boolean; activeJob: ActiveJobRef | null } {
  return { hidden: res?.hidden === true, activeJob: res?.activeJob && typeof res.activeJob.offerId === "string" ? res.activeJob : null };
}
interface NotifLike { id: string; type: string; createdAt?: string | null; data?: Record<string, unknown> | null }
export const SEEN_MAX = 200;
export const OFFER_ALERT_MAX_AGE_MS = 10 * 60_000;
/**
 * Unread `offer_new` notifications this device has not alerted yet. `alert` = recent enough to be worth a sound and a toast;
 * older unseen ones are only marked as seen (a driver who signs in after a day must not be greeted by a dozen beeps).
 */
export function pickNewOffers(items: NotifLike[] | null | undefined, seen: ReadonlySet<string>, now = Date.now(), maxAgeMs = OFFER_ALERT_MAX_AGE_MS) {
  const unseen = (items ?? []).filter((n) => n.type === "offer_new" && !seen.has(n.id));
  const alert = unseen.filter((n) => { const at = n.createdAt ? new Date(n.createdAt).getTime() : now; return Number.isFinite(at) && now - at <= maxAgeMs; });
  return { alert, mark: unseen.map((n) => n.id) };
}
export const trimSeen = (ids: string[], max = SEEN_MAX) => (ids.length > max ? ids.slice(ids.length - max) : ids);

// ───────── cash with me (E17) ─────────
export interface CashOrder { offerId: string; requestId: string; ref: string; businessName: string | null; parcels: number; collectedCents: number; receivedCents: number; outstandingCents: number; lastCollectedAt: string | null }
export interface CashRecent { id: string; ref: string; amountCents: number; receivedByName: string | null; receivedByRole: string | null; note: string | null; createdAt: string }
export interface CashSummary { collectedCents: number; receivedCents: number; outstandingCents: number; orders: CashOrder[]; recent: CashRecent[] }
