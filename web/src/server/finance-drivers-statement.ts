import { sql } from "drizzle-orm";
import { num, rows } from "./analytics/guard";
import { at } from "./finance-drivers-sql";
import { STATEMENT_SOURCES } from "./finance-drivers-lib";
import type { TablePage, TableQuery } from "./finance-drivers-tables";

export { STATEMENT_SOURCES };

/**
 * The statement: ONE chronological list of everything that moved money for a driver, newest first.
 *   settlement      what a job earned (billed settlements, not rejected) — at its creation
 *   wallet          every ledger entry of his wallet, with the wallet balance AFTER it (the running balance exists only on these rows)
 *   cod_collected   cash taken from recipients, one row per order and Riyadh day (so a period boundary never splits a row)
 *   cod_remitted    cash handed over to the warehouse / ops (one row per remittance)
 * Settlements and cash rows do not change the wallet (the payout later arrives as a `wallet` row), so the list is a journal, not a sum. Withdrawals are the wallet rows
 * `withdrawal_hold / paid / release`. `amountCents` is signed (cash collected counts as +, handed over as −: what the driver holds); the export splits it into In / Out.
 */
type Rec = Record<string, unknown>;
const iso = (v: unknown) => (v == null ? null : new Date(String(v)).toISOString());
const str = (v: unknown) => (v == null ? null : String(v));

function union(q: TableQuery) {
  const p = q.period, id = q.id;
  return sql`(
    select 'settlement'::text as source, settlements.id::text as rid, settlements.created_at as at, settlements.status::text as kind, requests.ref::text as ref, settlements.request_id::text as request_id,
      settlements.provider_cents::float8 as amount, null::float8 as balance, settlements.note::text as note, coalesce(op.office_name, ou.name)::text as office
    from settlements join requests on requests.id = settlements.request_id left join users ou on ou.id = settlements.office_id left join office_profiles op on op.user_id = settlements.office_id
    where settlements.driver_id = ${id} and settlements.status <> 'rejected' and ${at(sql`settlements.created_at`, p)}
    union all
    select 'wallet', w.id::text, w.created_at, w.kind::text, r.ref::text, w.request_id::text, w.available_delta_cents::float8, w.balance, w.note::text, null::text
    from (select e.id, e.kind, e.created_at, e.request_id, e.available_delta_cents, e.note, (sum(e.available_delta_cents) over (order by e.created_at, e.id))::float8 as balance
        from ledger_entries e join wallet_accounts a on a.id = e.account_id where a.owner_id = ${id} and a.kind = 'user') w
      left join requests r on r.id = w.request_id where ${at(sql`w.created_at`, p)}
    union all
    select 'cod_collected', offers.id::text || ':' || to_char(shipments.cod_collected_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD'), max(shipments.cod_collected_at), 'collected', requests.ref::text, requests.id::text,
      sum(shipments.cod_collected_cents)::float8, null::float8, null::text, null::text
    from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
    where offers.driver_id = ${id} and requests.status <> 'draft' and shipments.cod_collected_cents > 0 and ${at(sql`shipments.cod_collected_at`, p)}
    group by offers.id, requests.id, requests.ref, to_char(shipments.cod_collected_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD')
    union all
    select 'cod_remitted', cod_remittances.id::text, cod_remittances.created_at, 'remitted', requests.ref::text, requests.id::text, -cod_remittances.amount_cents::float8, null::float8, cod_remittances.note::text, null::text
    from cod_remittances join requests on requests.id = cod_remittances.request_id where cod_remittances.driver_id = ${id} and ${at(sql`cod_remittances.created_at`, p)}
  ) s`;
}

export async function statementTable(q: TableQuery): Promise<TablePage> {
  const src = (STATEMENT_SOURCES as readonly string[]).includes(q.kind) ? sql`where s.source = ${q.kind}` : sql``;
  const [list, sums] = await Promise.all([
    rows<Rec>(sql`select s.* from ${union(q)} ${src} order by s.at desc, s.rid desc limit ${q.limit} offset ${q.offset}`),
    rows<Rec>(sql`select s.source, count(*)::int as n, coalesce(sum(s.amount) filter (where s.amount > 0), 0)::float8 as pos, coalesce(sum(-s.amount) filter (where s.amount < 0), 0)::float8 as neg from ${union(q)} ${src} group by s.source`),
  ]);
  const by = Object.fromEntries(sums.map((r) => [String(r.source), r]));
  const get = (s: string, f: "n" | "pos" | "neg") => num(by[s]?.[f]);
  const total = sums.reduce((n, r) => n + num(r.n), 0);
  return {
    total,
    totals: {
      settlementCents: get("settlement", "pos"), walletInCents: get("wallet", "pos"), walletOutCents: get("wallet", "neg"), cashInCents: get("cod_collected", "pos"), cashOutCents: get("cod_remitted", "neg"),
      settlementN: get("settlement", "n"), walletN: get("wallet", "n"), cashCollectedN: get("cod_collected", "n"), cashRemittedN: get("cod_remitted", "n"),
    },
    rows: list.map((r) => {
      const amount = num(r.amount), source = String(r.source);
      return { id: `${source}:${r.rid}`, source, kind: String(r.kind), at: iso(r.at), ref: str(r.ref), requestId: str(r.request_id), note: str(r.note), office: str(r.office), amountCents: amount, inCents: amount > 0 ? amount : 0, outCents: amount < 0 ? -amount : 0, balanceCents: r.balance == null ? null : num(r.balance) };
    }),
  };
}
