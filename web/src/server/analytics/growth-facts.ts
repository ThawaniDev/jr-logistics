import { sql, type SQL } from "drizzle-orm";
import { documents, loginEvents, users } from "@/db/schema";
import { bucketSql } from "./buckets";
import { anyWindow, inWindow } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, numOrNull, rows } from "./guard";
import { asOfWindow, pairOf, seriesOf, tsz, twin, type Pair } from "./companies-lib";
import { type ActiveCounts, BACKLOG_EDGES, backlogBuckets, docsSubmittedSql, funnelOf, GEO_LIMIT, PROFILES_SQL, REQUIRED_DOCS, ROLES, STALLED, STALLED_REASONS, VERIFICATION_SQL, type FunnelRow, type GrowthRole } from "./growth-lib";

type Row = Record<string, unknown>;
const P = (f: ResolvedFilters, r: Row | undefined, name: string): Pair => { const p = pairOf(r, name); return f.prev ? p : { cur: p.cur, prev: null }; };
const ids = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
const lit = (xs: readonly string[]) => sql.join(xs.map((x) => sql.raw(`'${x}'`)), sql`, `);
const city = (f: ResolvedFilters, c = "users.city"): SQL => (f.city.length ? sql`and ${sql.raw(c)} in (${ids(f.city)})` : sql``);
const ROLE_LIST = lit(ROLES);

export const SIGNUP_FIELDS = ["business", "driver", "office"] as const;
/** Accounts created per bucket by role (only the city filter applies). */
export const signupSeries = (f: ResolvedFilters) => seriesOf(f, [...SIGNUP_FIELDS], (w) => sql`
  select ${bucketSql(users.createdAt, f.bucket)} as t, ${sql.join(ROLES.map((r) => sql`count(*) filter (where users.role = ${sql.raw(`'${r}'`)})::int as ${sql.raw(r)}`), sql`, `)}
  from users where users.role in (${ROLE_LIST}) and ${inWindow(users.createdAt, w)} ${city(f)} group by 1`);

/** Signups by role, by source and by city, this period and the comparison period. */
export async function signupMix(f: ResolvedFilters) {
  const [bySource, byCity] = await Promise.all([
    rows<Row>(sql`select users.source as k, users.role as r, ${twin(f, { n: (w) => sql`count(*) filter (where ${w(users.createdAt)})::int` })} from users
      where users.role in (${ROLE_LIST}) and ${anyWindow(f, users.createdAt)} ${city(f)} group by 1, 2`),
    rows<Row>(sql`select coalesce(users.city, '') as k, users.role as r, count(*)::int as n from users where users.role in (${ROLE_LIST}) and ${inWindow(users.createdAt, f.cur)} ${city(f)} group by 1, 2`),
  ]);
  const role = (r: Row[], key: GrowthRole) => r.filter((x) => x.r === key);
  const roles = Object.fromEntries(ROLES.map((r) => [r, { cur: role(bySource, r).reduce((s, x) => s + num(x.n_c), 0), prev: f.prev ? role(bySource, r).reduce((s, x) => s + num(x.n_p), 0) : null }])) as Record<GrowthRole, Pair>;
  const sources = [...new Set(bySource.map((x) => String(x.k)))].map((k) => ({ key: k, value: bySource.filter((x) => x.k === k).reduce((s, x) => s + num(x.n_c), 0), prev: f.prev ? bySource.filter((x) => x.k === k).reduce((s, x) => s + num(x.n_p), 0) : null })).sort((a, b) => b.value - a.value);
  const cityMap = new Map<string, { key: string; value: number }>();
  for (const x of byCity) { const k = String(x.k); const e = cityMap.get(k) ?? { key: k, value: 0 }; e.value += num(x.n); cityMap.set(k, e); }
  const cities = [...cityMap.values()].sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  return { roles, sources, cities: cities.slice(0, GEO_LIMIT), totalCities: cities.length };
}

/**
 * Verification funnel per role over the accounts created in the period (this and the comparison period): registered → documents submitted → verified, with the rejected / info requested / pending
 * branches. An account that is verified counts as having submitted its documents (accounts created by staff or imported may have none on file), so the steps never contradict each other.
 */
export async function funnels(f: ResolvedFilters): Promise<{ roles: Array<ReturnType<typeof funnelOf>>; rate: Pair; verified: Pair; registered: Pair }> {
  const r = await rows<Row>(sql`
    select x.role, ${twin(f, {
      registered: (w) => sql`count(*) filter (where ${w("x.created_at")})::int`,
      docs: (w) => sql`count(*) filter (where ${w("x.created_at")} and (x.docs_ok or x.vs = 'verified'))::int`,
      verified: (w) => sql`count(*) filter (where ${w("x.created_at")} and x.vs = 'verified')::int`,
      rejected: (w) => sql`count(*) filter (where ${w("x.created_at")} and x.vs = 'rejected')::int`,
      info: (w) => sql`count(*) filter (where ${w("x.created_at")} and x.vs = 'info_requested')::int`,
      pending: (w) => sql`count(*) filter (where ${w("x.created_at")} and x.vs in ('pending', 'expired'))::int`,
    })}
    from (select u.role, u.created_at, ${docsSubmittedSql()} as docs_ok, ${VERIFICATION_SQL} as vs from users u ${PROFILES_SQL}
      where u.role in (${ROLE_LIST}) and ${anyWindow(f, "u.created_at")} ${city(f, "u.city")}) x group by x.role`);
  const row = (role: GrowthRole, which: "c" | "p"): FunnelRow => { const x = r.find((y) => y.role === role); const g = (n: string) => num(x?.[`${n}_${which}`]); return { role, registered: g("registered"), docs: g("docs"), verified: g("verified"), rejected: g("rejected"), info: g("info"), pending: g("pending") }; };
  const cur = ROLES.map((role) => funnelOf(row(role, "c")));
  const sum = (k: "registered" | "verified", which: "c" | "p") => ROLES.reduce((s, role) => s + row(role, which)[k], 0);
  return { roles: cur, rate: { cur: sum("registered", "c") ? sum("verified", "c") / sum("registered", "c") : null, prev: f.prev && sum("registered", "p") ? sum("verified", "p") / sum("registered", "p") : null },
    verified: { cur: sum("verified", "c"), prev: f.prev ? sum("verified", "p") : null }, registered: { cur: sum("registered", "c"), prev: f.prev ? sum("registered", "p") : null } };
}

/** Every verification event in the window, one row per account: businesses and offices when staff verified them (audit log), drivers when their last required document was approved. */
const verCte = (f: ResolvedFilters): SQL => {
  const need = REQUIRED_DOCS.driver;
  return sql`
  vb as (select distinct on (a.entity_id) a.entity_id as eid, a.created_at as at from audit_logs a where a.entity = 'user' and a.action = 'account.verify' and ${anyWindow(f, "a.created_at")} order by a.entity_id, a.created_at),
  ver as (
    select u.id, u.role, u.created_at, vb.at from vb join users u on u.id::text = vb.eid where u.role in ('business', 'office') ${city(f, "u.city")}
    union all
    select u.id, u.role, u.created_at, v.at from (
      select owner_id, max(first_ok) as at from (select owner_id, type, min(reviewed_at) as first_ok from documents where owner_kind = 'driver' and status = 'approved' and type in (${lit(need)}) group by owner_id, type) x
      group by owner_id having count(*) = ${sql.raw(String(need.length))}) v join users u on u.id = v.owner_id where ${anyWindow(f, "v.at")} ${city(f, "u.city")}
  )`;
};
const secs = sql`extract(epoch from (ver.at - ver.created_at))`;
/** Accounts verified in the period and how long it took from signup (median, 90th percentile), per role and overall. */
export async function verification(f: ResolvedFilters) {
  const m = {
    n: (w: (c: string) => SQL) => sql`count(*) filter (where ${w("ver.at")})::int`,
    p50: (w: (c: string) => SQL) => sql`percentile_cont(0.5) within group (order by ${secs}) filter (where ${w("ver.at")})`,
    p90: (w: (c: string) => SQL) => sql`percentile_cont(0.9) within group (order by ${secs}) filter (where ${w("ver.at")})`,
  };
  const [byRole, [all]] = await Promise.all([
    rows<Row>(sql`with ${verCte(f)} select ver.role, ${twin(f, m)} from ver group by ver.role`),
    rows<Row>(sql`with ${verCte(f)} select ${twin(f, m)} from ver`),
  ]);
  return { n: P(f, all, "n"), p50: P(f, all, "p50"), p90: P(f, all, "p90"), byRole: ROLES.map((r) => { const x = byRole.find((y) => y.role === r); return { role: r, n: num(x?.n_c), p50: numOrNull(x?.p50_c), p90: numOrNull(x?.p90_c) }; }) };
}
/** Drivers verified in the period who then accepted a first job, and how long that took. */
export async function driverActivation(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    with ${verCte(f)}
    select ${twin(f, {
      verified: (w) => sql`count(*) filter (where ${w("y.at")})::int`,
      activated: (w) => sql`count(*) filter (where ${w("y.at")} and y.job_at is not null and y.job_at >= y.at)::int`,
      t50: (w) => sql`percentile_cont(0.5) within group (order by extract(epoch from (y.job_at - y.at))) filter (where ${w("y.at")} and y.job_at is not null and y.job_at >= y.at)`,
    })}
    from (select ver.at, (select min(o.accepted_at) from offers o where o.driver_id = ver.id and o.accepted_at is not null) as job_at from ver where ver.role = 'driver') y`);
  return { verified: P(f, r, "verified"), activated: P(f, r, "activated"), firstJob: P(f, r, "t50") };
}
/** Companies that signed up in the period: how many placed a first request and a first completed request, and the median time to each. */
export async function companyActivation(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    select ${twin(f, {
      registered: (w) => sql`count(*) filter (where ${w("x.created_at")})::int`,
      ordered: (w) => sql`count(*) filter (where ${w("x.created_at")} and x.fr is not null)::int`,
      completed: (w) => sql`count(*) filter (where ${w("x.created_at")} and x.fc is not null)::int`,
      t_first: (w) => sql`percentile_cont(0.5) within group (order by extract(epoch from (x.fr - x.created_at))) filter (where ${w("x.created_at")} and x.fr is not null)`,
      t_done: (w) => sql`percentile_cont(0.5) within group (order by extract(epoch from (x.fc - x.fr))) filter (where ${w("x.created_at")} and x.fc is not null)`,
    })}
    from (select u.created_at, (select min(r.created_at) from requests r where r.business_id = u.id and r.status <> 'draft') as fr,
      (select min(r.completed_at) from requests r where r.business_id = u.id and r.status = 'completed') as fc
      from users u where u.role = 'business' and ${anyWindow(f, "u.created_at")} ${city(f, "u.city")}) x`);
  return { registered: P(f, r, "registered"), ordered: P(f, r, "ordered"), completed: P(f, r, "completed"), firstOrder: P(f, r, "t_first"), toComplete: P(f, r, "t_done") };
}

/** Documents submitted and reviewed in the period by type, and the commonest rejection reasons (the reviewer's note, normalised). */
export async function documentStats(f: ResolvedFilters) {
  const [byType, reasons] = await Promise.all([
    rows<Row>(sql`select documents.type as k, ${twin(f, {
      submitted: (w) => sql`count(*) filter (where ${w(documents.createdAt)})::int`,
      approved: (w) => sql`count(*) filter (where documents.status = 'approved' and ${w(documents.reviewedAt)})::int`,
      rejected: (w) => sql`count(*) filter (where documents.status = 'rejected' and ${w(documents.reviewedAt)})::int`,
      info: (w) => sql`count(*) filter (where documents.status = 'info_requested' and ${w(documents.reviewedAt)})::int`,
    })} from documents where ${anyWindow(f, documents.createdAt, documents.reviewedAt)} group by 1 order by 1`),
    rows<Row>(sql`select left(lower(btrim(review_note)), 120) as reason, count(*)::int as n from documents where status = 'rejected' and review_note is not null and btrim(review_note) <> '' and ${inWindow(documents.reviewedAt, f.cur)}
      group by 1 order by n desc, reason limit 8`),
  ]);
  const sum = (n: string, which: "c" | "p") => byType.reduce((s, x) => s + num(x[`${n}_${which}`]), 0);
  const decided = (w: "c" | "p") => sum("approved", w) + sum("rejected", w) + sum("info", w);
  return {
    types: byType.map((x) => ({ key: String(x.k), submitted: num(x.submitted_c), approved: num(x.approved_c), rejected: num(x.rejected_c), info: num(x.info_c), rate: num(x.approved_c) + num(x.rejected_c) + num(x.info_c) > 0 ? num(x.rejected_c) / (num(x.approved_c) + num(x.rejected_c) + num(x.info_c)) : null })),
    rejected: { cur: sum("rejected", "c"), prev: f.prev ? sum("rejected", "p") : null } as Pair, decided: { cur: decided("c"), prev: f.prev ? decided("p") : null } as Pair,
    reasons: reasons.map((x) => ({ reason: String(x.reason), n: num(x.n) })),
  };
}

/** Sign-in attempts: by device / client, by method and the failure reasons; this period and the comparison period. */
export async function loginFacts(f: ResolvedFilters) {
  const r = await rows<Row>(sql`
    select coalesce(login_events.client, '') as client, login_events.method as method, login_events.success as ok, coalesce(login_events.failure_reason, '') as reason,
      ${twin(f, { n: (w) => sql`count(*) filter (where ${w(loginEvents.createdAt)})::int` })}
    from login_events where ${anyWindow(f, loginEvents.createdAt)} group by 1, 2, 3, 4`);
  const tot = (pred: (x: Row) => boolean, w: "c" | "p") => r.filter(pred).reduce((s, x) => s + num(x[`n_${w}`]), 0);
  const group = (key: "client" | "method", ok: boolean) => [...new Set(r.filter((x) => x.ok === ok).map((x) => String(x[key])))].map((k) => ({ key: k, value: tot((x) => x.ok === ok && x[key] === k, "c") })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const all = (w: "c" | "p") => tot(() => true, w), bad = (w: "c" | "p") => tot((x) => x.ok === false, w);
  return {
    clients: group("client", true), methods: group("method", true),
    failures: [...new Set(r.filter((x) => x.ok === false).map((x) => String(x.reason)))].map((k) => ({ key: k || "unknown", value: tot((x) => x.ok === false && x.reason === k, "c") })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value),
    attempts: { cur: all("c"), prev: f.prev ? all("p") : null } as Pair, failed: { cur: bad("c"), prev: f.prev ? bad("p") : null } as Pair,
  };
}

/** Accounts active in the 24 hours, 7 days and 30 days before `end`: signed in (successful login event) or seen (last request time, only exact when `end` is now). Per role. */
export async function activeUsers(end: Date): Promise<ActiveCounts> {
  const d = (n: number) => tsz(new Date(end.getTime() - n * 864e5)), e = tsz(end);
  const r = await rows<Row>(sql`
    select x.role, count(*) filter (where x.in1)::int as dau, count(*) filter (where x.in7)::int as wau, count(*)::int as mau from (
      select u.role,
        (coalesce(a.in1, false) or (u.last_seen_at >= ${d(1)} and u.last_seen_at < ${e})) as in1, (coalesce(a.in7, false) or (u.last_seen_at >= ${d(7)} and u.last_seen_at < ${e})) as in7
      from users u left join (select user_id, bool_or(created_at >= ${d(1)}) as in1, bool_or(created_at >= ${d(7)}) as in7 from login_events
        where success and user_id is not null and created_at >= ${d(30)} and created_at < ${e} group by user_id) a on a.user_id = u.id
      where u.role in (${ROLE_LIST}) and (a.user_id is not null or (u.last_seen_at >= ${d(30)} and u.last_seen_at < ${e}))) x group by x.role`);
  const by = (role: GrowthRole) => { const x = r.find((y) => y.role === role); return { dau: num(x?.dau), wau: num(x?.wau), mau: num(x?.mau) }; };
  const roles = Object.fromEntries(ROLES.map((role) => [role, by(role)])) as Record<GrowthRole, { dau: number; wau: number; mau: number }>;
  const total = (k: "dau" | "wau" | "mau") => ROLES.reduce((s, role) => s + roles[role][k], 0);
  return { roles, dau: total("dau"), wau: total("wau"), mau: total("mau") };
}
export const activeAtEnd = (f: ResolvedFilters) => ({ cur: asOfWindow(f.cur), prev: f.prev ? asOfWindow(f.prev) : null });

export const ACTIVE_FIELDS = ["business", "driver", "office"] as const;
/** Distinct accounts that signed in per bucket, by role. */
export const loginSeries = (f: ResolvedFilters) => seriesOf(f, [...ACTIVE_FIELDS], (w) => sql`
  select ${bucketSql(loginEvents.createdAt, f.bucket)} as t, ${sql.join(ROLES.map((r) => sql`count(distinct login_events.user_id) filter (where u.role = ${sql.raw(`'${r}'`)})::int as ${sql.raw(r)}`), sql`, `)}
  from login_events join users u on u.id = login_events.user_id where login_events.success and ${inWindow(loginEvents.createdAt, w)} group by 1`);

const WAITING_STATES = sql`('pending', 'info_requested', 'expired')`;
/** Accounts waiting for staff review (a document submitted or under review), by age of the oldest waiting document, as of now. */
export async function backlog(f: ResolvedFilters) {
  const [list, [agg]] = await Promise.all([
    rows<Row>(sql`select x.role, width_bucket(x.age, array[${sql.join(BACKLOG_EDGES.map((n) => sql.raw(String(n))), sql`, `)}]::float8[]) as b, count(*)::int as n from (
      select u.role, extract(epoch from (now() - w.since)) / 86400.0 as age from users u ${PROFILES_SQL}
      join (select owner_id, min(created_at) as since from documents where status in ('submitted', 'under_review') group by owner_id) w on w.owner_id = u.id
      where u.role in (${ROLE_LIST}) and ${VERIFICATION_SQL} in ${WAITING_STATES} ${city(f, "u.city")}) x group by 1, 2`),
    rows<Row>(sql`select count(*)::int as n, coalesce(max(x.age), 0)::float8 as oldest, percentile_cont(0.5) within group (order by x.age) as p50 from (
      select extract(epoch from (now() - w.since)) / 86400.0 as age from users u ${PROFILES_SQL}
      join (select owner_id, min(created_at) as since from documents where status in ('submitted', 'under_review') group by owner_id) w on w.owner_id = u.id
      where u.role in (${ROLE_LIST}) and ${VERIFICATION_SQL} in ${WAITING_STATES} ${city(f, "u.city")}) x`),
  ]);
  const buckets = backlogBuckets(list.map((x) => ({ b: num(x.b), n: num(x.n) })));
  const roles = ROLES.map((role) => ({ key: role, value: list.filter((x) => x.role === role).reduce((s, x) => s + num(x.n), 0) }));
  return { total: num(agg?.n), oldestDays: num(agg?.oldest), medianAgeSeconds: agg?.p50 == null ? null : num(agg.p50) * 86400, buckets, roles };
}

/**
 * Why an onboarding is stuck (SQL over `u` + profiles; null = not stuck): no document yet · every document rejected and nothing re-submitted · waiting on information the user owes ·
 * a verified company with no request · a verified driver with no job. Waiting counts from the last review (or signup) and needs `blockedDays` / `activationDays`.
 */
export const STALLED_SQL = (): SQL => {
  const last = sql`(select max(d.reviewed_at) from documents d where d.owner_id = u.id)`, waiting = sql`exists (select 1 from documents d where d.owner_id = u.id and d.status in ('submitted', 'under_review'))`;
  const b = sql.raw(String(STALLED.blockedDays)), a = sql.raw(String(STALLED.activationDays));
  return sql`case
    when ${VERIFICATION_SQL} = 'pending' and not exists (select 1 from documents d where d.owner_id = u.id) and u.created_at < now() - interval '${b} days' then 'no_documents'
    when ${VERIFICATION_SQL} = 'rejected' and not ${waiting} and coalesce(${last}, u.created_at) < now() - interval '${b} days' then 'docs_rejected'
    when ${VERIFICATION_SQL} = 'info_requested' and not ${waiting} and coalesce(${last}, u.created_at) < now() - interval '${b} days' then 'info_requested'
    when u.role = 'business' and ${VERIFICATION_SQL} = 'verified' and u.created_at < now() - interval '${a} days' and not exists (select 1 from requests r where r.business_id = u.id and r.status <> 'draft') then 'not_ordered'
    when u.role = 'driver' and ${VERIFICATION_SQL} = 'verified' and u.created_at < now() - interval '${a} days' and not exists (select 1 from offers o where o.driver_id = u.id and o.accepted_at is not null) then 'no_job'
  end`;
};
export async function stalledCounts(f: ResolvedFilters) {
  const r = await rows<Row>(sql`select reason, count(*)::int as n from (select ${STALLED_SQL()} as reason from users u ${PROFILES_SQL} where u.role in (${ROLE_LIST}) and u.status = 'active' ${city(f, "u.city")}) x
    where reason is not null group by reason`);
  const reasons = STALLED_REASONS.map((key) => ({ key, value: num(r.find((x) => x.reason === key)?.n) }));
  return { total: reasons.reduce((s, x) => s + x.value, 0), reasons };
}
