import { z } from "zod";
import { defineRoutes, type AuthSpec, type RouteDef } from "../router";
import { uuid } from "../schemas";
import { err } from "@/lib/errors";
import { can, isBackoffice } from "@/server/auth/permissions";
import type { User } from "@/db/schema";
import {
  providerCatalog, listConnections, getConnection, createConnection, updateConnection, deleteConnection, testConnection, registerPartnerWebhook, rotateInboundToken,
  lookupPackages, packageLabel, listPartnerEvents, outboxSummary, retryOutbox, receiveWebhook, adminPartnerOverview, pollNow,
  listOrders, getOrder, ordersToManifest, dismissOrders, restoreOrders, refreshOrder, importByReference, serveLabel, ORDER_STATES,
} from "@/server/partners/service";
import { omnifulCancel, omnifulCreate, omnifulLabel, omnifulRegisterWebhook, omnifulReturns, omnifulToken, omnifulTrack, omnifulValidate } from "@/server/partners/carrier-omniful";

const biz = ["business"] as const;
const kinds = z.enum(["status", "cancelled", "delivered", "returned", "failed"]);
const settings = z.object({
  autoCancel: z.boolean().optional(), importNew: z.boolean().optional(), pollMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  sync: z.record(z.string(), z.boolean()).optional(),
  statusOut: z.record(z.string(), z.string().max(60).nullable()).optional(),
  statusIn: z.record(z.string().max(80), kinds.nullable()).optional(),
}).partial();
const fields = { config: z.record(z.string(), z.union([z.string(), z.boolean(), z.null()])).optional(), secrets: z.record(z.string(), z.string().nullable()).optional(), settings: settings.optional() };
const idList = z.object({ identifiers: z.array(z.string().trim().min(1).max(80)).min(1).max(100) });
const orderIds = z.object({ ids: z.array(uuid).min(1).max(500), reason: z.string().max(300).optional() });
const pageQ = z.object({ page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional() });
const ordersQ = pageQ.extend({ connectionId: uuid.optional(), state: z.enum(ORDER_STATES).optional(), q: z.string().max(80).optional(), city: z.string().max(40).optional(), businessId: uuid.optional() });
const eventsQ = pageQ.extend({ outcome: z.enum(["ok", "ignored", "error"]).optional(), direction: z.enum(["in", "out", "lookup", "test", "poll"]).optional() });
const MAX_HOOK_BYTES = 64 * 1024;

/** Staff: viewing needs `integrations.view` (or the older `requests.view`), changing needs `integrations.manage` (decision I19). */
const staffView = (u: User) => { if (!can(u, "integrations.view") && !can(u, "requests.view")) throw err("FORBIDDEN"); };
const staffManage = (u: User) => { if (!can(u, "integrations.manage")) throw err("FORBIDDEN", "Missing permission integrations.manage"); };

/** The same connection operations for the company (its own connections) and for staff (any company's), at two path prefixes. */
function connectionRoutes(prefix: string, auth: AuthSpec, view: (u: User) => void, manage: (u: User) => void): RouteDef[] {
  const g = (u: User, f: (u: User) => void) => { if (auth === "backoffice") f(u); };
  return [
    { method: "GET", path: `${prefix}/connections/:id`, auth, handler: ({ user, params }) => { g(user, view); return getConnection(user, uuid.parse(params.id)); } },
    { method: "PATCH", path: `${prefix}/connections/:id`, auth, body: z.object({ name: z.string().trim().min(2).max(80).optional(), status: z.enum(["active", "disabled"]).optional(), ...fields }), handler: ({ user, params, input }) => { g(user, manage); return updateConnection(user, uuid.parse(params.id), input); } },
    { method: "DELETE", path: `${prefix}/connections/:id`, auth, handler: async ({ user, params }) => { g(user, manage); await deleteConnection(user, uuid.parse(params.id)); } },
    { method: "POST", path: `${prefix}/connections/:id/test`, auth, handler: ({ user, params }) => { g(user, manage); return testConnection(user, uuid.parse(params.id)); } },
    { method: "POST", path: `${prefix}/connections/:id/register-webhook`, auth, handler: ({ user, params }) => { g(user, manage); return registerPartnerWebhook(user, uuid.parse(params.id)); } },
    { method: "POST", path: `${prefix}/connections/:id/rotate-token`, auth, handler: ({ user, params }) => { g(user, manage); return rotateInboundToken(user, uuid.parse(params.id)); } },
    { method: "POST", path: `${prefix}/connections/:id/poll`, auth, handler: ({ user, params }) => { g(user, manage); return pollNow(user, uuid.parse(params.id)); } },
    { method: "POST", path: `${prefix}/connections/:id/lookup`, auth, body: idList, handler: ({ user, params, input }) => { g(user, manage); return lookupPackages(user, uuid.parse(params.id), input.identifiers); } },
    { method: "POST", path: `${prefix}/connections/:id/import`, auth, body: z.object({ reference: z.string().trim().min(1).max(80) }), handler: ({ user, params, input }) => { g(user, manage); return importByReference(user, uuid.parse(params.id), input.reference); } },
    { method: "POST", path: `${prefix}/connections/:id/label`, auth, body: idList, handler: ({ user, params, input }) => { g(user, view); return packageLabel(user, uuid.parse(params.id), input.identifiers); } },
    { method: "GET", path: `${prefix}/connections/:id/events`, auth, query: eventsQ, handler: ({ user, params, q }) => { g(user, view); return listPartnerEvents(user, uuid.parse(params.id), q); } },
    { method: "GET", path: `${prefix}/connections/:id/outbox`, auth, handler: ({ user, params }) => { g(user, view); return outboxSummary(user, uuid.parse(params.id)); } },
    { method: "POST", path: `${prefix}/outbox/:id/retry`, auth, handler: ({ user, params }) => { g(user, manage); return retryOutbox(user, uuid.parse(params.id)); } },
    // Incoming orders
    { method: "GET", path: `${prefix}/orders`, auth, query: ordersQ, handler: ({ user, q }) => { g(user, view); return listOrders(user, q); } },
    { method: "GET", path: `${prefix}/orders/:id`, auth, handler: ({ user, params }) => { g(user, view); return getOrder(user, uuid.parse(params.id)); } },
    { method: "POST", path: `${prefix}/orders/:id/refresh`, auth, handler: ({ user, params }) => { g(user, manage); return refreshOrder(user, uuid.parse(params.id)); } },
    { method: "POST", path: `${prefix}/orders/manifest`, auth, body: orderIds, handler: ({ user, input }) => { g(user, view); return ordersToManifest(user, input.ids); } },
    { method: "POST", path: `${prefix}/orders/dismiss`, auth, body: orderIds, handler: ({ user, input }) => { g(user, manage); return dismissOrders(user, input.ids, input.reason); } },
    { method: "POST", path: `${prefix}/orders/restore`, auth, body: orderIds, handler: ({ user, input }) => { g(user, manage); return restoreOrders(user, input.ids); } },
  ];
}

defineRoutes([
  // Catalogue of systems JR can connect to (company and staff)
  { method: "GET", path: "/integrations/providers", auth: "user", handler: async ({ user }) => { if (user.role !== "business" && !isBackoffice(user)) throw err("FORBIDDEN"); return { items: providerCatalog() }; } },

  // Company: its own connections
  { method: "GET", path: "/integrations/connections", auth: [...biz], handler: async ({ user }) => ({ items: await listConnections(user) }) },
  { method: "POST", path: "/integrations/connections", auth: [...biz], status: 201, body: z.object({ provider: z.string().min(1).max(40), name: z.string().trim().min(2).max(80), ...fields }), handler: ({ user, input }) => createConnection(user, input) },
  ...connectionRoutes("/integrations", [...biz], () => undefined, () => undefined),

  // Staff: any company's connections (create for a company, edit, test, rotate …) — audited
  { method: "GET", path: "/admin/partners", auth: "backoffice", query: pageQ.extend({ q: z.string().max(80).optional(), provider: z.string().max(40).optional(), status: z.enum(["active", "disabled"]).optional(), problemsOnly: z.enum(["0", "1"]).optional(), businessId: uuid.optional() }), handler: async ({ user, q }) => { staffView(user); return adminPartnerOverview({ ...q, problemsOnly: q.problemsOnly === "1" }); } },
  { method: "GET", path: "/admin/integrations/connections", auth: "backoffice", query: pageQ.extend({ q: z.string().max(80).optional(), provider: z.string().max(40).optional(), status: z.enum(["active", "disabled"]).optional(), problemsOnly: z.enum(["0", "1"]).optional(), businessId: uuid.optional() }), handler: async ({ user, q }) => { staffView(user); return adminPartnerOverview({ ...q, problemsOnly: q.problemsOnly === "1" }); } },
  { method: "POST", path: "/admin/integrations/connections", auth: "backoffice", status: 201, body: z.object({ businessId: uuid, provider: z.string().min(1).max(40), name: z.string().trim().min(2).max(80), ...fields }), handler: ({ user, input }) => { staffManage(user); return createConnection(user, input); } },
  ...connectionRoutes("/admin/integrations", "backoffice", staffView, staffManage),

  // Public: the partner's system calls these. Authenticated by the connection's token (header or URL), not a session.
  { method: "POST", path: "/integrations/hooks/:id", auth: "public", maxBytes: MAX_HOOK_BYTES, handler: ({ req, params, body, ip }) => receiveWebhook(params.id, req.headers, body, ip) },
  { method: "POST", path: "/integrations/hooks/:id/:token", auth: "public", maxBytes: MAX_HOOK_BYTES, handler: ({ req, params, body, ip }) => receiveWebhook(params.id, req.headers, body, ip, params.token) },
  // Fastcoo's page names the order webhook `{base_url}/webhook/API/OrderRecieveLM`: accepted under the connection's URL as well.
  { method: "POST", path: "/integrations/hooks/:id/:token/webhook/API/OrderRecieveLM", auth: "public", maxBytes: MAX_HOOK_BYTES, handler: ({ req, params, body, ip }) => receiveWebhook(params.id, req.headers, body, ip, params.token) },
  { method: "POST", path: "/integrations/hooks/:id/:token/webhook/API/StatusUpdate", auth: "public", maxBytes: MAX_HOOK_BYTES, handler: ({ req, params, body, ip }) => receiveWebhook(params.id, req.headers, body, ip, params.token) },
  // JR's own label for orders it received from carrier-mode partners (public, unguessable signed link — Omniful downloads it unauthenticated).
  { method: "GET", path: "/integrations/labels/:awb/:sig/label.pdf", auth: "public", handler: ({ params }) => serveLabel(params.awb, params.sig) },

  // Omniful "Shipping Partner Integration API" — base URL <APP_URL>/api/v1/carriers/omniful
  { method: "POST", path: "/carriers/omniful/auth/validate", auth: "public", maxBytes: 8 * 1024, handler: ({ body, ip }) => omnifulValidate(body, ip) },
  { method: "POST", path: "/carriers/omniful/auth/token", auth: "public", maxBytes: 8 * 1024, handler: ({ body, ip }) => omnifulToken(body, ip) },
  { method: "POST", path: "/carriers/omniful/shipments", auth: "public", maxBytes: 1024 * 1024, handler: ({ req, body, ip }) => omnifulCreate(req, body, ip) },
  { method: "POST", path: "/carriers/omniful/shipments/cancel", auth: "public", maxBytes: 16 * 1024, handler: ({ req, body, ip }) => omnifulCancel(req, body, ip) },
  { method: "POST", path: "/carriers/omniful/shipments/returns", auth: "public", maxBytes: 256 * 1024, handler: ({ req, ip }) => omnifulReturns(req, ip) },
  { method: "POST", path: "/carriers/omniful/shipments/returns/cancel", auth: "public", maxBytes: 16 * 1024, handler: ({ req, ip }) => omnifulReturns(req, ip) },
  { method: "GET", path: "/carriers/omniful/shipments/returns/:awb/label", auth: "public", handler: ({ req, ip }) => omnifulReturns(req, ip) },
  { method: "GET", path: "/carriers/omniful/shipments/:awb/tracking", auth: "public", handler: ({ req, params, ip }) => omnifulTrack(req, params.awb, ip) },
  { method: "GET", path: "/carriers/omniful/shipments/:awb/label", auth: "public", handler: ({ req, params, ip }) => omnifulLabel(req, params.awb, ip) },
  { method: "POST", path: "/carriers/omniful/webhooks/register", auth: "public", maxBytes: 8 * 1024, handler: ({ req, body, ip }) => omnifulRegisterWebhook(req, body, ip) },
]);
