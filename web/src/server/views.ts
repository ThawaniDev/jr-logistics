import { eq, inArray, and, desc, asc, sql, isNull } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, users, driverProfiles, businessProfiles, jobEvents, custodyItems, ratings, shipments, type Offer, type Request, type User } from "@/db/schema";
import { OFFER_BUSY, REQUEST_TERMINAL, SERVICE_MAP, type ServiceKey } from "./catalog";
import { can } from "./auth/permissions";
import { err } from "@/lib/errors";
import { getSettings } from "./settings";
import { isManifestJob, driverStopView, offerShipmentStats, incompleteCount } from "./shipments";
import { effectiveOps, pickupPinOf } from "./warehouse";
import { offerCodMap } from "./cod";
import { routeView } from "./route-plan";

const maskPhone = (p: string | null) => (p ? p.slice(0, 4) + "•••" + p.slice(-2) : null);
const avg = (sum: number, n: number) => (n ? Math.round((sum / n) * 10) / 10 : null);

/** What a driver may see. Exact addresses & recipient contact only once the job is theirs. */
export async function driverJobView(o: Offer, r: Request) {
  const mine = (OFFER_BUSY as string[]).includes(o.status); // addresses & recipient contact only while the job is active
  const [biz] = await db.select({ name: users.name, c: businessProfiles.companyName }).from(users).leftJoin(businessProfiles, eq(businessProfiles.userId, users.id)).where(eq(users.id, r.businessId));
  const [p] = await db.select({ officeId: driverProfiles.officeId }).from(driverProfiles).where(eq(driverProfiles.userId, o.driverId));
  const earningHidden = !!(o.officeId ?? p?.officeId);
  const cfg = await getSettings();
  const routing = cfg.routingEnabled; // J2: off = no route planning / approval / lock / reorder; the driver works any of his own stops in any order
  const { offerExpiryMin } = cfg;
  const expiresAt = o.status === "offered" ? new Date(o.createdAt.getTime() + offerExpiryMin * 60_000) : null; // after this the offer lapses on the next housekeeping tick
  const ops = await effectiveOps(r.businessId, db, cfg);
  // Per-parcel jobs: the driver sees their own stops. All addresses (so the fixed route can be reviewed and approved), but the
  // recipient's name and phone only for the stop in front of them.
  const manifest = await isManifestJob(db, r.id);
  let stops: ReturnType<typeof driverStopView>[] | null = null;
  let route: ReturnType<typeof routeView> | null = null;
  let summary = { total: 0, pending: 0, loaded: 0, delivered: 0, failed: 0, returned: 0, missing: 0 };
  let cod = { toCollectCents: 0, collectedCents: 0, parcels: 0 };
  if (manifest) {
    const rows = await db.select().from(shipments).where(eq(shipments.offerId, o.id)).orderBy(asc(shipments.stopOrder), asc(shipments.seq));
    summary = (await offerShipmentStats(db, [o.id])).get(o.id) ?? summary;
    route = routing ? routeView(o, rows, { canReorder: cfg.driverCanReorderRoute }) : null; // J2: no route data at all while routing is off
    cod = {
      toCollectCents: rows.filter((s) => ["pending", "loaded"].includes(s.status)).reduce((a, s) => a + s.codCents, 0),
      collectedCents: rows.reduce((a, s) => a + (s.codCollectedCents ?? 0), 0), parcels: rows.filter((s) => s.codCents > 0).length,
    };
    if (mine) {
      // Routing on: the stops unlock when the driver approves the route. Routing off: they unlock when loading is confirmed (also for a job that was mid-flow when the switch flipped).
      const started = !!o.routeApprovedAt || (!routing && o.loadedAckByDriver === true);
      const cur = started ? rows.find((s) => s.status === "loaded") ?? null : null;
      stops = rows.map((s) => driverStopView(s, { currentId: cur?.id ?? null, stopWaitMin: cfg.stopWaitMin, routeApproved: !!o.routeApprovedAt, remaining: summary.loaded, needsOtp: ops.requireDeliveryOtp, needsSignature: ops.requireSignature, routing, started }));
    }
  }
  const pin = await pickupPinOf(r, db);
  const loading = { mode: ops.requireLoadingRecord ? "warehouse" as const : "driver_scan" as const, assigned: summary.total, scanned: summary.total - summary.pending, finished: o.loadedAckByDriver === true };
  return {
    offerId: o.id, requestId: r.id, ref: r.ref, service: r.service, status: o.status, requestStatus: r.status, expiresAt,
    isReplacement: o.isReplacement, business: biz?.c ?? biz?.name ?? null,
    vehicleType: r.vehicleType, temperature: r.temperature, pickupCity: r.pickupCity, deliveryCity: r.deliveryCity,
    startsAt: r.startsAt, durationDays: r.durationDays, expectedUnits: o.expectedUnits, shipmentsPerDriver: r.shipmentsPerDriver,
    expectedEarningCents: earningHidden ? null : o.expectedEarningCents, earningHidden, notes: mine ? r.notes : null, contents: mine ? r.contents : null,
    pickup: mine ? { address: r.pickupAddress, lat: r.pickupLat ?? pin?.lat ?? null, lng: r.pickupLng ?? pin?.lng ?? null } : null,
    delivery: mine && !manifest ? { address: r.deliveryAddress, lat: r.deliveryLat, lng: r.deliveryLng } : null,
    recipient: mine && !manifest && r.recipientPhone ? { name: r.recipientName, phone: r.recipientPhone } : null,
    manifest, stops, route, stopsSummary: manifest ? summary : null, routeApprovedAt: o.routeApprovedAt, allowPartial: r.allowPartial,
    ops, arrival: { geofence: cfg.arrivalGeofenceEnabled, radiusM: cfg.arrivalRadiusM, warehouse: pin },
    loading: manifest ? loading : null,
    policy: { routingEnabled: routing, b2bShipmentsEnabled: cfg.b2bShipmentsEnabled, canReorderRoute: routing && cfg.driverCanReorderRoute, rescheduleEvidenceText: cfg.rescheduleEvidenceText, rescheduleEvidencePhoto: cfg.rescheduleEvidencePhoto, stopWaitMin: cfg.stopWaitMin, failStrict: cfg.stopFailStrictRules },
    cod: manifest ? cod : null,
    loadedUnits: o.loadedUnits, loadedAckByDriver: o.loadedAckByDriver, deliveredUnits: o.deliveredUnits, finalUnits: o.finalUnits,
    acceptedAt: o.acceptedAt, arrivedAt: o.arrivedAt, cancelReason: o.cancelReason,
    actions: driverActions(o, r, { manifest, remaining: summary.loaded, loadingMode: loading.mode, scanned: loading.scanned, routing }),
  };
}

/** Server-driven next actions so every client (web, Flutter) renders the same flow. */
export function driverActions(o: Offer, r: Request, ctx: { manifest?: boolean; remaining?: number; loadingMode?: "driver_scan" | "warehouse"; scanned?: number; routing?: boolean } = {}): string[] {
  switch (o.status) {
    case "offered": return ["accept", "reject"];
    case "accepted": return ["checkin", "cancel"];
    case "arrived": return ["report_no_work", "cancel"];
    case "attendance_confirmed": {
      if (ctx.manifest) {
        if (o.loadedUnits == null) {
          // E3: by default the driver scans the parcels onto the vehicle; a warehouse that records the hand-over itself keeps the old wait.
          if (ctx.loadingMode === "warehouse") return ["report_no_work"];
          return [...(o.routeApprovedAt ? [] : ["scan_loading", ...((ctx.scanned ?? 0) > 0 ? ["finish_loading"] : [])]), "report_no_work"];
        }
        if (o.loadedAckByDriver == null) return ["ack_loading", "dispute_loading", "report_no_work"];
        if (o.loadedAckByDriver === false) return ["report_no_work"]; // waits for the warehouse to re-record
        if (!o.routeApprovedAt && ctx.routing !== false) return ["approve_route", "report_no_work"]; // routing off: no approval step — loading confirmed = straight to the stops
        return (ctx.remaining ?? 0) > 0 ? ["work_stops", "end_route"] : ["report_delivered"];
      }
      if (r.service === "delivery_driver" && o.loadedUnits != null && o.loadedAckByDriver == null) return ["ack_loading", "dispute_loading", "report_no_work"];
      if (r.service === "delivery_driver" && o.loadedUnits != null && o.loadedAckByDriver === false) return ["report_no_work"]; // waits for business to re-record
      return ["report_delivered", "report_no_work"];
    }
    default: return [];
  }
}

/**
 * Server-driven business actions. `ctx` keeps buttons honest: hand-over recording only for warehouses that record it (otherwise the driver scans),
 * returns can be received after the job is done, there is no delivery confirmation any more (E16), rating only once.
 */
export function businessActions(o: Offer, ctx: { service: string; rated?: boolean; manifest?: boolean; failedOpen?: number; recordsLoading?: boolean }): string[] {
  switch (o.status) {
    case "accepted": case "arrived": return ["confirm_attendance", "mark_no_show"];
    case "attendance_confirmed": {
      const hasShipments = SERVICE_MAP[ctx.service as ServiceKey]?.hasShipments;
      const record = hasShipments && !(ctx.manifest && o.routeApprovedAt) && (!ctx.manifest || ctx.recordsLoading);
      return [...(record ? ["record_loading"] : []), "handover_custody"];
    }
    case "delivered_reported": case "pending_settlement": case "qty_disputed": return (ctx.failedOpen ?? 0) > 0 ? ["confirm_returns"] : [];
    case "completed": return [...((ctx.failedOpen ?? 0) > 0 ? ["confirm_returns"] : []), ...(ctx.rated ? [] : ["rate"])];
    case "cancelled": return (ctx.failedOpen ?? 0) > 0 ? ["confirm_returns"] : []; // parcels that were on board when the request was cancelled still have to be received back
    default: return [];
  }
}

export async function businessRequestDetail(r: Request, viewer: User) {
  const rows = await db.select({ o: offers, u: users, p: driverProfiles }).from(offers).innerJoin(users, eq(users.id, offers.driverId)).innerJoin(driverProfiles, eq(driverProfiles.userId, users.id))
    .where(eq(offers.requestId, r.id)).orderBy(offers.createdAt);
  const staff = viewer.role !== "business";
  const mine = staff || !rows.length ? [] : await db.select({ offerId: ratings.offerId }).from(ratings).where(and(inArray(ratings.offerId, rows.map(({ o }) => o.id)), eq(ratings.raterId, viewer.id)));
  const rated = new Set(mine.map((m) => m.offerId));
  const manifest = await isManifestJob(db, r.id);
  const stats = manifest ? await offerShipmentStats(db, rows.map(({ o }) => o.id)) : new Map<string, { total: number; pending: number; loaded: number; delivered: number; failed: number; returned: number; missing: number }>();
  const ops = await effectiveOps(r.businessId);
  const cods = manifest ? await offerCodMap(db, rows.map(({ o }) => o.id)) : new Map<string, { collectedCents: number; receivedCents: number; outstandingCents: number }>();
  const list = rows.filter(({ o }) => staff || o.status !== "offered" ? true : false).map(({ o, u, p }) => {
    const accepted = (OFFER_BUSY as string[]).includes(o.status) || o.status === "completed";
    return {
      id: o.id, status: o.status, source: o.source, isReplacement: o.isReplacement, driver: { id: u.id, name: u.name, phone: staff ? (can(viewer, "drivers.sensitive") ? u.phone : maskPhone(u.phone)) : accepted ? u.phone : null, vehicleType: p.vehicleType, rating: avg(p.ratingSum, p.ratingCount), jobsCompleted: p.jobsCompleted },
      expectedUnits: o.expectedUnits, loadedUnits: o.loadedUnits, loadedAckByDriver: o.loadedAckByDriver, deliveredUnits: o.deliveredUnits, finalUnits: o.finalUnits, arrivedAt: o.arrivedAt, acceptedAt: o.acceptedAt,
      ratedByMe: rated.has(o.id), routeApprovedAt: o.routeApprovedAt, parcels: stats.get(o.id) ?? null,
      loading: manifest ? (() => { const st = stats.get(o.id); const total = st?.total ?? 0; return { mode: ops.requireLoadingRecord ? "warehouse" : "driver_scan", assigned: total, scanned: total - (st?.pending ?? 0), finished: o.loadedAckByDriver === true }; })() : null,
      cod: manifest ? (cods.get(o.id) ?? { collectedCents: 0, receivedCents: 0, outstandingCents: 0 }) : null,
      actions: staff && !can(viewer, "requests.edit") ? (can(viewer, "attendance.edit") ? businessActions(o, { service: r.service, manifest }).filter((a) => ["confirm_attendance", "mark_no_show"].includes(a)) : []) : businessActions(o, { service: r.service, rated: rated.has(o.id), manifest, failedOpen: stats.get(o.id)?.failed ?? 0, recordsLoading: ops.requireLoadingRecord }).filter((a) => !staff || !["rate", "handover_custody"].includes(a)), officeId: o.officeId,
    };
  });
  const offeredCount = rows.filter(({ o }) => o.status === "offered").length;
  const [pool] = manifest ? await db.select({ n: sql<number>`count(*)::int` }).from(shipments).where(and(eq(shipments.requestId, r.id), eq(shipments.status, "pending"), isNull(shipments.offerId))) : [{ n: 0 }];
  return { offers: list, offeredCount, manifest, unassignedParcels: pool.n, incompleteParcels: manifest && !(REQUEST_TERMINAL as string[]).includes(r.status) ? await incompleteCount(db, r.id) : 0 };
}

export async function timeline(requestId: string) {
  return db.select({ id: jobEvents.id, type: jobEvents.type, actorName: jobEvents.actorName, actorRole: jobEvents.actorRole, oldStatus: jobEvents.oldStatus, newStatus: jobEvents.newStatus, payload: jobEvents.payload, createdAt: jobEvents.createdAt, offerId: jobEvents.offerId })
    .from(jobEvents).where(eq(jobEvents.requestId, requestId)).orderBy(jobEvents.createdAt);
}

export function publicUser(u: User) {
  return { id: u.id, role: u.role, name: u.name, phone: u.phone, email: u.email, language: u.language, city: u.city, status: u.status, staffRole: u.staffRole, permissions: u.role === "admin" ? ["*"] : u.permissions, mustChangePassword: u.mustChangePassword, mfaEnabled: !!u.totpEnabledAt };
}
export function assertStaff(u: User) { if (!can(u, "requests.view")) throw err("FORBIDDEN"); }
export { inArray, and, desc, custodyItems, requests };
