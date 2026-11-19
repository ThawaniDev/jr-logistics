import { z } from "zod";
import { defineRoutes } from "../router";
import { uuid } from "../schemas";
import { codDrivers, financeOverview, invoiceTotals, ledgerTotals, settlementStats, withdrawalStats } from "@/server/finance-views";

const bo = "backoffice" as const;
const range = { from: z.coerce.date().optional(), to: z.coerce.date().optional() };

// Aggregates for the redesigned finance pages. Each route checks the permission of the page it feeds (see finance-views.ts).
defineRoutes([
  { method: "GET", path: "/admin/finance/overview", auth: bo, handler: ({ user }) => financeOverview(user) },
  { method: "GET", path: "/admin/finance/settlements/stats", auth: bo, query: z.object({ q: z.string().max(80).optional(), payeeId: uuid.optional(), businessId: uuid.optional(), ...range }), handler: ({ user, q }) => settlementStats(user, q) },
  { method: "GET", path: "/admin/finance/withdrawals/stats", auth: bo, handler: ({ user }) => withdrawalStats(user) },
  { method: "GET", path: "/admin/finance/ledger/totals", auth: bo, query: z.object({ kind: z.string().optional(), userId: uuid.optional(), requestId: uuid.optional(), ...range }), handler: ({ user, q }) => ledgerTotals(user, q) },
  { method: "GET", path: "/admin/finance/invoices/totals", auth: bo, query: z.object({ businessId: uuid.optional(), ...range }), handler: ({ user, q }) => invoiceTotals(user, q) },
  { method: "GET", path: "/admin/finance/cod/drivers", auth: bo, query: z.object({ businessId: uuid.optional(), q: z.string().max(80).optional(), onlyOutstanding: z.enum(["1", "0"]).optional() }), handler: ({ user, q }) => codDrivers(user, { ...q, onlyOutstanding: q.onlyOutstanding === "1" }) },
]);
