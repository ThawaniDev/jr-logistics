import { sql, type SQL } from "drizzle-orm";
import { settlements, withdrawals } from "@/db/schema";
import { anyWindow, BILLED, inWindow, scope, twinRead, twinSelect, type Metric } from "./conditions";
import { AGE_KEYS, ageKeySql, sqlList, type AgeKey, type Pair, type Row } from "./finance-core";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { histogramFromRow, histogramSelect, type HistBucket } from "./stats";

export const SETTLE_FROM = sql`from settlements join requests on requests.id = settlements.request_id`;
/** An unpaid settlement waits on an open complaint that holds the job's money. */
export const HELD = sql`exists (select 1 from complaints c where c.holds_settlement and c.status in ('open','in_progress') and (c.offer_id = settlements.offer_id or (c.offer_id is null and c.request_id = settlements.request_id)))`;
export const UNPAID = sql`settlements.status not in ('paid','rejected')`;
/** Edges of the created → paid latency histogram (seconds): 1 min, 5 min, 1 h, 6 h, 1 day, 3 days. */
export const LATENCY_EDGES = [60, 300, 3600, 21_600, 86_400, 259_200];

const read = (r: Row | undefined, m: Record<string, Metric>): Record<string, Pair> => Object.fromEntries(Object.keys(m).map((k) => [k, twinRead(r, k)]));

/** Billed amount, VAT, provider cost, margin and the payee split of the settlements created in the period (rejected ones are not billed). */
export async function settlementFacts(f: ResolvedFilters) {
  const on = (w: Parameters<Metric>[0]) => sql`${w(settlements.createdAt)} and ${BILLED}`;
  const sum = (col: string, extra?: SQL): Metric => (w) => sql`coalesce(sum(${sql.raw(col)}) filter (where ${on(w)}${extra ? sql` and ${extra}` : sql``}), 0)::float8`;
  const m: Record<string, Metric> = {
    billed: sum("settlements.customer_cents"), vat: sum("settlements.vat_cents"), provider: sum("settlements.provider_cents"), margin: sum("settlements.margin_cents"),
    office: sum("settlements.provider_cents", sql`settlements.office_id is not null`), direct: sum("settlements.provider_cents", sql`settlements.office_id is null`),
    refund: sum("greatest(settlements.refund_cents, 0)"),
    n: (w) => sql`count(*) filter (where ${on(w)})::int`, orders: (w) => sql`count(distinct settlements.request_id) filter (where ${on(w)})::int`,
  };
  const [r] = await rows<Row>(sql`select ${twinSelect(f, m)} ${SETTLE_FROM} where ${scope(f, "settlements")} and ${anyWindow(f, settlements.createdAt)}`);
  return read(r, m);
}
export type SettlementFacts = Awaited<ReturnType<typeof settlementFacts>>;

/** Parcels delivered in the period (the denominator of revenue per parcel). */
export async function deliveredParcels(f: ResolvedFilters): Promise<Pair> {
  const [r] = await rows<Row>(sql`select ${twinSelect(f, { n: (w) => sql`count(*) filter (where ${w("shipments.delivered_at")})::int` })}
    from shipments join requests on requests.id = shipments.request_id where ${scope(f, "shipments")} and shipments.status = 'delivered' and ${anyWindow(f, "shipments.delivered_at")}`);
  return twinRead(r, "n");
}

/** How fast settlements are paid: created → paid, for the settlements created in the period (average for both periods, percentiles and the histogram for the current one). */
export async function latencyFacts(f: ResolvedFilters) {
  const secs = sql`extract(epoch from (settlements.paid_at - settlements.created_at))`;
  const paid = sql`settlements.status = 'paid' and settlements.paid_at is not null and settlements.paid_at >= settlements.created_at`;
  const pct = (p: number): Metric => (w) => sql`percentile_cont(${sql.raw(String(p))}) within group (order by ${secs}) filter (where ${paid} and ${w(settlements.createdAt)})::float8`;
  const m: Record<string, Metric> = {
    avg: (w) => sql`avg(${secs}) filter (where ${paid} and ${w(settlements.createdAt)})::float8`, p50: pct(0.5), p90: pct(0.9),
    paid_n: (w) => sql`count(*) filter (where ${paid} and ${w(settlements.createdAt)})::int`,
  };
  const [r] = await rows<Row>(sql`select ${twinSelect(f, m)}, ${histogramSelect(secs, LATENCY_EDGES, "h", sql`${paid} and ${inWindow(settlements.createdAt, f.cur)}`)}
    ${SETTLE_FROM} where ${scope(f, "settlements")} and ${BILLED} and ${anyWindow(f, settlements.createdAt)}`);
  const hist: HistBucket[] = histogramFromRow(r ?? {}, LATENCY_EDGES);
  return { ...read(r, m), hist, n: hist.reduce((s, b) => s + b.count, 0) } as Record<string, Pair> & { hist: HistBucket[]; n: number };
}

export interface PipelineRow { key: AgeKey; n: number; payoutCents: number; heldN: number; heldCents: number }
/** Settlements that are not paid yet, as of now: how many, how much is waiting to be paid out, how many are held by a complaint, and how old they are. */
export async function pipelineNow(f: ResolvedFilters) {
  const r = await rows<Row>(sql`select ${ageKeySql(sql`floor(extract(epoch from (now() - settlements.created_at)) / 86400)`)} as bucket, count(*)::int as n, coalesce(sum(settlements.provider_cents), 0)::float8 as payout,
      count(*) filter (where ${HELD})::int as held_n, coalesce(sum(settlements.provider_cents) filter (where ${HELD}), 0)::float8 as held_cents
    ${SETTLE_FROM} where ${scope(f, "settlements")} and ${UNPAID} group by 1`);
  const by = new Map(r.map((x) => [String(x.bucket), x]));
  const buckets: PipelineRow[] = AGE_KEYS.map((key) => ({ key, n: num(by.get(key)?.n), payoutCents: num(by.get(key)?.payout), heldN: num(by.get(key)?.held_n), heldCents: num(by.get(key)?.held_cents) }));
  return { buckets, unpaid: buckets.reduce((s, b) => s + b.n, 0), payoutCents: buckets.reduce((s, b) => s + b.payoutCents, 0), held: buckets.reduce((s, b) => s + b.heldN, 0), heldCents: buckets.reduce((s, b) => s + b.heldCents, 0) };
}

/** Filter of the withdrawals: a withdrawal belongs to the driver or office that asked for it, so only those two filters narrow it. */
export const payeeScope = (f: ResolvedFilters): SQL => (f.driver.length || f.office.length ? sql`${withdrawals.userId} in (${sqlList([...f.driver, ...f.office])})` : sql`true`);
/** Edges of the request → decision histogram (seconds): 1 h, 6 h, 1 day, 2 days, 3 days, 7 days. */
export const WD_EDGES = [3600, 21_600, 86_400, 172_800, 259_200, 604_800];

/** Withdrawals (wallet → bank): requested, paid and rejected in the period with their turnaround, what is waiting now, and the split by status and by who asked. */
export async function withdrawalFacts(f: ResolvedFilters) {
  const secs = sql`extract(epoch from (withdrawals.decided_at - withdrawals.created_at))`;
  const decided = sql`withdrawals.status in ('paid','rejected') and withdrawals.decided_at is not null and withdrawals.decided_at >= withdrawals.created_at`;
  const pct = (p: number): Metric => (w) => sql`percentile_cont(${sql.raw(String(p))}) within group (order by ${secs}) filter (where ${decided} and ${w(withdrawals.decidedAt)})::float8`;
  const m: Record<string, Metric> = {
    req_n: (w) => sql`count(*) filter (where ${w(withdrawals.createdAt)})::int`, req_c: (w) => sql`coalesce(sum(withdrawals.amount_cents) filter (where ${w(withdrawals.createdAt)}), 0)::float8`,
    paid_n: (w) => sql`count(*) filter (where withdrawals.status = 'paid' and ${w(withdrawals.decidedAt)})::int`, paid_c: (w) => sql`coalesce(sum(withdrawals.amount_cents) filter (where withdrawals.status = 'paid' and ${w(withdrawals.decidedAt)}), 0)::float8`,
    rej_n: (w) => sql`count(*) filter (where withdrawals.status = 'rejected' and ${w(withdrawals.decidedAt)})::int`, rej_c: (w) => sql`coalesce(sum(withdrawals.amount_cents) filter (where withdrawals.status = 'rejected' and ${w(withdrawals.decidedAt)}), 0)::float8`,
    avg: (w) => sql`avg(${secs}) filter (where ${decided} and ${w(withdrawals.decidedAt)})::float8`, p50: pct(0.5), p90: pct(0.9),
  };
  const inCur = inWindow(withdrawals.createdAt, f.cur);
  const [[r], now, split, who] = await Promise.all([
    rows<Row>(sql`select ${twinSelect(f, m)} from withdrawals where ${payeeScope(f)} and (${anyWindow(f, withdrawals.createdAt, withdrawals.decidedAt)})`),
    rows<Row>(sql`select count(*)::int as n, coalesce(sum(amount_cents), 0)::float8 as c, coalesce(extract(epoch from (now() - min(created_at))), 0)::float8 as oldest from withdrawals where ${payeeScope(f)} and status in ('pending','approved')`),
    rows<Row>(sql`select status, count(*)::int as n, coalesce(sum(amount_cents), 0)::float8 as c from withdrawals where ${payeeScope(f)} and ${inCur} group by status`),
    rows<Row>(sql`select u.role, count(*)::int as n, coalesce(sum(withdrawals.amount_cents), 0)::float8 as c from withdrawals join users u on u.id = withdrawals.user_id where ${payeeScope(f)} and ${inCur} group by u.role`),
  ]);
  const hist = await rows<Row>(sql`select ${histogramSelect(secs, WD_EDGES, "h", decided)} from withdrawals where ${payeeScope(f)} and ${decided} and ${inWindow(withdrawals.decidedAt, f.cur)}`);
  const h = histogramFromRow(hist[0] ?? {}, WD_EDGES);
  const rowsOf = (list: Row[], key: string) => list.map((x) => ({ key: String(x[key]), n: num(x.n), cents: num(x.c) }));
  return { ...read(r, m), pending: { n: num(now[0]?.n), cents: num(now[0]?.c), oldestSecs: num(now[0]?.oldest) }, byStatus: rowsOf(split, "status"), byRole: rowsOf(who, "role"), hist: h, histN: h.reduce((s, b) => s + b.count, 0) } as Record<string, Pair> & WdExtra;
}
type WdExtra = { pending: { n: number; cents: number; oldestSecs: number }; byStatus: Array<{ key: string; n: number; cents: number }>; byRole: Array<{ key: string; n: number; cents: number }>; hist: HistBucket[]; histN: number };
export type WithdrawalFacts = Record<string, Pair> & WdExtra;
