import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { defineRoutes } from "../router";
import { uuid } from "../schemas";
import { db } from "@/db";
import { offers, requests, driverProfiles, jobEvents, shipments } from "@/db/schema";
import { err } from "@/lib/errors";
import { OFFER_BUSY } from "@/server/catalog";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { currentStopOf, manifestFacts } from "@/server/shipments";
import { driverJobView } from "@/server/views";
import { evaluateCandidatesMany, backfillOffersForDriver, activeJobs } from "@/server/matching";
import { getSettings } from "@/server/settings";
import { driverCash, driverCashOutstanding } from "@/server/cod";
import { scanLoad, unscanLoad, finishLoading } from "@/server/loading";
import { reorderOfferRoute, routeGeometry } from "@/server/route-plan";
import { isRoutingOn } from "@/server/routing-mode";
import { clearDriverLocation, updateDriverLocation } from "@/server/ops";
import { myInvites, respondInvite } from "@/server/office";
import { whatsappLink, type WaKind } from "@/server/routing";
import { logEvent } from "@/server/events";
import { normalizePhone } from "@/lib/phone";
import { settlements } from "@/db/schema";
import { ensureAccount } from "@/server/wallet";
import { overviewWalletFields, walletPolicy } from "@/server/driver-wallet-policy";
import { withStats } from "@/server/driver-job-stats";
import { recordAvailability, recordLocation } from "@/server/data-capture";

const drv = ["driver"] as const;
const jobFor = async (driverId: string, offerId: string) => {
  const [row] = await db.select({ o: offers, r: requests }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).where(and(eq(offers.id, offerId), eq(offers.driverId, driverId)));
  if (!row) throw err("NOT_FOUND", "Job not found");
  return row;
};

defineRoutes([
  { method: "GET", path: "/driver/overview", auth: [...drv], handler: async ({ user }) => {
    const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, user.id));
    const pol = await walletPolicy(user.id); // J4: an office driver sees no wallet and no earnings, only his cash
    const acct = pol.managedByOffice ? null : await ensureAccount(user.id);
    const active = await db.select({ n: sql<number>`count(*)::int` }).from(offers).where(and(eq(offers.driverId, user.id), inArray(offers.status, OFFER_BUSY)));
    const activeJob = (await activeJobs(db, [user.id])).get(user.id) ?? null;
    const act = (await getSettings()).driverSingleActiveJob ? activeJob : null; // E11: offers are hidden while a job is active
    const newOffers = await db.select({ n: sql<number>`count(*)::int` }).from(offers).where(and(eq(offers.driverId, user.id), eq(offers.status, "offered"), act ? sql`false` : undefined));
    const cash = await driverCashOutstanding(user.id);
    const [pending] = pol.managedByOffice ? [{ s: 0 }] : await db.select({ s: sql<number>`coalesce(sum(${settlements.providerCents}),0)::float8` }).from(settlements).where(and(eq(settlements.driverId, user.id), sql`${settlements.officeId} is null`, inArray(settlements.status, ["pending_review", "reviewed", "approved", "failed"])));
    return {
      availability: p?.availability, verificationStatus: p?.verificationStatus, suspendedUntil: p?.suspendedUntil, officeLinked: p?.officeLinkStatus === "linked", jobsCompleted: p?.jobsCompleted ?? 0,
      rating: p?.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : null, activeJobs: active[0].n, newOffers: newOffers[0].n, activeJob, cash,
      ...overviewWalletFields(pol, acct ? { availableCents: acct.availableCents, heldCents: acct.heldCents, pendingCents: pending.s } : null),
    };
  } },
  { method: "PUT", path: "/driver/availability", auth: [...drv], body: z.object({ available: z.boolean() }), handler: async ({ user, input }) => {
    if (input.available) {
      const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, user.id));
      if (p?.suspendedUntil && p.suspendedUntil > new Date()) throw err("NOT_ELIGIBLE", "Your account is temporarily suspended", { until: p.suspendedUntil });
    } else await clearDriverLocation(user);
    const [was] = await db.select({ a: driverProfiles.availability }).from(driverProfiles).where(eq(driverProfiles.userId, user.id));
    await db.update(driverProfiles).set({ availability: input.available ? "available" : "unavailable" }).where(eq(driverProfiles.userId, user.id));
    await recordAvailability(user.id, was?.a ?? null, input.available ? "available" : "unavailable", "driver", "manual");
    const newOffers = input.available ? await backfillOffersForDriver(user.id) : 0;
    return { availability: input.available ? "available" : "unavailable", newOffers };
  } },
  { method: "POST", path: "/driver/location", auth: [...drv], body: z.object({
    lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
    accuracyM: z.number().min(0).max(100000).optional(), speedMps: z.number().min(0).max(200).optional(), heading: z.number().min(0).max(360).optional(),
  }), handler: async ({ user, input }) => {
    await updateDriverLocation(user, input.lat, input.lng);
    // Sampled path for support / analytics (at most one point a minute); the job the driver is on is attached when there is one.
    const [job] = await db.select({ id: offers.id }).from(offers).where(and(eq(offers.driverId, user.id), inArray(offers.status, ["accepted", "arrived", "attendance_confirmed"]))).orderBy(desc(offers.updatedAt)).limit(1);
    await recordLocation(user.id, input, job?.id ?? null);
    return { ok: true };
  } },
  { method: "DELETE", path: "/driver/location", auth: [...drv], handler: async ({ user }) => { await clearDriverLocation(user); return { ok: true }; } },

  // Offers directed at me
  { method: "GET", path: "/driver/offers", auth: [...drv], handler: async ({ user }) => {
    // E11: a driver with an accepted job sees no other offers until he finishes it.
    const act = (await getSettings()).driverSingleActiveJob ? (await activeJobs(db, [user.id])).get(user.id) ?? null : null;
    if (act) return { items: [], hidden: true, activeJob: act };
    const rows = await db.select({ o: offers, r: requests }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId))
      .where(and(eq(offers.driverId, user.id), eq(offers.status, "offered"), inArray(requests.status, ["published", "filling"]))).orderBy(requests.startsAt);
    return { items: await withStats(await Promise.all(rows.map(({ o, r }) => driverJobView(o, r)))), hidden: false, activeJob: null };
  } },
  // Open requests I could apply to (no offer yet)
  { method: "GET", path: "/driver/opportunities", auth: [...drv], handler: async ({ user }) => {
    const act = (await getSettings()).driverSingleActiveJob ? (await activeJobs(db, [user.id])).get(user.id) ?? null : null;
    if (act) return { items: [], hidden: true, activeJob: act };
    const [p] = await db.select({ o: driverProfiles.officeId, vehicle: driverProfiles.vehicleType }).from(driverProfiles).where(eq(driverProfiles.userId, user.id));
    // Narrow in SQL first (cheap, exact rules) so a long list of other-city/other-vehicle requests can never hide the ones that fit.
    const open = await db.select().from(requests).where(and(
      inArray(requests.status, ["published", "filling"]), sql`${requests.slotsFilled} < ${requests.quantity}`, sql`${requests.service} <> 'car_without_driver'`,
      sql`not exists (select 1 from offers o where o.request_id = ${requests.id} and o.driver_id = ${user.id})`,
      sql`(not exists (select 1 from shipments sh where sh.request_id = ${requests.id}) or exists (select 1 from shipments sh where sh.request_id = ${requests.id} and sh.offer_id is null and sh.status = 'pending'))`,
      user.city ? eq(requests.pickupCity, user.city) : undefined,
      p?.vehicle ? sql`(${requests.vehicleType} is null or ${requests.vehicleType} = ${p.vehicle})` : undefined,
    )).orderBy(requests.startsAt).limit(200);
    const out = [];
    // During an office's exclusive window only that office's own drivers may take the request.
    const visible = open.filter((r) => !(r.preferredOfficeId && r.officeWindowEndsAt && r.officeWindowEndsAt > new Date() && r.preferredOfficeId !== p?.o));
    // One evaluation for the whole list (a fixed number of statements) instead of one per open request.
    const evals = await evaluateCandidatesMany(db, visible, { driverIds: [user.id] });
    const facts = await manifestFacts(db, visible.map((r) => r.id));
    for (const r of visible) {
      const [c] = evals.get(r.id) ?? [];
      if (!c || c.reasons.length) continue;
      const snap = r.pricingSnapshot as { providerCostCents: number; expectedUnits: number } | null;
      out.push({ requestId: r.id, ref: r.ref, service: r.service, vehicleType: r.vehicleType, pickupCity: r.pickupCity, deliveryCity: r.deliveryCity, startsAt: r.startsAt, durationDays: r.durationDays, expectedUnits: snap?.expectedUnits ?? null, expectedEarningCents: p?.o || !snap ? null : snap.providerCostCents * snap.expectedUnits, openSlots: r.quantity - r.slotsFilled, allowPartial: r.allowPartial, manifest: facts.get(r.id)?.manifest ?? false });
    }
    return { items: out, hidden: false, activeJob: null };
  } },
  { method: "POST", path: "/driver/requests/:id/apply", auth: [...drv], body: z.object({ termsAccepted: z.boolean() }), handler: ({ user, params, input }) => jobs.applyToRequest(user, params.id, input.termsAccepted) },

  // My jobs
  { method: "GET", path: "/driver/jobs", auth: [...drv], query: z.object({ scope: z.enum(["active", "history"]).default("active"), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional() }), handler: async ({ user, q }) => {
    const states = q.scope === "active" ? OFFER_BUSY : ["completed", "cancelled", "no_show", "rejected", "replaced"];
    const where = and(eq(offers.driverId, user.id), inArray(offers.status, states as never));
    const size = q.pageSize ?? 100, page = q.page ?? 1; // 100 keeps older clients working; history is pageable
    const [rows, [{ n }]] = await Promise.all([
      db.select({ o: offers, r: requests }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).where(where)
        .orderBy(q.scope === "active" ? requests.startsAt : desc(offers.updatedAt)).limit(q.scope === "active" ? 200 : size).offset(q.scope === "active" ? 0 : (page - 1) * size),
      db.select({ n: sql<number>`count(*)::int` }).from(offers).where(where),
    ]);
    return { items: await withStats(await Promise.all(rows.map(({ o, r }) => driverJobView(o, r)))), page, pageSize: size, total: Number(n) }; // `stats` = the order card's numbers (J5)
  } },
  { method: "GET", path: "/driver/jobs/:id", auth: [...drv], handler: async ({ user, params }) => { const { o, r } = await jobFor(user.id, params.id); return (await withStats([await driverJobView(o, r)]))[0]; } },
  { method: "POST", path: "/offers/:id/accept", auth: [...drv], body: z.object({ termsAccepted: z.boolean() }), handler: ({ user, params, input }) => jobs.acceptOffer(user, params.id, input.termsAccepted) },
  { method: "POST", path: "/offers/:id/reject", auth: [...drv], handler: ({ user, params }) => jobs.rejectOffer(user, params.id) },
  { method: "POST", path: "/offers/:id/checkin", auth: [...drv], body: z.object({ lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() }), handler: ({ user, params, input }) => jobs.checkIn(user, params.id, input) },
  { method: "POST", path: "/offers/:id/loading-ack", auth: [...drv], body: z.object({ ok: z.boolean(), note: z.string().max(300).optional() }), handler: ({ user, params, input }) => jobs.acknowledgeLoading(user, params.id, input.ok, input.note) },
  { method: "POST", path: "/offers/:id/delivered", auth: [...drv], body: z.object({ units: z.number().int().min(0).max(100000).optional() }), handler: ({ user, params, input }) => jobs.reportDelivered(user, params.id, input.units) },
  // ── Step-by-step stops (per-parcel jobs). Each action is refused unless that stop is the current one. ──
  // Best route (Google Routes, chunked past its 25-waypoint limit). Re-plans from where the driver is; after approval the stop they are standing at stays first.
  { method: "POST", path: "/offers/:id/route/optimize", auth: [...drv], body: z.object({ lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish(), force: z.boolean().nullish() }).default({}), handler: async ({ user, params, input }) => {
    const { planOfferRoute } = await import("@/server/route-plan");
    const out = await planOfferRoute({ offerId: params.id, actor: user, origin: input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null, force: !!input.force });
    const { o, r } = await jobFor(user.id, params.id);
    return { ...out, job: await driverJobView(o, r) };
  } },
  // E3: loading by the driver's own scans.
  { method: "POST", path: "/offers/:id/loading/scan", auth: [...drv], body: z.object({ code: z.string().min(1).max(80) }), handler: ({ user, params, input }) => scanLoad(user, params.id, input.code) },
  { method: "POST", path: "/offers/:id/loading/unscan", auth: [...drv], body: z.object({ code: z.string().min(1).max(80) }), handler: ({ user, params, input }) => unscanLoad(user, params.id, input.code) },
  { method: "POST", path: "/offers/:id/loading/finish", auth: [...drv], body: z.object({}).default({}), handler: async ({ user, params }) => {
    const res = await finishLoading(user, params.id);
    const { o, r } = await jobFor(user.id, params.id);
    return { ...res, job: await driverJobView(o, r) };
  } },
  // E5: the driver arranges the remaining stops by hand (before and after approving).
  { method: "POST", path: "/offers/:id/route/reorder", auth: [...drv], body: z.object({ order: z.array(z.string().uuid()).max(2000) }), handler: async ({ user, params, input }) => {
    const out = await reorderOfferRoute(user, params.id, input.order);
    const { o, r } = await jobFor(user.id, params.id);
    return { ...out, job: await driverJobView(o, r) };
  } },
  { method: "GET", path: "/driver/jobs/:id/route-geometry", auth: [...drv], handler: ({ user, params }) => routeGeometry(user, params.id) },
  { method: "GET", path: "/driver/cash", auth: [...drv], handler: ({ user }) => driverCash(user) },
  { method: "POST", path: "/offers/:id/route/approve", auth: [...drv], handler: ({ user, params }) => stops.approveRoute(user, params.id) },
  { method: "POST", path: "/offers/:id/stops/:sid/arrive", auth: [...drv], body: z.object({ lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() }), handler: ({ user, params, input }) => stops.arriveAtStop(user, params.id, params.sid, input) },
  { method: "POST", path: "/offers/:id/stops/:sid/deliver", auth: [...drv], body: z.object({ code: z.string().min(1).max(80), otp: z.string().max(8).nullish(), proof: z.literal("receipt").nullish(), receiverName: z.string().max(120).nullish(), signatureMediaId: z.string().uuid().nullish(), cashCollectedCents: z.number().int().min(0).max(10_000_000).nullish(), lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish() }), handler: ({ user, params, input }) => stops.deliverStop(user, params.id, params.sid, input) },
  { method: "POST", path: "/offers/:id/stops/:sid/fail", auth: [...drv], body: z.object({ reason: z.string().max(40), note: z.string().max(500).nullish(), mediaId: z.string().uuid().nullish(), lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish() }), handler: ({ user, params, input }) => stops.failStop(user, params.id, params.sid, input) },
  { method: "POST", path: "/offers/:id/stops/:sid/defer", auth: [...drv], body: z.object({ note: z.string().max(500).nullish(), mediaId: z.string().uuid().nullish() }).default({}), handler: ({ user, params, input }) => stops.deferStop(user, params.id, params.sid, input) },
  { method: "POST", path: "/offers/:id/stops/:sid/media", auth: [...drv], status: 201, handler: async ({ user, params, raw }) => {
    const fd = await raw.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) throw err("VALIDATION", "Photo required", { field: "file" });
    const note = fd.get("note");
    return stops.saveStopMedia(user, params.id, params.sid, { data: Buffer.from(await file.arrayBuffer()), mime: file.type, kind: String(fd.get("kind") ?? ""), note: typeof note === "string" ? note.slice(0, 300) : null });
  } },
  { method: "POST", path: "/offers/:id/stops/:sid/resend-code", auth: [...drv], handler: ({ user, params }) => stops.resendCode(user, params.id, params.sid) },
  { method: "POST", path: "/offers/:id/stops/:sid/proof", auth: [...drv], status: 201, handler: async ({ user, params, raw }) => {
    const fd = await raw.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) throw err("VALIDATION", "Photo required", { field: "file" });
    return stops.saveProofPhoto(user, params.id, params.sid, { data: Buffer.from(await file.arrayBuffer()), mime: file.type });
  } },
  { method: "POST", path: "/offers/:id/end-route", auth: ["driver", "staff", "admin"], body: z.object({ reason: z.string().min(3).max(300), note: z.string().max(500).optional() }), handler: ({ user, params, input }) => stops.endRoute(user, params.id, input.reason, input.note) },
  { method: "POST", path: "/offers/:id/cancel", auth: [...drv], body: z.object({ reason: z.string().min(3).max(300) }), handler: ({ user, params, input }) => jobs.driverCancel(user, params.id, input.reason) },
  { method: "POST", path: "/offers/:id/no-work", auth: [...drv], status: 201, body: z.object({ note: z.string().max(500).optional() }), handler: ({ user, params, input }) => jobs.reportNoWork(user, params.id, input.note) },
  { method: "POST", path: "/custody/:id/acknowledge", auth: [...drv], handler: async ({ user, params }) => (await import("@/server/support")).acknowledgeCustody(user, params.id) },

  // Office link
  { method: "GET", path: "/driver/invites", auth: [...drv], handler: async ({ user }) => ({ items: (await myInvites(user)).map((r) => ({ ...r.inv, officeName: r.office })) }) },
  { method: "POST", path: "/driver/invites/:id/respond", auth: [...drv], body: z.object({ accept: z.boolean() }), handler: ({ user, params, input }) => respondInvite(user, params.id, input.accept) },

  // WhatsApp hand-off (mobile). There is deliberately no route optimiser: stops follow the warehouse's fixed order, approved by the driver (decision C3).
  { method: "GET", path: "/driver/jobs/:id/whatsapp", auth: [...drv], query: z.object({ kind: z.enum(["contact", "arriving", "issue"]).default("contact"), lang: z.enum(["ar", "en", "ur"]).optional(), shipmentId: uuid.optional() }), handler: async ({ user, params, q }) => {
    const { o, r } = await jobFor(user.id, params.id);
    if (!(OFFER_BUSY as string[]).includes(o.status)) throw err("FORBIDDEN", "Contact details are available while the job is active");
    // Per-parcel jobs: only the CURRENT stop's recipient can be contacted (privacy, and it keeps the driver on one stop at a time).
    let name = r.recipientName, phone = r.recipientPhone, code = r.ref;
    if (q.shipmentId && !(await isRoutingOn())) {
      // J2: routing is off — the driver works his stops in any order, so any stop of his OWN active job can be contacted (never another driver's parcel).
      const [own] = await db.select().from(shipments).where(and(eq(shipments.id, q.shipmentId), eq(shipments.offerId, o.id)));
      if (!own) throw err("NOT_FOUND", "Stop not found");
      name = own.recipientName; phone = own.recipientPhone; code = own.code;
    } else if (q.shipmentId) {
      const cur = await currentStopOf(db, o.id);
      if (!o.routeApprovedAt || !cur || cur.id !== q.shipmentId) throw err("STOP_LOCKED", "You can only contact the recipient of the current stop");
      name = cur.recipientName; phone = cur.recipientPhone; code = cur.code;
    }
    if (!phone) throw err("NOT_FOUND", "No recipient contact on this job");
    const link = whatsappLink(q.lang ?? user.language, q.kind as WaKind, { name: name ?? "", ref: code, phone: normalizePhone(phone) ?? phone }); // defensive: legacy rows
    await logEvent(db, { requestId: r.id, offerId: o.id, actor: user, type: "whatsapp_handoff_opened", payload: { kind: q.kind } }); // initiation only — no delivery/read state exists
    return { ...link, note: "Opens WhatsApp with a prefilled message. You must press send in WhatsApp; JR Logistics cannot see delivery or replies." };
  } },
  { method: "POST", path: "/driver/jobs/:id/contact-exception", auth: [...drv], status: 201, body: z.object({ reason: z.enum(["no_answer", "wrong_number", "refused", "other"]), note: z.string().max(500).optional() }), handler: async ({ user, params, input }) => {
    const { o } = await jobFor(user.id, params.id);
    return jobs.reportContactException(user, o.id, input.reason, input.note);
  } },
]);
export { jobEvents };
