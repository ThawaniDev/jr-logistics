import { describe, it, expect } from "vitest";
import en from "@/i18n/en";
import { AGING_EDGES, AT_RISK_SHARE, FIRST_RESPONSE_TARGET_SEC, RESOLUTION_EDGES, RESOLUTION_TARGET_SEC, TARGET_HOURS, pearson, per100, slaLabel, slaState, topWithOther } from "@/server/analytics/support-sla";
import { supportInsights } from "@/server/analytics/support-insights";
import { makeKpi } from "@/server/analytics/kpi";
import "@/server/analytics/support-kpis";

const T0 = new Date("2026-11-10T08:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * 3600_000);

describe("the SLA targets are defined once and the text says the same", () => {
  it("first response 4 h, resolution 48 h", () => {
    expect(FIRST_RESPONSE_TARGET_SEC).toBe(4 * 3600); expect(RESOLUTION_TARGET_SEC).toBe(48 * 3600); expect(TARGET_HOURS).toEqual({ firstResponse: 4, resolution: 48 });
    for (const k of ["rpq.def_sup_sla_response", "rpq.def_sup_sla_response_n", "rpq.def_sup_breaches"]) expect(en[k], k).toContain(`${TARGET_HOURS.firstResponse} hours`);
    for (const k of ["rpq.def_sup_sla_resolution", "rpq.def_sup_sla_resolution_n", "rpq.def_sup_breaches"]) expect(en[k], k).toContain(`${TARGET_HOURS.resolution} hours`);
    expect(en["rpq.ins_sla_response"]).toContain(`${TARGET_HOURS.firstResponse} hours`); expect(en["rpq.ins_sla_resolution"]).toContain(`${TARGET_HOURS.resolution} hours`);
  });
  it("the aging buckets are 0–1, 2–3, 4–7, 8–14 and 15+ days", () => {
    expect(AGING_EDGES.map((s) => s / 86400)).toEqual([2, 4, 8, 15]);
    expect(RESOLUTION_EDGES).toEqual([3600, 4 * 3600, 12 * 3600, 24 * 3600, 48 * 3600, 7 * 86400]);
  });
});

describe("slaState", () => {
  it("answered in time and resolved in time: met", () => {
    const s = slaState({ createdAt: T0, firstResponseAt: at(1), resolvedAt: at(20), now: at(100) });
    expect(s).toEqual({ response: "met", resolution: "met", breached: false, atRisk: false });
    expect(slaLabel(s, true)).toBe("ok");
  });
  it("exactly on the target is still met; one second late is missed", () => {
    expect(slaState({ createdAt: T0, firstResponseAt: at(4), resolvedAt: at(48), now: at(100) }).breached).toBe(false);
    expect(slaState({ createdAt: T0, firstResponseAt: new Date(at(4).getTime() + 1000), resolvedAt: at(10), now: at(100) })).toMatchObject({ response: "missed", breached: true });
  });
  it("unanswered: pending, then at risk after 75 % of the target, then missed", () => {
    expect(slaState({ createdAt: T0, now: at(1) })).toMatchObject({ response: "pending", breached: false, atRisk: false });
    expect(slaState({ createdAt: T0, now: at(3) })).toMatchObject({ response: "at_risk", atRisk: true, breached: false });
    expect(slaState({ createdAt: T0, now: at(4.5) })).toMatchObject({ response: "missed", breached: true, atRisk: false });
    expect(AT_RISK_SHARE).toBe(0.75);
  });
  it("answered but unresolved after 48 h is a breach; a reopened ticket (no resolvedAt) counts as unresolved", () => {
    expect(slaState({ createdAt: T0, firstResponseAt: at(1), resolvedAt: null, now: at(49) })).toMatchObject({ response: "met", resolution: "missed", breached: true });
    expect(slaState({ createdAt: T0, firstResponseAt: at(1), resolvedAt: null, now: at(40) })).toMatchObject({ resolution: "at_risk", atRisk: true });
  });
  it("labels for the tables", () => {
    expect(slaLabel(slaState({ createdAt: T0, firstResponseAt: at(1), now: at(5) }), false)).toBe("pending");
    expect(slaLabel(slaState({ createdAt: T0, now: at(3.5) }), false)).toBe("at_risk");
    expect(slaLabel(slaState({ createdAt: T0, now: at(9) }), false)).toBe("breached");
  });
  it("takes ISO strings too", () => {
    expect(slaState({ createdAt: T0.toISOString(), firstResponseAt: at(2).toISOString(), now: at(3) }).response).toBe("met");
  });
});

describe("helpers", () => {
  it("per100 is null without orders, never 0", () => {
    expect(per100(5, 0)).toBeNull(); expect(per100(null, 10)).toBeNull(); expect(per100(5, null)).toBeNull(); expect(per100(0, 10)).toBe(0); expect(per100(3, 12)).toBe(25);
  });
  it("pearson needs enough pairs and variance, and skips gaps", () => {
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeNull();
    expect(pearson([1, 2, 3, 4, 5, 6], [2, 4, 6, 8, 10, 12])).toBe(1);
    expect(pearson([1, 2, 3, 4, 5, 6], [12, 10, 8, 6, 4, 2])).toBe(-1);
    expect(pearson([1, 1, 1, 1, 1, 1], [1, 2, 3, 4, 5, 6])).toBeNull();
    expect(pearson([1, 2, null, 4, 5, 6, 7], [2, 4, 9, 8, null, 12, 14])).toBeNull(); // only 5 complete pairs
    expect(pearson([1, 2, null, 4, 5, 6, 7], [2, 4, 9, 8, null, 12, 14], 5)).toBe(1);
  });
  it("topWithOther keeps the biggest groups and says whether it folded the rest", () => {
    const m = new Map([["a", 5], ["b", 9], ["c", 1], ["d", 9]]);
    expect(topWithOther(m, 2)).toEqual({ keys: ["b", "d"], hasOther: true });
    expect(topWithOther(m, 4)).toEqual({ keys: ["b", "d", "a", "c"], hasOther: false });
    expect(topWithOther(new Map(), 3)).toEqual({ keys: [], hasOther: false });
  });
});

describe("supportInsights", () => {
  const k = (key: string, v: number | null, p: number | null = null) => makeKpi(key, v, p);
  const base = { aging: [{ from: null, to: 172800, count: 0 }, { from: 172800, to: 345600, count: 0 }, { from: 345600, to: 691200, count: 0 }, { from: 691200, to: 1296000, count: 0 }, { from: 1296000, to: null, count: 0 }], heat: { cells: Array.from({ length: 7 }, () => Array(24).fill(0)), total: 0 }, categories: [], correlation: null };
  it("says so when the period is sparse and stays quiet about nothing", () => {
    const out = supportInsights({ ...base, kpis: [k("sup_tickets_opened", 2)] });
    expect(out.map((i) => i.key)).toEqual(["rpq.ins_sparse"]);
  });
  it("raises breaches, low SLA, aging, unassigned, holds, reopen, low ratings and a dominant category", () => {
    const out = supportInsights({
      ...base, categories: [{ key: "payment_issue", value: 12 }, { key: "other", value: 8 }],
      aging: base.aging.map((b, i) => (i === 3 ? { ...b, count: 4 } : b)),
      kpis: [k("sup_tickets_opened", 30), k("sup_breaches", 6), k("sup_sla_response", 0.6), k("sup_sla_resolution", 0.7), k("sup_unassigned", 3), k("sup_held_complaints", 2), k("sup_reopen_rate", 0.2), k("sup_rating_low_share", 0.3), k("sup_ratings_count", 10)],
    });
    expect(out.map((i) => i.key)).toEqual(["rpq.ins_breaches", "rpq.ins_sla_response", "rpq.ins_sla_resolution", "rpq.ins_aging", "rpq.ins_unassigned", "rpq.ins_held", "rpq.ins_reopen", "rpq.ins_low_ratings", "rpq.ins_top_category"]);
    expect(out.find((i) => i.key === "rpq.ins_top_category")).toMatchObject({ refs: { category: "ticket_cat.payment_issue" }, vars: { n: 60 } });
    expect(out.find((i) => i.key === "rpq.ins_aging")?.vars).toEqual({ n: 4 });
  });
  it("names the peak weekday and hour and a strong correlation, but not a weak one", () => {
    const heat = { cells: base.heat.cells.map((r) => [...r]), total: 40 }; heat.cells[2][10] = 25;
    const out = supportInsights({ ...base, heat, correlation: 0.72, kpis: [k("sup_tickets_opened", 30)] });
    expect(out.find((i) => i.key === "rpq.ins_peak")).toMatchObject({ refs: { day: "rpf.wd_2" }, vars: { hour: "10:00" } });
    expect(out.find((i) => i.key === "rpq.ins_corr")?.vars).toEqual({ r: "0.72" });
    expect(supportInsights({ ...base, heat, correlation: 0.2, kpis: [k("sup_tickets_opened", 30)] }).some((i) => i.key === "rpq.ins_corr")).toBe(false);
  });
  it("reports the two biggest swings against the comparison period with the right tone", () => {
    const out = supportInsights({ ...base, kpis: [k("sup_tickets_opened", 100, 50), k("sup_sla_response", 0.7, 0.9), k("sup_complaints_filed", 10, 9)] });
    expect(out.find((i) => i.key === "rpq.ins_swing_up")).toMatchObject({ tone: "bad", refs: { kpi: "rpq.kpi_sup_tickets_opened" }, vars: { n: 100 } });
    expect(out.find((i) => i.key === "rpq.ins_pp_down")).toMatchObject({ tone: "bad", vars: { n: 20 } });
    expect(out.find((i) => i.refs?.kpi === "rpq.kpi_sup_complaints_filed")).toBeUndefined();
  });
});
