import { z } from "zod";
import { and, eq, desc, sql } from "drizzle-orm";
import { defineRoutes } from "../router";
import { requestBody, uuid, pageQuery, shipmentBody } from "../schemas";
import { db } from "@/db";
import { requests, offers, invoices, businessProfiles } from "@/db/schema";
import { err, AppError } from "@/lib/errors";
import { estimate, createDraft, updateDraft, publishRequest, cancelRequest, listRequests, viewRequest, assertOwner } from "@/server/requests";
import * as jobs from "@/server/jobs";
import { businessRequestDetail, timeline } from "@/server/views";
import { businessOverview } from "@/server/ops";
import { createApiKey, listApiKeys, revokeApiKey, setWebhook, rotateWebhookSecret, listWebhookDeliveries, listApiLogs } from "@/server/integrations";
import { handoverCustody, returnCustody, listCustody } from "@/server/support";
import { setWarehouseLocation } from "@/server/warehouse";
import { businessCod, receiveCash, listRemittances } from "@/server/cod";
import * as stops from "@/server/stops";
import { CUSTODY_ITEM_TYPES } from "@/server/catalog";

const biz = ["business"] as const;
const ownRequest = async (userId: string, id: string) => {
  const [r] = await db.select().from(requests).where(eq(requests.id, id));
  if (!r || r.businessId !== userId) throw err("NOT_FOUND", "Request not found");
  return r;
};

defineRoutes([
  { method: "GET", path: "/business/overview", auth: [...biz], handler: ({ user }) => businessOverview(user) },
  { method: "POST", path: "/requests/estimate", auth: [...biz], body: requestBody, handler: ({ user, input }) => estimate(user, input) },
  { method: "POST", path: "/requests", auth: [...biz], status: 201, body: requestBody.extend({ publish: z.boolean().optional(), termsAccepted: z.boolean().optional() }), handler: async ({ user, input, req }) => {
    const { publish, termsAccepted, ...rest } = input;
    const via = req.headers.get("x-client") === "mobile" ? "mobile" : "web";
    const d = await createDraft(user, rest, via);
    if (!publish) return d;
    try { return await publishRequest(user, d.id, { termsAccepted: !!termsAccepted }); }
    catch (e) { // the draft stays (retryable) — tell the client its id so a retry never duplicates it
      if (e instanceof AppError) throw new AppError(e.code, e.message, { ...e.details, draftId: d.id });
      throw e;
    }
  } },
  { method: "GET", path: "/requests", auth: [...biz], query: pageQuery.extend({ city: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), needsAction: z.enum(["1"]).optional() }), handler: async ({ user, q }) => {
    const r = await listRequests({ ...q, needsAction: q.needsAction === "1", businessId: user.id });
    return { ...r, items: r.items.map((x) => viewRequest(x, user)) };
  } },
  // The company's tax invoices (one per settled request), newest first — the wallet page's "Invoices" section.
  { method: "GET", path: "/business/invoices", auth: [...biz], query: z.object({ page: z.coerce.number().int().min(1).optional() }), handler: async ({ user, q }) => {
    const pageSize = 15, page = q.page ?? 1, mine = eq(invoices.businessId, user.id);
    const [rows, [tot]] = await Promise.all([
      db.select({ i: invoices, ref: requests.ref }).from(invoices).innerJoin(requests, eq(requests.id, invoices.requestId)).where(mine).orderBy(desc(invoices.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
      db.select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${invoices.totalCents}), 0)::int`, vat: sql<number>`coalesce(sum(${invoices.vatCents}), 0)::int` }).from(invoices).where(mine),
    ]);
    return { page, pageSize, total: Number(tot.n), totals: { totalCents: Number(tot.total), vatCents: Number(tot.vat) },
      items: rows.map(({ i, ref }) => ({ id: i.id, number: i.number, requestId: i.requestId, requestRef: ref, subtotalCents: i.subtotalCents, vatCents: i.vatCents, totalCents: i.totalCents, vatPct: i.vatPct, createdAt: i.createdAt })) };
  } },
  { method: "GET", path: "/requests/:id", auth: ["business", "staff", "admin"], handler: async ({ user, params }) => {
    const [r] = await db.select().from(requests).where(eq(requests.id, params.id));
    if (!r) throw err("NOT_FOUND");
    if (user.role === "business") assertOwner(user, r);
    else if (!(user.role === "admin" || user.permissions.includes("requests.view"))) throw err("FORBIDDEN");
    const [d, tl] = await Promise.all([businessRequestDetail(r, user), timeline(r.id)]);
    const inv = user.role === "business" ? await db.select().from(invoices).where(eq(invoices.requestId, r.id)) : [];
    return { request: viewRequest(r, user), ...d, timeline: tl, invoices: inv };
  } },
  { method: "PATCH", path: "/requests/:id", auth: [...biz], body: requestBody, handler: ({ user, params, input }) => updateDraft(user, params.id, input) },
  { method: "POST", path: "/requests/:id/publish", auth: [...biz], body: z.object({ termsAccepted: z.boolean() }), handler: ({ user, params, input }) => publishRequest(user, params.id, input) },
  { method: "POST", path: "/requests/:id/cancel", auth: ["business", "staff", "admin"], body: z.object({ reason: z.string().min(3).max(300) }), handler: ({ user, params, input }) => cancelRequest(user, params.id, input.reason) },
  { method: "POST", path: "/requests/:id/complete", auth: ["business", "staff", "admin"], handler: ({ user, params }) => jobs.completeRequest(user, params.id) },
  { method: "POST", path: "/requests/:id/urgent-help", auth: [...biz], status: 201, body: z.object({ reason: z.string().min(3).max(200), note: z.string().max(1000).optional(), offerId: uuid.optional() }), handler: async ({ user, params, input }) => {
    const r = await ownRequest(user.id, params.id);
    if (input.offerId) { const [o] = await db.select({ id: offers.id }).from(offers).where(and(eq(offers.id, input.offerId), eq(offers.requestId, r.id))); if (!o) throw err("NOT_FOUND", "Driver job not found on this request"); }
    return db.transaction((tx) => jobs.openTicket(tx, user, { category: "urgent", subject: `${r.ref}: ${input.reason}`, requestId: r.id, offerId: input.offerId ?? null, body: input.note, priority: "urgent" }));
  } },

  // Business actions on a driver's job
  { method: "POST", path: "/offers/:id/attendance", auth: ["business", "staff", "admin"], body: z.object({ present: z.boolean(), reason: z.string().max(300).optional() }), handler: ({ user, params, input }) => jobs.confirmAttendance(user, params.id, input.present, input.reason) },
  // Hand-over: per-parcel jobs send the codes (or all:true) of exactly what goes onto the vehicle; legacy bulk jobs still send a count.
  { method: "POST", path: "/offers/:id/loading", auth: ["business", "staff", "admin"], body: z.object({ units: z.number().int().min(0).max(100000).optional(), codes: z.array(z.string().max(80)).max(2000).optional(), all: z.boolean().optional() }), handler: ({ user, params, input }) => jobs.recordLoading(user, params.id, input.units, { codes: input.codes, all: input.all }) },
  { method: "POST", path: "/offers/:id/returns", auth: ["business", "staff", "admin"], body: z.object({ codes: z.array(z.string().max(80)).max(2000).optional(), all: z.boolean().optional() }), handler: ({ user, params, input }) => stops.confirmReturns(user, params.id, input) },
  { method: "GET", path: "/requests/:id/shipments", auth: ["business", "staff", "admin"], query: z.object({ status: z.string().optional(), q: z.string().max(80).optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional() }), handler: ({ user, params, q }) => stops.listRequestShipments(user, params.id, q) },
  { method: "POST", path: "/requests/:id/reship", auth: [...biz], status: 201, body: z.object({ ids: z.array(uuid).max(2000).optional() }), handler: ({ user, params, input }) => stops.reshipFromRequest(user, params.id, input.ids) },
  // Demo/testing deployments only: 80 ready-made, fully detailed parcels for the city, to pick from when creating an order. 404 in production.
  { method: "GET", path: "/business/demo-shipments", auth: [...biz], query: z.object({ city: z.string().max(30).default("riyadh") }), handler: async ({ q }) => {
    const { env } = await import("@/lib/env");
    if (!env.demoMode) throw err("NOT_FOUND");
    const items = (await import("@/server/demo-shipments")).demoShipments(q.city);
    if (!items) throw err("VALIDATION", "City is not supported", { field: "city" });
    return { city: q.city, total: items.length, items };
  } },
  { method: "PATCH", path: "/requests/:id/shipments", auth: ["business", "staff", "admin"], body: z.object({ rows: z.array(shipmentBody.partial().extend({ id: z.string().uuid().nullish(), code: z.string().max(60).nullish(), seq: z.number().int().min(1).max(100000).nullish() })).min(1).max(stops.BULK_COMPLETE_MAX) }), handler: ({ user, params, input }) => stops.completeShipments(user, params.id, input.rows) },
  { method: "PATCH", path: "/shipments/:id", auth: ["business", "staff", "admin"], body: shipmentBody.partial(), handler: ({ user, params, input }) => stops.updateShipment(user, params.id, input) },
  { method: "POST", path: "/shipments/:id/cancel", auth: ["business", "staff", "admin"], body: z.object({ reason: z.string().min(3).max(300) }), handler: ({ user, params, input }) => stops.cancelShipment(user, params.id, input.reason) },
  { method: "GET", path: "/shipments/:id", auth: ["business", "staff", "admin"], handler: ({ user, params }) => stops.shipmentTimeline(user, params.id) },
  { method: "GET", path: "/shipments/:id/proof", auth: "user", handler: async ({ user, params }) => {
    const { data, mime } = await stops.readProof(user, params.id);
    return new Response(new Uint8Array(data), { headers: { "content-type": mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } },
  // E1: where the warehouse is (drivers check in within the platform radius of it).
  { method: "PUT", path: "/business/warehouse", auth: [...biz], body: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }), handler: ({ user, input }) => setWarehouseLocation(user, user.id, input.lat, input.lng) },
  // E17: cash on delivery the drivers hold, and "Receive money from driver".
  { method: "GET", path: "/business/cod", auth: [...biz], handler: ({ user }) => businessCod(user) },
  { method: "POST", path: "/business/cod/receive", auth: [...biz], status: 201, body: z.object({ offerId: uuid, amountCents: z.number().int().min(1).max(1_000_000_000), note: z.string().max(300).nullish() }), handler: ({ user, input }) => receiveCash(user, input.offerId, input.amountCents, input.note) },
  { method: "GET", path: "/business/cod/remittances", auth: [...biz], query: z.object({ page: z.coerce.number().int().min(1).optional() }), handler: ({ user, q }) => listRemittances({ businessId: user.id, page: q.page }) },
  // E7/E10/E14: evidence photos captured at a stop (postponement, failed attempt, signature).
  { method: "GET", path: "/shipments/:id/media", auth: "user", handler: ({ user, params }) => stops.listShipmentMedia(user, params.id) },
  { method: "GET", path: "/shipments/:id/media/:mid", auth: "user", handler: async ({ user, params }) => {
    const { data, mime } = await stops.readShipmentMedia(user, params.id, params.mid);
    return new Response(new Uint8Array(data), { headers: { "content-type": mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } },
  { method: "POST", path: "/offers/:id/rate", auth: ["business", "driver"], status: 201, body: z.object({ stars: z.number().int().min(1).max(5), comment: z.string().max(500).optional() }), handler: ({ user, params, input }) => jobs.rate(user, params.id, input.stars, input.comment) },
  { method: "POST", path: "/offers/:id/custody", auth: [...biz], status: 201, body: z.object({ items: z.array(z.object({ itemType: z.enum(CUSTODY_ITEM_TYPES), qty: z.number().int().min(1).max(100).optional(), description: z.string().max(200).optional() })).min(1).max(20) }), handler: ({ user, params, input }) => handoverCustody(user, params.id, input.items) },
  { method: "POST", path: "/custody/:id/return", auth: ["business", "staff", "admin"], body: z.object({ outcome: z.enum(["returned", "not_returned", "damaged"]), note: z.string().max(300).optional() }), handler: ({ user, params, input }) => returnCustody(user, params.id, input.outcome, input.note) },
  { method: "GET", path: "/offers/:id/custody", auth: "user", handler: async ({ user, params }) => ({ items: await listCustody(user, params.id) }) },

  // Integrations (business self-service)
  { method: "GET", path: "/business/api-keys", auth: [...biz], handler: async ({ user }) => ({ items: await listApiKeys(user) }) },
  { method: "POST", path: "/business/api-keys", auth: [...biz], status: 201, body: z.object({ name: z.string().min(2).max(60) }), handler: ({ user, input }) => createApiKey(user, input.name) },
  { method: "POST", path: "/business/api-keys/:id/revoke", auth: [...biz], handler: async ({ user, params }) => { await revokeApiKey(user, params.id); return { ok: true }; } },
  { method: "PUT", path: "/business/webhook", auth: [...biz], body: z.object({ url: z.string().url().nullable() }), handler: ({ user, input }) => setWebhook(user, input.url) },
  { method: "POST", path: "/business/webhook/rotate-secret", auth: [...biz], handler: ({ user }) => rotateWebhookSecret(user) },
  { method: "GET", path: "/business/webhook", auth: [...biz], handler: async ({ user }) => {
    const [bp] = await db.select({ url: businessProfiles.webhookUrl }).from(businessProfiles).where(eq(businessProfiles.userId, user.id));
    return { url: bp?.url ?? null, deliveries: await listWebhookDeliveries(user.id), apiLogs: await listApiLogs(user.id) };
  } },
]);
export { desc };
