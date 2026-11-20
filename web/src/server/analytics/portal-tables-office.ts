import { sql } from "drizzle-orm";
import { ledgerEntries, offers, settlements, withdrawals } from "@/db/schema";
import { getSettings } from "../settings";
import { inWindow, scope } from "./conditions";
import { num, rows } from "./guard";
import { anonCompany } from "./portal-office-facts";
import { CARD_RATES, scorecardsSql } from "./portal-office-drivers";
import { definePortalTable } from "./portal-registry";

type Row = Record<string, unknown>;

/**
 * Drill-down tables of the COURIER-OFFICE reports. Every table starts from the office's own offers / settlements / wallet through `scope(f, …)` or the session user; companies
 * only appear under their anonymous label (`C-3F9A`), recipients never appear, and the customer price and platform margin are never selected.
 */
const page = async (list: Promise<Row[]>, count: Promise<Row[]>) => { const [r, [t]] = await Promise.all([list, count]); return { rows: r, total: num(t?.n) }; };

definePortalTable({
  portal: "office", name: "jobs", title: "rpr.tbl_jobs",
  columns: [
    { key: "ref", label: "rpr.col_order", type: "link", href: "/office/jobs/{id}", sub: "company" },
    { key: "driver", label: "rpr.col_driver", type: "link", href: "/office/drivers/{driverId}", phone: false },
    { key: "service", label: "rpr.col_service", type: "enum", ns: "svc", phone: false },
    { key: "deliveryCity", label: "rpr.col_city", type: "enum", ns: "city", phone: false },
    { key: "status", label: "rpr.col_status", type: "status", ns: "jobstatus" },
    { key: "units", label: "rpr.col_units", type: "number", align: "end", phone: false },
    { key: "earnings", label: "rpr.col_earnings", type: "money", align: "end" },
    { key: "acceptedAt", label: "rpr.col_accepted", type: "datetime" },
    { key: "startsAt", label: "rpr.col_starts", type: "datetime", phone: false },
  ],
  sorts: { ref: sql`requests.ref`, driver: sql`du.name`, service: sql`requests.service`, deliveryCity: sql`requests.delivery_city`, status: sql`offers.status`, units: sql`offers.final_units`, earnings: sql`settlements.provider_cents`, acceptedAt: sql`offers.accepted_at`, startsAt: sql`requests.starts_at` },
  defaultSort: { key: "acceptedAt", dir: "desc" }, tiebreak: sql`offers.id`,
  async query({ c, limit, offset, order }) {
    const where = sql`${scope(c.f, "offers")} and offers.accepted_at is not null and ${inWindow(offers.acceptedAt, c.f.cur)}`;
    const from = sql`from offers join requests on requests.id = offers.request_id join users du on du.id = offers.driver_id left join settlements on settlements.offer_id = offers.id and settlements.status <> 'rejected'`;
    return page(rows<Row>(sql`
      select offers.id, offers.driver_id as "driverId", requests.ref, ${anonCompany(c.me)} as company, du.name as driver, requests.service, requests.delivery_city as "deliveryCity", offers.status,
        coalesce(offers.final_units, offers.expected_units) as units, settlements.provider_cents as earnings, offers.accepted_at as "acceptedAt", requests.starts_at as "startsAt"
      ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`), rows<Row>(sql`select count(*)::int as n ${from} where ${where}`));
  },
});

definePortalTable({
  portal: "office", name: "drivers", title: "rpr.tbl_drivers",
  columns: [
    { key: "name", label: "rpr.col_driver", type: "link", href: "/office/drivers/{id}" },
    { key: "jobs", label: "rpr.col_jobs", type: "number", align: "end" },
    { key: "delivered", label: "rpr.col_delivered_n", type: "number", align: "end", phone: false },
    { key: "success", label: "rpr.col_success", type: "percent", align: "end" },
    { key: "onTimeRate", label: "rpr.col_on_time", type: "percent", align: "end", phone: false },
    { key: "rating", label: "rpr.col_rating", type: "number", align: "end", phone: false },
    { key: "acceptance", label: "rpr.col_acceptance", type: "percent", align: "end", phone: false },
    { key: "noShow", label: "rpr.col_no_shows", type: "number", align: "end", phone: false },
    { key: "cancelled", label: "rpr.col_cancels", type: "number", align: "end", phone: false },
    { key: "earnings", label: "rpr.col_earnings", type: "money", align: "end" },
  ],
  sorts: { name: sql`name`, jobs: sql`jobs`, delivered: sql`delivered`, success: sql`success`, onTimeRate: sql`on_time_rate`, rating: sql`rating`, acceptance: sql`acceptance`, noShow: sql`no_show`, cancelled: sql`cancelled`, earnings: sql`earnings` },
  defaultSort: { key: "jobs", dir: "desc" }, tiebreak: sql`id`,
  async query({ c, limit, offset, order }) {
    const cards = scorecardsSql(c.f, c.me, (await getSettings()).lateGraceMin);
    const [list, [t]] = await Promise.all([
      rows<Row>(sql`${cards}
        select id, name, jobs, delivered, no_show as "noShow", cancelled, earnings, ${CARD_RATES} from card order by ${order} limit ${limit} offset ${offset}`),
      rows<Row>(sql`${cards} select count(*)::int as n from card`),
    ]);
    const out = list.map((r) => ({ ...r, onTimeRate: r.on_time_rate, rating: r.rating == null ? null : Math.round(Number(r.rating) * 10) / 10 }));
    return { rows: out, total: num(t?.n) };
  },
});

definePortalTable({
  portal: "office", name: "settlements", title: "rpr.tbl_settlements",
  columns: [
    { key: "ref", label: "rpr.col_order", type: "link", href: "/office/jobs/{offerId}", sub: "company" },
    { key: "driver", label: "rpr.col_driver", type: "text", phone: false },
    { key: "status", label: "rpr.col_status", type: "status", ns: "settle" },
    { key: "finalUnits", label: "rpr.col_units", type: "number", align: "end", phone: false },
    { key: "amountCents", label: "rpr.col_amount", type: "money", align: "end" },
    { key: "createdAt", label: "rpr.col_created", type: "datetime" },
    { key: "paidAt", label: "rpr.col_paid", type: "datetime", phone: false },
  ],
  sorts: { ref: sql`requests.ref`, driver: sql`du.name`, status: sql`settlements.status`, finalUnits: sql`settlements.final_units`, amountCents: sql`settlements.provider_cents`, createdAt: sql`settlements.created_at`, paidAt: sql`settlements.paid_at` },
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`settlements.id`,
  async query({ c, limit, offset, order }) {
    const where = sql`${scope(c.f, "settlements")} and ${inWindow(settlements.createdAt, c.f.cur)}`;
    const from = sql`from settlements join requests on requests.id = settlements.request_id join users du on du.id = settlements.driver_id`;
    return page(rows<Row>(sql`
      select settlements.id, settlements.offer_id as "offerId", requests.ref, ${anonCompany(c.me)} as company, du.name as driver, settlements.status, settlements.final_units as "finalUnits",
        settlements.provider_cents as "amountCents", settlements.created_at as "createdAt", settlements.paid_at as "paidAt" ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`),
    rows<Row>(sql`select count(*)::int as n ${from} where ${where}`));
  },
});

definePortalTable({
  portal: "office", name: "payouts", title: "rpr.tbl_payouts",
  columns: [
    { key: "createdAt", label: "rpr.col_requested", type: "datetime" },
    { key: "amountCents", label: "rpr.col_amount", type: "money", align: "end" },
    { key: "status", label: "rpr.col_status", type: "status", ns: "status" },
    { key: "bankName", label: "rpr.col_bank", type: "text", phone: false },
    { key: "paymentRef", label: "rpr.col_payment_ref", type: "text", phone: false },
    { key: "decidedAt", label: "rpr.col_decided", type: "datetime", phone: false },
  ],
  sorts: { createdAt: sql`withdrawals.created_at`, amountCents: sql`withdrawals.amount_cents`, status: sql`withdrawals.status`, bankName: sql`withdrawals.bank_name`, decidedAt: sql`withdrawals.decided_at` },
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`withdrawals.id`,
  async query({ c, limit, offset, order }) {
    const where = sql`withdrawals.user_id = ${c.me} and ${inWindow(withdrawals.createdAt, c.f.cur)}`;
    return page(rows<Row>(sql`
      select withdrawals.id, withdrawals.created_at as "createdAt", withdrawals.amount_cents as "amountCents", withdrawals.status, withdrawals.bank_name as "bankName", withdrawals.payment_ref as "paymentRef",
        withdrawals.decided_at as "decidedAt" from withdrawals where ${where} order by ${order} limit ${limit} offset ${offset}`), rows<Row>(sql`select count(*)::int as n from withdrawals where ${where}`));
  },
});

definePortalTable({
  portal: "office", name: "ledger", title: "rpr.tbl_ledger",
  columns: [
    { key: "createdAt", label: "rpr.col_date", type: "datetime" },
    { key: "kind", label: "rpr.col_type", type: "enum", ns: "ledger" },
    { key: "availableCents", label: "rpr.col_available", type: "money", align: "end" },
    { key: "heldCents", label: "rpr.col_held", type: "money", align: "end", phone: false },
  ],
  sorts: { createdAt: sql`ledger_entries.created_at`, kind: sql`ledger_entries.kind`, availableCents: sql`ledger_entries.available_delta_cents`, heldCents: sql`ledger_entries.held_delta_cents` },
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`ledger_entries.id`,
  async query({ c, limit, offset, order }) {
    const where = sql`wallet_accounts.owner_id = ${c.me} and ${inWindow(ledgerEntries.createdAt, c.f.cur)}`;
    const from = sql`from ledger_entries join wallet_accounts on wallet_accounts.id = ledger_entries.account_id`;
    return page(rows<Row>(sql`
      select ledger_entries.id, ledger_entries.created_at as "createdAt", ledger_entries.kind, ledger_entries.available_delta_cents as "availableCents", ledger_entries.held_delta_cents as "heldCents"
      ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`), rows<Row>(sql`select count(*)::int as n ${from} where ${where}`));
  },
});
