import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { defineRoutes } from "../router";
import { uuid } from "../schemas";
import { db } from "@/db";
import { offers, requests, driverProfiles, jobEvents } from "@/db/schema";
import { err } from "@/lib/errors";
import { OFFER_BUSY } from "@/server/catalog";
import * as jobs from "@/server/jobs";
import { driverJobView } from "@/server/views";
import { evaluateCandidates, backfillOffersForDriver } from "@/server/matching";
import { clearDriverLocation, updateDriverLocation } from "@/server/ops";
import { myInvites, respondInvite } from "@/server/office";
import { optimizeRoute, whatsappLink, type WaKind } from "@/server/routing";
import { logEvent } from "@/server/events";
import { DEFAULT_CITIES } from "@/server/catalog";
import { getSettings } from "@/server/settings";
import { normalizePhone } from "@/lib/phone";
import { settlements } from "@/db/schema";
import { ensureAccount } from "@/server/wallet";

const drv = ["driver"] as const;
const jobFor = async (driverId: string, offerId: string) => {
  const [row] = await db.select({ o: offers, r: requests }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).where(and(eq(offers.id, offerId), eq(offers.driverId, driverId)));
  if (!row) throw err("NOT_FOUND", "Job not found");
  return row;
};

defineRoutes([
  { method: "GET", path: "/driver/overview", auth: [...drv], handler: async ({ user }) => {
    const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, user.id));
    const acct = await ensureAccount(user.id);
    const active = await db.select({ n: sql<number>`count(*)::int` }).from(offers).where(and(eq(offers.driverId, user.id), inArray(offers.status, OFFER_BUSY)));
    const newOffers = await db.select({ n: sql<number>`count(*)::int` }).from(offers).where(and(eq(offers.driverId, user.id), eq(offers.status, "offered")));
    const [pending] = await db.select({ s: sql<number>`coalesce(sum(${settlements.providerCents}),0)::int` }).from(settlements).where(and(eq(settlements.driverId, user.id), sql`${settlements.officeId} is null`, inArray(settlements.status, ["pending_review", "reviewed", "approved", "failed"])));
    return {
      availability: p?.availability, verificationStatus: p?.verificationStatus, suspendedUntil: p?.suspendedUntil, officeLinked: p?.officeLinkStatus === "linked", jobsCompleted: p?.jobsCompleted ?? 0,
      rating: p?.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : null, activeJobs: active[0].n, newOffers: newOffers[0].n,
      wallet: { availableCents: acct.availableCents, heldCents: acct.heldCents, pendingCents: pending.s },
    };
  } },
  { method: "PUT", path: "/driver/availability", auth: [...drv], body: z.object({ available: z.boolean() }), handler: async ({ user, input }) => {
    if (input.available) {
      const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, user.id));
      if (p?.suspendedUntil && p.suspendedUntil > new Date()) throw err("NOT_ELIGIBLE", "Your account is temporarily suspended", { until: p.suspendedUntil });
    } else await clearDriverLocation(user);
    await db.update(driverProfiles).set({ availability: input.available ? "available" : "unavailable" }).where(eq(driverProfiles.userId, user.id));
    const newOffers = input.available ? await backfillOffersForDriver(user.id) : 0;
    return { availability: input.available ? "available" : "unavailable", newOffers };
  } },
  { method: "POST", path: "/driver/location", auth: [...drv], body: z.object({ lat: z.number(), lng: z.number() }), handler: async ({ user, input }) => { await updateDriverLocation(user, input.lat, input.lng); return { ok: true }; } },
  { method: "DELETE", path: "/driver/location", auth: [...drv], handler: async ({ user }) => { await clearDriverLocation(user); return { ok: true }; } },

  // Offers directed at me
  { method: "GET", path: "/driver/offers", auth: [...drv], handler: async ({ user }) => {
    const rows = await db.select({ o: offers, r: requests }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId))
      .where(and(eq(offers.driverId, user.id), eq(offers.status, "offered"), inArray(requests.status, ["published", "filling"]))).orderBy(requests.startsAt);
    return { items: await Promise.all(rows.map(({ o, r }) => driverJobView(o, r))) };
  } },
  // Open requests I could apply to (no offer yet)
  { method: "GET", path: "/driver/opportunities", auth: [...drv], handler: async ({ user }) => {
    const open = await db.select().from(requests).where(and(inArray(requests.status, ["published", "filling"]), sql`${requests.slotsFilled} < ${requests.quantity}`, sql`${requests.service} <> 'car_without_driver'`)).orderBy(requests.startsAt).limit(40);
    const mine = await db.select({ r: offers.requestId }).from(offers).where(eq(offers.driverId, user.id));
    const have = new Set(mine.map((m) => m.r));
    const out = [];
    for (const r of open) {
      if (have.has(r.id)) continue;
      if (r.preferredOfficeId && r.officeWindowEndsAt && r.officeWindowEndsAt > new Date()) continue;
      const [c] = await evaluateCandidates(db, r, { driverIds: [user.id] });
      if (!c || c.reasons.length) continue;
      const snap = r.pricingSnapshot as { providerCostCents: number; expectedUnits: number } | null;
      const [p] = await db.select({ o: driverProfiles.officeId }).from(driverProfiles).where(eq(driverProfiles.userId, user.id));
      out.push({ requestId: r.id, ref: r.ref, service: r.service, vehicleType: r.vehicleType, pickupCity: r.pickupCity, deliveryCity: r.deliveryCity, startsAt: r.startsAt, durationDays: r.durationDays, expectedUnits: snap?.expectedUnits ?? null, expectedEarningCents: p?.o || !snap ? null : snap.providerCostCents * snap.expectedUnits, openSlots: r.quantity - r.slotsFilled });
    }
    return { items: out };
  } },
  { method: "POST", path: "/driver/requests/:id/apply", auth: [...drv], body: z.object({ termsAccepted: z.boolean() }), handler: ({ user, params, input }) => jobs.applyToRequest(user, params.id, input.termsAccepted) },

  // My jobs
  { method: "GET", path: "/driver/jobs", auth: [...drv], query: z.object({ scope: z.enum(["active", "history"]).default("active") }), handler: async ({ user, q }) => {
    const states = q.scope === "active" ? OFFER_BUSY : ["completed", "cancelled", "no_show", "rejected", "replaced"];
    const rows = await db.select({ o: offers, r: requests }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).where(and(eq(offers.driverId, user.id), inArray(offers.status, states as never))).orderBy(q.scope === "active" ? requests.startsAt : desc(offers.updatedAt)).limit(100);
    return { items: await Promise.all(rows.map(({ o, r }) => driverJobView(o, r))) };
  } },
  { method: "GET", path: "/driver/jobs/:id", auth: [...drv], handler: async ({ user, params }) => { const { o, r } = await jobFor(user.id, params.id); return driverJobView(o, r); } },
  { method: "POST", path: "/offers/:id/accept", auth: [...drv], body: z.object({ termsAccepted: z.boolean() }), handler: ({ user, params, input }) => jobs.acceptOffer(user, params.id, input.termsAccepted) },
  { method: "POST", path: "/offers/:id/reject", auth: [...drv], handler: ({ user, params }) => jobs.rejectOffer(user, params.id) },
  { method: "POST", path: "/offers/:id/checkin", auth: [...drv], body: z.object({ lat: z.number().optional(), lng: z.number().optional() }), handler: ({ user, params, input }) => jobs.checkIn(user, params.id, input) },
  { method: "POST", path: "/offers/:id/loading-ack", auth: [...drv], body: z.object({ ok: z.boolean(), note: z.string().max(300).optional() }), handler: ({ user, params, input }) => jobs.acknowledgeLoading(user, params.id, input.ok, input.note) },
  { method: "POST", path: "/offers/:id/delivered", auth: [...drv], body: z.object({ units: z.number().int().min(0).max(100000) }), handler: ({ user, params, input }) => jobs.reportDelivered(user, params.id, input.units) },
  { method: "POST", path: "/offers/:id/cancel", auth: [...drv], body: z.object({ reason: z.string().min(3).max(300) }), handler: ({ user, params, input }) => jobs.driverCancel(user, params.id, input.reason) },
  { method: "POST", path: "/offers/:id/no-work", auth: [...drv], status: 201, body: z.object({ note: z.string().max(500).optional() }), handler: async ({ user, params, input }) => {
    const { o, r } = await jobFor(user.id, params.id);
    return db.transaction((tx) => jobs.openTicket(tx, user, { category: "not_put_to_work", subject: `${r.ref}: not put to work`, requestId: r.id, offerId: o.id, body: input.note }));
  } },
  { method: "POST", path: "/custody/:id/acknowledge", auth: [...drv], handler: async ({ user, params }) => (await import("@/server/support")).acknowledgeCustody(user, params.id) },

  // Office link
  { method: "GET", path: "/driver/invites", auth: [...drv], handler: async ({ user }) => ({ items: (await myInvites(user)).map((r) => ({ ...r.inv, officeName: r.office })) }) },
  { method: "POST", path: "/driver/invites/:id/respond", auth: [...drv], body: z.object({ accept: z.boolean() }), handler: ({ user, params, input }) => respondInvite(user, params.id, input.accept) },

  // Routing & WhatsApp hand-off (mobile)
  { method: "POST", path: "/driver/route/optimize", auth: [...drv], body: z.object({ origin: z.object({ lat: z.number(), lng: z.number() }), offerIds: z.array(uuid).min(1).max(25) }), handler: async ({ user, input }) => {
    const rows = await db.select({ o: offers, r: requests }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).where(and(eq(offers.driverId, user.id), inArray(offers.id, input.offerIds), inArray(offers.status, OFFER_BUSY)));
    if (rows.length !== input.offerIds.length) throw err("NOT_FOUND", "One or more jobs are not active for you");
    const s = await getSettings();
    const stops = rows.map(({ o, r }) => {
      let lat = r.deliveryLat, lng = r.deliveryLng;
      if (lat == null || lng == null) { const c = s.cities.find((x) => x.key === r.deliveryCity) ?? DEFAULT_CITIES[0]; lat = c.lat; lng = c.lng; }
      return { id: o.id, lat, lng, label: r.ref };
    });
    return optimizeRoute(input.origin, stops);
  } },
  { method: "GET", path: "/driver/jobs/:id/whatsapp", auth: [...drv], query: z.object({ kind: z.enum(["contact", "arriving", "issue"]).default("contact"), lang: z.enum(["ar", "en", "ur"]).optional() }), handler: async ({ user, params, q }) => {
    const { o, r } = await jobFor(user.id, params.id);
    if (!(OFFER_BUSY as string[]).includes(o.status)) throw err("FORBIDDEN", "Contact details are available while the job is active");
    if (!r.recipientPhone) throw err("NOT_FOUND", "No recipient contact on this job");
    const link = whatsappLink(q.lang ?? user.language, q.kind as WaKind, { name: r.recipientName ?? "", ref: r.ref, phone: normalizePhone(r.recipientPhone) ?? r.recipientPhone }); // defensive: legacy rows
    await logEvent(db, { requestId: r.id, offerId: o.id, actor: user, type: "whatsapp_handoff_opened", payload: { kind: q.kind } }); // initiation only — no delivery/read state exists
    return { ...link, note: "Opens WhatsApp with a prefilled message. You must press send in WhatsApp; JR Logistics cannot see delivery or replies." };
  } },
  { method: "POST", path: "/driver/jobs/:id/contact-exception", auth: [...drv], status: 201, body: z.object({ reason: z.enum(["no_answer", "wrong_number", "refused", "other"]), note: z.string().max(500).optional() }), handler: async ({ user, params, input }) => {
    const { o, r } = await jobFor(user.id, params.id);
    return db.transaction(async (tx) => {
      await logEvent(tx, { requestId: r.id, offerId: o.id, actor: user, type: "contact_exception", payload: input });
      return jobs.openTicket(tx, user, { category: "attendance_issue", subject: `${r.ref}: contact problem (${input.reason})`, requestId: r.id, offerId: o.id, body: input.note });
    });
  } },
]);
export { jobEvents };
