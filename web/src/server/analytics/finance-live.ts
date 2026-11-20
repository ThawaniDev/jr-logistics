import { sql, type SQL } from "drizzle-orm";
import { bucketKeys, type Bucket } from "./periods";
import { anyWindow, scope, twinRead, twinSelect, type Metric } from "./conditions";
import { namesOf, nullFill, sqlList, type Pair, type Row, type Series } from "./finance-core";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { bucketSql } from "./buckets";
import { riyadhDay } from "./time";

const read = (r: Row | undefined, m: Record<string, Metric>): Record<string, Pair> => Object.fromEntries(Object.keys(m).map((k) => [k, twinRead(r, k)]));

/**
 * Wallet movements of the period: top-ups, manual adjustments (credit / debit, user wallets only) and the money returned to businesses when a request ended without being fully
 * used — cancellations apart from expiry, partial release and completion. Top-ups and adjustments belong to a wallet, so only the company filter narrows them; refunds follow the request.
 */
export async function ledgerFacts(f: ResolvedFilters) {
  const owner = f.company.length ? sql`wa.owner_id in (${sqlList(f.company)})` : sql`true`;
  const kind = (k: string) => sql`ledger_entries.kind = ${k}`;
  const delta = sql`ledger_entries.available_delta_cents`;
  const m: Record<string, Metric> = {
    topup: (w) => sql`coalesce(sum(${delta}) filter (where ${kind("topup")} and ${owner} and ${w("ledger_entries.created_at")}), 0)::float8`,
    topup_n: (w) => sql`count(*) filter (where ${kind("topup")} and ${owner} and ${w("ledger_entries.created_at")})::int`,
    adj_in: (w) => sql`coalesce(sum(${delta}) filter (where ${kind("adjustment")} and wa.kind = 'user' and ${delta} > 0 and ${owner} and ${w("ledger_entries.created_at")}), 0)::float8`,
    adj_out: (w) => sql`coalesce(-sum(${delta}) filter (where ${kind("adjustment")} and wa.kind = 'user' and ${delta} < 0 and ${owner} and ${w("ledger_entries.created_at")}), 0)::float8`,
    cancel: (w) => sql`coalesce(sum(${delta}) filter (where ${kind("release_reserve")} and ledger_entries.settlement_id is null and (ledger_entries.idempotency_key like 'cancel-%') and ${scope(f, "requests")} and ${w("ledger_entries.created_at")}), 0)::float8`,
    cancel_n: (w) => sql`count(*) filter (where ${kind("release_reserve")} and ledger_entries.settlement_id is null and (ledger_entries.idempotency_key like 'cancel-%') and ${scope(f, "requests")} and ${w("ledger_entries.created_at")})::int`,
  };
  const [r] = await rows<Row>(sql`select ${twinSelect(f, m)} from ledger_entries join wallet_accounts wa on wa.id = ledger_entries.account_id left join requests on requests.id = ledger_entries.request_id
    where ledger_entries.kind in ('topup','adjustment','release_reserve') and ${anyWindow(f, "ledger_entries.created_at")}`);
  return read(r, m);
}
export type LedgerFacts = Awaited<ReturnType<typeof ledgerFacts>>;

/** Invoices issued in the period: how many and their subtotal, VAT and total. */
export async function invoiceFacts(f: ResolvedFilters) {
  const m: Record<string, Metric> = {
    n: (w) => sql`count(*) filter (where ${w("invoices.created_at")})::int`, sub: (w) => sql`coalesce(sum(invoices.subtotal_cents) filter (where ${w("invoices.created_at")}), 0)::float8`,
    vat: (w) => sql`coalesce(sum(invoices.vat_cents) filter (where ${w("invoices.created_at")}), 0)::float8`, total: (w) => sql`coalesce(sum(invoices.total_cents) filter (where ${w("invoices.created_at")}), 0)::float8`,
  };
  const [r] = await rows<Row>(sql`select ${twinSelect(f, m)} from invoices join requests on requests.id = invoices.request_id where ${scope(f, "requests")} and ${anyWindow(f, "invoices.created_at")}`);
  return read(r, m);
}

/** What the platform holds for others right now: wallet liability (positive balances + held + escrow), escrow, cash still with drivers, credit in use, the platform's own wallet. */
export async function balancesNow() {
  const [r] = await rows<Row>(sql`select
      coalesce(sum(greatest(available_cents, 0)) filter (where kind = 'user'), 0)::float8 as avail, coalesce(sum(held_cents) filter (where kind = 'user'), 0)::float8 as held,
      coalesce(sum(reserved_cents) filter (where kind = 'user'), 0)::float8 as escrow, coalesce(sum(available_cents) filter (where kind = 'platform'), 0)::float8 as platform,
      (select coalesce(sum(cod_collected_cents), 0) from shipments where status = 'delivered' and cod_collected_cents is not null)::float8 - (select coalesce(sum(amount_cents), 0) from cod_remittances)::float8 as cash
    from wallet_accounts`);
  const liability = num(r?.avail) + num(r?.held) + num(r?.escrow);
  return { liability, escrow: num(r?.escrow), cash: num(r?.cash), platform: num(r?.platform), available: num(r?.avail), held: num(r?.held) };
}
export type BalancesNow = Awaited<ReturnType<typeof balancesNow>>;

export interface CreditRow { id: string; name: string | null; used: number; limit: number; util: number | null }
/** Credit facilities of the businesses (the company filter applies): the amount in use (negative balance), the approved limits, and the 10 heaviest users of their limit. */
export async function creditNow(f: ResolvedFilters) {
  const owner = f.company.length ? sql`wa.owner_id in (${sqlList(f.company)})` : sql`true`;
  const base = sql`from wallet_accounts wa join users u on u.id = wa.owner_id where wa.kind = 'user' and u.role = 'business' and ${owner}`;
  const [[t], top] = await Promise.all([
    rows<Row>(sql`select coalesce(sum(greatest(-wa.available_cents, 0)), 0)::float8 as used, coalesce(sum(wa.credit_limit_cents) filter (where wa.credit_limit_cents > 0), 0)::float8 as lim,
      count(*) filter (where wa.credit_limit_cents > 0)::int as n ${base}`),
    rows<Row>(sql`select wa.owner_id::text as id, greatest(-wa.available_cents, 0)::float8 as used, wa.credit_limit_cents::float8 as lim ${base} and wa.credit_limit_cents > 0 order by greatest(-wa.available_cents, 0)::float8 / wa.credit_limit_cents desc, wa.owner_id limit 10`),
  ]);
  const names = await namesOf(top.map((x) => String(x.id)));
  const list: CreditRow[] = top.map((x) => ({ id: String(x.id), name: names.get(String(x.id)) ?? null, used: num(x.used), limit: num(x.lim), util: num(x.lim) > 0 ? num(x.used) / num(x.lim) : null }));
  return { used: num(t?.used), limit: num(t?.lim), facilities: num(t?.n), top: list };
}

export const SNAP_FIELDS = ["liability", "escrow", "cash", "credit"] as const;
const SNAP_KEYS: Record<(typeof SNAP_FIELDS)[number], string> = { liability: "wallet_liability_cents", escrow: "wallet_escrow_cents", cash: "cash_with_drivers_cents", credit: "credit_exposure_cents" };

/**
 * Closing balance of every bucket from the daily platform snapshots (`metric_snapshots`): the last snapshot of the bucket. A bucket without a snapshot is a gap (null), never 0.
 * Hour buckets are shown per day (the snapshots are daily). When the period includes today, the last point is replaced by the live balances.
 */
export async function snapshotSeries(f: ResolvedFilters, live: BalancesNow): Promise<{ bucket: Bucket; points: Array<{ t: string } & Record<(typeof SNAP_FIELDS)[number], number | null>>; prev: Array<{ t: string } & Record<(typeof SNAP_FIELDS)[number], number | null>> | null }> {
  const bucket: Bucket = f.bucket === "hour" ? "day" : f.bucket;
  const col = sql.raw('metric_snapshots."at"');
  const q = (w: { start: Date; end: Date }): SQL => sql`select t, ${sql.join(SNAP_FIELDS.map((k) => sql`(array_agg((metrics->>${SNAP_KEYS[k]})::float8 order by at_ desc))[1] as ${sql.raw(k)}`), sql`, `)}
    from (select ${col} as at_, metrics, ${bucketSql(col, bucket)} as t from metric_snapshots where scope = 'day' and city is null and ${col} >= ${w.start.toISOString()}::timestamptz and ${col} < ${w.end.toISOString()}::timestamptz) s group by t`;
  const keys = bucket === f.bucket ? f.keys : bucketKeys(f.cur.from, f.cur.to, bucket);
  const prevKeys = f.prev ? (bucket === f.bucket && f.prevKeys ? f.prevKeys : bucketKeys(f.prev.from, f.prev.to, bucket)) : null;
  const [cur, prev] = await Promise.all([rows<{ t: string }>(q(f.cur)), f.prev ? rows<{ t: string }>(q(f.prev)) : null]);
  const points = nullFill(keys, cur, SNAP_FIELDS);
  if (f.cur.end.getTime() > Date.now() && riyadhDay(new Date()) <= f.cur.to && points.length) points[points.length - 1] = { t: points[points.length - 1].t, liability: live.liability, escrow: live.escrow, cash: live.cash, credit: points[points.length - 1].credit };
  return { bucket, points, prev: prev && prevKeys ? nullFill(prevKeys, prev, SNAP_FIELDS) : null };
}
export type SnapSeries = Awaited<ReturnType<typeof snapshotSeries>>;
export type { Series };
