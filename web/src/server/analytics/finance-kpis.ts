import type { ResolvedFilters } from "./filters";
import { makeKpis, pairOf, ratio, sub, z, type Pair } from "./finance-core";
import type { Kpi } from "./kpi";
import "./finance-defs";
import type { LedgerFacts } from "./finance-live";
import type { SettlementFacts, WithdrawalFacts } from "./finance-facts";
import type { CompanyRow, MarginRow } from "./finance-series";

export interface FinanceFacts {
  settle: SettlementFacts; parcels: Pair; latency: Record<string, Pair>; pipeline: { unpaid: number; held: number }; wd: WithdrawalFacts; ledger: LedgerFacts; invoices: Record<string, Pair>;
  closing: { liability: Pair; escrow: Pair; cash: Pair }; credit: { used: number; limit: number }; companies: CompanyRow[];
}

/** The last number of a series that is not a gap (the closing balance of the period); null when the whole series is a gap. */
export function lastValue(points: Array<Record<string, number | string | null>> | null | undefined, key: string): number | null {
  for (let i = (points?.length ?? 0) - 1; i >= 0; i--) { const v = points![i][key]; if (typeof v === "number") return v; }
  return null;
}
/** Share of the billed amount that the `n` largest companies make up, for the current period and the comparison period (each by its own ranking). Null without billing. */
export function topShare(companies: Array<Pick<CompanyRow, "billed" | "prevBilled">>, total: Pair, n = 10): Pair {
  const share = (get: (c: Pick<CompanyRow, "billed" | "prevBilled">) => number, t: number | null) => {
    if (!t) return null;
    return [...companies].map(get).sort((a, b) => b - a).slice(0, n).reduce((s, v) => s + v, 0) / t;
  };
  return { cur: share((c) => c.billed, total.cur), prev: companies.some((c) => c.prevBilled != null) ? share((c) => c.prevBilled ?? 0, total.prev) : null };
}
/** Companies whose margin percentage is far from the platform's own (at least 3 settlements, 10 points apart): the lowest and the highest first. */
export function marginOutliers(companies: CompanyRow[], platformPct: number | null, gap = 0.1, minN = 3) {
  if (platformPct == null) return { low: [] as OutlierRow[], high: [] as OutlierRow[] };
  const all: OutlierRow[] = companies.filter((c) => c.n >= minN && c.billed > 0).map((c) => ({ id: c.id, name: c.name, billed: c.billed, margin: c.margin, pct: c.margin / c.billed, diff: c.margin / c.billed - platformPct }));
  const by = (a: OutlierRow, b: OutlierRow) => Math.abs(b.diff) - Math.abs(a.diff) || a.id.localeCompare(b.id);
  return { low: all.filter((c) => c.diff <= -gap).sort(by).slice(0, 5), high: all.filter((c) => c.diff >= gap).sort(by).slice(0, 5) };
}
export interface OutlierRow { id: string; name: string | null; billed: number; margin: number; pct: number; diff: number }

export type WaterfallStep = { key: "billed" | "vat" | "provider" | "net"; value: number; total: boolean };
/** Billed amount → minus VAT → minus provider cost → margin after VAT (pure). The margin still contains the VAT because prices are VAT-inclusive. */
export const waterfall = (billed: number, vat: number, provider: number): WaterfallStep[] => [
  { key: "billed", value: billed, total: true }, { key: "vat", value: -vat, total: false }, { key: "provider", value: -provider, total: false }, { key: "net", value: billed - vat - provider, total: true },
];

/** The KPI objects of the finance report from the raw facts (pure: unit-tested). */
export function financeKpis(x: FinanceFacts, f: ResolvedFilters, spark: Record<string, Array<number | null> | undefined> = {}): Kpi[] {
  const s = x.settle, w = x.wd, live = (n: number): Pair => pairOf(n, null);
  return makeKpis(f, [
    ["fin_billed", z(s.billed), { href: "/admin/finance/settlements" }], ["fin_vat", z(s.vat)], ["fin_net_sales", sub(z(s.billed), z(s.vat))], ["fin_provider", z(s.provider)], ["fin_revenue", z(s.margin)],
    ["fin_margin_pct", ratio(s.margin, s.billed)], ["fin_net_position", sub(z(s.margin), z(s.vat))], ["fin_aov", ratio(s.billed, s.orders)], ["fin_rev_per_request", ratio(s.margin, s.orders)],
    ["fin_rev_per_parcel", ratio(s.margin, x.parcels)], ["fin_settlements", z(s.n)], ["fin_concentration", topShare(x.companies, s.billed)],
    ["fin_payout_office", z(s.office)], ["fin_payout_direct", z(s.direct)], ["fin_settle_latency", x.latency.avg], ["fin_settle_unpaid", live(x.pipeline.unpaid), { href: "/admin/finance/settlements" }], ["fin_settle_held", live(x.pipeline.held)],
    ["fin_wd_requested", z(w.req_c), { href: "/admin/finance/withdrawals" }], ["fin_wd_paid", z(w.paid_c)], ["fin_wd_rejected", z(w.rej_c)], ["fin_wd_turnaround", w.avg], ["fin_wd_pending", live(w.pending.cents)],
    ["fin_topups", z(x.ledger.topup), { href: "/admin/finance/ledger" }], ["fin_wallet_liability", x.closing.liability], ["fin_escrow", x.closing.escrow], ["fin_cash_drivers", x.closing.cash, { href: "/admin/finance/cod" }],
    ["fin_credit_used", live(x.credit.used)], ["fin_credit_util", ratio(live(x.credit.used), live(x.credit.limit))],
    ["fin_invoices", z(x.invoices.n), { href: "/admin/finance/invoices" }], ["fin_invoiced", z(x.invoices.total)], ["fin_cancel_refunds", z(x.ledger.cancel)], ["fin_settle_refunds", z(s.refund)], ["fin_adjustments", sub(z(x.ledger.adj_in), z(x.ledger.adj_out))],
  ], spark);
}
export type { MarginRow };
