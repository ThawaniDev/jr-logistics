import { sql, type SQL } from "drizzle-orm";
import { shipments } from "@/db/schema";
import { inWindow, PARCEL_OUTCOME_AT as OUT, scope } from "./conditions";
import { secsBetween, type Row } from "./finance-core";
import { num, rows } from "./guard";
import { defineTable, type DrillColumn, type DrillQuery } from "./registry";

/** Drill-down tables of the Deliveries report (`/admin/analytics/deliveries/table/<name>`): parcels, failed parcels, slow deliveries, returns outstanding. */
const FROM = sql`from shipments join requests on requests.id = shipments.request_id join users bu on bu.id = requests.business_id left join business_profiles bp on bp.user_id = bu.id
  left join offers on offers.id = shipments.offer_id left join users du on du.id = offers.driver_id`;
const WHO = sql`shipments.id, shipments.request_id as "requestId", shipments.code, shipments.status, shipments.city, coalesce(bp.company_name, bu.name) as company, du.name as driver`;
const LOAD_TO_DONE = secsBetween(shipments.loadedAt, shipments.deliveredAt);
const DWELL = secsBetween(shipments.arrivedAt, shipments.deliveredAt);

const code: DrillColumn = { key: "code", label: "rpd.col_parcel", type: "link", href: "/admin/parcels/{id}", sub: "company" };
const city: DrillColumn = { key: "city", label: "rpd.col_city", type: "enum", ns: "city", phone: false };
const driver: DrillColumn = { key: "driver", label: "rpf.col_driver", type: "text", phone: false };
const status: DrillColumn = { key: "status", label: "rpf.col_status", type: "status", ns: "shipstatus" };
const reason: DrillColumn = { key: "failReason", label: "rpd.col_reason", type: "enum", ns: "stopfail" };
const created: DrillColumn = { key: "createdAt", label: "rpf.col_created", type: "datetime", phone: false };
const SORT = { code: sql`shipments.code`, status: sql`shipments.status`, city: sql`shipments.city`, driver: sql`du.name`, createdAt: sql`shipments.created_at`, failReason: sql`shipments.fail_reason` };

async function page(select: SQL, where: SQL, { limit, offset, order }: DrillQuery) {
  const [list, [t]] = await Promise.all([
    rows<Row>(sql`select ${select} ${FROM} where ${where} order by ${order} limit ${limit} offset ${offset}`),
    rows<Row>(sql`select count(*)::int as n ${FROM} where ${where}`),
  ]);
  return { rows: list, total: num(t?.n) };
}

defineTable({
  report: "deliveries", name: "parcels", title: "rpd.tbl_parcels",
  columns: [code, status, city, { key: "recipientType", label: "rpd.col_recipient", type: "enum", ns: "rtype", phone: false }, driver,
    { key: "attempts", label: "rpd.col_attempts", type: "number", align: "end", phone: false }, { key: "proofType", label: "rpd.col_proof", type: "enum", ns: "rpd.proof", phone: false },
    { key: "distanceM", label: "rpd.col_distance", type: "number", align: "end", phone: false }, { key: "deliverySecs", label: "rpd.col_delivery_time", type: "duration", align: "end", phone: false },
    reason, created, { key: "outcomeAt", label: "rpd.col_outcome_at", type: "datetime" }],
  sorts: { ...SORT, recipientType: sql`shipments.recipient_type`, attempts: sql`shipments.attempts`, proofType: sql`shipments.proof_type`, distanceM: sql`shipments.delivered_distance_m`, deliverySecs: sql`"deliverySecs"`, outcomeAt: sql`"outcomeAt"` },
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`shipments.id`,
  query: (q) => page(sql`${WHO}, shipments.recipient_type as "recipientType", shipments.attempts, shipments.proof_type as "proofType", shipments.delivered_distance_m as "distanceM",
      case when shipments.delivered_at >= shipments.loaded_at then ${LOAD_TO_DONE} end as "deliverySecs", shipments.fail_reason as "failReason", shipments.created_at as "createdAt", ${OUT} as "outcomeAt"`,
    sql`${scope(q.filters, "shipments")} and (${inWindow(shipments.createdAt, q.filters.cur)} or ${inWindow(OUT, q.filters.cur)})`, q),
});

defineTable({
  report: "deliveries", name: "failed", title: "rpd.tbl_failed",
  columns: [code, status, city, driver, reason, { key: "failNote", label: "rpd.col_note", type: "text", phone: false }, { key: "failedAt", label: "rpd.col_failed_at", type: "datetime" }, { key: "returnedAt", label: "rpd.col_returned_at", type: "datetime", phone: false }],
  sorts: { ...SORT, failedAt: sql`shipments.failed_at`, returnedAt: sql`shipments.returned_at` },
  defaultSort: { key: "failedAt", dir: "desc" }, tiebreak: sql`shipments.id`,
  query: (q) => page(sql`${WHO}, shipments.fail_reason as "failReason", shipments.fail_note as "failNote", shipments.failed_at as "failedAt", shipments.returned_at as "returnedAt"`,
    sql`${scope(q.filters, "shipments")} and shipments.status in ('failed','returned') and ${inWindow(OUT, q.filters.cur)}`, q),
});

defineTable({
  report: "deliveries", name: "slow", title: "rpd.tbl_slow",
  columns: [code, city, driver, { key: "loadedAt", label: "rpd.col_loaded_at", type: "datetime", phone: false }, { key: "deliveredAt", label: "rpd.col_delivered_at", type: "datetime", phone: false },
    { key: "deliverySecs", label: "rpd.col_delivery_time", type: "duration", align: "end" }, { key: "dwellSecs", label: "rpd.col_dwell", type: "duration", align: "end", phone: false }, { key: "distanceM", label: "rpd.col_distance", type: "number", align: "end", phone: false }],
  sorts: { code: SORT.code, city: SORT.city, driver: SORT.driver, loadedAt: sql`shipments.loaded_at`, deliveredAt: sql`shipments.delivered_at`, deliverySecs: sql`"deliverySecs"`, dwellSecs: sql`"dwellSecs"`, distanceM: sql`shipments.delivered_distance_m` },
  defaultSort: { key: "deliverySecs", dir: "desc" }, tiebreak: sql`shipments.id`,
  query: (q) => page(sql`${WHO}, shipments.loaded_at as "loadedAt", shipments.delivered_at as "deliveredAt", ${LOAD_TO_DONE} as "deliverySecs",
      case when shipments.arrived_at is not null and shipments.delivered_at >= shipments.arrived_at then ${DWELL} end as "dwellSecs",
      shipments.delivered_distance_m as "distanceM"`,
    sql`${scope(q.filters, "shipments")} and shipments.status = 'delivered' and shipments.loaded_at is not null and shipments.delivered_at >= shipments.loaded_at and ${inWindow(shipments.deliveredAt, q.filters.cur)}`, q),
});

/** Parcels that failed and are not back at the warehouse yet: as of now (the period does not apply), oldest first. */
defineTable({
  report: "deliveries", name: "returns-open", title: "rpd.tbl_returns_open",
  columns: [code, city, driver, reason, { key: "failNote", label: "rpd.col_note", type: "text", phone: false }, { key: "failedAt", label: "rpd.col_failed_at", type: "datetime", phone: false }, { key: "ageSecs", label: "rpd.col_waiting", type: "duration", align: "end" }],
  sorts: { ...SORT, failedAt: sql`shipments.failed_at`, ageSecs: sql`extract(epoch from (now() - shipments.failed_at))` },
  defaultSort: { key: "ageSecs", dir: "desc" }, tiebreak: sql`shipments.id`,
  query: (q) => page(sql`${WHO}, shipments.fail_reason as "failReason", shipments.fail_note as "failNote", shipments.failed_at as "failedAt", extract(epoch from (now() - shipments.failed_at))::float8 as "ageSecs"`,
    sql`${scope(q.filters, "shipments")} and shipments.status = 'failed'`, q),
});
