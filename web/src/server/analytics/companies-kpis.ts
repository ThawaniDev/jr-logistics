import { defineKpis, kpiDef } from "./definitions";
import type { ResolvedFilters } from "./filters";
import { makeKpi, type Kpi } from "./kpi";
import { kdef, RISK, ratioPair, zeroPair, type Pair } from "./companies-lib";
import type { companySummary } from "./companies-facts";

const k = kdef("rpp");
const NOT_REQUEST = ["service", "vehicle", "status", "channel", "city", "office", "driver"] as const;

defineKpis("companies", [
  k("cmp_new", "count", "higher"), k("cmp_returning", "count", "higher"), k("cmp_churned", "count", "lower"), k("cmp_at_risk", "count", "lower"),
  k("cmp_orders_per", "rate", "higher", { ratio: true }), k("cmp_parcels_per", "rate", "higher", { ratio: true }),
  k("cmp_cod_share", "percent", "neutral", { ratio: true }), k("cmp_api_share", "percent", "neutral", { ratio: true }), k("cmp_repeat", "percent", "higher", { ratio: true }),
  k("cmp_order_gap", "duration", "lower"),
  k("cmp_credit_util", "percent", "lower", { money: true, ratio: true, notFilteredBy: NOT_REQUEST }),
  k("cmp_verified", "percent", "higher", { ratio: true }), k("cmp_located", "percent", "higher", { ratio: true }),
]);
/** The keys of the KPIs the report shows, in grid order (money ones are dropped without `finance.view`). */
export const COMPANY_KPI_KEYS = ["active_companies", "cmp_new", "cmp_returning", "cmp_churned", "cmp_at_risk", "cmp_orders_per", "cmp_parcels_per", "gmv", "aov", "delivery_success", "cancellation_rate",
  "cmp_cod_share", "cmp_api_share", "cmp_repeat", "cmp_order_gap", "cmp_credit_util", "cmp_verified", "cmp_located"] as const;

type Summary = Awaited<ReturnType<typeof companySummary>>;
const noPrev = (p: Pair): Pair => ({ cur: p.cur, prev: null });
const add = (...p: Pair[]): Pair => ({ cur: p.reduce((s, x) => s + (x.cur ?? 0), 0), prev: p.some((x) => x.prev == null) ? null : p.reduce((s, x) => s + (x.prev ?? 0), 0) });

/** The KPI objects of the companies report from the raw facts (pure: unit-tested). `spark` carries one number per bucket for the KPIs that have a series. */
export function companyKpis(s: Summary, gap: Pair, creditUtil: number | null, f: ResolvedFilters, money: boolean, spark: Record<string, Array<number | null> | undefined> = {}): Kpi[] {
  const t = s.totals, active = zeroPair(s.active);
  const resolved = add(t.deliv, t.fail, t.ret);
  const churn60 = s.churn[60] ?? { cur: null, prev: null };
  const out: Array<[string, Pair, Partial<Kpi>?]> = [
    ["active_companies", active, { href: "/admin/companies" }], ["cmp_new", zeroPair(s.newCompanies)], ["cmp_returning", zeroPair(s.returning)],
    ["cmp_churned", zeroPair(churn60), { parts: RISK.churnDays.map((n) => ({ key: `d${n}`, value: s.churn[n]?.cur ?? 0 })) }], ["cmp_at_risk", zeroPair(s.atRisk)],
    ["cmp_orders_per", ratioPair(t.req, s.active)], ["cmp_parcels_per", ratioPair(t.reg, s.active)],
  ];
  if (money) out.push(["gmv", zeroPair(t.gmv), { href: "/admin/finance" }], ["aov", ratioPair(t.gmv, t.ord)]);
  out.push(
    ["delivery_success", ratioPair(t.deliv, resolved)], ["cancellation_rate", ratioPair(t.canc, t.req)],
    ["cmp_cod_share", ratioPair(t.cod, t.reg)], ["cmp_api_share", ratioPair(t.api, t.req)], ["cmp_repeat", ratioPair(s.repeat, s.active)], ["cmp_order_gap", gap],
  );
  if (money) out.push(["cmp_credit_util", { cur: creditUtil, prev: null }]);
  out.push(["cmp_verified", noPrev(ratioPair({ cur: s.verified, prev: null }, s.active))], ["cmp_located", noPrev(ratioPair({ cur: s.located, prev: null }, s.active))]);
  return out.map(([key, p, extra]) => {
    const un = f.active.filter((a) => (kpiDef(key).notFilteredBy ?? []).includes(a));
    return makeKpi(key, p.cur, p.prev, { ...extra, spark: spark[key], ...(un.length ? { unfiltered: [...un] } : {}) });
  });
}
