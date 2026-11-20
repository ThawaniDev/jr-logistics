import type { User } from "@/db/schema";
import { officeReport } from "../office";
import { getSettings } from "../settings";
import type { ResolvedFilters } from "./filters";
import { heatmap } from "./overview-groups";
import { parcelsSeries } from "./overview-series";
import "./portal-definitions";
import { driverScores } from "./portal-office-drivers";
import { earningFacts, fleetNow, jobFacts, jobsByStatus, offerFunnel, officeBreakdowns, pendingPay, pipeline, ratingFacts } from "./portal-office-facts";
import { parcelFacts, z } from "./portal-facts";
import { officeInsights } from "./portal-insights";
import { add, col, kpisFrom, perBucket, ratio, stock } from "./portal-kpis";
import { fleetTotals } from "./portal-calc";
import { portalCtx, runPortalReport } from "./portal-scope";
import { earningsSeries, jobsSeries } from "./portal-series";
import "./portal-tables-office";
import "./portal-fleet-tables";

type Spark = Record<string, Array<number | null>>;
export interface OfficeFacts {
  jobs: Awaited<ReturnType<typeof jobFacts>> | null; parcels: Awaited<ReturnType<typeof parcelFacts>> | null; rating: Awaited<ReturnType<typeof ratingFacts>> | null;
  earn: Awaited<ReturnType<typeof earningFacts>> | null; pending: { cents: number } | null; fleet: { total: number } | null;
}

/** The completed / (completed + no-show + driver-cancelled + replaced) split of a finished job. */
export const finished = (j: NonNullable<OfficeFacts["jobs"]>) => add(j.completed, j.no_show, j.cancelled, j.replaced);

/** KPI cards of the office Overview (pure: unit-tested). A fact whose query failed is `null` and its cards are left out. */
export function officeOverviewKpis(x: OfficeFacts, f: ResolvedFilters, spark: Spark = {}) {
  const { jobs, parcels: pc, rating, earn, pending, fleet } = x;
  return kpisFrom(f, [
    fleet && ["off_drivers", stock(fleet.total), { href: "/office/drivers" }],
    jobs && ["active_drivers", jobs.drivers, { href: "/office/reports/drivers" }],
    jobs && ["off_jobs", jobs.jobs, { href: "/office/jobs" }],
    jobs && ["off_completion_rate", ratio(jobs.completed, finished(jobs))],
    pc && ["parcels_delivered", z(pc.delivered)],
    pc && ["delivery_success", ratio(pc.delivered, add(pc.delivered, pc.failed, pc.returned))],
    jobs && ["on_time_start", ratio(jobs.on_time, jobs.due)],
    jobs && fleet && ["off_utilisation", ratio(jobs.fleet_active, { cur: fleet.total, prev: f.prev ? fleet.total : null })],
    rating && ["off_rating", ratio(rating.sum, rating.n)],
    earn && ["off_earnings", earn.earned, { href: "/office/reports/earnings" }],
    earn && ["off_paid", earn.paid, { href: "/office/settlements?status=paid" }],
    pending && ["off_pending", stock(pending.cents), { href: "/office/settlements" }],
  ], spark);
}

/** `GET /office/analytics/overview` — the whole office Overview for the signed-in office (cached 30 s per office + filters; a failed section degrades alone). */
export async function officeOverviewReport(user: User, query: URLSearchParams) {
  const c = await portalCtx(user, query, "office");
  const { f, me } = c;
  return runPortalReport(c, "off-overview", async (p) => {
    const grace = (await getSettings()).lateGraceMin;
    const [jobs, parcels, rating, earn, pend, fleet, jobsS, parcelS, earnS, funnel, groups, heat, byStatus, pipe, scores, lifetime] = await Promise.all([
      p.part("jobs", () => jobFacts(f, me, grace)), p.part("parcels", () => parcelFacts(f)), p.part("rating", () => ratingFacts(f)), p.part("earnings", () => earningFacts(f)),
      p.part("pending", () => pendingPay(f)), p.part("fleet", () => fleetNow(me)), p.part("series_jobs", () => jobsSeries(f)), p.part("series_parcels", () => parcelsSeries(f)),
      p.part("series_earnings", () => earningsSeries(f)), p.part("funnel", () => offerFunnel(f)), p.part("breakdowns", () => officeBreakdowns(f, me)), p.part("heatmap", () => heatmap(f)),
      p.part("by_status", () => jobsByStatus(f)), p.part("money", () => pipeline(f)), p.part("scores", () => driverScores(f, me, grace)), p.part("lifetime", () => officeReport(me)),
    ]);
    const outcomes = parcelS ? parcelS.points.map((x) => x.delivered + x.failed + x.returned) : [];
    const finishedBy = jobsS ? jobsS.points.map((x) => x.completed + x.no_show + x.cancelled + x.replaced) : [];
    const spark: Spark = {
      off_jobs: jobsS ? jobsS.points.map((x) => x.completed + x.active + x.cancelled + x.no_show + x.replaced) : [], off_completion_rate: perBucket(col(jobsS, "completed"), finishedBy),
      parcels_delivered: col(parcelS, "delivered"), delivery_success: perBucket(col(parcelS, "delivered"), outcomes), off_earnings: col(earnS, "earned"), off_paid: col(earnS, "paid"),
    };
    const kpis = officeOverviewKpis({ jobs, parcels, rating, earn, pending: pend, fleet }, f, spark);
    const empty = !!(jobs && parcels && earn && fleet) && !(jobs.jobs.cur || parcels.delivered.cur || parcels.failed.cur || parcels.returned.cur || earn.earned.cur || earn.paid.cur || (pend?.cents ?? 0) || fleet.total);
    const body = {
      kpis, series: { jobs: jobsS, parcels: parcelS, earnings: earnS }, funnel, breakdowns: groups, heatmap: heat, byStatus, money: pipe?.byStatus ?? null, lifetime,
      fleet: scores && { ...fleetTotals(scores) },
      insights: officeInsights({ kpis, drivers: scores ?? [], pendingCents: pend?.cents ?? 0 }),
    };
    return { body, empty };
  });
}
