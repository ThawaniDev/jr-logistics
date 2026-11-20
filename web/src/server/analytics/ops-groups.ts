import { sql, type SQL } from "drizzle-orm";
import { offers, requests } from "@/db/schema";
import { anyWindow, inWindow, NOT_DRAFT, scope, twinRead, twinSelect } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { rows } from "./guard";
import { safeDiv } from "./kpi";
import { COUNTED, DELAY_S, DRIVEN, dueJob, FILLED, G_FILL, lateJob, onTimeJob, RESOLVED, SLOTS } from "./ops-sql";
import { asNum, round, type Row } from "./ops-util";
import { bottomN, topN } from "./stats";

const OPS_DIMS = ["city", "service", "vehicle"] as const;
type Dim3 = (typeof OPS_DIMS)[number];
const BASE_COLS = sql`requests.delivery_city as city, requests.service as service, coalesce(requests.vehicle_type, '') as vehicle`;
const unionOf = (select: (dim: Dim3) => SQL) => sql.join(OPS_DIMS.map((d) => select(d)), sql` union all `);

/** One line of "performance by …": demand, staffing, punctuality and offer acceptance of one city / service / vehicle type / company. */
export interface OpsRow {
  key: string; requests: number; prevRequests: number | null; slots: number; filled: number; fillRate: number | null; prevFillRate: number | null; p50Fill: number | null;
  cancelled: number; expired: number; due: number; onTime: number; onTimeRate: number | null; offered: number; accepted: number; acceptRate: number | null;
}
const blank = (key: string): OpsRow => ({ key, requests: 0, prevRequests: null, slots: 0, filled: 0, fillRate: null, prevFillRate: null, p50Fill: null, cancelled: 0, expired: 0, due: 0, onTime: 0, onTimeRate: null, offered: 0, accepted: 0, acceptRate: null });

/** Requests created per dimension value: how many, driver slots filled ÷ asked (resolved requests), median time to fill, cancelled, expired. */
const demandRows = (f: ResolvedFilters) => rows<Row>(sql`
  with base as (select ${BASE_COLS}, requests.created_at as created_at, requests.status as status, (${DRIVEN} and ${RESOLVED}) as in_cohort, ${SLOTS} as slots, ${FILLED} as filled,
      (case when ${DRIVEN} and requests.published_at is not null then ${G_FILL} end) as g_fill
    from requests where ${scope(f, "requests")} and ${NOT_DRAFT} and ${anyWindow(f, requests.createdAt)})
  select * from (${unionOf((d) => sql`select ${sql.raw(`'${d}'`)} as dim, ${sql.raw(d)} as k, ${twinSelect(f, {
    req: (w) => sql`count(*) filter (where ${w("created_at")})::int`,
    slots: (w) => sql`coalesce(sum(slots) filter (where ${w("created_at")} and in_cohort), 0)::float8`, filled: (w) => sql`coalesce(sum(filled) filter (where ${w("created_at")} and in_cohort), 0)::float8`,
    cancel: (w) => sql`count(*) filter (where ${w("created_at")} and status = 'cancelled')::int`, expire: (w) => sql`count(*) filter (where ${w("created_at")} and status = 'expired')::int`,
    fill_p50: (w) => sql`percentile_cont(0.5) within group (order by g_fill) filter (where ${w("created_at")})`,
  })} from base group by ${sql.raw(d)}`)}) x`);

/** Jobs due to start in the period per dimension value: due and on time under the start-SLA rule. */
const execRows = (f: ResolvedFilters, grace: number) => rows<Row>(sql`
  with base as (select ${BASE_COLS}, requests.starts_at as starts_at, ${dueJob(grace)} as due, ${onTimeJob(grace)} as on_time
    from offers join requests on requests.id = offers.request_id where ${scope(f, "offers")} and ${DRIVEN} and ${COUNTED} and ${inWindow(requests.startsAt, f.cur)})
  select * from (${unionOf((d) => sql`select ${sql.raw(`'${d}'`)} as dim, ${sql.raw(d)} as k, count(*) filter (where due)::int as due, count(*) filter (where on_time)::int as on_time from base group by ${sql.raw(d)}`)}) x`);

/** Offers sent in the period per dimension value: sent and accepted. */
const offerRows = (f: ResolvedFilters) => rows<Row>(sql`
  with base as (select ${BASE_COLS}, offers.accepted_at is not null as accepted from offers join requests on requests.id = offers.request_id
    where ${scope(f, "offers")} and ${DRIVEN} and ${inWindow(offers.createdAt, f.cur)})
  select * from (${unionOf((d) => sql`select ${sql.raw(`'${d}'`)} as dim, ${sql.raw(d)} as k, count(*)::int as offered, count(*) filter (where accepted)::int as accepted from base group by ${sql.raw(d)}`)}) x`);

export async function opsBreakdowns(f: ResolvedFilters, grace: number): Promise<Record<Dim3, OpsRow[]>> {
  const [dm, ex, of] = await Promise.all([demandRows(f), execRows(f, grace), offerRows(f)]);
  const out: Record<Dim3, Map<string, OpsRow>> = { city: new Map(), service: new Map(), vehicle: new Map() };
  const get = (r: Row) => { const m = out[r.dim as Dim3]; const k = String(r.k ?? ""); let x = m.get(k); if (!x) { x = blank(k); m.set(k, x); } return x; };
  for (const r of dm) {
    const x = get(r), req = twinRead(r, "req"), sl = twinRead(r, "slots"), fl = twinRead(r, "filled");
    x.requests = req.cur ?? 0; x.prevRequests = f.prev ? req.prev ?? 0 : null; x.slots = sl.cur ?? 0; x.filled = fl.cur ?? 0;
    x.fillRate = safeDiv(fl.cur, sl.cur); x.prevFillRate = safeDiv(fl.prev, sl.prev); x.p50Fill = twinRead(r, "fill_p50").cur;
    x.cancelled = twinRead(r, "cancel").cur ?? 0; x.expired = twinRead(r, "expire").cur ?? 0;
  }
  for (const r of ex) { const x = get(r); x.due = Number(r.due ?? 0); x.onTime = Number(r.on_time ?? 0); x.onTimeRate = safeDiv(x.onTime, x.due); }
  for (const r of of) { const x = get(r); x.offered = Number(r.offered ?? 0); x.accepted = Number(r.accepted ?? 0); x.acceptRate = safeDiv(x.accepted, x.offered); }
  const sorted = (m: Map<string, OpsRow>) => [...m.values()].filter((x) => x.requests || x.due || x.offered).sort((a, b) => b.requests - a.requests || b.offered - a.offered || a.key.localeCompare(b.key));
  return { city: sorted(out.city), service: sorted(out.service), vehicle: sorted(out.vehicle) };
}

export interface CompanyOps extends Omit<OpsRow, "due" | "onTime" | "onTimeRate" | "offered" | "accepted" | "acceptRate"> { id: string; name: string }
/** The 200 busiest companies of the period with the same staffing numbers as the breakdowns (cancelled counts only the ones the company cancelled itself). */
export async function companyOps(f: ResolvedFilters): Promise<CompanyOps[]> {
  const r = await rows<Row>(sql`
    select requests.business_id as id, coalesce(bp.company_name, u.name) as name, ${twinSelect(f, {
      req: (x) => sql`count(*) filter (where ${x("requests.created_at")})::int`,
      slots: (x) => sql`coalesce(sum(${SLOTS}) filter (where ${x("requests.created_at")} and ${DRIVEN} and ${RESOLVED}), 0)::float8`,
      filled: (x) => sql`coalesce(sum(${FILLED}) filter (where ${x("requests.created_at")} and ${DRIVEN} and ${RESOLVED}), 0)::float8`,
      cancel: (x) => sql`count(*) filter (where ${x("requests.created_at")} and requests.status = 'cancelled' and requests.cancelled_by = requests.business_id)::int`,
      expire: (x) => sql`count(*) filter (where ${x("requests.created_at")} and requests.status = 'expired')::int`,
      fill_p50: (x) => sql`percentile_cont(0.5) within group (order by ${G_FILL}) filter (where ${x("requests.created_at")} and ${DRIVEN} and requests.published_at is not null)`,
    })}
    from requests join users u on u.id = requests.business_id left join business_profiles bp on bp.user_id = u.id
    where ${scope(f, "requests")} and ${NOT_DRAFT} and ${anyWindow(f, requests.createdAt)}
    group by requests.business_id, bp.company_name, u.name
    having count(*) filter (where ${inWindow(requests.createdAt, f.cur)}) > 0
    order by req_c desc, 1 limit 200`);
  return r.map((x) => {
    const sl = twinRead(x, "slots"), fl = twinRead(x, "filled"), rq = twinRead(x, "req");
    return { id: String(x.id), key: String(x.id), name: String(x.name ?? ""), requests: rq.cur ?? 0, prevRequests: f.prev ? rq.prev ?? 0 : null, slots: sl.cur ?? 0, filled: fl.cur ?? 0, fillRate: safeDiv(fl.cur, sl.cur), prevFillRate: safeDiv(fl.prev, sl.prev), p50Fill: twinRead(x, "fill_p50").cur, cancelled: twinRead(x, "cancel").cur ?? 0, expired: twinRead(x, "expire").cur ?? 0 };
  });
}

export interface DriverLate { id: string; name: string; jobs: number; late: number; noShows: number; arrived: number; avgDelayS: number | null }
/** Drivers' punctuality over the jobs due in the period (the 200 with the most jobs). */
export async function driverLateness(f: ResolvedFilters, grace: number): Promise<DriverLate[]> {
  const r = await rows<Row>(sql`
    select offers.driver_id as id, u.name as name, count(*) filter (where ${dueJob(grace)})::int as jobs, count(*) filter (where ${lateJob(grace)})::int as late,
      count(*) filter (where ${COUNTED} and offers.status = 'no_show')::int as no_shows, count(*) filter (where ${COUNTED} and offers.arrived_at is not null)::int as arrived,
      avg(greatest(${DELAY_S}, 0)) filter (where ${COUNTED} and offers.arrived_at is not null)::float8 as avg_delay
    from offers join requests on requests.id = offers.request_id join users u on u.id = offers.driver_id
    where ${scope(f, "offers")} and ${DRIVEN} and ${inWindow(requests.startsAt, f.cur)} group by offers.driver_id, u.name
    having count(*) filter (where ${dueJob(grace)}) > 0 order by jobs desc, 1 limit 200`);
  return r.map((x) => ({ id: String(x.id), name: String(x.name ?? ""), jobs: Number(x.jobs ?? 0), late: Number(x.late ?? 0), noShows: Number(x.no_shows ?? 0), arrived: Number(x.arrived ?? 0), avgDelayS: asNum(x.avg_delay) }));
}

/** Minimum number of requests / jobs before a company, city or driver is ranked as slow or late (a single odd job must not decide a ranking). */
export const MIN_SAMPLE = 3;
export interface Rank { key: string; name: string; value: number; n: number }
/** Slowest-to-fill companies and cities (median time to fill, longest first) and the latest-starting drivers (average minutes late, among jobs where the driver arrived). */
export function rankingsOf(cities: OpsRow[], companies: CompanyOps[], drivers: DriverLate[], n = 8) {
  const slow = <T extends { requests: number; p50Fill: number | null }>(rs: T[], label: (r: T) => { key: string; name: string }): Rank[] =>
    topN(rs.filter((r) => r.requests >= MIN_SAMPLE), (r) => r.p50Fill, n).map((r) => ({ ...label(r), value: round(r.p50Fill!, 0)!, n: r.requests }));
  return {
    slowCompanies: slow(companies, (c) => ({ key: c.id, name: c.name })),
    slowCities: slow(cities, (c) => ({ key: c.key, name: c.key })),
    lateDrivers: topN(drivers.filter((d) => d.arrived >= MIN_SAMPLE), (d) => d.avgDelayS, n).map((d) => ({ key: d.id, name: d.name, value: round(d.avgDelayS!, 0)!, n: d.arrived })),
    fastCities: bottomN(cities.filter((c) => c.requests >= MIN_SAMPLE), (c) => c.p50Fill, 3).map((c) => ({ key: c.key, name: c.key, value: round(c.p50Fill!, 0)!, n: c.requests })),
  };
}
