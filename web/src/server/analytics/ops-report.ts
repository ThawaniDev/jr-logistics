import type { User } from "@/db/schema";
import { can, requirePerm } from "../auth/permissions";
import { getSettings } from "../settings";
import { filtersMeta, parseFilters, type ResolvedFilters } from "./filters";
import { cached, permClass } from "./guard";
import { visibleKpis } from "./kpi";
import { cancelBreakdown, cancelFacts, cancelPolicy, cancelRankings, cancelSeries } from "./ops-cancel";
import { demandFacts, speedFacts } from "./ops-demand";
import { execFacts, loadingFacts, pressureHeat, stopsFacts } from "./ops-exec";
import { companyOps, driverLateness, opsBreakdowns, rankingsOf } from "./ops-groups";
import { buildOpsInsights } from "./ops-insights";
import { opsKpis, type OpsFacts } from "./ops-kpis";
import { funnelOf, offerFacts, outcomesOf } from "./ops-offers";
import { demandSeries, execSeries, ratioPoints } from "./ops-series";
import { supplyByCity, supplyFacts, supplySeries } from "./ops-supply";
import { PartialReport, sectionRunner } from "./ops-util";
import "./ops-tables";

/** Companies shown in the "by company" table (the compute reads 200 for the rankings). */
const COMPANY_ROWS = 20;

async function compute(f: ResolvedFilters, money: boolean) {
  const grace = (await getSettings()).lateGraceMin;
  const run = sectionRunner("operations");
  const [demand, speed, offers, exec, stops, loading, supply, cancel, policy, dSeries, eSeries, cSeries, sSeries, sCity, heat, breakdowns, companies, drivers, cancelDetail, cancelRank] = await Promise.all([
    run.run("demand", () => demandFacts(f)), run.run("speed", () => speedFacts(f)), run.run("offers", () => offerFacts(f)), run.run("execution", () => execFacts(f, grace)),
    run.run("stops", () => stopsFacts(f)), run.run("loading", () => loadingFacts(f)), run.run("supply", () => supplyFacts(f)), run.run("cancel", () => cancelFacts(f)),
    run.run("policy", () => cancelPolicy(f, money)), run.run("demandSeries", () => demandSeries(f)), run.run("executionSeries", () => execSeries(f, grace)),
    run.run("cancelSeries", () => cancelSeries(f)), run.run("supplySeries", () => supplySeries(f)), run.run("supplyCities", () => supplyByCity(f)),
    run.run("pressure", () => pressureHeat(f, grace)), run.run("breakdowns", () => opsBreakdowns(f, grace)), run.run("companies", () => companyOps(f)),
    run.run("drivers", () => driverLateness(f, grace)), run.run("cancelDetail", () => cancelBreakdown(f)), run.run("cancelRankings", () => cancelRankings(f)),
  ]);

  const facts: OpsFacts = { demand, speed, offers, exec, stops, loading, supply, cancel, policy };
  const spark: Record<string, Array<number | null>> = {};
  if (dSeries) {
    const p = dSeries.points;
    spark.requests_created = p.map((x) => x.created); spark.ops_published = p.map((x) => x.published);
    spark.ops_fill_rate = ratioPoints(p, "filled", "slots"); spark.cancellation_rate = ratioPoints(p, "cancelled", "created");
  }
  if (eSeries) { spark.on_time_start = ratioPoints(eSeries.points, "on_time", "due"); spark.ops_no_show_rate = ratioPoints(eSeries.points, "no_show", "due"); }
  if (cSeries) spark.ops_cancelled_requests = cSeries.points.map((x) => x.business + x.driver + x.platform);
  if (sSeries) { const live = sSeries.points.map((x) => (x.n > 0 ? x : null)); spark.ops_drivers_available = live.map((x) => x?.available ?? null); spark.ops_utilisation = live.map((x) => (x && x.available + x.busy > 0 ? x.busy / (x.available + x.busy) : null)); }
  const kpis = visibleKpis(opsKpis(facts, f, spark, money), money);

  const cities = breakdowns?.city ?? [];
  const rankings = breakdowns || companies || drivers ? rankingsOf(cities, companies ?? [], drivers ?? []) : null;
  const known = [demand, offers, exec, cancel];
  const empty = known.every((x) => x !== null) && !(demand!.created.cur || demand!.completed.cur || offers!.offered.cur || exec!.due.cur || cancel!.requests.cur || cancel!.driverCancels.cur || cancel!.noShows.cur || cancel!.replaced.cur);
  const meta = { ...filtersMeta(f), empty, moneyHidden: !money, failed: run.failed, grace };
  const value = {
    meta, kpis,
    series: {
      demand: dSeries, execution: eSeries, cancellations: cSeries,
      supply: sSeries && { ...sSeries, points: sSeries.points.map((p) => ({ ...p, ...(p.n > 0 ? {} : { available: null, busy: null, open: null, unfilled: null }) })) },
    },
    speed, funnel: offers ? funnelOf(offers) : null, outcomes: offers ? outcomesOf(offers) : null, response: offers?.response ?? null,
    execution: exec && { delay: exec.delay, job: exec.job, loading: exec.loading, approval: exec.approval, distance: exec.distance, scan: loading, stops },
    supply: sCity && { cities: sCity, hours: supply?.hours ?? null },
    pressure: heat,
    cancellations: cancelDetail && cancel ? { ...cancelDetail, lead: cancel.lead, rankings: cancelRank, strikes: policy && { warnings: policy.warnings, suspensions: policy.suspensions }, refunds: money ? policy?.refunds ?? null : null } : null,
    groups: breakdowns || companies ? { breakdowns, companies: (companies ?? []).slice(0, COMPANY_ROWS), rankings } : null,
    insights: buildOpsInsights({
      kpis, cities, unfilledHeat: heat?.unfilled ?? null, companies: cancelRank?.companies ?? [], drivers: cancelRank?.drivers ?? [],
      samples: { due: exec?.due.cur ?? 0, cohort: demand?.cohort.cur ?? 0, cancelled: cancel?.requests.cur ?? 0 },
    }),
  };
  return run.done(value);
}
export type OperationsData = Awaited<ReturnType<typeof compute>> & { meta: { generatedAt?: string; cached?: boolean } };

/**
 * `GET /admin/analytics/operations`: the whole Operations report for one filter set (cached 30 s per permission class). Sections fail on their own: a section whose
 * queries failed is `null` and named in `meta.failed`, the rest of the page still renders; a partial result is not cached. Money (refunds released) needs `finance.view`.
 */
export async function operationsReport(user: User, query: URLSearchParams): Promise<OperationsData> {
  requirePerm(user, "reports.view");
  const f = parseFilters(query);
  const money = can(user, "finance.view");
  const stamp = (v: Awaited<ReturnType<typeof compute>>, at: number, hit: boolean) => ({ ...v, meta: { ...v.meta, generatedAt: new Date(at).toISOString(), cached: hit } });
  try {
    const res = await cached(`operations|${permClass(user)}|${f.canonical}`, () => compute(f, money));
    return stamp(res.value, res.at, res.cached);
  } catch (e) {
    if (e instanceof PartialReport) return stamp(e.value as Awaited<ReturnType<typeof compute>>, Date.now(), false);
    throw e;
  }
}
