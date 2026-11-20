import { defineKpis, kpiDef } from "./definitions";
import type { ResolvedFilters } from "./filters";
import { makeKpi, type Kpi } from "./kpi";
import { kdef, ratioPair, zeroPair, type Pair } from "./companies-lib";
import type { churnFacts, driverSummary, ratingFacts, responseTimes } from "./drivers-facts";

const k = kdef("rpp");
const REQUEST_FILTERS = ["service", "vehicle", "status", "channel", "company", "city"] as const;

defineKpis("drivers", [
  k("flt_available", "count", "neutral", { notFilteredBy: REQUEST_FILTERS }), k("flt_online_hours", "duration", "higher", { notFilteredBy: REQUEST_FILTERS }),
  k("flt_jobs_per", "rate", "higher", { ratio: true }), k("flt_parcels_per", "rate", "higher", { ratio: true }), k("flt_success", "percent", "higher", { ratio: true }),
  k("flt_acceptance", "percent", "higher", { ratio: true }), k("flt_resp_p50", "duration", "lower"), k("flt_resp_p90", "duration", "lower"),
  k("flt_cancel", "percent", "lower", { ratio: true }), k("flt_replaced", "percent", "lower", { ratio: true }), k("flt_rating", "rate", "higher", { ratio: true }),
  k("flt_earn_per", "money", "higher", { money: true, ratio: true }), k("flt_earn_hour", "money", "higher", { money: true, ratio: true, notFilteredBy: REQUEST_FILTERS }),
  k("flt_util", "percent", "higher", { ratio: true, notFilteredBy: REQUEST_FILTERS }), k("flt_cash", "money", "lower", { money: true }),
  k("flt_strikes", "count", "lower"), k("flt_suspensions", "count", "lower", { notFilteredBy: REQUEST_FILTERS }), k("flt_churned", "count", "lower"), k("flt_flagged", "count", "lower"),
]);
export const DRIVER_KPI_KEYS = ["active_drivers", "flt_available", "flt_online_hours", "flt_jobs_per", "flt_parcels_per", "flt_success", "on_time_start", "flt_acceptance", "flt_resp_p50", "flt_resp_p90",
  "flt_cancel", "flt_replaced", "flt_rating", "flt_earn_per", "flt_earn_hour", "flt_util", "flt_cash", "flt_strikes", "flt_suspensions", "flt_churned", "flt_flagged"] as const;

type Summary = Awaited<ReturnType<typeof driverSummary>>;
export interface DriverFacts { summary: Summary; response: Awaited<ReturnType<typeof responseTimes>>; rating: Awaited<ReturnType<typeof ratingFacts>>; suspensions: Pair; churn: Awaited<ReturnType<typeof churnFacts>>; cash: number | null }
const add = (...p: Pair[]): Pair => ({ cur: p.reduce((s, x) => s + (x.cur ?? 0), 0), prev: p.some((x) => x.prev == null) ? null : p.reduce((s, x) => s + (x.prev ?? 0), 0) });
const hours = (p: Pair): Pair => ({ cur: p.cur == null ? null : p.cur / 3600, prev: p.prev == null ? null : p.prev / 3600 });

/** The KPI objects of the drivers report from the raw facts (pure: unit-tested). `spark` has one number per bucket for the KPIs with a series. */
export function driverKpis(x: DriverFacts, f: ResolvedFilters, money: boolean, spark: Record<string, Array<number | null> | undefined> = {}): Kpi[] {
  const t = x.summary.totals, s = x.summary;
  const resolved = add(t.deliv, t.fail, t.ret), bad = add(t.cancelled, t.noshow);
  const out: Array<[string, Pair, Partial<Kpi>?]> = [
    ["active_drivers", zeroPair(s.active), { href: "/admin/drivers" }], ["flt_available", { cur: s.availableNow, prev: null }], ["flt_online_hours", zeroPair(t.online)],
    ["flt_jobs_per", ratioPair(t.jobs, s.active)], ["flt_parcels_per", ratioPair(t.deliv, s.active)], ["flt_success", ratioPair(t.deliv, resolved)], ["on_time_start", ratioPair(t.ontime, t.due)],
    ["flt_acceptance", ratioPair(t.accepted, t.answered)], ["flt_resp_p50", x.response.p50], ["flt_resp_p90", x.response.p90], ["flt_cancel", ratioPair(bad, t.acc)], ["flt_replaced", ratioPair(t.replaced, t.acc)],
    ["flt_rating", ratioPair(t.rsum, t.rn)],
  ];
  if (money) out.push(["flt_earn_per", ratioPair(t.earn, s.earners)], ["flt_earn_hour", ratioPair(t.earn, hours(t.online))]);
  out.push(["flt_util", ratioPair(s.utilNum, t.online)]);
  if (money) out.push(["flt_cash", { cur: x.cash, prev: null }]);
  out.push(["flt_strikes", zeroPair(t.cancelled)], ["flt_suspensions", zeroPair(x.suspensions)], ["flt_churned", { cur: x.churn.churned, prev: null }], ["flt_flagged", { cur: s.flagged, prev: null }]);
  return out.map(([key, p, extra]) => {
    const un = f.active.filter((a) => (kpiDef(key).notFilteredBy ?? []).includes(a));
    return makeKpi(key, p.cur, p.prev, { ...extra, spark: spark[key], ...(un.length ? { unfiltered: [...un] } : {}) });
  });
}
