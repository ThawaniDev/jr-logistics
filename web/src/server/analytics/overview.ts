import type { User } from "@/db/schema";
import { can, requirePerm } from "../auth/permissions";
import { filtersMeta, parseFilters, type ResolvedFilters } from "./filters";
import { cached, permClass } from "./guard";
import { buildInsights } from "./insights";
import { safeDiv } from "./kpi";
import { breakdowns, companyRanking, driverRanking, heatmap, moversOf } from "./overview-groups";
import { overviewFacts, overviewKpis } from "./overview-kpis";
import { moneySeries, parcelsSeries, requestsSeries } from "./overview-series";
import "./overview-tables";

/** Per-bucket ratio for a sparkline: null where the denominator is 0 (a gap, not a 0%). */
const perBucket = (n: number[], d: number[]) => n.map((v, i) => safeDiv(v, d[i]));

async function compute(f: ResolvedFilters, money: boolean) {
  const [facts, requests, parcels, cash, groups, heat, companies, drivers] = await Promise.all([
    overviewFacts(f, money), requestsSeries(f), parcelsSeries(f), money ? moneySeries(f) : null, breakdowns(f, money), heatmap(f), companyRanking(f, money), driverRanking(f),
  ]);
  const col = <K extends string>(s: { points: Array<Record<K, number>> }, k: K) => s.points.map((p) => p[k]);
  const outcomes = parcels.points.map((p) => p.delivered + p.failed + p.returned);
  const spark: Record<string, Array<number | null>> = {
    requests_created: col(requests, "total"), parcels_delivered: col(parcels, "delivered"),
    delivery_success: perBucket(col(parcels, "delivered"), outcomes), cancellation_rate: perBucket(col(requests, "cancelled"), col(requests, "total")),
    ...(cash ? { gmv: col(cash, "gmv"), revenue: col(cash, "revenue"), margin_pct: perBucket(col(cash, "revenue"), col(cash, "gmv")) } : {}),
  };
  const kpis = overviewKpis(facts, f, spark);
  const c = facts.req, pc = facts.parcels;
  const empty = !(c.created.cur || c.completed.cur || pc.delivered.cur || pc.failed.cur || pc.returned.cur || facts.cash?.gmv.cur || facts.signups.business.cur || facts.signups.driver.cur || facts.signups.office.cur);
  return {
    meta: { ...filtersMeta(f), empty, moneyHidden: !money },
    kpis, series: { requests, parcels, money: cash },
    funnel: facts.req.funnel,
    breakdowns: groups, heatmap: heat, fill: { ...facts.fill, avg: facts.fill.avg.cur },
    rankings: { companies: { by: companies.by, rows: [...companies.rows].sort((a, b) => b.value - a.value).slice(0, 10) }, drivers },
    movers: moversOf(f, companies, groups.city, money),
    insights: buildInsights({ kpis, companies, cities: groups.city, heat, fill: facts.fill }),
  };
}

/** `GET /admin/analytics/overview`: the whole Overview report for one filter set (cached 30 s per permission class). Money KPIs, series and rankings need `finance.view`. */
export async function overviewReport(user: User, query: URLSearchParams) {
  requirePerm(user, "reports.view");
  const f = parseFilters(query);
  const money = can(user, "finance.view");
  const res = await cached(`overview|${permClass(user)}|${f.canonical}`, () => compute(f, money));
  return { ...res.value, meta: { ...res.value.meta, generatedAt: new Date(res.at).toISOString(), cached: res.cached } };
}
