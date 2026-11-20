import { z } from "zod";
import { defineRoutes } from "../router";
import { orderOverview } from "@/server/details-orders";
import { orderOffers } from "@/server/details-orders-offers";
import { orderParcels, orderParcelsCsv } from "@/server/details-orders-parcels";
import { orderMoney } from "@/server/details-orders-money";
import { orderCommunication } from "@/server/details-orders-comms";
import { parcelDetail } from "@/server/details-orders-parcel";

const bo = "backoffice" as const;
const page = z.coerce.number().int().min(1).max(1000).optional();
const flag = z.enum(["1", "true"]).optional().transform((v) => !!v);
const parcelQuery = z.object({
  status: z.string().max(120).optional(), offerId: z.string().max(40).optional(), city: z.string().max(40).optional(), q: z.string().trim().max(80).optional(),
  cod: flag, incomplete: flag, format: z.enum(["json", "csv"]).optional(), page, pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

// Order (request) and parcel detail views. Order sections: /overview (header, KPIs, milestones, charts, alerts), /offers (driver cards), /parcels (manifest, CSV with reports.export),
// /money (finance.view), /communication (chat, messages, notifications). Parcel: /admin/shipments/:id/detail. The order's own `requests.view` check lives in loadOrder().
defineRoutes([
  { method: "GET", path: "/admin/requests/:id/overview", auth: bo, handler: ({ user, params }) => orderOverview(user, params.id) },
  { method: "GET", path: "/admin/requests/:id/offers", auth: bo, handler: ({ user, params }) => orderOffers(user, params.id) },
  { method: "GET", path: "/admin/requests/:id/parcels", auth: bo, query: parcelQuery, handler: async ({ user, params, q }) => {
    if (q.format !== "csv") return orderParcels(user, params.id, q);
    const r = await orderParcelsCsv(user, params.id, q);
    return new Response(r.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="parcels-${r.ref.replace(/[^\w.-]+/g, "_")}.csv"`, "cache-control": "no-store" } });
  } },
  { method: "GET", path: "/admin/requests/:id/money", auth: bo, query: z.object({ page }), handler: ({ user, params, q }) => orderMoney(user, params.id, q) },
  { method: "GET", path: "/admin/requests/:id/communication", auth: bo, query: z.object({ page }), handler: ({ user, params, q }) => orderCommunication(user, params.id, q) },
  { method: "GET", path: "/admin/shipments/:id/detail", auth: bo, handler: ({ user, params }) => parcelDetail(user, params.id) },
]);
