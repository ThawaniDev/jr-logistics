import { sql } from "drizzle-orm";
import { COMPLAINT_CATEGORIES } from "../catalog";
import { col, createdAt, flt, inList, mapShared, ALL_KEYS, REQ_MAP, ROLE_VALUES, scopeOf, secs } from "./explorer-core";
import { defineDataset } from "./explorer-registry";
import { SHIPMENT_EVENT_TYPES } from "../shipment-events";
import { complaintScope, COMPLAINT_FROM, FRT, RATING_FROM, slaSql, TICKET_FROM, WHO, WHO_JOIN } from "./support-sql";

const TICKET_CATEGORIES_ALL = ["driver_no_show", "shipment_count", "location_issue", "payment_issue", "cod_issue", "replacement_request", "urgent", "app_problem", "other", "business_not_ready", "not_put_to_work", "shipment_count_differs", "attendance_issue", "driver_assignment", "settlement_issue", "agreement", "documents"] as const;
const TICKET_STATUS = ["open", "in_review", "resolved"] as const;
const COMPLAINT_STATUS = ["open", "in_progress", "resolved", "closed"] as const;
const PRIORITY = ["normal", "urgent"] as const;
const sla = slaSql({ created: sql`tickets.created_at`, frt: FRT, resolved: sql`tickets.resolved_at` });
const SLA_STATE = sql`(case when ${sla.breached} then 'breached' when ${sla.atRisk} then 'at_risk' when tickets.resolved_at is not null then 'ok' else 'pending' end)`;

defineDataset({
  key: "tickets", group: "support", id: sql`tickets.id`, time: { sql: sql`tickets.created_at`, label: "rpq.t_opened" }, ...scopeOf("tickets"),
  from: sql`${TICKET_FROM} ${WHO_JOIN} left join users asg on asg.id = tickets.assigned_to`,
  columns: [
    col("ref", "link", sql`tickets.ref`, { href: "/admin/cases/{id}", default: true }), col("subject", "text", sql`tickets.subject`, { default: true }),
    col("category", "enum", sql`tickets.category`, { ns: "ticket_cat", values: TICKET_CATEGORIES_ALL, default: true }), col("priority", "enum", sql`tickets.priority`, { ns: "rpq.pri", values: PRIORITY, default: true }),
    col("status", "status", sql`tickets.status`, { ns: "status", values: TICKET_STATUS, default: true }), col("slaState", "enum", SLA_STATE, { ns: "rpq.sla", values: ["breached", "at_risk", "ok", "pending"], sort: false, default: true }),
    col("openedBy", "text", WHO, { default: true }), col("openerRole", "enum", sql`opener.role`, { ns: "role", values: ["business", "driver", "office"] }), col("assignee", "text", sql`asg.name`),
    col("requestRef", "text", sql`requests.ref`), col("reopenCount", "number", sql`tickets.reopen_count`),
    col("firstResponseSecs", "duration", secs(sql`tickets.created_at`, FRT), { sort: false }), col("resolutionSecs", "duration", secs(sql`tickets.created_at`, sql`tickets.resolved_at`)),
    col("ageSecs", "duration", sql`(case when tickets.status <> 'resolved' then extract(epoch from (now() - tickets.created_at)) end)::float8`),
    createdAt(sql`tickets.created_at`, { default: true }), col("firstResponseAt", "datetime", FRT, { sort: false }), col("resolvedAt", "datetime", sql`tickets.resolved_at`),
  ],
  filters: [
    flt("status", "enum", sql`tickets.status`, { ns: "status", values: TICKET_STATUS }), flt("priority", "enum", sql`tickets.priority`, { ns: "rpq.pri", values: PRIORITY }), flt("category", "enum", sql`tickets.category`, { ns: "ticket_cat", values: TICKET_CATEGORIES_ALL }),
    flt("unassigned", "flag", sql`tickets.assigned_to is null`), flt("reopened", "flag", sql`tickets.reopen_count > 0`), flt("breached", "flag", sla.breached), flt("hasRequest", "flag", sql`tickets.request_id is not null`), flt("reopenCount", "num", sql`tickets.reopen_count`),
  ],
  search: [sql`tickets.ref`, sql`tickets.subject`, sql`opener.name`, sql`bp.company_name`, sql`op.office_name`, sql`requests.ref`], defaultSort: { key: "createdAt", dir: "desc" },
});

defineDataset({
  key: "complaints", group: "support", id: sql`complaints.id`, time: { sql: sql`complaints.created_at`, label: "rpq.t_filed" }, keys: ALL_KEYS, shared: complaintScope,
  from: sql`${COMPLAINT_FROM} left join users h on h.id = complaints.handler_id`,
  columns: [
    col("ref", "link", sql`complaints.ref`, { href: "/admin/complaints/{id}", default: true }), col("category", "enum", sql`complaints.category`, { ns: "complaint_cat", values: COMPLAINT_CATEGORIES, default: true }),
    col("priority", "enum", sql`complaints.priority`, { ns: "rpq.pri", values: PRIORITY, default: true }), col("status", "status", sql`complaints.status`, { ns: "status", values: COMPLAINT_STATUS, default: true }),
    col("description", "text", sql`complaints.description`, { sort: false, default: true }), col("resolution", "text", sql`complaints.resolution`, { sort: false }),
    col("filedBy", "text", sql`filer.name`, { default: true }), col("filerRole", "enum", sql`complaints.filed_by_role`, { ns: "role", values: ["business", "driver", "office"] }), col("handler", "text", sql`h.name`),
    col("holdsSettlement", "bool", sql`complaints.holds_settlement`), col("requestRef", "text", sql`requests.ref`),
    col("firstResponseSecs", "duration", secs(sql`complaints.created_at`, sql`complaints.first_response_at`)), col("resolutionSecs", "duration", secs(sql`complaints.created_at`, sql`complaints.resolved_at`)),
    createdAt(sql`complaints.created_at`, { default: true }), col("firstResponseAt", "datetime", sql`complaints.first_response_at`), col("resolvedAt", "datetime", sql`complaints.resolved_at`),
  ],
  filters: [
    flt("status", "enum", sql`complaints.status`, { ns: "status", values: COMPLAINT_STATUS }), flt("category", "enum", sql`complaints.category`, { ns: "complaint_cat", values: COMPLAINT_CATEGORIES }), flt("priority", "enum", sql`complaints.priority`, { ns: "rpq.pri", values: PRIORITY }),
    flt("holds", "flag", sql`complaints.holds_settlement`), flt("unresolved", "flag", sql`complaints.status in ('open','in_progress')`), flt("hasRequest", "flag", sql`complaints.request_id is not null`),
  ],
  search: [sql`complaints.ref`, sql`complaints.description`, sql`filer.name`, sql`requests.ref`], defaultSort: { key: "createdAt", dir: "desc" },
});

defineDataset({
  key: "ratings", group: "support", id: sql`ratings.id`, time: { sql: sql`ratings.created_at`, label: "rpq.t_rated" }, ...scopeOf("offers"),
  from: sql`${RATING_FROM} join users rater on rater.id = ratings.rater_id`,
  columns: [
    col("requestRef", "link", sql`requests.ref`, { href: "/admin/requests/{requestId}", fields: { requestId: sql`requests.id` }, default: true }), col("stars", "number", sql`ratings.stars`, { default: true }),
    col("comment", "text", sql`ratings.comment`, { sort: false, default: true }), col("rated", "text", sql`coalesce(rbp.company_name, ratee.name)`, { default: true }), col("ratedRole", "enum", sql`ratee.role`, { ns: "role", values: ["driver", "business"], default: true }),
    col("rater", "text", sql`rater.name`), col("raterRole", "enum", sql`rater.role`, { ns: "role", values: ["driver", "business"] }), createdAt(sql`ratings.created_at`, { default: true }),
  ],
  filters: [flt("stars", "num", sql`ratings.stars`), flt("low", "flag", sql`ratings.stars <= 2`), flt("hasComment", "flag", sql`nullif(btrim(ratings.comment), '') is not null`), flt("ratedRole", "enum", sql`ratee.role`, { ns: "role", values: ["driver", "business"] })],
  search: [sql`ratings.comment`, sql`ratee.name`, sql`rbp.company_name`, sql`rater.name`, sql`requests.ref`], defaultSort: { key: "createdAt", dir: "desc" },
});

/** System datasets: raw platform activity, readable with `audit.view` (and personal data masked without `drivers.sensitive`). */
const needsAudit = ["audit.view" as const];
defineDataset({
  key: "logins", group: "system", needs: needsAudit, id: sql`login_events.id`, time: { sql: sql`login_events.created_at`, label: "rpq.t_event" },
  from: sql`from login_events left join users lu on lu.id = login_events.user_id`,
  ...mapShared({ city: (v) => inList(sql`lu.city`, v), company: (v) => inList(sql`login_events.user_id`, v), office: (v) => inList(sql`login_events.user_id`, v), driver: (v) => inList(sql`login_events.user_id`, v) }),
  columns: [
    createdAt(sql`login_events.created_at`, { default: true }), col("user", "text", sql`lu.name`, { default: true }), col("userRole", "enum", sql`lu.role`, { ns: "role", default: true }), col("identifier", "text", sql`login_events.identifier`, { mask: "tail" }),
    col("method", "enum", sql`login_events.method`, { values: ["otp", "password", "api_key", "session"], default: true }), col("success", "bool", sql`login_events.success`, { default: true }),
    col("failureReason", "enum", sql`login_events.failure_reason`, { values: ["invalid_code", "bad_password", "unknown_user", "unknown_account", "locked", "rate_limited", "suspended", "wrong_portal", "mfa_failed"], default: true }),
    col("client", "enum", sql`login_events.client`, { values: ["web", "mobile", "api"] }), col("ip", "text", sql`login_events.ip`, { mask: "ip" }), col("userAgent", "text", sql`login_events.user_agent`, { mask: "text" }),
  ],
  filters: [
    flt("success", "flag", sql`login_events.success`), flt("method", "enum", sql`login_events.method`, { values: ["otp", "password", "api_key", "session"] }), flt("client", "enum", sql`login_events.client`, { values: ["web", "mobile", "api"] }),
    flt("failureReason", "enum", sql`login_events.failure_reason`, { values: ["invalid_code", "bad_password", "unknown_user", "unknown_account", "locked", "rate_limited", "suspended", "wrong_portal", "mfa_failed"] }), flt("hasAccount", "flag", sql`login_events.user_id is not null`),
  ],
  search: [sql`lu.name`], searchPii: [sql`login_events.identifier`, sql`login_events.ip`], defaultSort: { key: "createdAt", dir: "desc" },
});

defineDataset({
  key: "messages", group: "system", needs: needsAudit, id: sql`message_log.id`, time: { sql: sql`message_log.created_at`, label: "rpq.t_event" },
  from: sql`from message_log left join users mu on mu.id = message_log.user_id left join requests on requests.id = message_log.request_id`,
  ...mapShared({ ...REQ_MAP, city: (v) => inList(sql`mu.city`, v), company: (v) => inList(sql`message_log.user_id`, v), office: (v) => inList(sql`message_log.user_id`, v), driver: (v) => inList(sql`message_log.user_id`, v) }),
  columns: [
    createdAt(sql`message_log.created_at`, { default: true }), col("channel", "enum", sql`message_log.channel`, { values: ["sms", "push", "webhook", "email", "inapp"], default: true }), col("messageType", "text", sql`message_log.type`, { default: true, group: true }),
    col("recipient", "text", sql`message_log.recipient`, { default: true }), col("status", "status", sql`message_log.status`, { ns: "status", values: ["queued", "sent", "failed", "delivered"], default: true }),
    col("attempts", "number", sql`message_log.attempts`), col("error", "text", sql`message_log.error`), col("user", "text", sql`mu.name`), col("requestRef", "text", sql`requests.ref`),
    col("providerRef", "text", sql`message_log.provider_ref`), col("sentAt", "datetime", sql`message_log.sent_at`),
  ],
  filters: [
    flt("channel", "enum", sql`message_log.channel`, { values: ["sms", "push", "webhook", "email", "inapp"] }), flt("status", "enum", sql`message_log.status`, { ns: "status", values: ["queued", "sent", "failed", "delivered"] }),
    flt("failed", "flag", sql`message_log.status = 'failed'`), flt("messageType", "text", sql`message_log.type`), flt("attempts", "num", sql`message_log.attempts`),
  ],
  search: [sql`message_log.type`, sql`message_log.error`, sql`mu.name`, sql`requests.ref`], defaultSort: { key: "createdAt", dir: "desc" },
});

defineDataset({
  key: "parcel-events", group: "system", needs: needsAudit, id: sql`shipment_events.id`, time: { sql: sql`shipment_events.created_at`, label: "rpq.t_event" },
  from: sql`from shipment_events join shipments on shipments.id = shipment_events.shipment_id join requests on requests.id = shipment_events.request_id left join offers on offers.id = shipment_events.offer_id left join users du on du.id = offers.driver_id`,
  ...mapShared({ ...REQ_MAP, company: (v) => inList(sql`requests.business_id`, v), driver: (v) => inList(sql`offers.driver_id`, v), office: (v) => inList(sql`offers.office_id`, v) }),
  columns: [
    createdAt(sql`shipment_events.created_at`, { default: true }), col("eventType", "enum", sql`shipment_events.type`, { ns: "rpq.pe", values: SHIPMENT_EVENT_TYPES, default: true }),
    col("parcel", "link", sql`shipments.code`, { href: "/admin/requests/{requestId}", fields: { requestId: sql`requests.id` }, default: true }), col("requestRef", "text", sql`requests.ref`),
    col("actor", "text", sql`shipment_events.actor_name`, { default: true }), col("actorRole", "enum", sql`shipment_events.actor_role`, { ns: "role", default: true }), col("driver", "text", sql`du.name`),
    col("payload", "text", sql`left(shipment_events.payload::text, 600)`, { sort: false }),
  ],
  filters: [flt("eventType", "enum", sql`shipment_events.type`, { ns: "rpq.pe", values: SHIPMENT_EVENT_TYPES }), flt("actorRole", "enum", sql`shipment_events.actor_role`, { ns: "role", values: ROLE_VALUES })],
  search: [sql`shipments.code`, sql`requests.ref`, sql`shipment_events.actor_name`], defaultSort: { key: "createdAt", dir: "desc" },
});

defineDataset({
  key: "audit", group: "system", needs: needsAudit, id: sql`audit_logs.id`, time: { sql: sql`audit_logs.created_at`, label: "rpq.t_event" },
  from: sql`from audit_logs left join users au on au.id = audit_logs.actor_id`,
  ...mapShared({ company: (v) => inList(sql`audit_logs.actor_id`, v), office: (v) => inList(sql`audit_logs.actor_id`, v), driver: (v) => inList(sql`audit_logs.actor_id`, v) }),
  columns: [
    createdAt(sql`audit_logs.created_at`, { default: true }), col("actor", "text", sql`au.name`, { default: true }), col("actorRole", "enum", sql`audit_logs.actor_role`, { ns: "role", default: true }),
    col("action", "text", sql`audit_logs.action`, { default: true, group: true }), col("entity", "text", sql`audit_logs.entity`, { default: true, group: true }), col("entityId", "text", sql`audit_logs.entity_id`),
    col("ip", "text", sql`audit_logs.ip`, { mask: "ip" }), col("correlationId", "text", sql`audit_logs.correlation_id`), col("diff", "text", sql`left(audit_logs.diff::text, 1000)`, { sort: false }),
  ],
  filters: [flt("action", "text", sql`audit_logs.action`), flt("entity", "text", sql`audit_logs.entity`), flt("actorRole", "enum", sql`audit_logs.actor_role`, { ns: "role", values: ROLE_VALUES })],
  search: [sql`audit_logs.action`, sql`audit_logs.entity`, sql`audit_logs.entity_id`, sql`au.name`], defaultSort: { key: "createdAt", dir: "desc" },
});
