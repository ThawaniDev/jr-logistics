import { and, asc, desc, eq, inArray, sql, count, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { shipments, offers, requests, users, businessProfiles, jobEvents, shipmentMedia, type User } from "@/db/schema";
import { AppError, err } from "@/lib/errors";
import { randomToken } from "@/lib/ids";
import { STOP_FAIL_REASONS, FAIL_NEEDS_NOTE, FAIL_NEEDS_ARRIVAL } from "./catalog";
import { getSettings } from "./settings";
import { logEvent } from "./events";
import { notify, notifyMany, notifyOps } from "./notify";
import { audit } from "./audit";
import { can } from "./auth/permissions";
import { hit } from "./auth/ratelimit";
import { contains, likeEscape } from "@/lib/sql";
import { normalizePhone } from "@/lib/phone";
import { storage } from "./storage";
import { matchesMime } from "./accounts";
import { lockOffer, expect, forDriver, authorizeBusinessSide, openTicket, autoConfirmDelivery } from "./jobs";
import { effectiveOps } from "./warehouse";
import { isRoutingOn, autoStartRoute } from "./routing-mode";
import { batchOf, recordShipmentEvents, type ShipEvt } from "./shipment-events";
import { liveParcel, orderByAwb } from "./partners/orders-core";
import { backfillOffersForDriver } from "./matching";
import { createDraft, assertOwner, lockRequest, releaseReserve, type RequestInput } from "./requests";
import {
  currentStopOf, distanceM, markRouteFinished, normalizeScan, otpMatches, releaseOfferShipments, scanMatches, sendRecipientCodes,
  businessShipmentView, prepareManifest, syncOfferUnits, incompleteCount, OTP_MAX_ATTEMPTS, OTP_MAX_RESENDS, type ShipmentInput,
} from "./shipments";

/**
 * Routing ON: the driver works ONE stop at a time, in the route order fixed in the manifest and approved by the driver:
 *   approve route → (arrive → deliver | fail | defer once) → next stop … → finish.
 * Every stop action is refused unless that stop is the current one, so a driver can never bulk-confirm.
 * Routing OFF (J2): there is no approval step and no lock — any `loaded` stop of the driver's own job may be worked in any order (the route "starts" by itself
 * once loading is confirmed); every other rule (arrival, parcel code, OTP, COD, geofence, signature) is unchanged.
 */
const actorOf = (u: User) => ({ id: u.id, name: u.name, role: u.role });

/**
 * `replayOf`: an exact repeat of an action that already succeeded (a retry after a lost response, a double tap, two racing requests)
 * is answered with the stop as it now is instead of a 409 — the action itself is never applied twice.
 */
async function stopGuard(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], driver: User, offerId: string, shipmentId: string, replayOf?: (s: typeof shipments.$inferSelect) => boolean) {
  let o = await lockOffer(tx, offerId);
  forDriver(driver, o);
  expect(o, "attendance_confirmed");
  const routing = await isRoutingOn(tx);
  if (!o.routeApprovedAt) {
    if (routing) throw err("INVALID_TRANSITION", "Approve the route first");
    if (o.loadedUnits == null || o.loadedAckByDriver !== true) throw err("INVALID_TRANSITION", "Finish loading first");
    o = await autoStartRoute(tx, o, actorOf(driver)); // a job that was mid-flow when routing was switched off: the first stop action starts its route
  }
  const [s] = await tx.select().from(shipments).where(and(eq(shipments.id, shipmentId), eq(shipments.offerId, offerId))).for("update");
  if (!s) throw err("NOT_FOUND", "Stop not found");
  if (s.status !== "loaded") {
    if (replayOf?.(s)) return { o, s, r: null as never, replayed: true as const };
    throw err("INVALID_TRANSITION", `This stop is already ${s.status}`, { status: s.status });
  }
  if (routing) { // routing off: no one-stop-at-a-time lock
    const cur = await currentStopOf(tx, offerId);
    if (cur && cur.id !== s.id) throw err("STOP_LOCKED", "Finish the current stop first", { currentId: cur.id, currentSeq: cur.seq });
  }
  const [r] = await tx.select().from(requests).where(eq(requests.id, o.requestId));
  return { o, s, r, replayed: false as const };
}

/** After a stop is resolved the next one becomes current and its recipient is texted their code. */
const nextCurrentId = async (tx: Parameters<typeof currentStopOf>[0], offerId: string) => (await currentStopOf(tx, offerId))?.id ?? null;

/**
 * The driver reviews the fixed stop order and approves it. This unlocks the stops (decision C3/D5: driver approval).
 * Routing OFF (J2): there is no approval step — the call is a harmless idempotent no-op that only makes sure the route is marked as started (old clients mid-flow keep working).
 */
export async function approveRoute(driver: User, offerId: string) {
  let next: string | null = null;
  const out = await db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    forDriver(driver, o);
    expect(o, "attendance_confirmed");
    if (o.loadedUnits == null || o.loadedAckByDriver !== true) throw err("INVALID_TRANSITION", "Confirm the loaded parcels first");
    if (!(await isRoutingOn(tx))) {
      const started = await autoStartRoute(tx, o, actorOf(driver));
      if (!o.routeApprovedAt) next = await nextCurrentId(tx, offerId);
      return started;
    }
    if (o.routeApprovedAt) throw err("CONFLICT", "Route already approved");
    const [u] = await tx.update(offers).set({ routeApprovedAt: new Date(), updatedAt: new Date() }).where(eq(offers.id, offerId)).returning();
    await logEvent(tx, { requestId: o.requestId, offerId, actor: actorOf(driver), type: "route_approved", payload: { stops: o.loadedUnits } });
    next = await nextCurrentId(tx, offerId);
    return u;
  });
  if (next) await sendRecipientCodes([next]);
  return out;
}

export async function arriveAtStop(driver: User, offerId: string, shipmentId: string, loc?: { lat?: number; lng?: number }) {
  let text: string | null = null;
  const out = await db.transaction(async (tx) => {
    const { o, s } = await stopGuard(tx, driver, offerId, shipmentId);
    if (s.arrivedAt) return s; // idempotent: a second tap changes nothing, the wait clock keeps running
    const [u] = await tx.update(shipments).set({ arrivedAt: new Date(), updatedAt: new Date() }).where(eq(shipments.id, s.id)).returning();
    const dist = loc?.lat != null && loc?.lng != null && s.lat != null && s.lng != null ? distanceM({ lat: loc.lat, lng: loc.lng }, { lat: s.lat, lng: s.lng }) : null;
    await logEvent(tx, { requestId: o.requestId, offerId, actor: actorOf(driver), type: "stop_arrived", payload: { shipmentId: s.id, code: s.code, distanceM: dist, ...loc } });
    if (!(await isRoutingOn(tx))) text = s.id; // routing off: stops are worked in any order, so the recipient may not have been texted yet — they get their code when the driver reaches them
    return u;
  });
  if (text) await sendRecipientCodes([text]); // no-op when they were already texted
  return out;
}

export interface DeliverInput { code: string; otp?: string | null; proof?: "receipt" | null; receiverName?: string | null; signatureMediaId?: string | null; cashCollectedCents?: number | null; lat?: number | null; lng?: number | null }

export async function deliverStop(driver: User, offerId: string, shipmentId: string, i: DeliverInput) {
  let next: string | null = null;
  const res = await db.transaction(async (tx) => {
    const g = await stopGuard(tx, driver, offerId, shipmentId, (x) => x.status === "delivered" && scanMatches(x, i.code));
    if (g.replayed) return { wrong: false as const, shipment: g.s, nextId: null };
    const { o, s, r } = g;
    if (!s.arrivedAt) throw err("INVALID_TRANSITION", "Tap “I've arrived” at the address first");
    if (!scanMatches(s, i.code)) throw err("VALIDATION", "This parcel's code does not match the current stop — check you are holding the right parcel", { field: "code" });
    const ops = await effectiveOps(r.businessId, tx);
    // Cheap validations first: they must not burn a recipient's OTP attempt.
    if (s.codCents > 0 && i.cashCollectedCents !== s.codCents) throw err("CASH_MISMATCH", `Collect exactly SAR ${(s.codCents / 100).toFixed(2)} from the recipient`, { field: "cashCollectedCents", expectedCents: s.codCents });
    if (ops.requireSignature && !i.signatureMediaId) throw err("SIGNATURE_REQUIRED", "The recipient's signature is required", { field: "signatureMediaId" });
    let proofType: "otp" | "receipt" | "scan";
    let receiverName: string | null = null;
    if (!ops.requireDeliveryOtp) {
      proofType = "scan"; // E9: this warehouse does not use delivery codes — the scanned parcel is the proof
    } else if (i.otp != null && String(i.otp).trim() !== "") {
      if (s.otpAttempts >= OTP_MAX_ATTEMPTS) throw err("OTP_LOCKED", "Too many wrong codes — resend the code to the recipient", { attemptsLeft: 0 });
      if (!otpMatches(s, String(i.otp))) {
        const [u] = await tx.update(shipments).set({ otpAttempts: sql`${shipments.otpAttempts} + 1`, updatedAt: new Date() }).where(eq(shipments.id, s.id)).returning({ a: shipments.otpAttempts });
        await logEvent(tx, { requestId: o.requestId, offerId, actor: actorOf(driver), type: "stop_otp_failed", payload: { shipmentId: s.id, code: s.code, attempts: u.a } });
        return { wrong: true as const, left: Math.max(0, OTP_MAX_ATTEMPTS - u.a) }; // committed, THEN rejected — the attempt must count
      }
      proofType = "otp";
    } else if (i.proof === "receipt") {
      if (s.recipientType !== "business") throw err("OTP_REQUIRED", "A consumer must give their delivery code — a receipt photo is not enough");
      if (!s.proofKey) throw err("VALIDATION", "Photograph the signed or stamped receipt first", { field: "proof" });
      receiverName = (i.receiverName ?? "").trim();
      if (receiverName.length < 2) throw err("VALIDATION", "Enter the name of the person who received the parcel", { field: "receiverName" });
      proofType = "receipt";
    } else throw err("OTP_REQUIRED", "Ask the recipient for their delivery code");
    if (ops.requireSignature) await consumeMedia(tx, i.signatureMediaId!, s, o.id, "signature", driver.id);
    const dist = i.lat != null && i.lng != null && s.lat != null && s.lng != null ? distanceM({ lat: i.lat, lng: i.lng }, { lat: s.lat, lng: s.lng }) : null;
    const now = new Date();
    const [u] = await tx.update(shipments).set({
      status: "delivered", deliveredAt: now, deliveredLat: i.lat ?? null, deliveredLng: i.lng ?? null, deliveredDistanceM: dist,
      proofType, receiverName, attempts: s.attempts + 1, updatedAt: now,
      ...(s.codCents > 0 ? { codCollectedCents: s.codCents, codCollectedAt: now } : {}),
    }).where(eq(shipments.id, s.id)).returning();
    await logEvent(tx, { requestId: o.requestId, offerId, actor: actorOf(driver), type: "shipment_delivered", payload: { shipmentId: s.id, code: s.code, externalRef: s.externalRef, proofType, distanceM: dist, ...(s.codCents > 0 ? { codCents: s.codCents } : {}), ...(ops.requireSignature ? { signatureMediaId: i.signatureMediaId } : {}) } });
    next = await nextCurrentId(tx, offerId);
    void r;
    return { wrong: false as const, shipment: u, nextId: next };
  });
  if (res.wrong) throw err("OTP_INVALID", "That code is not correct", { attemptsLeft: res.left });
  if (next) await sendRecipientCodes([next]);
  return res.shipment;
}

export interface FailInput { reason: string; note?: string | null; mediaId?: string | null; lat?: number | null; lng?: number | null }

/**
 * E14: every reason is selectable at any time (no arrival / note rules) unless the platform turned `stopFailStrictRules` on; an optional photo can
 * be attached to any reason. The door timer (E8) only applies when the platform set `stopWaitMin > 0`.
 */
export async function failStop(driver: User, offerId: string, shipmentId: string, i: FailInput) {
  if (!(STOP_FAIL_REASONS as readonly string[]).includes(i.reason)) throw err("VALIDATION", "Unknown reason", { field: "reason" });
  let next: string | null = null;
  const u = await db.transaction(async (tx) => {
    const g = await stopGuard(tx, driver, offerId, shipmentId, (x) => x.status === "failed" && x.failReason === i.reason);
    if (g.replayed) return g.s;
    const { o, s, r } = g;
    const cfg = await getSettings(tx);
    if (cfg.stopFailStrictRules) {
      if (FAIL_NEEDS_NOTE.includes(i.reason) && !(i.note ?? "").trim()) throw err("VALIDATION", "Add a short note so operations can follow up", { field: "note" });
      if (FAIL_NEEDS_ARRIVAL.includes(i.reason) && !s.arrivedAt) throw err("INVALID_TRANSITION", "Tap “I've arrived” at the address first");
    }
    if (i.reason === "unreachable" && cfg.stopWaitMin > 0) {
      if (!s.arrivedAt) throw err("INVALID_TRANSITION", "Tap “I've arrived” at the address first");
      const left = cfg.stopWaitMin * 60_000 - (Date.now() - s.arrivedAt.getTime());
      if (left > 0) throw err("WAIT_REQUIRED", "Wait at the address and keep trying before reporting the recipient as unreachable", { remainingSec: Math.ceil(left / 1000) });
    }
    if (i.mediaId) await consumeMedia(tx, i.mediaId, s, o.id, "fail", driver.id);
    const now = new Date();
    const [row] = await tx.update(shipments).set({ status: "failed", failReason: i.reason, failNote: (i.note ?? "").trim() || null, failedAt: now, attempts: s.attempts + 1, updatedAt: now }).where(eq(shipments.id, s.id)).returning();
    await logEvent(tx, { requestId: o.requestId, offerId, actor: actorOf(driver), type: "shipment_failed", payload: { shipmentId: s.id, code: s.code, externalRef: s.externalRef, reason: i.reason, note: i.note ?? null, ...(i.mediaId ? { mediaId: i.mediaId } : {}) } });
    await notify(r.businessId, "shipment_failed", { requestId: r.id, ref: r.ref, code: s.code, reason: i.reason }, tx);
    next = await nextCurrentId(tx, offerId);
    return row;
  });
  if (next) await sendRecipientCodes([next]);
  return u;
}

/**
 * "Closed for now" / reschedule: the stop goes to the end of the route — once. E7: the driver must give evidence — a written reason and/or a photo,
 * as the platform policy requires (`rescheduleEvidenceText` / `rescheduleEvidencePhoto`); the warehouse and ops can see it on the parcel.
 */
export async function deferStop(driver: User, offerId: string, shipmentId: string, i: { note?: string | null; mediaId?: string | null } = {}) {
  let next: string | null = null;
  const u = await db.transaction(async (tx) => {
    const { o, s, r } = await stopGuard(tx, driver, offerId, shipmentId);
    if (s.deferCount >= 1) throw err("INVALID_TRANSITION", "A stop can be postponed only once — deliver it or report a problem");
    const cfg = await getSettings(tx);
    const note = (i.note ?? "").trim();
    const needText = cfg.rescheduleEvidenceText && note.length < 3, needPhoto = cfg.rescheduleEvidencePhoto && !i.mediaId;
    if (needText || needPhoto) throw err("EVIDENCE_REQUIRED", "Add the evidence for postponing this stop", { note: needText, photo: needPhoto });
    const [{ left, mx }] = await tx.select({ left: sql<number>`count(*)::int`, mx: sql<number>`coalesce(max(${shipments.stopOrder}),0)::int` }).from(shipments).where(and(eq(shipments.offerId, offerId), eq(shipments.status, "loaded")));
    if (left < 2) throw err("INVALID_TRANSITION", "This is the last stop — nothing to postpone it behind");
    if (i.mediaId) await consumeMedia(tx, i.mediaId, s, o.id, "defer", driver.id);
    const [row] = await tx.update(shipments).set({ stopOrder: mx + 1, deferCount: s.deferCount + 1, arrivedAt: null, notifiedAt: s.notifiedAt, updatedAt: new Date() }).where(eq(shipments.id, s.id)).returning();
    await logEvent(tx, { requestId: o.requestId, offerId, actor: actorOf(driver), type: "stop_deferred", payload: { shipmentId: s.id, code: s.code, note: note || null, ...(i.mediaId ? { mediaId: i.mediaId } : {}) } });
    await notify(r.businessId, "shipment_deferred", { requestId: r.id, ref: r.ref, code: s.code }, tx);
    next = await nextCurrentId(tx, offerId);
    return row;
  });
  if (next) await sendRecipientCodes([next]);
  return u;
}

// ───────── Evidence photos (E7, E10, E14) ─────────
const MEDIA_KINDS = ["defer", "fail", "signature"] as const;
type MediaKind = (typeof MEDIA_KINDS)[number];

/** Stores a photo for the CURRENT stop; it is consumed by the next defer / fail / deliver that references its id. */
export async function saveStopMedia(driver: User, offerId: string, shipmentId: string, f: { data: Buffer; mime: string; kind: string; note?: string | null }) {
  if (!(MEDIA_KINDS as readonly string[]).includes(f.kind)) throw err("VALIDATION", "Unknown kind", { field: "kind" });
  if (!["image/jpeg", "image/png", "image/webp"].includes(f.mime)) throw err("VALIDATION", "Upload a JPG, PNG or WebP photo", { field: "file" });
  if (f.data.length > 8 * 1024 * 1024) throw err("VALIDATION", "Photo is larger than 8 MB", { field: "file" });
  if (f.data.length < 8 || !matchesMime(f.data, f.mime)) throw err("VALIDATION", "The file content does not match its type", { field: "file" });
  const ext = f.mime === "image/png" ? "png" : f.mime === "image/webp" ? "webp" : "jpg";
  const key = `stopmedia/${shipmentId}/${randomToken(8)}.${ext}`;
  return db.transaction(async (tx) => {
    const { o, s } = await stopGuard(tx, driver, offerId, shipmentId);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(shipmentMedia).where(and(eq(shipmentMedia.shipmentId, s.id), sql`${shipmentMedia.usedAt} is null`));
    if (n >= 8) throw err("RATE_LIMITED", "Too many unused photos on this stop — use or retake them first");
    await storage().put(key, f.data);
    const [m] = await tx.insert(shipmentMedia).values({ shipmentId: s.id, requestId: o.requestId, offerId: o.id, kind: f.kind, storageKey: key, mime: f.mime, note: f.note?.trim() || null, uploadedBy: driver.id }).returning();
    return { id: m.id, kind: m.kind as MediaKind };
  });
}

/** Marks an uploaded photo as used by an action; refuses ids that are not this driver's unused photo of that kind for this very stop. */
async function consumeMedia(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], mediaId: string, s: { id: string }, offerId: string, kind: MediaKind, driverId: string) {
  const [m] = await tx.select().from(shipmentMedia).where(and(eq(shipmentMedia.id, mediaId), eq(shipmentMedia.shipmentId, s.id), eq(shipmentMedia.offerId, offerId), eq(shipmentMedia.kind, kind), eq(shipmentMedia.uploadedBy, driverId), sql`${shipmentMedia.usedAt} is null`)).for("update");
  if (!m) throw err("VALIDATION", "Upload the photo again — it was not found or was already used", { field: kind === "signature" ? "signatureMediaId" : "mediaId" });
  await tx.update(shipmentMedia).set({ usedAt: new Date() }).where(eq(shipmentMedia.id, m.id));
}

/** Evidence attached to a parcel (only photos an action actually used). Same visibility as the parcel itself. */
export async function listShipmentMedia(viewer: User, shipmentId: string) {
  const [s] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!s) throw err("NOT_FOUND", "Shipment not found");
  await mediaAccess(viewer, s.requestId, s.offerId);
  const rows = await db.select({ m: shipmentMedia, by: users.name }).from(shipmentMedia).leftJoin(users, eq(users.id, shipmentMedia.uploadedBy))
    .where(and(eq(shipmentMedia.shipmentId, shipmentId), sql`${shipmentMedia.usedAt} is not null`)).orderBy(asc(shipmentMedia.createdAt));
  return { items: rows.map(({ m, by }) => ({ id: m.id, kind: m.kind, note: m.note, createdAt: m.createdAt, byName: by })) };
}

export async function readShipmentMedia(viewer: User, shipmentId: string, mediaId: string) {
  const [row] = await db.select({ m: shipmentMedia, s: shipments }).from(shipmentMedia).innerJoin(shipments, eq(shipments.id, shipmentMedia.shipmentId)).where(and(eq(shipmentMedia.id, mediaId), eq(shipmentMedia.shipmentId, shipmentId)));
  if (!row) throw err("NOT_FOUND", "No photo");
  await mediaAccess(viewer, row.s.requestId, row.s.offerId);
  return { data: await storage().get(row.m.storageKey), mime: row.m.mime };
}

async function mediaAccess(viewer: User, requestId: string, offerId: string | null) {
  const [r] = await db.select().from(requests).where(eq(requests.id, requestId));
  const [o] = offerId ? await db.select({ d: offers.driverId }).from(offers).where(eq(offers.id, offerId)) : [];
  const ok = r && (viewer.id === r.businessId || viewer.id === o?.d || viewer.role === "admin" || (viewer.role === "staff" && can(viewer, "requests.view")));
  if (!ok) throw err("NOT_FOUND", "No photo");
}

/** Texts the recipient a fresh code (old one stops working, wrong-attempt counter resets). Capped so it cannot be used to spam a stranger. */
export async function resendCode(driver: User, offerId: string, shipmentId: string) {
  await db.transaction(async (tx) => {
    const { o, s } = await stopGuard(tx, driver, offerId, shipmentId);
    if (s.otpSends >= OTP_MAX_RESENDS) throw err("RATE_LIMITED", "The code was already resent the maximum number of times — contact operations");
    // The resend is counted when it is REQUESTED, not when the SMS gets through: every resend hands the driver five fresh guesses at the 4-digit code, so a provider
    // outage (no SMS leaves, nothing is counted) must not turn the cap into "unlimited guesses".
    await tx.update(shipments).set({ otpVersion: s.otpVersion + 1, otpAttempts: 0, otpSends: s.otpSends + 1, updatedAt: new Date() }).where(eq(shipments.id, s.id));
    await logEvent(tx, { requestId: o.requestId, offerId, actor: actorOf(driver), type: "stop_code_resent", payload: { shipmentId: s.id, code: s.code } });
  });
  const sent = await sendRecipientCodes([shipmentId], { force: true });
  return { sent: sent > 0 };
}

/** B2B receipts: a photo of the signed / stamped / ID-numbered paper. Magic bytes are checked, not just the declared type. */
export async function saveProofPhoto(driver: User, offerId: string, shipmentId: string, f: { data: Buffer; mime: string }) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(f.mime)) throw err("VALIDATION", "Upload a JPG, PNG or WebP photo", { field: "file" });
  if (f.data.length > 8 * 1024 * 1024) throw err("VALIDATION", "Photo is larger than 8 MB", { field: "file" });
  if (!matchesMime(f.data, f.mime)) throw err("VALIDATION", "The file content does not match its type", { field: "file" });
  const ext = f.mime === "image/png" ? "png" : f.mime === "image/webp" ? "webp" : "jpg";
  const key = `pod/${shipmentId}/${randomToken(8)}.${ext}`;
  return db.transaction(async (tx) => {
    const { o, s } = await stopGuard(tx, driver, offerId, shipmentId);
    if (s.recipientType !== "business") throw err("VALIDATION", "A receipt photo is only accepted for business recipients");
    if (!s.arrivedAt) throw err("INVALID_TRANSITION", "Tap “I've arrived” at the address first");
    await storage().put(key, f.data);
    if (s.proofKey) await storage().remove(s.proofKey).catch(() => {});
    await tx.update(shipments).set({ proofKey: key, updatedAt: new Date() }).where(eq(shipments.id, s.id));
    await logEvent(tx, { requestId: o.requestId, offerId, actor: actorOf(driver), type: "stop_proof_uploaded", payload: { shipmentId: s.id, code: s.code } });
    return { hasProof: true };
  });
}

const sniff = (b: Buffer) => (b[0] === 0x89 ? "image/png" : b[0] === 0x52 ? "image/webp" : "image/jpeg");
export async function readProof(viewer: User, shipmentId: string) {
  const [row] = await db.select({ s: shipments, o: offers, r: requests }).from(shipments).innerJoin(requests, eq(requests.id, shipments.requestId)).leftJoin(offers, eq(offers.id, shipments.offerId)).where(eq(shipments.id, shipmentId));
  if (!row?.s.proofKey) throw err("NOT_FOUND", "No receipt photo");
  const allowed = viewer.id === row.r.businessId || viewer.id === row.o?.driverId || viewer.role === "admin" || (viewer.role === "staff" && can(viewer, "requests.view"));
  if (!allowed) throw err("NOT_FOUND", "No receipt photo");
  const data = await storage().get(row.s.proofKey);
  return { data, mime: sniff(data) };
}

/**
 * The driver cannot continue (breakdown, illness, emergency) — or operations ends the route for them. Delivered stops stay paid;
 * everything still on board is marked failed (to be returned), the business is told, and an urgent ticket is opened.
 * Platform policy (C6): an office driver is replaced by the same office, a freelancer's parcels go back to the warehouse.
 */
export async function endRoute(actor: User, offerId: string, reason: string, note?: string) {
  const out = await endRouteTx(actor, offerId, reason, note);
  if (actor.role === "driver") await backfillOffersForDriver(actor.id).catch(() => {});
  return out;
}

async function endRouteTx(actor: User, offerId: string, reason: string, note?: string) {
  if (!reason?.trim()) throw err("VALIDATION", "Reason is required", { field: "reason" });
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    const staff = can(actor, "replacements.manage");
    if (!staff) forDriver(actor, o);
    expect(o, "attendance_confirmed");
    if (!o.routeApprovedAt && ((await isRoutingOn(tx)) || o.loadedAckByDriver !== true)) throw err("INVALID_TRANSITION", "The route has not started — cancel the job instead"); // routing off: loading confirmed = the route has started
    const [r] = await tx.select().from(requests).where(eq(requests.id, o.requestId));
    const moved = await releaseOfferShipments(tx, o, "driver_unavailable");
    const { delivered } = await markRouteFinished(tx, o, "route_ended_early", actorOf(actor), { reason, note: note ?? null, ...moved });
    if (staff && actor.id !== o.driverId) await audit(actor, "offer.end_route", "offer", offerId, { reason }, tx);
    const [drv] = await tx.select({ name: users.name }).from(users).where(eq(users.id, o.driverId));
    await openTicket(tx, actor.id === o.driverId ? actor : { ...actor }, { category: "urgent", subject: `${r.ref}: route ended early (${reason})`, requestId: r.id, offerId, body: note, priority: "urgent" });
    await notify(r.businessId, "route_ended_early", { requestId: r.id, ref: r.ref, driver: drv?.name, remaining: moved.toReturn }, tx);
    if (o.officeId) await notify(o.officeId, "office_route_ended", { requestId: r.id, ref: r.ref, driver: drv?.name, remaining: moved.toReturn }, tx);
    await notifyOps("replacements.manage", "route_ended_ops", { ref: r.ref, remaining: moved.toReturn }, tx);
    const offer = await autoConfirmDelivery(tx, offerId, actor.id === o.driverId ? null : actor); // E16/E18: what was delivered is confirmed and paid now
    return { offer, delivered, toReturn: moved.toReturn };
  });
}

/** The warehouse receives the parcels that could not be delivered, one by one. Only then can the job be confirmed. */
export async function confirmReturns(actor: User, offerId: string, sel: { codes?: string[]; all?: boolean }) {
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    const r = await authorizeBusinessSide(tx, actor, o);
    expect(o, "delivered_reported", "pending_settlement", "qty_disputed", "completed", "cancelled"); // E16: receiving parcels back never blocks the money, so it works after the job is done; "cancelled" = the request was cancelled / called off while the parcels were on the vehicle (they come back as failed(request_cancelled))
    const failed = await tx.select().from(shipments).where(and(eq(shipments.offerId, offerId), eq(shipments.status, "failed"))).orderBy(asc(shipments.seq));
    let chosen = failed;
    if (!sel.all) {
      const codes = [...new Set((sel.codes ?? []).map(normalizeScan).filter(Boolean))];
      if (!codes.length) throw err("VALIDATION", "Scan or select the returned parcels", { field: "codes" });
      const unknown = codes.filter((c) => !failed.some((s) => scanMatches(s, c)));
      if (unknown.length) throw err("VALIDATION", "Some codes are not awaiting return", { field: "codes", unknown });
      chosen = failed.filter((s) => codes.some((c) => scanMatches(s, c)));
    }
    if (!chosen.length) throw err("NOTHING_TO_DO", "No parcels are awaiting return");
    const now = new Date();
    await tx.update(shipments).set({ status: "returned", returnedAt: now, updatedAt: now }).where(inArray(shipments.id, chosen.map((s) => s.id)));
    await recordShipmentEvents(tx, chosen.map((s) => ({ shipmentId: s.id, requestId: r.id, offerId, type: "returned" as const, actor: actorOf(actor), payload: { code: s.code, failReason: s.failReason } })));
    if (actor.id !== r.businessId) await audit(actor, "offer.confirm_returns", "offer", offerId, { count: chosen.length }, tx);
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(actor), type: "shipments_returned", payload: { count: chosen.length, codes: chosen.map((s) => s.code) } });
    return { returned: chosen.length, stillOut: failed.length - chosen.length };
  });
}

// ───────── Fixing or withdrawing one parcel before it leaves the warehouse ─────────
const EDITABLE_REQUEST = ["draft", "published", "filling", "assigned", "confirmed", "in_progress"];

async function ownParcel(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], actor: User, shipmentId: string) {
  const [peek] = await tx.select({ requestId: shipments.requestId }).from(shipments).where(eq(shipments.id, shipmentId));
  if (!peek) throw err("NOT_FOUND", "Shipment not found");
  const r = await lockRequest(tx, peek.requestId);
  if (actor.id !== r.businessId && !can(actor, "requests.edit")) throw err("NOT_FOUND", "Shipment not found");
  if (!EDITABLE_REQUEST.includes(r.status)) throw err("INVALID_TRANSITION", `Request is ${r.status}`);
  const [s] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).for("update");
  if (s.status !== "pending") throw err("INVALID_TRANSITION", "This parcel is already with the driver — it can no longer be changed", { status: s.status });
  return { r, s };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Applies a patch to one parcel that is still at the warehouse. A parcel that is still incomplete may be saved partially (progress is kept); a complete one may not be blanked. */
async function applyParcelPatch(tx: Tx, actor: User, r: typeof requests.$inferSelect, s: typeof shipments.$inferSelect, patch: Partial<ShipmentInput>) {
  const merged: ShipmentInput = {
    recipientType: (patch.recipientType ?? s.recipientType) as "consumer" | "business", recipientName: patch.recipientName !== undefined ? patch.recipientName : s.recipientName, recipientPhone: patch.recipientPhone !== undefined ? patch.recipientPhone : s.recipientPhone,
    address: patch.address !== undefined ? patch.address : s.address, city: s.city, lat: patch.lat !== undefined ? patch.lat : s.lat, lng: patch.lng !== undefined ? patch.lng : s.lng,
    contents: patch.contents !== undefined ? patch.contents : s.contents, notes: patch.notes !== undefined ? patch.notes : s.notes, externalRef: patch.externalRef !== undefined ? patch.externalRef : s.externalRef, codCents: patch.codCents !== undefined ? patch.codCents : s.codCents, // A new order reference no longer names the partner order the parcel came from: the link goes with it.
    partnerId: patch.externalRef !== undefined && (patch.externalRef ?? "").trim().toLowerCase() !== (s.externalRef ?? "").toLowerCase() ? null : s.partnerId,
  };
  // J3: a parcel that already is a business parcel keeps working (it may be edited); anything else may not become one while B2B is off.
  const [row] = await prepareManifest([merged], r.deliveryCity, tx, { allowIncomplete: !s.detailsComplete, b2b: s.recipientType === "business" ? "keep" : "reject" });
  const dup = row.externalRef ? await tx.select({ id: shipments.id }).from(shipments).where(and(eq(shipments.requestId, r.id), sql`lower(${shipments.externalRef}) = ${row.externalRef.toLowerCase()}`, sql`${shipments.id} <> ${s.id}`)) : [];
  if (dup.length) throw err("VALIDATION", `Order reference "${row.externalRef}" is already used in this request`, { field: "externalRef" });
  const phoneChanged = row.recipientPhone !== s.recipientPhone;
  const addressChanged = row.address !== s.address;
  // A new address invalidates a pin we found ourselves; a pin the business typed or imported is theirs to keep (they can send new lat/lng with it).
  const keepPin = patch.lat !== undefined || !addressChanged || s.geoSource === "given";
  const [u] = await tx.update(shipments).set({
    ...row, ...(keepPin ? {} : { lat: null, lng: null, geoSource: null }), otpVersion: phoneChanged ? s.otpVersion + 1 : s.otpVersion, notifiedAt: null, updatedAt: new Date(),
  }).where(eq(shipments.id, s.id)).returning();
  return { u, wasIncomplete: !s.detailsComplete };
}

/** Correct a typo — or fill in details that were booked "later" — while the parcel is still at the warehouse. */
export async function updateShipment(actor: User, shipmentId: string, patch: Partial<ShipmentInput>) {
  return db.transaction(async (tx) => {
    const { r, s } = await ownParcel(tx, actor, shipmentId);
    const { u, wasIncomplete } = await applyParcelPatch(tx, actor, r, s, patch);
    if (actor.id !== r.businessId) await audit(actor, "shipment.update", "shipment", s.id, { fields: Object.keys(patch) }, tx);
    await logEvent(tx, { requestId: r.id, offerId: s.offerId, actor: actorOf(actor), type: wasIncomplete && u.detailsComplete ? "shipment_details_completed" : "shipment_updated", payload: { shipmentId: s.id, code: s.code, fields: Object.keys(patch) } });
    return businessShipmentView(u, actor);
  });
}

export const BULK_COMPLETE_MAX = 500;
export type CompleteRow = Partial<ShipmentInput> & { id?: string | null; code?: string | null; seq?: number | null };

/**
 * Fill in many parcels at once (a pasted sheet, "details later" follow-up). Each row names its parcel by `id`, `code` (JR-000012-007) or manifest `seq`.
 * All-or-nothing: the first bad row aborts with `details.row` (1-based) and nothing is changed.
 */
export async function completeShipments(actor: User, requestId: string, rows: CompleteRow[]) {
  if (!Array.isArray(rows) || rows.length === 0) throw err("VALIDATION", "Nothing to update", { field: "rows" });
  if (rows.length > BULK_COMPLETE_MAX) throw err("VALIDATION", `At most ${BULK_COMPLETE_MAX} parcels per update`, { field: "rows", max: BULK_COMPLETE_MAX });
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, requestId);
    if (actor.id !== r.businessId && !can(actor, "requests.edit")) throw err("NOT_FOUND", "Request not found");
    if (!EDITABLE_REQUEST.includes(r.status)) throw err("INVALID_TRANSITION", `Request is ${r.status}`);
    const all = await tx.select().from(shipments).where(eq(shipments.requestId, requestId)).for("update");
    const byId = new Map(all.map((s) => [s.id, s])), byCode = new Map(all.map((s) => [s.code.toUpperCase(), s])), bySeq = new Map(all.map((s) => [s.seq, s]));
    const seen = new Set<string>();
    let completed = 0, updated = 0;
    const journey: ShipEvt[] = [];
    for (let i = 0; i < rows.length; i++) {
      const { id, code, seq, ...patch } = rows[i];
      const bad = (message: string, field = "id") => err("VALIDATION", `Row ${i + 1}: ${message}`, { field: `rows.${i}.${field}`, row: i + 1 });
      const s = (id && byId.get(id)) || (code && byCode.get(normalizeScan(code))) || (seq != null && bySeq.get(seq)) || null;
      if (!s) throw bad("parcel not found in this request");
      if (seen.has(s.id)) throw bad(`parcel ${s.code} appears twice`);
      seen.add(s.id);
      if (s.status !== "pending") throw err("INVALID_TRANSITION", `Row ${i + 1}: parcel ${s.code} is already ${s.status}`, { row: i + 1, status: s.status });
      let res;
      try { res = await applyParcelPatch(tx, actor, r, s, patch); }
      catch (e) {
        if (e instanceof AppError && e.code === "B2B_DISABLED") throw err("B2B_DISABLED", `Row ${i + 1} (${s.code}): business shipments are turned off — every parcel goes to a consumer`, { field: "recipientType", path: `rows.${i}.recipientType`, row: i + 1, code: s.code });
        if (e instanceof AppError && e.code === "VALIDATION") { const f = String(e.details?.field ?? "").replace(/^shipments\.\d+\./, ""); throw err("VALIDATION", `Row ${i + 1} (${s.code}): ${e.message.replace(/^Shipment \d+: /, "")}`, { field: f ? `rows.${i}.${f}` : `rows.${i}`, row: i + 1, code: s.code }); } throw e; }
      updated++;
      if (res.wasIncomplete && res.u.detailsComplete) completed++;
      journey.push({ shipmentId: s.id, requestId, offerId: s.offerId, type: res.wasIncomplete && res.u.detailsComplete ? "details_completed" : "edited", actor: actorOf(actor), payload: { code: s.code, fields: Object.keys(patch), bulk: true } });
    }
    await recordShipmentEvents(tx, journey);
    if (actor.id !== r.businessId) await audit(actor, "shipment.bulk_update", "request", requestId, { rows: updated }, tx);
    await logEvent(tx, { requestId, actor: actorOf(actor), type: "shipment_details_completed", payload: { updated, completed } });
    return { updated, completed, stillIncomplete: await incompleteCount(tx, requestId) };
  });
}

/** The store cancels one order before it is handed over: the parcel is withdrawn and its price goes straight back to the wallet. */
export async function cancelShipment(actor: User, shipmentId: string, reason: string) {
  if (!reason?.trim()) throw err("VALIDATION", "Reason is required", { field: "reason" });
  return db.transaction(async (tx) => {
    const { r, s } = await ownParcel(tx, actor, shipmentId);
    if (r.status === "draft") throw err("INVALID_TRANSITION", "Remove it from the draft instead");
    const wasOn = s.offerId;
    await tx.update(shipments).set({ status: "cancelled", failReason: "cancelled_by_sender", failNote: reason.trim(), offerId: null, stopOrder: null, updatedAt: new Date() }).where(eq(shipments.id, s.id));
    if (wasOn) await syncOfferUnits(tx, wasOn, (r.pricingSnapshot as { providerCostCents: number } | null)?.providerCostCents ?? 0);
    const price = r.unitPriceCents ?? 0;
    if (price > 0) {
      await releaseReserve(tx, r, price, `cancel-parcel:${s.id}`, actor.id);
      await tx.update(requests).set({ totalCents: sql`${requests.totalCents} - ${price}`, updatedAt: new Date() }).where(eq(requests.id, r.id));
    }
    if (actor.id !== r.businessId) await audit(actor, "shipment.cancel", "shipment", s.id, { reason }, tx);
    await logEvent(tx, { requestId: r.id, offerId: wasOn, actor: actorOf(actor), type: "shipment_cancelled", payload: { shipmentId: s.id, code: s.code, externalRef: s.externalRef, reason: reason.trim() } });
    if (wasOn) { const [o] = await tx.select({ d: offers.driverId }).from(offers).where(eq(offers.id, wasOn)); if (o) await notify(o.d, "shipment_cancelled", { requestId: r.id, ref: r.ref, code: s.code }, tx); }
    return { cancelled: true, refundedCents: price };
  });
}

// ───────── Reads ─────────
async function requestFor(viewer: User, requestId: string) {
  const [r] = await db.select().from(requests).where(eq(requests.id, requestId));
  if (!r) throw err("NOT_FOUND", "Request not found");
  if (viewer.role === "business") assertOwner(viewer, r);
  else if (!(viewer.role === "admin" || can(viewer, "requests.view"))) throw err("FORBIDDEN");
  return r;
}

export async function listRequestShipments(viewer: User, requestId: string, f: { status?: string; q?: string; page?: number; pageSize?: number }) {
  await requestFor(viewer, requestId);
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 200), page = Math.max(f.page ?? 1, 1);
  const where = and(
    eq(shipments.requestId, requestId), f.status ? eq(shipments.status, f.status) : undefined,
    f.q ? or(ilike(shipments.code, contains(f.q)), ilike(shipments.recipientName, contains(f.q)), ilike(shipments.recipientPhone, contains(f.q)), ilike(shipments.externalRef, contains(f.q)), ilike(shipments.address, contains(f.q))) : undefined,
  );
  const [rows, [{ total }], byStatus] = await Promise.all([
    db.select({ s: shipments, d: users.name }).from(shipments).leftJoin(offers, eq(offers.id, shipments.offerId)).leftJoin(users, eq(users.id, offers.driverId)).where(where).orderBy(asc(shipments.seq)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(shipments).where(where),
    db.select({ s: shipments.status, n: sql<number>`count(*)::int` }).from(shipments).where(eq(shipments.requestId, requestId)).groupBy(shipments.status),
  ]);
  return { items: rows.map(({ s, d }) => businessShipmentView(s, viewer, d)), page, pageSize, total: Number(total), counts: Object.fromEntries(byStatus.map((x) => [x.s, x.n])) };
}

export async function shipmentTimeline(viewer: User, shipmentId: string) {
  const [s] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!s) throw err("NOT_FOUND", "Shipment not found");
  await requestFor(viewer, s.requestId);
  const rows = await db.select({ id: jobEvents.id, type: jobEvents.type, actorName: jobEvents.actorName, actorRole: jobEvents.actorRole, payload: jobEvents.payload, createdAt: jobEvents.createdAt })
    .from(jobEvents).where(and(eq(jobEvents.requestId, s.requestId), sql`${jobEvents.payload}->>'shipmentId' = ${shipmentId}`)).orderBy(asc(jobEvents.createdAt));
  return { shipment: businessShipmentView(s, viewer), events: rows };
}

/**
 * Public parcel tracking for the person receiving it. Needs the parcel code AND the last four digits of the phone number it
 * was registered with; reveals only the stage — never the address, driver or business contact.
 */
export async function trackShipment(codeRaw: string, last4: string, ip = "unknown") {
  await hit(`track:${ip}`, 30, 600);
  const code = normalizeScan(codeRaw);
  // Per-parcel ceiling too: codes are guessable and there are only 10 000 possible "last 4 digits", so guesses spread over many addresses must still run dry.
  await hit(`track:code:${code.slice(0, 40)}`, 20, 600);
  const q = db.select({ s: shipments, r: requests, c: businessProfiles.companyName, n: users.name }).from(shipments).innerJoin(requests, eq(requests.id, shipments.requestId))
    .innerJoin(users, eq(users.id, requests.businessId)).leftJoin(businessProfiles, eq(businessProfiles.userId, requests.businessId));
  let [row] = await q.where(sql`upper(${shipments.code}) = ${code}`);
  if (!row) {
    // A JR tracking number issued to a warehouse system (Omniful / Fastcoo AWB): its live parcel, or the order itself while JR prepares it.
    const order = await orderByAwb(db, code);
    if (order) {
      const live = await liveParcel(db, order.id);
      if (live) [row] = await q.where(eq(shipments.id, live.id));
      else if (/^\d{4}$/.test(last4 ?? "") && (order.recipientPhone ?? "").slice(-4) === last4 && order.state !== "cancelled") {
        const [b] = await db.select({ c: businessProfiles.companyName, n: users.name }).from(users).leftJoin(businessProfiles, eq(businessProfiles.userId, users.id)).where(eq(users.id, order.businessId));
        return { code: order.awb!, sender: b?.c ?? b?.n ?? null, stage: "preparing", city: order.city ?? order.cityRaw ?? "", updatedAt: order.updatedAt, steps: { created: order.createdAt, handedToDriver: null, deliveredAt: null, attemptFailedAt: null } };
      }
    }
  }
  if (!row || !/^\d{4}$/.test(last4 ?? "") || row.s.recipientPhone.slice(-4) !== last4) throw err("NOT_FOUND", "We could not find this parcel — check the code and the last 4 digits of your phone number");
  const s = row.s;
  const stage = s.status === "delivered" ? "delivered" : s.status === "failed" || s.status === "returned" || s.status === "missing" ? "attempt_failed" : s.status === "cancelled" ? "cancelled" : s.status === "loaded" ? (s.arrivedAt ? "arrived" : "on_the_way") : "preparing";
  return {
    code: s.code, sender: row.c ?? row.n, stage, city: s.city, updatedAt: s.updatedAt,
    steps: { created: s.createdAt, handedToDriver: s.loadedAt, deliveredAt: s.deliveredAt, attemptFailedAt: s.failedAt },
    ...(stage === "attempt_failed" ? { failReason: s.failReason } : {}),
  };
}

/** One click: a new draft with the parcels that were not delivered (failed / returned / never carried), ready to review and publish. */
export async function reshipFromRequest(business: User, requestId: string, ids?: string[]) {
  const [src] = await db.select().from(requests).where(eq(requests.id, requestId));
  if (!src) throw err("NOT_FOUND", "Request not found");
  assertOwner(business, src);
  if (src.status === "draft") throw err("INVALID_TRANSITION", "A draft cannot be re-shipped");
  const rows = await db.select().from(shipments).where(and(eq(shipments.requestId, requestId),
    inArray(shipments.status, ["failed", "returned", "missing", "cancelled"]), ids?.length ? inArray(shipments.id, ids) : undefined,
    // never re-ship a parcel whose order the warehouse system itself cancelled
    sql`not exists (select 1 from partner_orders po where po.connection_id = ${shipments.partnerId} and po.cancelled_by = 'partner' and (lower(po.external_ref) = lower(${shipments.externalRef}) or po.awb = upper(${shipments.externalRef})))`)).orderBy(asc(shipments.seq));
  if (!rows.length) throw err("NOTHING_TO_DO", "There are no undelivered parcels to re-ship");
  // A parcel already re-shipped into an order that is still alive (a draft, or any order not cancelled / expired) is not re-shipped again: a double click or a retry after a lost
  // answer would otherwise create a second draft and ship the same parcel twice. The same click again simply returns the draft that already exists.
  const was = (await db.execute(sql`select distinct on (e.shipment_id) e.shipment_id::text as sid, q.id::text as draft_id, q.status as st from shipment_events e join requests q on q.id::text = e.payload->>'draftId'
    where e.request_id = ${requestId} and e.type = 'reshipped' order by e.shipment_id, e.created_at desc`)).rows as Array<{ sid: string; draft_id: string; st: string }>;
  const alive = new Map(was.filter((w) => !["cancelled", "expired"].includes(w.st)).map((w) => [w.sid, w]));
  const fresh = rows.filter((s) => !alive.has(s.id));
  if (!fresh.length) {
    const open = [...alive.values()].find((w) => w.st === "draft");
    if (open) return (await db.select().from(requests).where(eq(requests.id, open.draft_id)))[0];
    throw err("NOTHING_TO_DO", "These parcels were already re-shipped");
  }
  rows.splice(0, rows.length, ...fresh);
  const startsAt = new Date(Math.max(Date.now() + 3 * 3600_000, src.startsAt.getTime() + 864e5));
  const input: RequestInput = {
    service: src.service as RequestInput["service"], title: `Re-ship of ${src.ref}`, quantity: 1, shipmentsPerDriver: src.shipmentsPerDriver ?? 30, vehicleType: src.vehicleType, temperature: src.temperature,
    pickupCity: src.pickupCity, deliveryCity: src.deliveryCity, pickupAddress: src.pickupAddress, pickupLat: src.pickupLat, pickupLng: src.pickupLng,
    startsAt, durationDays: 1, notes: src.notes, allowPartial: src.allowPartial,
    shipments: rows.map((s) => ({ recipientType: s.recipientType as "consumer" | "business", recipientName: s.recipientName, recipientPhone: s.recipientPhone, address: s.address, city: s.city, lat: s.lat, lng: s.lng, contents: s.contents, notes: s.notes, externalRef: s.externalRef, codCents: s.codCents, partnerId: s.partnerId })),
  };
  const draft = await createDraft(business, input, "web", { b2b: "coerce" }); // J3: with B2B off, an old business parcel is re-shipped as a consumer parcel (never refused)
  await recordShipmentEvents(db, batchOf(rows.map((s) => s.id), src.id, "reshipped", { actor: actorOf(business), payload: { draftId: draft.id, draftRef: draft.ref } }));
  await logEvent(db, { requestId: src.id, actor: actorOf(business), type: "shipments_reshipped", payload: { count: rows.length, draftId: draft.id } });
  return draft;
}

const maskPhone = (p: string | null) => (p ? p.slice(0, 4) + "•••" + p.slice(-2) : null);

/**
 * Staff: find a parcel across ALL requests by its code, the warehouse's order reference, the recipient's phone (full number or just the
 * last 4 digits) or name. Paged, with a total. Recipient phones are masked unless the staff member holds `drivers.sensitive`.
 * Exact-match predicates (code, reference, phone) use indexes; the name match is a prefix/contains scan bounded by the page size.
 */
export async function searchShipments(staff: User, f: { q: string; status?: string; page?: number; pageSize?: number }) {
  if (!can(staff, "requests.view")) throw err("FORBIDDEN");
  const q = (f.q ?? "").trim();
  if (q.length < 3) throw err("VALIDATION", "Type at least 3 characters", { field: "q" });
  const page = Math.max(f.page ?? 1, 1), pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const phone = normalizePhone(q);
  const digits = q.replace(/\D/g, "");
  const preds = [
    sql`${shipments.code} = ${normalizeScan(q)}`,
    sql`${shipments.code} like ${likeEscape(normalizeScan(q)) + "%"}`,
    sql`lower(${shipments.externalRef}) = ${q.toLowerCase()}`,
    sql`lower(${shipments.recipientName}) like ${likeEscape(q.toLowerCase()) + "%"}`,
    ilike(shipments.recipientName, contains(q)),
    ...(phone ? [sql`${shipments.recipientPhone} = ${phone}`] : []),
    ...(/^\d{4}$/.test(q) ? [sql`right(${shipments.recipientPhone}, 4) = ${q}`] : []),
    ...(!phone && digits.length >= 5 && digits.length === q.replace(/[\s\-+()]/g, "").length ? [sql`${shipments.recipientPhone} like ${"%" + digits + "%"}`] : []),
  ];
  const where = and(or(...preds), f.status ? eq(shipments.status, f.status) : undefined);
  const base = () => db.select({
    s: shipments, requestRef: requests.ref, businessName: sql<string>`coalesce(${businessProfiles.companyName}, ${users.name})`, driverName: sql<string | null>`(select u2.name from users u2 join offers o2 on o2.driver_id = u2.id where o2.id = ${shipments.offerId})`,
  }).from(shipments).innerJoin(requests, eq(requests.id, shipments.requestId)).innerJoin(users, eq(users.id, requests.businessId)).leftJoin(businessProfiles, eq(businessProfiles.userId, requests.businessId));
  const sensitive = can(staff, "drivers.sensitive");
  const [rows, [{ total }]] = await Promise.all([
    base().where(where).orderBy(desc(shipments.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(shipments).where(where),
  ]);
  return {
    page, pageSize, total: Number(total),
    items: rows.map(({ s, requestRef, businessName, driverName }) => ({
      id: s.id, code: s.code, externalRef: s.externalRef, recipientName: s.recipientName, recipientPhone: sensitive ? s.recipientPhone : maskPhone(s.recipientPhone),
      status: s.status, city: s.city, requestId: s.requestId, requestRef, businessName, offerId: s.offerId, driverName,
      partnerId: s.partnerId, partnerStatus: s.partnerStatus, createdAt: s.createdAt,
    })),
  };
}

export { desc, notifyMany };
