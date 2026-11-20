import { sql, type SQL } from "drizzle-orm";
import { invoices, settlements, withdrawals } from "@/db/schema";
import { BILLED, inWindow, scope } from "./conditions";
import { sqlList, type Row } from "./finance-core";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { defineTable, type DrillQuery } from "./registry";
import { HELD, payeeScope, SETTLE_FROM } from "./finance-facts";

/** Drill-down tables of the finance report (`/admin/analytics/finance/table/<name>`): settlements, withdrawals, ledger entries, invoices and company profitability. Every one needs `finance.view`. */
const NEEDS = ["finance.view" as const];
const COMPANY = sql`coalesce(bp.company_name, bu.name)`;
async function page(select: SQL, from: SQL, where: SQL, { limit, offset, order }: DrillQuery, count?: SQL) {
  const [list, [t]] = await Promise.all([
    rows<Row>(sql`select ${select} ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`),
    rows<Row>(sql`select ${count ?? sql`count(*)::int`} as n ${from} where ${where}`),
  ]);
  return { rows: list, total: num(t?.n) };
}

defineTable({
  report: "finance", name: "settlements", title: "rpd.tbl_fin_settlements", needs: NEEDS,
  columns: [
    { key: "ref", label: "rpf.col_ref", type: "link", href: "/admin/requests/{requestId}", sub: "company" }, { key: "driver", label: "rpf.col_driver", type: "text", sub: "office", phone: false },
    { key: "status", label: "rpf.col_status", type: "status", ns: "settle" }, { key: "held", label: "rpd.col_hold", type: "enum", ns: "rpd.held", phone: false },
    { key: "customerCents", label: "rpf.col_billed", type: "money", align: "end" }, { key: "vatCents", label: "rpd.col_vat", type: "money", align: "end", phone: false },
    { key: "providerCents", label: "rpf.col_provider", type: "money", align: "end", phone: false }, { key: "marginCents", label: "rpf.col_margin", type: "money", align: "end" },
    { key: "marginPct", label: "rpd.col_margin_pct", type: "percent", align: "end", phone: false }, { key: "createdAt", label: "rpf.col_created", type: "datetime", phone: false },
    { key: "paidAt", label: "rpf.col_paid", type: "datetime", phone: false }, { key: "latencySecs", label: "rpd.col_latency", type: "duration", align: "end", phone: false },
  ],
  sorts: {
    ref: sql`requests.ref`, driver: sql`du.name`, status: sql`settlements.status`, customerCents: sql`settlements.customer_cents`, vatCents: sql`settlements.vat_cents`, providerCents: sql`settlements.provider_cents`,
    marginCents: sql`settlements.margin_cents`, marginPct: sql`"marginPct"`, createdAt: sql`settlements.created_at`, paidAt: sql`settlements.paid_at`, latencySecs: sql`"latencySecs"`,
  },
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`settlements.id`,
  query: (q) => page(
    sql`settlements.id, settlements.request_id as "requestId", requests.ref, ${COMPANY} as company, du.name as driver, ou.name as office, settlements.status, case when settlements.status not in ('paid','rejected') and ${HELD} then 'held' end as held,
      settlements.customer_cents as "customerCents", settlements.vat_cents as "vatCents", settlements.provider_cents as "providerCents", settlements.margin_cents as "marginCents",
      case when settlements.customer_cents > 0 then settlements.margin_cents::float8 / settlements.customer_cents end as "marginPct", settlements.created_at as "createdAt", settlements.paid_at as "paidAt",
      case when settlements.paid_at is not null then extract(epoch from (settlements.paid_at - settlements.created_at))::float8 end as "latencySecs"`,
    sql`${SETTLE_FROM} join users bu on bu.id = settlements.business_id left join business_profiles bp on bp.user_id = bu.id join users du on du.id = settlements.driver_id left join users ou on ou.id = settlements.office_id`,
    sql`${scope(q.filters, "settlements")} and ${BILLED} and ${inWindow(settlements.createdAt, q.filters.cur)}`, q),
});

defineTable({
  report: "finance", name: "withdrawals", title: "rpd.tbl_fin_withdrawals", needs: NEEDS,
  columns: [
    { key: "payee", label: "rpd.col_payee", type: "text" }, { key: "role", label: "rpd.col_role", type: "enum", ns: "role", phone: false }, { key: "amountCents", label: "rpd.col_amount", type: "money", align: "end" }, { key: "status", label: "rpf.col_status", type: "status", ns: "wdstatus" },
    { key: "createdAt", label: "rpd.col_requested", type: "datetime" }, { key: "decidedAt", label: "rpd.col_decided", type: "datetime", phone: false }, { key: "turnaroundSecs", label: "rpd.col_turnaround", type: "duration", align: "end", phone: false },
    { key: "decidedBy", label: "rpd.col_decided_by", type: "text", phone: false }, { key: "paymentRef", label: "rpd.col_payment_ref", type: "text", phone: false },
  ],
  sorts: { payee: sql`u.name`, amountCents: sql`withdrawals.amount_cents`, status: sql`withdrawals.status`, createdAt: sql`withdrawals.created_at`, decidedAt: sql`withdrawals.decided_at`, turnaroundSecs: sql`"turnaroundSecs"` },
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`withdrawals.id`,
  query: (q) => page(
    sql`withdrawals.id, u.name as payee, u.role as role, withdrawals.amount_cents as "amountCents", withdrawals.status, withdrawals.created_at as "createdAt", withdrawals.decided_at as "decidedAt",
      case when withdrawals.decided_at is not null then extract(epoch from (withdrawals.decided_at - withdrawals.created_at))::float8 end as "turnaroundSecs", dbu.name as "decidedBy", withdrawals.payment_ref as "paymentRef"`,
    sql`from withdrawals join users u on u.id = withdrawals.user_id left join users dbu on dbu.id = withdrawals.decided_by`, sql`${payeeScope(q.filters)} and ${inWindow(withdrawals.createdAt, q.filters.cur)}`, q),
});

/** The filter of the ledger table: entries of the filtered requests; the company filter also matches the wallets the company owns. */
function ledgerWhere(f: ResolvedFilters): SQL {
  const onRequest = f.city.length || f.service.length || f.vehicle.length || f.status.length || f.channel.length || f.office.length || f.driver.length;
  const win = inWindow("ledger_entries.created_at", f.cur);
  if (onRequest) return sql`${win} and requests.id is not null and ${scope(f, "requests")}`;
  if (f.company.length) return sql`${win} and (wa.owner_id in (${sqlList(f.company)}) or (requests.id is not null and ${scope(f, "requests")}))`;
  return win;
}
defineTable({
  report: "finance", name: "ledger", title: "rpd.tbl_fin_ledger", needs: NEEDS,
  columns: [
    { key: "createdAt", label: "rpf.col_created", type: "datetime" }, { key: "kind", label: "rpd.col_kind", type: "enum", ns: "ledger" }, { key: "owner", label: "rpd.col_wallet", type: "text" }, { key: "ownerRole", label: "rpd.col_role", type: "enum", ns: "role", phone: false },
    { key: "availableCents", label: "rpd.col_available", type: "money", align: "end" }, { key: "reservedCents", label: "rpd.col_escrow", type: "money", align: "end", phone: false }, { key: "heldCents", label: "rpd.col_held", type: "money", align: "end", phone: false },
    { key: "ref", label: "rpf.col_ref", type: "link", href: "/admin/requests/{requestId}", phone: false }, { key: "note", label: "rpd.col_note", type: "text", phone: false },
  ],
  sorts: { createdAt: sql`ledger_entries.created_at`, kind: sql`ledger_entries.kind`, owner: sql`ou.name`, availableCents: sql`ledger_entries.available_delta_cents`, reservedCents: sql`ledger_entries.reserved_delta_cents`, heldCents: sql`ledger_entries.held_delta_cents`, ref: sql`requests.ref` },
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`ledger_entries.id`,
  query: (q) => page(
    sql`ledger_entries.id, ledger_entries.created_at as "createdAt", ledger_entries.kind, case when wa.kind = 'platform' then null else ou.name end as owner, case when wa.kind = 'platform' then 'system' else ou.role end as "ownerRole",
      ledger_entries.available_delta_cents as "availableCents", ledger_entries.reserved_delta_cents as "reservedCents", ledger_entries.held_delta_cents as "heldCents", ledger_entries.request_id as "requestId", requests.ref, ledger_entries.note`,
    sql`from ledger_entries join wallet_accounts wa on wa.id = ledger_entries.account_id left join users ou on ou.id = wa.owner_id left join requests on requests.id = ledger_entries.request_id`, ledgerWhere(q.filters), q),
});

defineTable({
  report: "finance", name: "invoices", title: "rpd.tbl_fin_invoices", needs: NEEDS,
  columns: [
    { key: "number", label: "rpd.col_invoice", type: "text" }, { key: "ref", label: "rpf.col_ref", type: "link", href: "/admin/requests/{requestId}", sub: "company" },
    { key: "subtotalCents", label: "rpd.col_subtotal", type: "money", align: "end", phone: false }, { key: "vatCents", label: "rpd.col_vat", type: "money", align: "end", phone: false },
    { key: "totalCents", label: "rpf.col_total", type: "money", align: "end" }, { key: "vatPct", label: "rpd.col_vat_pct", type: "number", align: "end", phone: false }, { key: "createdAt", label: "rpf.col_created", type: "datetime" },
  ],
  sorts: { number: sql`invoices.number`, ref: sql`requests.ref`, subtotalCents: sql`invoices.subtotal_cents`, vatCents: sql`invoices.vat_cents`, totalCents: sql`invoices.total_cents`, vatPct: sql`invoices.vat_pct`, createdAt: sql`invoices.created_at` },
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`invoices.id`,
  query: (q) => page(
    sql`invoices.id, invoices.number, invoices.request_id as "requestId", requests.ref, ${COMPANY} as company, invoices.subtotal_cents as "subtotalCents", invoices.vat_cents as "vatCents", invoices.total_cents as "totalCents", invoices.vat_pct as "vatPct", invoices.created_at as "createdAt"`,
    sql`from invoices join requests on requests.id = invoices.request_id join users bu on bu.id = invoices.business_id left join business_profiles bp on bp.user_id = bu.id`,
    sql`${scope(q.filters, "requests")} and ${inWindow(invoices.createdAt, q.filters.cur)}`, q),
});

/** One row per company: what it was billed, what the platform paid out for it and kept, in the period (rejected settlements excluded). */
defineTable({
  report: "finance", name: "companies", title: "rpd.tbl_fin_companies", needs: NEEDS,
  columns: [
    { key: "company", label: "rpd.col_company", type: "text" }, { key: "settlementCount", label: "rpd.col_settlements", type: "number", align: "end", phone: false }, { key: "billedCents", label: "rpf.col_billed", type: "money", align: "end" },
    { key: "shareOfBilled", label: "rpd.col_share", type: "percent", align: "end", phone: false }, { key: "providerCents", label: "rpf.col_provider", type: "money", align: "end", phone: false }, { key: "marginCents", label: "rpf.col_margin", type: "money", align: "end" },
    { key: "marginPct", label: "rpd.col_margin_pct", type: "percent", align: "end" }, { key: "vatCents", label: "rpd.col_vat", type: "money", align: "end", phone: false }, { key: "avgOrderCents", label: "rpd.col_avg_order", type: "money", align: "end", phone: false },
  ],
  sorts: { company: sql`company`, settlementCount: sql`"settlementCount"`, billedCents: sql`"billedCents"`, shareOfBilled: sql`"billedCents"`, providerCents: sql`"providerCents"`, marginCents: sql`"marginCents"`, marginPct: sql`"marginPct"`, vatCents: sql`"vatCents"`, avgOrderCents: sql`"avgOrderCents"` },
  defaultSort: { key: "billedCents", dir: "desc" }, tiebreak: sql`settlements.business_id`,
  async query(q) {
    const where = sql`${scope(q.filters, "settlements")} and ${BILLED} and ${inWindow(settlements.createdAt, q.filters.cur)}`;
    const from = sql`${SETTLE_FROM} join users bu on bu.id = settlements.business_id left join business_profiles bp on bp.user_id = bu.id`;
    const [list, [t]] = await Promise.all([
      rows<Row>(sql`select settlements.business_id as id, ${COMPANY} as company, count(*)::int as "settlementCount", sum(settlements.customer_cents)::float8 as "billedCents",
          sum(settlements.customer_cents)::float8 / nullif(sum(sum(settlements.customer_cents)) over (), 0) as "shareOfBilled", sum(settlements.provider_cents)::float8 as "providerCents", sum(settlements.margin_cents)::float8 as "marginCents",
          sum(settlements.margin_cents)::float8 / nullif(sum(settlements.customer_cents), 0) as "marginPct", sum(settlements.vat_cents)::float8 as "vatCents", avg(settlements.customer_cents)::float8 as "avgOrderCents"
        ${from} where ${where} group by settlements.business_id, bp.company_name, bu.name order by ${q.order} limit ${q.limit} offset ${q.offset}`),
      rows<Row>(sql`select count(distinct settlements.business_id)::int as n ${SETTLE_FROM} where ${where}`),
    ]);
    return { rows: list, total: num(t?.n) };
  },
});
