import type { User } from "@/db/schema";
import type { ResolvedFilters } from "./filters";
import { breakdowns, heatmap } from "./overview-groups";
import { parcelsSeries, requestsSeries } from "./overview-series";
import "./portal-definitions";
import { codFacts, spendFacts } from "./portal-company-money";
import { cityOutcomes, failureReasons, returnsStock } from "./portal-company-deliveries";
import { fillFacts, parcelFacts, requestFacts, startFacts, z } from "./portal-facts";
import { businessInsights } from "./portal-insights";
import { add, col, kpisFrom, perBucket, ratio, stock } from "./portal-kpis";
import { portalCtx, runPortalReport } from "./portal-scope";
import { codSeries, spendSeries } from "./portal-series";
import "./portal-tables-business";

type Facts = {
  req: Awaited<ReturnType<typeof requestFacts>> | null; parcels: Awaited<ReturnType<typeof parcelFacts>> | null; start: Awaited<ReturnType<typeof startFacts>> | null;
  fill: Awaited<ReturnType<typeof fillFacts>> | null; spend: Awaited<ReturnType<typeof spendFacts>> | null; cod: Awaited<ReturnType<typeof codFacts>> | null;
};
type Spark = Record<string, Array<number | null>>;

/** The KPI cards of the company Overview from the facts (pure: unit-tested). A fact whose query failed is `null` and its cards are left out. */
export function businessOverviewKpis(facts: Facts, f: ResolvedFilters, spark: Spark = {}) {
  const { req, parcels: pc, start, fill, spend, cod } = facts;
  const resolved = pc && add(pc.delivered, pc.failed, pc.returned);
  return kpisFrom(f, [
    req && ["biz_requests", z(req.created), { href: "/business/requests" }],
    req && ["requests_completed", z(req.completed)],
    pc && ["biz_parcels_sent", z(pc.sent)],
    pc && ["parcels_delivered", z(pc.delivered)],
    pc && ["biz_parcels_failed", z(pc.failed)],
    pc && ["biz_parcels_returned", z(pc.returned)],
    pc && resolved && ["delivery_success", ratio(pc.delivered, resolved)],
    pc && ["first_attempt", ratio(pc.first, pc.delivered)],
    start && ["on_time_start", ratio(start.on_time, start.due)],
    fill && ["time_to_fill", fill.avg],
    req && ["cancellation_rate", ratio(req.cancelled, req.created)],
    spend && ["biz_spend", spend.spend],
    spend && ["biz_avg_order", ratio(spend.spend, spend.orders)],
    spend && ["biz_cost_per_parcel", ratio(spend.parcel_spend, spend.parcel_units)],
    cod && ["biz_cod_collected", cod.collected, { href: "/business/cash" }],
    cod && ["biz_cod_received", cod.received, { href: "/business/cash" }],
    cod && ["biz_cod_outstanding", stock(cod.outstanding), { href: "/business/cash" }],
  ], spark);
}

/** Breakdown rows as the company sees them: requests and what was charged; never the platform margin. */
const mapRows = (rowsIn: Awaited<ReturnType<typeof breakdowns>>["city"]) => rowsIn.map((r) => ({
  key: r.key, requests: r.requests, prevRequests: r.prevRequests, completed: r.completed, cancelled: r.cancelled, spend: r.gmv ?? 0, prevSpend: r.prevGmv, share: r.share,
}));

/** `GET /business/analytics/overview` — the whole company Overview for the signed-in company (cached 30 s per company + filters; a failed section degrades alone). */
export async function businessOverviewReport(user: User, query: URLSearchParams) {
  const c = await portalCtx(user, query, "business");
  const { f, me } = c;
  return runPortalReport(c, "biz-overview", async (p) => {
    const [req, parcels, start, fill, spend, cod, requests, parcelS, spendS, codS, groups, heat, cities, reasons, returns] = await Promise.all([
      p.part("requests", () => requestFacts(f)), p.part("parcels", () => parcelFacts(f)), p.part("start", () => startFacts(f)), p.part("fill", () => fillFacts(f)),
      p.part("spend", () => spendFacts(f)), p.part("cod", () => codFacts(f, me)),
      p.part("series_requests", () => requestsSeries(f)), p.part("series_parcels", () => parcelsSeries(f)), p.part("series_spend", () => spendSeries(f)), p.part("series_cod", () => codSeries(f)),
      p.part("breakdowns", () => breakdowns(f, true)), p.part("heatmap", () => heatmap(f)), p.part("cities", () => cityOutcomes(f)), p.part("reasons", () => failureReasons(f)), p.part("returns", () => returnsStock(f)),
    ]);
    const outcomes = parcelS ? parcelS.points.map((x) => x.delivered + x.failed + x.returned) : [];
    const spark: Spark = {
      biz_requests: col(requests, "total"), parcels_delivered: col(parcelS, "delivered"), biz_parcels_failed: col(parcelS, "failed"), biz_parcels_returned: col(parcelS, "returned"),
      delivery_success: perBucket(col(parcelS, "delivered"), outcomes), cancellation_rate: perBucket(col(requests, "cancelled"), col(requests, "total")),
      biz_spend: col(spendS, "spend"), biz_avg_order: perBucket(col(spendS, "spend"), col(spendS, "orders")), biz_cod_collected: col(codS, "collected"), biz_cod_received: col(codS, "received"),
    };
    const kpis = businessOverviewKpis({ req, parcels, start, fill, spend, cod }, f, spark);
    const empty = !!(req && parcels && spend && cod) && !(req.created.cur || req.completed.cur || parcels.sent.cur || parcels.delivered.cur || parcels.failed.cur || parcels.returned.cur || spend.spend.cur || cod.collected.cur || cod.outstanding);
    const body = {
      kpis, series: { requests, parcels: parcelS, spend: spendS, cod: codS }, funnel: req?.funnel ?? null,
      breakdowns: groups && { city: mapRows(groups.city), service: mapRows(groups.service), vehicle: mapRows(groups.vehicle), channel: mapRows(groups.channel) },
      heatmap: heat, fill: fill && { n: fill.n, p50: fill.p50, p90: fill.p90, histogram: fill.histogram }, cities,
      insights: businessInsights({ kpis, cities: cities ?? [], reasons: reasons ?? [], codOutstanding: cod?.outstanding ?? 0, returnsOutstanding: returns?.n ?? 0, heat: heat ?? { cells: [], total: 0 } }),
    };
    return { body, empty };
  });
}
