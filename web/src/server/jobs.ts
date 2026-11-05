import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Exec } from "@/db";
import {
  offers, requests, driverProfiles, users, termsConsents, tickets, complaints, jobEvents, ratings, businessProfiles,
  type Offer, type Request, type User,
} from "@/db/schema";
import { err } from "@/lib/errors";
import { OFFER_BUSY, OFFER_DEAD, SERVICE_MAP, URGENT_TICKET_CATEGORIES, type ServiceKey } from "./catalog";
import { getSettings } from "./settings";
import { logEvent } from "./events";
import { notify, notifyMany } from "./notify";
import { audit } from "./audit";
import { lockRequest, releaseReserve } from "./requests";
import { dispatchOffers, driverHasConflict, evaluateCandidates, readyOfficeIds, earningFor } from "./matching";
import { createSettlement } from "./settlement";
import { nextRef } from "./counters";
import { can } from "./auth/permissions";

const actorOf = (u: User) => ({ id: u.id, name: u.name, role: u.role });

/**
 * Lock order is ALWAYS request → offer. Without this, a winner updating sibling offers can deadlock
 * against a loser that already holds its own offer row and waits for the request row.
 */
async function lockOffer(tx: Exec, id: string): Promise<Offer> {
  const [peek] = await tx.select({ requestId: offers.requestId }).from(offers).where(eq(offers.id, id));
  if (!peek) throw err("NOT_FOUND", "Offer not found");
  await lockRequest(tx, peek.requestId);
  const [o] = await tx.select().from(offers).where(eq(offers.id, id)).for("update");
  if (!o) throw err("NOT_FOUND", "Offer not found");
  return o;
}
function expect(o: Offer, ...states: string[]) {
  if (!states.includes(o.status)) throw err("INVALID_TRANSITION", `Offer is ${o.status}; expected ${states.join(" or ")}`, { status: o.status });
}
async function setOffer(tx: Exec, id: string, patch: Partial<typeof offers.$inferInsert>) {
  const [u] = await tx.update(offers).set({ ...patch, updatedAt: new Date() }).where(eq(offers.id, id)).returning();
  return u;
}
const forDriver = (u: User, o: Offer) => { if (u.id !== o.driverId) throw err("NOT_FOUND", "Offer not found"); };

/** Business-side authority over a job: the owner, or staff with edit rights (audited by caller). */
async function authorizeBusinessSide(tx: Exec, u: User, o: Offer): Promise<Request> {
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
  if (await driverHasConflict(tx, driver.id, r, s.overlapPolicy)) throw err("OVERLAPPING_JOB", "You already have a job at this time");
  const cands = await evaluateCandidates(tx, r, { driverIds: [driver.id] });
  const c = cands[0];
  const hard = (c?.reasons ?? ["service_mismatch"]).filter((x) => !["already_offered", "unavailable", "time_overlap"].includes(x));
  if (hard.length) throw err("NOT_ELIGIBLE", "You are not eligible for this job", { reasons: hard });
  await tx.insert(termsConsents).values({ userId: driver.id, role: "driver", termsVersion: s.termsVersion, context: "offer_accept" });
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
  await notify(r.businessId, "driver_accepted", { ref: r.ref, driver: driver.name }, tx);
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
    const u = await setOffer(tx, offerId, { status: "arrived", arrivedAt: new Date(), arrivedLat: loc?.lat ?? null, arrivedLng: loc?.lng ?? null });
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(driver), type: "driver_arrived", oldStatus: "accepted", newStatus: "arrived", payload: loc ?? {} });
    await notify(r.businessId, "driver_arrived", { ref: r.ref, driver: driver.name }, tx);
    return u;
  });
}

export async function confirmAttendance(actor: User, offerId: string, present: boolean, reason?: string) {
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    const r = await authorizeBusinessSide(tx, actor, o);
    expect(o, "accepted", "arrived");
    if (present) {
      const u = await setOffer(tx, offerId, { status: "attendance_confirmed", attendanceAt: new Date(), attendanceBy: actor.id });
      if (r.status === "assigned" || r.status === "filling" || r.status === "confirmed") await tx.update(requests).set({ status: "in_progress", updatedAt: new Date() }).where(eq(requests.id, r.id));
      await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(actor), type: "attendance_confirmed", oldStatus: o.status, newStatus: "attendance_confirmed" });
      await notify(o.driverId, "attendance_confirmed", { ref: r.ref }, tx);
      return u;
    }
    if (!reason?.trim()) throw err("VALIDATION", "A reason is required to record a no-show", { field: "reason" });
    const u = await setOffer(tx, offerId, { status: "no_show", cancelReason: reason, cancelledAt: new Date() });
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(actor), type: "driver_no_show", oldStatus: o.status, newStatus: "no_show", payload: { reason } });
    await notify(o.driverId, "no_show_recorded", { ref: r.ref }, tx);
    await freeSlotAndReplace(tx, r, o, "no_show");
    return u;
  });
}

/** Free a slot after cancel/no-show/replacement and look for a replacement. */
async function freeSlotAndReplace(tx: Exec, r: Request, o: Offer, why: string) {
  const [u] = await tx.update(requests).set({ slotsFilled: sql`greatest(${requests.slotsFilled} - 1, 0)`, status: sql`case when ${requests.status} in ('in_progress','assigned','confirmed') then 'filling' else ${requests.status} end`, updatedAt: new Date() }).where(eq(requests.id, r.id)).returning();
  const n = await dispatchOffers(tx, u, { replacement: true, replacesOfferId: o.id });
  await logEvent(tx, { requestId: r.id, offerId: o.id, type: "replacement_requested", payload: { why, offers: n } });
  if (n === 0) {
    const staff = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
    await notifyMany(staff.map((s) => s.id), "no_replacement_available", { ref: r.ref }, tx);
  }
}

// ───────── Loading, delivery, quantity ─────────
export async function recordLoading(actor: User, offerId: string, units: number) {
  if (!Number.isInteger(units) || units < 0) throw err("VALIDATION", "Invalid quantity", { field: "units" });
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    const r = await authorizeBusinessSide(tx, actor, o);
    expect(o, "attendance_confirmed");
    if (!SERVICE_MAP[r.service as ServiceKey].hasShipments) throw err("INVALID_TRANSITION", "Loading applies to delivery jobs only");
    const u = await setOffer(tx, offerId, { loadedUnits: units, loadedAt: new Date(), loadedAckByDriver: null });
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(actor), type: "loading_recorded", payload: { units } });
    await notify(o.driverId, "loading_recorded", { ref: r.ref, units }, tx);
    return u;
  });
}

export async function acknowledgeLoading(driver: User, offerId: string, ok: boolean, note?: string) {
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    forDriver(driver, o);
    expect(o, "attendance_confirmed");
    if (o.loadedUnits == null) throw err("INVALID_TRANSITION", "No loaded quantity to confirm yet");
    const r = await lockRequest(tx, o.requestId);
    const u = await setOffer(tx, offerId, { loadedAckByDriver: ok });
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(driver), type: ok ? "loading_confirmed" : "loading_disputed", payload: { units: o.loadedUnits, note } });
    if (!ok) {
      await openTicket(tx, driver, { category: "shipment_count_differs", subject: `Loaded quantity disputed (${r.ref})`, requestId: r.id, offerId, body: note });
      await notify(r.businessId, "loading_disputed", { ref: r.ref }, tx);
    }
    return u;
  });
}

export async function reportDelivered(driver: User, offerId: string, units: number) {
  if (!Number.isInteger(units) || units < 0) throw err("VALIDATION", "Invalid quantity", { field: "units" });
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    forDriver(driver, o);
    expect(o, "attendance_confirmed");
    const r = await lockRequest(tx, o.requestId);
    const hasShipments = SERVICE_MAP[r.service as ServiceKey].hasShipments;
    if (hasShipments && o.loadedUnits != null && o.loadedAckByDriver !== true) throw err("INVALID_TRANSITION", "Confirm the loaded quantity first");
    if (hasShipments && o.loadedUnits != null && units > o.loadedUnits) throw err("VALIDATION", "Delivered cannot exceed loaded quantity", { max: o.loadedUnits });
    const u = await setOffer(tx, offerId, { status: "delivered_reported", deliveredUnits: units, deliveredAt: new Date() });
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(driver), type: "delivery_reported", oldStatus: "attendance_confirmed", newStatus: "delivered_reported", payload: { units } });
    await notify(r.businessId, "delivery_reported", { ref: r.ref, units }, tx);
    return u;
  });
}

/** Business confirms the final quantity, or disputes it (which holds settlement). */
export async function confirmDelivery(actor: User, offerId: string, decision: { action: "confirm"; units?: number } | { action: "dispute"; note: string }) {
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    const r = await authorizeBusinessSide(tx, actor, o);
    expect(o, "delivered_reported");
    if (decision.action === "dispute") {
      if (!decision.note?.trim()) throw err("VALIDATION", "Dispute note required", { field: "note" });
      const u = await setOffer(tx, offerId, { status: "qty_disputed" });
      await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(actor), type: "delivery_disputed", oldStatus: o.status, newStatus: "qty_disputed", payload: { note: decision.note } });
      await openComplaint(tx, actor, { category: "service_quality", description: decision.note, requestId: r.id, offerId, priority: "urgent", holdsSettlement: true });
      await notify(o.driverId, "delivery_disputed", { ref: r.ref }, tx);
      return u;
    }
    const units = decision.units ?? o.deliveredUnits ?? 0;
    if (!Number.isInteger(units) || units < 0) throw err("VALIDATION", "Invalid quantity", { field: "units" });
    const u = await setOffer(tx, offerId, { status: "pending_settlement", finalUnits: units, finalAt: new Date() });
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(actor), type: "delivery_confirmed", oldStatus: o.status, newStatus: "pending_settlement", payload: { units } });
    await completeIfReady(tx, r.id, actor);
    return u;
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
    const u = await setOffer(tx, offerId, { status: "pending_settlement", finalUnits, finalAt: new Date() });
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

async function finalizeRequest(tx: Exec, r: Request, live: Offer[], actor: User | null) {
  const ready = live.filter((o) => o.status === "pending_settlement");
  for (const o of ready) {
    await createSettlement(tx, r, o);
    await setOffer(tx, o.id, { status: "completed" });
    await notify(o.driverId, "job_completed", { ref: r.ref }, tx);
  }
  const unitPrice = r.unitPriceCents ?? 0;
  const held = live.reduce((a, o) => a + unitPrice * o.expectedUnits, 0); // shares still escrowed until payout
  await releaseReserve(tx, r, Math.max(0, r.reservedCents - held), `complete-release:${r.id}`, actor?.id);
  await tx.update(offers).set({ status: "expired", updatedAt: new Date() }).where(and(eq(offers.requestId, r.id), eq(offers.status, "offered")));
  await tx.update(requests).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(eq(requests.id, r.id));
  await logEvent(tx, { requestId: r.id, actor: actor ? actorOf(actor) : null, type: "request_completed", oldStatus: r.status, newStatus: "completed" });
  await notify(r.businessId, "request_completed", { ref: r.ref }, tx);
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
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(driver), type: "driver_cancelled", oldStatus: o.status, newStatus: "cancelled", payload: { reason } });
    await notify(r.businessId, "driver_cancelled", { ref: r.ref }, tx);
    let strike: "none" | "warning" | "suspended" = "none";
    if (s.cancelPolicyEnabled) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(jobEvents).where(and(eq(jobEvents.type, "driver_cancelled"), eq(jobEvents.actorId, driver.id), sql`${jobEvents.createdAt} > now() - make_interval(days => ${s.cancelWindowDays})`));
      if (n >= s.cancelSuspendAt) {
        await tx.update(driverProfiles).set({ suspendedUntil: new Date(Date.now() + s.cancelSuspendDays * 864e5), availability: "unavailable" }).where(eq(driverProfiles.userId, driver.id));
        strike = "suspended"; await notify(driver.id, "cancel_suspended", { days: s.cancelSuspendDays }, tx);
        await audit(null, "driver.auto_suspend", "user", driver.id, { cancellations: n }, tx);
      } else if (n >= s.cancelWarnAt) { strike = "warning"; await notify(driver.id, "cancel_warning", { count: n }, tx); }
    }
    await freeSlotAndReplace(tx, r, o, "driver_cancelled");
    return { offer: u, strike };
  });
}

/** Operations: replace a driver (record reason) and look for a substitute. */
export async function staffReplace(staff: User, offerId: string, reason: string) {
  if (!can(staff, "replacements.manage")) throw err("FORBIDDEN");
  if (!reason?.trim()) throw err("VALIDATION", "Reason required", { field: "reason" });
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    expect(o, "accepted", "arrived", "attendance_confirmed");
    const r = await lockRequest(tx, o.requestId);
    const u = await setOffer(tx, offerId, { status: "replaced", cancelReason: reason, cancelledAt: new Date() });
    await logEvent(tx, { requestId: r.id, offerId, actor: actorOf(staff), type: "driver_replaced", oldStatus: o.status, newStatus: "replaced", payload: { reason } });
    await audit(staff, "offer.replace", "offer", offerId, { reason }, tx);
    await notify(o.driverId, "replaced_by_ops", { ref: r.ref }, tx);
    await freeSlotAndReplace(tx, r, o, "ops_replace");
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
    const ops = await tx.select({ id: users.id }).from(users).where(and(inArray(users.role, ["admin"]), eq(users.status, "active")));
    await notifyMany(ops.map((o) => o.id), "ticket_urgent", { ref: t.ref }, tx);
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
