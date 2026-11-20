import { sql, type SQL } from "drizzle-orm";
import { codRemittances } from "@/db/schema";
import { inWindow, PARCEL_OUTCOME_AT as OUT, scope } from "./conditions";
import type { Row } from "./finance-core";
import { num, rows } from "./guard";
import { defineTable, type DrillQuery } from "./registry";
import { PARCEL_FROM, REMIT_FROM, remitScope } from "./cod-facts";
import { heldOrders } from "./cod-live";

/** Drill-down tables of the COD report (`/admin/analytics/cod/table/<name>`). They list amounts, so each needs `finance.view` on top of `reports.view`. */
const NEEDS = ["finance.view" as const];
async function page(select: SQL, from: SQL, where: SQL, { limit, offset, order }: DrillQuery) {
  const [list, [t]] = await Promise.all([
    rows<Row>(sql`select ${select} ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`),
    rows<Row>(sql`select count(*)::int as n ${from} where ${where}`),
  ]);
  return { rows: list, total: num(t?.n) };
}

/** Orders whose driver still holds cash, oldest cash first (as of now: the period does not apply). */
defineTable({
  report: "cod", name: "outstanding", title: "rpd.tbl_cod_outstanding", needs: NEEDS,
  columns: [
    { key: "ref", label: "rpf.col_ref", type: "link", href: "/admin/requests/{requestId}", sub: "company" }, { key: "driver", label: "rpf.col_driver", type: "text" },
    { key: "parcels", label: "rpd.col_cod_parcels", type: "number", align: "end", phone: false }, { key: "collectedCents", label: "rpd.col_collected", type: "money", align: "end", phone: false },
    { key: "receivedCents", label: "rpd.col_received", type: "money", align: "end", phone: false }, { key: "outstandingCents", label: "rpd.col_outstanding", type: "money", align: "end" },
    { key: "firstAt", label: "rpd.col_first_collected", type: "datetime", phone: false }, { key: "ageDays", label: "rpd.col_age_days", type: "number", align: "end" },
  ],
  sorts: { ref: sql`h.ref`, driver: sql`du.name`, parcels: sql`h.parcels`, collectedCents: sql`h.collected`, receivedCents: sql`h.received`, outstandingCents: sql`h.outstanding`, firstAt: sql`h.first_at`, ageDays: sql`h.age_days` },
  defaultSort: { key: "ageDays", dir: "desc" }, tiebreak: sql`h.offer_id`,
  query: (q) => page(
    sql`h.offer_id as id, h.request_id as "requestId", h.ref, coalesce(bp.company_name, bu.name) as company, du.name as driver, h.parcels, h.collected as "collectedCents", h.received as "receivedCents", h.outstanding as "outstandingCents", h.first_at as "firstAt", floor(h.age_days)::int as "ageDays"`,
    sql`from (${heldOrders(q.filters)}) h left join users du on du.id = h.driver::uuid left join users bu on bu.id = h.company::uuid left join business_profiles bp on bp.user_id = bu.id`, sql`h.outstanding > 0`, q),
});

/** Cash received back from drivers in the period (who received it, which order, how much). */
defineTable({
  report: "cod", name: "remittances", title: "rpd.tbl_cod_remittances", needs: NEEDS,
  columns: [
    { key: "ref", label: "rpd.col_receipt", type: "text" }, { key: "orderRef", label: "rpf.col_ref", type: "link", href: "/admin/requests/{requestId}", sub: "company" }, { key: "driver", label: "rpf.col_driver", type: "text", phone: false },
    { key: "amountCents", label: "rpd.col_amount", type: "money", align: "end" }, { key: "receivedBy", label: "rpd.col_received_by", type: "text", phone: false }, { key: "receivedByRole", label: "rpd.col_role", type: "enum", ns: "role", phone: false },
    { key: "note", label: "rpd.col_note", type: "text", phone: false }, { key: "createdAt", label: "rpd.col_recorded", type: "datetime" },
  ],
  sorts: { ref: sql`cod_remittances.ref`, orderRef: sql`requests.ref`, driver: sql`du.name`, amountCents: sql`cod_remittances.amount_cents`, receivedBy: sql`ru.name`, createdAt: sql`cod_remittances.created_at` },
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`cod_remittances.id`,
  query: (q) => page(
    sql`cod_remittances.id, cod_remittances.ref, cod_remittances.request_id as "requestId", requests.ref as "orderRef", coalesce(bp.company_name, bu.name) as company, du.name as driver, cod_remittances.amount_cents as "amountCents",
      ru.name as "receivedBy", cod_remittances.received_by_role as "receivedByRole", cod_remittances.note, cod_remittances.created_at as "createdAt"`,
    sql`${REMIT_FROM} join users du on du.id = cod_remittances.driver_id join users ru on ru.id = cod_remittances.received_by join users bu on bu.id = cod_remittances.business_id left join business_profiles bp on bp.user_id = bu.id`,
    sql`${remitScope(q.filters)} and ${inWindow(codRemittances.createdAt, q.filters.cur)}`, q),
});

/** COD parcels delivered in the period: the cash that was due and what the driver recorded. */
defineTable({
  report: "cod", name: "collected", title: "rpd.tbl_cod_collected", needs: NEEDS,
  columns: [
    { key: "code", label: "rpd.col_parcel", type: "link", href: "/admin/parcels/{id}", sub: "company" }, { key: "driver", label: "rpf.col_driver", type: "text", phone: false },
    { key: "dueCents", label: "rpd.col_due", type: "money", align: "end" }, { key: "collectedCents", label: "rpd.col_collected", type: "money", align: "end" },
    { key: "collectedAt", label: "rpd.col_collected_at", type: "datetime" }, { key: "deliveredAt", label: "rpd.col_delivered_at", type: "datetime", phone: false },
  ],
  sorts: { code: sql`shipments.code`, driver: sql`du.name`, dueCents: sql`shipments.cod_cents`, collectedCents: sql`shipments.cod_collected_cents`, collectedAt: sql`shipments.cod_collected_at`, deliveredAt: sql`shipments.delivered_at` },
  defaultSort: { key: "collectedAt", dir: "desc" }, tiebreak: sql`shipments.id`,
  query: (q) => page(
    sql`shipments.id, shipments.request_id as "requestId", shipments.code, coalesce(bp.company_name, bu.name) as company, du.name as driver, shipments.cod_cents as "dueCents", shipments.cod_collected_cents as "collectedCents",
      shipments.cod_collected_at as "collectedAt", shipments.delivered_at as "deliveredAt"`,
    sql`${PARCEL_FROM} join users bu on bu.id = requests.business_id left join business_profiles bp on bp.user_id = bu.id left join offers on offers.id = shipments.offer_id left join users du on du.id = offers.driver_id`,
    sql`${scope(q.filters, "shipments")} and shipments.cod_cents > 0 and shipments.status = 'delivered' and ${inWindow(OUT, q.filters.cur)}`, q),
});
