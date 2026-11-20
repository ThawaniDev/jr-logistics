import { inArray, sql } from "drizzle-orm";
import { requests, users } from "@/db/schema";
import { bucketSql } from "./buckets";
import { addMonths, dayStart, startOfMonth } from "./time";
import { anyWindow, inWindow, NOT_DRAFT, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { histogramFromRow, histogramSelect } from "./stats";
import { buildCohorts, HEALTH, HEALTH_EDGES, pairOf, RISK, segmentSql, seriesOf, twin, type Pair } from "./companies-lib";
import { withCompanies } from "./companies-sql";

type Row = Record<string, unknown>;
/** The previous-period number is only meaningful with a comparison. */
const P = (f: ResolvedFilters, r: Row | undefined, name: string): Pair => { const p = pairOf(r, name); return f.prev ? p : { cur: p.cur, prev: null }; };
const sum = (n: string) => sql.raw(`coalesce(sum(${n}_c), 0)::float8 as t_${n}_c, sum(${n}_p)::float8 as t_${n}_p`);
const SUMS = ["req", "canc", "api", "deliv", "fail", "ret", "reg", "cod", "gmv", "ord"];

/** Counts and totals over the per-company table: active / new / returning / churned / at risk, totals for every ratio, the health distribution — one pass. */
export async function companySummary(f: ResolvedFilters, money: boolean) {
  const [r] = await rows<Row>(withCompanies(f, money, sql`
    select
      count(*) filter (where req_c > 0)::int as active_c, count(*) filter (where req_p > 0)::int as active_p,
      count(*) filter (where req_c > 0 and before_c = 0)::int as new_c, count(*) filter (where req_p > 0 and before_p = 0)::int as new_p,
      count(*) filter (where req_c > 0 and before_c > 0)::int as ret_c, count(*) filter (where req_p > 0 and before_p > 0)::int as ret_p,
      ${sql.join(RISK.churnDays.map((n) => sql.raw(`count(*) filter (where silent_c >= ${n})::int as churn${n}_c, count(*) filter (where silent_p >= ${n})::int as churn${n}_p`)), sql`, `)},
      count(*) filter (where silent_c >= ${sql.raw(String(RISK.atRiskFrom))} and silent_c < ${sql.raw(String(HEALTH.silentDays))} and orders_to_c >= ${sql.raw(String(RISK.minOrders))})::int as risk_c,
      count(*) filter (where silent_p >= ${sql.raw(String(RISK.atRiskFrom))} and silent_p < ${sql.raw(String(HEALTH.silentDays))} and orders_to_p >= ${sql.raw(String(RISK.minOrders))})::int as risk_p,
      count(*) filter (where req_c >= 2)::int as rep_c, count(*) filter (where req_p >= 2)::int as rep_p,
      count(*) filter (where req_c > 0 and verification = 'verified')::int as ver_c, count(*) filter (where req_c > 0 and located)::int as loc_c,
      ${sql.join(SUMS.map(sum), sql`, `)},
      ${histogramSelect(sql`health_c`, HEALTH_EDGES, "h", sql`silent_c < ${sql.raw(String(HEALTH.silentDays))}`)},
      count(*) filter (where silent_c < ${sql.raw(String(HEALTH.silentDays))})::int as live_n, count(*) filter (where silent_c < ${sql.raw(String(HEALTH.silentDays))} and health_c < ${sql.raw(String(HEALTH.watch))})::int as low_n,
      avg(health_c) filter (where silent_c < ${sql.raw(String(HEALTH.silentDays))})::float8 as health_avg
    from d`));
  const t = (n: string) => P(f, r, `t_${n}`);
  return {
    active: P(f, r, "active"), newCompanies: P(f, r, "new"), returning: P(f, r, "ret"), atRisk: P(f, r, "risk"), repeat: P(f, r, "rep"),
    churn: Object.fromEntries(RISK.churnDays.map((n) => [n, P(f, r, `churn${n}`)])) as Record<number, Pair>,
    verified: num(r?.ver_c), located: num(r?.loc_c),
    totals: Object.fromEntries(SUMS.map((n) => [n, t(n)])) as Record<string, Pair>,
    health: { buckets: histogramFromRow(r ?? {}, HEALTH_EDGES), live: num(r?.live_n), low: num(r?.low_n), avg: r?.health_avg == null ? null : Math.round(Number(r.health_avg)) },
  };
}

/** Days between consecutive requests of the same company (both inside the period): median per period. */
export async function orderGap(f: ResolvedFilters): Promise<Pair> {
  const inCur = inWindow("x.at", f.cur);
  const [r] = await rows<Row>(sql`
    select percentile_cont(0.5) within group (order by x.gap) filter (where ${inCur}) as gap_c,
      ${f.prev ? sql`percentile_cont(0.5) within group (order by x.gap) filter (where ${inWindow("x.at", f.prev)})` : sql`null`} as gap_p
    from (select requests.created_at as at, extract(epoch from (requests.created_at - lag(requests.created_at) over (partition by requests.business_id, ${inWindow(requests.createdAt, f.cur)} order by requests.created_at)))::float8 as gap
      from requests where ${scope(f, "requests")} and ${NOT_DRAFT} and ${anyWindow(f, requests.createdAt)}) x where x.gap is not null`);
  return P(f, r, "gap");
}

/** Companies by calendar month of signup (Riyadh) × months since signup: how many ordered (a request matching the filters) in that month. 12 cohorts up to the end of the period. */
export async function cohortTable(f: ResolvedFilters) {
  const last = startOfMonth(f.cur.to), first = addMonths(last, -11);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(first, i));
  const from = dayStart(first).toISOString(), to = f.cur.end.toISOString();
  const co = f.company.length ? sql`and ${inArray(users.id, f.company)}` : sql``;
  const raw = await rows<Row>(sql`
    with c as (select users.id, date_trunc('month', users.created_at at time zone 'Asia/Riyadh') as m from users where users.role = 'business' and users.created_at >= ${from}::timestamptz and users.created_at < ${to}::timestamptz ${co}),
    a as (select requests.business_id as id, date_trunc('month', requests.created_at at time zone 'Asia/Riyadh') as m from requests
      where ${scope(f, "requests")} and ${NOT_DRAFT} and requests.created_at >= ${from}::timestamptz and requests.created_at < ${to}::timestamptz group by 1, 2)
    select to_char(c.m, 'YYYY-MM-DD') as cohort, ((extract(year from a.m) - extract(year from c.m)) * 12 + extract(month from a.m) - extract(month from c.m))::int as k, count(distinct c.id)::int as n
    from c join a on a.id = c.id and a.m >= c.m group by 1, 2
    union all select to_char(c.m, 'YYYY-MM-DD'), -1, count(*)::int from c group by 1`);
  return buildCohorts(raw.map((x) => ({ cohort: String(x.cohort), k: num(x.k), n: num(x.n) })), months);
}

/** Wallet balances of the company accounts now (halalas): distribution, total, credit used against credit granted. Finance only; only the company filter narrows it. */
export const WALLET_EDGES = [0, 1, 50_000, 200_000, 1_000_000];
export async function walletFacts(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    select ${histogramSelect(sql`wallet_accounts.available_cents`, WALLET_EDGES, "h")}, count(*)::int as n, coalesce(sum(wallet_accounts.available_cents), 0)::float8 as total,
      coalesce(sum(greatest(0, -wallet_accounts.available_cents)), 0)::float8 as used, coalesce(sum(wallet_accounts.credit_limit_cents) filter (where wallet_accounts.credit_limit_cents > 0), 0)::float8 as granted,
      count(*) filter (where wallet_accounts.credit_limit_cents > 0)::int as with_limit
    from wallet_accounts join users on users.id = wallet_accounts.owner_id where users.role = 'business' ${f.company.length ? sql`and ${inArray(users.id, f.company)}` : sql``}`);
  const granted = num(r?.granted);
  return { histogram: histogramFromRow(r ?? {}, WALLET_EDGES), accounts: num(r?.n), total: num(r?.total), used: num(r?.used), granted, withLimit: num(r?.with_limit), utilisation: granted > 0 ? num(r?.used) / granted : null };
}

export const ACTIVITY_FIELDS = ["active", "orders", "firsts", "signups"] as const;
/** Per bucket: companies that ordered, requests, companies whose FIRST request fell in it (`firsts`), and company accounts created (the signup city / company filters apply). */
export const activitySeries = (f: ResolvedFilters) => seriesOf(f, [...ACTIVITY_FIELDS], (w) => sql`
  select t, sum(active)::int as active, sum(orders)::int as orders, sum(firsts)::int as firsts, sum(signups)::int as signups from (
    select ${bucketSql(requests.createdAt, f.bucket)} as t, count(distinct requests.business_id) as active, count(*) as orders, 0 as firsts, 0 as signups
      from requests where ${scope(f, "requests")} and ${NOT_DRAFT} and ${inWindow(requests.createdAt, w)} group by 1
    union all select ${bucketSql("x.first_at", f.bucket)}, 0, 0, count(*), 0
      from (select requests.business_id, min(requests.created_at) as first_at from requests where ${scope(f, "requests")} and ${NOT_DRAFT} group by requests.business_id) x where ${inWindow("x.first_at", w)} group by 1
    union all select ${bucketSql(users.createdAt, f.bucket)}, 0, 0, 0, count(*)
      from users where users.role = 'business' and ${inWindow(users.createdAt, w)} ${f.city.length ? sql`and ${inArray(users.city, f.city)}` : sql``} ${f.company.length ? sql`and ${inArray(users.id, f.company)}` : sql``} group by 1
  ) y group by t`);

/** The ten largest companies by parcels registered (or billed amount) in the period. */
export async function topCompanies(f: ResolvedFilters, by: "reg" | "gmv", money: boolean) {
  const r = await rows<Row>(withCompanies(f, money, sql`select id, name, ${sql.raw(`${by}_c`)}::float8 as value from d where req_c > 0 and ${sql.raw(`${by}_c`)} > 0 order by value desc, id limit 10`));
  return r.map((x) => ({ id: String(x.id), name: String(x.name ?? ""), value: num(x.value) }));
}

/** Companies by size: parcels registered per 30 days (small < 100, medium < 500, large). */
export async function segments(f: ResolvedFilters, money: boolean) {
  const r = await rows<Row>(withCompanies(f, money, sql`
    select ${segmentSql(f.cur.days)} as seg, count(*)::int as companies, coalesce(sum(reg_c), 0)::float8 as parcels, coalesce(sum(req_c), 0)::float8 as requests, coalesce(sum(gmv_c), 0)::float8 as gmv
    from d where req_c > 0 group by 1`));
  return r.map((x) => ({ key: String(x.seg), companies: num(x.companies), parcels: num(x.parcels), requests: num(x.requests), gmv: money ? num(x.gmv) : null }));
}

/** Requests by channel (web / API / mobile app), this period and the comparison period. */
export async function channels(f: ResolvedFilters) {
  const r = await rows<Row>(sql`
    select requests.created_via as k, ${twin(f, { n: (w) => sql`count(*) filter (where ${w(requests.createdAt)})::int` })}
    from requests where ${scope(f, "requests")} and ${NOT_DRAFT} and ${anyWindow(f, requests.createdAt)} group by 1 order by 1`);
  return r.map((x) => ({ key: String(x.k), requests: num(x.n_c), prev: f.prev ? num(x.n_p) : null }));
}

/** Up to 1000 companies with this period's and the comparison period's value (billed amount with finance access, requests otherwise), for the growth leaders and decliners. */
export async function moverRows(f: ResolvedFilters, money: boolean) {
  if (!f.prev) return null;
  const m = money ? "gmv" : "req";
  const r = await rows<Row>(withCompanies(f, money, sql`select id, name, ${sql.raw(`${m}_c`)}::float8 as cur, ${sql.raw(`${m}_p`)}::float8 as prev from d where coalesce(${sql.raw(`${m}_c`)}, 0) > 0 or coalesce(${sql.raw(`${m}_p`)}, 0) > 0 order by greatest(coalesce(${sql.raw(`${m}_c`)}, 0), coalesce(${sql.raw(`${m}_p`)}, 0)) desc, id limit 1000`));
  return { by: money ? ("gmv" as const) : ("requests" as const), rows: r.map((x) => ({ id: String(x.id), name: String(x.name ?? ""), cur: num(x.cur), prev: num(x.prev) })) };
}
