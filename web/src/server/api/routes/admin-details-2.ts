import { z } from "zod";
import { defineRoutes } from "../router";
import { PERIOD_KEYS, GROUP_STATUSES, PARCEL_GROUPS } from "@/server/details-people-lib";
import { driverInsights, driverStanding } from "@/server/details-people";
import { driverOffers, driverParcels, driverParcelsCsv, driverReviews } from "@/server/details-people-driver";
import { driverLocation, ownerDocuments, ownerRaw, ownerSecurity } from "@/server/details-people-owner";
import { moneyPart, moneySummary } from "@/server/details-people-money";
import { officeInsights } from "@/server/details-people-office";
import { SCORE_SORTS, SCORE_STATES, officeAgreementHistory, officeDriverEvents, officeDriverHistory, officeJobLog, officeScorecard } from "@/server/details-people-office-2";

// Driver and courier-office detail views (decisions G6–G7): performance, jobs, parcels, location, money, documents, security, reviews, raw record.
// Every route is read-only and checks its own permission in the service; unknown ids are 404. `/admin/drivers/:id/{overview,jobs,wallet}` and `/admin/offices/:id…` stay in admin-offices.ts.
const bo = "backoffice" as const;
const period = z.enum(PERIOD_KEYS).optional();
const page = z.coerce.number().int().min(1).max(10_000).optional();
const pageSize = z.coerce.number().int().min(1).max(100).optional();
const text = z.string().trim().max(80).optional();
const groups = z.enum(["all", ...Object.keys(GROUP_STATUSES)] as [string, ...string[]]).optional();
const list = z.object({ period, group: groups, q: text, page, pageSize, driverId: z.string().uuid().optional() });
const parcels = z.object({ period, group: z.enum(PARCEL_GROUPS).optional(), q: text, reason: z.string().max(40).optional(), city: z.string().max(40).optional(), page, pageSize, format: z.literal("csv").optional() });
const paged = z.object({ page, pageSize });
const moneyQ = z.object({ page, pageSize, status: z.enum(["pending", "paid", "rejected"]).optional(), kind: z.string().max(30).optional() });
const csv = (body: string, name: string) => new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="parcels-${name.replace(/[^\w.-]+/g, "_").slice(0, 40)}.csv"`, "cache-control": "no-store" } });

defineRoutes([
  // ── Driver ──
  { method: "GET", path: "/admin/drivers/:id/standing", auth: bo, handler: ({ user, params }) => driverStanding(user, params.id) },
  { method: "GET", path: "/admin/drivers/:id/insights", auth: bo, query: z.object({ period }), handler: ({ user, params, q }) => driverInsights(user, params.id, q.period) },
  { method: "GET", path: "/admin/drivers/:id/offers", auth: bo, query: list, handler: ({ user, params, q }) => driverOffers(user, params.id, q) },
  { method: "GET", path: "/admin/drivers/:id/parcels", auth: bo, query: parcels, handler: async ({ user, params, q }) => { if (q.format === "csv") { const r = await driverParcelsCsv(user, params.id, q); return csv(r.csv, r.name); } return driverParcels(user, params.id, q); } },
  { method: "GET", path: "/admin/drivers/:id/reviews", auth: bo, query: z.object({ stars: z.coerce.number().int().min(1).max(5).optional(), page, pageSize }), handler: ({ user, params, q }) => driverReviews(user, params.id, q) },
  { method: "GET", path: "/admin/drivers/:id/location", auth: bo, handler: ({ user, params }) => driverLocation(user, params.id) },
  { method: "GET", path: "/admin/drivers/:id/documents-log", auth: bo, handler: ({ user, params }) => ownerDocuments(user, params.id, "driver") },
  { method: "GET", path: "/admin/drivers/:id/security", auth: bo, query: paged, handler: ({ user, params, q }) => ownerSecurity(user, params.id, "driver", q) },
  { method: "GET", path: "/admin/drivers/:id/raw", auth: bo, handler: ({ user, params }) => ownerRaw(user, params.id, "driver") },
  { method: "GET", path: "/admin/drivers/:id/money", auth: bo, handler: ({ user, params }) => moneySummary(user, params.id, "driver") },
  { method: "GET", path: "/admin/drivers/:id/money/:part", auth: bo, query: moneyQ, handler: ({ user, params, q }) => moneyPart(user, params.id, "driver", params.part, q) },

  // ── Courier office ──
  { method: "GET", path: "/admin/offices/:id/insights", auth: bo, query: z.object({ period }), handler: ({ user, params, q }) => officeInsights(user, params.id, q.period) },
  { method: "GET", path: "/admin/offices/:id/scorecard", auth: bo, query: z.object({ period, q: text, state: z.enum(SCORE_STATES).optional(), sort: z.enum(SCORE_SORTS).optional(), dir: z.enum(["asc", "desc"]).optional(), page, pageSize }), handler: ({ user, params, q }) => officeScorecard(user, params.id, q) },
  { method: "GET", path: "/admin/offices/:id/driver-history", auth: bo, handler: ({ user, params }) => officeDriverHistory(user, params.id) },
  { method: "GET", path: "/admin/offices/:id/driver-events", auth: bo, query: paged, handler: ({ user, params, q }) => officeDriverEvents(user, params.id, q) },
  { method: "GET", path: "/admin/offices/:id/job-log", auth: bo, query: list, handler: ({ user, params, q }) => officeJobLog(user, params.id, q) },
  { method: "GET", path: "/admin/offices/:id/agreement-history", auth: bo, handler: ({ user, params }) => officeAgreementHistory(user, params.id) },
  { method: "GET", path: "/admin/offices/:id/documents-log", auth: bo, handler: ({ user, params }) => ownerDocuments(user, params.id, "office") },
  { method: "GET", path: "/admin/offices/:id/security", auth: bo, query: paged, handler: ({ user, params, q }) => ownerSecurity(user, params.id, "office", q) },
  { method: "GET", path: "/admin/offices/:id/raw", auth: bo, handler: ({ user, params }) => ownerRaw(user, params.id, "office") },
  { method: "GET", path: "/admin/offices/:id/money", auth: bo, handler: ({ user, params }) => moneySummary(user, params.id, "office") },
  { method: "GET", path: "/admin/offices/:id/money/:part", auth: bo, query: moneyQ, handler: ({ user, params, q }) => moneyPart(user, params.id, "office", params.part, q) },
]);
