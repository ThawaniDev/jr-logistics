import { inArray, sql, type SQL } from "drizzle-orm";
import { codRemittances, shipments } from "@/db/schema";
import { allOf, anyWindow, inWindow, PARCEL_OUTCOME_AT as OUT, requestScope, scope, twinRead, twinSelect, type Metric } from "./conditions";
import { secsBetween, sqlList, type Pair, type Row } from "./finance-core";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { histogramFromRow, histogramSelect, type HistBucket } from "./stats";

/** Parcels with cash on delivery: `cod_cents > 0`. */
const COD = sql`shipments.cod_cents > 0`;
const DELIVERED = sql`shipments.status = 'delivered'`;
export const PARCEL_FROM = sql`from shipments join requests on requests.id = shipments.request_id`;
/** Edges of the collected → received histogram (seconds): 1 h, 6 h, 1 day, 2 days, 4 days, 7 days, 14 days. */
export const LAG_EDGES = [3600, 21_600, 86_400, 172_800, 345_600, 604_800, 1_209_600];
export const REMIT_FROM = sql`from cod_remittances join requests on requests.id = cod_remittances.request_id`;

/** Filters of the remittance table: the request's own filters plus driver / office (through the order's driver slot). */
export function remitScope(f: ResolvedFilters): SQL {
  const c = requestScope(f);
  if (f.driver.length) c.push(inArray(codRemittances.driverId, f.driver));
  if (f.office.length) c.push(sql`${codRemittances.offerId} in (select id from offers where office_id in (${sqlList(f.office)}))`);
  return allOf(...c);
}

/** COD parcels of the period: registered, delivered with the cash due and collected, failed (cash never collected), mismatches, and the cash collected on each period's days. */
export async function parcelFacts(f: ResolvedFilters) {
  const del = (w: (c: SQL) => SQL) => sql`${COD} and ${DELIVERED} and ${w(OUT)}`;
  const m: Record<string, Metric> = {
    all_created: (w) => sql`count(*) filter (where ${w(shipments.createdAt)})::int`,
    created: (w) => sql`count(*) filter (where ${COD} and ${w(shipments.createdAt)})::int`,
    value_created: (w) => sql`coalesce(sum(shipments.cod_cents) filter (where ${COD} and ${w(shipments.createdAt)}), 0)::float8`,
    delivered: (w) => sql`count(*) filter (where ${del(w)})::int`,
    due: (w) => sql`coalesce(sum(shipments.cod_cents) filter (where ${del(w)}), 0)::float8`,
    got: (w) => sql`coalesce(sum(shipments.cod_collected_cents) filter (where ${del(w)}), 0)::float8`,
    mismatch: (w) => sql`count(*) filter (where ${del(w)} and shipments.cod_collected_cents is distinct from shipments.cod_cents)::int`,
    failed: (w) => sql`count(*) filter (where ${COD} and shipments.status in ('failed','returned') and ${w(OUT)})::int`,
    failed_value: (w) => sql`coalesce(sum(shipments.cod_cents) filter (where ${COD} and shipments.status in ('failed','returned') and ${w(OUT)}), 0)::float8`,
    collected: (w) => sql`coalesce(sum(shipments.cod_collected_cents) filter (where ${DELIVERED} and ${w(shipments.codCollectedAt)}), 0)::float8`,
    collected_n: (w) => sql`count(*) filter (where ${DELIVERED} and shipments.cod_collected_cents is not null and ${w(shipments.codCollectedAt)})::int`,
  };
  const [r] = await rows<Row>(sql`select ${twinSelect(f, m)} ${PARCEL_FROM} where ${scope(f, "shipments")} and ${anyWindow(f, OUT, shipments.createdAt, shipments.codCollectedAt)}`);
  const out = {} as Record<string, Pair>;
  for (const name of Object.keys(m)) out[name] = twinRead(r, name);
  return out;
}
export type CodParcelFacts = Awaited<ReturnType<typeof parcelFacts>>;

/** Cash received back from drivers in the period, who received it, and how long it took (from the driver's latest collection on that order). */
export async function remitFacts(f: ResolvedFilters) {
  const lag = secsBetween(sql`lc.at`, codRemittances.createdAt);
  const pct = (p: number): Metric => (w) => sql`percentile_cont(${sql.raw(String(p))}) within group (order by ${lag}) filter (where ${w(codRemittances.createdAt)} and lc.at is not null and cod_remittances.created_at >= lc.at)::float8`;
  const m: Record<string, Metric> = {
    remitted: (w) => sql`coalesce(sum(cod_remittances.amount_cents) filter (where ${w(codRemittances.createdAt)}), 0)::float8`,
    n: (w) => sql`count(*) filter (where ${w(codRemittances.createdAt)})::int`,
    by_business: (w) => sql`count(*) filter (where ${w(codRemittances.createdAt)} and cod_remittances.received_by_role = 'business')::int`,
    by_staff: (w) => sql`count(*) filter (where ${w(codRemittances.createdAt)} and cod_remittances.received_by_role <> 'business')::int`,
    amt_business: (w) => sql`coalesce(sum(cod_remittances.amount_cents) filter (where ${w(codRemittances.createdAt)} and cod_remittances.received_by_role = 'business'), 0)::float8`,
    amt_staff: (w) => sql`coalesce(sum(cod_remittances.amount_cents) filter (where ${w(codRemittances.createdAt)} and cod_remittances.received_by_role <> 'business'), 0)::float8`,
    lag_p50: pct(0.5), lag_p90: pct(0.9),
  };
  const lagOk = sql`lc.at is not null and cod_remittances.created_at >= lc.at and ${inWindow(codRemittances.createdAt, f.cur)}`;
  const [r] = await rows<Row>(sql`select ${twinSelect(f, m)}, ${histogramSelect(lag, LAG_EDGES, "hl", lagOk)} ${REMIT_FROM}
    left join lateral (select max(shipments.cod_collected_at) as at from shipments where shipments.offer_id = cod_remittances.offer_id and shipments.cod_collected_at <= cod_remittances.created_at) lc on true
    where ${remitScope(f)} and ${anyWindow(f, codRemittances.createdAt)}`);
  const out = {} as Record<string, Pair>;
  for (const name of Object.keys(m)) out[name] = twinRead(r, name);
  const hist: HistBucket[] = histogramFromRow(r ?? {}, LAG_EDGES, "hl");
  return Object.assign(out, { hist, histN: hist.reduce((n, b) => n + b.count, 0) }) as Record<string, Pair> & { hist: HistBucket[]; histN: number };
}
export type CodRemitFacts = Awaited<ReturnType<typeof remitFacts>>;

/** Cash collected minus cash received back, cumulative up to each instant: the balance at the start and end of the current and comparison periods. */
export async function balances(f: ResolvedFilters) {
  const at = [f.cur.start, f.cur.end, ...(f.prev ? [f.prev.start, f.prev.end] : [])];
  const upTo = (col: SQL, amt: SQL) => sql.join(at.map((d, i) => sql`coalesce(sum(${amt}) filter (where ${col} < ${d.toISOString()}::timestamptz), 0)::float8 as ${sql.raw(`b${i}`)}`), sql`, `);
  const last = new Date(Math.max(...at.map((d) => d.getTime())));
  const [[c], [x]] = await Promise.all([
    rows<Row>(sql`select ${upTo(sql`shipments.cod_collected_at`, sql`shipments.cod_collected_cents`)} ${PARCEL_FROM}
      where ${scope(f, "shipments")} and ${DELIVERED} and shipments.cod_collected_cents is not null and ${sql`shipments.cod_collected_at < ${last.toISOString()}::timestamptz`}`),
    rows<Row>(sql`select ${upTo(sql`cod_remittances.created_at`, sql`cod_remittances.amount_cents`)} ${REMIT_FROM} where ${remitScope(f)} and cod_remittances.created_at < ${last.toISOString()}::timestamptz`),
  ]);
  const bal = (i: number) => num(c?.[`b${i}`]) - num(x?.[`b${i}`]);
  return { curStart: bal(0), curEnd: bal(1), prevStart: f.prev ? bal(2) : null, prevEnd: f.prev ? bal(3) : null };
}
