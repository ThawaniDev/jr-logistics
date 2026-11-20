import { sql } from "drizzle-orm";
import { invoices, ledgerEntries, requests, shipments } from "@/db/schema";
import { inWindow, NOT_DRAFT, scope } from "./conditions";
import { num, rows } from "./guard";
import { definePortalTable } from "./portal-registry";

type Row = Record<string, unknown>;

/**
 * Drill-down tables of the COMPANY reports. Every table starts from the company's own rows through `scope(f, …)` (the company filter is forced by the session), selects
 * nothing about recipients except the parcel's own city (no name, phone or address), and never carries the provider cost or the platform margin.
 */
const page = async (list: Promise<Row[]>, count: Promise<Row[]>) => { const [r, [t]] = await Promise.all([list, count]); return { rows: r, total: num(t?.n) }; };

definePortalTable({
  portal: "business", name: "parcels", title: "rpr.tbl_parcels",
  columns: [
    { key: "code", label: "rpr.col_code", type: "link", href: "/business/requests/{requestId}/parcels", sub: "externalRef" },
    { key: "ref", label: "rpr.col_order", type: "text", phone: false },
    { key: "city", label: "rpr.col_city", type: "enum", ns: "city" },
    { key: "status", label: "rpr.col_status", type: "status", ns: "shipstatus" },
    { key: "attempts", label: "rpr.col_attempts", type: "number", align: "end", phone: false },
    { key: "failReason", label: "rpr.col_reason", type: "enum", ns: "stopfail", phone: false },
    { key: "proof", label: "rpr.col_proof", type: "enum", ns: "rpr.proof", phone: false },
    { key: "codCents", label: "rpr.col_cod", type: "money", align: "end", phone: false },
    { key: "deliveredAt", label: "rpr.col_delivered", type: "datetime" },
    { key: "createdAt", label: "rpr.col_registered", type: "datetime", phone: false },
  ],
  sorts: { code: sql`shipments.code`, ref: sql`requests.ref`, city: sql`shipments.city`, status: sql`shipments.status`, attempts: sql`shipments.attempts`, failReason: sql`shipments.fail_reason`, codCents: sql`shipments.cod_cents`, deliveredAt: sql`shipments.delivered_at`, createdAt: sql`shipments.created_at` },
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`shipments.id`,
  async query({ c, limit, offset, order }) {
    const where = sql`${scope(c.f, "shipments")} and ${inWindow(shipments.createdAt, c.f.cur)}`;
    const from = sql`from shipments join requests on requests.id = shipments.request_id`;
    return page(rows<Row>(sql`
      select shipments.id, shipments.request_id as "requestId", shipments.code, shipments.external_ref as "externalRef", requests.ref, shipments.city, shipments.status, shipments.attempts, shipments.fail_reason as "failReason",
        shipments.proof_type as proof, shipments.cod_cents as "codCents", shipments.delivered_at as "deliveredAt", shipments.created_at as "createdAt"
      ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`), rows<Row>(sql`select count(*)::int as n ${from} where ${where}`));
  },
});

definePortalTable({
  portal: "business", name: "returns", title: "rpr.tbl_returns",
  columns: [
    { key: "code", label: "rpr.col_code", type: "link", href: "/business/requests/{requestId}/parcels", sub: "externalRef" },
    { key: "ref", label: "rpr.col_order", type: "text", phone: false },
    { key: "city", label: "rpr.col_city", type: "enum", ns: "city", phone: false },
    { key: "failReason", label: "rpr.col_reason", type: "enum", ns: "stopfail" },
    { key: "failedAt", label: "rpr.col_failed_at", type: "datetime" },
    { key: "days", label: "rpr.col_waiting_days", type: "number", align: "end" },
    { key: "codCents", label: "rpr.col_cod", type: "money", align: "end", phone: false },
  ],
  sorts: { code: sql`shipments.code`, ref: sql`requests.ref`, city: sql`shipments.city`, failReason: sql`shipments.fail_reason`, failedAt: sql`coalesce(shipments.failed_at, shipments.updated_at)`, days: sql`(now() - coalesce(shipments.failed_at, shipments.updated_at))`, codCents: sql`shipments.cod_cents` },
  defaultSort: { key: "failedAt", dir: "asc" }, tiebreak: sql`shipments.id`,
  async query({ c, limit, offset, order }) {
    const where = sql`${scope(c.f, "shipments")} and shipments.status = 'failed'`;
    const from = sql`from shipments join requests on requests.id = shipments.request_id`;
    return page(rows<Row>(sql`
      select shipments.id, shipments.request_id as "requestId", shipments.code, shipments.external_ref as "externalRef", requests.ref, shipments.city, shipments.fail_reason as "failReason",
        coalesce(shipments.failed_at, shipments.updated_at) as "failedAt", greatest(0, floor(extract(epoch from (now() - coalesce(shipments.failed_at, shipments.updated_at))) / 86400))::int as days, shipments.cod_cents as "codCents"
      ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`), rows<Row>(sql`select count(*)::int as n ${from} where ${where}`));
  },
});

definePortalTable({
  portal: "business", name: "requests", title: "rpr.tbl_requests",
  columns: [
    { key: "ref", label: "rpr.col_order", type: "link", href: "/business/requests/{id}" },
    { key: "service", label: "rpr.col_service", type: "enum", ns: "svc", phone: false },
    { key: "deliveryCity", label: "rpr.col_city", type: "enum", ns: "city" },
    { key: "status", label: "rpr.col_status", type: "status", ns: "status" },
    { key: "parcels", label: "rpr.col_parcels", type: "number", align: "end" },
    { key: "delivered", label: "rpr.col_delivered_n", type: "number", align: "end", phone: false },
    { key: "totalCents", label: "rpr.col_total", type: "money", align: "end" },
    { key: "startsAt", label: "rpr.col_starts", type: "datetime", phone: false },
    { key: "createdAt", label: "rpr.col_created", type: "datetime", phone: false },
  ],
  sorts: { ref: sql`requests.ref`, service: sql`requests.service`, deliveryCity: sql`requests.delivery_city`, status: sql`requests.status`, parcels: sql`parcels`, delivered: sql`delivered`, totalCents: sql`requests.total_cents`, startsAt: sql`requests.starts_at`, createdAt: sql`requests.created_at` },
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`requests.id`,
  async query({ c, limit, offset, order }) {
    const where = sql`${scope(c.f, "requests")} and ${NOT_DRAFT} and ${inWindow(requests.createdAt, c.f.cur)}`;
    return page(rows<Row>(sql`
      select requests.id, requests.ref, requests.service, requests.delivery_city as "deliveryCity", requests.status, requests.total_cents as "totalCents", requests.starts_at as "startsAt", requests.created_at as "createdAt",
        (select count(*)::int from shipments where shipments.request_id = requests.id) as parcels, (select count(*)::int from shipments where shipments.request_id = requests.id and shipments.status = 'delivered') as delivered
      from requests where ${where} order by ${order} limit ${limit} offset ${offset}`), rows<Row>(sql`select count(*)::int as n from requests where ${where}`));
  },
});

definePortalTable({
  portal: "business", name: "invoices", title: "rpr.tbl_invoices",
  columns: [
    { key: "number", label: "rpr.col_invoice", type: "text" },
    { key: "ref", label: "rpr.col_order", type: "link", href: "/business/requests/{requestId}/money", phone: false },
    { key: "subtotalCents", label: "rpr.col_subtotal", type: "money", align: "end", phone: false },
    { key: "vatCents", label: "rpr.col_vat", type: "money", align: "end", phone: false },
    { key: "totalCents", label: "rpr.col_total", type: "money", align: "end" },
    { key: "vatPct", label: "rpr.col_vat_pct", type: "number", align: "end", phone: false },
    { key: "createdAt", label: "rpr.col_issued", type: "datetime" },
  ],
  sorts: { number: sql`invoices.number`, ref: sql`requests.ref`, subtotalCents: sql`invoices.subtotal_cents`, vatCents: sql`invoices.vat_cents`, totalCents: sql`invoices.total_cents`, vatPct: sql`invoices.vat_pct`, createdAt: sql`invoices.created_at` },
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`invoices.id`,
  async query({ c, limit, offset, order }) {
    const where = sql`${scope(c.f, "requests")} and ${inWindow(invoices.createdAt, c.f.cur)}`;
    const from = sql`from invoices join requests on requests.id = invoices.request_id`;
    return page(rows<Row>(sql`
      select invoices.id, invoices.request_id as "requestId", invoices.number, requests.ref, invoices.subtotal_cents as "subtotalCents", invoices.vat_cents as "vatCents", invoices.total_cents as "totalCents",
        invoices.vat_pct as "vatPct", invoices.created_at as "createdAt" ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`), rows<Row>(sql`select count(*)::int as n ${from} where ${where}`));
  },
});

definePortalTable({
  portal: "business", name: "ledger", title: "rpr.tbl_ledger",
  columns: [
    { key: "createdAt", label: "rpr.col_date", type: "datetime" },
    { key: "kind", label: "rpr.col_type", type: "enum", ns: "ledger" },
    { key: "availableCents", label: "rpr.col_available", type: "money", align: "end" },
    { key: "reservedCents", label: "rpr.col_reserved", type: "money", align: "end", phone: false },
    { key: "ref", label: "rpr.col_order", type: "link", href: "/business/requests/{requestId}/money", phone: false },
  ],
  sorts: { createdAt: sql`ledger_entries.created_at`, kind: sql`ledger_entries.kind`, availableCents: sql`ledger_entries.available_delta_cents`, reservedCents: sql`ledger_entries.reserved_delta_cents`, ref: sql`requests.ref` },
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`ledger_entries.id`,
  async query({ c, limit, offset, order }) {
    const where = sql`wallet_accounts.owner_id = ${c.me} and ${inWindow(ledgerEntries.createdAt, c.f.cur)}`;
    const from = sql`from ledger_entries join wallet_accounts on wallet_accounts.id = ledger_entries.account_id left join requests on requests.id = ledger_entries.request_id and requests.business_id = ${c.me}`;
    return page(rows<Row>(sql`
      select ledger_entries.id, ledger_entries.created_at as "createdAt", ledger_entries.kind, ledger_entries.available_delta_cents as "availableCents", ledger_entries.reserved_delta_cents as "reservedCents",
        requests.id as "requestId", requests.ref ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`), rows<Row>(sql`select count(*)::int as n ${from} where ${where}`));
  },
});

definePortalTable({
  portal: "business", name: "cod", title: "rpr.tbl_cod",
  columns: [
    { key: "ref", label: "rpr.col_order", type: "link", href: "/business/requests/{requestId}/money", sub: "driver" },
    { key: "parcels", label: "rpr.col_parcels", type: "number", align: "end", phone: false },
    { key: "collected", label: "rpr.col_collected", type: "money", align: "end" },
    { key: "received", label: "rpr.col_received", type: "money", align: "end" },
    { key: "outstanding", label: "rpr.col_outstanding", type: "money", align: "end" },
    { key: "lastAt", label: "rpr.col_last_collected", type: "datetime", phone: false },
  ],
  sorts: { ref: sql`requests.ref`, parcels: sql`c.parcels`, collected: sql`c.collected`, received: sql`received`, outstanding: sql`outstanding`, lastAt: sql`c.last_at` },
  defaultSort: { key: "lastAt", dir: "desc" }, tiebreak: sql`c.offer_id`,
  async query({ c: ctx, limit, offset, order }) {
    const f = ctx.f;
    // one row per job (offer) that collected cash, the unit the warehouse hands cash back by: outstanding = collected − received, never below 0
    const base = sql`
      with c as (select shipments.offer_id, shipments.request_id, count(*)::int as parcels, coalesce(sum(shipments.cod_collected_cents), 0)::float8 as collected, max(shipments.cod_collected_at) as last_at
        from shipments join requests on requests.id = shipments.request_id
        where ${scope(f, "shipments")} and shipments.status = 'delivered' and shipments.cod_collected_cents > 0 and shipments.offer_id is not null group by shipments.offer_id, shipments.request_id
        having max(shipments.cod_collected_at) >= ${f.cur.start.toISOString()}::timestamptz and max(shipments.cod_collected_at) < ${f.cur.end.toISOString()}::timestamptz)`;
    const from = sql`from c join requests on requests.id = c.request_id join offers on offers.id = c.offer_id join users du on du.id = offers.driver_id
      left join lateral (select coalesce(sum(cod_remittances.amount_cents), 0)::float8 as received from cod_remittances where cod_remittances.offer_id = c.offer_id and cod_remittances.business_id = ${ctx.me}) r on true,
      lateral (select greatest(0, c.collected - r.received) as outstanding) o`;
    return page(rows<Row>(sql`${base}
      select c.offer_id as id, requests.id as "requestId", requests.ref, split_part(btrim(du.name), ' ', 1) as driver, c.parcels, c.collected, r.received, o.outstanding, c.last_at as "lastAt"
      ${from} order by ${order} limit ${limit} offset ${offset}`), rows<Row>(sql`${base} select count(*)::int as n from c`));
  },
});
