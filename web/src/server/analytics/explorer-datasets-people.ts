import { sql, type SQL } from "drizzle-orm";
import { VEHICLE_TYPES } from "../catalog";
import { col, createdAt, flt, inList, mapShared, type Column } from "./explorer-core";
import { defineDataset } from "./explorer-registry";

const SOURCES = ["self", "admin", "import", "api", "seed"] as const;
const VERIFY = ["pending", "verified", "rejected", "info_requested", "suspended"] as const;
const DOC_STATUS = ["submitted", "under_review", "approved", "rejected", "info_requested"] as const;
const DOC_TYPES = ["national_id", "driving_license", "vehicle_registration", "vehicle_photo", "office_cr", "office_license", "iban_certificate", "other", "business_cr", "tax_certificate"] as const;
const city = (e: SQL, o: Partial<Column> = {}) => col("city", "enum", e, { ns: "city", ...o });
const ACCOUNT_STATUS = ["active", "suspended"] as const;
/** Today on the Riyadh calendar, whatever time zone the database session runs in (`current_date` is the session's day: a UTC database is a day behind from 00:00 to 03:00 Riyadh). */
const RIYADH_TODAY = sql`((now() at time zone 'Asia/Riyadh')::date)`;
/** The columns every account dataset shares (all from `users`). */
const accountCols = (): Column[] => [
  col("phone", "text", sql`users.phone`, { mask: "phone", default: true }), col("email", "text", sql`users.email`, { mask: "email" }),
  col("status", "status", sql`users.status`, { ns: "status", values: ACCOUNT_STATUS, default: true }), col("source", "enum", sql`users.source`, { values: SOURCES }), col("isDemo", "bool", sql`users.is_demo`),
  col("loginCount", "number", sql`users.login_count`), col("lastLoginAt", "datetime", sql`users.last_login_at`), col("lastSeenAt", "datetime", sql`users.last_seen_at`),
  createdAt(sql`users.created_at`, { default: true }),
];
const accountFilters = () => [flt("status", "enum", sql`users.status`, { ns: "status", values: ACCOUNT_STATUS }), flt("source", "enum", sql`users.source`, { values: SOURCES }), flt("demo", "flag", sql`users.is_demo`), flt("signedIn", "flag", sql`users.last_login_at is not null`), flt("lastSeen", "date", sql`users.last_seen_at`)];

defineDataset({
  key: "companies", group: "people", from: sql`from users join business_profiles bp on bp.user_id = users.id`, id: sql`users.id`, time: { sql: sql`users.created_at`, label: "rpq.t_registered" },
  ...mapShared({ city: (v) => inList(sql`users.city`, v), company: (v) => inList(sql`users.id`, v) }),
  columns: [
    col("name", "link", sql`bp.company_name`, { href: "/admin/companies/{id}", default: true }), col("owner", "text", sql`users.name`), city(sql`users.city`, { default: true }),
    col("verificationStatus", "status", sql`bp.verification_status`, { ns: "status", values: VERIFY, default: true }), col("crNumber", "text", sql`bp.cr_number`, { mask: "tail" }), col("taxNumber", "text", sql`bp.tax_number`),
    col("industry", "text", sql`bp.industry`), col("address", "text", sql`bp.address`), col("responsiblePerson", "text", sql`bp.responsible_person`, { mask: "text" }),
    col("ratingAvg", "number", sql`(case when bp.rating_count > 0 then round(bp.rating_sum::numeric / bp.rating_count, 2) end)::float8`), col("ratingCount", "number", sql`bp.rating_count`),
    col("requests", "number", sql`(select count(*)::int from requests r where r.business_id = users.id and r.status <> 'draft')`, { sort: false, default: true }),
    col("hasWarehouse", "bool", sql`bp.warehouse_lat is not null`), ...accountCols(),
  ],
  filters: [flt("verification", "enum", sql`bp.verification_status`, { ns: "status", values: VERIFY }), ...accountFilters(), flt("hasWarehouse", "flag", sql`bp.warehouse_lat is not null`), flt("ratingCount", "num", sql`bp.rating_count`)],
  search: [sql`bp.company_name`, sql`users.name`, sql`bp.cr_number`], searchPii: [sql`users.phone`, sql`users.email`], defaultSort: { key: "createdAt", dir: "desc" },
});

defineDataset({
  key: "offices", group: "people", from: sql`from users join office_profiles op on op.user_id = users.id`, id: sql`users.id`, time: { sql: sql`users.created_at`, label: "rpq.t_registered" },
  ...mapShared({ city: (v) => inList(sql`coalesce(op.city, users.city)`, v), office: (v) => inList(sql`users.id`, v) }),
  columns: [
    col("name", "link", sql`op.office_name`, { href: "/admin/offices/{id}", default: true }), col("owner", "text", sql`users.name`), city(sql`coalesce(op.city, users.city)`, { default: true }),
    col("verificationStatus", "status", sql`op.verification_status`, { ns: "status", values: VERIFY, default: true }), col("crNumber", "text", sql`op.cr_number`, { mask: "tail" }), col("taxNumber", "text", sql`op.tax_number`),
    col("address", "text", sql`op.address`), col("responsiblePerson", "text", sql`op.responsible_person`, { mask: "text" }), col("bankName", "text", sql`op.bank_name`), col("iban", "text", sql`op.iban`, { mask: "tail" }),
    col("drivers", "number", sql`(select count(*)::int from driver_profiles d where d.office_id = users.id)`, { sort: false, default: true }), ...accountCols(),
  ],
  filters: [flt("verification", "enum", sql`op.verification_status`, { ns: "status", values: VERIFY }), ...accountFilters()],
  search: [sql`op.office_name`, sql`users.name`, sql`op.cr_number`], searchPii: [sql`users.phone`, sql`users.email`], defaultSort: { key: "createdAt", dir: "desc" },
});

defineDataset({
  key: "drivers", group: "people", from: sql`from users join driver_profiles dp on dp.user_id = users.id left join users dof on dof.id = dp.office_id`, id: sql`users.id`, time: { sql: sql`users.created_at`, label: "rpq.t_registered" },
  ...mapShared({ city: (v) => inList(sql`users.city`, v), driver: (v) => inList(sql`users.id`, v), office: (v) => inList(sql`dp.office_id`, v) }),
  columns: [
    col("name", "link", sql`users.name`, { href: "/admin/drivers/{id}", default: true }), city(sql`users.city`, { default: true }),
    col("verificationStatus", "status", sql`dp.verification_status`, { ns: "status", values: ["pending", "verified", "rejected", "expired"], default: true }),
    col("vehicleType", "enum", sql`dp.vehicle_type`, { ns: "vehicle", values: VEHICLE_TYPES, default: true }), col("vehicleTemperature", "enum", sql`dp.vehicle_temperature`, { ns: "temp", values: ["dry", "cold"] }),
    col("vehiclePlate", "text", sql`dp.vehicle_plate`, { mask: "tail" }), col("nationalId", "text", sql`dp.national_id`, { mask: "tail" }), col("iban", "text", sql`dp.iban`, { mask: "tail" }), col("bankName", "text", sql`dp.bank_name`),
    col("availability", "enum", sql`dp.availability`, { values: ["available", "unavailable"], default: true }), col("office", "text", sql`dof.name`), col("officeLink", "enum", sql`dp.office_link_status`, { values: ["direct", "linked"] }),
    col("jobsCompleted", "number", sql`dp.jobs_completed`, { default: true }), col("ratingAvg", "number", sql`(case when dp.rating_count > 0 then round(dp.rating_sum::numeric / dp.rating_count, 2) end)::float8`, { default: true }), col("ratingCount", "number", sql`dp.rating_count`),
    col("suspendedUntil", "datetime", sql`dp.suspended_until`), col("locationAt", "datetime", sql`dp.location_at`), ...accountCols(),
  ],
  filters: [
    flt("verification", "enum", sql`dp.verification_status`, { ns: "status", values: ["pending", "verified", "rejected", "expired"] }), flt("availability", "enum", sql`dp.availability`, { values: ["available", "unavailable"] }),
    flt("vehicleType", "enum", sql`dp.vehicle_type`, { ns: "vehicle", values: VEHICLE_TYPES }), flt("suspended", "flag", sql`dp.suspended_until > now()`), flt("hasOffice", "flag", sql`dp.office_id is not null`),
    flt("jobsCompleted", "num", sql`dp.jobs_completed`), flt("ratingCount", "num", sql`dp.rating_count`), ...accountFilters(),
  ],
  search: [sql`users.name`, sql`dof.name`, sql`dp.vehicle_plate`], searchPii: [sql`users.phone`, sql`users.email`, sql`dp.national_id`, sql`dp.vehicle_plate`], defaultSort: { key: "createdAt", dir: "desc" },
});

defineDataset({
  key: "documents", group: "people", id: sql`documents.id`, time: { sql: sql`documents.created_at`, label: "rpq.t_uploaded" },
  from: sql`from documents join users ow on ow.id = documents.owner_id left join business_profiles bp on bp.user_id = ow.id left join office_profiles op on op.user_id = ow.id left join users rv on rv.id = documents.reviewer_id`,
  ...mapShared({ city: (v) => inList(sql`ow.city`, v), company: (v) => inList(sql`documents.owner_id`, v), office: (v) => inList(sql`documents.owner_id`, v), driver: (v) => inList(sql`documents.owner_id`, v) }),
  columns: [
    col("owner", "text", sql`coalesce(bp.company_name, op.office_name, ow.name)`, { default: true }), col("ownerKind", "enum", sql`documents.owner_kind`, { ns: "role", values: ["driver", "office", "business"], default: true }),
    col("type", "enum", sql`documents.type`, { ns: "doc", values: DOC_TYPES, default: true }), col("status", "status", sql`documents.status`, { ns: "docstatus", values: DOC_STATUS, default: true }),
    col("fileName", "text", sql`documents.file_name`, { mask: "text" }), col("mime", "text", sql`documents.mime`), col("size", "number", sql`documents.size`),
    col("expiresOn", "date", sql`documents.expires_on`, { default: true }), col("daysToExpiry", "number", sql`(documents.expires_on - ${RIYADH_TODAY})::float8`), col("reviewer", "text", sql`rv.name`),
    col("reviewNote", "text", sql`documents.review_note`), col("reviewedAt", "datetime", sql`documents.reviewed_at`), createdAt(sql`documents.created_at`, { default: true }),
  ],
  filters: [
    flt("status", "enum", sql`documents.status`, { ns: "docstatus", values: DOC_STATUS }), flt("type", "enum", sql`documents.type`, { ns: "doc", values: DOC_TYPES }), flt("ownerKind", "enum", sql`documents.owner_kind`, { ns: "role", values: ["driver", "office", "business"] }),
    flt("expired", "flag", sql`documents.expires_on < ${RIYADH_TODAY}`), flt("expiringSoon", "flag", sql`documents.expires_on between ${RIYADH_TODAY} and ${RIYADH_TODAY} + 30`), flt("expires", "date", sql`documents.expires_on`, { dateOnly: true }),
  ],
  search: [sql`bp.company_name`, sql`op.office_name`, sql`ow.name`, sql`documents.review_note`], searchPii: [sql`documents.file_name`], defaultSort: { key: "createdAt", dir: "desc" },
});

defineDataset({
  key: "availability", group: "people", id: sql`driver_availability_log.id`, time: { sql: sql`driver_availability_log.at`, label: "rpq.t_event" },
  from: sql`from driver_availability_log join users du on du.id = driver_availability_log.driver_id left join driver_profiles dp on dp.user_id = du.id left join users act on act.id = driver_availability_log.actor_id`,
  ...mapShared({ city: (v) => inList(sql`du.city`, v), driver: (v) => inList(sql`driver_availability_log.driver_id`, v), office: (v) => inList(sql`dp.office_id`, v) }),
  columns: [
    col("at", "datetime", sql`driver_availability_log.at`, { default: true }), col("driver", "link", sql`du.name`, { href: "/admin/drivers/{driverId}", fields: { driverId: sql`driver_availability_log.driver_id` }, default: true }),
    col("fromStatus", "enum", sql`driver_availability_log.from_status`, { values: ["available", "unavailable"] }), col("toStatus", "enum", sql`driver_availability_log.to_status`, { values: ["available", "unavailable"], default: true }),
    col("source", "enum", sql`driver_availability_log.source`, { values: ["driver", "system", "admin"], default: true }), col("reason", "text", sql`driver_availability_log.reason`, { default: true }), col("actor", "text", sql`act.name`),
  ],
  filters: [flt("toStatus", "enum", sql`driver_availability_log.to_status`, { values: ["available", "unavailable"] }), flt("source", "enum", sql`driver_availability_log.source`, { values: ["driver", "system", "admin"] }), flt("reason", "text", sql`driver_availability_log.reason`)],
  search: [sql`du.name`, sql`driver_availability_log.reason`], defaultSort: { key: "at", dir: "desc" },
});
