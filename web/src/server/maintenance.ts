import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, driverProfiles, documents } from "@/db/schema";
import { dispatchOffers } from "./matching";
import { lockRequest, releaseReserve } from "./requests";
import { getSettings } from "./settings";
import { recomputeDriverVerification } from "./accounts";
import { logEvent } from "./events";
import { notify } from "./notify";

/**
 * Scheduled housekeeping (idempotent):
 * 1. expire stale offers, 2. broadcast requests whose office window elapsed,
 * 3. expire unfilled requests after start (refund), 4. re-evaluate driver document expiry.
 */
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
      await tx.update(requests).set({ status: "expired", updatedAt: now }).where(eq(requests.id, l.id));
      await logEvent(tx, { requestId: l.id, type: "request_expired", oldStatus: l.status, newStatus: "expired" });
      await notify(l.businessId, "request_expired", { ref: l.ref }, tx);
      expired++;
    });
  }

  const drivers = await db.selectDistinct({ id: documents.ownerId }).from(documents).where(and(eq(documents.ownerKind, "driver"), eq(documents.status, "approved"), sql`${documents.expiresOn} < current_date`));
  for (const d of drivers) await recomputeDriverVerification(d.id);
  const unsuspended = await db.update(driverProfiles).set({ suspendedUntil: null }).where(lt(driverProfiles.suspendedUntil, now)).returning({ id: driverProfiles.userId });
  return { expiredOffers: staleOffers.length, broadcast, expiredRequests: expired, driversRecomputed: drivers.length, unsuspended: unsuspended.length };
}
