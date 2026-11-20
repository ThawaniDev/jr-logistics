import type { User } from "@/db/schema";
import { can, requirePerm } from "../auth/permissions";
import { filtersMeta, parseFilters, type ResolvedFilters } from "./filters";
import { cached, permClass } from "./guard";
import { movers } from "./stats";
import { ACTIVITY_FIELDS, activitySeries, channels, cohortTable, companySummary, moverRows, orderGap, segments, topCompanies, walletFacts } from "./companies-facts";
import { companyKpis } from "./companies-kpis";
import { col, companyInsights, emptySeries, HEALTH, NO_PAIR, pareto, RISK, safely, SEGMENTS, SEGMENT_EDGES } from "./companies-lib";
import "./companies-tables";

async function compute(f: ResolvedFilters, money: boolean) {
  const partial: string[] = [];
  const sec = <T>(title: string, run: () => Promise<T>, fallback: T) => safely(partial, title, run, fallback);
  const [summary, gap, cohorts, wallet, activity, topParcels, topGmv, segs, chan, mv] = await Promise.all([
    companySummary(f, money), // the KPIs cannot do without it: if it fails the whole report fails (and says why)
    sec("rpp.kpi_cmp_order_gap", () => orderGap(f), NO_PAIR), sec("rpp.cmp_cohorts", () => cohortTable(f), { rows: [], maxK: 0 }), money ? sec("rpp.cmp_wallets", () => walletFacts(f), null) : null,
    sec("rpp.cmp_activity", () => activitySeries(f), emptySeries(f, ACTIVITY_FIELDS)), sec("rpp.cmp_pareto_parcels", () => topCompanies(f, "reg", money), []),
    money ? sec("rpp.cmp_pareto_gmv", () => topCompanies(f, "gmv", money), []) : null, sec("rpp.cmp_segments", () => segments(f, money), []), sec("rpp.cmp_channels", () => channels(f), []), sec("rpp.cmp_movers", () => moverRows(f, money), null),
  ]);
  const kpis = companyKpis(summary, gap, wallet?.utilisation ?? null, f, money, { active_companies: col(activity, "active"), cmp_new: col(activity, "firsts") });
  const parcelsTotal = summary.totals.reg.cur ?? 0, gmvTotal = summary.totals.gmv.cur ?? 0;
  const conc = (r: typeof topParcels, total: number) => ({ total, rows: pareto(r, total), top10Share: total > 0 ? r.slice(0, 10).reduce((s, x) => s + x.value, 0) / total : null });
  const concentration = { parcels: conc(topParcels, parcelsTotal), gmv: topGmv ? conc(topGmv, gmvTotal) : null };
  const lead = concentration.gmv?.rows[0] ?? concentration.parcels.rows[0];
  const activeCount = summary.active.cur ?? 0;
  const empty = activeCount === 0 && (summary.newCompanies.cur ?? 0) === 0 && (summary.churn[90]?.cur ?? 0) === 0 && col(activity, "signups").every((n) => n === 0);
  return {
    meta: { ...filtersMeta(f), empty, moneyHidden: !money },
    kpis, partial, series: activity, concentration, cohorts, channels: chan,
    segments: SEGMENTS.map((key) => segs.find((s) => s.key === key) ?? { key, companies: 0, parcels: 0, requests: 0, gmv: money ? 0 : null }),
    health: { ...summary.health, weights: { recency: HEALTH.recency, frequency: HEALTH.frequency, success: HEALTH.success, cancel: HEALTH.cancel, support: HEALTH.support }, silentDays: HEALTH.silentDays, ordersPer30d: HEALTH.ordersPer30d },
    thresholds: { atRiskFrom: RISK.atRiskFrom, minOrders: RISK.minOrders, churnDays: [...RISK.churnDays], segments: SEGMENT_EDGES, healthy: HEALTH.healthy, watch: HEALTH.watch },
    wallets: wallet,
    movers: mv ? { by: mv.by, ...movers(mv.rows, 5) } : null,
    insights: companyInsights({
      active: summary.active, churned: summary.churn[60] ?? { cur: null, prev: null }, atRisk: summary.atRisk, newCompanies: summary.newCompanies, returning: summary.returning, repeat: summary.repeat,
      apiShare: { cur: summary.totals.req.cur ? (summary.totals.api.cur ?? 0) / summary.totals.req.cur : null, prev: null }, creditUtil: wallet?.utilisation ?? null, verified: activeCount ? summary.verified / activeCount : null,
      activeCount, top: lead && lead.share != null ? { id: lead.id, name: lead.name, share: lead.share } : null, top10Share: (concentration.gmv ?? concentration.parcels).top10Share,
      lowHealth: summary.health.low, liveCount: summary.health.live, unverified: Math.max(0, activeCount - summary.verified),
    }),
  };
}

/** `GET /admin/analytics/companies`: the whole Companies report for one filter set (cached 30 s per permission class). Money (GMV, AOV, credit, wallet, concentration by GMV) needs `finance.view`. */
export async function companiesReport(user: User, query: URLSearchParams) {
  requirePerm(user, "reports.view");
  const f = parseFilters(query);
  const money = can(user, "finance.view");
  const res = await cached(`companies|${permClass(user)}|${f.canonical}`, () => compute(f, money));
  return { ...res.value, meta: { ...res.value.meta, generatedAt: new Date(res.at).toISOString(), cached: res.cached } };
}
export type CompaniesReport = Awaited<ReturnType<typeof companiesReport>>;
