import { defineKpis, kpiDef } from "./definitions";
import type { ResolvedFilters } from "./filters";
import { makeKpi, type Kpi } from "./kpi";
import { kdef, ratioPair, zeroPair, type Pair } from "./companies-lib";
import type { officeSummary } from "./offices-facts";

const k = kdef("rpp");
const REQUEST_FILTERS = ["service", "vehicle", "status", "channel", "company", "city"] as const;

defineKpis("offices", [
  k("cof_active", "count", "higher"), k("cof_fleet", "count", "neutral", { notFilteredBy: REQUEST_FILTERS }), k("cof_active_drivers", "count", "higher"), k("cof_jobs", "count", "higher"), k("cof_parcels", "count", "higher"),
  k("cof_success", "percent", "higher", { ratio: true }), k("cof_ontime", "percent", "higher", { ratio: true }), k("cof_rating", "rate", "higher", { ratio: true }),
  k("cof_util", "percent", "higher", { ratio: true, notFilteredBy: REQUEST_FILTERS }), k("cof_earned", "money", "higher", { money: true }), k("cof_paid", "money", "higher", { money: true }),
  k("cof_pending", "money", "neutral", { money: true, notFilteredBy: ["city"] }), k("cof_links", "count", "higher", { notFilteredBy: [...REQUEST_FILTERS, "driver"] }), k("cof_unlinks", "count", "lower", { notFilteredBy: [...REQUEST_FILTERS, "driver"] }),
  k("cof_agreed", "percent", "higher", { ratio: true, notFilteredBy: [...REQUEST_FILTERS, "driver"] }),
]);
export const OFFICE_KPI_KEYS = ["cof_active", "cof_fleet", "cof_active_drivers", "cof_jobs", "cof_parcels", "cof_success", "cof_ontime", "cof_rating", "cof_util", "cof_earned", "cof_paid", "cof_pending", "cof_links", "cof_unlinks", "cof_agreed"] as const;

type Summary = Awaited<ReturnType<typeof officeSummary>>;
const add = (...p: Pair[]): Pair => ({ cur: p.reduce((s, x) => s + (x.cur ?? 0), 0), prev: p.some((x) => x.prev == null) ? null : p.reduce((s, x) => s + (x.prev ?? 0), 0) });

/** The KPI objects of the offices report from the raw facts (pure: unit-tested). */
export function officeKpis(s: Summary, drivers: Pair, f: ResolvedFilters, money: boolean, spark: Record<string, Array<number | null> | undefined> = {}): Kpi[] {
  const t = s.totals, resolved = add(t.deliv, t.fail, t.ret);
  const out: Array<[string, Pair, Partial<Kpi>?]> = [
    ["cof_active", zeroPair(s.active), { href: "/admin/offices" }], ["cof_fleet", { cur: s.fleet, prev: null }], ["cof_active_drivers", zeroPair(drivers)], ["cof_jobs", zeroPair(t.jobs)], ["cof_parcels", zeroPair(t.deliv)],
    ["cof_success", ratioPair(t.deliv, resolved)], ["cof_ontime", ratioPair(t.ontime, t.due)], ["cof_rating", ratioPair(t.rsum, t.rn)], ["cof_util", ratioPair(s.utilNum, { cur: s.fleet, prev: null })],
  ];
  if (money) out.push(["cof_earned", zeroPair(t.earned)], ["cof_paid", zeroPair(t.paid)], ["cof_pending", { cur: s.pending, prev: null }]);
  out.push(["cof_links", zeroPair(t.links)], ["cof_unlinks", zeroPair(t.unlinks)], ["cof_agreed", { cur: s.offices > 0 ? (s.agreements.find((a) => a.key === "accepted")?.value ?? 0) / s.offices : null, prev: null }]);
  return out.map(([key, p, extra]) => {
    const un = f.active.filter((a) => (kpiDef(key).notFilteredBy ?? []).includes(a));
    return makeKpi(key, p.cur, p.prev, { ...extra, spark: spark[key], ...(un.length ? { unfiltered: [...un] } : {}) });
  });
}
