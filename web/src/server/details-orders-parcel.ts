import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessProfiles, offers, requests, shipmentEvents, shipmentMedia, shipments, users, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { requirePerm } from "./auth/permissions";
import { UUID_RE, isoOrNull, maskPhone, moneyAccess, num, rowsOf, type Row } from "./details-orders";
import { buildAttempts, secBetween, withElapsed } from "./details-orders-lib";
import { offerCodMap } from "./cod";

const EVENT_MAX = 500;

/** Warehouse-system (partner) sync of one parcel: the incoming order, the write-back queue and the latest exchange. Nothing secret is stored in these tables. */
async function partnerSync(s: { id: string; partnerId: string | null; partnerStatus: string | null; partnerStatusAt: Date | null }) {
  const [order, outbox, events] = await Promise.all([
    rowsOf(sql`select o.id, o.provider, o.state, o.external_id, o.external_ref, o.awb, o.partner_status, o.partner_status_at, o.cancelled_at, o.cancel_reason, c.name connection_name, c.status connection_status from partner_orders o left join partner_connections c on c.id = o.connection_id where o.shipment_id = ${s.id}::uuid limit 1`),
    rowsOf(sql`select status, count(*)::int n, max(last_error) filter (where last_error is not null) last_error, max(sent_at) last_sent from partner_outbox where shipment_id = ${s.id}::uuid group by status`),
    rowsOf(sql`select id, direction, kind, outcome, summary, created_at from partner_events where shipment_id = ${s.id}::uuid order by created_at desc limit 10`),
  ]);
  if (!s.partnerId && !order[0] && !outbox.length && !events.length) return null;
  const o = order[0];
  return {
    connected: !!s.partnerId, partnerStatus: s.partnerStatus, partnerStatusAt: isoOrNull(s.partnerStatusAt),
    order: o ? { provider: o.provider, state: o.state, externalId: o.external_id, externalRef: o.external_ref, awb: o.awb, connection: o.connection_name, connectionStatus: o.connection_status, cancelledAt: isoOrNull(o.cancelled_at), cancelReason: o.cancel_reason } : null,
    outbox: outbox.map((x) => ({ status: x.status, n: num(x.n), lastError: x.last_error ?? null, lastSentAt: isoOrNull(x.last_sent) })),
    events: events.map((e) => ({ id: e.id, direction: e.direction, kind: e.kind, outcome: e.outcome, summary: e.summary, at: isoOrNull(e.created_at) })),
  };
}

/** One parcel, completely (`requests.view`): the record, the journey with elapsed times and actors, visits, evidence, recipient, location vs pin, OTP / SMS, cash, route leg, partner sync, similar parcels. */
export async function parcelDetail(user: User, id: string) {
  requirePerm(user, "requests.view");
  if (!UUID_RE.test(id)) throw err("NOT_FOUND", "Parcel not found");
  const acc = moneyAccess(user);
  const driver = users;
  const [row] = await db.select({ s: shipments, r: requests, biz: businessProfiles.companyName, bizName: users.name }).from(shipments)
    .innerJoin(requests, eq(requests.id, shipments.requestId)).innerJoin(users, eq(users.id, requests.businessId)).leftJoin(businessProfiles, eq(businessProfiles.userId, requests.businessId)).where(eq(shipments.id, id));
  if (!row) throw err("NOT_FOUND", "Parcel not found");
  const { s, r } = row;
  const [off] = s.offerId ? await db.select({ o: offers, name: driver.name, phone: driver.phone }).from(offers).innerJoin(driver, eq(driver.id, offers.driverId)).where(eq(offers.id, s.offerId)) : [];
  const [events, media, msgs, msgStats, prev, similarPhone, similarAddr, partner, cods, remits] = await Promise.all([
    db.select().from(shipmentEvents).where(eq(shipmentEvents.shipmentId, id)).orderBy(asc(shipmentEvents.createdAt)).limit(EVENT_MAX),
    db.select({ id: shipmentMedia.id, kind: shipmentMedia.kind, note: shipmentMedia.note, createdAt: shipmentMedia.createdAt, by: users.name }).from(shipmentMedia).leftJoin(users, eq(users.id, shipmentMedia.uploadedBy)).where(and(eq(shipmentMedia.shipmentId, id), isNotNull(shipmentMedia.usedAt))).orderBy(asc(shipmentMedia.createdAt)),
    rowsOf(sql`select id, channel, type, recipient, status, error, attempts, sent_at, created_at from message_log where shipment_id = ${id}::uuid order by created_at desc limit 50`),
    rowsOf(sql`select status, count(*)::int n from message_log where shipment_id = ${id}::uuid group by status`),
    s.offerId && s.stopOrder != null ? rowsOf(sql`select max(coalesce(delivered_at, failed_at)) at from shipments where offer_id = ${s.offerId}::uuid and stop_order < ${s.stopOrder} and (delivered_at is not null or failed_at is not null)`) : Promise.resolve([]),
    rowsOf(sql`select s2.id, s2.code, s2.status, s2.recipient_name, s2.created_at, s2.request_id, r2.ref from shipments s2 join requests r2 on r2.id = s2.request_id where s2.recipient_phone = ${s.recipientPhone} and s2.id <> ${id}::uuid order by s2.created_at desc limit 8`),
    rowsOf(sql`select s2.id, s2.code, s2.status, s2.recipient_name, s2.created_at, s2.request_id, r2.ref from shipments s2 join requests r2 on r2.id = s2.request_id where lower(s2.address) = lower(${s.address}) and s2.city = ${s.city} and s2.id <> ${id}::uuid order by s2.created_at desc limit 8`),
    partnerSync(s),
    s.offerId ? offerCodMap(db, [s.offerId]) : Promise.resolve(new Map()),
    s.offerId ? rowsOf(sql`select c.id, c.ref, c.amount_cents, c.created_at, ru.name received_by from cod_remittances c left join users ru on ru.id = c.received_by where c.offer_id = ${s.offerId}::uuid order by c.created_at desc limit 5`) : Promise.resolve([]),
  ]);
  const journey = withElapsed(events.map((e) => ({ id: e.id, type: e.type, createdAt: e.createdAt.toISOString(), actorName: e.actorName, actorRole: e.actorRole, offerId: e.offerId, payload: (e.payload ?? null) as Record<string, unknown> | null })));
  const count = (t: string) => events.filter((e) => e.type === t).length;
  const verified = events.find((e) => e.type === "otp_verified");
  const plan = (off?.o.routePlan ?? null) as Row | null;
  const planned = off && s.stopOrder != null;
  const cod = off ? cods.get(off.o.id) : null;
  const sensitive = acc.sensitive;
  return {
    parcel: {
      id: s.id, seq: s.seq, code: s.code, externalRef: s.externalRef, recipientType: s.recipientType, status: s.status, contents: s.contents, notes: s.notes, detailsComplete: s.detailsComplete,
      attempts: s.attempts, deferCount: s.deferCount, stopOrder: s.stopOrder, loadedVia: s.loadedVia, geoSource: s.geoSource, createdAt: isoOrNull(s.createdAt), updatedAt: isoOrNull(s.updatedAt),
      loadedAt: isoOrNull(s.loadedAt), arrivedAt: isoOrNull(s.arrivedAt), deliveredAt: isoOrNull(s.deliveredAt), failedAt: isoOrNull(s.failedAt), returnedAt: isoOrNull(s.returnedAt),
      failReason: s.failReason, failNote: s.failNote, proofType: s.proofType, receiverName: s.receiverName, hasProof: !!s.proofKey, notifiedAt: isoOrNull(s.notifiedAt),
    },
    recipient: { name: s.recipientName, phone: sensitive ? s.recipientPhone : maskPhone(s.recipientPhone), type: s.recipientType, address: s.address, city: s.city },
    location: {
      pin: s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null, delivered: sensitive && s.deliveredLat != null && s.deliveredLng != null ? { lat: s.deliveredLat, lng: s.deliveredLng } : null,
      deliveredHidden: !sensitive && s.deliveredLat != null, distanceM: s.deliveredDistanceM, geoSource: s.geoSource, sensitive,
    },
    request: { id: r.id, ref: r.ref, status: r.status, service: r.service, businessId: r.businessId, businessName: row.biz ?? row.bizName, pickupCity: r.pickupCity, deliveryCity: r.deliveryCity, startsAt: isoOrNull(r.startsAt), pickupLat: r.pickupLat, pickupLng: r.pickupLng },
    offer: off ? { id: off.o.id, status: off.o.status, driverId: off.o.driverId, driverName: off.name, officeId: off.o.officeId, routeApprovedAt: isoOrNull(off.o.routeApprovedAt) } : null,
    journey, attempts: buildAttempts(journey),
    media: media.map((m) => ({ id: m.id, kind: m.kind, note: m.note, createdAt: isoOrNull(m.createdAt), by: m.by })),
    otp: {
      sends: s.otpSends, resends: Math.max(0, s.otpVersion - 1), wrongAttempts: s.otpAttempts, sentEvents: count("otp_sent"), failedEvents: count("otp_failed"), notifyFailed: count("notify_failed"),
      verifiedAt: verified ? verified.createdAt.toISOString() : null, verifiedBy: verified?.actorName ?? null, lastSentAt: isoOrNull(events.filter((e) => e.type === "otp_sent").at(-1)?.createdAt),
    },
    messages: { stats: Object.fromEntries(msgStats.map((m) => [m.status, num(m.n)])), items: msgs.map((m) => ({ id: m.id, channel: m.channel, type: m.type, recipient: m.recipient, status: m.status, error: m.error, attempts: num(m.attempts), at: isoOrNull(m.sent_at ?? m.created_at) })) },
    cod: { dueCents: s.codCents, collectedCents: s.codCollectedCents, collectedAt: isoOrNull(s.codCollectedAt), collectedBy: s.codCollectedCents != null ? off?.name ?? null : null, offer: cod ? { collectedCents: cod.collectedCents, receivedCents: cod.receivedCents, outstandingCents: cod.outstandingCents } : null,
      remittances: remits.map((c) => ({ id: c.id, ref: c.ref, amountCents: num(c.amount_cents), receivedBy: c.received_by ?? null, createdAt: isoOrNull(c.created_at) })) },
    route: { stopOrder: s.stopOrder, plannedDistanceM: s.legDistanceM, plannedDurationS: s.legDurationS, actualLegS: planned ? secBetween(prev[0]?.at ?? off.o.routeApprovedAt, s.arrivedAt) : null, provider: plan?.provider ?? null, plannedAt: plan?.plannedAt ?? null, manual: plan?.manual === true, dwellS: secBetween(s.arrivedAt, s.deliveredAt ?? s.failedAt) },
    partner,
    similar: { byPhone: similarPhone.map(sim), byAddress: similarAddr.map(sim) },
  };
}
const sim = (x: Row) => ({ id: x.id, code: x.code, status: x.status, recipientName: x.recipient_name, requestId: x.request_id, requestRef: x.ref, createdAt: isoOrNull(x.created_at) });
