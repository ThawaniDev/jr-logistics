import type { Insight } from "./insights";
import type { Kpi } from "./kpi";
import type { CreditRow } from "./finance-live";
import type { OutlierRow } from "./finance-kpis";

const SWING = ["fin_billed", "fin_revenue", "fin_margin_pct", "fin_net_position", "fin_aov", "fin_wd_requested", "fin_topups", "fin_wallet_liability"];
const pct1 = (n: number) => Math.round(n * 1000) / 10;
const DAY = 86_400;

export interface FinanceInsightInput {
  kpis: Kpi[]; top: { id: string; name: string | null; billed: number } | null; totalBilled: number; outliers: { low: OutlierRow[]; high: OutlierRow[] };
  credit: CreditRow[]; oldestUnpaidDays: number | null; wdOldestSecs: number; wdPendingN: number;
  /** How many companies were billed (a top-10 share of ten companies or fewer is always 100 %: not an observation). */
  companyCount: number;
}

/** Plain-language observations of the finance report (pure, unit-tested). */
export function financeInsights(i: FinanceInsightInput): Insight[] {
  const out: Insight[] = [];
  const v = (key: string) => i.kpis.find((k) => k.key === key)?.value ?? null;
  const n = v("fin_settlements") ?? 0;
  if (n < 5) out.push({ key: "rpd.ins_fin_sparse", tone: "info", vars: { n } });
  const swings = i.kpis.filter((k) => SWING.includes(k.key) && k.delta != null).map((k) => {
    if (k.unit === "percent") return { k, score: Math.abs(k.delta!) >= 0.03 ? Math.abs(k.delta!) * 3 : 0, pp: true };
    return { k, score: k.deltaPct != null && Math.abs(k.deltaPct) >= 0.1 && Math.abs(k.prev ?? 0) >= 100 ? Math.abs(k.deltaPct) : 0, pp: false };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
  for (const { k, pp } of swings) {
    const up = k.delta! > 0, tone = k.good === "neutral" ? "info" : up === (k.good === "higher") ? "good" : "bad";
    out.push({ key: pp ? (up ? "rpf.ins_pp_up" : "rpf.ins_pp_down") : up ? "rpf.ins_swing_up" : "rpf.ins_swing_down", tone, refs: { kpi: k.label }, vars: { n: pp ? pct1(Math.abs(k.delta!)) : pct1(Math.abs(k.deltaPct!)) } });
  }
  if (i.top && i.totalBilled > 0 && i.top.billed / i.totalBilled >= 0.4) out.push({ key: "rpf.ins_concentration_gmv", tone: "info", vars: { name: i.top.name ?? i.top.id, n: pct1(i.top.billed / i.totalBilled) }, href: `/admin/companies/${i.top.id}` });
  const conc = v("fin_concentration");
  if (conc != null && conc >= 0.8 && n >= 5 && i.companyCount > 10) out.push({ key: "rpd.ins_fin_concentration", tone: "info", vars: { n: pct1(conc) } });
  const held = v("fin_settle_held") ?? 0;
  if (held > 0) out.push({ key: "rpd.ins_fin_held", tone: "bad", vars: { n: held }, href: "/admin/complaints" });
  if (i.oldestUnpaidDays != null && i.oldestUnpaidDays >= 8) out.push({ key: "rpd.ins_fin_unpaid_old", tone: "bad", vars: { n: Math.floor(i.oldestUnpaidDays) }, href: "/admin/finance/settlements" });
  if (i.wdPendingN > 0 && i.wdOldestSecs > 3 * DAY) out.push({ key: "rpd.ins_fin_wd_slow", tone: "bad", vars: { n: Math.round((i.wdOldestSecs / DAY) * 10) / 10 }, href: "/admin/finance/withdrawals" });
  const heavy = i.credit.find((c) => c.util != null && c.util >= 0.8);
  if (heavy) out.push({ key: "rpd.ins_fin_credit", tone: "bad", vars: { name: heavy.name ?? heavy.id, n: pct1(heavy.util!) }, href: `/admin/companies/${heavy.id}` });
  const low = i.outliers.low[0], high = i.outliers.high[0];
  if (low) out.push({ key: "rpd.ins_fin_margin_low", tone: "bad", vars: { name: low.name ?? low.id, n: pct1(low.pct) }, href: `/admin/companies/${low.id}` });
  if (high) out.push({ key: "rpd.ins_fin_margin_high", tone: "info", vars: { name: high.name ?? high.id, n: pct1(high.pct) }, href: `/admin/companies/${high.id}` });
  return out.slice(0, 10);
}
