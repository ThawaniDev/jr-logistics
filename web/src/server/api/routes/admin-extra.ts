import { z } from "zod";
import { defineRoutes } from "../router";
import { uuid } from "../schemas";
import { setCreditLimit, listLedger, listInvoices, adjustWallet, listRatings, listCancellations, citySummary, driverOpsProfile } from "@/server/adminviews";

const bo = "backoffice" as const;
const page = z.coerce.number().int().min(1).optional();
const pageSize = z.coerce.number().int().min(1).max(100).optional();
const range = { from: z.coerce.date().optional(), to: z.coerce.date().optional() };

defineRoutes([
  // Finance views
  { method: "GET", path: "/admin/finance/ledger", auth: bo, query: z.object({ page, pageSize, kind: z.string().optional(), userId: uuid.optional(), requestId: uuid.optional(), ...range }), handler: ({ user, q }) => listLedger(user, q) },
  { method: "GET", path: "/admin/finance/invoices", auth: bo, query: z.object({ page, pageSize, businessId: uuid.optional(), ...range }), handler: ({ user, q }) => listInvoices(user, q) },
  { method: "POST", path: "/admin/finance/adjustments", auth: bo, status: 201, body: z.object({ userId: uuid, amountCents: z.number().int().min(-500_000_000).max(500_000_000), reason: z.string().min(5).max(300), idempotencyKey: z.string().min(8).max(80) }), handler: ({ user, input }) => adjustWallet(user, input) },
  { method: "POST", path: "/admin/finance/credit-limit", auth: bo, body: z.object({ userId: uuid, creditLimitCents: z.number().int().min(0).max(1_000_000_000) }), handler: ({ user, input }) => setCreditLimit(user, input.userId, input.creditLimitCents) },
  // Quality & operations views
  { method: "GET", path: "/admin/ratings", auth: bo, query: z.object({ page, pageSize, maxStars: z.coerce.number().int().min(1).max(5).optional() }), handler: ({ user, q }) => listRatings(user, q) },
  { method: "GET", path: "/admin/cancellations", auth: bo, query: z.object({ page, pageSize, ...range }), handler: ({ user, q }) => listCancellations(user, q) },
  { method: "GET", path: "/admin/ops/city-summary", auth: bo, handler: ({ user }) => citySummary(user) },
  { method: "GET", path: "/admin/drivers/:id", auth: bo, handler: ({ user, params }) => driverOpsProfile(user, params.id) },
]);
