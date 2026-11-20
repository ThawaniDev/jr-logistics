import type { User } from "@/db/schema";
import { requirePerm } from "../auth/permissions";
import { filtersMeta, parseFilters, type ResolvedFilters } from "./filters";
import { cached, permClass } from "./guard";
import { AGE_KEYS, emptyPairs, emptySeries, pairOf, perBucket, sectionGuard } from "./finance-core";
import { FINANCE_KPI_GROUPS } from "./finance-defs";
import { deliveredParcels, LATENCY_EDGES, latencyFacts, pipelineNow, settlementFacts, WD_EDGES, withdrawalFacts } from "./finance-facts";
import { financeInsights } from "./finance-insights";
import { financeKpis, lastValue, marginOutliers, topShare, waterfall } from "./finance-kpis";
import { balancesNow, creditNow, invoiceFacts, ledgerFacts, SNAP_FIELDS, snapshotSeries } from "./finance-live";
import { companyMargins, marginBreakdowns, MONEY_FIELDS, moneySeries, PIPE_FIELDS, pipelineSeries, SERVICE_FIELDS } from "./finance-series";
import "./finance-tables";

const hist = (edges: number[]) => [...edges, null].map((to, i) => ({ from: i === 0 ? null : edges[i - 1], to, count: 0 }));
const noBalances = { liability: 0, escrow: 0, cash: 0, platform: 0, available: 0, held: 0 };

async function compute(f: ResolvedFilters) {
  const { safe, failed } = sectionGuard();
  const live = safe("balances", balancesNow(), noBalances);
  const [settle, parcels, latency, pipeline, wd, ledger, invoices, credit, snap, money, pipe, margins, companies, now] = await Promise.all([
    safe("settlements", settlementFacts(f), emptyPairs()), safe("parcels", deliveredParcels(f), { cur: null, prev: null }), safe("latency", latencyFacts(f), emptyPairs({ hist: hist(LATENCY_EDGES), n: 0 })),
    safe("pipeline", pipelineNow(f), { buckets: AGE_KEYS.map((key) => ({ key, n: 0, payoutCents: 0, heldN: 0, heldCents: 0 })), unpaid: 0, payoutCents: 0, held: 0, heldCents: 0 }),
    safe("withdrawals", withdrawalFacts(f), emptyPairs({ pending: { n: 0, cents: 0, oldestSecs: 0 }, byStatus: [], byRole: [], hist: hist(WD_EDGES), histN: 0 })),
    safe("ledger", ledgerFacts(f), emptyPairs()), safe("invoices", invoiceFacts(f), emptyPairs()), safe("credit", creditNow(f), { used: 0, limit: 0, facilities: 0, top: [] }),
    live.then((l) => safe("snapshots", snapshotSeries(f, l), { bucket: f.bucket === "hour" ? ("day" as const) : f.bucket, points: emptySeries(f, SNAP_FIELDS, true).points, prev: null })),
    safe("money", moneySeries(f), emptySeries(f, [...MONEY_FIELDS, ...SERVICE_FIELDS])), safe("pipeline-series", pipelineSeries(f), emptySeries(f, PIPE_FIELDS)),
    safe("margins", marginBreakdowns(f), []), safe("companies", companyMargins(f), []), live,
  ]);
  const closing = {
    liability: pairOf(lastValue(snap.points, "liability"), lastValue(snap.prev, "liability")), escrow: pairOf(lastValue(snap.points, "escrow"), lastValue(snap.prev, "escrow")),
    cash: pairOf(lastValue(snap.points, "cash"), lastValue(snap.prev, "cash")),
  };
  const col = (k: string) => money.points.map((p) => (p as unknown as Record<string, number>)[k]);
  const margin = col("margin"), billed = col("billed"), vat = col("vat");
  const spark: Record<string, Array<number | null>> = {
    fin_billed: billed, fin_vat: vat, fin_net_sales: billed.map((v, i) => v - vat[i]), fin_provider: col("provider"), fin_revenue: margin, fin_margin_pct: perBucket(margin, billed), fin_net_position: margin.map((v, i) => v - vat[i]),
    fin_payout_office: col("office"), fin_payout_direct: col("direct"), fin_settlements: pipe.points.map((p) => p.created),
    fin_wallet_liability: snap.points.map((p) => p.liability), fin_escrow: snap.points.map((p) => p.escrow), fin_cash_drivers: snap.points.map((p) => p.cash),
  };
  const kpis = financeKpis({ settle, parcels, latency, pipeline, wd, ledger, invoices, closing, credit, companies }, f, spark);
  const total = settle.billed.cur ?? 0, platformPct = total > 0 ? (settle.margin.cur ?? 0) / total : null;
  const byBilled = [...companies].sort((a, b) => b.billed - a.billed || a.id.localeCompare(b.id));
  const outliers = marginOutliers(companies, platformPct);
  const oldest = pipeline.buckets.filter((b) => b.n > 0).map((b) => b.key);
  const oldestDays = oldest.length ? { d0_1: 0, d2_3: 2, d4_7: 4, d8_14: 8, d15: 15 }[oldest[oldest.length - 1]] : null;
  const empty = failed.length === 0 && !(settle.n.cur || wd.req_n.cur || wd.paid_n.cur || ledger.topup_n.cur || invoices.n.cur || pipeline.unpaid || wd.pending.n);
  return {
    meta: { ...filtersMeta(f), empty, moneyHidden: false, failed },
    kpis, kpiGroups: FINANCE_KPI_GROUPS,
    series: { money, pipeline: pipe, balances: snap },
    waterfall: { cur: waterfall(total, settle.vat.cur ?? 0, settle.provider.cur ?? 0), prev: f.prev ? waterfall(settle.billed.prev ?? 0, settle.vat.prev ?? 0, settle.provider.prev ?? 0) : null },
    margins: { city: margins.filter((m) => m.dim === "city"), service: margins.filter((m) => m.dim === "service"), vehicle: margins.filter((m) => m.dim === "vehicle") },
    companies: { top: byBilled.slice(0, 10), outliers, concentration: topShare(companies, settle.billed).cur, platformPct },
    pipeline: { ...pipeline, latency: { hist: latency.hist, n: latency.n, p50: latency.p50.cur, p90: latency.p90.cur, paid: latency.paid_n.cur ?? 0 } },
    withdrawals: { byStatus: wd.byStatus, byRole: wd.byRole, pending: wd.pending, hist: wd.hist, histN: wd.histN, p50: wd.p50.cur, p90: wd.p90.cur, requested: { n: wd.req_n.cur ?? 0, cents: wd.req_c.cur ?? 0 }, paid: { n: wd.paid_n.cur ?? 0, cents: wd.paid_c.cur ?? 0 }, rejected: { n: wd.rej_n.cur ?? 0, cents: wd.rej_c.cur ?? 0 } },
    credit, invoices: { n: invoices.n.cur ?? 0, subtotalCents: invoices.sub.cur ?? 0, vatCents: invoices.vat.cur ?? 0, totalCents: invoices.total.cur ?? 0 },
    refunds: { cancelCents: ledger.cancel.cur ?? 0, cancelN: ledger.cancel_n.cur ?? 0, settlementCents: settle.refund.cur ?? 0, adjustmentsIn: ledger.adj_in.cur ?? 0, adjustmentsOut: ledger.adj_out.cur ?? 0 },
    balances: now,
    insights: financeInsights({ kpis, top: byBilled[0] ? { id: byBilled[0].id, name: byBilled[0].name, billed: byBilled[0].billed } : null, totalBilled: total, outliers, credit: credit.top, oldestUnpaidDays: oldestDays, wdOldestSecs: wd.pending.oldestSecs, wdPendingN: wd.pending.n, companyCount: companies.length }),
  };
}

/** `GET /admin/analytics/finance`: revenue, margin, VAT, payouts, settlements, withdrawals, wallets and receivables for one filter set. Needs `reports.view` AND `finance.view` (cached 30 s per permission class). */
export async function financeReport(user: User, query: URLSearchParams) {
  requirePerm(user, "reports.view");
  requirePerm(user, "finance.view");
  const f = parseFilters(query);
  const res = await cached(`finance|${permClass(user)}|${f.canonical}`, () => compute(f));
  return { ...res.value, meta: { ...res.value.meta, generatedAt: new Date(res.at).toISOString(), cached: res.cached } };
}
export type FinanceData = Awaited<ReturnType<typeof financeReport>>;
