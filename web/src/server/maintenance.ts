import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, driverProfiles, documents, shipments, rateLimits, sessions, otpCodes, apiIdempotency, apiLogs, settings } from "@/db/schema";
import { OFFER_DEAD } from "./catalog";
import { dispatchOffers } from "./matching";
import { lockRequest, releaseReserve } from "./requests";
import { getSettings } from "./settings";
import { recomputeDriverVerification } from "./accounts";
import { logEvent } from "./events";
import { notify, notifyMany } from "./notify";
import { autoConfirmDelivery } from "./jobs";
import { paySettlementsDue } from "./settlement";

/**
 * Scheduled housekeeping (idempotent):
 * 1. expire stale offers, 2. broadcast requests whose office window elapsed,
 * 3. expire unfilled requests after start (refund), 4. re-evaluate driver document expiry.
 */
const PARTIAL_GRACE_MIN = 60;

export async function runMaintenance() {
  const s = await getSettings();
  const now = new Date();
  const staleOffers = await db.update(offers).set({ status: "expired", updatedAt: now })
    .where(and(eq(offers.status, "offered"), lt(offers.createdAt, new Date(now.getTime() - s.offerExpiryMin * 60_000)))).returning({ id: offers.id });

  let broadcast = 0;
  const windowDue = await db.select().from(requests).where(and(inArray(requests.status, ["published", "filling"]), lt(requests.officeWindowEndsAt, now)));
  for (const r of windowDue) {
    await db.transaction(async (tx) => {
      const locked = await lockRequest(tx, r.id);
      if (!locked.officeWindowEndsAt || locked.officeWindowEndsAt > now) return;
      await tx.update(requests).set({ officeWindowEndsAt: null }).where(eq(requests.id, r.id));
      broadcast += await dispatchOffers(tx, { ...locked, officeWindowEndsAt: null });
      await logEvent(tx, { requestId: r.id, type: "office_window_elapsed" });
    });
  }

  let expired = 0;
  const lapsed = await db.select().from(requests).where(and(inArray(requests.status, ["published", "filling"]), lt(requests.startsAt, now), sql`${requests.slotsFilled} = 0`));
  for (const r of lapsed) {
    await db.transaction(async (tx) => {
      const l = await lockRequest(tx, r.id);
      if (!["published", "filling"].includes(l.status) || l.slotsFilled > 0) return;
      await releaseReserve(tx, l, l.reservedCents, `expire-release:${l.id}`);
      await tx.update(offers).set({ status: "expired", updatedAt: now }).where(and(eq(offers.requestId, l.id), eq(offers.status, "offered")));
      await tx.update(shipments).set({ status: "cancelled", failReason: "unfulfilled", updatedAt: now }).where(and(eq(shipments.requestId, l.id), eq(shipments.status, "pending")));
      await tx.update(requests).set({ status: "expired", updatedAt: now }).where(eq(requests.id, l.id));
      await logEvent(tx, { requestId: l.id, type: "request_expired", oldStatus: l.status, newStatus: "expired" });
      await notify(l.businessId, "request_expired", { requestId: l.id, ref: l.ref }, tx);
      expired++;
    });
  }

  // All-or-nothing requests (the business ticked "start only if every driver is found"): not fully staffed at the start time → called off and refunded.
  let calledOff = 0;
  const allOrNothing = await db.select().from(requests).where(and(inArray(requests.status, ["published", "filling"]), eq(requests.allowPartial, false), lt(requests.startsAt, now), sql`${requests.slotsFilled} > 0`, sql`${requests.slotsFilled} < ${requests.quantity}`));
  for (const r of allOrNothing) {
    await db.transaction(async (tx) => {
      const l = await lockRequest(tx, r.id);
      if (!["published", "filling"].includes(l.status) || l.slotsFilled <= 0 || l.slotsFilled >= l.quantity) return;
      const live = (await tx.select().from(offers).where(eq(offers.requestId, l.id))).filter((o) => !(OFFER_DEAD as string[]).includes(o.status) && o.status !== "offered");
      // Every driver still on the job goes — including one the business already confirmed (and even loaded): the request is called off.
      await tx.update(offers).set({ status: "cancelled", cancelReason: "not_fully_staffed", cancelledAt: now, updatedAt: now }).where(and(eq(offers.requestId, l.id), inArray(offers.status, ["offered", "accepted", "arrived", "attendance_confirmed"])));
      // Parcels still at the warehouse are withdrawn; any already handed over must come back (same rule as a cancelled request).
      await tx.update(shipments).set({ status: sql`case when ${shipments.status} = 'loaded' then 'failed' else 'cancelled' end`, failReason: sql`case when ${shipments.status} = 'loaded' then 'request_cancelled' else 'not_fully_staffed' end`, failedAt: sql`case when ${shipments.status} = 'loaded' then now() else ${shipments.failedAt} end`, offerId: sql`case when ${shipments.status} = 'loaded' then ${shipments.offerId} else null end`, updatedAt: now })
        .where(and(eq(shipments.requestId, l.id), inArray(shipments.status, ["pending", "loaded"])));
      await releaseReserve(tx, l, l.reservedCents, `allornothing-release:${l.id}`);
      await tx.update(requests).set({ status: "cancelled", cancelReason: "not_fully_staffed", cancelledAt: now, updatedAt: now }).where(eq(requests.id, l.id));
      await logEvent(tx, { requestId: l.id, type: "request_called_off", oldStatus: l.status, newStatus: "cancelled", payload: { requested: l.quantity, staffed: l.slotsFilled } });
      await notify(l.businessId, "request_called_off", { requestId: l.id, ref: l.ref, filled: l.slotsFilled, requested: l.quantity }, tx);
      await notifyMany(live.map((o) => o.driverId), "request_cancelled", { ref: l.ref }, tx);
      calledOff++;
    });
  }

  // Partly staffed requests: once the start time + grace has passed, close the open slots so the job can finish
  // normally and the escrow for the unfilled slots goes back to the business instead of staying locked forever.
  let partial = 0;
  const partlyFilled = await db.select().from(requests).where(and(inArray(requests.status, ["published", "filling"]), lt(requests.startsAt, new Date(now.getTime() - PARTIAL_GRACE_MIN * 60_000)), sql`${requests.slotsFilled} > 0`, sql`${requests.slotsFilled} < ${requests.quantity}`, eq(requests.allowPartial, true)));
  for (const r of partlyFilled) {
    await db.transaction(async (tx) => {
      const l = await lockRequest(tx, r.id);
      if (!["published", "filling"].includes(l.status) || l.slotsFilled <= 0 || l.slotsFilled >= l.quantity) return;
      const all = await tx.select().from(offers).where(eq(offers.requestId, l.id));
      const live = all.filter((o) => !(OFFER_DEAD as string[]).includes(o.status) && o.status !== "offered");
      const held = live.reduce((a, o) => a + (l.unitPriceCents ?? 0) * o.expectedUnits, 0);
      await releaseReserve(tx, l, Math.max(0, l.reservedCents - held), `partial-release:${l.id}`);
      await tx.update(offers).set({ status: "expired", updatedAt: now }).where(and(eq(offers.requestId, l.id), eq(offers.status, "offered")));
      const started = live.some((o) => ["attendance_confirmed", "delivered_reported", "pending_settlement"].includes(o.status));
      await tx.update(shipments).set({ status: "cancelled", failReason: "unfulfilled", updatedAt: now }).where(and(eq(shipments.requestId, l.id), eq(shipments.status, "pending"), sql`${shipments.offerId} is null`));
      await tx.update(requests).set({ quantity: l.slotsFilled, status: started ? "in_progress" : "assigned", updatedAt: now }).where(eq(requests.id, l.id));
      await logEvent(tx, { requestId: l.id, type: "unfilled_slots_closed", oldStatus: l.status, newStatus: started ? "in_progress" : "assigned", payload: { requested: l.quantity, staffed: l.slotsFilled } });
      await notify(l.businessId, "request_partially_filled", { requestId: l.id, ref: l.ref, filled: l.slotsFilled, requested: l.quantity }, tx);
      partial++;
    });
  }

  const reminded = await remindIncompleteParcels(now);
  const settled = await settleDueWork();

  const drivers = await db.selectDistinct({ id: documents.ownerId }).from(documents).where(and(eq(documents.ownerKind, "driver"), eq(documents.status, "approved"), sql`${documents.expiresOn} < current_date`));
  for (const d of drivers) await recomputeDriverVerification(d.id);
  await housekeeping(now);
  await db.insert(settings).values({ key: "maintenance_last_run", value: { at: now.toISOString() } }).onConflictDoUpdate({ target: settings.key, set: { value: { at: now.toISOString() }, updatedAt: now } });
  const unsuspended = await db.update(driverProfiles).set({ suspendedUntil: null }).where(lt(driverProfiles.suspendedUntil, now)).returning({ id: driverProfiles.userId });
  return { remindedIncomplete: reminded, settledOffers: settled.offers, paidSettlements: settled.paid, expiredOffers: staleOffers.length, broadcast, expiredRequests: expired, partialClosed: partial, calledOff, driversRecomputed: drivers.length, unsuspended: unsuspended.length };
}

/**
 * E16/E18 safety net: a job that reached "delivery reported" / "pending settlement" before the automatic flow existed (or whose payment was
 * held by a complaint that has since been resolved) is confirmed and paid here, so nothing waits for a person who no longer has a button.
 */
export async function settleDueWork() {
  let offersDone = 0;
  const stuck = await db.select({ id: offers.id }).from(offers).where(inArray(offers.status, ["delivered_reported", "pending_settlement"])).limit(100);
  for (const o of stuck) {
    try { await db.transaction((tx) => autoConfirmDelivery(tx, o.id, null)); offersDone++; }
    catch (e) { console.warn(JSON.stringify({ level: "warn", msg: "auto-confirm failed", offerId: o.id, error: e instanceof Error ? e.message.slice(0, 160) : "error" })); }
  }
  return { offers: offersDone, paid: await paySettlementsDue() };
}

/**
 * Orders booked "details later": remind the business (at most once every 4 hours) while parcels still lack recipient details and the
 * start time is within 6 hours (or has passed) — those parcels cannot be handed to a driver until completed.
 */
export const INCOMPLETE_REMINDER_WINDOW_H = 6;
export const INCOMPLETE_REMINDER_EVERY_H = 4;
export async function remindIncompleteParcels(now = new Date()) {
  const rows = await db.select({ id: requests.id, ref: requests.ref, businessId: requests.businessId, n: sql<number>`count(*)::int` }).from(shipments)
    .innerJoin(requests, eq(requests.id, shipments.requestId))
    .where(and(eq(shipments.detailsComplete, false), eq(shipments.status, "pending"), inArray(requests.status, ["published", "filling", "assigned", "confirmed", "in_progress"]),
      lt(requests.startsAt, new Date(now.getTime() + INCOMPLETE_REMINDER_WINDOW_H * 3600_000)),
      sql`not exists (select 1 from job_events e where e.request_id = ${requests.id} and e.type = 'details_reminder' and e.created_at > ${new Date(now.getTime() - INCOMPLETE_REMINDER_EVERY_H * 3600_000)})`))
    .groupBy(requests.id, requests.ref, requests.businessId);
  for (const r of rows) {
    await db.transaction(async (tx) => {
      await notify(r.businessId, "parcels_details_pending", { requestId: r.id, ref: r.ref, n: r.n }, tx);
      await logEvent(tx, { requestId: r.id, type: "details_reminder", payload: { incomplete: r.n } });
    });
  }
  return rows.length;
}

/**
 * Deletes rows that only ever grow and are useless once stale: expired rate-limit windows (attacker-chosen keys would otherwise pile up
 * forever), dead sessions and one-time codes, abandoned idempotency claims, old API logs. Safe to run concurrently and repeatedly.
 */
export async function housekeeping(now = new Date()) {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const DAY = 864e5;
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, ago(DAY)));
  await db.delete(sessions).where(sql`${sessions.expiresAt} < ${ago(DAY)} or ${sessions.revokedAt} < ${ago(DAY)}`);
  await db.delete(otpCodes).where(lt(otpCodes.expiresAt, ago(DAY)));
  await db.delete(apiIdempotency).where(sql`(${apiIdempotency.status} = 0 and ${apiIdempotency.createdAt} < ${ago(30 * 60_000)}) or ${apiIdempotency.createdAt} < ${ago(7 * DAY)}`);
  await db.delete(apiLogs).where(lt(apiLogs.createdAt, ago(30 * DAY)));
}
