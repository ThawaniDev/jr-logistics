import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Exec } from "@/db";
import {
  offers, requests, driverProfiles, termsConsents, tickets, complaints, jobEvents, ratings, businessProfiles, shipments,
  type Offer, type Request, type User,
} from "@/db/schema";
import { err } from "@/lib/errors";
import { OFFER_BUSY, OFFER_DEAD, SERVICE_MAP, URGENT_TICKET_CATEGORIES, type ServiceKey } from "./catalog";
import { getSettings } from "./settings";
import { logEvent } from "./events";
import { notify, notifyMany, notifyOps } from "./notify";
import { audit } from "./audit";
import { lockRequest, releaseReserve } from "./requests";
import { activeJobs, backfillOffersForDriver, dispatchOffers, driverHasConflict, evaluateCandidates, readyOfficeIds, earningFor } from "./matching";
import { settleOffer, unpaidOfferIds } from "./settlement";
import { assertAtWarehouse, effectiveOps } from "./warehouse";
import { isManifestJob, allocateToOffer, markLoaded, markRouteFinished, releaseOfferShipments, currentStopOf, sendRecipientCodes } from "./shipments";
import { isRoutingOn, autoStartRoute } from "./routing-mode";
import { nextRef } from "./counters";
import { recordAvailability } from "./data-capture";
import { batchOf, recordShipmentEvents } from "./shipment-events";
import { can } from "./auth/permissions";

const actorOf = (u: User) => ({ id: u.id, name: u.name, role: u.role });

/**
 * Lock order is ALWAYS request → offer. Without this, a winner updating sibling offers can deadlock
 * against a loser that already holds its own offer row and waits for the request row.
 */
export async function lockOffer(tx: Exec, id: string): Promise<Offer> {
  const [peek] = await tx.select({ requestId: offers.requestId }).from(offers).where(eq(offers.id, id));
  if (!peek) throw err("NOT_FOUND", "Offer not found");
  await lockRequest(tx, peek.requestId);
  const [o] = await tx.select().from(offers).where(eq(offers.id, id)).for("update");
  if (!o) throw err("NOT_FOUND", "Offer not found");
  return o;
}
export function expect(o: Offer, ...states: string[]) {
  if (!states.includes(o.status)) throw err("INVALID_TRANSITION", `Offer is ${o.status}; expected ${states.join(" or ")}`, { status: o.status });
}
export async function setOffer(tx: Exec, id: string, patch: Partial<typeof offers.$inferInsert>) {
  const [u] = await tx.update(offers).set({ ...patch, updatedAt: new Date() }).where(eq(offers.id, id)).returning();
  return u;
}
export const forDriver = (u: User, o: Offer) => { if (u.id !== o.driverId) throw err("NOT_FOUND", "Offer not found"); };

/** Business-side authority over a job: the owner, or staff with edit rights (audited by caller). */
export async function authorizeBusinessSide(tx: Exec, u: User, o: Offer): Promise<Request> {
  const r = await lockRequest(tx, o.requestId);
  if (u.id !== r.businessId && !can(u, "requests.edit")) throw err("NOT_FOUND", "Offer not found");
  return r;
}

// ───────── Acceptance ─────────
/** Shared by accept & apply. Serialises on the request row so exactly N drivers win N slots. */
async function fillSlot(tx: Exec, driver: User, o: Offer, termsAccepted: boolean) {
  const r = await lockRequest(tx, o.requestId);
  const s = await getSettings(tx);
  if (!termsAccepted) throw err("TERMS_REQUIRED", "You must accept the terms to take this job");
  if (!["published", "filling"].includes(r.status) || r.slotsFilled >= r.quantity) {
    await tx.update(offers).set({ status: "expired", updatedAt: new Date() }).where(and(eq(offers.id, o.id), eq(offers.status, "offered")));
    throw err("SLOT_TAKEN", "This opportunity is no longer available");
  }
  const [p] = await tx.select().from(driverProfiles).where(eq(driverProfiles.userId, driver.id));
  if (!p) throw err("NOT_ELIGIBLE", "Driver profile missing");
  if (s.requireDriverVerification && p.verificationStatus !== "verified") throw err("VERIFICATION_REQUIRED", "Your documents are not verified");
  if (p.suspendedUntil && p.suspendedUntil > new Date()) throw err("NOT_ELIGIBLE", "Your account is temporarily suspended", { until: p.suspendedUntil });
  if (p.officeId && !(await readyOfficeIds(tx, [p.officeId])).has(p.officeId)) throw err("NOT_ELIGIBLE", "Your office is not active");
  if (s.driverSingleActiveJob) {
    const act = (await activeJobs(tx, [driver.id])).get(driver.id);
    if (act && act.offerId !== o.id) throw err("OVERLAPPING_JOB", "Finish your current job before taking another", { activeJob: act });
  }
  if (await driverHasConflict(tx, driver.id, r, s.overlapPolicy)) throw err("OVERLAPPING_JOB", "You already have a job at this time");
  const cands = await evaluateCandidates(tx, r, { driverIds: [driver.id] });
  const c = cands[0];
  const hard = (c?.reasons ?? ["service_mismatch"]).filter((x) => !["already_offered", "unavailable", "time_overlap", "busy"].includes(x));
  if (hard.length) throw err("NOT_ELIGIBLE", "You are not eligible for this job", { reasons: hard });
  await tx.insert(termsConsents).values({ userId: driver.id, role: "driver", termsVersion: s.termsVersion, context: "offer_accept" });
  // Per-parcel jobs: the winner receives their balanced share of the manifest (throws SLOT_TAKEN when nothing is left to carry).
  if (await isManifestJob(tx, r.id)) await allocateToOffer(tx, r, o, r.quantity - r.slotsFilled, actorOf(driver));
  const filled = r.slotsFilled + 1;
  const newStatus = filled >= r.quantity ? "assigned" : "filling";
  await tx.update(requests).set({ slotsFilled: filled, status: newStatus, updatedAt: new Date() }).where(eq(requests.id, r.id));
  if (filled >= r.quantity) {
    const stale = await tx.update(offers).set({ status: "expired", updatedAt: new Date() })
      .where(and(eq(offers.requestId, r.id), eq(offers.status, "offered"), sql`${offers.id} <> ${o.id}`)).returning({ d: offers.driverId });
    void stale;
  }
  const u = await setOffer(tx, o.id, { status: "accepted", acceptedAt: new Date() });
  await logEvent(tx, { requestId: r.id, offerId: o.id, actor: actorOf(driver), type: "driver_accepted", oldStatus: o.status, newStatus: "accepted", payload: { requestStatus: newStatus } });
  await notify(r.businessId, "driver_accepted", { requestId: r.id, ref: r.ref, driver: driver.name }, tx);
  if (o.officeId) await notify(o.officeId, "office_driver_accepted", { ref: r.ref, driver: driver.name }, tx);
  return u;
}

export async function acceptOffer(driver: User, offerId: string, termsAccepted: boolean) {
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    forDriver(driver, o);
    if (o.status === "expired") throw err("SLOT_TAKEN", "This opportunity is no longer available");
    expect(o, "offered");
    return fillSlot(tx, driver, o, termsAccepted);
  });
}

export async function rejectOffer(driver: User, offerId: string) {
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    forDriver(driver, o);
    expect(o, "offered");
    const u = await setOffer(tx, offerId, { status: "rejected" });
    await logEvent(tx, { requestId: o.requestId, offerId, actor: actorOf(driver), type: "offer_rejected", oldStatus: "offered", newStatus: "rejected" });
    return u;
  });
}

/** Driver proactively applies to an open request (still passes every eligibility guard). */
export async function applyToRequest(driver: User, requestId: string, termsAccepted: boolean) {
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, requestId);
    if (SERVICE_MAP[r.service as ServiceKey]?.driverless) throw err("INVALID_TRANSITION", "No drivers for this service");
    const snap = r.pricingSnapshot as { providerCostCents: number; expectedUnits: number } | null;
    if (!snap || !["published", "filling"].includes(r.status)) throw err("SLOT_TAKEN", "This opportunity is no longer available");
    const [p] = await tx.select().from(driverProfiles).where(eq(driverProfiles.userId, driver.id));
    if (r.preferredOfficeId && r.officeWindowEndsAt && r.officeWindowEndsAt > new Date() && p?.officeId !== r.preferredOfficeId) {
      throw err("NOT_ELIGIBLE", "This request is reserved for a preferred office for now");
    }
    const [existing] = await tx.select().from(offers).where(and(eq(offers.requestId, requestId), eq(offers.driverId, driver.id))).for("update");
    if (existing) {
      if (existing.status === "offered") return fillSlot(tx, driver, existing, termsAccepted);
      throw err("CONFLICT", "You already responded to this request");
    }
    const [o] = await tx.insert(offers).values({
      requestId, driverId: driver.id, officeId: p?.officeId ?? null, status: "offered", source: "apply",
      expectedUnits: snap.expectedUnits, expectedEarningCents: earningFor(snap.providerCostCents, snap.expectedUnits),
    }).returning();
    return fillSlot(tx, driver, o, termsAccepted);
  });
}

// ───────── Arrival & attendance ─────────
export async function checkIn(driver: User, offerId: string, loc?: { lat?: number; lng?: number }) {
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    forDriver(driver, o);
    expect(o, "accepted");
    const r = await lockRequest(tx, o.requestId);
    const s = await getSettings(tx);
    if (r.startsAt.getTime() - Date.now() > s.checkinEarlyMin * 60_000) throw err("INVALID_TRANSITION", "Too early to check in", { opensAt: new Date(r.startsAt.getTime() - s.checkinEarlyMin * 60_000) });
    // E1: the driver must really be at the warehouse (GPS within the platform radius of its pin).
    const where = await assertAtWarehouse(tx, r, loc);
    const now = new Date();
    const ops = await effectiveOps(r.businessId, tx, s);
    const auto = !ops.requireArrivalConfirmation; // E2: this warehouse does not confirm arrivals — a verified check-in is the attendance
    let u = await setOffer(tx, offerId, { status: "arrived", arrivedAt: now, arrivedLat: loc?.lat ?? null, arrivedLng: loc?.lng ?? null });
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(driver), type: "driver_arrived", oldStatus: "accepted", newStatus: "arrived", payload: { ...(loc ?? {}), distanceM: where.distanceM } });
    if ("unknownPin" in where && where.unknownPin) await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(driver), type: "arrival_unverified", payload: { ...(loc ?? {}) } });
    await notify(r.businessId, "driver_arrived", { requestId: r.id, ref: r.ref, driver: driver.name }, tx);
    if (auto) u = await markAttendance(tx, r, u, null, { auto: true });
    return u;
  });
}

/** Attendance confirmed (by the warehouse, or by the system when the warehouse does not require it). */
async function markAttendance(tx: Exec, r: Request, o: Offer, by: User | null, opts: { auto?: boolean } = {}) {
  const u = await setOffer(tx, o.id, { status: "attendance_confirmed", attendanceAt: new Date(), attendanceBy: by?.id ?? null });
  // Only a fully staffed request moves to in_progress: while slots are still open (`filling`) other drivers must remain able to accept.
  if (r.status === "assigned" || r.status === "confirmed") await tx.update(requests).set({ status: "in_progress", updatedAt: new Date() }).where(eq(requests.id, r.id));
  await logEvent(tx, { requestId: r.id, offerId: o.id, actor: by ? actorOf(by) : null, type: "attendance_confirmed", oldStatus: o.status, newStatus: "attendance_confirmed", payload: opts.auto ? { auto: true } : undefined });
  if (by) await notify(o.driverId, "attendance_confirmed", { offerId: o.id, ref: r.ref }, tx);
  return u;
}

export async function confirmAttendance(actor: User, offerId: string, present: boolean, reason?: string) {
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    const r = await authorizeBusinessSide(tx, actor, o);
    expect(o, "accepted", "arrived");
    if (present) return markAttendance(tx, r, o, actor);
    if (!reason?.trim()) throw err("VALIDATION", "A reason is required to record a no-show", { field: "reason" });
    // Nobody can fail to show up before the job has started.
    if (r.startsAt.getTime() > Date.now()) throw err("INVALID_TRANSITION", "The job has not started yet — a no-show can only be recorded from the start time", { startsAt: r.startsAt });
    const u = await setOffer(tx, offerId, { status: "no_show", cancelReason: reason, cancelledAt: new Date() });
    await releaseOfferShipments(tx, o, "driver_no_show", { loadedToPool: true });
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(actor), type: "driver_no_show", oldStatus: o.status, newStatus: "no_show", payload: { reason } });
    await notify(o.driverId, "no_show_recorded", { offerId: o.id, ref: r.ref }, tx);
    await freeSlotAndReplace(tx, r, o, "no_show");
    return u;
  });
}

/** Free a slot after cancel/no-show/replacement and look for a replacement. */
async function freeSlotAndReplace(tx: Exec, r: Request, o: Offer, why: string, onlyOfficeId?: string) {
  const [u] = await tx.update(requests).set({ slotsFilled: sql`greatest(${requests.slotsFilled} - 1, 0)`, status: sql`case when ${requests.status} in ('in_progress','assigned','confirmed') then 'filling' else ${requests.status} end`, updatedAt: new Date() }).where(eq(requests.id, r.id)).returning();
  let n = await dispatchOffers(tx, u, { replacement: true, replacesOfferId: o.id, onlyOfficeId });
  if (n === 0 && onlyOfficeId) n = await dispatchOffers(tx, u, { replacement: true, replacesOfferId: o.id }); // office has nobody → open to all
  await logEvent(tx, { requestId: r.id, offerId: o.id, type: "replacement_requested", payload: { why, offers: n } });
  if (n === 0) {
    await notifyOps("replacements.manage", "no_replacement_available", { ref: r.ref }, tx);
  }
}

// ───────── Loading, delivery, quantity ─────────
export async function recordLoading(actor: User, offerId: string, units?: number, sel: { codes?: string[]; all?: boolean } = {}) {
  const res = await recordLoadingTx(actor, offerId, units, sel);
  // Parcels are on the vehicle: plan the best route now so it is ready when the driver opens the job (best effort — never fails the hand-over).
  if (res.manifest) await (await import("./route-plan")).autoPlanRoute(offerId);
  return res.offer;
}

async function recordLoadingTx(actor: User, offerId: string, units?: number, sel: { codes?: string[]; all?: boolean } = {}): Promise<{ offer: Offer; manifest: boolean }> {
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    const r = await authorizeBusinessSide(tx, actor, o);
    expect(o, "attendance_confirmed");
    if (!SERVICE_MAP[r.service as ServiceKey].hasShipments) throw err("INVALID_TRANSITION", "Loading applies to delivery jobs only");
    if (await isManifestJob(tx, r.id)) {
      // Parcel by parcel: the warehouse scans / ticks exactly what goes onto the vehicle. Anything not handed over returns to the pool.
      if (o.routeApprovedAt) throw err("INVALID_TRANSITION", "The driver has already started the route");
      const res = await markLoaded(tx, r, o, sel, actorOf(actor));
      const m = await setOffer(tx, offerId, { loadedUnits: res.loaded, loadedAt: new Date(), loadedAckByDriver: null });
      await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(actor), type: "loading_recorded", payload: { units: res.loaded, released: res.released, manifest: true } });
      await notify(o.driverId, "loading_recorded", { offerId: o.id, ref: r.ref, units: res.loaded }, tx);
      return { offer: m, manifest: true };
    }
    if (!Number.isInteger(units) || (units as number) < 0) throw err("VALIDATION", "Invalid quantity", { field: "units" });
    const u = await setOffer(tx, offerId, { loadedUnits: units as number, loadedAt: new Date(), loadedAckByDriver: null });
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(actor), type: "loading_recorded", payload: { units } });
    await notify(o.driverId, "loading_recorded", { offerId: o.id, ref: r.ref, units }, tx);
    return { offer: u, manifest: false };
  });
}

export async function acknowledgeLoading(driver: User, offerId: string, ok: boolean, note?: string) {
  let first: string | null = null;
  const out = await db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    forDriver(driver, o);
    expect(o, "attendance_confirmed");
    if (o.loadedUnits == null) throw err("INVALID_TRANSITION", "No loaded quantity to confirm yet");
    const r = await lockRequest(tx, o.requestId);
    let u = await setOffer(tx, offerId, { loadedAckByDriver: ok });
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(driver), type: ok ? "loading_confirmed" : "loading_disputed", payload: { units: o.loadedUnits, note } });
    if (!ok) {
      await openTicket(tx, driver, { category: "shipment_count_differs", subject: `Loaded quantity disputed (${r.ref})`, requestId: r.id, offerId, body: note });
      await notify(r.businessId, "loading_disputed", { requestId: r.id, ref: r.ref }, tx);
    } else if (!(await isRoutingOn(tx)) && (await isManifestJob(tx, r.id))) {
      // J2: routing is off — there is no "approve route" step, so confirming the load starts the route (the first recipient is texted, like the approval would).
      u = await autoStartRoute(tx, u, actorOf(driver));
      first = (await currentStopOf(tx, offerId))?.id ?? null;
    }
    return u;
  });
  if (first) await sendRecipientCodes([first]);
  return out;
}

/**
 * Upper bound for what can be reported: never more than was loaded and never more than was booked. The escrow only covers the
 * booked quantity, so billing above it could strand a payout; extra work needs a new request.
 */
export function maxBillableUnits(o: Offer) {
  return Math.min(o.loadedUnits ?? o.expectedUnits, o.expectedUnits);
}

export async function reportDelivered(driver: User, offerId: string, unitsIn?: number) {
  const done = await reportDeliveredTx(driver, offerId, unitsIn);
  // The driver is free again: offers that were held back (or published while he was busy) reach him now.
  await backfillOffersForDriver(driver.id).catch(() => {});
  return done;
}

async function reportDeliveredTx(driver: User, offerId: string, unitsIn?: number) {
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    forDriver(driver, o);
    expect(o, "attendance_confirmed");
    const r = await lockRequest(tx, o.requestId);
    if (await isManifestJob(tx, r.id)) {
      // The count is not typed in: it IS the number of parcels delivered with a valid proof. Every stop must be resolved first.
      if (!o.routeApprovedAt && ((await isRoutingOn(tx)) || o.loadedAckByDriver !== true)) throw err("INVALID_TRANSITION", "Approve the route and work through the stops first"); // routing off: no approval — only loading must be confirmed
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(shipments).where(and(eq(shipments.offerId, offerId), eq(shipments.status, "loaded")));
      if (n > 0) throw err("STOPS_PENDING", `${n} stop(s) are still open`, { remaining: n });
      const { delivered } = await markRouteFinished(tx, o, "delivery_reported", actorOf(driver));
      await notify(r.businessId, "delivery_reported", { requestId: r.id, ref: r.ref, units: delivered }, tx);
      return autoConfirmDelivery(tx, offerId); // E16/E18: no warehouse confirmation — confirmed and paid now
    }
    if (!Number.isInteger(unitsIn) || (unitsIn as number) < 0) throw err("VALIDATION", "Invalid quantity", { field: "units" });
    const units = unitsIn as number;
    const hasShipments = SERVICE_MAP[r.service as ServiceKey].hasShipments;
    if (hasShipments && o.loadedUnits != null && o.loadedAckByDriver !== true) throw err("INVALID_TRANSITION", "Confirm the loaded quantity first");
    const ceiling = maxBillableUnits(o);
    if (units > ceiling) throw err("VALIDATION", hasShipments && o.loadedUnits != null ? "Delivered cannot exceed loaded quantity" : "Quantity is higher than this job allows", { max: ceiling });
    await setOffer(tx, offerId, { status: "delivered_reported", deliveredUnits: units, deliveredAt: new Date() });
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(driver), type: "delivery_reported", oldStatus: "attendance_confirmed", newStatus: "delivered_reported", payload: { units } });
    await notify(r.businessId, "delivery_reported", { requestId: r.id, ref: r.ref, units }, tx);
    return autoConfirmDelivery(tx, offerId);
  });
}

/**
 * E16/E18 — the driver's work is over (route finished, or ended early): the delivery is confirmed BY THE SYSTEM from the delivered parcels
 * (nothing for the warehouse to confirm or dispute) and the settlement is paid straight away. Undelivered parcels are received back by the
 * warehouse separately (`confirm_returns`) and never block the money. Safe to call for an offer already completed (returns it).
 */
export async function autoConfirmDelivery(tx: Exec, offerId: string, actor: User | null = null) {
  const o = await lockOffer(tx, offerId);
  if (o.status === "completed") return o;
  expect(o, "delivered_reported", "pending_settlement");
  const r = await lockRequest(tx, o.requestId);
  let ready = o;
  if (o.status === "delivered_reported") {
    const units = Math.min(o.deliveredUnits ?? 0, o.expectedUnits); // the escrow only covers the booked quantity
    ready = await setOffer(tx, offerId, { status: "pending_settlement", finalUnits: units, finalAt: new Date() });
    await logEvent(tx, { requestId: r.id, offerId, actor: actor ? actorOf(actor) : null, type: "delivery_confirmed", oldStatus: o.status, newStatus: "pending_settlement", payload: { units, auto: true } });
  }
  const done = await finishOffer(tx, r, ready);
  await completeIfReady(tx, r.id, actor);
  return done;
}

/** One driver's settlement: created, paid (unless a complaint holds it) and the offer closed. */
async function finishOffer(tx: Exec, r: Request, o: Offer) {
  await settleOffer(tx, r, o);
  const done = await setOffer(tx, o.id, { status: "completed" });
  await notify(o.driverId, "job_completed", { offerId: o.id, ref: r.ref }, tx);
  return done;
}

/** Driver reports they were not put to work (business never responded / no work on site). One open report per job. */
export async function reportNoWork(driver: User, offerId: string, note?: string) {
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    forDriver(driver, o);
    expect(o, "arrived", "attendance_confirmed");
    const r = await lockRequest(tx, o.requestId);
    const [dup] = await tx.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.offerId, offerId), eq(tickets.category, "not_put_to_work")));
    if (dup) throw err("CONFLICT", "You already reported this job");
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(driver), type: "no_work_reported", payload: { note } });
    return openTicket(tx, driver, { category: "not_put_to_work", subject: `${r.ref}: not put to work`, requestId: r.id, offerId, body: note });
  });
}

/** Driver could not reach the recipient. Only while the job is active; one report per reason keeps ops free of duplicates. */
export async function reportContactException(driver: User, offerId: string, reason: string, note?: string) {
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    forDriver(driver, o);
    expect(o, "accepted", "arrived", "attendance_confirmed");
    const r = await lockRequest(tx, o.requestId);
    const [dup] = await tx.select({ id: jobEvents.id }).from(jobEvents).where(and(eq(jobEvents.offerId, offerId), eq(jobEvents.type, "contact_exception"), sql`${jobEvents.payload}->>'reason' = ${reason}`));
    if (dup) throw err("CONFLICT", "You already reported this problem");
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(driver), type: "contact_exception", payload: { reason, note } });
    return openTicket(tx, driver, { category: "attendance_issue", subject: `${r.ref}: contact problem (${reason})`, requestId: r.id, offerId, body: note });
  });
}

/** Operations resolution of a quantity dispute. */
export async function resolveDispute(staff: User, offerId: string, finalUnits: number, resolution: string) {
  if (!can(staff, "requests.edit")) throw err("FORBIDDEN");
  if (!resolution?.trim()) throw err("VALIDATION", "Resolution required", { field: "resolution" });
  if (!Number.isInteger(finalUnits) || finalUnits < 0) throw err("VALIDATION", "Invalid quantity", { field: "finalUnits" });
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    expect(o, "qty_disputed");
    const r = await lockRequest(tx, o.requestId);
    const cap = o.expectedUnits; // what the escrow covers
    if (finalUnits > cap) throw err("VALIDATION", "Quantity is higher than this job allows", { field: "finalUnits", max: cap });
    const u = await setOffer(tx, offerId, { status: "pending_settlement", finalUnits, finalAt: new Date() });
    // Parcels still unaccounted for after the platform's decision are recorded as missing (visible to both sides, never silently dropped).
    const missing = await tx.update(shipments).set({ status: "missing", updatedAt: new Date() }).where(and(eq(shipments.offerId, offerId), eq(shipments.status, "failed"))).returning({ id: shipments.id });
    await recordShipmentEvents(tx, batchOf(missing.map((m) => m.id), r.id, "missing", { offerId, actor: actorOf(staff), payload: { resolution } }));
    await tx.update(complaints).set({ status: "resolved", resolution, resolvedAt: new Date(), handlerId: staff.id, holdsSettlement: false, updatedAt: new Date() })
      .where(and(eq(complaints.offerId, offerId), eq(complaints.holdsSettlement, true), inArray(complaints.status, ["open", "in_progress"])));
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(staff), type: "dispute_resolved", oldStatus: "qty_disputed", newStatus: "pending_settlement", payload: { finalUnits, resolution } });
    await audit(staff, "dispute.resolve", "offer", offerId, { finalUnits, resolution }, tx);
    await notifyMany([r.businessId, o.driverId], "dispute_resolved", { ref: r.ref }, tx);
    await completeIfReady(tx, r.id, staff);
    return u;
  });
}

/**
 * Auto-complete: when every filled slot is pending settlement and all slots are filled,
 * create exactly one settlement per offer and close the request.
 */
async function completeIfReady(tx: Exec, requestId: string, actor: User | null) {
  const r = await lockRequest(tx, requestId);
  if (["completed", "cancelled", "expired"].includes(r.status)) return false;
  const all = await tx.select().from(offers).where(eq(offers.requestId, requestId));
  const live = all.filter((o) => !(OFFER_DEAD as string[]).includes(o.status) && o.status !== "offered");
  if (live.length === 0 || r.slotsFilled < r.quantity) return false;
  if (!live.every((o) => o.status === "pending_settlement" || o.status === "completed")) return false;
  await finalizeRequest(tx, r, live, actor);
  return true;
}

async function finalizeRequest(tx: Exec, r0: Request, live: Offer[], actor: User | null) {
  let r = r0;
  const ready = live.filter((o) => o.status === "pending_settlement");
  for (const o of ready) await finishOffer(tx, r, o);
  if (ready.length) r = (await tx.select().from(requests).where(eq(requests.id, r.id)))[0]; // payments above released their shares: work from the current reserve
  // Parcels nobody carried are withdrawn (their share of the escrow goes back below) and can be re-shipped in one click.
  const unfulfilled = await tx.update(shipments).set({ status: "cancelled", failReason: "unfulfilled", updatedAt: new Date() }).where(and(eq(shipments.requestId, r.id), eq(shipments.status, "pending"), sql`${shipments.offerId} is null`)).returning({ id: shipments.id });
  await recordShipmentEvents(tx, batchOf(unfulfilled.map((m) => m.id), r.id, "cancelled", { payload: { reason: "unfulfilled" } }));
  const unitPrice = r.unitPriceCents ?? 0;
  const unpaid = await unpaidOfferIds(tx, live.map((o) => o.id)); // only shares whose settlement is not paid yet (held by a complaint) stay escrowed
  const held = live.filter((o) => unpaid.has(o.id)).reduce((a, o) => a + unitPrice * o.expectedUnits, 0);
  await releaseReserve(tx, r, Math.max(0, r.reservedCents - held), `complete-release:${r.id}`, actor?.id);
  await tx.update(offers).set({ status: "expired", updatedAt: new Date() }).where(and(eq(offers.requestId, r.id), eq(offers.status, "offered")));
  await tx.update(requests).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(eq(requests.id, r.id));
  await logEvent(tx, { requestId: r.id, actor: actor ? actorOf(actor) : null, type: "request_completed", oldStatus: r.status, newStatus: "completed" });
  await notify(r.businessId, "request_completed", { requestId: r.id, ref: r.ref }, tx);
}

/** Business closes a partially-filled request once all assigned work is confirmed. */
export async function completeRequest(actor: User, requestId: string) {
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, requestId);
    if (actor.id !== r.businessId && !can(actor, "requests.edit")) throw err("NOT_FOUND", "Request not found");
    if (["completed", "cancelled", "expired", "draft"].includes(r.status)) throw err("INVALID_TRANSITION", `Request is ${r.status}`);
    const all = await tx.select().from(offers).where(eq(offers.requestId, requestId));
    const live = all.filter((o) => !(OFFER_DEAD as string[]).includes(o.status) && o.status !== "offered");
    if (live.some((o) => o.status === "qty_disputed")) throw err("DISPUTE_BLOCKS", "A quantity dispute is unresolved");
    if (live.length === 0 || !live.every((o) => o.status === "pending_settlement" || o.status === "completed")) throw err("INVALID_TRANSITION", "Some drivers have not finished or been confirmed");
    await finalizeRequest(tx, r, live, actor);
    return (await tx.select().from(requests).where(eq(requests.id, requestId)))[0];
  });
}

/** Driverless rental: staff mark fulfilment; the reserved amount becomes platform revenue. */
export async function fulfilRental(staff: User, requestId: string) {
  if (!can(staff, "requests.edit")) throw err("FORBIDDEN");
  const { ensureAccount, platformAccount, post } = await import("./wallet");
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, requestId);
    if (!SERVICE_MAP[r.service as ServiceKey]?.driverless) throw err("INVALID_TRANSITION", "Not a rental request");
    if (r.status !== "confirmed") throw err("INVALID_TRANSITION", `Request is ${r.status}`);
    const biz = await ensureAccount(r.businessId, tx); const plat = await platformAccount(tx);
    const total = r.reservedCents;
    await post(tx, { accountId: biz.id, kind: "charge", reserved: -total, idempotencyKey: `rental:${r.id}:charge`, requestId: r.id, actorId: staff.id });
    await post(tx, { accountId: plat.id, kind: "platform_fee", available: total, idempotencyKey: `rental:${r.id}:fee`, requestId: r.id, actorId: staff.id });
    const [u] = await tx.update(requests).set({ status: "completed", completedAt: new Date(), reservedCents: 0, updatedAt: new Date() }).where(eq(requests.id, r.id)).returning();
    await logEvent(tx, { requestId: r.id, actor: actorOf(staff), type: "request_completed", oldStatus: "confirmed", newStatus: "completed" });
    await audit(staff, "rental.fulfil", "request", r.id, { total }, tx);
    return u;
  });
}

// ───────── Cancellation & replacement ─────────
export async function driverCancel(driver: User, offerId: string, reason: string) {
  if (!reason?.trim()) throw err("VALIDATION", "Reason is required", { field: "reason" });
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    forDriver(driver, o);
    expect(o, "accepted", "arrived");
    const r = await lockRequest(tx, o.requestId);
    const s = await getSettings(tx);
    const u = await setOffer(tx, offerId, { status: "cancelled", cancelReason: reason, cancelledAt: new Date() });
    await releaseOfferShipments(tx, o, "driver_cancelled", { loadedToPool: true });
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(driver), type: "driver_cancelled", oldStatus: o.status, newStatus: "cancelled", payload: { reason } });
    await notify(r.businessId, "driver_cancelled", { requestId: r.id, ref: r.ref }, tx);
    if (o.officeId) await notify(o.officeId, "office_driver_cancelled", { ref: r.ref, driver: driver.name }, tx);
    let strike: "none" | "warning" | "suspended" = "none";
    if (s.cancelPolicyEnabled) {
      const [prof] = await tx.select({ reset: driverProfiles.strikesResetAt }).from(driverProfiles).where(eq(driverProfiles.userId, driver.id));
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(jobEvents).where(and(eq(jobEvents.type, "driver_cancelled"), eq(jobEvents.actorId, driver.id), sql`${jobEvents.createdAt} > now() - make_interval(days => ${s.cancelWindowDays})`,
        prof?.reset ? sql`${jobEvents.createdAt} > ${prof.reset}` : undefined));
      if (n >= s.cancelSuspendAt) {
        const [was] = await tx.select({ a: driverProfiles.availability }).from(driverProfiles).where(eq(driverProfiles.userId, driver.id));
        await tx.update(driverProfiles).set({ suspendedUntil: new Date(Date.now() + s.cancelSuspendDays * 864e5), availability: "unavailable" }).where(eq(driverProfiles.userId, driver.id));
        await recordAvailability(driver.id, was?.a ?? null, "unavailable", "system", "cancel_strikes", null, tx);
        strike = "suspended"; await notify(driver.id, "cancel_suspended", { days: s.cancelSuspendDays }, tx);
        await audit(null, "driver.auto_suspend", "user", driver.id, { cancellations: n }, tx);
      } else if (n >= s.cancelWarnAt) { strike = "warning"; await notify(driver.id, "cancel_warning", { count: n }, tx); }
    }
    await freeSlotAndReplace(tx, r, o, "driver_cancelled");
    return { offer: u, strike };
  });
}

/** A driver who already delivered or failed a stop cannot simply be swapped out (their finished stops must stay paid): the route is ended instead. */
async function guardReplaceManifest(tx: Exec, o: Offer) {
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(shipments).where(and(eq(shipments.offerId, o.id), inArray(shipments.status, ["delivered", "failed", "returned", "missing"])));
  if (n > 0) throw err("INVALID_TRANSITION", "This driver already worked some stops — end the route instead so completed stops stay paid", { resolvedStops: n });
}

/** Operations: replace a driver (record reason) and look for a substitute. */
export async function staffReplace(staff: User, offerId: string, reason: string) {
  if (!can(staff, "replacements.manage")) throw err("FORBIDDEN");
  if (!reason?.trim()) throw err("VALIDATION", "Reason required", { field: "reason" });
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    expect(o, "accepted", "arrived", "attendance_confirmed");
    const r = await lockRequest(tx, o.requestId);
    await guardReplaceManifest(tx, o);
    const u = await setOffer(tx, offerId, { status: "replaced", cancelReason: reason, cancelledAt: new Date() });
    await releaseOfferShipments(tx, o, "driver_replaced", { loadedToPool: true });
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(staff), type: "driver_replaced", oldStatus: o.status, newStatus: "replaced", payload: { reason } });
    await audit(staff, "offer.replace", "offer", offerId, { reason }, tx);
    await notify(o.driverId, "replaced_by_ops", { offerId: o.id, ref: r.ref }, tx);
    await freeSlotAndReplace(tx, r, o, "ops_replace");
    return u;
  });
}

/** An office replaces one of ITS OWN drivers on a job that has not started; the replacement is offered to the office's drivers first. */
export async function officeReplace(office: User, offerId: string, reason: string) {
  if (!reason?.trim()) throw err("VALIDATION", "Reason required", { field: "reason" });
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    if (o.officeId !== office.id) throw err("NOT_FOUND");
    const r0 = await lockRequest(tx, o.requestId);
    if (o.status === "offered") {
      // The driver has not accepted yet: withdrawing the offer frees nothing (no slot was taken) and needs no substitute.
      const w = await setOffer(tx, offerId, { status: "expired", cancelReason: reason, cancelledAt: new Date() });
      await logEvent(tx, { requestId: r0.id, offerId, actor: actorOf(office), type: "offer_withdrawn", oldStatus: "offered", newStatus: "expired", payload: { reason, by: "office" } });
      return w;
    }
    expect(o, "accepted", "arrived");
    const r = r0;
    await guardReplaceManifest(tx, o);
    const u = await setOffer(tx, offerId, { status: "replaced", cancelReason: reason, cancelledAt: new Date() });
    await releaseOfferShipments(tx, o, "driver_replaced", { loadedToPool: true });
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(office), type: "driver_replaced", oldStatus: o.status, newStatus: "replaced", payload: { reason, by: "office" } });
    await audit(office, "offer.replace", "offer", offerId, { reason }, tx);
    await notify(o.driverId, "replaced_by_office", { offerId: o.id, ref: r.ref }, tx);
    await freeSlotAndReplace(tx, r, o, "office_replace", office.id);
    return u;
  });
}

/** Operations/office: offer a request to a specific eligible driver (driver still must accept). */
export async function assignDriver(actor: User, requestId: string, driverId: string, source: "manual" | "office", reason?: string) {
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, requestId);
    if (!["published", "filling"].includes(r.status)) throw err("INVALID_TRANSITION", `Request is ${r.status}`);
    const snap = r.pricingSnapshot as { providerCostCents: number; expectedUnits: number } | null;
    if (!snap) throw err("INVALID_TRANSITION");
    // A request reserved for one office cannot be taken over by another office through a direct API call.
    if (source === "office" && r.preferredOfficeId && r.preferredOfficeId !== actor.id) throw err("FORBIDDEN", "This request is reserved for another office");
    const [c] = await evaluateCandidates(tx, r, { driverIds: [driverId], onlyOfficeId: source === "office" ? actor.id : undefined });
    if (!c) throw err("NOT_ELIGIBLE", "Driver not found or not allowed");
    if (c.reasons.length) throw err("NOT_ELIGIBLE", "Driver is not eligible", { reasons: c.reasons });
    const [o] = await tx.insert(offers).values({
      requestId, driverId, officeId: c.officeId, status: "offered", source, expectedUnits: snap.expectedUnits,
      expectedEarningCents: earningFor(snap.providerCostCents, snap.expectedUnits),
    }).returning();
    await logEvent(tx, { requestId, offerId: o.id, actor: actorOf(actor), type: "driver_assigned", newStatus: "offered", payload: { source, reason } });
    if (source === "manual") await audit(actor, "request.manual_assign", "request", requestId, { driverId, reason }, tx);
    await notify(driverId, "offer_new", { requestId, ref: r.ref }, tx);
    return o;
  });
}

// ───────── Support objects raised from jobs ─────────
export async function openTicket(tx: Exec, user: User, i: { category: string; subject: string; requestId?: string | null; offerId?: string | null; body?: string | null; priority?: string }) {
  const { ticketReplies } = await import("@/db/schema");
  const urgent = URGENT_TICKET_CATEGORIES.includes(i.category);
  const [t] = await tx.insert(tickets).values({
    ref: await nextRef(tx, "TK"), openedBy: user.id, requestId: i.requestId ?? null, offerId: i.offerId ?? null,
    category: i.category, subject: i.subject, priority: i.priority ?? (urgent ? "urgent" : "normal"),
  }).returning();
  if (i.body?.trim()) await tx.insert(ticketReplies).values({ ticketId: t.id, authorId: user.id, authorRole: user.role, body: i.body });
  if (t.priority === "urgent") {
    await notifyOps("tickets.manage", "ticket_urgent", { ref: t.ref }, tx);
  }
  return t;
}

export async function openComplaint(tx: Exec, user: User, i: { category: string; description: string; requestId?: string | null; offerId?: string | null; priority?: string; holdsSettlement?: boolean }) {
  const [c] = await tx.insert(complaints).values({
    ref: await nextRef(tx, "CP"), filedBy: user.id, filedByRole: user.role, requestId: i.requestId ?? null, offerId: i.offerId ?? null,
    category: i.category, description: i.description, priority: i.priority ?? "normal", holdsSettlement: i.holdsSettlement ?? false,
  }).returning();
  return c;
}

// ───────── Ratings ─────────
export async function rate(user: User, offerId: string, stars: number, comment?: string) {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw err("VALIDATION", "Stars must be 1–5", { field: "stars" });
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    const r = await lockRequest(tx, o.requestId);
    if (o.status !== "completed") throw err("INVALID_TRANSITION", "Only completed jobs can be rated");
    let rateeId: string;
    if (user.id === r.businessId) rateeId = o.driverId;
    else if (user.id === o.driverId) rateeId = r.businessId;
    else throw err("NOT_FOUND");
    const ins = await tx.insert(ratings).values({ offerId, raterId: user.id, rateeId, stars, comment: comment ?? null }).onConflictDoNothing().returning();
    if (!ins.length) throw err("CONFLICT", "You already rated this job");
    if (rateeId === o.driverId) await tx.update(driverProfiles).set({ ratingSum: sql`${driverProfiles.ratingSum} + ${stars}`, ratingCount: sql`${driverProfiles.ratingCount} + 1` }).where(eq(driverProfiles.userId, rateeId));
    else await tx.update(businessProfiles).set({ ratingSum: sql`${businessProfiles.ratingSum} + ${stars}`, ratingCount: sql`${businessProfiles.ratingCount} + 1` }).where(eq(businessProfiles.userId, rateeId));
    return ins[0];
  });
}

export const BUSY = OFFER_BUSY;
