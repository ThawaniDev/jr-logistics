import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, driverProfiles, shipments, rateLimits, sessions, otpCodes, apiIdempotency, apiLogs, settings } from "@/db/schema";
import { DRIVER_DOC_TYPES, OFFER_DEAD } from "./catalog";
import { dispatchOffers } from "./matching";
import { lockRequest, releaseReserve } from "./requests";
import { getSettings } from "./settings";
import { recomputeDriverVerification } from "./accounts";
import { logEvent } from "./events";
import { notify, notifyMany } from "./notify";
import { autoConfirmDelivery, completeIfReady } from "./jobs";
import { escrowStillNeeded, paySettlementsDue } from "./settlement";
import { batchOf, recordShipmentEvents } from "./shipment-events";
import { runCaptureTick } from "./snapshots";
import { describeError } from "@/lib/log";
import { riyadhDay } from "./analytics/time";

/**
 * Scheduled housekeeping (idempotent):
 * 1. expire stale offers, 2. broadcast requests whose office window elapsed,
 * 3. expire unfilled requests after start (refund), 4. re-evaluate driver document expiry.
 */
const PARTIAL_GRACE_MIN = 60;

/**
 * One bad row must never stop the tick: every per-request transaction (and every later step) runs under `guard`, which logs the failure and moves on. The failed row is
 * simply retried by the next tick; what failed is reported in the result (`errors`) so the health check / cron caller can see it.
 */
type StepError = { step: string; id?: string; message: string };

export async function runMaintenance() {
  const s = await getSettings();
  const now = new Date();
  const errors: StepError[] = [];
  const guard = async (step: string, id: string | undefined, fn: () => Promise<unknown>) => {
    try { await fn(); }
    catch (e) {
      const d = describeError(e);
      if (errors.length < 20) errors.push({ step, id, message: String((d as { message?: string }).message ?? "error").slice(0, 160) });
      console.warn(JSON.stringify({ level: "warn", msg: "maintenance step failed", step, id, ...d }));
    }
  };
  const staleOffers = await db.update(offers).set({ status: "expired", updatedAt: now })
    .where(and(eq(offers.status, "offered"), lt(offers.createdAt, new Date(now.getTime() - s.offerExpiryMin * 60_000)))).returning({ id: offers.id });

  let broadcast = 0;
  const windowDue = await db.select().from(requests).where(and(inArray(requests.status, ["published", "filling"]), lt(requests.officeWindowEndsAt, now)));
  for (const r of windowDue) {
    await guard("office_window", r.id, () => db.transaction(async (tx) => {
      const locked = await lockRequest(tx, r.id);
      if (!locked.officeWindowEndsAt || locked.officeWindowEndsAt > now) return;
      await tx.update(requests).set({ officeWindowEndsAt: null }).where(eq(requests.id, r.id));
      broadcast += await dispatchOffers(tx, { ...locked, officeWindowEndsAt: null });
      await logEvent(tx, { requestId: r.id, type: "office_window_elapsed" });
    }));
  }

  let expired = 0;
  const lapsed = await db.select().from(requests).where(and(inArray(requests.status, ["published", "filling"]), lt(requests.startsAt, now), sql`${requests.slotsFilled} = 0`));
  for (const r of lapsed) {
    await guard("expire_unfilled", r.id, () => db.transaction(async (tx) => {
      const l = await lockRequest(tx, r.id);
      if (!["published", "filling"].includes(l.status) || l.slotsFilled > 0) return;
      await releaseReserve(tx, l, l.reservedCents, `expire-release:${l.id}`);
      await tx.update(offers).set({ status: "expired", updatedAt: now }).where(and(eq(offers.requestId, l.id), eq(offers.status, "offered")));
      const lapsedParcels = await tx.update(shipments).set({ status: "cancelled", failReason: "unfulfilled", updatedAt: now }).where(and(eq(shipments.requestId, l.id), eq(shipments.status, "pending"))).returning({ id: shipments.id });
      await recordShipmentEvents(tx, batchOf(lapsedParcels.map((p) => p.id), l.id, "cancelled", { payload: { reason: "unfulfilled", by: "maintenance" } }));
      await tx.update(requests).set({ status: "expired", updatedAt: now }).where(eq(requests.id, l.id));
      await logEvent(tx, { requestId: l.id, type: "request_expired", oldStatus: l.status, newStatus: "expired" });
      await notify(l.businessId, "request_expired", { requestId: l.id, ref: l.ref }, tx);
      expired++;
    }));
  }

  // All-or-nothing requests (the business ticked "start only if every driver is found"): not fully staffed at the start time → called off and refunded.
  let calledOff = 0;
  const allOrNothing = await db.select().from(requests).where(and(inArray(requests.status, ["published", "filling"]), eq(requests.allowPartial, false), lt(requests.startsAt, now), sql`${requests.slotsFilled} > 0`, sql`${requests.slotsFilled} < ${requests.quantity}`));
  for (const r of allOrNothing) {
    await guard("call_off", r.id, () => db.transaction(async (tx) => {
      const l = await lockRequest(tx, r.id);
      if (!["published", "filling"].includes(l.status) || l.slotsFilled <= 0 || l.slotsFilled >= l.quantity) return;
      const live = (await tx.select().from(offers).where(eq(offers.requestId, l.id))).filter((o) => !(OFFER_DEAD as string[]).includes(o.status) && o.status !== "offered");
      // Every driver still on the job goes — including one the business already confirmed (and even loaded): the request is called off.
      await tx.update(offers).set({ status: "cancelled", cancelReason: "not_fully_staffed", cancelledAt: now, updatedAt: now }).where(and(eq(offers.requestId, l.id), inArray(offers.status, ["offered", "accepted", "arrived", "attendance_confirmed"])));
      // Parcels still at the warehouse are withdrawn; any already handed over must come back (same rule as a cancelled request).
      const calledOffParcels = await tx.update(shipments).set({ status: sql`case when ${shipments.status} = 'loaded' then 'failed' else 'cancelled' end`, failReason: sql`case when ${shipments.status} = 'loaded' then 'request_cancelled' else 'not_fully_staffed' end`, failedAt: sql`case when ${shipments.status} = 'loaded' then now() else ${shipments.failedAt} end`, offerId: sql`case when ${shipments.status} = 'loaded' then ${shipments.offerId} else null end`, updatedAt: now })
        .where(and(eq(shipments.requestId, l.id), inArray(shipments.status, ["pending", "loaded"]))).returning({ id: shipments.id, status: shipments.status, offerId: shipments.offerId });
      await recordShipmentEvents(tx, calledOffParcels.map((p) => ({ shipmentId: p.id, requestId: l.id, offerId: p.offerId, type: p.status === "failed" ? "failed" as const : "cancelled" as const, payload: { reason: p.status === "failed" ? "request_cancelled" : "not_fully_staffed", by: "maintenance" } })));
      await releaseReserve(tx, l, l.reservedCents, `allornothing-release:${l.id}`);
      await tx.update(requests).set({ status: "cancelled", cancelReason: "not_fully_staffed", cancelledAt: now, updatedAt: now }).where(eq(requests.id, l.id));
      await logEvent(tx, { requestId: l.id, type: "request_called_off", oldStatus: l.status, newStatus: "cancelled", payload: { requested: l.quantity, staffed: l.slotsFilled } });
      await notify(l.businessId, "request_called_off", { requestId: l.id, ref: l.ref, filled: l.slotsFilled, requested: l.quantity }, tx);
      await notifyMany(live.map((o) => o.driverId), "request_cancelled", { ref: l.ref }, tx);
      calledOff++;
    }));
  }

  // Partly staffed requests: once the start time + grace has passed, close the open slots so the job can finish
  // normally and the escrow for the unfilled slots goes back to the business instead of staying locked forever.
  let partial = 0;
  const partlyFilled = await db.select().from(requests).where(and(inArray(requests.status, ["published", "filling"]), lt(requests.startsAt, new Date(now.getTime() - PARTIAL_GRACE_MIN * 60_000)), sql`${requests.slotsFilled} > 0`, sql`${requests.slotsFilled} < ${requests.quantity}`, eq(requests.allowPartial, true)));
  for (const r of partlyFilled) {
    await guard("close_open_slots", r.id, () => db.transaction(async (tx) => {
      const l = await lockRequest(tx, r.id);
      if (!["published", "filling"].includes(l.status) || l.slotsFilled <= 0 || l.slotsFilled >= l.quantity) return;
      const all = await tx.select().from(offers).where(eq(offers.requestId, l.id));
      const live = all.filter((o) => !(OFFER_DEAD as string[]).includes(o.status) && o.status !== "offered");
      const held = await escrowStillNeeded(tx, l, live); // a paid offer's share is already off the reserve
      await releaseReserve(tx, l, Math.max(0, l.reservedCents - held), `partial-release:${l.id}`);
      await tx.update(offers).set({ status: "expired", updatedAt: now }).where(and(eq(offers.requestId, l.id), eq(offers.status, "offered")));
      const started = live.some((o) => ["attendance_confirmed", "delivered_reported", "pending_settlement"].includes(o.status));
      const closedParcels = await tx.update(shipments).set({ status: "cancelled", failReason: "unfulfilled", updatedAt: now }).where(and(eq(shipments.requestId, l.id), eq(shipments.status, "pending"), sql`${shipments.offerId} is null`)).returning({ id: shipments.id });
      await recordShipmentEvents(tx, batchOf(closedParcels.map((p) => p.id), l.id, "cancelled", { payload: { reason: "unfulfilled", by: "maintenance" } }));
      await tx.update(requests).set({ quantity: l.slotsFilled, status: started ? "in_progress" : "assigned", updatedAt: now }).where(eq(requests.id, l.id));
      await logEvent(tx, { requestId: l.id, type: "unfilled_slots_closed", oldStatus: l.status, newStatus: started ? "in_progress" : "assigned", payload: { requested: l.quantity, staffed: l.slotsFilled } });
      await notify(l.businessId, "request_partially_filled", { requestId: l.id, ref: l.ref, filled: l.slotsFilled, requested: l.quantity }, tx);
      await completeIfReady(tx, l.id, null); // every driver that took a slot may already be done: nobody else will ever trigger the completion
      partial++;
    }));
  }

  let reminded = 0, settled: { offers: number; paid: number } = { offers: 0, paid: 0 };
  await guard("remind_incomplete", undefined, async () => { reminded = await remindIncompleteParcels(now); });
  await guard("settle_due", undefined, async () => { settled = await settleDueWork(); });

  // A document that expires ON a date is valid through the end of that Riyadh day (UTC+3): from 21:00 UTC the next Riyadh day has begun. (`current_date` is the UTC date.)
  const today = riyadhDay(now);
  // Only drivers whose status WOULD change: a required document that is approved and expired with no valid approved document of the same type left, and a status that is not
  // "expired" yet. (Selecting every driver that ever had an expired document re-ran the recompute for each of them every minute, for ever — 170 of 190 statements of an idle tick.)
  // Uploading / approving a replacement goes through `reviewDocument`, which recomputes at that moment.
  let drivers: Array<{ id: string }> = [];
  await guard("document_expiry", undefined, async () => {
    const required = DRIVER_DOC_TYPES.filter((d) => d.required).map((d) => d.key);
    drivers = await db.select({ id: driverProfiles.userId }).from(driverProfiles).where(and(ne(driverProfiles.verificationStatus, "expired"), sql`exists (
      select 1 from documents d where d.owner_id = ${driverProfiles.userId} and d.owner_kind = 'driver' and d.status = 'approved' and d.expires_on < ${today}
        and d.type in (${sql.join(required.map((k) => sql`${k}`), sql`, `)})
        and not exists (select 1 from documents v where v.owner_id = d.owner_id and v.owner_kind = 'driver' and v.type = d.type and v.status = 'approved' and (v.expires_on is null or v.expires_on >= ${today})))`));
  });
  for (const d of drivers) await guard("driver_verification", d.id, () => recomputeDriverVerification(d.id));
  await guard("housekeeping", undefined, () => housekeeping(now));
  await guard("last_run", undefined, () => db.insert(settings).values({ key: "maintenance_last_run", value: { at: now.toISOString(), errors: errors.length } }).onConflictDoUpdate({ target: settings.key, set: { value: { at: now.toISOString(), errors: errors.length }, updatedAt: now } }));
  let unsuspended = 0;
  await guard("unsuspend", undefined, async () => { unsuspended = (await db.update(driverProfiles).set({ suspendedUntil: null }).where(lt(driverProfiles.suspendedUntil, now)).returning({ id: driverProfiles.userId })).length; });
  const captured = await runCaptureTick(now); // hourly / daily snapshots, request milestones, webhook log sync, retention (never throws)
  return { capture: captured, remindedIncomplete: reminded, settledOffers: settled.offers, paidSettlements: settled.paid, expiredOffers: staleOffers.length, broadcast, expiredRequests: expired, partialClosed: partial, calledOff, driversRecomputed: drivers.length, unsuspended, errors };
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
    catch (e) { console.warn(JSON.stringify({ level: "warn", msg: "auto-confirm failed", offerId: o.id, ...describeError(e) })); }
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
