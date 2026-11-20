import { defineKpis, kpiDef } from "./definitions";
import type { ResolvedFilters } from "./filters";
import { makeKpi, type Kpi } from "./kpi";
import { kdef, ratioPair, zeroPair, type Pair } from "./companies-lib";
import type { activeUsers, backlog, companyActivation, documentStats, driverActivation, funnels, loginFacts, signupMix, stalledCounts, verification } from "./growth-facts";
import { ROLES, stickiness } from "./growth-lib";

const k = kdef("rpp");
const CITY_ONLY = ["service", "vehicle", "status", "channel", "company", "office", "driver"] as const;
const ALL = [...CITY_ONLY, "city"] as const;

defineKpis("growth", [
  k("gro_verified", "count", "higher", { notFilteredBy: ["service", "vehicle", "status", "channel", "company", "office", "driver"] }),
  k("gro_verify_rate", "percent", "higher", { ratio: true, notFilteredBy: CITY_ONLY }), k("gro_ttv_p50", "duration", "lower", { notFilteredBy: CITY_ONLY }), k("gro_ttv_p90", "duration", "lower", { notFilteredBy: CITY_ONLY }),
  k("gro_doc_reject", "percent", "lower", { ratio: true, notFilteredBy: ALL }), k("gro_company_activation", "percent", "higher", { ratio: true, notFilteredBy: CITY_ONLY }), k("gro_first_order", "duration", "lower", { notFilteredBy: CITY_ONLY }),
  k("gro_driver_activation", "percent", "higher", { ratio: true, notFilteredBy: CITY_ONLY }), k("gro_first_job", "duration", "lower", { notFilteredBy: CITY_ONLY }),
  k("gro_dau", "count", "higher", { notFilteredBy: ALL }), k("gro_wau", "count", "higher", { notFilteredBy: ALL }), k("gro_mau", "count", "higher", { notFilteredBy: ALL }),
  k("gro_stickiness", "percent", "higher", { ratio: true, notFilteredBy: ALL }), k("gro_login_fail", "percent", "lower", { ratio: true, notFilteredBy: ALL }),
  k("gro_backlog", "count", "lower", { notFilteredBy: CITY_ONLY }), k("gro_backlog_age", "duration", "lower", { notFilteredBy: CITY_ONLY }), k("gro_stalled", "count", "lower", { notFilteredBy: CITY_ONLY }),
]);
export const GROWTH_KPI_KEYS = ["new_signups", "gro_verified", "gro_verify_rate", "gro_ttv_p50", "gro_ttv_p90", "gro_doc_reject", "gro_company_activation", "gro_first_order", "gro_driver_activation", "gro_first_job",
  "gro_dau", "gro_wau", "gro_mau", "gro_stickiness", "gro_login_fail", "gro_backlog", "gro_backlog_age", "gro_stalled"] as const;

export interface GrowthFacts {
  mix: Awaited<ReturnType<typeof signupMix>>; funnel: Awaited<ReturnType<typeof funnels>>; ver: Awaited<ReturnType<typeof verification>>; drvAct: Awaited<ReturnType<typeof driverActivation>>;
  coAct: Awaited<ReturnType<typeof companyActivation>>; docs: Awaited<ReturnType<typeof documentStats>>; logins: Awaited<ReturnType<typeof loginFacts>>;
  active: { cur: Awaited<ReturnType<typeof activeUsers>>; prev: Awaited<ReturnType<typeof activeUsers>> | null }; backlog: Awaited<ReturnType<typeof backlog>>; stalled: Awaited<ReturnType<typeof stalledCounts>>;
}
const pairs = (a: number | null, b: number | null | undefined): Pair => ({ cur: a, prev: b ?? null });

/** The KPI objects of the growth report from the raw facts (pure: unit-tested). `new_signups` reuses the Overview's definition (only the city filter applies). */
export function growthKpis(x: GrowthFacts, f: ResolvedFilters, spark: Record<string, Array<number | null> | undefined> = {}): Kpi[] {
  const roles = x.mix.roles, cur = x.active.cur, prev = x.active.prev;
  const total: Pair = { cur: ROLES.reduce((s, r) => s + (roles[r].cur ?? 0), 0), prev: f.prev ? ROLES.reduce((s, r) => s + (roles[r].prev ?? 0), 0) : null };
  const attempts = x.logins.attempts, failed = x.logins.failed;
  const out: Array<[string, Pair, Partial<Kpi>?]> = [
    ["new_signups", zeroPair(total), { href: "/admin/users", parts: ROLES.map((r) => ({ key: r, value: roles[r].cur ?? 0 })) }],
    ["gro_verified", zeroPair(x.ver.n), { href: "/admin/verification" }], ["gro_verify_rate", x.funnel.rate], ["gro_ttv_p50", x.ver.p50], ["gro_ttv_p90", x.ver.p90],
    ["gro_doc_reject", ratioPair(x.docs.rejected, x.docs.decided)],
    ["gro_company_activation", ratioPair(x.coAct.ordered, x.coAct.registered)], ["gro_first_order", x.coAct.firstOrder],
    ["gro_driver_activation", ratioPair(x.drvAct.activated, x.drvAct.verified)], ["gro_first_job", x.drvAct.firstJob],
    ["gro_dau", pairs(cur.dau, prev?.dau)], ["gro_wau", pairs(cur.wau, prev?.wau)], ["gro_mau", pairs(cur.mau, prev?.mau)],
    ["gro_stickiness", { cur: stickiness(cur.dau, cur.mau), prev: prev ? stickiness(prev.dau, prev.mau) : null }],
    ["gro_login_fail", ratioPair(failed, attempts)],
    ["gro_backlog", { cur: x.backlog.total, prev: null }, { href: "/admin/verification" }], ["gro_backlog_age", { cur: x.backlog.medianAgeSeconds, prev: null }], ["gro_stalled", { cur: x.stalled.total, prev: null }],
  ];
  return out.map(([key, p, extra]) => {
    const un = f.active.filter((a) => (kpiDef(key).notFilteredBy ?? []).includes(a));
    return makeKpi(key, p.cur, p.prev, { ...extra, spark: spark[key], ...(un.length ? { unfiltered: [...un] } : {}) });
  });
}
