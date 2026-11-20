import { sql, type SQL } from "drizzle-orm";
import { complaints, ratings, requests, tickets } from "@/db/schema";
import { getSettings } from "../settings";
import { bucketSql, zeroFill, type Point } from "./buckets";
import { anyWindow, inWindow, NOT_DRAFT, PARCEL_OUTCOME_AT, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { safeDiv } from "./kpi";
import { topWithOther } from "./support-sla";
import { complaintScope, COMPLAINT_FROM, TICKET_FROM } from "./support-sql";

type Row = Record<string, unknown>;
export interface Pivoted<K extends string> { fields: K[]; points: Array<Point<K>>; prev: Array<Point<K>> | null }
/** `c` = a row of the current period, `p` = of the comparison period (one query reads both windows). */
const tag = (f: ResolvedFilters, col: SQL | { _: unknown }) => sql`case when ${inWindow(col, f.cur)} then 'c' else 'p' end`;

/** Splits `{ w, t, k, n }` rows (window tag, bucket key, kind, count) into zero-filled current and previous points over the given fields. */
export function pivotKinds<K extends string>(f: ResolvedFilters, data: Array<{ w: string; t: string; k: string; n: number }>, fields: K[]): Pivoted<K> {
  const side = (w: "c" | "p", keys: string[]) => {
    const by = new Map<string, Record<string, unknown> & { t: string }>();
    for (const r of data) if (r.w === w) { const o = by.get(r.t) ?? { t: r.t }; o[r.k] = Number(o[r.k] ?? 0) + r.n; by.set(r.t, o); }
    return zeroFill(keys, [...by.values()], fields);
  };
  return { fields, points: side("c", f.keys), prev: f.prev && f.prevKeys ? side("p", f.prevKeys) : null };
}
const cast = (r: Row) => ({ w: String(r.w), t: String(r.t), k: String(r.k), n: num(r.n) });

/** Tickets opened per bucket by category (the biggest `top` categories, the rest folded into `_other`) and tickets resolved per bucket. */
export async function ticketsSeries(f: ResolvedFilters, top = 5) {
  const data = (await rows<Row>(sql`
    select w, t, k, n from (
      select ${tag(f, tickets.createdAt)} as w, ${bucketSql(tickets.createdAt, f.bucket)} as t, tickets.category as k, count(*)::int as n
      ${TICKET_FROM} where ${scope(f, "tickets")} and ${anyWindow(f, tickets.createdAt)} group by 1, 2, 3
      union all
      select ${tag(f, tickets.resolvedAt)}, ${bucketSql(tickets.resolvedAt, f.bucket)}, '_resolved', count(*)::int
      ${TICKET_FROM} where ${scope(f, "tickets")} and tickets.status = 'resolved' and ${anyWindow(f, tickets.resolvedAt)} group by 1, 2, 3
    ) x`)).map(cast);
  const totals = new Map<string, number>();
  for (const r of data) if (r.w === "c" && r.k !== "_resolved") totals.set(r.k, (totals.get(r.k) ?? 0) + r.n);
  const { keys, hasOther } = topWithOther(totals, top);
  const fold = data.map((r) => (r.k === "_resolved" || keys.includes(r.k) ? r : { ...r, k: "_other" }));
  const cats = [...keys, ...(hasOther ? ["_other"] : [])];
  const s = pivotKinds(f, fold.map((r) => (r.k === "_resolved" ? { ...r, k: "resolved" } : r)), [...cats, "resolved"]);
  return { categories: cats, points: s.points, prev: s.prev };
}

/** Complaints filed and resolved per bucket. */
export async function complaintsSeries(f: ResolvedFilters) {
  const data = (await rows<Row>(sql`
    select w, t, k, n from (
      select ${tag(f, complaints.createdAt)} as w, ${bucketSql(complaints.createdAt, f.bucket)} as t, 'filed' as k, count(*)::int as n
      ${COMPLAINT_FROM} where ${complaintScope(f)} and ${anyWindow(f, complaints.createdAt)} group by 1, 2
      union all
      select ${tag(f, complaints.resolvedAt)}, ${bucketSql(complaints.resolvedAt, f.bucket)}, 'resolved', count(*)::int
      ${COMPLAINT_FROM} where ${complaintScope(f)} and complaints.resolved_at is not null and ${anyWindow(f, complaints.resolvedAt)} group by 1, 2
    ) x`)).map(cast);
  return pivotKinds(f, data, ["filed", "resolved"]);
}

/** Ratings per bucket: how many, the sum of stars (so a bucket average is `stars / n`) and the low ones. */
export async function ratingsSeries(f: ResolvedFilters) {
  const data = await rows<Row>(sql`
    select ${tag(f, ratings.createdAt)} as w, ${bucketSql(ratings.createdAt, f.bucket)} as t, count(*)::int as n, coalesce(sum(ratings.stars), 0)::float8 as stars, count(*) filter (where ratings.stars <= 2)::int as low
    from ratings join offers on offers.id = ratings.offer_id join requests on requests.id = offers.request_id
    where ${scope(f, "offers")} and ${anyWindow(f, ratings.createdAt)} group by 1, 2`);
  const side = (w: "c" | "p", keys: string[]) => zeroFill(keys, data.filter((r) => r.w === w).map((r) => ({ t: String(r.t), n: r.n, stars: r.stars, low: r.low })), ["n", "stars", "low"] as const);
  return { points: side("c", f.keys), prev: f.prev && f.prevKeys ? side("p", f.prevKeys) : null };
}

/** The platform's delivery quality per bucket (current period only), to read next to support volume: orders and cancellations, parcel outcomes, punctual starts. */
export async function qualitySeries(f: ResolvedFilters) {
  const grace = (await getSettings()).lateGraceMin;
  const limit = sql`requests.starts_at + make_interval(mins => ${grace}::int)`;
  const counted = sql`offers.accepted_at is not null and offers.status not in ('rejected','expired','cancelled','replaced')`;
  const [reqs, parcels, starts] = await Promise.all([
    rows<Row>(sql`select ${bucketSql(requests.createdAt, f.bucket)} as t, count(*)::int as orders, count(*) filter (where requests.status = 'cancelled')::int as cancelled
      from requests where ${scope(f, "requests")} and ${NOT_DRAFT} and ${inWindow(requests.createdAt, f.cur)} group by 1`),
    rows<Row>(sql`select ${bucketSql(PARCEL_OUTCOME_AT, f.bucket)} as t, count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*)::int as resolved
      from shipments join requests on requests.id = shipments.request_id where ${scope(f, "shipments")} and ${inWindow(PARCEL_OUTCOME_AT, f.cur)} group by 1`),
    rows<Row>(sql`select ${bucketSql(requests.startsAt, f.bucket)} as t, count(*) filter (where ${counted} and offers.arrived_at is not null and offers.arrived_at <= ${limit})::int as on_time,
        count(*) filter (where ${counted} and (offers.arrived_at is not null or offers.status = 'no_show' or now() > ${limit}))::int as due
      from offers join requests on requests.id = offers.request_id where ${scope(f, "offers")} and ${inWindow(requests.startsAt, f.cur)} group by 1`),
  ]);
  const o = zeroFill(f.keys, reqs as Array<{ t: string }>, ["orders", "cancelled"] as const), p = zeroFill(f.keys, parcels as Array<{ t: string }>, ["delivered", "resolved"] as const), s = zeroFill(f.keys, starts as Array<{ t: string }>, ["on_time", "due"] as const);
  return f.keys.map((t, i) => ({
    t, orders: o[i].orders, deliverySuccess: safeDiv(p[i].delivered, p[i].resolved), cancellationRate: safeDiv(o[i].cancelled, o[i].orders), onTime: safeDiv(s[i].on_time, s[i].due),
  }));
}
export type QualityPoint = Awaited<ReturnType<typeof qualitySeries>>[number];
