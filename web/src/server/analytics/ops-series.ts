import { sql, type SQL } from "drizzle-orm";
import { requests } from "@/db/schema";
import { bucketSql, zeroFill, type Point } from "./buckets";
import { inWindow, NOT_DRAFT, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { rows } from "./guard";
import { safeDiv } from "./kpi";
import { COUNTED, DRIVEN, dueJob, FILLED, onTimeJob, RESOLVED, SLOTS } from "./ops-sql";
import type { Window } from "./periods";

/** One chart series: a point per bucket (zero-filled), and the comparison period's points aligned by position (null without a comparison). */
export interface Series<K extends string> { fields: K[]; points: Array<Point<K>>; prev: Array<Point<K>> | null }

/** Reads one series for the current and (when there is one) the comparison window. `query(w)` returns rows `{ t, <field>… }` grouped by `bucketSql(...)`. */
export async function buildSeries<K extends string>(f: ResolvedFilters, fields: readonly K[], query: (w: Window) => SQL): Promise<Series<K>> {
  const read = async (w: Window, keys: string[]) => zeroFill(keys, await rows<{ t: string } & Partial<Record<K, unknown>>>(query(w)), fields);
  const [points, prev] = await Promise.all([read(f.cur, f.keys), f.prev && f.prevKeys ? read(f.prev, f.prevKeys) : null]);
  return { fields: [...fields], points, prev };
}

/** Per-bucket ratio for a chart line: null where the denominator is 0 (a gap, not 0 %). */
export const ratioPoints = <K extends string>(pts: Array<Point<K>>, n: K, d: K): Array<number | null> => pts.map((p) => safeDiv(p[n], p[d]));

export const DEMAND_FIELDS = ["created", "published", "completed", "active", "cancelled", "expired", "slots", "filled"] as const;
/** Requests created per bucket by where they ended up, plus the driver slots asked for / filled (cohort of the fill KPIs). */
export const demandSeries = (f: ResolvedFilters) => buildSeries(f, DEMAND_FIELDS, (w) => sql`
  select ${bucketSql(requests.createdAt, f.bucket)} as t, count(*)::int as created, count(*) filter (where requests.published_at is not null)::int as published,
    count(*) filter (where requests.status = 'completed')::int as completed,
    count(*) filter (where requests.status in ('published','filling','assigned','confirmed','in_progress'))::int as active,
    count(*) filter (where requests.status = 'cancelled')::int as cancelled, count(*) filter (where requests.status = 'expired')::int as expired,
    coalesce(sum(${SLOTS}) filter (where ${DRIVEN} and ${RESOLVED}), 0)::float8 as slots, coalesce(sum(${FILLED}) filter (where ${DRIVEN} and ${RESOLVED}), 0)::float8 as filled
  from requests where ${scope(f, "requests")} and ${NOT_DRAFT} and ${inWindow(requests.createdAt, w)} group by 1`);

export const EXEC_FIELDS = ["due", "on_time", "no_show"] as const;
/** Jobs per bucket of their start time: due, on time, no-show (late = due − on time). */
export const execSeries = (f: ResolvedFilters, grace: number) => buildSeries(f, EXEC_FIELDS, (w) => sql`
  select ${bucketSql(requests.startsAt, f.bucket)} as t, count(*) filter (where ${dueJob(grace)})::int as due, count(*) filter (where ${onTimeJob(grace)})::int as on_time,
    count(*) filter (where ${COUNTED} and offers.status = 'no_show')::int as no_show
  from offers join requests on requests.id = offers.request_id
  where ${scope(f, "offers")} and ${DRIVEN} and ${inWindow(requests.startsAt, w)} group by 1`);
