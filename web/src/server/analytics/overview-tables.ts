import { sql } from "drizzle-orm";
import { requests, settlements } from "@/db/schema";
import { BILLED, inWindow, NOT_DRAFT, scope } from "./conditions";
import { num, rows } from "./guard";
import { defineTable } from "./registry";

type Row = Record<string, unknown>;

/** Requests created in the period (drafts excluded), one row each. */
defineTable({
  report: "overview", name: "requests", title: "rpf.tbl_requests",
  columns: [
    { key: "ref", label: "rpf.col_ref", type: "link", href: "/admin/requests/{id}", sub: "company" },
    { key: "service", label: "rpf.col_service", type: "enum", ns: "svc", phone: false },
    { key: "pickupCity", label: "rpf.col_from", type: "enum", ns: "city", phone: false },
    { key: "deliveryCity", label: "rpf.col_to", type: "enum", ns: "city" },
    { key: "status", label: "rpf.col_status", type: "status", ns: "status" },
    { key: "quantity", label: "rpf.col_slots", type: "number", align: "end", phone: false },
    { key: "parcels", label: "rpf.col_parcels", type: "number", align: "end" },
    { key: "totalCents", label: "rpf.col_total", type: "money", align: "end" },
    { key: "startsAt", label: "rpf.col_starts", type: "datetime", phone: false },
    { key: "createdAt", label: "rpf.col_created", type: "datetime" },
  ],
  moneyKeys: ["totalCents"],
  sorts: { ref: sql`requests.ref`, service: sql`requests.service`, pickupCity: sql`requests.pickup_city`, deliveryCity: sql`requests.delivery_city`, status: sql`requests.status`, quantity: sql`requests.quantity`, parcels: sql`parcels`, totalCents: sql`requests.total_cents`, startsAt: sql`requests.starts_at`, createdAt: sql`requests.created_at` },
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`requests.id`,
  async query({ filters: f, limit, offset, order }) {
    const where = sql`${scope(f, "requests")} and ${NOT_DRAFT} and ${inWindow(requests.createdAt, f.cur)}`;
    const [list, [t]] = await Promise.all([
      rows<Row>(sql`
        select requests.id, requests.ref, requests.service, requests.status, requests.quantity, requests.total_cents as "totalCents", requests.starts_at as "startsAt", requests.created_at as "createdAt",
          coalesce(bp.company_name, u.name) as company, requests.pickup_city as "pickupCity", requests.delivery_city as "deliveryCity",
          (select count(*)::int from shipments where shipments.request_id = requests.id) as parcels
        from requests join users u on u.id = requests.business_id left join business_profiles bp on bp.user_id = u.id
        where ${where} order by ${order} limit ${limit} offset ${offset}`),
      rows<Row>(sql`select count(*)::int as n from requests where ${where}`),
    ]);
    return { rows: list, total: num(t?.n) };
  },
});

/** Settlements created in the period (billed work), one row each. Finance only. */
defineTable({
  report: "overview", name: "settlements", title: "rpf.tbl_settlements", needs: ["finance.view"],
  columns: [
    { key: "ref", label: "rpf.col_ref", type: "link", href: "/admin/requests/{requestId}", sub: "company" },
    { key: "driver", label: "rpf.col_driver", type: "text" },
    { key: "status", label: "rpf.col_status", type: "status", ns: "settle" },
    { key: "finalUnits", label: "rpf.col_units", type: "number", align: "end", phone: false },
    { key: "customerCents", label: "rpf.col_billed", type: "money", align: "end" },
    { key: "providerCents", label: "rpf.col_provider", type: "money", align: "end", phone: false },
    { key: "marginCents", label: "rpf.col_margin", type: "money", align: "end" },
    { key: "createdAt", label: "rpf.col_created", type: "datetime" },
    { key: "paidAt", label: "rpf.col_paid", type: "datetime", phone: false },
  ],
  sorts: { ref: sql`requests.ref`, status: sql`settlements.status`, finalUnits: sql`settlements.final_units`, customerCents: sql`settlements.customer_cents`, providerCents: sql`settlements.provider_cents`, marginCents: sql`settlements.margin_cents`, createdAt: sql`settlements.created_at`, paidAt: sql`settlements.paid_at` },
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`settlements.id`,
  async query({ filters: f, limit, offset, order }) {
    const where = sql`${scope(f, "settlements")} and ${BILLED} and ${inWindow(settlements.createdAt, f.cur)}`;
    const from = sql`from settlements join requests on requests.id = settlements.request_id`;
    const [list, [t]] = await Promise.all([
      rows<Row>(sql`
        select settlements.id, settlements.request_id as "requestId", requests.ref, settlements.status, settlements.final_units as "finalUnits", settlements.customer_cents as "customerCents",
          settlements.provider_cents as "providerCents", settlements.margin_cents as "marginCents", settlements.created_at as "createdAt", settlements.paid_at as "paidAt",
          (select coalesce(bp.company_name, bu.name) from users bu left join business_profiles bp on bp.user_id = bu.id where bu.id = settlements.business_id) as company,
          (select du.name from users du where du.id = settlements.driver_id) as driver
        ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`),
      rows<Row>(sql`select count(*)::int as n ${from} where ${where}`),
    ]);
    return { rows: list, total: num(t?.n) };
  },
});
