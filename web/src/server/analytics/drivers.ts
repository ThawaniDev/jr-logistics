import type { User } from "@/db/schema";
import { can, requirePerm } from "../auth/permissions";
import { getSettings } from "../settings";
import { filtersMeta, parseFilters, type ResolvedFilters } from "./filters";
import { cached, permClass } from "./guard";
import { col, emptySeries, NO_PAIR, perBucket, ratioSeries, safely } from "./companies-lib";
import { availabilityHeat, cashHeld, churnFacts, driverSummary, FUNNEL, fleetMix, leaders, QUALITY_FIELDS, qualitySeries, ratingFacts, reliabilityMatrix, responseTimes, supplyFunnel, suspensionFacts, VOLUME_FIELDS, volumeSeries, type Heat } from "./drivers-facts";
import { driverKpis } from "./drivers-kpis";
import { ACCEPT_EDGES, bandMatrix, COMPLETE_EDGES, driverInsights, emptyHeat, FLAGS, HEAT_DAYS, MIN_RESOLVED } from "./drivers-lib";
import { safeDiv } from "./kpi";
import { fleetTotals } from "./fleet-facts";
import { fleetKpis } from "./fleet-kpis";
import "./drivers-tables";
import "./fleet-tables-drivers";

async function compute(f: ResolvedFilters, money: boolean) {
  const grace = (await getSettings()).lateGraceMin;
  const partial: string[] = [];
  const sec = <T>(title: string, run: () => Promise<T>, fallback: T) => safely(partial, title, run, fallback);
  const [summary, response, rating, suspensions, churn, cash, mix, lead, matrix, heat, funnel, volume, quality, fleetTot] = await Promise.all([
    driverSummary(f, money, grace), // the KPIs cannot do without it: if it fails the whole report fails (and says why)
    sec("rpp.kpi_flt_resp_p50", () => responseTimes(f), { p50: NO_PAIR, p90: NO_PAIR }), sec("rpp.drv_dist_rating", () => ratingFacts(f), { n: NO_PAIR, sum: NO_PAIR, stars: [0, 0, 0, 0, 0] }),
    sec("rpp.kpi_flt_suspensions", () => suspensionFacts(f), NO_PAIR), sec("rpp.kpi_flt_churned", () => churnFacts(f), { churned: null, wasActive: null }),
    money ? sec<number | null>("rpp.kpi_flt_cash", () => cashHeld(f), null) : null, sec("rpp.drv_mix_vehicle", () => fleetMix(f, money, grace), { vehicle: [], city: [] }),
    sec("rpp.drv_top", () => leaders(f, money, grace), { top: [], bottom: [], minVolume: MIN_RESOLVED }),
    sec("rpp.drv_reliability", () => reliabilityMatrix(f, money, grace), { cells: bandMatrix([], ACCEPT_EDGES.length + 1, COMPLETE_EDGES.length + 1), acceptEdges: ACCEPT_EDGES, completeEdges: COMPLETE_EDGES }),
    sec<Heat>("rpp.drv_heat", () => availabilityHeat(f), { source: "none", cells: emptyHeat(), days: 0 }),
    sec("rpp.drv_funnel", () => supplyFunnel(f), { steps: FUNNEL.map((key) => ({ key, count: 0 })), times: { docs: null, verify: null, job: null } }),
    sec("rpp.drv_volume", () => volumeSeries(f), emptySeries(f, VOLUME_FIELDS)), sec("rpp.drv_quality", () => qualitySeries(f), emptySeries(f, QUALITY_FIELDS)),
    sec("fr.sec_fleet", () => fleetTotals(f, money, grace, "drivers"), null), // the fleet KPIs (lateness, times, distance …); without them the report keeps its own cards
  ]);
  const q = (k: "answered" | "accepted" | "acc" | "bad" | "resolved" | "delivered") => col(quality, k);
  const spark = { active_drivers: col(volume, "active"), drv_success: perBucket(q("delivered"), q("resolved")), drv_acceptance: perBucket(q("accepted"), q("answered")), drv_cancel: perBucket(q("bad"), q("acc")) };
  const kpis = [...driverKpis({ summary, response, rating, suspensions, churn, cash }, f, money, spark), ...(fleetTot ? fleetKpis(fleetTot, f, money, "drivers") : [])];
  const kv = (key: string) => kpis.find((k) => k.key === key);
  const stars = rating.stars, nStars = stars.reduce((s, n) => s + n, 0);
  const peak = heat.cells.flatMap((row, d) => row.map((n, h) => ({ d, h, n }))).sort((a, b) => b.n - a.n)[0];
  const empty = (summary.active.cur ?? 0) === 0 && (summary.totals.online.cur ?? 0) === 0 && (summary.totals.answered.cur ?? 0) === 0 && funnel.steps[0].count === 0 && col(volume, "signups").every((n) => n === 0);
  return {
    meta: { ...filtersMeta(f), empty, moneyHidden: !money },
    kpis, partial,
    series: { volume, quality: ratioSeries(quality, { acceptance: ["accepted", "answered"], success: ["delivered", "resolved"], cancel: ["bad", "acc"] }) },
    distributions: { jobs: summary.jobsHist, success: summary.successHist, stars, ratings: nStars, ratingAvg: safeDiv(summary.totals.rsum.cur, summary.totals.rn.cur) },
    mix, leaders: lead, reliability: matrix, heatmap: { ...heat, peak: peak && peak.n > 0 ? { day: peak.d, hour: peak.h, n: peak.n } : null, windowDays: Math.min(HEAT_DAYS, f.cur.days) }, funnel,
    fleet: { total: summary.fleet, verified: summary.fleetVerified, suspended: summary.suspendedNow, available: summary.availableNow, churned: churn.churned, wasActive: churn.wasActive },
    thresholds: { ...FLAGS, minResolved: MIN_RESOLVED, acceptEdges: ACCEPT_EDGES, completeEdges: COMPLETE_EDGES },
    insights: driverInsights({
      active: summary.active, acceptance: kv("flt_acceptance") ? { cur: kv("flt_acceptance")!.value, prev: kv("flt_acceptance")!.prev } : { cur: null, prev: null }, success: { cur: kv("flt_success")?.value ?? null, prev: null },
      cancel: { cur: kv("flt_cancel")?.value ?? null, prev: null }, onTime: { cur: kv("on_time_start")?.value ?? null, prev: null }, utilisation: { cur: kv("flt_util")?.value ?? null, prev: null },
      churned: churn.churned, flagged: summary.flagged, activeCount: summary.active.cur ?? 0, availableNow: summary.availableNow,
      heatPeak: peak && peak.n > 0 ? { day: peak.d, hour: peak.h } : null,
      lowRatingShare: nStars >= 5 ? (stars[0] + stars[1]) / nStars : null, suspensions, cash,
    }),
  };
}

/** `GET /admin/analytics/drivers`: the whole Drivers report for one filter set (cached 30 s per permission class). Earnings and cash held need `finance.view`. */
export async function driversReport(user: User, query: URLSearchParams) {
  requirePerm(user, "reports.view");
  const f = parseFilters(query);
  const money = can(user, "finance.view");
  const res = await cached(`drivers|${permClass(user)}|${f.canonical}`, () => compute(f, money));
  return { ...res.value, meta: { ...res.value.meta, generatedAt: new Date(res.at).toISOString(), cached: res.cached } };
}
export type DriversReport = Awaited<ReturnType<typeof driversReport>>;
