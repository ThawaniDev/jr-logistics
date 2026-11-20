import { sql } from "drizzle-orm";
import { shipments } from "@/db/schema";
import { inWindow, scope } from "./conditions";
import { bucketOf, buildSeries, type Series } from "./finance-core";
import type { ResolvedFilters } from "./filters";
import { PARCEL_FROM, REMIT_FROM, remitScope } from "./cod-facts";

export const CASH_FIELDS = ["collected", "remitted"] as const;
/** Cash collected (on the day it was collected) and cash received back from drivers (on the day it was recorded), per bucket. */
export const cashSeries = (f: ResolvedFilters) => buildSeries(f, [...CASH_FIELDS], (w) => sql`
  select t, sum(collected)::float8 as collected, sum(remitted)::float8 as remitted from (
    select ${bucketOf(shipments.codCollectedAt, f)} as t, coalesce(sum(shipments.cod_collected_cents), 0) as collected, 0 as remitted ${PARCEL_FROM}
      where ${scope(f, "shipments")} and shipments.status = 'delivered' and shipments.cod_collected_cents is not null and ${inWindow(shipments.codCollectedAt, w)} group by 1
    union all
    select ${bucketOf("cod_remittances.created_at", f)} as t, 0, coalesce(sum(cod_remittances.amount_cents), 0) ${REMIT_FROM} where ${remitScope(f)} and ${inWindow("cod_remittances.created_at", w)} group by 1) x group by t`);

export const MIX_FIELDS = ["cod", "prepaid"] as const;
/** Parcels delivered per bucket: with cash on delivery and prepaid. */
export const mixSeries = (f: ResolvedFilters) => buildSeries(f, [...MIX_FIELDS], (w) => sql`
  select ${bucketOf(shipments.deliveredAt, f)} as t, count(*) filter (where shipments.cod_cents > 0)::int as cod, count(*) filter (where shipments.cod_cents = 0)::int as prepaid
  ${PARCEL_FROM} where ${scope(f, "shipments")} and shipments.status = 'delivered' and ${inWindow(shipments.deliveredAt, w)} group by 1`);

export type CashPoint = { t: string; collected: number; remitted: number; outstanding: number };
/** The running balance (collected − received) at the end of every bucket, starting from the balance at the start of the period (pure: unit-tested). */
export function withBalance(points: Array<{ t: string; collected: number; remitted: number }>, start: number): CashPoint[] {
  let bal = start;
  return points.map((p) => { bal += p.collected - p.remitted; return { ...p, outstanding: bal }; });
}
export const cashWithBalance = (s: Series<"collected" | "remitted">, start: number, prevStart: number | null) => ({
  points: withBalance(s.points, start), prev: s.prev && prevStart != null ? withBalance(s.prev, prevStart) : null,
});
