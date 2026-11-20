import { sql } from "drizzle-orm";
import { col, createdAt, flt, inList, mapShared, REQ_MAP, ROLE_VALUES, scopeOf, secs } from "./explorer-core";
import { defineDataset } from "./explorer-registry";

/** Finance datasets: they need `finance.view` on top of the explorer permissions, so every amount in them is a money column. */
const needs = ["finance.view" as const];
const COMPANY = sql`coalesce(bp.company_name, bu.name)`;
const BU_JOIN = sql`join users bu on bu.id = requests.business_id left join business_profiles bp on bp.user_id = bu.id`;
const REQ_LINK = (key = "requestRef") => col(key, "link", sql`requests.ref`, { href: "/admin/requests/{requestId}", fields: { requestId: sql`requests.id` }, default: true });
const SETTLE_STATUS = ["pending_review", "reviewed", "approved", "batch_ready", "paid", "rejected", "failed"] as const;
const WD_STATUS = ["pending", "approved", "paid", "rejected"] as const;
/** A settlement is on hold while an open complaint that holds settlements points at its job. */
const HELD = sql`exists (select 1 from complaints c where c.holds_settlement and c.status in ('open','in_progress') and (c.offer_id = settlements.offer_id or (c.offer_id is null and c.request_id = settlements.request_id)))`;

defineDataset({
  key: "settlements", group: "finance", needs, id: sql`settlements.id`, time: { sql: sql`settlements.created_at`, label: "rpq.t_created" }, ...scopeOf("settlements"),
  from: sql`from settlements join requests on requests.id = settlements.request_id join users du on du.id = settlements.driver_id left join users ou on ou.id = settlements.office_id ${BU_JOIN}`,
  columns: [
    REQ_LINK(), col("company", "text", COMPANY, { default: true }), col("driver", "text", sql`du.name`, { default: true }), col("office", "text", sql`ou.name`),
    col("status", "status", sql`settlements.status`, { ns: "settle", values: SETTLE_STATUS, default: true }), col("finalUnits", "number", sql`settlements.final_units`),
    col("customerCents", "money", sql`settlements.customer_cents`, { money: true, default: true }), col("providerCents", "money", sql`settlements.provider_cents`, { money: true, default: true }),
    col("marginCents", "money", sql`settlements.margin_cents`, { money: true, default: true }), col("vatCents", "money", sql`settlements.vat_cents`, { money: true }), col("refundCents", "money", sql`settlements.refund_cents`, { money: true }),
    col("adjustmentCents", "money", sql`settlements.adjustment_cents`, { money: true }), col("reservedCents", "money", sql`settlements.reserved_cents`, { money: true }),
    col("held", "bool", HELD), col("note", "text", sql`settlements.note`),
    createdAt(sql`settlements.created_at`, { default: true }), col("approvedAt", "datetime", sql`settlements.approved_at`), col("paidAt", "datetime", sql`settlements.paid_at`, { default: true }),
    col("daysToPay", "number", sql`(case when settlements.paid_at is not null then round(extract(epoch from (settlements.paid_at - settlements.created_at)) / 86400.0, 1) end)::float8`),
  ],
  filters: [
    flt("status", "enum", sql`settlements.status`, { ns: "settle", values: SETTLE_STATUS }), flt("held", "flag", HELD), flt("paid", "flag", sql`settlements.paid_at is not null`),
    flt("customer", "num", sql`settlements.customer_cents`, { money: true }), flt("margin", "num", sql`settlements.margin_cents`, { money: true }), flt("paidOn", "date", sql`settlements.paid_at`),
  ],
  search: [sql`requests.ref`, sql`du.name`, sql`bp.company_name`, sql`bu.name`, sql`settlements.note`], defaultSort: { key: "createdAt", dir: "desc" },
});

const LEDGER_KINDS = ["topup", "reserve", "release_reserve", "refund", "payout", "platform_fee", "withdrawal_hold", "withdrawal_paid", "withdrawal_release", "adjustment"] as const;
defineDataset({
  key: "ledger", group: "finance", needs, id: sql`ledger_entries.id`, time: { sql: sql`ledger_entries.created_at`, label: "rpq.t_created" },
  from: sql`from ledger_entries join wallet_accounts wa on wa.id = ledger_entries.account_id left join users wo on wo.id = wa.owner_id left join business_profiles bp on bp.user_id = wo.id left join office_profiles op on op.user_id = wo.id left join requests on requests.id = ledger_entries.request_id`,
  ...mapShared({
    ...REQ_MAP, city: (v) => inList(sql`wo.city`, v), company: (v) => inList(sql`wa.owner_id`, v), office: (v) => inList(sql`wa.owner_id`, v), driver: (v) => inList(sql`wa.owner_id`, v),
  }),
  columns: [
    col("kind", "enum", sql`ledger_entries.kind`, { ns: "ledger", values: LEDGER_KINDS, default: true }), col("owner", "text", sql`coalesce(bp.company_name, op.office_name, wo.name)`, { default: true }),
    col("ownerRole", "enum", sql`wo.role`, { ns: "role", default: true }), col("accountKind", "enum", sql`wa.kind`, { values: ["user", "platform"] }),
    col("availableDeltaCents", "money", sql`ledger_entries.available_delta_cents`, { money: true, default: true }), col("reservedDeltaCents", "money", sql`ledger_entries.reserved_delta_cents`, { money: true }),
    col("heldDeltaCents", "money", sql`ledger_entries.held_delta_cents`, { money: true }),
    col("requestRef", "link", sql`requests.ref`, { href: "/admin/requests/{requestId}", fields: { requestId: sql`ledger_entries.request_id` }, default: true }),
    col("simulated", "bool", sql`ledger_entries.simulated`), col("note", "text", sql`ledger_entries.note`), createdAt(sql`ledger_entries.created_at`, { default: true }),
  ],
  filters: [
    flt("kind", "enum", sql`ledger_entries.kind`, { ns: "ledger", values: LEDGER_KINDS }), flt("simulated", "flag", sql`ledger_entries.simulated`), flt("hasRequest", "flag", sql`ledger_entries.request_id is not null`),
    flt("amount", "num", sql`ledger_entries.available_delta_cents`, { money: true }),
  ],
  search: [sql`ledger_entries.note`, sql`requests.ref`, sql`bp.company_name`, sql`op.office_name`, sql`wo.name`], defaultSort: { key: "createdAt", dir: "desc" },
});

defineDataset({
  key: "withdrawals", group: "finance", needs, id: sql`withdrawals.id`, time: { sql: sql`withdrawals.created_at`, label: "rpq.t_created" },
  from: sql`from withdrawals join users wu on wu.id = withdrawals.user_id left join business_profiles bp on bp.user_id = wu.id left join office_profiles op on op.user_id = wu.id left join users dec on dec.id = withdrawals.decided_by`,
  ...mapShared({ city: (v) => inList(sql`wu.city`, v), company: (v) => inList(sql`withdrawals.user_id`, v), office: (v) => inList(sql`withdrawals.user_id`, v), driver: (v) => inList(sql`withdrawals.user_id`, v) }),
  columns: [
    col("owner", "text", sql`coalesce(bp.company_name, op.office_name, wu.name)`, { default: true }), col("ownerRole", "enum", sql`wu.role`, { ns: "role", default: true }),
    col("amountCents", "money", sql`withdrawals.amount_cents`, { money: true, default: true }), col("status", "status", sql`withdrawals.status`, { ns: "wdstatus", values: WD_STATUS, default: true }),
    col("bankName", "text", sql`withdrawals.bank_name`), col("iban", "text", sql`withdrawals.iban`, { mask: "tail" }), col("decidedBy", "text", sql`dec.name`), col("decidedAt", "datetime", sql`withdrawals.decided_at`),
    col("paymentRef", "text", sql`withdrawals.payment_ref`), col("note", "text", sql`withdrawals.note`), createdAt(sql`withdrawals.created_at`, { default: true }),
    col("decisionSecs", "duration", secs(sql`withdrawals.created_at`, sql`withdrawals.decided_at`)),
  ],
  filters: [flt("status", "enum", sql`withdrawals.status`, { ns: "wdstatus", values: WD_STATUS }), flt("amount", "num", sql`withdrawals.amount_cents`, { money: true }), flt("decided", "flag", sql`withdrawals.decided_at is not null`)],
  search: [sql`bp.company_name`, sql`op.office_name`, sql`wu.name`, sql`withdrawals.payment_ref`], searchPii: [sql`withdrawals.iban`], defaultSort: { key: "createdAt", dir: "desc" },
});

defineDataset({
  key: "invoices", group: "finance", needs, id: sql`invoices.id`, time: { sql: sql`invoices.created_at`, label: "rpq.t_issued" },
  from: sql`from invoices join requests on requests.id = invoices.request_id join users bu on bu.id = invoices.business_id left join business_profiles bp on bp.user_id = bu.id`,
  ...mapShared({
    ...REQ_MAP, company: (v) => inList(sql`invoices.business_id`, v),
    driver: (v) => sql`exists (select 1 from settlements s where s.id = invoices.settlement_id and s.driver_id in (${sql.join(v.map((x) => sql`${x}`), sql`, `)}))`,
    office: (v) => sql`exists (select 1 from settlements s where s.id = invoices.settlement_id and s.office_id in (${sql.join(v.map((x) => sql`${x}`), sql`, `)}))`,
  }),
  columns: [
    col("number", "link", sql`invoices.number`, { href: "/admin/requests/{requestId}", fields: { requestId: sql`requests.id` }, default: true }), col("requestRef", "text", sql`requests.ref`, { default: true }), col("company", "text", COMPANY, { default: true }),
    col("subtotalCents", "money", sql`invoices.subtotal_cents`, { money: true, default: true }), col("vatCents", "money", sql`invoices.vat_cents`, { money: true, default: true }), col("totalCents", "money", sql`invoices.total_cents`, { money: true, default: true }),
    col("vatPct", "number", sql`invoices.vat_pct`), createdAt(sql`invoices.created_at`, { default: true }),
  ],
  filters: [flt("total", "num", sql`invoices.total_cents`, { money: true }), flt("vatPct", "num", sql`invoices.vat_pct`)],
  search: [sql`invoices.number`, sql`requests.ref`, sql`bp.company_name`, sql`bu.name`], defaultSort: { key: "createdAt", dir: "desc" },
});

defineDataset({
  key: "cod", group: "finance", needs, id: sql`cod_remittances.id`, time: { sql: sql`cod_remittances.created_at`, label: "rpq.t_received" },
  from: sql`from cod_remittances join requests on requests.id = cod_remittances.request_id join users du on du.id = cod_remittances.driver_id join users bu on bu.id = cod_remittances.business_id left join business_profiles bp on bp.user_id = bu.id join users rcv on rcv.id = cod_remittances.received_by left join offers on offers.id = cod_remittances.offer_id`,
  ...mapShared({ ...REQ_MAP, company: (v) => inList(sql`cod_remittances.business_id`, v), driver: (v) => inList(sql`cod_remittances.driver_id`, v), office: (v) => inList(sql`offers.office_id`, v) }),
  columns: [
    col("ref", "text", sql`cod_remittances.ref`, { default: true }), REQ_LINK(), col("company", "text", COMPANY, { default: true }), col("driver", "text", sql`du.name`, { default: true }),
    col("amountCents", "money", sql`cod_remittances.amount_cents`, { money: true, default: true }), col("receivedBy", "text", sql`rcv.name`), col("receivedByRole", "enum", sql`cod_remittances.received_by_role`, { ns: "role" }),
    col("note", "text", sql`cod_remittances.note`), createdAt(sql`cod_remittances.created_at`, { default: true }),
  ],
  filters: [flt("amount", "num", sql`cod_remittances.amount_cents`, { money: true }), flt("receivedByRole", "enum", sql`cod_remittances.received_by_role`, { ns: "role", values: ROLE_VALUES })],
  search: [sql`cod_remittances.ref`, sql`requests.ref`, sql`du.name`, sql`bp.company_name`, sql`bu.name`], defaultSort: { key: "createdAt", dir: "desc" },
});
