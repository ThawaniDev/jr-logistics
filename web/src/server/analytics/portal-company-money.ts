import { sql } from "drizzle-orm";
import { codRemittances, invoices, ledgerEntries, messageLog, settlements, shipments } from "@/db/schema";
import { addDays, riyadhDay } from "./time";
import { anyWindow, BILLED, inWindow, scope, twinSelect } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { windowOf } from "./periods";
import { bucketSql, zeroFill } from "./buckets";
import { pair, z, type Row } from "./portal-facts";

/**
 * Money facts of ONE company. Prices are what the company is charged (`customer_cents`, VAT included, the same figure the invoice carries): the platform's margin and the
 * provider cost are never selected. Every query is owner-scoped through `scope()` (the company filter is forced by `portalCtx`) or by the wallet owner.
 */

/** Charged per period: the customer price of non-rejected settlements (by creation), the orders behind it, and the parcel work (delivery-driver service) with its units. */
export async function spendFacts(f: ResolvedFilters) {
  const parcelWork = sql`requests.service = 'delivery_driver'`;
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      spend: (w) => sql`coalesce(sum(settlements.customer_cents) filter (where ${w(settlements.createdAt)} and ${BILLED}), 0)::float8`,
      orders: (w) => sql`count(distinct settlements.request_id) filter (where ${w(settlements.createdAt)} and ${BILLED})::int`,
      parcel_spend: (w) => sql`coalesce(sum(settlements.customer_cents) filter (where ${w(settlements.createdAt)} and ${BILLED} and ${parcelWork}), 0)::float8`,
      parcel_units: (w) => sql`coalesce(sum(settlements.final_units) filter (where ${w(settlements.createdAt)} and ${BILLED} and ${parcelWork}), 0)::float8`,
    })}
    from settlements join requests on requests.id = settlements.request_id
    where ${scope(f, "settlements")} and ${anyWindow(f, settlements.createdAt)}`);
  return { spend: z(pair(r, "spend")), orders: z(pair(r, "orders")), parcel_spend: z(pair(r, "parcel_spend")), parcel_units: z(pair(r, "parcel_units")) };
}

/** The tax invoices issued in the period (total and the VAT inside it). */
export async function invoiceFacts(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      invoiced: (w) => sql`coalesce(sum(invoices.total_cents) filter (where ${w(invoices.createdAt)}), 0)::float8`,
      vat: (w) => sql`coalesce(sum(invoices.vat_cents) filter (where ${w(invoices.createdAt)}), 0)::float8`,
      n: (w) => sql`count(*) filter (where ${w(invoices.createdAt)})::int`,
    })}
    from invoices join requests on requests.id = invoices.request_id
    where ${scope(f, "requests")} and ${anyWindow(f, invoices.createdAt)}`);
  return { invoiced: z(pair(r, "invoiced")), vat: z(pair(r, "vat")), n: z(pair(r, "n")) };
}

/** Cash on delivery: collected from recipients (by collection time), received back by the warehouse (by remittance time), and what drivers still hold (as of now, any date). */
export async function codFacts(f: ResolvedFilters, me: string) {
  const [col, rec, held] = await Promise.all([
    rows<Row>(sql`
      select ${twinSelect(f, { collected: (w) => sql`coalesce(sum(shipments.cod_collected_cents) filter (where shipments.status = 'delivered' and ${w(shipments.codCollectedAt)}), 0)::float8` })}
      from shipments join requests on requests.id = shipments.request_id where ${scope(f, "shipments")} and ${anyWindow(f, shipments.codCollectedAt)}`),
    rows<Row>(sql`
      select ${twinSelect(f, { received: (w) => sql`coalesce(sum(cod_remittances.amount_cents) filter (where ${w(codRemittances.createdAt)}), 0)::float8` })}
      from cod_remittances join requests on requests.id = cod_remittances.request_id where ${scope(f, "requests")} and ${anyWindow(f, codRemittances.createdAt)}`),
    // per job: collected minus received, never below 0 (a remittance cannot create credit), summed. Same rule as the warehouse's cash page.
    rows<Row>(sql`
      select coalesce(sum(greatest(0, c.collected - coalesce(r.received, 0))), 0)::float8 as outstanding, count(*) filter (where c.collected > coalesce(r.received, 0))::int as jobs
      from (select shipments.offer_id, sum(shipments.cod_collected_cents) as collected from shipments join requests on requests.id = shipments.request_id
            where ${scope(f, "shipments")} and shipments.status = 'delivered' and shipments.cod_collected_cents > 0 and shipments.offer_id is not null group by shipments.offer_id) c
      left join (select offer_id, sum(amount_cents) as received from cod_remittances where business_id = ${me} group by offer_id) r on r.offer_id = c.offer_id`),
  ]);
  return { collected: z(pair(col[0], "collected")), received: z(pair(rec[0], "received")), outstanding: num(held[0]?.outstanding), jobs: num(held[0]?.jobs) };
}

/** Messages to recipients (delivery code, tracking link): how many were sent and how many failed. */
export async function smsFacts(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      sent: (w) => sql`count(*) filter (where ${w(messageLog.createdAt)})::int`,
      failed: (w) => sql`count(*) filter (where message_log.status = 'failed' and ${w(messageLog.createdAt)})::int`,
    })}
    from message_log join requests on requests.id = message_log.request_id
    where ${scope(f, "requests")} and message_log.channel = 'sms' and message_log.type in ('recipient_code','recipient_track') and ${anyWindow(f, messageLog.createdAt)}`);
  return { sent: z(pair(r, "sent")), failed: z(pair(r, "failed")) };
}

/** The owner's wallet: top-ups in the period (twin) and the balance now. */
export async function walletFacts(f: ResolvedFilters, me: string) {
  const [[t], [w]] = await Promise.all([
    rows<Row>(sql`
      select ${twinSelect(f, {
        topups: (x) => sql`coalesce(sum(ledger_entries.available_delta_cents) filter (where ledger_entries.kind = 'topup' and ${x(ledgerEntries.createdAt)}), 0)::float8`,
        charges: (x) => sql`coalesce(-sum(ledger_entries.available_delta_cents) filter (where ledger_entries.kind = 'charge' and ${x(ledgerEntries.createdAt)}), 0)::float8`,
      })}
      from ledger_entries join wallet_accounts on wallet_accounts.id = ledger_entries.account_id where wallet_accounts.owner_id = ${me} and ${anyWindow(f, ledgerEntries.createdAt)}`),
    rows<Row>(sql`select available_cents::float8 as available, reserved_cents::float8 as reserved, held_cents::float8 as held, credit_limit_cents::float8 as credit from wallet_accounts where owner_id = ${me}`),
  ]);
  const available = num(w?.available), credit = num(w?.credit);
  return { topups: z(pair(t, "topups")), charges: z(pair(t, "charges")), available, reserved: num(w?.reserved), held: num(w?.held), creditLimit: credit, creditUsed: Math.max(0, -available) };
}

export interface LedgerKindRow { kind: string; n: number; prevN: number | null; amount: number; prevAmount: number | null }
/** The wallet movements of the period by kind (top-up, reservation, release, charge, refund, adjustment …): how many, and how much. */
export async function ledgerSummary(f: ResolvedFilters, me: string): Promise<LedgerKindRow[]> {
  const amt = sql`greatest(abs(ledger_entries.available_delta_cents), abs(ledger_entries.reserved_delta_cents), abs(ledger_entries.held_delta_cents))`;
  const r = await rows<Row>(sql`
    select ledger_entries.kind as kind, ${twinSelect(f, {
      n: (w) => sql`count(*) filter (where ${w(ledgerEntries.createdAt)})::int`,
      amount: (w) => sql`coalesce(sum(${amt}) filter (where ${w(ledgerEntries.createdAt)}), 0)::float8`,
    })}
    from ledger_entries join wallet_accounts on wallet_accounts.id = ledger_entries.account_id
    where wallet_accounts.owner_id = ${me} and ${anyWindow(f, ledgerEntries.createdAt)} group by ledger_entries.kind order by amount_c desc, ledger_entries.kind`);
  return r.map((x) => ({ kind: String(x.kind), n: num(x.n_c), prevN: f.prev ? num(x.n_p) : null, amount: num(x.amount_c), prevAmount: f.prev ? num(x.amount_p) : null })).filter((x) => x.n > 0 || (x.prevN ?? 0) > 0);
}

/** Daily charged amount of the last 28 Riyadh days (today included), honouring the request-level filters but NOT the report period: the run-rate the forecast starts from. */
export async function dailySpend28(f: ResolvedFilters, now: Date = new Date()): Promise<number[]> {
  const today = riyadhDay(now), from = addDays(today, -27), w = windowOf(from, today);
  const keys = Array.from({ length: 28 }, (_, i) => addDays(from, i));
  const r = await rows<{ t: string; spend: number }>(sql`
    select ${bucketSql(settlements.createdAt, "day")} as t, coalesce(sum(settlements.customer_cents), 0)::float8 as spend
    from settlements join requests on requests.id = settlements.request_id
    where ${scope(f, "settlements")} and ${BILLED} and ${inWindow(settlements.createdAt, w)} group by 1`);
  return zeroFill(keys, r, ["spend"] as const).map((p) => p.spend);
}
