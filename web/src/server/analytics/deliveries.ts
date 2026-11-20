import type { User } from "@/db/schema";
import { requirePerm } from "../auth/permissions";
import { filtersMeta, parseFilters, type ResolvedFilters } from "./filters";
import { cached, permClass } from "./guard";
import { heatmap } from "./overview-groups";
import { parcelsSeries } from "./overview-series";
import { emptyPairs, emptySeries, perBucket, sectionGuard } from "./finance-core";
import { attemptsHistogram, eventFacts, flowFacts, jobFacts, timingFacts } from "./deliveries-facts";
import { busiest, deliveryInsights, worstOf } from "./deliveries-insights";
import { DIMS, failureReasons, groups as groupsOf } from "./deliveries-groups";
import { DELIVERY_KPI_GROUPS } from "./deliveries-defs";
import { deliveryKpis } from "./deliveries-kpis";
import { failHeatmap, FLOW_FIELDS, flowSeries, funnel, speedSeries } from "./deliveries-series";
import { MIN_VOLUME } from "./finance-core";
import "./deliveries-tables";

const noHeat = () => ({ cells: Array.from({ length: 7 }, () => Array<number>(24).fill(0)), total: 0, max: 0 });
const noReasons = { all: [], top: [], byCity: [], byCompany: [] } as Awaited<ReturnType<typeof failureReasons>>;

async function compute(f: ResolvedFilters) {
  const { safe, failed } = sectionGuard();
  const none = { cur: null, prev: null };
  const [flow, timing, jobs, events, attempts, outcomes, flows, speed, steps, heat, failHeat, grp, reasons] = await Promise.all([
    safe("flow", flowFacts(f), emptyPairs()), safe("timing", timingFacts(f), emptyPairs({ time: { hist: [], n: 0 }, distance: { hist: [], n: 0 } })), safe("jobs", jobFacts(f), emptyPairs() as Awaited<ReturnType<typeof jobFacts>>),
    safe("events", eventFacts(f), { otpBad: none, otpOk: none, deferEvidence: { both: 0, note: 0, photo: 0, none: 0 } }), safe("attempts", attemptsHistogram(f), { hist: [], n: 0 }),
    safe("outcomes", parcelsSeries(f), emptySeries(f, ["delivered", "failed", "returned"] as const)), safe("series", flowSeries(f), emptySeries(f, FLOW_FIELDS)),
    safe("speed", speedSeries(f), emptySeries(f, ["p50", "p90"] as const, true)), safe("funnel", funnel(f), (["created", "handed", "delivered"] as const).map((key) => ({ key, count: 0 }))),
    safe("heatmap", heatmap(f), noHeat()), safe("failures", failHeatmap(f), noHeat()), safe("groups", groupsOf(f), []), safe("reasons", failureReasons(f), noReasons),
  ]);
  const col = <K extends string>(s: { points: Array<Record<K, number | null>> }, k: K) => s.points.map((p) => p[k]);
  const num = <K extends string>(s: { points: Array<Record<K, number | null>> }, k: K) => s.points.map((p) => p[k] ?? 0);
  const resolved = outcomes.points.map((p) => p.delivered + p.failed + p.returned);
  const spark: Record<string, Array<number | null>> = {
    dlv_created: col(flows, "created"), dlv_handed: col(flows, "handed"), parcels_delivered: col(outcomes, "delivered"), dlv_failed: col(outcomes, "failed"), dlv_returned: col(outcomes, "returned"),
    delivery_success: perBucket(num(outcomes, "delivered"), resolved), dlv_time_p50: col(speed, "p50"), dlv_time_p90: col(speed, "p90"),
  };
  const kpis = deliveryKpis({ flow, timing, jobs, otpBad: events.otpBad, otpOk: events.otpOk }, f, spark);
  const c = (k: keyof typeof flow) => flow[k].cur ?? 0;
  const empty = failed.length === 0 && !(c("created") || c("handed") || c("delivered") || c("failed") || c("returned") || c("missing"));
  const failedOutcome = c("deferred") - c("def_del");
  return {
    meta: { ...filtersMeta(f), empty, moneyHidden: false, failed },
    kpis, kpiGroups: DELIVERY_KPI_GROUPS,
    series: { outcomes, flow: flows, speed }, funnel: steps,
    reasons: { all: reasons.all, top: reasons.top, byCity: reasons.byCity, byCompany: reasons.byCompany },
    defer: { evidence: events.deferEvidence, delivered: c("def_del"), failed: Math.max(0, failedOutcome) },
    attempts, time: timing.time, distance: { ...timing.distance, p50: timing.dist_p50.cur, p90: timing.dist_p90.cur, far: timing.far.cur ?? 0 },
    timePercentiles: { p50: timing.time_p50.cur, p90: timing.time_p90.cur },
    proof: { otp: c("otp"), scan: c("scan"), receipt: c("receipt"), signed: c("signed"), delivered: c("delivered") },
    heatmap: { delivered: heat, failures: failHeat },
    breakdowns: Object.fromEntries(DIMS.map((d) => [d, busiest(grp, d)])) as Record<(typeof DIMS)[number], ReturnType<typeof busiest>>,
    worst: worstOf(grp), minVolume: MIN_VOLUME,
    insights: deliveryInsights({ kpis, reasons: reasons.all, groups: grp, failHeat, samples: { distance: timing.dist_n.cur ?? 0, otp: (events.otpBad.cur ?? 0) + (events.otpOk.cur ?? 0) } }),
  };
}

/** `GET /admin/analytics/deliveries`: the parcel-level report for one filter set (cached 30 s per permission class). No money in it, so `reports.view` is enough. */
export async function deliveriesReport(user: User, query: URLSearchParams) {
  requirePerm(user, "reports.view");
  const f = parseFilters(query);
  const res = await cached(`deliveries|${permClass(user)}|${f.canonical}`, () => compute(f));
  return { ...res.value, meta: { ...res.value.meta, generatedAt: new Date(res.at).toISOString(), cached: res.cached } };
}
export type DeliveriesData = Awaited<ReturnType<typeof deliveriesReport>>;
