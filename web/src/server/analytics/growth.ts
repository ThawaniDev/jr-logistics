import type { User } from "@/db/schema";
import { can, requirePerm } from "../auth/permissions";
import { filtersMeta, parseFilters, type ResolvedFilters } from "./filters";
import { cached, permClass } from "./guard";
import { emptySeries, NO_PAIR, ratioPair, safely } from "./companies-lib";
import { ACTIVE_FIELDS, activeAtEnd, activeUsers, backlog, companyActivation, documentStats, driverActivation, funnels, loginFacts, loginSeries, SIGNUP_FIELDS, signupMix, signupSeries, stalledCounts, verification } from "./growth-facts";
import { growthKpis } from "./growth-kpis";
import { type ActiveCounts, BACKLOG_EDGES, funnelOf, growthInsights, ROLES, STALLED, stickiness } from "./growth-lib";
import "./growth-tables";

const NO_ACTIVE: ActiveCounts = { roles: { business: { dau: null, wau: null, mau: null }, driver: { dau: null, wau: null, mau: null }, office: { dau: null, wau: null, mau: null } }, dau: null, wau: null, mau: null };
const NO_FUNNEL = { roles: ROLES.map((role) => funnelOf({ role, registered: 0, docs: 0, verified: 0, rejected: 0, info: 0, pending: 0 })), rate: NO_PAIR, verified: NO_PAIR, registered: NO_PAIR };

async function compute(f: ResolvedFilters, money: boolean) {
  const end = activeAtEnd(f);
  const partial: string[] = [];
  const sec = <T>(title: string, run: () => Promise<T>, fallback: T) => safely(partial, title, run, fallback);
  const [mix, funnel, ver, drvAct, coAct, docs, logins, activeCur, activePrev, bk, stalled, signups, loginSer] = await Promise.all([
    signupMix(f), // the KPIs cannot do without these three: if one fails the whole report fails (and says why)
    sec("rpp.gro_funnels", () => funnels(f), NO_FUNNEL), sec("rpp.gro_ttv", () => verification(f), { n: NO_PAIR, p50: NO_PAIR, p90: NO_PAIR, byRole: ROLES.map((role) => ({ role, n: 0, p50: null, p90: null })) }),
    sec("rpp.gro_driver_activation", () => driverActivation(f), { verified: NO_PAIR, activated: NO_PAIR, firstJob: NO_PAIR }),
    sec("rpp.gro_activation", () => companyActivation(f), { registered: NO_PAIR, ordered: NO_PAIR, completed: NO_PAIR, firstOrder: NO_PAIR, toComplete: NO_PAIR }),
    sec("rpp.gro_docs", () => documentStats(f), { types: [], rejected: NO_PAIR, decided: NO_PAIR, reasons: [] }),
    sec("rpp.gro_clients", () => loginFacts(f), { clients: [], methods: [], failures: [], attempts: NO_PAIR, failed: NO_PAIR }),
    sec("rpp.gro_active_now", () => activeUsers(end.cur), NO_ACTIVE), end.prev ? sec("rpp.gro_active_now", () => activeUsers(end.prev!), null) : null,
    backlog(f), stalledCounts(f), sec("rpp.gro_signups", () => signupSeries(f), emptySeries(f, SIGNUP_FIELDS)), sec("rpp.gro_active", () => loginSeries(f), emptySeries(f, ACTIVE_FIELDS)),
  ]);
  const facts = { mix, funnel, ver, drvAct, coAct, docs, logins, active: { cur: activeCur, prev: activePrev }, backlog: bk, stalled };
  const spark = { new_signups: signups.points.map((p) => p.business + p.driver + p.office) };
  const kpis = growthKpis(facts, f, spark);
  const signupsCount = mix.roles.business.cur! + mix.roles.driver.cur! + mix.roles.office.cur!;
  const kv = (key: string) => kpis.find((k) => k.key === key)?.value ?? null;
  const top = mix.sources[0], topCity = mix.cities[0];
  const empty = signupsCount === 0 && (ver.n.cur ?? 0) === 0 && logins.attempts.cur === 0 && bk.total === 0 && stalled.total === 0 && (docs.decided.cur ?? 0) === 0;
  return {
    meta: { ...filtersMeta(f), empty, moneyHidden: !money },
    kpis, partial, series: { signups, logins: loginSer },
    sources: mix.sources, geography: { cities: mix.cities, total: mix.totalCities },
    funnels: funnel.roles,
    verification: { byRole: ver.byRole, p50: ver.p50.cur, p90: ver.p90.cur, verified: ver.n.cur },
    documents: { types: docs.types, reasons: docs.reasons, decided: docs.decided.cur, rejected: docs.rejected.cur },
    activation: {
      company: { registered: coAct.registered.cur, ordered: coAct.ordered.cur, completed: coAct.completed.cur, firstOrder: coAct.firstOrder.cur, toComplete: coAct.toComplete.cur, rate: ratioPair(coAct.ordered, coAct.registered).cur },
      driver: { verified: drvAct.verified.cur, activated: drvAct.activated.cur, firstJob: drvAct.firstJob.cur, rate: ratioPair(drvAct.activated, drvAct.verified).cur },
    },
    logins: { clients: logins.clients, methods: logins.methods, failures: logins.failures, attempts: logins.attempts.cur, failed: logins.failed.cur },
    active: { roles: activeCur.roles, asOf: end.cur.toISOString(), stickiness: stickiness(activeCur.dau, activeCur.mau) },
    backlog: { ...bk, edges: BACKLOG_EDGES }, stalled, thresholds: { ...STALLED },
    insights: growthInsights({
      signups: mix.roles.business, signupsCount, verifyRate: funnel.rate.cur, ttvP90: ver.p90.cur, docReject: kv("gro_doc_reject"), backlog: bk.total, oldest: bk.oldestDays, stalled: stalled.total,
      companyActivation: kv("gro_company_activation"), driverActivation: kv("gro_driver_activation"), stickiness: stickiness(activeCur.dau, activeCur.mau), loginFail: kv("gro_login_fail"),
      topSource: top && signupsCount > 0 ? { key: top.key, share: top.value / signupsCount } : null, topCity: topCity && signupsCount > 0 ? { key: topCity.key, share: topCity.value / signupsCount } : null,
    }),
  };
}

/** `GET /admin/analytics/growth`: the whole Growth & onboarding report for one filter set (cached 30 s per permission class). Only the city filter narrows it (signups have no service, vehicle or company). */
export async function growthReport(user: User, query: URLSearchParams) {
  requirePerm(user, "reports.view");
  const f = parseFilters(query);
  const money = can(user, "finance.view");
  const res = await cached(`growth|${permClass(user)}|${f.canonical}`, () => compute(f, money));
  return { ...res.value, meta: { ...res.value.meta, generatedAt: new Date(res.at).toISOString(), cached: res.cached } };
}
export type GrowthReport = Awaited<ReturnType<typeof growthReport>>;
