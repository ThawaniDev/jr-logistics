import type { Kpi } from "./kpi";
import type { BreakdownRow, CompanyRow } from "./overview-groups";

/**
 * Plain-language observations generated from the numbers (pure, unit-tested). The text lives in the dictionary: `key` is an i18n key with `{placeholders}`
 * filled from `vars`; `refs` maps a placeholder to ANOTHER i18n key the UI translates first (a KPI name, a weekday, a city).
 */
export interface Insight { key: string; tone: "good" | "bad" | "info"; vars?: Record<string, string | number>; refs?: Record<string, string>; href?: string }

const SWING_KPIS = ["requests_created", "requests_completed", "parcels_delivered", "gmv", "revenue", "active_companies", "active_drivers", "delivery_success", "first_attempt", "cancellation_rate", "on_time_start"];
const pct1 = (n: number) => Math.round(n * 1000) / 10;

export interface InsightInput { kpis: Kpi[]; companies: { by: "gmv" | "requests"; rows: CompanyRow[] }; cities: BreakdownRow[]; heat: { cells: number[][]; total: number }; fill: { p90: number | null; n: number } }

export function buildInsights(i: InsightInput): Insight[] {
  const out: Insight[] = [];
  const by = new Map(i.kpis.map((k) => [k.key, k]));
  const created = by.get("requests_created")?.value ?? 0;
  if (created < 5) out.push({ key: "rpf.ins_sparse", tone: "info", vars: { n: created } });

  // The two biggest swings against the comparison period (counts and money by relative change, rates by percentage points).
  const swings = i.kpis.filter((k) => SWING_KPIS.includes(k.key) && k.delta != null).map((k) => {
    if (k.unit === "percent") return { k, score: Math.abs(k.delta!) >= 0.03 ? Math.abs(k.delta!) * 3 : 0, pp: true };
    return { k, score: k.deltaPct != null && Math.abs(k.deltaPct) >= 0.1 && Math.abs(k.prev ?? 0) >= 5 ? Math.abs(k.deltaPct) : 0, pp: false };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
  for (const { k, pp } of swings) {
    const up = k.delta! > 0, good = k.good === "neutral" ? "info" : up === (k.good === "higher") ? "good" : "bad";
    out.push({ key: pp ? (up ? "rpf.ins_pp_up" : "rpf.ins_pp_down") : up ? "rpf.ins_swing_up" : "rpf.ins_swing_down", tone: good, refs: { kpi: k.label }, vars: { n: pp ? pct1(Math.abs(k.delta!)) : pct1(Math.abs(k.deltaPct!)) } });
  }

  const cancel = by.get("cancellation_rate");
  if (cancel?.value != null && cancel.value >= 0.15 && created >= 10) out.push({ key: "rpf.ins_cancel_high", tone: "bad", vars: { n: pct1(cancel.value) }, href: "/admin/cancellations" });
  const success = by.get("delivery_success");
  if (success?.value != null && success.value < 0.9) out.push({ key: "rpf.ins_success_low", tone: "bad", vars: { n: pct1(success.value) } });
  if (i.fill.p90 != null && i.fill.p90 > 6 * 3600 && i.fill.n >= 5) { const h = i.fill.p90 / 3600; out.push(h >= 48 ? { key: "rpf.ins_slow_fill_d", tone: "bad", vars: { n: Math.round((h / 24) * 10) / 10 } } : { key: "rpf.ins_slow_fill", tone: "bad", vars: { n: Math.round(h * 10) / 10 } }); }

  const total = i.companies.rows.reduce((s, c) => s + c.value, 0), top = [...i.companies.rows].sort((a, b) => b.value - a.value)[0];
  if (top && total > 0 && top.value / total >= 0.4 && i.companies.rows.length > 1) out.push({ key: i.companies.by === "gmv" ? "rpf.ins_concentration_gmv" : "rpf.ins_concentration_req", tone: "info", vars: { name: top.name, n: pct1(top.value / total) }, href: `/admin/companies/${top.id}` });
  const lead = [...i.cities].sort((a, b) => b.requests - a.requests)[0], reqTotal = i.cities.reduce((s, c) => s + c.requests, 0);
  if (lead && reqTotal >= 10 && lead.requests / reqTotal >= 0.5 && i.cities.length > 1) out.push({ key: "rpf.ins_city_lead", tone: "info", refs: { city: `city.${lead.key}` }, vars: { n: pct1(lead.requests / reqTotal) } });

  if (i.heat.total >= 10) {
    let best = { d: 0, h: 0, n: -1 };
    i.heat.cells.forEach((row, d) => row.forEach((n, h) => { if (n > best.n) best = { d, h, n }; }));
    out.push({ key: "rpf.ins_peak", tone: "info", refs: { day: `rpf.wd_${best.d}` }, vars: { hour: `${String(best.h).padStart(2, "0")}:00` } });
  }
  return out.slice(0, 8);
}
