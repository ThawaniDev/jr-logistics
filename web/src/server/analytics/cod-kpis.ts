import type { ResolvedFilters } from "./filters";
import { makeKpis, pairOf, ratio, z, type Pair } from "./finance-core";
import type { Kpi } from "./kpi";
import { visibleKpis } from "./kpi";
import "./cod-defs";
import type { CodParcelFacts, CodRemitFacts } from "./cod-facts";

export interface CodFacts { parcels: CodParcelFacts; remit: CodRemitFacts; outstanding: Pair; aged: { orders: number; cents: number }; holders: number }

/** The KPI objects of the COD report from the raw facts (pure: unit-tested). Without `finance.view` every amount is dropped (not zeroed); counts of parcels and orders stay. */
export function codKpis(x: CodFacts, f: ResolvedFilters, money: boolean, spark: Record<string, Array<number | null> | undefined> = {}): Kpi[] {
  const { parcels: p, remit: r } = x;
  const live = (n: number): Pair => pairOf(n, null);
  const kpis = makeKpis(f, [
    ["cod_collected", z(p.collected)], ["cod_remitted", z(r.remitted)], ["cod_outstanding", x.outstanding], ["cod_remit_rate", ratio(r.remitted, p.collected)],
    ["cod_avg_value", ratio(p.value_created, p.created)], ["cod_collection_rate", ratio(p.got, p.due)], ["cod_uncollected", z(p.failed_value)], ["cod_aged_value", live(x.aged.cents)],
    ["cod_parcels", z(p.delivered)], ["cod_share", ratio(p.created, p.all_created)], ["cod_failed", z(p.failed)], ["cod_mismatch", z(p.mismatch)],
    ["cod_aged_orders", live(x.aged.orders)], ["cod_holders", live(x.holders)], ["cod_lag_p50", r.lag_p50], ["cod_lag_p90", r.lag_p90],
  ], spark);
  return visibleKpis(kpis, money);
}
