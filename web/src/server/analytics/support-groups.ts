import { sql } from "drizzle-orm";
import { complaints, ratings, requests, tickets } from "@/db/schema";
import { riyadhDow, riyadhHour } from "./buckets";
import { anyWindow, inWindow, NOT_DRAFT, scope, twinRead, twinSelect } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { withShare } from "./stats";
import { LOW_STARS, MIN_ORDERS_FOR_RATE, MIN_RATINGS_FOR_RANK } from "./support-sla";
import { complaintScope, COMPLAINT_FROM, FRT, RATING_FROM, secsBetween, TICKET_FROM, WHO, WHO_JOIN } from "./support-sql";

type Row = Record<string, unknown>;
export interface GroupRow { key: string; value: number; prev: number | null; share: number | null }

const toRows = (f: ResolvedFilters, list: Row[], dim: string): GroupRow[] => withShare(
  list.filter((r) => r.dim === dim).map((r) => ({ key: String(r.k ?? ""), value: twinRead(r, "n").cur ?? 0, prev: f.prev ? twinRead(r, "n").prev ?? 0 : null })).filter((r) => r.value > 0 || (r.prev ?? 0) > 0)
    .sort((a, b) => b.value - a.value || (b.prev ?? 0) - (a.prev ?? 0) || a.key.localeCompare(b.key)), (r) => r.value);

/** Tickets opened by priority, by who opened them (company / driver / office) and by category, current period against the comparison period. */
export async function ticketBreakdowns(f: ResolvedFilters) {
  const one = (dim: string, col: string) => sql`select ${sql.raw(`'${dim}'`)} as dim, ${sql.raw(col)} as k, ${twinSelect(f, { n: (w) => sql`count(*) filter (where ${w("created_at")})::int` })} from base group by ${sql.raw(col)}`;
  const list = await rows<Row>(sql`
    with base as (select tickets.priority as priority, opener.role as role, tickets.category as category, tickets.created_at as created_at
      ${TICKET_FROM} where ${scope(f, "tickets")} and ${anyWindow(f, tickets.createdAt)})
    select * from (${one("priority", "priority")} union all ${one("role", "role")} union all ${one("category", "category")}) x`);
  return { priority: toRows(f, list, "priority"), role: toRows(f, list, "role"), category: toRows(f, list, "category") };
}

/** Complaints by category (against the comparison period) and the state of the complaints filed in the period (their outcome so far). */
export async function complaintBreakdowns(f: ResolvedFilters) {
  const one = (dim: string, col: string) => sql`select ${sql.raw(`'${dim}'`)} as dim, ${sql.raw(col)} as k, ${twinSelect(f, { n: (w) => sql`count(*) filter (where ${w("created_at")})::int` })} from base group by ${sql.raw(col)}`;
  const list = await rows<Row>(sql`
    with base as (select complaints.category as category, complaints.status as status, complaints.created_at as created_at
      ${COMPLAINT_FROM} where ${complaintScope(f)} and ${anyWindow(f, complaints.createdAt)})
    select * from (${one("category", "category")} union all ${one("status", "status")}) x`);
  return { category: toRows(f, list, "category"), outcome: toRows(f, list, "status") };
}

/** Tickets opened in the period by Riyadh weekday (0 = Sunday) × hour: when the desk needs staff. */
export async function ticketHeatmap(f: ResolvedFilters) {
  const r = await rows<Row>(sql`
    select ${riyadhDow(tickets.createdAt)} as dow, ${riyadhHour(tickets.createdAt)} as hr, count(*)::int as n
    ${TICKET_FROM} where ${scope(f, "tickets")} and ${inWindow(tickets.createdAt, f.cur)} group by 1, 2`);
  const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const x of r) { const d = num(x.dow), h = num(x.hr); if (d >= 0 && d < 7 && h >= 0 && h < 24) cells[d][h] = num(x.n); }
  return { cells, total: cells.flat().reduce((s, n) => s + n, 0) };
}

export interface WorkloadRow { id: string; name: string; assigned: number; open: number; resolved: number; frP50: number | null; resP50: number | null }
/** Per assignee: tickets assigned and opened in the period, open right now, resolved in the period, and the median first response / resolution time of those. */
export async function workload(f: ResolvedFilters): Promise<WorkloadRow[]> {
  const created = inWindow("t.created_at", f.cur), resolved = inWindow("t.resolved_at", f.cur);
  const list = await rows<Row>(sql`
    with t as (select tickets.id, tickets.created_at, tickets.resolved_at, tickets.status, tickets.assigned_to, ${FRT} as frt
      ${TICKET_FROM} where ${scope(f, "tickets")} and tickets.assigned_to is not null and (${inWindow(tickets.createdAt, f.cur)} or ${inWindow(tickets.resolvedAt, f.cur)} or tickets.status <> 'resolved'))
    select t.assigned_to as id, u.name, count(*) filter (where ${created})::int as assigned, count(*) filter (where t.status <> 'resolved')::int as open_now,
      count(*) filter (where t.status = 'resolved' and ${resolved})::int as resolved,
      percentile_cont(0.5) within group (order by ${secsBetween("t.created_at", "t.frt")}) filter (where ${created} and t.frt is not null) as fr_p50,
      percentile_cont(0.5) within group (order by ${secsBetween("t.created_at", "t.resolved_at")}) filter (where t.status = 'resolved' and ${resolved}) as rs_p50
    from t join users u on u.id = t.assigned_to group by t.assigned_to, u.name order by open_now desc, resolved desc, u.name limit 15`);
  const p = (v: unknown) => (v == null ? null : Number(v));
  return list.map((x) => ({ id: String(x.id), name: String(x.name), assigned: num(x.assigned), open: num(x.open_now), resolved: num(x.resolved), frP50: p(x.fr_p50), resP50: p(x.rs_p50) }));
}

export interface RepeatRow { id: string; name: string; role: string; tickets: number; urgent: number }
/** People (or companies / offices) who opened two or more tickets in the period. */
export async function repeatRequesters(f: ResolvedFilters): Promise<RepeatRow[]> {
  const list = await rows<Row>(sql`
    select tickets.opened_by as id, ${WHO} as name, opener.role as role, count(*)::int as n, count(*) filter (where tickets.priority = 'urgent')::int as urgent, max(tickets.created_at) as last_at
    ${TICKET_FROM} ${WHO_JOIN} where ${scope(f, "tickets")} and ${inWindow(tickets.createdAt, f.cur)}
    group by tickets.opened_by, bp.company_name, op.office_name, opener.name, opener.role having count(*) >= 2 order by n desc, last_at desc, tickets.opened_by limit 10`);
  return list.map((x) => ({ id: String(x.id), name: String(x.name ?? ""), role: String(x.role), tickets: num(x.n), urgent: num(x.urgent) }));
}

export interface PerOrderRow { id: string; name: string; issues: number; orders: number; per100: number }
const perOrder = (list: Row[]): PerOrderRow[] => list.map((x) => ({ id: String(x.id), name: String(x.name ?? ""), issues: num(x.issues), orders: num(x.orders), per100: Math.round((num(x.issues) / Math.max(1, num(x.orders))) * 1e4) / 100 }));

/** Companies with the most tickets + complaints per 100 orders in the period (only those with at least `MIN_ORDERS_FOR_RATE` orders, so one bad day cannot top the list). */
export async function companiesPerOrder(f: ResolvedFilters): Promise<PerOrderRow[]> {
  const list = await rows<Row>(sql`
    with iss as (
      select coalesce(requests.business_id, case when opener.role = 'business' then tickets.opened_by end) as biz
      ${TICKET_FROM} where ${scope(f, "tickets")} and ${inWindow(tickets.createdAt, f.cur)}
      union all
      select coalesce(requests.business_id, case when complaints.filed_by_role = 'business' then complaints.filed_by end)
      ${COMPLAINT_FROM} where ${complaintScope(f)} and ${inWindow(complaints.createdAt, f.cur)}
    ), ord as (
      select requests.business_id as biz, count(*)::int as orders from requests where ${scope(f, "requests")} and ${NOT_DRAFT} and ${inWindow(requests.createdAt, f.cur)} group by 1
    )
    select ord.biz as id, coalesce(bp.company_name, u.name) as name, ord.orders, i.n as issues
    from ord join (select biz, count(*)::int as n from iss where biz is not null group by biz) i on i.biz = ord.biz join users u on u.id = ord.biz left join business_profiles bp on bp.user_id = u.id
    where ord.orders >= ${MIN_ORDERS_FOR_RATE} order by i.n::float8 / ord.orders desc, i.n desc, ord.biz limit 8`);
  return perOrder(list);
}

/** Drivers with the most tickets + complaints per 100 jobs accepted in the period (same guard). A job counts once it was accepted. */
export async function driversPerOrder(f: ResolvedFilters): Promise<PerOrderRow[]> {
  const list = await rows<Row>(sql`
    with iss as (
      select coalesce(offers.driver_id, case when opener.role = 'driver' then tickets.opened_by end) as drv
      from tickets left join requests on requests.id = tickets.request_id left join offers on offers.id = tickets.offer_id join users opener on opener.id = tickets.opened_by
      where ${scope(f, "tickets")} and ${inWindow(tickets.createdAt, f.cur)}
      union all
      select coalesce(offers.driver_id, case when complaints.filed_by_role = 'driver' then complaints.filed_by end)
      ${COMPLAINT_FROM} where ${complaintScope(f)} and ${inWindow(complaints.createdAt, f.cur)}
    ), ord as (
      select offers.driver_id as drv, count(*)::int as orders from offers join requests on requests.id = offers.request_id
      where ${scope(f, "offers")} and offers.accepted_at is not null and ${inWindow("offers.accepted_at", f.cur)} group by 1
    )
    select ord.drv as id, u.name, ord.orders, i.n as issues
    from ord join (select drv, count(*)::int as n from iss where drv is not null group by drv) i on i.drv = ord.drv join users u on u.id = ord.drv
    where ord.orders >= ${MIN_ORDERS_FOR_RATE} order by i.n::float8 / ord.orders desc, i.n desc, ord.drv limit 8`);
  return perOrder(list);
}

export interface LowRated { id: string; name: string; n: number; avg: number; low: number; comment: string | null }
/** The lowest-rated drivers and companies of the period (at least `MIN_RATINGS_FOR_RANK` ratings each), with the latest low-star comment. */
export async function lowestRated(f: ResolvedFilters): Promise<{ drivers: LowRated[]; companies: LowRated[] }> {
  const list = await rows<Row>(sql`
    select ratings.ratee_id as id, ratee.role as role, coalesce(rbp.company_name, ratee.name) as name, count(*)::int as n, avg(ratings.stars)::float8 as avg, count(*) filter (where ratings.stars <= ${LOW_STARS})::int as low,
      (array_agg(ratings.comment order by ratings.created_at desc) filter (where ratings.stars <= ${LOW_STARS} and nullif(btrim(ratings.comment), '') is not null))[1] as comment
    ${RATING_FROM} where ${scope(f, "offers")} and ${inWindow(ratings.createdAt, f.cur)} and ratee.role in ('driver', 'business')
    group by ratings.ratee_id, ratee.role, rbp.company_name, ratee.name having count(*) >= ${MIN_RATINGS_FOR_RANK} order by avg asc, n desc, ratings.ratee_id limit 40`);
  const map = (role: string) => list.filter((x) => x.role === role).slice(0, 8).map((x) => ({ id: String(x.id), name: String(x.name ?? ""), n: num(x.n), avg: Math.round(num(x.avg) * 100) / 100, low: num(x.low), comment: x.comment ? String(x.comment).slice(0, 240) : null }));
  return { drivers: map("driver"), companies: map("business") };
}

