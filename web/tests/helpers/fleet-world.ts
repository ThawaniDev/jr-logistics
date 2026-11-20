import { db } from "@/db";
import { codRemittances, complaints, driverAvailabilityLog, driverLocationHistory, offers, ratings, requests, settlements, shipments } from "@/db/schema";
import { mkAdmin, mkBusiness, mkDriver, mkOffice } from "./factories";

/**
 * The hand-computable world of the fleet-reports tests. Period `2026-05-10 … 2026-05-12` (Riyadh days; times below are UTC, Riyadh = UTC+3), late grace 30 minutes. The pickup pin
 * is the warehouse; every parcel's delivered pin is due north of it, 0.1° of latitude (11 119.49 m) per step.
 *
 *   Office O1 (drivers D1, D2) · Office O2 (nobody) · D3 works for nobody (independent)
 *   D1  offers: O11 accepted in 60 s, O12 in 180 s, O13 declined, O14 expired.   jobs O11 (R1, due 06:00) and O12 (R2, due 10:00)
 *   D2  offers: O21 (R3 due 06:00) 300 s, O22 (R4 due 10:00) 120 s, O23 (R1) accepted in 1800 s and then cancelled by the driver
 *   D3  offers: O31 (R5 due 06:00 on the 12th) 600 s, O32 expired
 */
export const DAYS = ["2026-05-10", "2026-05-11", "2026-05-12"] as const;
export const Q = "from=2026-05-10&to=2026-05-12&compare=none";
const z = (day: string, hm: string) => new Date(`${day}T${hm}:00Z`);
export const PIN = { lat: 24.7136, lng: 46.6753 };
const north = (steps: number) => ({ lat: PIN.lat + 0.1 * steps, lng: PIN.lng });
let seq = 0;

export async function seedFleetWorld() {
  const admin = await mkAdmin();
  const biz = await mkBusiness({ name: "Fleet Co" });
  const o1 = await mkOffice(), o2 = await mkOffice();
  const d1 = await mkDriver({ officeId: o1.id, name: "Driver One" }), d2 = await mkDriver({ officeId: o1.id, name: "Driver Two" }), d3 = await mkDriver({ name: "Driver Three" });
  const [d10, d11, d12] = DAYS;

  const req = async (startsAt: Date) => (await db.insert(requests).values({
    ref: `FL-${++seq}`, businessId: biz.id, service: "delivery_driver", quantity: 1, pickupCity: "riyadh", deliveryCity: "riyadh", startsAt, status: "completed", pickupLat: PIN.lat, pickupLng: PIN.lng,
  }).returning())[0];
  const [r1, r2, r3, r4, r5] = [await req(z(d10, "06:00")), await req(z(d10, "10:00")), await req(z(d11, "06:00")), await req(z(d11, "10:00")), await req(z(d12, "06:00"))];

  const offer = async (requestId: string, driver: { id: string }, officeId: string | null, o: Partial<typeof offers.$inferInsert>) => (await db.insert(offers).values({
    requestId, driverId: driver.id, officeId, status: "completed", expectedUnits: 4, expectedEarningCents: 1000, ...o,
  }).returning())[0];
  const o11 = await offer(r1.id, d1, o1.id, { createdAt: z(d10, "04:00"), acceptedAt: z(d10, "04:01"), arrivedAt: z(d10, "05:50"), attendanceAt: z(d10, "05:55"), loadedAt: z(d10, "06:05"), routeApprovedAt: z(d10, "06:10"), deliveredAt: z(d10, "07:55"), finalAt: z(d10, "08:00") });
  const o12 = await offer(r2.id, d1, o1.id, { createdAt: z(d10, "05:00"), acceptedAt: z(d10, "05:03"), arrivedAt: z(d10, "10:20"), attendanceAt: z(d10, "10:30"), loadedAt: z(d10, "10:50"), routeApprovedAt: z(d10, "10:55"), finalAt: z(d10, "12:00") });
  const o13 = await offer(r3.id, d1, o1.id, { status: "rejected", createdAt: z(d11, "04:00") });
  const o14 = await offer(r4.id, d1, o1.id, { status: "expired", createdAt: z(d11, "04:00") });
  const o21 = await offer(r3.id, d2, o1.id, { createdAt: z(d11, "04:00"), acceptedAt: z(d11, "04:05"), arrivedAt: z(d11, "06:45"), loadedAt: z(d11, "07:00"), finalAt: z(d11, "09:00") });
  const o22 = await offer(r4.id, d2, o1.id, { createdAt: z(d11, "04:00"), acceptedAt: z(d11, "04:02"), arrivedAt: z(d11, "10:00"), loadedAt: z(d11, "10:30"), finalAt: z(d11, "12:30") });
  const o23 = await offer(r1.id, d2, o1.id, { status: "cancelled", createdAt: z(d10, "04:00"), acceptedAt: z(d10, "04:30"), cancelledAt: z(d10, "05:00") });
  const o31 = await offer(r5.id, d3, null, { createdAt: z(d12, "03:00"), acceptedAt: z(d12, "03:10"), arrivedAt: z(d12, "05:30"), finalAt: z(d12, "07:00") });
  const o32 = await offer(r1.id, d3, null, { status: "expired", createdAt: z(d10, "04:00") });

  const parcel = async (r: { id: string }, o: { id: string }, p: Partial<typeof shipments.$inferInsert>) => (await db.insert(shipments).values({
    requestId: r.id, offerId: o.id, seq: ++seq, code: `FLP-${seq}`, recipientName: "Customer", recipientPhone: "0500000000", address: "Olaya St", city: "riyadh", status: "delivered", ...p,
  }).returning())[0];
  const at = (steps: number) => ({ deliveredLat: north(steps).lat, deliveredLng: north(steps).lng });
  // O11 (D1): three delivered (the third on its second attempt, by receipt), one refused
  const p1 = await parcel(r1, o11, { loadedAt: z(d10, "06:05"), arrivedAt: z(d10, "06:55"), deliveredAt: z(d10, "07:00"), ...at(1), attempts: 1, deferCount: 1, proofType: "otp", legDistanceM: 1000, codCents: 5000, codCollectedCents: 5000, codCollectedAt: z(d10, "07:00") });
  await parcel(r1, o11, { loadedAt: z(d10, "06:05"), arrivedAt: z(d10, "07:10"), deliveredAt: z(d10, "07:20"), ...at(2), attempts: 1, proofType: "otp", legDistanceM: 2000 });
  await parcel(r1, o11, { loadedAt: z(d10, "06:05"), arrivedAt: z(d10, "07:45"), deliveredAt: z(d10, "07:55"), ...at(3), attempts: 2, proofType: "receipt" });
  await parcel(r1, o11, { status: "failed", loadedAt: z(d10, "06:05"), arrivedAt: z(d10, "07:30"), failedAt: z(d10, "07:40"), failReason: "refused", attempts: 1 });
  // O12 (D1): one delivered, one returned (closed), one still loaded (no outcome yet)
  await parcel(r2, o12, { loadedAt: z(d10, "10:50"), arrivedAt: z(d10, "11:20"), deliveredAt: z(d10, "11:30"), ...at(1), attempts: 1, proofType: "otp", legDistanceM: 500 });
  await parcel(r2, o12, { status: "returned", loadedAt: z(d10, "10:50"), failedAt: z(d10, "11:40"), returnedAt: z(d10, "11:45"), failReason: "closed", attempts: 1 });
  await parcel(r2, o12, { status: "loaded", loadedAt: z(d10, "10:50") });
  // O21, O22 (D2): three delivered, one with cash to collect (8000, collected)
  await parcel(r3, o21, { loadedAt: z(d11, "07:00"), arrivedAt: z(d11, "07:50"), deliveredAt: z(d11, "08:00"), ...at(1), attempts: 1, proofType: "otp" });
  await parcel(r3, o21, { loadedAt: z(d11, "07:00"), arrivedAt: z(d11, "08:20"), deliveredAt: z(d11, "08:30"), ...at(1), attempts: 3, proofType: "otp", codCents: 8000, codCollectedCents: 8000, codCollectedAt: z(d11, "08:30") });
  await parcel(r4, o22, { loadedAt: z(d11, "10:30"), arrivedAt: z(d11, "10:55"), deliveredAt: z(d11, "11:00"), ...at(2), attempts: 1, proofType: "otp" });
  // O31 (D3): two delivered (never loaded through the warehouse), one wrong address
  await parcel(r5, o31, { arrivedAt: z(d12, "06:25"), deliveredAt: z(d12, "06:30"), ...at(1), attempts: 1, proofType: "otp" });
  await parcel(r5, o31, { arrivedAt: z(d12, "06:30"), deliveredAt: z(d12, "06:40"), ...at(1), attempts: 1, proofType: "otp" });
  await parcel(r5, o31, { status: "failed", arrivedAt: z(d12, "06:45"), failedAt: z(d12, "06:50"), failReason: "wrong_address", attempts: 1 });

  await db.insert(ratings).values([{ offerId: o11.id, raterId: biz.id, rateeId: d1.id, stars: 5, createdAt: z(d10, "09:00") }, { offerId: o12.id, raterId: biz.id, rateeId: d1.id, stars: 3, createdAt: z(d10, "13:00") }]);
  const complaint = (filedBy: { id: string }, role: string, o: { id: string; requestId: string }, status: string) => db.insert(complaints).values({
    ref: `FLC-${++seq}`, filedBy: filedBy.id, filedByRole: role, requestId: o.requestId, offerId: o.id, category: "delay", description: "x", status, createdAt: z(d10, "14:00"),
  });
  await complaint(biz, "business", o12, "open"); await complaint(d1, "driver", o11, "open"); await complaint(biz, "business", o21, "resolved");

  const log = (driver: { id: string }, from: string, to: string, day: string, endDay = day) => db.insert(driverAvailabilityLog).values([
    { driverId: driver.id, fromStatus: "unavailable", toStatus: "available", source: "driver", reason: "manual", at: z(day, from) }, { driverId: driver.id, fromStatus: "available", toStatus: "unavailable", source: "driver", reason: "manual", at: z(endDay, to) }]);
  await log(d1, "05:00", "13:00", d10); await log(d1, "05:00", "08:00", d11); await log(d2, "05:00", "11:00", d11); await log(d3, "04:00", "10:00", d12);
  await db.insert(driverAvailabilityLog).values({ driverId: d2.id, fromStatus: "available", toStatus: "unavailable", source: "system", reason: "cancel_strikes", at: z(d11, "12:00") });

  const money = (o: { id: string; requestId: string }, driver: { id: string }, officeId: string | null, v: [customer: number, provider: number, margin: number, vat: number], x: Partial<typeof settlements.$inferInsert>) => db.insert(settlements).values({
    requestId: o.requestId, offerId: o.id, driverId: driver.id, officeId, businessId: biz.id, finalUnits: 4, reservedCents: v[0], customerCents: v[0], providerCents: v[1], marginCents: v[2], vatCents: v[3], refundCents: 0, ...x,
  });
  await money(o11, d1, o1.id, [3000, 2100, 900, 450], { status: "paid", createdAt: z(d10, "09:00"), paidAt: z(d11, "09:00") });
  await money(o12, d1, o1.id, [2000, 1400, 600, 300], { status: "approved", createdAt: z(d10, "13:00"), refundCents: 100, adjustmentCents: 50 });
  await money(o21, d2, o1.id, [2500, 1750, 750, 375], { status: "paid", createdAt: z(d11, "10:00"), paidAt: z(d12, "10:00") });
  await money(o22, d2, o1.id, [1000, 700, 300, 150], { status: "pending_review", createdAt: z(d11, "13:00") });
  await money(o31, d3, null, [1500, 1050, 450, 225], { status: "paid", createdAt: z(d12, "09:00"), paidAt: z(d12, "12:00") });
  await db.insert(codRemittances).values({ ref: "FLR-1", requestId: r1.id, offerId: o11.id, driverId: d1.id, businessId: biz.id, amountCents: 3000, receivedBy: admin.id, receivedByRole: "admin", createdAt: z(d11, "10:00") });

  // D1's GPS track on the 10th: A → B → C count; the fix at 07:30 is 20 minutes later and the next one 11 km away (both dropped); the 400 m-accuracy fix is dropped before pairing
  const fix = (lat: number, lng: number, m: number, accuracyM: number | null = 10) => ({ driverId: d1.id, lat, lng, accuracyM, recordedAt: new Date(z(d10, "07:00").getTime() + m * 60_000) });
  const A = { lat: PIN.lat, lng: PIN.lng }, B = { lat: PIN.lat + 0.01, lng: PIN.lng }, C = { lat: PIN.lat + 0.01, lng: PIN.lng + 0.01 };
  await db.insert(driverLocationHistory).values([fix(A.lat, A.lng, 0), fix(24.9, 46.9, 2, 400), fix(B.lat, B.lng, 5), fix(C.lat, C.lng, 10), fix(C.lat + 0.1, C.lng, 30), fix(C.lat + 0.2, C.lng, 35)]);

  return { admin, biz, o1, o2, d1, d2, d3, r1, r2, r3, r4, r5, o11, o12, o13, o14, o21, o22, o23, o31, o32, p1, track: { A, B, C } };
}
