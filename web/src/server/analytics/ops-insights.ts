import type { Insight } from "./insights";
import type { Kpi } from "./kpi";
import type { CancelRank } from "./ops-cancel";
import type { OpsRow } from "./ops-groups";

/**
 * Plain-language observations on the Operations report (pure, unit-tested). `key` is an `rpo.ins_*` dictionary key (or an `rpf.ins_*` swing sentence) with `{placeholders}`
 * filled from `vars`; `refs` maps a placeholder to ANOTHER i18n key the UI translates first (a KPI name, a weekday, a city).
 */
export interface OpsInsightInput {
  kpis: Kpi[]; cities: OpsRow[];
  unfilledHeat: { cells: number[][]; total: number } | null;
  companies: CancelRank[]; drivers: CancelRank[];
  /** Jobs due / requests with a known staffing outcome: small samples are not judged. */
  samples: { due: number; cohort: number; cancelled: number };
}
const SWING = ["requests_created", "ops_fill_rate", "ops_fill_p50", "on_time_start", "ops_no_show_rate", "ops_offer_acceptance", "ops_response_p50", "ops_cancelled_requests", "ops_driver_cancels", "ops_utilisation"];
const pct1 = (n: number) => Math.round(n * 1000) / 10;
const hours1 = (secs: number) => Math.round((secs / 3600) * 10) / 10;
const TONE = { bad: 0, info: 1, good: 2 } as const;

export function buildOpsInsights(i: OpsInsightInput): Insight[] {
  const out: Insight[] = [];
  const by = new Map(i.kpis.map((k) => [k.key, k]));
  const v = (key: string) => by.get(key)?.value ?? null;
  const created = v("requests_created") ?? 0;
  if (created < 5) out.push({ key: "rpf.ins_sparse", tone: "info", vars: { n: created } });

  const swings = i.kpis.filter((k) => SWING.includes(k.key) && k.delta != null).map((k) => {
    if (k.unit === "percent") return { k, score: Math.abs(k.delta!) >= 0.03 ? Math.abs(k.delta!) * 3 : 0, pp: true };
    return { k, score: k.deltaPct != null && Math.abs(k.deltaPct) >= 0.15 && Math.abs(k.prev ?? 0) >= 5 ? Math.abs(k.deltaPct) : 0, pp: false };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
  for (const { k, pp } of swings) {
    const up = k.delta! > 0, tone = k.good === "neutral" ? "info" : up === (k.good === "higher") ? "good" : "bad";
    out.push({ key: pp ? (up ? "rpf.ins_pp_up" : "rpf.ins_pp_down") : up ? "rpf.ins_swing_up" : "rpf.ins_swing_down", tone, refs: { kpi: k.label }, vars: { n: pp ? pct1(Math.abs(k.delta!)) : pct1(Math.abs(k.deltaPct!)) } });
  }

  const fill = v("ops_fill_rate"), unfilled = v("ops_unfilled_slots") ?? 0;
  if (fill != null && fill < 0.8 && i.samples.cohort >= 10) out.push({ key: "rpo.ins_fill_low", tone: "bad", vars: { n: pct1(fill), slots: unfilled }, href: "/admin/operations" });
  const p90 = v("ops_fill_p90");
  if (p90 != null && p90 > 6 * 3600 && i.samples.cohort >= 5) out.push({ key: "rpo.ins_slow_staff", tone: "bad", vars: { n: hours1(p90) } });
  const onTime = v("on_time_start");
  if (onTime != null && onTime < 0.85 && i.samples.due >= 10) out.push({ key: "rpo.ins_late_high", tone: "bad", vars: { n: pct1(1 - onTime) } });
  const noShow = v("ops_no_show_rate");
  if (noShow != null && noShow >= 0.05 && i.samples.due >= 10) out.push({ key: "rpo.ins_noshow_high", tone: "bad", vars: { n: pct1(noShow) }, href: "/admin/cancellations" });
  const lateCancel = v("ops_late_cancel_share"), cancelled = v("ops_cancelled_requests") ?? 0;
  if (lateCancel != null && lateCancel >= 0.3 && cancelled >= 5) out.push({ key: "rpo.ins_cancel_late", tone: "bad", vars: { n: pct1(lateCancel) }, href: "/admin/cancellations" });
  const response = v("ops_response_p50");
  if (response != null && response >= 1800) out.push({ key: "rpo.ins_response_slow", tone: "bad", vars: { n: Math.round(response / 60) } });
  const util = v("ops_utilisation");
  if (util != null && util >= 0.85) out.push({ key: "rpo.ins_util_high", tone: "bad", vars: { n: pct1(util) } });

  // The weakest city: lowest fill rate among cities with enough slots, clearly below the platform's.
  const weak = i.cities.filter((c) => c.fillRate != null && c.slots >= 5).sort((a, b) => a.fillRate! - b.fillRate!)[0];
  if (weak && fill != null && weak.fillRate! < fill - 0.1) out.push({ key: "rpo.ins_city_weak", tone: "bad", refs: { city: `city.${weak.key}` }, vars: { n: pct1(weak.fillRate!) } });

  if (i.unfilledHeat && i.unfilledHeat.total >= 5) {
    let best = { d: 0, h: 0, n: -1 };
    i.unfilledHeat.cells.forEach((row, d) => row.forEach((n, h) => { if (n > best.n) best = { d, h, n }; }));
    out.push({ key: "rpo.ins_peak_unfilled", tone: "info", refs: { day: `rpf.wd_${best.d}` }, vars: { hour: `${String(best.h).padStart(2, "0")}:00`, n: best.n } });
  }
  const co = i.companies[0];
  if (co && co.value >= 3) out.push({ key: "rpo.ins_repeat_company", tone: "bad", vars: { name: co.name, n: co.value }, href: `/admin/companies/${co.id}` });
  const dr = i.drivers[0];
  if (dr && dr.value >= 3) out.push({ key: "rpo.ins_repeat_driver", tone: "bad", vars: { name: dr.name, n: dr.value }, href: `/admin/drivers/${dr.id}` });
  const strikes = v("ops_strikes");
  if (strikes != null && strikes >= 1) out.push({ key: "rpo.ins_strikes", tone: "info", vars: { n: strikes } });

  return out.map((x, n) => ({ x, n })).sort((a, b) => TONE[a.x.tone] - TONE[b.x.tone] || a.n - b.n).map((y) => y.x).slice(0, 9);
}
