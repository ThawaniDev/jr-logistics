import type { User } from "@/db/schema";
import { can, requirePerm } from "../auth/permissions";
import { filtersMeta, parseFilters, type ResolvedFilters } from "./filters";
import { cached, permClass } from "./guard";
import { emptyPairs, emptySeries, pairOf, perBucket, sectionGuard, AGE_KEYS } from "./finance-core";
import { balances, LAG_EDGES, parcelFacts, remitFacts } from "./cod-facts";
import { COD_KPI_GROUPS } from "./cod-defs";
import { codInsights } from "./cod-insights";
import { codKpis } from "./cod-kpis";
import { liveCash, slowRemitters } from "./cod-live";
import { CASH_FIELDS, cashSeries, cashWithBalance, MIX_FIELDS, mixSeries } from "./cod-series";
import "./cod-tables";

const noLive = { buckets: AGE_KEYS.map((key) => ({ key, orders: 0, cents: 0 })), holders: { driver: [], office: [], company: [] }, alerts: [], orders: 0, outstanding: 0, aged: { orders: 0, cents: 0 }, drivers: 0 } as Awaited<ReturnType<typeof liveCash>>;

async function compute(f: ResolvedFilters, money: boolean) {
  const { safe, failed } = sectionGuard();
  const lagHist = [...LAG_EDGES, null].map((to, i) => ({ from: i === 0 ? null : LAG_EDGES[i - 1], to, count: 0 }));
  const [p, r, bal, live, cash, mix, slow] = await Promise.all([
    safe("parcels", parcelFacts(f), emptyPairs()), safe("remittances", remitFacts(f), emptyPairs({ hist: lagHist, histN: 0 })), money ? safe("balance", balances(f), null) : null,
    safe("cash", liveCash(f, money), noLive), money ? safe("series", cashSeries(f), emptySeries(f, CASH_FIELDS)) : null, safe("mix", mixSeries(f), emptySeries(f, MIX_FIELDS)), safe("slowest", slowRemitters(f), []),
  ]);
  const balanced = cash && bal ? cashWithBalance(cash, bal.curStart, bal.prevStart) : null;
  const outstanding = bal ? pairOf(bal.curEnd, bal.prevEnd) : pairOf(null, null);
  const spark = {
    ...(balanced ? { cod_collected: balanced.points.map((x) => x.collected), cod_remitted: balanced.points.map((x) => x.remitted), cod_outstanding: balanced.points.map((x) => x.outstanding) } : {}),
    cod_parcels: mix.points.map((x) => x.cod), cod_share: perBucket(mix.points.map((x) => x.cod), mix.points.map((x) => x.cod + x.prepaid)),
  };
  const kpis = codKpis({ parcels: p, remit: r, outstanding, aged: live.aged, holders: live.drivers }, f, money, spark);
  const c = (k: keyof typeof p) => p[k].cur ?? 0;
  const empty = failed.length === 0 && !(c("created") || c("delivered") || c("failed") || c("collected") || (r.n.cur ?? 0) || live.orders);
  return {
    meta: { ...filtersMeta(f), empty, moneyHidden: !money, failed },
    kpis, kpiGroups: COD_KPI_GROUPS,
    series: { cash: balanced, mix },
    // Counts of orders stay visible without finance access; amounts, holders and the alert list do not.
    aging: live.buckets.map((b) => (money ? b : { key: b.key, orders: b.orders })),
    holders: money ? live.holders : null, alerts: money ? live.alerts : null,
    received: { business: { n: r.by_business.cur ?? 0, cents: money ? r.amt_business.cur ?? 0 : null }, staff: { n: r.by_staff.cur ?? 0, cents: money ? r.amt_staff.cur ?? 0 : null } },
    lag: { p50: r.lag_p50.cur, p90: r.lag_p90.cur, n: r.n.cur ?? 0, hist: r.hist, histN: r.histN }, slowest: slow,
    insights: codInsights({ kpis, money, drivers: live.holders.driver, alerts: live.alerts, outstanding: live.outstanding, collected: c("collected") }),
  };
}

/** `GET /admin/analytics/cod`: the cash-on-delivery report for one filter set (cached 30 s per permission class). Amounts, holders and the alert list need `finance.view`; counts do not. */
export async function codReport(user: User, query: URLSearchParams) {
  requirePerm(user, "reports.view");
  const f = parseFilters(query);
  const money = can(user, "finance.view");
  const res = await cached(`cod|${permClass(user)}|${f.canonical}`, () => compute(f, money));
  return { ...res.value, meta: { ...res.value.meta, generatedAt: new Date(res.at).toISOString(), cached: res.cached } };
}
export type CodData = Awaited<ReturnType<typeof codReport>>;
