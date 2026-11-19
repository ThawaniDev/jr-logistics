import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shipments, type User } from "@/db/schema";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { currentStopOf, otpFor } from "@/server/shipments";

/**
 * Drives the real per-parcel flow for an offer whose attendance is already confirmed:
 * hand over everything → driver confirms → approves the route → works stop by stop (arrive, then code) → reports done.
 * `deliver` parcels are delivered, the rest are refused at the door and then handed back to the warehouse.
 */
export async function work(biz: User, driver: User, offerId: string, deliver = Infinity) {
  await jobs.recordLoading(biz, offerId, undefined, { all: true });
  await jobs.acknowledgeLoading(driver, offerId, true);
  await stops.approveRoute(driver, offerId);
  let done = 0, failed = 0;
  for (;;) {
    const s = await currentStopOf(db, offerId);
    if (!s) break;
    await stops.arriveAtStop(driver, offerId, s.id);
    if (done < deliver) { await stops.deliverStop(driver, offerId, s.id, { code: s.code, otp: otpFor(s) }); done++; }
    else { await stops.failStop(driver, offerId, s.id, { reason: "refused" }); failed++; }
  }
  await jobs.reportDelivered(driver, offerId);
  if (failed) await stops.confirmReturns(biz, offerId, { all: true });
  return { delivered: done, failed };
}
export const parcelsOf = (offerId: string) => db.select().from(shipments).where(eq(shipments.offerId, offerId));
