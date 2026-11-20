import { sql, type SQL } from "drizzle-orm";
import { OFFER_STATUS, REQUEST_STATUS, SHIPMENT_STATUS, STOP_FAIL_REASONS, VEHICLE_TYPES, CUSTODY_ITEM_TYPES } from "../catalog";
import { col, createdAt, flt, type Column, inList, mapShared, REQ_MAP, scopeOf, secs, START_STATUSES, startStatusSql } from "./explorer-core";
import { defineDataset } from "./explorer-registry";

const COMPANY = sql`coalesce(bp.company_name, bu.name)`;
const COMPANY_JOIN = sql`join users bu on bu.id = requests.business_id left join business_profiles bp on bp.user_id = bu.id`;
const SOURCES = ["system", "apply", "manual", "office", "replacement"] as const;
const CITY_COL = (key: string, e: SQL, o: Partial<Column> = {}) => col(key, "enum", e, { ns: "city", ...o });

defineDataset({
  key: "requests", group: "operations", from: sql`from requests ${COMPANY_JOIN}`, id: sql`requests.id`, time: { sql: sql`requests.created_at`, label: "rpq.t_created" }, ...scopeOf("requests"),
  columns: [
    col("ref", "link", sql`requests.ref`, { href: "/admin/requests/{id}", default: true }), col("company", "text", COMPANY, { default: true }),
    col("service", "enum", sql`requests.service`, { ns: "svc", default: true }), col("status", "status", sql`requests.status`, { ns: "status", values: REQUEST_STATUS, default: true }),
    col("vehicleType", "enum", sql`requests.vehicle_type`, { ns: "vehicle", values: VEHICLE_TYPES }), col("temperature", "enum", sql`requests.temperature`, { ns: "temp", values: ["dry", "cold"] }),
    CITY_COL("pickupCity", sql`requests.pickup_city`), CITY_COL("deliveryCity", sql`requests.delivery_city`, { default: true }),
    col("quantity", "number", sql`requests.quantity`, { default: true }), col("slotsFilled", "number", sql`requests.slots_filled`), col("shipmentsPerDriver", "number", sql`requests.shipments_per_driver`), col("durationDays", "number", sql`requests.duration_days`),
    col("parcels", "number", sql`(select count(*)::int from shipments s where s.request_id = requests.id)`, { sort: false, default: true }),
    col("unitPriceCents", "money", sql`requests.unit_price_cents`, { money: true }), col("totalCents", "money", sql`requests.total_cents`, { money: true, default: true }), col("reservedCents", "money", sql`requests.reserved_cents`, { money: true }),
    col("channel", "enum", sql`requests.created_via`, { values: ["web", "api", "mobile"] }), col("allowPartial", "bool", sql`requests.allow_partial`), col("title", "text", sql`requests.title`),
    col("pickupAddress", "text", sql`requests.pickup_address`), col("deliveryAddress", "text", sql`requests.delivery_address`, { mask: "text" }),
    col("recipientName", "text", sql`requests.recipient_name`, { mask: "text" }), col("recipientPhone", "text", sql`requests.recipient_phone`, { mask: "phone" }),
    col("startsAt", "datetime", sql`requests.starts_at`, { default: true }), createdAt(sql`requests.created_at`, { default: true }), col("publishedAt", "datetime", sql`requests.published_at`),
    col("firstOfferAt", "datetime", sql`requests.first_offer_at`), col("firstAcceptedAt", "datetime", sql`requests.first_accepted_at`), col("filledAt", "datetime", sql`requests.filled_at`),
    col("startedAt", "datetime", sql`requests.started_at`), col("completedAt", "datetime", sql`requests.completed_at`), col("cancelledAt", "datetime", sql`requests.cancelled_at`),
    col("lastActivityAt", "datetime", sql`requests.last_activity_at`), col("cancelReason", "text", sql`requests.cancel_reason`),
    col("timeToFillSecs", "duration", secs(sql`requests.published_at`, sql`requests.filled_at`)),
  ],
  filters: [
    flt("status", "enum", sql`requests.status`, { ns: "status", values: REQUEST_STATUS }), flt("service", "enum", sql`requests.service`, { ns: "svc", values: ["delivery_driver", "car_with_driver", "car_without_driver"] }),
    flt("filled", "flag", sql`requests.slots_filled >= requests.quantity`), flt("hasDriver", "flag", sql`requests.slots_filled > 0`), flt("partial", "flag", sql`requests.allow_partial`),
    flt("quantity", "num", sql`requests.quantity`), flt("total", "num", sql`requests.total_cents`, { money: true }), flt("starts", "date", sql`requests.starts_at`), flt("cancelReason", "text", sql`requests.cancel_reason`),
  ],
  search: [sql`requests.ref`, sql`requests.title`, sql`bp.company_name`, sql`bu.name`], searchPii: [sql`requests.recipient_name`, sql`requests.recipient_phone`],
  defaultSort: { key: "createdAt", dir: "desc" },
});

defineDataset({
  key: "parcels", group: "operations", id: sql`shipments.id`, time: { sql: sql`shipments.created_at`, label: "rpq.t_created" }, ...scopeOf("shipments"),
  from: sql`from shipments join requests on requests.id = shipments.request_id ${COMPANY_JOIN} left join offers on offers.id = shipments.offer_id left join users du on du.id = offers.driver_id`,
  columns: [
    col("code", "link", sql`shipments.code`, { href: "/admin/requests/{requestId}", fields: { requestId: sql`requests.id` }, default: true }), col("requestRef", "text", sql`requests.ref`, { default: true }),
    col("externalRef", "text", sql`shipments.external_ref`), col("status", "status", sql`shipments.status`, { ns: "status", values: SHIPMENT_STATUS, default: true }),
    col("recipientType", "enum", sql`shipments.recipient_type`, { values: ["consumer", "business"] }), col("recipientName", "text", sql`shipments.recipient_name`, { mask: "text", default: true }),
    col("recipientPhone", "text", sql`shipments.recipient_phone`, { mask: "phone" }), col("address", "text", sql`shipments.address`, { mask: "text" }), CITY_COL("city", sql`shipments.city`, { default: true }),
    col("company", "text", COMPANY, { default: true }), col("driver", "text", sql`du.name`, { default: true }),
    col("attempts", "number", sql`shipments.attempts`), col("deferCount", "number", sql`shipments.defer_count`), col("failReason", "enum", sql`shipments.fail_reason`, { ns: "stopfail", values: STOP_FAIL_REASONS }),
    col("proofType", "enum", sql`shipments.proof_type`, { values: ["otp", "receipt"] }), col("loadedVia", "enum", sql`shipments.loaded_via`, { values: ["warehouse", "driver_scan"] }),
    col("codCents", "money", sql`shipments.cod_cents`, { money: true }), col("codCollectedCents", "money", sql`shipments.cod_collected_cents`, { money: true }), col("codCollectedAt", "datetime", sql`shipments.cod_collected_at`),
    col("detailsComplete", "bool", sql`shipments.details_complete`), col("partnerStatus", "text", sql`shipments.partner_status`), col("deliveredDistanceM", "number", sql`shipments.delivered_distance_m`),
    createdAt(sql`shipments.created_at`, { default: true }), col("loadedAt", "datetime", sql`shipments.loaded_at`), col("arrivedAt", "datetime", sql`shipments.arrived_at`),
    col("deliveredAt", "datetime", sql`shipments.delivered_at`, { default: true }), col("failedAt", "datetime", sql`shipments.failed_at`), col("returnedAt", "datetime", sql`shipments.returned_at`),
    col("loadToDeliverySecs", "duration", secs(sql`shipments.loaded_at`, sql`shipments.delivered_at`)),
  ],
  filters: [
    flt("status", "enum", sql`shipments.status`, { ns: "status", values: SHIPMENT_STATUS }), flt("recipientType", "enum", sql`shipments.recipient_type`, { values: ["consumer", "business"] }),
    flt("failReason", "enum", sql`shipments.fail_reason`, { ns: "stopfail", values: STOP_FAIL_REASONS }), flt("cod", "flag", sql`shipments.cod_cents > 0`), flt("unassigned", "flag", sql`shipments.offer_id is null`),
    flt("fromPartner", "flag", sql`shipments.partner_id is not null`), flt("attempts", "num", sql`shipments.attempts`), flt("delivered", "date", sql`shipments.delivered_at`),
  ],
  search: [sql`shipments.code`, sql`shipments.external_ref`, sql`requests.ref`], searchPii: [sql`shipments.recipient_name`, sql`shipments.recipient_phone`, sql`shipments.address`],
  defaultSort: { key: "createdAt", dir: "desc" },
});

/** The columns of an offer joined to its request, driver, office and company (shared by jobs, cancellations and start punctuality). */
const OFFER_FROM = sql`from offers join requests on requests.id = offers.request_id join users du on du.id = offers.driver_id left join users ou on ou.id = offers.office_id ${COMPANY_JOIN}`;
const offerCols = () => [
  col("requestRef", "link", sql`requests.ref`, { href: "/admin/requests/{requestId}", fields: { requestId: sql`requests.id` }, default: true }), col("company", "text", COMPANY, { default: true }),
  col("driver", "link", sql`du.name`, { href: "/admin/drivers/{driverId}", fields: { driverId: sql`offers.driver_id` }, default: true }), col("office", "text", sql`ou.name`),
];
const OFFER_STATUS_COL = () => col("status", "status", sql`offers.status`, { ns: "jobstatus", values: OFFER_STATUS, default: true });
const START_COLS = () => [
  col("startsAt", "datetime", sql`requests.starts_at`, { default: true }), col("arrivedAt", "datetime", sql`offers.arrived_at`, { default: true }),
  col("delayMin", "number", sql`(case when offers.arrived_at is not null then round(greatest(0, extract(epoch from (offers.arrived_at - requests.starts_at)) / 60)) end)::float8`),
  col("startStatus", "enum", startStatusSql, { ns: "rpq.start", values: START_STATUSES, default: true }),
];

defineDataset({
  key: "jobs", group: "operations", from: OFFER_FROM, id: sql`offers.id`, time: { sql: sql`offers.created_at`, label: "rpq.t_created" }, ...scopeOf("offers"),
  columns: [
    ...offerCols(), OFFER_STATUS_COL(), col("source", "enum", sql`offers.source`, { values: SOURCES }), col("isReplacement", "bool", sql`offers.is_replacement`),
    col("service", "enum", sql`requests.service`, { ns: "svc" }), CITY_COL("deliveryCity", sql`requests.delivery_city`),
    col("expectedUnits", "number", sql`offers.expected_units`), col("loadedUnits", "number", sql`offers.loaded_units`), col("deliveredUnits", "number", sql`offers.delivered_units`), col("finalUnits", "number", sql`offers.final_units`, { default: true }),
    col("expectedEarningCents", "money", sql`offers.expected_earning_cents`, { money: true }), ...START_COLS(),
    createdAt(sql`offers.created_at`, { default: true }), col("acceptedAt", "datetime", sql`offers.accepted_at`), col("attendanceAt", "datetime", sql`offers.attendance_at`), col("routeApprovedAt", "datetime", sql`offers.route_approved_at`),
    col("loadedAt", "datetime", sql`offers.loaded_at`), col("deliveredAt", "datetime", sql`offers.delivered_at`), col("finalAt", "datetime", sql`offers.final_at`), col("cancelledAt", "datetime", sql`offers.cancelled_at`), col("cancelReason", "text", sql`offers.cancel_reason`),
  ],
  filters: [
    flt("status", "enum", sql`offers.status`, { ns: "jobstatus", values: OFFER_STATUS }), flt("source", "enum", sql`offers.source`, { values: SOURCES }), flt("startStatus", "enum", startStatusSql, { ns: "rpq.start", values: START_STATUSES }),
    flt("accepted", "flag", sql`offers.accepted_at is not null`), flt("replacement", "flag", sql`offers.is_replacement`), flt("finalUnits", "num", sql`offers.final_units`), flt("acceptedOn", "date", sql`offers.accepted_at`),
  ],
  search: [sql`requests.ref`, sql`du.name`, sql`ou.name`, sql`bp.company_name`, sql`bu.name`], defaultSort: { key: "createdAt", dir: "desc" },
});

defineDataset({
  key: "cancellations", group: "operations", from: OFFER_FROM, base: sql`offers.status in ('cancelled', 'no_show', 'replaced')`, id: sql`offers.id`, time: { sql: sql`coalesce(offers.cancelled_at, offers.updated_at)`, label: "rpq.t_cancelled" }, ...scopeOf("offers"),
  columns: [
    ...offerCols(), OFFER_STATUS_COL(), col("cancelReason", "text", sql`offers.cancel_reason`, { default: true }), col("cancelledAt", "datetime", sql`coalesce(offers.cancelled_at, offers.updated_at)`, { default: true }),
    col("startsAt", "datetime", sql`requests.starts_at`, { default: true }), col("acceptedAt", "datetime", sql`offers.accepted_at`), createdAt(sql`offers.created_at`),
    col("noticeSecs", "duration", secs(sql`coalesce(offers.cancelled_at, offers.updated_at)`, sql`requests.starts_at`)),
  ],
  filters: [flt("status", "enum", sql`offers.status`, { ns: "jobstatus", values: ["cancelled", "no_show", "replaced"] }), flt("accepted", "flag", sql`offers.accepted_at is not null`), flt("reason", "text", sql`offers.cancel_reason`)],
  search: [sql`requests.ref`, sql`du.name`, sql`bp.company_name`, sql`bu.name`, sql`offers.cancel_reason`], defaultSort: { key: "cancelledAt", dir: "desc" },
});

defineDataset({
  key: "start-sla", group: "operations", from: OFFER_FROM, base: sql`offers.accepted_at is not null`, id: sql`offers.id`, time: { sql: sql`requests.starts_at`, label: "rpq.t_starts" }, ...scopeOf("offers"),
  columns: [...offerCols(), ...START_COLS(), OFFER_STATUS_COL(), CITY_COL("deliveryCity", sql`requests.delivery_city`)],
  filters: [flt("startStatus", "enum", startStatusSql, { ns: "rpq.start", values: START_STATUSES }), flt("status", "enum", sql`offers.status`, { ns: "jobstatus", values: OFFER_STATUS }), flt("delay", "num", sql`(case when offers.arrived_at is not null then greatest(0, extract(epoch from (offers.arrived_at - requests.starts_at)) / 60) end)`)],
  search: [sql`requests.ref`, sql`du.name`, sql`bp.company_name`, sql`bu.name`], defaultSort: { key: "startsAt", dir: "desc" },
});

defineDataset({
  key: "custody", group: "operations", id: sql`custody_items.id`, time: { sql: sql`custody_items.created_at`, label: "rpq.t_created" },
  from: sql`from custody_items join requests on requests.id = custody_items.request_id join offers on offers.id = custody_items.offer_id join users du on du.id = offers.driver_id ${COMPANY_JOIN} left join users hb on hb.id = custody_items.handed_over_by`,
  ...mapShared({
    ...REQ_MAP, company: (v) => inList(sql`requests.business_id`, v), driver: (v) => inList(sql`offers.driver_id`, v), office: (v) => inList(sql`offers.office_id`, v),
  }),
  columns: [
    col("requestRef", "link", sql`requests.ref`, { href: "/admin/requests/{requestId}", fields: { requestId: sql`requests.id` }, default: true }), col("company", "text", COMPANY, { default: true }), col("driver", "text", sql`du.name`, { default: true }),
    col("itemType", "enum", sql`custody_items.item_type`, { ns: "custody", values: CUSTODY_ITEM_TYPES, default: true }), col("qty", "number", sql`custody_items.qty`, { default: true }),
    col("status", "status", sql`custody_items.status`, { ns: "status", values: ["handed_over", "acknowledged", "returned", "not_returned", "damaged"], default: true }),
    col("description", "text", sql`custody_items.description`), col("handedOverBy", "text", sql`hb.name`), col("acknowledgedAt", "datetime", sql`custody_items.acknowledged_at`), col("returnedAt", "datetime", sql`custody_items.returned_at`),
    col("returnNote", "text", sql`custody_items.return_note`), createdAt(sql`custody_items.created_at`, { default: true }),
  ],
  filters: [
    flt("status", "enum", sql`custody_items.status`, { ns: "status", values: ["handed_over", "acknowledged", "returned", "not_returned", "damaged"] }), flt("itemType", "enum", sql`custody_items.item_type`, { ns: "custody", values: CUSTODY_ITEM_TYPES }),
    flt("outstanding", "flag", sql`custody_items.returned_at is null`),
  ],
  search: [sql`requests.ref`, sql`du.name`, sql`custody_items.description`], defaultSort: { key: "createdAt", dir: "desc" },
});
