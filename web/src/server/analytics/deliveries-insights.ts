import type { Insight } from "./insights";
import type { Kpi } from "./kpi";
import { MIN_VOLUME } from "./finance-core";
import type { GroupRow } from "./deliveries-groups";

const SWING = ["parcels_delivered", "delivery_success", "first_attempt", "dlv_failed", "dlv_time_p50", "dlv_defer_rate"];
const pct1 = (n: number) => Math.round(n * 1000) / 10;
const rate = (g: GroupRow) => (g.resolved > 0 ? g.delivered / g.resolved : null);

export interface DeliveryInsightInput {
  kpis: Kpi[]; reasons: Array<{ reason: string; n: number }>; groups: GroupRow[]; failHeat: { cells: number[][]; total: number };
  /** How many parcels the distance rate and the OTP rate stand on (a rate over three samples is not an insight). */
  samples: { distance: number; otp: number };
}

/** Plain-language observations of the Deliveries report (pure, unit-tested): sparse data, low success, the top failure reason, the weakest company / city, evidence, distance, route time, swings. */
export function deliveryInsights(i: DeliveryInsightInput): Insight[] {
  const out: Insight[] = [];
  const by = new Map(i.kpis.map((k) => [k.key, k]));
  const v = (key: string) => by.get(key)?.value ?? null;
  const resolved = (v("parcels_delivered") ?? 0) + (v("dlv_failed") ?? 0) + (v("dlv_returned") ?? 0);
  if (resolved < MIN_VOLUME) out.push({ key: "rpd.ins_sparse", tone: "info", vars: { n: resolved } });

  const swings = i.kpis.filter((k) => SWING.includes(k.key) && k.delta != null).map((k) => {
    if (k.unit === "percent") return { k, score: Math.abs(k.delta!) >= 0.03 ? Math.abs(k.delta!) * 3 : 0, pp: true };
    return { k, score: k.deltaPct != null && Math.abs(k.deltaPct) >= 0.1 && Math.abs(k.prev ?? 0) >= 5 ? Math.abs(k.deltaPct) : 0, pp: false };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
  for (const { k, pp } of swings) {
    const up = k.delta! > 0, tone = k.good === "neutral" ? "info" : up === (k.good === "higher") ? "good" : "bad";
    out.push({ key: pp ? (up ? "rpf.ins_pp_up" : "rpf.ins_pp_down") : up ? "rpf.ins_swing_up" : "rpf.ins_swing_down", tone, refs: { kpi: k.label }, vars: { n: pp ? pct1(Math.abs(k.delta!)) : pct1(Math.abs(k.deltaPct!)) } });
  }

  const success = v("delivery_success");
  if (success != null && resolved >= MIN_VOLUME && success < 0.9) out.push({ key: "rpf.ins_success_low", tone: "bad", vars: { n: pct1(success) } });
  const fails = i.reasons.reduce((s, r) => s + r.n, 0), top = [...i.reasons].sort((a, b) => b.n - a.n)[0];
  if (top && fails >= 5 && top.n / fails >= 0.3) out.push({ key: "rpd.ins_top_reason", tone: "info", refs: { reason: `stopfail.${top.reason}` }, vars: { n: pct1(top.n / fails) } });

  const pool = (dim: GroupRow["dim"]) => i.groups.filter((g) => g.dim === dim && g.resolved >= MIN_VOLUME && rate(g) != null).sort((a, b) => rate(a)! - rate(b)!);
  const company = pool("company")[0], city = pool("city")[0];
  if (company && rate(company)! < 0.85) out.push({ key: "rpd.ins_worst_company", tone: "bad", vars: { name: company.name ?? company.key, n: pct1(rate(company)!) }, href: `/admin/companies/${company.key}` });
  if (city && rate(city)! < 0.85 && i.groups.filter((g) => g.dim === "city").length > 1) out.push({ key: "rpd.ins_worst_city", tone: "bad", refs: { city: `city.${city.key}` }, vars: { n: pct1(rate(city)!) } });

  const far = v("dlv_far_rate");
  if (far != null && far >= 0.2 && i.samples.distance >= MIN_VOLUME) out.push({ key: "rpd.ins_far", tone: "bad", vars: { n: pct1(far) } });
  const ev = v("dlv_evidence_rate");
  if (ev != null && ev < 0.6 && (v("parcels_delivered") ?? 0) >= MIN_VOLUME) out.push({ key: "rpd.ins_evidence_low", tone: "bad", vars: { n: pct1(ev) } });
  const otp = v("dlv_otp_fail_rate");
  if (otp != null && otp >= 0.15 && i.samples.otp >= MIN_VOLUME) out.push({ key: "rpd.ins_otp", tone: "bad", vars: { n: pct1(otp) } });
  const defer = v("dlv_defer_rate");
  if (defer != null && defer >= 0.15) out.push({ key: "rpd.ins_defer", tone: "bad", vars: { n: pct1(defer) } });
  const leg = v("dlv_leg_ratio");
  if (leg != null && leg >= 1.5) out.push({ key: "rpd.ins_leg", tone: "bad", vars: { n: Math.round(leg * 10) / 10 } });
  const inc = v("dlv_incomplete_rate");
  if (inc != null && inc >= 0.1) out.push({ key: "rpd.ins_incomplete", tone: "info", vars: { n: pct1(inc) } });

  if (i.failHeat.total >= 10) {
    let best = { d: 0, h: 0, n: -1 };
    i.failHeat.cells.forEach((row, d) => row.forEach((n, h) => { if (n > best.n) best = { d, h, n }; }));
    out.push({ key: "rpd.ins_fail_peak", tone: "info", refs: { day: `rpf.wd_${best.d}` }, vars: { hour: `${String(best.h).padStart(2, "0")}:00` } });
  }
  return out.slice(0, 10);
}

/** The `n` weakest groups of each dimension by success rate, among those with at least MIN_VOLUME resolved parcels (lowest first). */
export function worstOf(groups: GroupRow[], n = 5): Record<GroupRow["dim"], GroupRow[]> {
  const out = {} as Record<GroupRow["dim"], GroupRow[]>;
  for (const dim of ["city", "service", "vehicle", "company", "office", "driver"] as const) {
    out[dim] = groups.filter((g) => g.dim === dim && g.resolved >= MIN_VOLUME).sort((a, b) => rate(a)! - rate(b)! || b.resolved - a.resolved || a.key.localeCompare(b.key)).slice(0, n);
  }
  return out;
}
/** Groups of one dimension, busiest first (the table of the breakdown). */
export const busiest = (groups: GroupRow[], dim: GroupRow["dim"]): GroupRow[] => groups.filter((g) => g.dim === dim).sort((a, b) => b.resolved - a.resolved || a.key.localeCompare(b.key));
