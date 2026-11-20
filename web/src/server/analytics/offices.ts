import type { User } from "@/db/schema";
import { can, requirePerm } from "../auth/permissions";
import { getSettings } from "../settings";
import { filtersMeta, parseFilters, type ResolvedFilters } from "./filters";
import { cached, permClass } from "./guard";
import { col, emptySeries, NO_PAIR, safely } from "./companies-lib";
import { MIN_OFFICE_RESOLVED, OFFICE_FIELDS, officeDrivers, officeFleet, officeLeaders, officeMoneySeries, officeSeries, officeSummary } from "./offices-facts";
import { officeKpis } from "./offices-kpis";
import { fleetTotals } from "./fleet-facts";
import { fleetKpis } from "./fleet-kpis";
import type { Insight } from "./insights";
import "./offices-tables";
import "./fleet-tables-offices";

const pct1 = (n: number) => Math.round(n * 1000) / 10;
/** Plain-language observations about the offices report (keys `rpp.ins_off_*`). */
function insights(i: { offices: number; active: number; fleet: number; util: number | null; success: number | null; agreementsOpen: number; unlinks: number; links: number; worst: { name: string; success: number } | null; pending: number | null }): Insight[] {
  const out: Insight[] = [];
  if (i.active < 3) out.push({ key: "rpp.ins_off_sparse", tone: "info", vars: { n: i.active } });
  if (i.offices > 0 && i.active === 0) out.push({ key: "rpp.ins_off_none_active", tone: "bad" });
  if (i.util != null && i.fleet > 0 && i.util < 0.4) out.push({ key: "rpp.ins_off_util_low", tone: "info", vars: { n: pct1(i.util) } });
  if (i.success != null && i.success < 0.9) out.push({ key: "rpp.ins_off_success_low", tone: "bad", vars: { n: pct1(i.success) } });
  if (i.worst && i.worst.success < 0.8) out.push({ key: "rpp.ins_off_worst", tone: "bad", vars: { name: i.worst.name, n: pct1(i.worst.success) } });
  if (i.agreementsOpen > 0) out.push({ key: "rpp.ins_off_agreements", tone: "bad", vars: { n: i.agreementsOpen }, href: "/admin/offices" });
  if (i.unlinks > i.links && i.unlinks > 0) out.push({ key: "rpp.ins_off_turnover", tone: "bad", vars: { left: i.unlinks, joined: i.links } });
  if ((i.pending ?? 0) > 0) out.push({ key: "rpp.ins_off_pending", tone: "info", href: "/admin/finance/settlements" });
  return out.slice(0, 8);
}

async function compute(f: ResolvedFilters, money: boolean) {
  const grace = (await getSettings()).lateGraceMin;
  const partial: string[] = [];
  const sec = <T>(title: string, run: () => Promise<T>, fallback: T) => safely(partial, title, run, fallback);
  const [summary, drivers, lead, fleet, series, moneySeries, fleetTot] = await Promise.all([
    officeSummary(f, money, grace), // the KPIs cannot do without it: if it fails the whole report fails (and says why)
    sec("rpp.kpi_cof_active_drivers", () => officeDrivers(f), NO_PAIR), sec("rpp.off_top", () => officeLeaders(f, money, grace), { byParcels: [], best: [], worst: [], minVolume: MIN_OFFICE_RESOLVED }),
    sec("rpp.off_drivers", () => officeFleet(f, money, grace), null), sec("rpp.off_activity", () => officeSeries(f), emptySeries(f, OFFICE_FIELDS)),
    money ? sec("rpp.off_money", () => officeMoneySeries(f), emptySeries(f, ["earned", "paid"] as const)) : null,
    sec("fr.sec_fleet", () => fleetTotals(f, money, grace, "offices"), null), // the fleet KPIs (lateness, times, distance …)
  ]);
  const t = summary.totals;
  const kpis = [...officeKpis(summary, drivers, f, money, { off_jobs: col(series, "jobs"), off_parcels: col(series, "delivered"), off_links: col(series, "links"), off_unlinks: col(series, "unlinks"), off_earned: moneySeries ? col(moneySeries, "earned") : undefined, off_paid: moneySeries ? col(moneySeries, "paid") : undefined }), ...(fleetTot ? fleetKpis(fleetTot, f, money, "offices") : [])];
  const kv = (k: string) => kpis.find((x) => x.key === k)?.value ?? null;
  const worst = lead.worst[0];
  const empty = summary.offices === 0 || ((summary.active.cur ?? 0) === 0 && summary.fleet === 0 && (t.links.cur ?? 0) === 0 && (t.unlinks.cur ?? 0) === 0 && col(series, "jobs").every((n) => n === 0));
  return {
    meta: { ...filtersMeta(f), empty, moneyHidden: !money },
    kpis, partial, series: { activity: series, money: moneySeries },
    fleet: { total: summary.fleet, verified: summary.fleetVerified, available: summary.fleetAvailable, offices: summary.offices },
    agreements: summary.agreements, leaders: lead, drivers: fleet, thresholds: { minResolved: lead.minVolume },
    insights: insights({
      offices: summary.offices, active: summary.active.cur ?? 0, fleet: summary.fleet, util: kv("cof_util"), success: kv("cof_success"), agreementsOpen: summary.agreements.filter((a) => a.key !== "accepted").reduce((s, a) => s + a.value, 0),
      unlinks: t.unlinks.cur ?? 0, links: t.links.cur ?? 0, worst: worst && worst.success != null ? { name: worst.name, success: worst.success } : null, pending: summary.pending,
    }),
  };
}

/** `GET /admin/analytics/offices`: the whole Courier offices report for one filter set (cached 30 s per permission class). Earnings and payouts need `finance.view`. */
export async function officesReport(user: User, query: URLSearchParams) {
  requirePerm(user, "reports.view");
  const f = parseFilters(query);
  const money = can(user, "finance.view");
  const res = await cached(`offices|${permClass(user)}|${f.canonical}`, () => compute(f, money));
  return { ...res.value, meta: { ...res.value.meta, generatedAt: new Date(res.at).toISOString(), cached: res.cached } };
}
export type OfficesReport = Awaited<ReturnType<typeof officesReport>>;
