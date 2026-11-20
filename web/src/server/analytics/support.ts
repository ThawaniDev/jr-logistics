import type { User } from "@/db/schema";
import { can, requirePerm } from "../auth/permissions";
import { filtersMeta, parseFilters, type ResolvedFilters } from "./filters";
import { cached, permClass } from "./guard";
import { safeDiv, type Kpi } from "./kpi";
import { complaintBreakdowns, companiesPerOrder, driversPerOrder, lowestRated, repeatRequesters, ticketBreakdowns, ticketHeatmap, workload } from "./support-groups";
import { agingAlerts, supportFacts } from "./support-facts";
import { supportInsights } from "./support-insights";
import { supportKpis } from "./support-kpis";
import { complaintsSeries, qualitySeries, ratingsSeries, ticketsSeries } from "./support-series";
import { AT_RISK_SHARE, FIRST_RESPONSE_TARGET_SEC, LOW_STARS, MIN_ORDERS_FOR_RATE, MIN_RATINGS_FOR_RANK, pearson, per100, RESOLUTION_TARGET_SEC } from "./support-sla";
import "./support-tables";

const sum = (p: Record<string, unknown>, keys: string[]) => keys.reduce((s, k) => s + Number(p[k] ?? 0), 0);

async function compute(f: ResolvedFilters, money: boolean) {
  const [{ facts, tk, bl, cp, rt }, alerts, tickets, complaints, ratings, quality, tb, cb, heat, load, repeat, companies, drivers, lowest] = await Promise.all([
    supportFacts(f, money), agingAlerts(f), ticketsSeries(f), complaintsSeries(f), ratingsSeries(f), qualitySeries(f), ticketBreakdowns(f), complaintBreakdowns(f),
    ticketHeatmap(f), workload(f), repeatRequesters(f), companiesPerOrder(f), driversPerOrder(f), lowestRated(f),
  ]);
  const openedAt = (pts: Array<Record<string, number | string>>) => pts.map((p) => sum(p, tickets.categories));
  const opened = openedAt(tickets.points);
  const rate = (pts: Array<{ stars: number; n: number }>) => pts.map((p) => safeDiv(p.stars, p.n));
  const spark: Record<string, Array<number | null>> = {
    sup_tickets_opened: opened, sup_tickets_resolved: tickets.points.map((p) => p.resolved), sup_complaints_filed: complaints.points.map((p) => p.filed),
    sup_rating_avg: rate(ratings.points), sup_tickets_per_100: opened.map((n, i) => per100(n, quality[i]?.orders ?? 0)),
  };
  const kpis: Kpi[] = supportKpis(facts, spark, money);
  const flow = (pts: typeof tickets.points, cs: typeof complaints.points) => pts.map((p, i) => ({ t: p.t, opened: sum(p, tickets.categories), resolved: p.resolved, complaints: cs[i]?.filed ?? 0 }));
  const failed = quality.map((q) => (q.deliverySuccess == null ? null : 1 - q.deliverySuccess));
  const correlation = pearson(opened.map((n, i) => per100(n, quality[i]?.orders ?? 0)), failed);
  const stat = (r: { n: number; sum: number }) => ({ n: r.n, avg: safeDiv(r.sum, r.n) });
  const c = facts.complaints, t = facts.tickets;
  const empty = !(t.opened.cur || t.resolved.cur || facts.backlog.cur || c.filed.cur || c.resolved.cur || c.open.cur || facts.ratings.n.cur || facts.held.n);
  return {
    meta: { ...filtersMeta(f), empty, moneyHidden: !money },
    targets: { firstResponseSec: FIRST_RESPONSE_TARGET_SEC, resolutionSec: RESOLUTION_TARGET_SEC, atRiskShare: AT_RISK_SHARE },
    kpis,
    series: {
      volume: { categories: tickets.categories, points: tickets.points, prev: tickets.prev },
      flow: { points: flow(tickets.points, complaints.points), prev: tickets.prev && complaints.prev ? flow(tickets.prev, complaints.prev) : null },
      rating: ratings,
      quality: quality.map((q, i) => ({ ...q, tickets: opened[i] ?? 0, per100: per100(opened[i] ?? 0, q.orders) })),
    },
    breakdowns: { priority: tb.priority, role: tb.role, category: tb.category, complaintCategory: cb.category, complaintOutcome: cb.outcome },
    aging: { buckets: bl.aging, alerts, openNow: bl.openNow },
    resolution: { n: tk.resolvedN, p50: tk.resP50.cur, p90: tk.resP90.cur, histogram: tk.resolutionHistogram },
    heatmap: heat,
    workload: load, repeat, perOrder: { companies, drivers, minOrders: MIN_ORDERS_FOR_RATE },
    complaints: { frP50: cp.frP50.cur, resP50: cp.resP50.cur, held: facts.held },
    ratings: { distribution: rt.distribution, drivers: stat(rt.byRole.driver), companies: stat(rt.byRole.business), lowest, minRatings: MIN_RATINGS_FOR_RANK, lowStars: LOW_STARS },
    insights: supportInsights({ kpis, categories: tb.category, aging: bl.aging, heat, correlation }),
  };
}
export type SupportReport = Awaited<ReturnType<typeof compute>> & { meta: { generatedAt?: string; cached?: boolean } };

/** `GET /admin/analytics/support`: the whole Support & quality report for one filter set (cached 30 s per permission class). The settlement amount on hold needs `finance.view`. */
export async function supportReport(user: User, query: URLSearchParams) {
  requirePerm(user, "reports.view");
  const f = parseFilters(query);
  const money = can(user, "finance.view");
  const res = await cached(`support|${permClass(user)}|${f.canonical}`, () => compute(f, money));
  return { ...res.value, meta: { ...res.value.meta, generatedAt: new Date(res.at).toISOString(), cached: res.cached } };
}
