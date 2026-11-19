import { z } from "zod";
import { defineRoutes } from "../router";
import { uuid } from "../schemas";
import { err } from "@/lib/errors";
import { can } from "@/server/auth/permissions";
import {
  providerCatalog, listConnections, createConnection, updateConnection, deleteConnection, testConnection, registerPartnerWebhook, rotateInboundToken,
  lookupPackages, packageLabel, listPartnerEvents, outboxSummary, retryOutbox, receiveWebhook, adminPartnerOverview,
} from "@/server/partners/service";

const biz = ["business"] as const;
const settings = z.object({ autoCancel: z.boolean().optional(), sync: z.record(z.string(), z.boolean()).optional() }).partial();
const fields = { config: z.record(z.string(), z.union([z.string(), z.boolean(), z.null()])).optional(), secrets: z.record(z.string(), z.string().nullable()).optional(), settings: settings.optional() };
const idList = z.object({ identifiers: z.array(z.string().trim().min(1).max(80)).min(1).max(100) });
const MAX_HOOK_BYTES = 64 * 1024;

defineRoutes([
  // Business: manage connections to their warehouse / order systems
  { method: "GET", path: "/integrations/providers", auth: [...biz], handler: async () => ({ items: providerCatalog() }) },
  { method: "GET", path: "/integrations/connections", auth: [...biz], handler: async ({ user }) => ({ items: await listConnections(user) }) },
  { method: "POST", path: "/integrations/connections", auth: [...biz], status: 201, body: z.object({ provider: z.string().min(1).max(40), name: z.string().trim().min(2).max(80), ...fields }), handler: ({ user, input }) => createConnection(user, input) },
  { method: "PATCH", path: "/integrations/connections/:id", auth: [...biz], body: z.object({ name: z.string().trim().min(2).max(80).optional(), status: z.enum(["active", "disabled"]).optional(), ...fields }), handler: ({ user, params, input }) => updateConnection(user, uuid.parse(params.id), input) },
  { method: "DELETE", path: "/integrations/connections/:id", auth: [...biz], handler: async ({ user, params }) => { await deleteConnection(user, uuid.parse(params.id)); } },
  { method: "POST", path: "/integrations/connections/:id/test", auth: [...biz], handler: ({ user, params }) => testConnection(user, uuid.parse(params.id)) },
  { method: "POST", path: "/integrations/connections/:id/register-webhook", auth: [...biz], handler: ({ user, params }) => registerPartnerWebhook(user, uuid.parse(params.id)) },
  { method: "POST", path: "/integrations/connections/:id/rotate-token", auth: [...biz], handler: ({ user, params }) => rotateInboundToken(user, uuid.parse(params.id)) },
  { method: "POST", path: "/integrations/connections/:id/lookup", auth: [...biz], body: idList, handler: ({ user, params, input }) => lookupPackages(user, uuid.parse(params.id), input.identifiers) },
  { method: "POST", path: "/integrations/connections/:id/label", auth: [...biz], body: idList, handler: ({ user, params, input }) => packageLabel(user, uuid.parse(params.id), input.identifiers) },
  { method: "GET", path: "/integrations/connections/:id/events", auth: [...biz], handler: ({ user, params, query }) => listPartnerEvents(user, uuid.parse(params.id), { page: Number(query.get("page")) || 1, pageSize: Number(query.get("pageSize")) || 30, outcome: query.get("outcome") ?? undefined }) },
  { method: "GET", path: "/integrations/connections/:id/outbox", auth: [...biz], handler: ({ user, params }) => outboxSummary(user, uuid.parse(params.id)) },
  { method: "POST", path: "/integrations/outbox/:id/retry", auth: [...biz], handler: ({ user, params }) => retryOutbox(user, uuid.parse(params.id)) },

  // Public: the partner's system calls this. Authenticated by the connection's token, not a session.
  { method: "POST", path: "/integrations/hooks/:id", auth: "public", maxBytes: MAX_HOOK_BYTES, handler: async ({ req, params, body, ip }) => {
    return receiveWebhook(params.id, req.headers, body, ip);
  } },

  // Back office: see every connection and what is stuck
  { method: "GET", path: "/admin/partners", auth: "backoffice", query: z.object({ page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional(), q: z.string().max(80).optional(), provider: z.string().max(40).optional(), status: z.enum(["active", "disabled"]).optional(), problemsOnly: z.enum(["0", "1"]).optional() }), handler: async ({ user, q }) => { if (!can(user, "requests.view")) throw err("FORBIDDEN"); return adminPartnerOverview({ ...q, problemsOnly: q.problemsOnly === "1" }); } },
]);
