import type { Insight as BaseInsight } from "./insights";
import type { Kpi } from "./kpi";
import { fleetTotals, type DriverScore } from "./portal-calc";
import { FLAG_LIMITS } from "./portal-constants";

/**
 * Plain-language observations of the portal reports, generated from the numbers (pure, unit-tested). Same shape as the Overview's (`Insight`): `key` is an i18n key with
 * `{placeholders}` filled from `vars`; `refs` are other i18n keys the UI translates first (a KPI name, a city, a failure reason). Each insight needs enough volume behind it.
 */
/** An insight plus the names of its `vars` that are amounts in halalas (the page formats them in the viewer's language and currency). */
export interface Insight extends BaseInsight { money?: string[] }
const pct1 = (n: number) => Math.round(n * 1000) / 10;
const SWING = ["biz_requests", "biz_parcels_sent", "parcels_delivered", "biz_spend", "delivery_success", "first_attempt", "cancellation_rate", "on_time_start", "off_jobs", "off_earnings", "off_completion_rate", "off_no_show_rate", "active_drivers"];

/** The two biggest movements against the comparison period (counts and money by relative change, rates by percentage points). */
export function swingInsights(kpis: Kpi[]): Insight[] {
  const swings = kpis.filter((k) => SWING.includes(k.key) && k.delta != null).map((k) => {
    if (k.unit === "percent") return { k, score: Math.abs(k.delta!) >= 0.03 ? Math.abs(k.delta!) * 3 : 0, pp: true };
    return { k, score: k.deltaPct != null && Math.abs(k.deltaPct) >= 0.1 && Math.abs(k.prev ?? 0) >= 5 ? Math.abs(k.deltaPct) : 0, pp: false };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
  return swings.map(({ k, pp }) => {
    const up = k.delta! > 0, tone = k.good === "neutral" ? "info" : up === (k.good === "higher") ? "good" : "bad";
    return { key: pp ? (up ? "rpf.ins_pp_up" : "rpf.ins_pp_down") : up ? "rpf.ins_swing_up" : "rpf.ins_swing_down", tone, refs: { kpi: k.label }, vars: { n: pp ? pct1(Math.abs(k.delta!)) : pct1(Math.abs(k.deltaPct!)) } } as Insight;
  });
}
const kpiValue = (kpis: Kpi[], key: string) => kpis.find((k) => k.key === key)?.value ?? null;

export interface CityOutcome { key: string; resolved: number; failed: number; prevResolved: number | null; prevFailed: number | null }
export interface ReasonRow { key: string; count: number }

export interface BusinessInsightInput { kpis: Kpi[]; cities: CityOutcome[]; reasons: ReasonRow[]; codOutstanding: number; returnsOutstanding: number; heat: { cells: number[][]; total: number } }

export function businessInsights(i: BusinessInsightInput): Insight[] {
  const out: Insight[] = [];
  const created = kpiValue(i.kpis, "biz_requests");
  if (created != null && created < 5) out.push({ key: "rpf.ins_sparse", tone: "info", vars: { n: created } });
  out.push(...swingInsights(i.kpis));

  // The city whose failure rate rose the most against the comparison period (needs volume in both periods); otherwise the worst city of the period.
  const rate = (f: number, r: number) => (r > 0 ? f / r : null);
  const rose = i.cities.map((c) => ({ c, now: rate(c.failed, c.resolved), before: c.prevResolved ? rate(c.prevFailed ?? 0, c.prevResolved) : null }))
    .filter((x) => x.c.resolved >= 10 && (x.c.prevResolved ?? 0) >= 5 && x.now != null && x.before != null && x.now - x.before >= 0.05).sort((a, b) => (b.now! - b.before!) - (a.now! - a.before!))[0];
  if (rose) out.push({ key: "rpr.ins_city_fail_up", tone: "bad", refs: { city: `city.${rose.c.key}` }, vars: { now: pct1(rose.now!), before: pct1(rose.before!) } });
  else {
    const worst = i.cities.filter((c) => c.resolved >= 10 && c.failed / c.resolved >= 0.1).sort((a, b) => b.failed / b.resolved - a.failed / a.resolved)[0];
    if (worst) out.push({ key: "rpr.ins_city_fail_high", tone: "bad", refs: { city: `city.${worst.key}` }, vars: { n: pct1(worst.failed / worst.resolved), failed: worst.failed, total: worst.resolved } });
  }
  const failedTotal = i.reasons.reduce((s, r) => s + r.count, 0), top = [...i.reasons].sort((a, b) => b.count - a.count)[0];
  if (top && failedTotal >= 5 && top.count / failedTotal >= 0.3) out.push({ key: "rpr.ins_top_reason", tone: "info", refs: { reason: `stopfail.${top.key}` }, vars: { n: pct1(top.count / failedTotal) } });
  const success = kpiValue(i.kpis, "delivery_success");
  if (success != null && success < 0.9) out.push({ key: "rpf.ins_success_low", tone: "bad", vars: { n: pct1(success) } });
  const cancel = kpiValue(i.kpis, "cancellation_rate");
  if (cancel != null && cancel >= 0.15 && (created ?? 0) >= 10) out.push({ key: "rpr.ins_cancel_high", tone: "bad", vars: { n: pct1(cancel) }, href: "/business/requests" });
  if (i.returnsOutstanding > 0) out.push({ key: "rpr.ins_returns_waiting", tone: "bad", vars: { n: i.returnsOutstanding }, href: "/business/reports/deliveries" });
  if (i.codOutstanding > 0) out.push({ key: "rpr.ins_cod_outstanding", tone: "info", vars: { amount: i.codOutstanding }, money: ["amount"], href: "/business/cash" });
  if (i.heat.total >= 10) {
    let best = { d: 0, h: 0, n: -1 };
    i.heat.cells.forEach((row, d) => row.forEach((n, h) => { if (n > best.n) best = { d, h, n }; }));
    out.push({ key: "rpf.ins_peak", tone: "info", refs: { day: `rpf.wd_${best.d}` }, vars: { hour: `${String(best.h).padStart(2, "0")}:00` } });
  }
  return out.slice(0, 8);
}

export interface SpendingInsightInput { kpis: Kpi[]; creditUsage: number | null; forecastTotal: number | null }
export function spendingInsights(i: SpendingInsightInput): Insight[] {
  const out: Insight[] = [...swingInsights(i.kpis)];
  if (i.creditUsage != null && i.creditUsage >= 0.8) out.push({ key: "rpr.ins_credit_high", tone: "bad", vars: { n: pct1(i.creditUsage) }, href: "/business/wallet" });
  if (i.forecastTotal != null) out.push({ key: "rpr.ins_forecast", tone: "info", vars: { amount: i.forecastTotal }, money: ["amount"] });
  return out;
}

/** Earnings report: the swings and the money still waiting for payment. */
export function earningsInsights(i: { kpis: Kpi[]; pendingCents: number }): Insight[] {
  const out: Insight[] = [...swingInsights(i.kpis)];
  if (i.pendingCents > 0) out.push({ key: "rpr.ins_pending_pay", tone: "info", vars: { amount: i.pendingCents }, money: ["amount"], href: "/office/settlements" });
  return out;
}

export interface OfficeInsightInput { kpis: Kpi[]; drivers: DriverScore[]; pendingCents: number }

export function officeInsights(i: OfficeInsightInput): Insight[] {
  const out: Insight[] = [];
  const jobs = kpiValue(i.kpis, "off_jobs");
  if (jobs != null && jobs < 5) out.push({ key: "rpr.ins_sparse_jobs", tone: "info", vars: { n: jobs } });
  out.push(...swingInsights(i.kpis));
  const t = fleetTotals(i.drivers);
  const idle = i.drivers.filter((d) => d.linked && d.jobs === 0 && d.offersMade === 0).length;
  if (idle > 0 && t.drivers >= 2) out.push({ key: "rpr.ins_idle", tone: "info", vars: { n: idle }, href: "/office/reports/drivers" });
  if (t.coach > 0) out.push({ key: "rpr.ins_coach", tone: "bad", vars: { n: t.coach }, href: "/office/reports/drivers" });
  const noShow = kpiValue(i.kpis, "off_no_show_rate");
  if (noShow != null && noShow >= FLAG_LIMITS.noShow && (jobs ?? 0) >= 10) out.push({ key: "rpr.ins_no_show", tone: "bad", vars: { n: pct1(noShow) } });
  const delivered = i.drivers.reduce((s, d) => s + d.delivered, 0), lead = [...i.drivers].sort((a, b) => b.delivered - a.delivered)[0];
  if (lead && delivered >= 20 && i.drivers.length >= 3 && lead.delivered / delivered >= 0.4) out.push({ key: "rpr.ins_concentration", tone: "info", vars: { name: lead.name, n: pct1(lead.delivered / delivered) }, href: `/office/drivers/${lead.id}` });
  const success = kpiValue(i.kpis, "delivery_success");
  if (success != null && success < 0.9) out.push({ key: "rpf.ins_success_low", tone: "bad", vars: { n: pct1(success) } });
  if (i.pendingCents > 0) out.push({ key: "rpr.ins_pending_pay", tone: "info", vars: { amount: i.pendingCents }, money: ["amount"], href: "/office/settlements" });
  return out.slice(0, 8);
}
