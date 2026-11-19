import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { offers, requests, shipments, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { logEvent } from "./events";
import { notify } from "./notify";
import { lockOffer, forDriver, expect, setOffer } from "./jobs";
import { isManifestJob, normalizeScan, scanMatches, syncOfferUnits } from "./shipments";
import { effectiveOps } from "./warehouse";
import { autoPlanRoute } from "./route-plan";

/**
 * E3 — loading by the driver's own scans. After attendance the driver scans each parcel onto the vehicle; "finish loading" confirms the
 * count (replacing the warehouse's recording + the driver's acknowledgement), returns unscanned parcels to the pool and plans the route.
 */
const actorOf = (u: User) => ({ id: u.id, name: u.name, role: u.role });

async function scanContext(tx: Exec, driver: User, offerId: string) {
  const o = await lockOffer(tx, offerId);
  forDriver(driver, o);
  expect(o, "attendance_confirmed");
  const [r] = await tx.select().from(requests).where(eq(requests.id, o.requestId));
  if (!(await isManifestJob(tx, r.id))) throw err("INVALID_TRANSITION", "Scanning applies to per-parcel jobs only");
  if ((await effectiveOps(r.businessId, tx)).requireLoadingRecord) throw err("INVALID_TRANSITION", "This warehouse records the hand-over itself — wait for it");
  if (o.routeApprovedAt || o.loadedAckByDriver === true || o.loadedUnits != null) throw err("INVALID_TRANSITION", "Loading is already finished");
  return { o, r };
}

const counts = async (tx: Exec, offerId: string) => {
  const rows = await tx.select({ s: shipments.status, n: sql<number>`count(*)::int` }).from(shipments).where(and(eq(shipments.offerId, offerId), inArray(shipments.status, ["pending", "loaded"]))).groupBy(shipments.status);
  const loaded = rows.find((x) => x.s === "loaded")?.n ?? 0, pending = rows.find((x) => x.s === "pending")?.n ?? 0;
  return { scanned: loaded, assigned: loaded + pending };
};

export async function scanLoad(driver: User, offerId: string, codeRaw: string) {
  const code = normalizeScan(codeRaw);
  if (!code) throw err("VALIDATION", "Scan or type the parcel code", { field: "code" });
  return db.transaction(async (tx) => {
    const { o, r } = await scanContext(tx, driver, offerId);
    const mine = await tx.select().from(shipments).where(and(eq(shipments.offerId, o.id), inArray(shipments.status, ["pending", "loaded"]))).orderBy(asc(shipments.seq)).for("update");
    const hit = mine.find((s) => scanMatches(s, code));
    if (!hit) {
      // Tell the driver WHY: another driver's parcel, a parcel of this order that is not assigned, or not this order at all.
      const others = await tx.select({ s: shipments, d: offers.driverId }).from(shipments).leftJoin(offers, eq(offers.id, shipments.offerId)).where(eq(shipments.requestId, r.id));
      const other = others.find(({ s }) => scanMatches(s, code));
      const why = !other ? "This code is not part of this order" : other.d && other.d !== driver.id ? "This parcel is assigned to another driver" : "This parcel is not in your load";
      throw err("VALIDATION", why, { field: "code", code });
    }
    if (hit.status === "loaded") { const c = await counts(tx, o.id); return { shipment: { id: hit.id, code: hit.code, seq: hit.seq }, ...c, already: true }; }
    if (!hit.detailsComplete) throw err("DETAILS_INCOMPLETE", "This parcel still misses recipient details — ask the warehouse to complete them", { count: 1, codes: [hit.code] });
    await tx.update(shipments).set({ status: "loaded", loadedAt: new Date(), loadedVia: "driver_scan", updatedAt: new Date() }).where(eq(shipments.id, hit.id));
    await logEvent(tx, { requestId: r.id, offerId: o.id, actor: actorOf(driver), type: "loading_scanned", payload: { shipmentId: hit.id, code: hit.code } });
    const c = await counts(tx, o.id);
    return { shipment: { id: hit.id, code: hit.code, seq: hit.seq }, ...c, already: false };
  });
}

/** Undo a mistaken scan (before finishing). */
export async function unscanLoad(driver: User, offerId: string, codeRaw: string) {
  const code = normalizeScan(codeRaw);
  if (!code) throw err("VALIDATION", "Choose the parcel to remove", { field: "code" });
  return db.transaction(async (tx) => {
    const { o, r } = await scanContext(tx, driver, offerId);
    const mine = await tx.select().from(shipments).where(and(eq(shipments.offerId, o.id), eq(shipments.status, "loaded"))).for("update");
    const hit = mine.find((s) => scanMatches(s, code));
    if (!hit) throw err("VALIDATION", "That parcel is not scanned", { field: "code", code });
    await tx.update(shipments).set({ status: "pending", loadedAt: null, loadedVia: null, updatedAt: new Date() }).where(eq(shipments.id, hit.id));
    await logEvent(tx, { requestId: r.id, offerId: o.id, actor: actorOf(driver), type: "loading_unscanned", payload: { shipmentId: hit.id, code: hit.code } });
    return counts(tx, o.id);
  });
}

/** The driver is done scanning: confirm the count, release the rest to the pool, plan the best route. */
export async function finishLoading(driver: User, offerId: string) {
  const res = await db.transaction(async (tx) => {
    const { o, r } = await scanContext(tx, driver, offerId);
    const rows = await tx.select().from(shipments).where(and(eq(shipments.offerId, o.id), inArray(shipments.status, ["pending", "loaded"]))).orderBy(asc(shipments.stopOrder), asc(shipments.seq)).for("update");
    const loaded = rows.filter((s) => s.status === "loaded"), rest = rows.filter((s) => s.status === "pending");
    if (!loaded.length) throw err("VALIDATION", "Scan at least one parcel before finishing", { field: "codes" });
    // Unscanned parcels were never taken: back to the pool so a replacement or a later slot can carry them.
    if (rest.length) await tx.update(shipments).set({ offerId: null, stopOrder: null, status: "pending", updatedAt: new Date() }).where(inArray(shipments.id, rest.map((s) => s.id)));
    await tx.execute(sql`update shipments s set stop_order = x.rn, updated_at = now()
      from (select id, row_number() over (order by stop_order, seq) rn from shipments where id in (${sql.join(loaded.map((l) => sql`${l.id}`), sql`, `)})) x where s.id = x.id`);
    const snap = r.pricingSnapshot as { providerCostCents: number } | null;
    await syncOfferUnits(tx, o.id, snap?.providerCostCents ?? 0);
    await setOffer(tx, o.id, { loadedUnits: loaded.length, loadedAt: new Date(), loadedAckByDriver: true });
    await logEvent(tx, { requestId: r.id, offerId: o.id, actor: actorOf(driver), type: "loading_finished", payload: { units: loaded.length, released: rest.length } });
    await notify(r.businessId, "loading_finished", { requestId: r.id, ref: r.ref, driver: driver.name, units: loaded.length }, tx);
    return { loaded: loaded.length, released: rest.length };
  });
  await autoPlanRoute(offerId); // best effort, outside the transaction (network)
  return res;
}
