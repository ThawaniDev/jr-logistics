import type { User } from "@/db/schema";
import { getSettings } from "../settings";
import type { ResolvedFilters } from "./filters";
import "./portal-definitions";
import { coachFlags, distributions, driverFlags, fleetTotals, performers, ratingOf, successRate, type DriverScore } from "./portal-calc";
import { parcelFacts } from "./portal-facts";
import { add, col, kpisFrom, perBucket, ratio, stock } from "./portal-kpis";
import { driverScores } from "./portal-office-drivers";
import { activityGrids, earningFacts, jobFacts, officeBreakdowns, pendingPay, pipeline, ratingFacts, withdrawalFacts, withdrawalsByStatus } from "./portal-office-facts";
import { portalCtx, runPortalReport } from "./portal-scope";
import { earningsSeries, jobsSeries, withdrawalSeries } from "./portal-series";
import "./portal-tables-office";
import { earningsInsights, officeInsights } from "./portal-insights";

type Spark = Record<string, Array<number | null>>;
type JobF = Awaited<ReturnType<typeof jobFacts>>;

/** KPI cards of the Drivers report (pure: unit-tested). `totals` come from the scorecards, the pairs from the twin-period facts. */
export function driversKpis(f: ResolvedFilters, x: { jobs: JobF | null; parcels: Awaited<ReturnType<typeof parcelFacts>> | null; rating: Awaited<ReturnType<typeof ratingFacts>> | null; coach: number | null }, spark: Spark = {}) {
  const { jobs, parcels: pc, rating } = x;
  return kpisFrom(f, [
    jobs && ["active_drivers", jobs.drivers],
    jobs && ["off_avg_jobs", ratio(jobs.jobs, jobs.drivers)],
    pc && ["delivery_success", ratio(pc.delivered, add(pc.delivered, pc.failed, pc.returned))],
    jobs && ["on_time_start", ratio(jobs.on_time, jobs.due)],
    jobs && ["off_acceptance_rate", ratio(jobs.taken, jobs.made)],
    jobs && ["off_no_show_rate", ratio(jobs.no_show, jobs.jobs)],
    jobs && ["off_cancel_rate", ratio(jobs.cancelled, jobs.jobs)],
    rating && ["off_rating", ratio(rating.sum, rating.n)],
    x.coach != null && ["off_coach", stock(x.coach)],
  ], spark);
}

const brief = (d: DriverScore) => ({ id: d.id, name: d.name, jobs: d.jobs, resolved: d.resolved, success: successRate(d), rating: ratingOf(d), earnings: d.earnings });

/** `GET /office/analytics/drivers` — scorecard-based view of the office's drivers: distributions, top and bottom performers (minimum-volume guard), who to coach, activity grids. */
export async function officeDriversReport(user: User, query: URLSearchParams) {
  const c = await portalCtx(user, query, "office");
  const { f, me } = c;
  return runPortalReport(c, "off-drivers", async (p) => {
    const grace = (await getSettings()).lateGraceMin;
    const [jobs, parcels, rating, scores, jobsS, grids] = await Promise.all([
      p.part("jobs", () => jobFacts(f, me, grace)), p.part("parcels", () => parcelFacts(f)), p.part("rating", () => ratingFacts(f)), p.part("scores", () => driverScores(f, me, grace)),
      p.part("series_jobs", () => jobsSeries(f)), p.part("grids", () => activityGrids(f, me)),
    ]);
    const list = scores ?? [];
    const kpis = driversKpis(f, { jobs, parcels, rating, coach: scores ? fleetTotals(scores).coach : null }, {
      off_no_show_rate: perBucket(col(jobsS, "no_show"), jobsS ? jobsS.points.map((x) => x.completed + x.active + x.cancelled + x.no_show + x.replaced) : []),
    });
    const flagged = list.map((d) => ({ d, flags: coachFlags(d) })).filter((x) => x.flags.length > 0).sort((a, b) => b.flags.length - a.flags.length || b.d.jobs - a.d.jobs).slice(0, 20);
    const body = {
      kpis, series: { jobs: jobsS }, distributions: scores && distributions(list), performers: scores && (({ top, bottom, ranked, belowGuard }) => ({ top: top.map(brief), bottom: bottom.map(brief), ranked, belowGuard }))(performers(list)),
      coach: scores && flagged.map(({ d, flags }) => ({ ...brief(d), flags, onTime: d.due ? d.onTime / d.due : null, noShow: d.noShow, cancelled: d.cancelled })),
      idle: scores ? list.filter((d) => driverFlags(d).includes("idle")).map((d) => ({ id: d.id, name: d.name })).slice(0, 20) : null,
      totals: scores && fleetTotals(list), grids,
      insights: officeInsights({ kpis, drivers: list, pendingCents: 0 }),
    };
    const empty = !!(jobs && scores) && !(jobs.jobs.cur || jobs.made.cur || scores.length);
    return { body, empty };
  });
}

type EarnF = Awaited<ReturnType<typeof earningFacts>>;
type WdF = Awaited<ReturnType<typeof withdrawalFacts>>;
/** KPI cards of the Earnings report (pure: unit-tested). */
export function earningsKpis(f: ResolvedFilters, x: { earn: EarnF | null; pending: { cents: number } | null; wd: WdF | null }, spark: Spark = {}) {
  const { earn, pending, wd } = x;
  return kpisFrom(f, [
    earn && ["off_earnings", earn.earned],
    earn && ["off_paid", earn.paid],
    pending && ["off_pending", stock(pending.cents), { href: "/office/settlements" }],
    earn && ["off_settlements", earn.settled],
    earn && ["off_avg_per_job", ratio(earn.earned, earn.settled)],
    earn && ["off_avg_per_parcel", ratio(earn.parcel_cents, earn.parcel_units)],
    earn && ["off_time_to_pay", ratio(earn.pay_secs, earn.pay_n)],
    wd && ["off_withdrawn", wd.paid, { href: "/office/wallet" }],
    wd && ["off_withdrawals_pending", stock(wd.pendingCents), { href: "/office/wallet" }],
    wd && ["off_wallet", stock(wd.available), { href: "/office/wallet" }],
  ], spark);
}

/** `GET /office/analytics/earnings` — what the office earned and was paid: trends, by driver / (anonymised) company / city / service, the settlement pipeline and withdrawals. */
export async function officeEarningsReport(user: User, query: URLSearchParams) {
  const c = await portalCtx(user, query, "office");
  const { f, me } = c;
  return runPortalReport(c, "off-earnings", async (p) => {
    const grace = (await getSettings()).lateGraceMin;
    const [earn, pending, wd, earnS, wdS, groups, pipe, wdBy, scores] = await Promise.all([
      p.part("earnings", () => earningFacts(f)), p.part("pending", () => pendingPay(f)), p.part("withdrawals", () => withdrawalFacts(f, me)), p.part("series_earnings", () => earningsSeries(f)),
      p.part("series_withdrawals", () => withdrawalSeries(f, me)), p.part("breakdowns", () => officeBreakdowns(f, me)), p.part("pipeline", () => pipeline(f)),
      p.part("withdrawals_status", () => withdrawalsByStatus(f, me)), p.part("by_driver", () => driverScores(f, me, grace)),
    ]);
    const kpis = earningsKpis(f, { earn, pending, wd }, { off_earnings: col(earnS, "earned"), off_paid: col(earnS, "paid"), off_withdrawn: col(wdS, "paid") });
    const byDriver = scores && [...scores].filter((d) => d.earnings > 0).sort((a, b) => b.earnings - a.earnings).slice(0, 10).map((d) => ({ key: d.id, name: d.name, earnings: d.earnings, jobs: d.jobs }));
    const empty = !!(earn && wd) && !(earn.earned.cur || earn.paid.cur || earn.settled.cur || wd.paid.cur || wd.asked.cur || wd.pendingCents || (pending?.cents ?? 0));
    const body = {
      kpis, series: { earnings: earnS, withdrawals: wdS }, breakdowns: groups && { city: groups.city, service: groups.service, company: groups.company, vehicle: groups.vehicle }, byDriver,
      pipeline: pipe, withdrawals: wdBy, wallet: wd && { available: wd.available, held: wd.held, pending: wd.pendingCents, pendingN: wd.pendingN },
      insights: earningsInsights({ kpis, pendingCents: pending?.cents ?? 0 }),
    };
    return { body, empty };
  });
}
