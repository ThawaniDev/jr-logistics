import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { defineRoutes } from "../router";
import { requestBody, uuid, pageQuery } from "../schemas";
import { db } from "@/db";
import { requests, officeProfiles, users, invoices, businessProfiles } from "@/db/schema";
import { err, AppError } from "@/lib/errors";
import { estimate, createDraft, updateDraft, publishRequest, cancelRequest, listRequests, viewRequest, assertOwner } from "@/server/requests";
import * as jobs from "@/server/jobs";
import { businessRequestDetail, timeline } from "@/server/views";
import { businessOverview } from "@/server/ops";
import { createApiKey, listApiKeys, revokeApiKey, setWebhook, listWebhookDeliveries, listApiLogs } from "@/server/integrations";
import { handoverCustody, returnCustody, listCustody } from "@/server/support";
import { readyOfficeIds } from "@/server/matching";
import { CUSTODY_ITEM_TYPES } from "@/server/catalog";

const biz = ["business"] as const;
const ownRequest = async (userId: string, id: string) => {
  const [r] = await db.select().from(requests).where(eq(requests.id, id));
  if (!r || r.businessId !== userId) throw err("NOT_FOUND", "Request not found");
  return r;
};

defineRoutes([
  { method: "GET", path: "/business/overview", auth: [...biz], handler: ({ user }) => businessOverview(user) },
  { method: "GET", path: "/business/offices", auth: [...biz], handler: async () => {
    const offs = await db.select({ id: users.id, name: officeProfiles.officeName, city: officeProfiles.city }).from(officeProfiles).innerJoin(users, eq(users.id, officeProfiles.userId)).where(and(eq(officeProfiles.verificationStatus, "verified"), eq(users.status, "active")));
    const ready = await readyOfficeIds(db, offs.map((o) => o.id));
    return { items: offs.filter((o) => ready.has(o.id)) };
  } },
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
  { method: "GET", path: "/requests", auth: [...biz], query: pageQuery.extend({ city: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }), handler: async ({ user, q }) => {
    const r = await listRequests({ ...q, businessId: user.id });
    return { ...r, items: r.items.map((x) => viewRequest(x, user)) };
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
  { method: "POST", path: "/requests/:id/urgent-help", auth: [...biz], status: 201, body: z.object({ reason: z.string().min(3).max(200), note: z.string().max(1000).optional() }), handler: async ({ user, params, input }) => {
    const r = await ownRequest(user.id, params.id);
    return db.transaction((tx) => jobs.openTicket(tx, user, { category: "urgent", subject: `${r.ref}: ${input.reason}`, requestId: r.id, body: input.note, priority: "urgent" }));
  } },

  // Business actions on a driver's job
  { method: "POST", path: "/offers/:id/attendance", auth: ["business", "staff", "admin"], body: z.object({ present: z.boolean(), reason: z.string().max(300).optional() }), handler: ({ user, params, input }) => jobs.confirmAttendance(user, params.id, input.present, input.reason) },
  { method: "POST", path: "/offers/:id/loading", auth: ["business", "staff", "admin"], body: z.object({ units: z.number().int().min(0).max(100000) }), handler: ({ user, params, input }) => jobs.recordLoading(user, params.id, input.units) },
  { method: "POST", path: "/offers/:id/delivery-decision", auth: ["business", "staff", "admin"], body: z.discriminatedUnion("action", [z.object({ action: z.literal("confirm"), units: z.number().int().min(0).optional() }), z.object({ action: z.literal("dispute"), note: z.string().min(3).max(500) })]), handler: ({ user, params, input }) => jobs.confirmDelivery(user, params.id, input) },
  { method: "POST", path: "/offers/:id/rate", auth: ["business", "driver"], status: 201, body: z.object({ stars: z.number().int().min(1).max(5), comment: z.string().max(500).optional() }), handler: ({ user, params, input }) => jobs.rate(user, params.id, input.stars, input.comment) },
  { method: "POST", path: "/offers/:id/custody", auth: [...biz], status: 201, body: z.object({ items: z.array(z.object({ itemType: z.enum(CUSTODY_ITEM_TYPES), qty: z.number().int().min(1).max(100).optional(), description: z.string().max(200).optional() })).min(1).max(20) }), handler: ({ user, params, input }) => handoverCustody(user, params.id, input.items) },
  { method: "POST", path: "/custody/:id/return", auth: ["business", "staff", "admin"], body: z.object({ outcome: z.enum(["returned", "not_returned", "damaged"]), note: z.string().max(300).optional() }), handler: ({ user, params, input }) => returnCustody(user, params.id, input.outcome, input.note) },
  { method: "GET", path: "/offers/:id/custody", auth: "user", handler: async ({ user, params }) => ({ items: await listCustody(user, params.id) }) },

  // Integrations (business self-service)
  { method: "GET", path: "/business/api-keys", auth: [...biz], handler: async ({ user }) => ({ items: await listApiKeys(user) }) },
  { method: "POST", path: "/business/api-keys", auth: [...biz], status: 201, body: z.object({ name: z.string().min(2).max(60) }), handler: ({ user, input }) => createApiKey(user, input.name) },
  { method: "POST", path: "/business/api-keys/:id/revoke", auth: [...biz], handler: async ({ user, params }) => { await revokeApiKey(user, params.id); return { ok: true }; } },
  { method: "PUT", path: "/business/webhook", auth: [...biz], body: z.object({ url: z.string().url().nullable() }), handler: ({ user, input }) => setWebhook(user, input.url) },
  { method: "GET", path: "/business/webhook", auth: [...biz], handler: async ({ user }) => {
    const [bp] = await db.select({ url: businessProfiles.webhookUrl }).from(businessProfiles).where(eq(businessProfiles.userId, user.id));
    return { url: bp?.url ?? null, deliveries: await listWebhookDeliveries(user.id), apiLogs: await listApiLogs(user.id) };
  } },
]);
export { desc };
