import { inArray, sql } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { shipments } from "@/db/schema";
import { offerCodMap } from "./cod";
import { offerShipmentStats } from "./shipments";

/**
 * J5 — the numbers behind the stat cards on every order card of the driver's "My jobs" / dashboard (offered, accepted, active, history).
 * Computed here, next to the list route, so `driverJobView` stays as it is. The shape is part of the mobile contract:
 *   total · toDeliver · delivered · notDelivered (+ failed / returned), `estimated` while the parcels are not assigned yet (the total is then
 *   the offer's expected count), and `cod` when the job carries cash: toCollect / collected / handedOver / outstanding (cash is visible to
 *   every driver, office drivers included).
 */
export interface DriverJobCod { parcels: number; toCollectCents: number; collectedCents: number; handedOverCents: number; outstandingCents: number }
export interface DriverJobStats { total: number; toDeliver: number; delivered: number; notDelivered: number; failed: number; returned: number; estimated: boolean; cod: DriverJobCod | null }

/** The parts of a `driverJobView` the maths needs. */
export interface JobLike { offerId: string; status: string; manifest: boolean; service: string; expectedUnits: number | null; loadedUnits: number | null; deliveredUnits: number | null; finalUnits: number | null }
export interface ShipCounts { total: number; pending: number; loaded: number; delivered: number; failed: number; returned: number; missing: number }
export interface CodRaw { parcels: number; toCollectCents: number; collectedCents: number; receivedCents: number }

const DEAD = ["rejected", "expired", "cancelled", "no_show", "replaced"]; // nothing is left to deliver on these
const SETTLED = ["completed", "pending_settlement"]; // the work is over: whatever was not delivered is "not delivered"
const nn = (n: unknown) => Math.max(0, Math.trunc(Number(n) || 0));

/** Pure: the stats of one job from its parcel counts and cash rows (both undefined when the offer carries no parcel yet). */
export function buildStats(job: JobLike, ship?: ShipCounts, cash?: CodRaw): DriverJobStats | null {
  const dead = DEAD.includes(job.status);
  if (job.manifest) {
    if (!ship || ship.total <= 0) { // booked by count only: the parcels are handed out when the driver accepts
      const total = nn(job.expectedUnits);
      return { total, toDeliver: dead ? 0 : total, delivered: 0, notDelivered: 0, failed: 0, returned: 0, estimated: true, cod: null };
    }
    const handedOver = nn(cash?.receivedCents), collected = nn(cash?.collectedCents);
    const hasCod = !!cash && (cash.parcels > 0 || collected > 0 || cash.toCollectCents > 0);
    return {
      total: ship.total, toDeliver: ship.pending + ship.loaded, delivered: ship.delivered, notDelivered: ship.failed + ship.returned + ship.missing, failed: ship.failed, returned: ship.returned, estimated: false,
      cod: hasCod ? { parcels: nn(cash!.parcels), toCollectCents: nn(cash!.toCollectCents), collectedCents: collected, handedOverCents: handedOver, outstandingCents: Math.max(0, collected - handedOver) } : null,
    };
  }
  if (job.service !== "delivery_driver") return null; // vehicle-day services have no parcels
  // Older count-based jobs: the booked / loaded / delivered quantities are the parcels.
  const total = nn(job.loadedUnits ?? job.expectedUnits), delivered = Math.min(total, nn(job.finalUnits ?? job.deliveredUnits));
  const left = total - delivered;
  const settled = SETTLED.includes(job.status);
  return { total, toDeliver: settled || dead ? 0 : left, delivered, notDelivered: settled ? left : 0, failed: 0, returned: 0, estimated: job.loadedUnits == null && !settled, cod: null };
}

/** Stats for a set of jobs: three grouped queries for the whole list, none per row. */
export async function driverJobStats(jobs: JobLike[], x: Exec = db): Promise<Map<string, DriverJobStats | null>> {
  const manifestIds = jobs.filter((j) => j.manifest).map((j) => j.offerId);
  const out = new Map<string, DriverJobStats | null>();
  if (!manifestIds.length) { for (const j of jobs) out.set(j.offerId, buildStats(j)); return out; }
  const [counts, cod, cash] = await Promise.all([
    offerShipmentStats(x, manifestIds), offerCodMap(x, manifestIds),
    x.select({ o: shipments.offerId, parcels: sql<number>`count(*) filter (where ${shipments.codCents} > 0)::int`, toCollect: sql<number>`coalesce(sum(${shipments.codCents}) filter (where ${shipments.status} in ('pending','loaded')),0)::int` })
      .from(shipments).where(inArray(shipments.offerId, manifestIds)).groupBy(shipments.offerId),
  ]);
  const parcels = new Map(cash.map((c) => [c.o!, c]));
  for (const j of jobs) {
    const c = cod.get(j.offerId), p = parcels.get(j.offerId);
    out.set(j.offerId, buildStats(j, counts.get(j.offerId), c && p ? { parcels: p.parcels, toCollectCents: p.toCollect, collectedCents: c.collectedCents, receivedCents: c.receivedCents } : undefined));
  }
  return out;
}

/** Adds `stats` to each driver job view of a list (or a single one). */
export async function withStats<T extends JobLike>(views: T[], x: Exec = db): Promise<Array<T & { stats: DriverJobStats | null }>> {
  const map = await driverJobStats(views, x);
  return views.map((v) => ({ ...v, stats: map.get(v.offerId) ?? null }));
}
