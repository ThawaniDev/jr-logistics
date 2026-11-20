import { defineKpis, type Good, type KpiDef, type Unit } from "./definitions";
import { makeKpi, safeDiv, type Kpi } from "./kpi";
import { per100 } from "./support-sla";

type Pair = { cur: number | null; prev: number | null };
const z = (p: Pair): Pair => ({ cur: p.cur ?? 0, prev: p.prev });
const ratio = (n: Pair, d: Pair): Pair => ({ cur: safeDiv(n.cur, d.cur), prev: safeDiv(n.prev, d.prev) });

const k = (key: string, unit: Unit, good: Good, o: { ratio?: boolean; money?: boolean } = {}): KpiDef => ({
  key, unit, good, label: `rpq.kpi_${key}`, definition: `rpq.def_${key}`, ...(o.ratio ? { numerator: `rpq.def_${key}_n`, denominator: `rpq.def_${key}_d` } : {}), ...(o.money ? { money: true } : {}),
});
/** The KPI groups of the page (the UI shows one row of cards per group). */
export const SUPPORT_GROUPS = {
  tickets: ["sup_tickets_opened", "sup_tickets_resolved", "sup_backlog", "sup_unassigned", "sup_tickets_per_100", "sup_urgent_share", "sup_reopen_rate"],
  speed: ["sup_first_response_p50", "sup_first_response_p90", "sup_resolution_p50", "sup_resolution_p90", "sup_sla_response", "sup_sla_resolution", "sup_breaches"],
  complaints: ["sup_complaints_filed", "sup_complaints_resolved", "sup_complaints_open", "sup_held_complaints", "sup_held_amount"],
  ratings: ["sup_rating_avg", "sup_ratings_count", "sup_rating_low_share", "sup_rating_response"],
} as const;

defineKpis("support", [
  k("sup_tickets_opened", "count", "lower"), k("sup_tickets_resolved", "count", "higher"), k("sup_backlog", "count", "lower"), k("sup_unassigned", "count", "lower"),
  k("sup_tickets_per_100", "rate", "lower", { ratio: true }), k("sup_urgent_share", "percent", "lower", { ratio: true }), k("sup_reopen_rate", "percent", "lower", { ratio: true }),
  k("sup_first_response_p50", "duration", "lower"), k("sup_first_response_p90", "duration", "lower"), k("sup_resolution_p50", "duration", "lower"), k("sup_resolution_p90", "duration", "lower"),
  k("sup_sla_response", "percent", "higher", { ratio: true }), k("sup_sla_resolution", "percent", "higher", { ratio: true }), k("sup_breaches", "count", "lower"),
  k("sup_complaints_filed", "count", "lower"), k("sup_complaints_resolved", "count", "higher"), k("sup_complaints_open", "count", "lower"),
  k("sup_held_complaints", "count", "lower"), k("sup_held_amount", "money", "lower", { money: true }),
  k("sup_rating_avg", "rate", "higher", { ratio: true }), k("sup_ratings_count", "count", "higher"), k("sup_rating_low_share", "percent", "lower", { ratio: true }), k("sup_rating_response", "percent", "higher", { ratio: true }),
]);

/** The raw numbers (current and previous period) the KPIs are made of; `held` and `unassigned` are "right now" snapshots without a previous value. */
export interface SupportFacts {
  tickets: Record<"opened" | "resolved" | "urgent" | "reopened" | "everResolved" | "frP50" | "frP90" | "resP50" | "resP90" | "respDue" | "respMet" | "resDue" | "resMet" | "breaches", Pair>;
  backlog: Pair; unassigned: number | null;
  complaints: Record<"filed" | "resolved" | "open", Pair>;
  orders: Pair;
  ratings: Record<"n" | "sum" | "low" | "jobs" | "rated", Pair>;
  held: { n: number; cents: number | null };
}

/** The KPI objects of the Support report from the raw facts (pure: unit-tested). `spark` is one number per bucket for the KPIs that have a series. `money` = viewer has `finance.view`. */
export function supportKpis(facts: SupportFacts, spark: Record<string, Array<number | null> | undefined> = {}, money = true): Kpi[] {
  const { tickets: t, complaints: c, ratings: r } = facts;
  const out: Array<[string, Pair, Partial<Kpi>?]> = [
    ["sup_tickets_opened", z(t.opened), { href: "/admin/cases" }], ["sup_tickets_resolved", z(t.resolved)], ["sup_backlog", z(facts.backlog), { href: "/admin/cases?status=open" }],
    ["sup_unassigned", { cur: facts.unassigned, prev: null }],
    ["sup_tickets_per_100", { cur: per100(t.opened.cur, facts.orders.cur), prev: per100(t.opened.prev, facts.orders.prev) }],
    ["sup_urgent_share", ratio(t.urgent, t.opened)], ["sup_reopen_rate", ratio(t.reopened, t.everResolved)],
    ["sup_first_response_p50", t.frP50], ["sup_first_response_p90", t.frP90], ["sup_resolution_p50", t.resP50], ["sup_resolution_p90", t.resP90],
    ["sup_sla_response", ratio(t.respMet, t.respDue)], ["sup_sla_resolution", ratio(t.resMet, t.resDue)], ["sup_breaches", z(t.breaches)],
    ["sup_complaints_filed", z(c.filed), { href: "/admin/complaints" }], ["sup_complaints_resolved", z(c.resolved)], ["sup_complaints_open", z(c.open), { href: "/admin/complaints?status=open" }],
    ["sup_held_complaints", { cur: facts.held.n, prev: null }],
    ...(money && facts.held.cents != null ? [["sup_held_amount", { cur: facts.held.cents, prev: null }] as [string, Pair]] : []),
    ["sup_rating_avg", ratio(r.sum, r.n), { href: "/admin/ratings" }], ["sup_ratings_count", z(r.n)], ["sup_rating_low_share", ratio(r.low, r.n)],
    ["sup_rating_response", ratio(r.rated, { cur: r.jobs.cur == null ? null : r.jobs.cur * 2, prev: r.jobs.prev == null ? null : r.jobs.prev * 2 })],
  ];
  return out.map(([key, p, extra]) => makeKpi(key, p.cur, p.prev, { ...extra, spark: spark[key] }));
}
