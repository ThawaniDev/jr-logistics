import { eq, inArray, and, desc } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, users, driverProfiles, businessProfiles, jobEvents, custodyItems, type Offer, type Request, type User } from "@/db/schema";
import { OFFER_BUSY } from "./catalog";
import { can } from "./auth/permissions";
import { err } from "@/lib/errors";

const avg = (sum: number, n: number) => (n ? Math.round((sum / n) * 10) / 10 : null);

/** What a driver may see. Exact addresses & recipient contact only once the job is theirs. */
export async function driverJobView(o: Offer, r: Request) {
  const mine = (OFFER_BUSY as string[]).includes(o.status) || o.status === "completed";
  const [biz] = await db.select({ name: users.name, c: businessProfiles.companyName }).from(users).leftJoin(businessProfiles, eq(businessProfiles.userId, users.id)).where(eq(users.id, r.businessId));
  const [p] = await db.select({ officeId: driverProfiles.officeId }).from(driverProfiles).where(eq(driverProfiles.userId, o.driverId));
  const earningHidden = !!(o.officeId ?? p?.officeId);
  return {
    offerId: o.id, requestId: r.id, ref: r.ref, service: r.service, status: o.status, requestStatus: r.status,
    isReplacement: o.isReplacement, business: biz?.c ?? biz?.name ?? null,
    vehicleType: r.vehicleType, temperature: r.temperature, pickupCity: r.pickupCity, deliveryCity: r.deliveryCity,
    startsAt: r.startsAt, durationDays: r.durationDays, expectedUnits: o.expectedUnits, shipmentsPerDriver: r.shipmentsPerDriver,
    expectedEarningCents: earningHidden ? null : o.expectedEarningCents, earningHidden, notes: r.notes, contents: mine ? r.contents : null,
    pickup: mine ? { address: r.pickupAddress, lat: r.pickupLat, lng: r.pickupLng } : null,
    delivery: mine ? { address: r.deliveryAddress, lat: r.deliveryLat, lng: r.deliveryLng } : null,
    recipient: mine && r.recipientPhone ? { name: r.recipientName, phone: r.recipientPhone } : null,
    loadedUnits: o.loadedUnits, loadedAckByDriver: o.loadedAckByDriver, deliveredUnits: o.deliveredUnits, finalUnits: o.finalUnits,
    acceptedAt: o.acceptedAt, arrivedAt: o.arrivedAt, cancelReason: o.cancelReason,
    actions: driverActions(o, r),
  };
}

/** Server-driven next actions so every client (web, Flutter) renders the same flow. */
export function driverActions(o: Offer, r: Request): string[] {
  switch (o.status) {
    case "offered": return ["accept", "reject"];
    case "accepted": return ["checkin", "cancel"];
    case "arrived": return ["cancel"];
    case "attendance_confirmed": {
      if (r.service === "delivery_driver" && o.loadedUnits != null && o.loadedAckByDriver == null) return ["ack_loading", "dispute_loading", "report_no_work"];
      if (r.service === "delivery_driver" && o.loadedUnits != null && o.loadedAckByDriver === false) return ["report_no_work"]; // waits for business to re-record
      return ["report_delivered", "report_no_work"];
    }
    default: return [];
  }
}

export function businessActions(o: Offer): string[] {
  switch (o.status) {
    case "accepted": case "arrived": return ["confirm_attendance", "mark_no_show"];
    case "attendance_confirmed": return ["record_loading", "handover_custody"];
    case "delivered_reported": return ["confirm_delivery", "dispute_delivery"];
    case "completed": return ["rate"];
    default: return [];
  }
}

export async function businessRequestDetail(r: Request, viewer: User) {
  const rows = await db.select({ o: offers, u: users, p: driverProfiles }).from(offers).innerJoin(users, eq(users.id, offers.driverId)).innerJoin(driverProfiles, eq(driverProfiles.userId, users.id))
    .where(eq(offers.requestId, r.id)).orderBy(offers.createdAt);
  const staff = viewer.role !== "business";
  const list = rows.filter(({ o }) => staff || o.status !== "offered" ? true : false).map(({ o, u, p }) => {
    const accepted = (OFFER_BUSY as string[]).includes(o.status) || o.status === "completed";
    return {
      id: o.id, status: o.status, source: o.source, isReplacement: o.isReplacement, driver: { id: u.id, name: u.name, phone: accepted || staff ? u.phone : null, vehicleType: p.vehicleType, rating: avg(p.ratingSum, p.ratingCount), jobsCompleted: p.jobsCompleted },
      expectedUnits: o.expectedUnits, loadedUnits: o.loadedUnits, loadedAckByDriver: o.loadedAckByDriver, deliveredUnits: o.deliveredUnits, finalUnits: o.finalUnits, arrivedAt: o.arrivedAt, acceptedAt: o.acceptedAt,
      actions: staff ? [] : businessActions(o), officeId: o.officeId,
    };
  });
  const offeredCount = rows.filter(({ o }) => o.status === "offered").length;
  return { offers: list, offeredCount };
}

export async function timeline(requestId: string) {
  return db.select({ id: jobEvents.id, type: jobEvents.type, actorName: jobEvents.actorName, actorRole: jobEvents.actorRole, oldStatus: jobEvents.oldStatus, newStatus: jobEvents.newStatus, payload: jobEvents.payload, createdAt: jobEvents.createdAt, offerId: jobEvents.offerId })
    .from(jobEvents).where(eq(jobEvents.requestId, requestId)).orderBy(jobEvents.createdAt);
}

export function publicUser(u: User) {
  return { id: u.id, role: u.role, name: u.name, phone: u.phone, email: u.email, language: u.language, city: u.city, status: u.status, staffRole: u.staffRole, permissions: u.role === "admin" ? ["*"] : u.permissions, mustChangePassword: u.mustChangePassword };
}
export function assertStaff(u: User) { if (!can(u, "requests.view")) throw err("FORBIDDEN"); }
export { inArray, and, desc, custodyItems, requests };
