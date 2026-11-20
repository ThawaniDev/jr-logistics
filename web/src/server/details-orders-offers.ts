import { asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { driverProfiles, offers, officeProfiles, users, type User } from "@/db/schema";
import { loadOrder, isoOrNull, maskPhone, moneyAccess, num, numOrNull, rowsOf, type Row } from "./details-orders";
import { offerSteps, rate, secBetween } from "./details-orders-lib";
import { distanceM } from "./shipments";
import { effectiveOps, pickupPinOf } from "./warehouse";
import { offerCodMap } from "./cod";

/** One detailed card per driver offer of an order: who, how it went step by step, arrival / loading / route facts, parcels, cash, rating, chat. */
export async function orderOffers(user: User, id: string) {
  const r = await loadOrder(user, id);
  const acc = moneyAccess(user);
  const att = alias(users, "att"), ou = alias(users, "ou");
  const [rows, pin, ops] = await Promise.all([
    db.select({ o: offers, dName: users.name, dPhone: users.phone, p: driverProfiles, officeName: sql<string | null>`coalesce(${officeProfiles.officeName}, ${ou.name})`, attName: att.name })
      .from(offers).innerJoin(users, eq(users.id, offers.driverId)).innerJoin(driverProfiles, eq(driverProfiles.userId, users.id))
      .leftJoin(ou, eq(ou.id, offers.officeId)).leftJoin(officeProfiles, eq(officeProfiles.userId, offers.officeId)).leftJoin(att, eq(att.id, offers.attendanceBy))
      .where(eq(offers.requestId, r.id)).orderBy(asc(offers.createdAt)),
    pickupPinOf(r), effectiveOps(r.businessId),
  ]);
  const ids = rows.map(({ o }) => o.id);
  const [pstats, chat, rating, cods] = ids.length ? await Promise.all([
    rowsOf(sql`select offer_id, count(*)::int total, count(*) filter (where status = 'pending')::int pending, count(*) filter (where status = 'loaded')::int on_board, count(*) filter (where status = 'delivered')::int delivered,
        count(*) filter (where status = 'failed')::int failed, count(*) filter (where status = 'returned')::int returned, count(*) filter (where status = 'missing')::int missing,
        count(*) filter (where loaded_via = 'driver_scan')::int via_scan, count(*) filter (where loaded_via = 'warehouse')::int via_warehouse, coalesce(sum(defer_count), 0)::int defers,
        count(*) filter (where status = 'delivered' and attempts <= 1)::int first_attempt, min(loaded_at) first_loaded, max(loaded_at) last_loaded,
        avg(extract(epoch from (delivered_at - arrived_at))) filter (where status = 'delivered' and arrived_at is not null)::float8 avg_dwell_s, min(delivered_at) first_delivered, max(coalesce(delivered_at, failed_at)) last_outcome,
        count(*) filter (where lat is null or lng is null)::int no_coords
      from shipments where request_id = ${r.id}::uuid and offer_id is not null group by offer_id`),
    rowsOf(sql`select offer_id, count(*)::int n, max(created_at) last_at from messages where request_id = ${r.id}::uuid group by offer_id`),
    rowsOf(sql`select offer_id, stars, comment, created_at from ratings rt where rt.offer_id in (select id from offers where request_id = ${r.id}::uuid) and rt.ratee_id = (select driver_id from offers where id = rt.offer_id)`),
    offerCodMap(db, ids),
  ]) : [[], [], [], new Map()];
  const by = (list: Row[]) => new Map(list.map((x) => [x.offer_id as string, x]));
  const ps = by(pstats as Row[]), ch = by(chat as Row[]), rt = by(rating as Row[]);
  const items = rows.map(({ o, dName, dPhone, p, officeName, attName }) => {
    const s = ps.get(o.id);
    const total = num(s?.total), delivered = num(s?.delivered), failed = num(s?.failed), returned = num(s?.returned), pending = num(s?.pending);
    const plan = (o.routePlan ?? null) as Row | null;
    const dist = o.arrivedLat != null && o.arrivedLng != null && pin ? distanceM({ lat: o.arrivedLat, lng: o.arrivedLng }, pin) : null;
    const late = secBetween(r.startsAt, o.arrivedAt);
    const cod = cods.get(o.id) ?? { collectedCents: 0, receivedCents: 0, outstandingCents: 0 };
    return {
      id: o.id, status: o.status, source: o.source, isReplacement: o.isReplacement, replacesOfferId: o.replacesOfferId,
      driver: { id: o.driverId, name: dName, phone: acc.sensitive ? dPhone : maskPhone(dPhone), vehicleType: p.vehicleType, plate: acc.sensitive ? p.vehiclePlate : null, rating: p.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : null, ratingCount: p.ratingCount, jobsCompleted: p.jobsCompleted },
      officeId: o.officeId, office: o.officeId ? { id: o.officeId, name: officeName } : null,
      expectedUnits: o.expectedUnits, loadedUnits: o.loadedUnits, deliveredUnits: o.deliveredUnits, finalUnits: o.finalUnits, loadedAckByDriver: o.loadedAckByDriver,
      expectedEarningCents: acc.finance ? o.expectedEarningCents : null,
      createdAt: isoOrNull(o.createdAt), acceptedAt: isoOrNull(o.acceptedAt), arrivedAt: isoOrNull(o.arrivedAt), loadedAt: isoOrNull(o.loadedAt), routeApprovedAt: isoOrNull(o.routeApprovedAt), deliveredAt: isoOrNull(o.deliveredAt), finalAt: isoOrNull(o.finalAt), cancelledAt: isoOrNull(o.cancelledAt), cancelReason: o.cancelReason,
      steps: offerSteps({ createdAt: o.createdAt, acceptedAt: o.acceptedAt, arrivedAt: o.arrivedAt, attendanceAt: o.attendanceAt, loadedAt: o.loadedAt ?? s?.first_loaded, routeApprovedAt: o.routeApprovedAt, deliveredAt: o.deliveredAt, finalAt: o.finalAt, cancelledAt: o.cancelledAt, status: o.status }),
      responseS: secBetween(o.createdAt, o.acceptedAt),
      arrival: { at: isoOrNull(o.arrivedAt), lateMin: late == null ? null : Math.round(late / 60), distanceM: dist, pinKnown: !!pin, lat: acc.sensitive ? o.arrivedLat : null, lng: acc.sensitive ? o.arrivedLng : null },
      attendance: { at: isoOrNull(o.attendanceAt), byName: attName ?? null },
      loading: { mode: ops.requireLoadingRecord ? "warehouse" : "driver_scan", assigned: total, scanned: total - pending, unscanned: pending, viaScan: num(s?.via_scan), viaWarehouse: num(s?.via_warehouse), finished: o.loadedAckByDriver === true, durationS: secBetween(s?.first_loaded, s?.last_loaded), firstAt: isoOrNull(s?.first_loaded), lastAt: isoOrNull(s?.last_loaded) },
      routePlan: plan,
      route: plan ? { provider: plan.provider ?? null, plannedAt: plan.plannedAt ?? null, by: plan.by ?? null, manual: plan.manual === true, distanceM: numOrNull(plan.totalDistanceM), durationS: numOrNull(plan.totalDurationS), stops: numOrNull(plan.stops), unlocated: numOrNull(plan.unlocated), warnings: Array.isArray(plan.warnings) ? plan.warnings.length : 0, approvedAt: isoOrNull(o.routeApprovedAt) } : null,
      parcels: { total, pending, onBoard: num(s?.on_board), delivered, failed, returned, missing: num(s?.missing), defers: num(s?.defers), noCoords: num(s?.no_coords), successRate: rate(delivered, delivered + failed + returned), firstAttemptRate: rate(num(s?.first_attempt), delivered), avgDwellS: numOrNull(s?.avg_dwell_s), firstDeliveredAt: isoOrNull(s?.first_delivered), lastOutcomeAt: isoOrNull(s?.last_outcome) },
      cod: { collectedCents: cod.collectedCents, receivedCents: cod.receivedCents, outstandingCents: cod.outstandingCents },
      rating: rt.get(o.id) ? { stars: num(rt.get(o.id)!.stars), comment: rt.get(o.id)!.comment ?? null, at: isoOrNull(rt.get(o.id)!.created_at) } : null,
      chat: { count: num(ch.get(o.id)?.n), lastAt: isoOrNull(ch.get(o.id)?.last_at) },
    };
  });
  return {
    request: { id: r.id, ref: r.ref, status: r.status, service: r.service, startsAt: r.startsAt.toISOString(), businessId: r.businessId, pickup: pin },
    sensitive: acc.sensitive, manifest: items.some((i) => i.parcels.total > 0) || r.service === "delivery_driver", items,
  };
}
