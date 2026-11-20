import { sql } from "drizzle-orm";
import { complaints, offers, ratings, requests, tickets } from "@/db/schema";
import { anyWindow, inWindow, NOT_DRAFT, scope, twinRead, twinSelect } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, numOrNull, rows } from "./guard";
import { isoValue } from "./registry";
import { histogramFromRow, histogramSelect } from "./stats";
import type { SupportFacts } from "./support-kpis";
import { AGING_EDGES, LOW_STARS, RESOLUTION_EDGES, slaState, slaLabel } from "./support-sla";
import { complaintScope, COMPLAINT_FROM, FRT, heldStates, RATING_FROM, secsBetween, slaSql, TICKET_FROM, WHO, WHO_JOIN } from "./support-sql";

type Row = Record<string, unknown>;
type Pair = { cur: number | null; prev: number | null };
const pair = (r: Row | undefined, name: string): Pair => twinRead(r, name);
const z = (p: Pair): Pair => ({ cur: p.cur ?? 0, prev: p.prev });
/** The later of the two window ends: tickets created after it cannot matter to any backlog figure. */
const lastEnd = (f: ResolvedFilters) => (f.prev && f.prev.end > f.cur.end ? f.prev.end : f.cur.end).toISOString();

/**
 * Tickets in one pass over a CTE of the tickets that were created OR resolved in either window: volume, outcomes, speed percentiles, SLA numerators and
 * denominators, breaches, reopens, and the resolution-time histogram of the current period. Time anchors: opened / SLA / first response / reopen = `created_at`;
 * resolved / resolution time = `resolved_at`.
 */
export async function ticketFacts(f: ResolvedFilters) {
  const t = { created: sql`t.created_at`, frt: sql`t.frt`, resolved: sql`t.resolved_at` };
  const s = slaSql(t);
  const fr = sql`extract(epoch from (t.frt - t.created_at))`, rs = sql`extract(epoch from (t.resolved_at - t.created_at))`;
  const isRes = sql`t.status = 'resolved' and t.resolved_at is not null`;
  const [r] = await rows<Row>(sql`
    with t as (
      select tickets.id, tickets.created_at, tickets.resolved_at, tickets.status, tickets.priority, tickets.reopen_count, ${FRT} as frt
      ${TICKET_FROM} where ${scope(f, "tickets")} and ${anyWindow(f, tickets.createdAt, tickets.resolvedAt)}
    )
    select ${twinSelect(f, {
      opened: (w) => sql`count(*) filter (where ${w(t.created)})::int`,
      resolved: (w) => sql`count(*) filter (where ${isRes} and ${w(t.resolved)})::int`,
      urgent: (w) => sql`count(*) filter (where ${w(t.created)} and t.priority = 'urgent')::int`,
      reopened: (w) => sql`count(*) filter (where ${w(t.created)} and t.reopen_count > 0)::int`,
      ever_resolved: (w) => sql`count(*) filter (where ${w(t.created)} and (t.status = 'resolved' or t.reopen_count > 0))::int`,
      fr_p50: (w) => sql`percentile_cont(0.5) within group (order by ${fr}) filter (where ${w(t.created)} and t.frt is not null)`,
      fr_p90: (w) => sql`percentile_cont(0.9) within group (order by ${fr}) filter (where ${w(t.created)} and t.frt is not null)`,
      rs_p50: (w) => sql`percentile_cont(0.5) within group (order by ${rs}) filter (where ${isRes} and ${w(t.resolved)})`,
      rs_p90: (w) => sql`percentile_cont(0.9) within group (order by ${rs}) filter (where ${isRes} and ${w(t.resolved)})`,
      resp_due: (w) => sql`count(*) filter (where ${w(t.created)} and ${s.respDue})::int`,
      resp_met: (w) => sql`count(*) filter (where ${w(t.created)} and ${s.respMet})::int`,
      res_due: (w) => sql`count(*) filter (where ${w(t.created)} and ${s.resDue})::int`,
      res_met: (w) => sql`count(*) filter (where ${w(t.created)} and ${s.resMet})::int`,
      breaches: (w) => sql`count(*) filter (where ${w(t.created)} and ${s.breached})::int`,
    })},
    ${histogramSelect(rs, RESOLUTION_EDGES, "h", sql`${isRes} and ${inWindow("t.resolved_at", f.cur)}`)}
    from t`);
  const p = (name: string) => pair(r, name);
  return {
    opened: p("opened"), resolved: p("resolved"), urgent: p("urgent"), reopened: p("reopened"), everResolved: p("ever_resolved"),
    frP50: p("fr_p50"), frP90: p("fr_p90"), resP50: p("rs_p50"), resP90: p("rs_p90"),
    respDue: p("resp_due"), respMet: p("resp_met"), resDue: p("res_due"), resMet: p("res_met"), breaches: p("breaches"),
    resolutionHistogram: histogramFromRow(r ?? {}, RESOLUTION_EDGES), resolvedN: p("resolved").cur ?? 0,
  };
}

/** Backlog at the end of each period (created before it, not resolved by then), tickets nobody owns right now, and the age buckets of what is open right now. */
export async function backlogFacts(f: ResolvedFilters) {
  const open = (end: Date) => sql`tickets.created_at < ${end.toISOString()}::timestamptz and (tickets.resolved_at is null or tickets.resolved_at >= ${end.toISOString()}::timestamptz)`;
  const age = sql`extract(epoch from (now() - tickets.created_at))`;
  const [r] = await rows<Row>(sql`
    select count(*) filter (where ${open(f.cur.end)})::int as backlog_c, ${f.prev ? sql`count(*) filter (where ${open(f.prev.end)})::int` : sql`null::int`} as backlog_p,
      count(*) filter (where tickets.status <> 'resolved' and tickets.assigned_to is null)::int as unassigned,
      count(*) filter (where tickets.status <> 'resolved')::int as open_now,
      ${histogramSelect(age, AGING_EDGES, "a", sql`tickets.status <> 'resolved'`)}
    ${TICKET_FROM} where ${scope(f, "tickets")} and tickets.created_at < ${lastEnd(f)}::timestamptz`);
  return { backlog: pair(r, "backlog") as Pair, unassigned: numOrNull(r?.unassigned), openNow: num(r?.open_now), aging: histogramFromRow(r ?? {}, AGING_EDGES, "a") };
}

/** The oldest open tickets with their SLA state: the alert list under the aging chart. */
export async function agingAlerts(f: ResolvedFilters, limit = 8) {
  const list = await rows<Row>(sql`
    select tickets.id, tickets.ref, tickets.subject, tickets.priority, tickets.category, tickets.status, tickets.created_at as "createdAt", extract(epoch from (now() - tickets.created_at))::float8 as age_secs,
      extract(epoch from (${FRT} - tickets.created_at))::float8 as frt_secs, (tickets.assigned_to is not null) as assigned, ${WHO} as who, opener.role as role
    ${TICKET_FROM} ${WHO_JOIN}
    where ${scope(f, "tickets")} and tickets.status <> 'resolved' order by tickets.created_at asc, tickets.id limit ${limit}`);
  const now = new Date();
  return list.map((x) => {
    const ageSec = Math.max(0, num(x.age_secs)), created = new Date(now.getTime() - ageSec * 1000), frt = x.frt_secs == null ? null : new Date(created.getTime() + Math.max(0, num(x.frt_secs)) * 1000);
    return { id: String(x.id), ref: String(x.ref), subject: String(x.subject), priority: String(x.priority), category: String(x.category), status: String(x.status), assigned: !!x.assigned, who: String(x.who ?? ""), role: String(x.role ?? ""),
      createdAt: isoValue(x.createdAt) as string, ageSec: Math.round(ageSec), state: slaLabel(slaState({ createdAt: created, firstResponseAt: frt, resolvedAt: null, now }), false), unanswered: frt == null };
  });
}

/** Complaints filed / resolved / open at the end of each period, and the speed of the first staff action. */
export async function complaintFacts(f: ResolvedFilters) {
  const end = (e: Date) => sql`complaints.created_at < ${e.toISOString()}::timestamptz and (complaints.resolved_at is null or complaints.resolved_at >= ${e.toISOString()}::timestamptz)`;
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      filed: (w) => sql`count(*) filter (where ${w(complaints.createdAt)})::int`,
      resolved: (w) => sql`count(*) filter (where complaints.resolved_at is not null and ${w(complaints.resolvedAt)})::int`,
      fr_p50: (w) => sql`percentile_cont(0.5) within group (order by ${secsBetween("complaints.created_at", "complaints.first_response_at")}) filter (where ${w(complaints.createdAt)} and complaints.first_response_at is not null)`,
      res_p50: (w) => sql`percentile_cont(0.5) within group (order by ${secsBetween("complaints.created_at", "complaints.resolved_at")}) filter (where complaints.resolved_at is not null and ${w(complaints.resolvedAt)})`,
    })},
    count(*) filter (where ${end(f.cur.end)})::int as open_c, ${f.prev ? sql`count(*) filter (where ${end(f.prev.end)})::int` : sql`null::int`} as open_p
    ${COMPLAINT_FROM} where ${complaintScope(f)} and complaints.created_at < ${lastEnd(f)}::timestamptz`);
  return { filed: pair(r, "filed"), resolved: pair(r, "resolved"), open: pair(r, "open"), frP50: pair(r, "fr_p50"), resP50: pair(r, "res_p50") };
}

/** Complaints that hold a settlement right now and (finance) the payee amount of those settlements, counted once even when several complaints hold the same one. */
export async function heldFacts(f: ResolvedFilters, money: boolean) {
  const [r] = await rows<Row>(sql`select count(*)::int as n ${COMPLAINT_FROM} where complaints.holds_settlement and complaints.status in ('open','in_progress') and ${complaintScope(f)}`);
  let cents: number | null = null;
  if (money) {
    const [m] = await rows<Row>(sql`
      select coalesce(sum(s.provider_cents), 0)::float8 as cents from settlements s where s.status in (${heldStates}) and exists (
        select 1 ${COMPLAINT_FROM} where complaints.holds_settlement and complaints.status in ('open','in_progress') and ${complaintScope(f)}
          and (complaints.offer_id = s.offer_id or (complaints.offer_id is null and complaints.request_id = s.request_id)))`);
    cents = num(m?.cents);
  }
  return { n: num(r?.n), cents };
}

/** Requests created in the period (the denominator of "tickets per 100 orders"). */
export async function orderFacts(f: ResolvedFilters): Promise<Pair> {
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, { orders: (w) => sql`count(*) filter (where ${w(requests.createdAt)})::int` })}
    from requests where ${scope(f, "requests")} and ${NOT_DRAFT} and ${anyWindow(f, requests.createdAt)}`);
  return z(pair(r, "orders"));
}

/** Ratings given in the period: count, stars, low ones, the split by stars and by who was rated; and the share of completed jobs that were rated (cohort: jobs finished in the period). */
export async function ratingFacts(f: ResolvedFilters) {
  const inCur = inWindow(ratings.createdAt, f.cur);
  const star = (n: number) => sql`count(*) filter (where ${inCur} and ratings.stars = ${n})::int as ${sql.raw(`s${n}`)}`;
  const role = (name: string) => sql`count(*) filter (where ${inCur} and ratee.role = ${name})::int as ${sql.raw(`n_${name}`)}, coalesce(sum(ratings.stars) filter (where ${inCur} and ratee.role = ${name}), 0)::float8 as ${sql.raw(`sum_${name}`)}`;
  const [a, b] = await Promise.all([
    rows<Row>(sql`
      select ${twinSelect(f, {
        n: (w) => sql`count(*) filter (where ${w(ratings.createdAt)})::int`,
        sum: (w) => sql`coalesce(sum(ratings.stars) filter (where ${w(ratings.createdAt)}), 0)::float8`,
        low: (w) => sql`count(*) filter (where ${w(ratings.createdAt)} and ratings.stars <= ${LOW_STARS})::int`,
      })}, ${star(1)}, ${star(2)}, ${star(3)}, ${star(4)}, ${star(5)}, ${role("driver")}, ${role("business")}
      ${RATING_FROM} where ${scope(f, "offers")} and ${anyWindow(f, ratings.createdAt)}`),
    rows<Row>(sql`
      select ${twinSelect(f, {
        jobs: (w) => sql`count(*) filter (where ${w(offers.finalAt)})::int`,
        rated: (w) => sql`coalesce(sum(rc.c) filter (where ${w(offers.finalAt)}), 0)::int`,
      })}
      from offers join requests on requests.id = offers.request_id left join (select offer_id, count(*)::int as c from ratings group by offer_id) rc on rc.offer_id = offers.id
      where ${scope(f, "offers")} and offers.status = 'completed' and ${anyWindow(f, offers.finalAt)}`),
  ]);
  const [ra] = a, [rb] = b;
  const p = (r: Row | undefined, n: string) => pair(r, n);
  return {
    n: z(p(ra, "n")), sum: z(p(ra, "sum")), low: z(p(ra, "low")), jobs: z(p(rb, "jobs")), rated: z(p(rb, "rated")),
    distribution: [1, 2, 3, 4, 5].map((n) => num(ra?.[`s${n}`])),
    byRole: { driver: { n: num(ra?.n_driver), sum: num(ra?.sum_driver) }, business: { n: num(ra?.n_business), sum: num(ra?.sum_business) } },
  };
}

export async function supportFacts(f: ResolvedFilters, money: boolean) {
  const [tk, bl, cp, held, orders, rt] = await Promise.all([ticketFacts(f), backlogFacts(f), complaintFacts(f), heldFacts(f, money), orderFacts(f), ratingFacts(f)]);
  const facts: SupportFacts = {
    tickets: { opened: tk.opened, resolved: tk.resolved, urgent: tk.urgent, reopened: tk.reopened, everResolved: tk.everResolved, frP50: tk.frP50, frP90: tk.frP90, resP50: tk.resP50, resP90: tk.resP90, respDue: tk.respDue, respMet: tk.respMet, resDue: tk.resDue, resMet: tk.resMet, breaches: tk.breaches },
    backlog: z(bl.backlog), unassigned: bl.unassigned,
    complaints: { filed: z(cp.filed), resolved: z(cp.resolved), open: z(cp.open) },
    orders, ratings: { n: rt.n, sum: rt.sum, low: rt.low, jobs: rt.jobs, rated: rt.rated }, held,
  };
  return { facts, tk, bl, cp, rt };
}
