import { and, eq, isNull } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { offers, type Offer, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { getSettings } from "./settings";
import { logEvent } from "./events";

/**
 * J2 — the platform's routing switch (`routingEnabled`, super-admin setting, default OFF).
 *
 * OFF: no Google planning/geocoding of routes, no "approve route" step, no one-stop-at-a-time lock (the driver may arrive at / deliver / fail /
 * postpone any `loaded` stop of his own job in any order), no manual re-ordering and no map data. ON: behaviour exactly as before.
 * The offer's `routeApprovedAt` keeps meaning "the driver's route has started": with routing off the system sets it itself, so every guard,
 * report and business/office view that reads it keeps working.
 */
export const isRoutingOn = async (x: Exec = db) => (await getSettings(x)).routingEnabled === true;

/** Refuses with `409 ROUTING_DISABLED` while the platform has routing switched off (optimise, re-order, route geometry). */
export async function assertRoutingOn(x: Exec = db) {
  if (!(await isRoutingOn(x))) throw err("ROUTING_DISABLED", "Route planning is turned off by the platform");
}

/**
 * Routing is OFF: the route starts by itself the moment loading is confirmed (the driver's acknowledgement / "finish loading") — or, for a job that was
 * already mid-flow when the switch flipped, at the first stop action. Idempotent; the offer row must be locked by the caller.
 * Logs the same `route_approved` event the manual step logs (so partner write-back "out for delivery" and the timeline keep working), marked `auto`.
 */
export async function autoStartRoute(tx: Exec, o: Offer, actor: Pick<User, "id" | "name" | "role">): Promise<Offer> {
  if (o.routeApprovedAt) return o;
  const [u] = await tx.update(offers).set({ routeApprovedAt: new Date(), updatedAt: new Date() }).where(and(eq(offers.id, o.id), isNull(offers.routeApprovedAt))).returning();
  if (!u) { const [cur] = await tx.select().from(offers).where(eq(offers.id, o.id)); return cur; }
  await logEvent(tx, { requestId: o.requestId, offerId: o.id, actor, type: "route_approved", payload: { stops: o.loadedUnits, auto: true } });
  return u;
}
