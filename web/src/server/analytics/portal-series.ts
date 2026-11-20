import { sql, type SQL } from "drizzle-orm";
import { codRemittances, ledgerEntries, offers, settlements, shipments, withdrawals } from "@/db/schema";
import { bucketSql, zeroFill, type Point } from "./buckets";
import { BILLED, inWindow, NOT_DRAFT, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { rows } from "./guard";
import type { Window } from "./periods";
import { OTHER_KEY } from "./portal-constants";

/** One chart series: a point per bucket (zero-filled) and the comparison period's points aligned by position (null without a comparison). */
export interface Series<K extends string> { fields: K[]; points: Array<Point<K>>; prev: Array<Point<K>> | null }

/** Runs `query(window)` for the current (and comparison) period and zero-fills the buckets. The query must select `t` (bucket key) and the `fields`. */
export async function buildSeries<K extends string>(f: ResolvedFilters, fields: readonly K[], query: (w: Window) => SQL): Promise<Series<K>> {
  const read = async (w: Window, keys: string[]) => zeroFill(keys, await rows<{ t: string } & Partial<Record<K, unknown>>>(query(w)), fields);
  const [points, prev] = await Promise.all([read(f.cur, f.keys), f.prev && f.prevKeys ? read(f.prev, f.prevKeys) : null]);
  return { fields: [...fields], points, prev };
}

export const SERVICE_FIELDS = ["delivery_driver", "car_with_driver", "car_without_driver"] as const;

/** Company: what was charged per bucket (customer price of non-rejected settlements) in total and by service, plus the orders and parcel units behind it. */
export const spendSeries = (f: ResolvedFilters) => buildSeries(f, ["spend", "orders", "parcel_spend", "parcel_units", ...SERVICE_FIELDS], (w) => sql`
  select ${bucketSql(settlements.createdAt, f.bucket)} as t, coalesce(sum(settlements.customer_cents), 0)::float8 as spend, count(distinct settlements.request_id)::int as orders,
    coalesce(sum(settlements.customer_cents) filter (where requests.service = 'delivery_driver'), 0)::float8 as parcel_spend,
    coalesce(sum(settlements.final_units) filter (where requests.service = 'delivery_driver'), 0)::float8 as parcel_units,
    coalesce(sum(settlements.customer_cents) filter (where requests.service = 'delivery_driver'), 0)::float8 as delivery_driver,
    coalesce(sum(settlements.customer_cents) filter (where requests.service = 'car_with_driver'), 0)::float8 as car_with_driver,
    coalesce(sum(settlements.customer_cents) filter (where requests.service = 'car_without_driver'), 0)::float8 as car_without_driver
  from settlements join requests on requests.id = settlements.request_id
  where ${scope(f, "settlements")} and ${BILLED} and ${inWindow(settlements.createdAt, w)} group by 1`);

/** Company: cash on delivery per bucket — collected from recipients (on the day it was collected) and handed back to the warehouse. */
export const codSeries = (f: ResolvedFilters) => buildSeries(f, ["collected", "received"], (w) => sql`
  select t, coalesce(sum(collected), 0)::float8 as collected, coalesce(sum(received), 0)::float8 as received from (
    select ${bucketSql(shipments.codCollectedAt, f.bucket)} as t, shipments.cod_collected_cents as collected, 0 as received
      from shipments join requests on requests.id = shipments.request_id
      where ${scope(f, "shipments")} and shipments.status = 'delivered' and shipments.cod_collected_cents is not null and ${inWindow(shipments.codCollectedAt, w)}
    union all
    select ${bucketSql(codRemittances.createdAt, f.bucket)}, 0, cod_remittances.amount_cents
      from cod_remittances join requests on requests.id = cod_remittances.request_id
      where ${scope(f, "requests")} and ${inWindow(codRemittances.createdAt, w)}
  ) x group by t`);

/** Company wallet: top-ups, job charges and refunds per bucket (the owner's own account only). */
export const walletSeries = (f: ResolvedFilters, me: string) => buildSeries(f, ["topup", "charge", "refund"], (w) => sql`
  select ${bucketSql(ledgerEntries.createdAt, f.bucket)} as t,
    coalesce(sum(ledger_entries.available_delta_cents) filter (where ledger_entries.kind = 'topup'), 0)::float8 as topup,
    coalesce(-sum(ledger_entries.available_delta_cents) filter (where ledger_entries.kind = 'charge'), 0)::float8 as charge,
    coalesce(sum(ledger_entries.available_delta_cents) filter (where ledger_entries.kind = 'refund'), 0)::float8 as refund
  from ledger_entries join wallet_accounts on wallet_accounts.id = ledger_entries.account_id
  where wallet_accounts.owner_id = ${me} and ${inWindow(ledgerEntries.createdAt, w)} group by 1`);

export interface PivotSeries { field: string; key: string }
export interface Pivot { series: PivotSeries[]; points: Array<{ t: string } & Record<string, number | string>> }
/**
 * Turns `(bucket, key, amount)` rows into a stacked chart: the `n` keys with the largest total become series `s0 … s(n-1)` (ties by name), everything else is summed into one
 * "other" series, and every bucket of the period has a point (0 where nothing was charged). PURE: unit-tested.
 */
export function pivotRows(rowsIn: Array<{ t: string; k: string | null; spend: number }>, keys: string[], n = 6): Pivot {
  const total = new Map<string, number>();
  for (const r of rowsIn) total.set(r.k ?? "", (total.get(r.k ?? "") ?? 0) + Number(r.spend));
  const ranked = [...total.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked.slice(0, n).map(([k]) => k), hasOther = ranked.length > n;
  const series: PivotSeries[] = [...top.map((key, i) => ({ field: `s${i}`, key })), ...(hasOther ? [{ field: "other", key: OTHER_KEY }] : [])];
  const field = new Map(series.map((x) => [x.key, x.field]));
  const byT = new Map<string, Record<string, number>>();
  for (const r of rowsIn) {
    const f = field.get(r.k ?? "") ?? (hasOther ? "other" : null);
    if (!f || !(Number(r.spend) > 0)) continue;
    const cell = byT.get(r.t) ?? {}; cell[f] = (cell[f] ?? 0) + Number(r.spend); byT.set(r.t, cell);
  }
  return { series, points: keys.map((t) => ({ t, ...Object.fromEntries(series.map((x) => [x.field, byT.get(t)?.[x.field] ?? 0])) })) };
}
/** Company: what was charged per bucket split by vehicle type or by delivery city (top 6 + other), for the current period. */
export async function spendPivot(f: ResolvedFilters, dim: "vehicle" | "city"): Promise<Pivot> {
  const k = dim === "vehicle" ? sql`coalesce(requests.vehicle_type, '')` : sql`requests.delivery_city`;
  const r = await rows<{ t: string; k: string; spend: number }>(sql`
    select ${bucketSql(settlements.createdAt, f.bucket)} as t, ${k} as k, coalesce(sum(settlements.customer_cents), 0)::float8 as spend
    from settlements join requests on requests.id = settlements.request_id
    where ${scope(f, "settlements")} and ${BILLED} and ${inWindow(settlements.createdAt, f.cur)} group by 1, 2`);
  return pivotRows(r, f.keys);
}

export const JOB_FIELDS = ["completed", "active", "cancelled", "no_show", "replaced"] as const;
/** Office: jobs taken (offers accepted) per bucket, stacked by where they stand. Only the office's own offers. */
export const jobsSeries = (f: ResolvedFilters) => buildSeries(f, [...JOB_FIELDS], (w) => sql`
  select ${bucketSql(offers.acceptedAt, f.bucket)} as t,
    count(*) filter (where offers.status = 'completed')::int as completed,
    count(*) filter (where offers.status in ('accepted','arrived','attendance_confirmed','delivered_reported','qty_disputed','pending_settlement'))::int as active,
    count(*) filter (where offers.status = 'cancelled')::int as cancelled,
    count(*) filter (where offers.status = 'no_show')::int as no_show,
    count(*) filter (where offers.status = 'replaced')::int as replaced
  from offers join requests on requests.id = offers.request_id
  where ${scope(f, "offers")} and ${NOT_DRAFT} and offers.accepted_at is not null and ${inWindow(offers.acceptedAt, w)} group by 1`);

/** Office: what was earned (settlements created, not rejected) and what was paid out to it (settlements paid), per bucket. */
export const earningsSeries = (f: ResolvedFilters) => buildSeries(f, ["earned", "paid"], (w) => sql`
  select t, coalesce(sum(earned), 0)::float8 as earned, coalesce(sum(paid), 0)::float8 as paid from (
    select ${bucketSql(settlements.createdAt, f.bucket)} as t, settlements.provider_cents as earned, 0 as paid
      from settlements join requests on requests.id = settlements.request_id where ${scope(f, "settlements")} and ${BILLED} and ${inWindow(settlements.createdAt, w)}
    union all
    select ${bucketSql(settlements.paidAt, f.bucket)}, 0, settlements.provider_cents
      from settlements join requests on requests.id = settlements.request_id where ${scope(f, "settlements")} and settlements.status = 'paid' and ${inWindow(settlements.paidAt, w)}
  ) x group by t`);

/** Office: bank payouts requested (by request time) and paid out (by decision time) per bucket. */
export const withdrawalSeries = (f: ResolvedFilters, me: string) => buildSeries(f, ["asked", "paid"], (w) => sql`
  select t, coalesce(sum(asked), 0)::float8 as asked, coalesce(sum(paid), 0)::float8 as paid from (
    select ${bucketSql(withdrawals.createdAt, f.bucket)} as t, withdrawals.amount_cents as asked, 0 as paid from withdrawals where withdrawals.user_id = ${me} and ${inWindow(withdrawals.createdAt, w)}
    union all
    select ${bucketSql(withdrawals.decidedAt, f.bucket)}, 0, withdrawals.amount_cents from withdrawals where withdrawals.user_id = ${me} and withdrawals.status = 'paid' and ${inWindow(withdrawals.decidedAt, w)}
  ) x group by t`);

/** Office: when drivers go online (availability log, weekday × hour) or arrive at a job — a 7 × 24 grid like the delivery heatmap. */
export function grid(rowsIn: Array<Record<string, unknown>>): { cells: number[][]; total: number; max: number } {
  const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const x of rowsIn) { const d = Number(x.dow), h = Number(x.hr), n = Number(x.n); if (d >= 0 && d < 7 && h >= 0 && h < 24 && Number.isFinite(n)) cells[d][h] = n; }
  const flat = cells.flat();
  return { cells, total: flat.reduce((s, n) => s + n, 0), max: Math.max(0, ...flat) };
}
