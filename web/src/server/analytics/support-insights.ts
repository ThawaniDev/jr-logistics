import type { Insight } from "./insights";
import type { Kpi } from "./kpi";
import type { HistBucket } from "./stats";

/** Plain-language observations of the Support report, generated from its numbers (pure, unit-tested). The text lives in the dictionary (`rpq.ins_*`); `refs` are translated by the UI first. */
export interface SupportInsightInput {
  kpis: Kpi[];
  categories: Array<{ key: string; value: number }>;
  aging: HistBucket[];
  heat: { cells: number[][]; total: number };
  /** Pearson r between tickets per 100 orders and the share of failed parcels per bucket (null when it cannot be told). */
  correlation: number | null;
}
const pct1 = (n: number) => Math.round(n * 1000) / 10;
const SWING = ["sup_tickets_opened", "sup_complaints_filed", "sup_sla_response", "sup_sla_resolution", "sup_rating_avg"];

export function supportInsights(i: SupportInsightInput): Insight[] {
  const out: Insight[] = [];
  const by = new Map(i.kpis.map((k) => [k.key, k]));
  const v = (key: string) => by.get(key)?.value ?? null;
  const opened = v("sup_tickets_opened") ?? 0;
  if (opened < 5) out.push({ key: "rpq.ins_sparse", tone: "info", vars: { n: opened } });

  const swings = i.kpis.filter((k) => SWING.includes(k.key) && k.delta != null).map((k) => {
    if (k.unit === "percent") return { k, pp: true, score: Math.abs(k.delta!) >= 0.05 ? Math.abs(k.delta!) * 3 : 0 };
    if (k.unit === "rate") return { k, pp: false, score: k.key === "sup_rating_avg" && Math.abs(k.delta!) >= 0.2 ? Math.abs(k.delta!) / 5 : 0 };
    return { k, pp: false, score: k.deltaPct != null && Math.abs(k.deltaPct) >= 0.2 && Math.abs(k.prev ?? 0) >= 5 ? Math.abs(k.deltaPct) : 0 };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
  for (const { k, pp } of swings) {
    const up = k.delta! > 0, tone = k.good === "neutral" ? "info" : up === (k.good === "higher") ? "good" : "bad";
    out.push({ key: pp ? (up ? "rpq.ins_pp_up" : "rpq.ins_pp_down") : up ? "rpq.ins_swing_up" : "rpq.ins_swing_down", tone, refs: { kpi: k.label }, vars: { n: pp ? pct1(Math.abs(k.delta!)) : k.unit === "rate" ? Math.round(Math.abs(k.delta!) * 100) / 100 : pct1(Math.abs(k.deltaPct!)) } });
  }

  const breaches = v("sup_breaches");
  if (breaches && breaches > 0) out.push({ key: "rpq.ins_breaches", tone: "bad", vars: { n: breaches } });
  for (const [key, ins] of [["sup_sla_response", "rpq.ins_sla_response"], ["sup_sla_resolution", "rpq.ins_sla_resolution"]] as const) {
    const s = v(key);
    if (s != null && s < 0.8) out.push({ key: ins, tone: "bad", vars: { n: pct1(s) } });
  }
  const old = i.aging.slice(2).reduce((s, b) => s + b.count, 0);
  if (old > 0) out.push({ key: "rpq.ins_aging", tone: "bad", vars: { n: old } });
  const unassigned = v("sup_unassigned");
  if (unassigned && unassigned > 0) out.push({ key: "rpq.ins_unassigned", tone: "bad", vars: { n: unassigned } });
  const held = v("sup_held_complaints");
  if (held && held > 0) out.push({ key: "rpq.ins_held", tone: "info", vars: { n: held } });
  const reopen = v("sup_reopen_rate");
  if (reopen != null && reopen >= 0.15) out.push({ key: "rpq.ins_reopen", tone: "bad", vars: { n: pct1(reopen) } });
  const low = v("sup_rating_low_share");
  if (low != null && low >= 0.2 && (v("sup_ratings_count") ?? 0) >= 5) out.push({ key: "rpq.ins_low_ratings", tone: "bad", vars: { n: pct1(low) } });

  const total = i.categories.reduce((s, c) => s + c.value, 0), top = i.categories[0];
  if (top && total >= 10 && top.value / total >= 0.3) out.push({ key: "rpq.ins_top_category", tone: "info", refs: { category: `ticket_cat.${top.key}` }, vars: { n: pct1(top.value / total) } });
  if (i.heat.total >= 10) {
    let best = { d: 0, h: 0, n: -1 };
    i.heat.cells.forEach((row, d) => row.forEach((n, h) => { if (n > best.n) best = { d, h, n }; }));
    out.push({ key: "rpq.ins_peak", tone: "info", refs: { day: `rpf.wd_${best.d}` }, vars: { hour: `${String(best.h).padStart(2, "0")}:00` } });
  }
  if (i.correlation != null && i.correlation >= 0.5) out.push({ key: "rpq.ins_corr", tone: "info", vars: { r: i.correlation.toFixed(2) } });
  return out.slice(0, 9);
}
