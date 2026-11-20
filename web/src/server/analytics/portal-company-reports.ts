import type { User } from "@/db/schema";
import type { ResolvedFilters } from "./filters";
import { breakdowns, heatmap } from "./overview-groups";
import { parcelsSeries } from "./overview-series";
import "./portal-definitions";
import { cityOutcomes, deferAndCodes, deliveryTime, driversServed, failureReasons, proofMix, returnsStock, smsStatus } from "./portal-company-deliveries";
import { codFacts, dailySpend28, invoiceFacts, ledgerSummary, smsFacts, spendFacts, walletFacts } from "./portal-company-money";
import { parcelFacts, z } from "./portal-facts";
import { businessInsights, spendingInsights } from "./portal-insights";
import { add, col, kpisFrom, perBucket, ratio, stock } from "./portal-kpis";
import { forecastSpend } from "./portal-calc";
import { portalCtx, runPortalReport } from "./portal-scope";
import { codSeries, spendPivot, spendSeries, walletSeries } from "./portal-series";
import "./portal-tables-business";

type Spark = Record<string, Array<number | null>>;

/** KPI cards of the Deliveries report (pure: unit-tested). */
export function deliveriesKpis(f: ResolvedFilters, x: { parcels: Awaited<ReturnType<typeof parcelFacts>> | null; sms: Awaited<ReturnType<typeof smsFacts>> | null; returns: { n: number } | null }, spark: Spark = {}) {
  const pc = x.parcels;
  return kpisFrom(f, [
    pc && ["parcels_delivered", z(pc.delivered)],
    pc && ["biz_parcels_failed", z(pc.failed)],
    pc && ["biz_parcels_returned", z(pc.returned)],
    pc && ["delivery_success", ratio(pc.delivered, add(pc.delivered, pc.failed, pc.returned))],
    pc && ["first_attempt", ratio(pc.first, pc.delivered)],
    pc && ["biz_deferred_rate", ratio(pc.deferred, pc.resolved)],
    pc && ["biz_delivery_time", pc.p50],
    pc && ["biz_otp_issue_rate", ratio(pc.otp_issue, pc.resolved)],
    x.sms && ["biz_sms_failure_rate", ratio(x.sms.failed, x.sms.sent)],
    x.returns && ["biz_returns_outstanding", stock(x.returns.n)],
  ], spark);
}

/** `GET /business/analytics/deliveries` — delivery quality of the signed-in company's parcels. */
export async function businessDeliveriesReport(user: User, query: URLSearchParams) {
  const c = await portalCtx(user, query, "business");
  const { f, me } = c;
  return runPortalReport(c, "biz-deliveries", async (p) => {
    const [parcels, sms, returns, parcelS, reasons, cities, time, heat, proof, extra, smsBy, drivers] = await Promise.all([
      p.part("parcels", () => parcelFacts(f)), p.part("sms", () => smsFacts(f)), p.part("returns", () => returnsStock(f)), p.part("series_parcels", () => parcelsSeries(f)),
      p.part("reasons", () => failureReasons(f)), p.part("cities", () => cityOutcomes(f)), p.part("time", () => deliveryTime(f)), p.part("heatmap", () => heatmap(f)),
      p.part("proof", () => proofMix(f)), p.part("codes", () => deferAndCodes(f)), p.part("sms_status", () => smsStatus(f)), p.part("drivers", () => driversServed(f, me)),
    ]);
    const outcomes = parcelS ? parcelS.points.map((x) => x.delivered + x.failed + x.returned) : [];
    const kpis = deliveriesKpis(f, { parcels, sms, returns }, {
      parcels_delivered: col(parcelS, "delivered"), biz_parcels_failed: col(parcelS, "failed"), biz_parcels_returned: col(parcelS, "returned"), delivery_success: perBucket(col(parcelS, "delivered"), outcomes),
    });
    const empty = !!parcels && !(parcels.sent.cur || parcels.delivered.cur || parcels.failed.cur || parcels.returned.cur || (returns?.n ?? 0));
    const body = {
      kpis, series: { parcels: parcelS }, reasons, cities, deliveryTime: time, heatmap: heat, proof, defer: extra?.defer ?? null, codes: extra?.codes ?? null, sms: smsBy, drivers, returns,
      insights: businessInsights({ kpis, cities: cities ?? [], reasons: reasons ?? [], codOutstanding: 0, returnsOutstanding: returns?.n ?? 0, heat: heat ?? { cells: [], total: 0 } }),
    };
    return { body, empty };
  });
}

/** KPI cards of the Spending report (pure: unit-tested). */
export function spendingKpis(f: ResolvedFilters, x: {
  spend: Awaited<ReturnType<typeof spendFacts>> | null; inv: Awaited<ReturnType<typeof invoiceFacts>> | null; cod: Awaited<ReturnType<typeof codFacts>> | null;
  wallet: Awaited<ReturnType<typeof walletFacts>> | null; forecast: { total: number } | null;
}, spark: Spark = {}) {
  const { spend, inv, cod, wallet } = x;
  return kpisFrom(f, [
    spend && ["biz_spend", spend.spend],
    spend && ["biz_orders_billed", spend.orders],
    spend && ["biz_avg_order", ratio(spend.spend, spend.orders)],
    spend && ["biz_cost_per_parcel", ratio(spend.parcel_spend, spend.parcel_units)],
    inv && ["biz_invoiced", inv.invoiced],
    inv && ["biz_vat", inv.vat],
    wallet && ["biz_topups", wallet.topups],
    wallet && ["biz_wallet_balance", stock(wallet.available), { href: "/business/wallet" }],
    wallet && ["biz_credit_usage", stock(wallet.creditLimit > 0 ? wallet.creditUsed / wallet.creditLimit : null)],
    x.forecast && ["biz_forecast", stock(x.forecast.total)],
    cod && ["biz_cod_collected", cod.collected, { href: "/business/cash" }],
    cod && ["biz_cod_received", cod.received, { href: "/business/cash" }],
    cod && ["biz_cod_outstanding", stock(cod.outstanding), { href: "/business/cash" }],
  ], spark);
}

/** `GET /business/analytics/spending` — what the company is charged, invoices, wallet movements, cash on delivery and a labelled 30-day estimate. */
export async function businessSpendingReport(user: User, query: URLSearchParams) {
  const c = await portalCtx(user, query, "business");
  const { f, me } = c;
  return runPortalReport(c, "biz-spending", async (p) => {
    const [spend, inv, cod, wallet, ledger, spendS, walletS, codS, groups, daily, byVehicle, byCity] = await Promise.all([
      p.part("spend", () => spendFacts(f)), p.part("invoices", () => invoiceFacts(f)), p.part("cod", () => codFacts(f, me)), p.part("wallet", () => walletFacts(f, me)),
      p.part("ledger", () => ledgerSummary(f, me)), p.part("series_spend", () => spendSeries(f)), p.part("series_wallet", () => walletSeries(f, me)), p.part("series_cod", () => codSeries(f)),
      p.part("breakdowns", () => breakdowns(f, true)), p.part("forecast", () => dailySpend28(f)),
      p.part("series_vehicle", () => spendPivot(f, "vehicle")), p.part("series_city", () => spendPivot(f, "city")),
    ]);
    const forecast = daily ? forecastSpend(daily) : null;
    const price = spendS && {
      points: spendS.points.map((x) => ({ t: x.t, price: x.parcel_units > 0 ? x.parcel_spend / x.parcel_units : null })),
      prev: spendS.prev && spendS.prev.map((x) => ({ t: x.t, price: x.parcel_units > 0 ? x.parcel_spend / x.parcel_units : null })),
    };
    const kpis = spendingKpis(f, { spend, inv, cod, wallet, forecast }, {
      biz_spend: col(spendS, "spend"), biz_orders_billed: col(spendS, "orders"), biz_avg_order: perBucket(col(spendS, "spend"), col(spendS, "orders")), biz_topups: col(walletS, "topup"),
      biz_cod_collected: col(codS, "collected"), biz_cod_received: col(codS, "received"),
    });
    const empty = !!(spend && inv && cod && wallet) && !(spend.spend.cur || spend.orders.cur || inv.n.cur || cod.collected.cur || cod.received.cur || wallet.topups.cur || cod.outstanding || (ledger?.length ?? 0));
    const rows = (r: NonNullable<typeof groups>["city"]) => r.map((x) => ({ key: x.key, spend: x.gmv ?? 0, prevSpend: x.prevGmv, requests: x.requests, share: x.share }));
    const body = {
      kpis, series: { spend: spendS, wallet: walletS, cod: codS, price, byVehicle, byCity },
      breakdowns: groups && { city: rows(groups.city), service: rows(groups.service), vehicle: rows(groups.vehicle) }, ledger,
      wallet: wallet && { available: wallet.available, reserved: wallet.reserved, held: wallet.held, creditLimit: wallet.creditLimit, creditUsed: wallet.creditUsed }, forecast,
      insights: spendingInsights({ kpis, creditUsage: wallet && wallet.creditLimit > 0 ? wallet.creditUsed / wallet.creditLimit : null, forecastTotal: forecast?.total ?? null }),
    };
    return { body, empty };
  });
}
