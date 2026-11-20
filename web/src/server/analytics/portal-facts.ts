import { sql, type SQL } from "drizzle-orm";
import { requests, shipments } from "@/db/schema";
import { getSettings } from "../settings";
import { anyWindow, inWindow, NOT_DRAFT, PARCEL_OUTCOME_AT, scope, twinRead, twinSelect } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { FILL_EDGES, FUNNEL_STEPS } from "./overview-kpis";
import { histogramFromRow, histogramSelect } from "./stats";

/**
 * Facts both portals read (requests, parcels, start punctuality, time to fill). They follow the Overview's definitions exactly (same anchors, same exclusions) so a company's
 * portal numbers equal the admin Overview filtered to that company; every query takes the owner-scoped filters from `portalCtx()`.
 */
export type Row = Record<string, unknown>;
export type Pair = { cur: number | null; prev: number | null };
/** Counts and sums are 0 (not "no data") when nothing happened; the comparison stays null without a comparison period. */
export const z = (p: Pair): Pair => ({ cur: p.cur ?? 0, prev: p.prev });
export const pair = (r: Row | undefined, name: string): Pair => twinRead(r, name);

const FUNNEL_STATE = {
  accepted: sql`exists (select 1 from offers where offers.request_id = requests.id and offers.accepted_at is not null)`,
  filled: sql`(requests.status in ('assigned','confirmed','in_progress','completed') or requests.slots_filled >= requests.quantity)`,
  started: sql`(requests.status in ('in_progress','completed') or exists (select 1 from offers where offers.request_id = requests.id and offers.attendance_at is not null))`,
  completed: sql`requests.status = 'completed'`,
};

/** Requests created / cancelled (cohort) / completed, and how far the requests created in the period got. */
export async function requestFacts(f: ResolvedFilters) {
  const inCur = inWindow(requests.createdAt, f.cur);
  const step = (cond: SQL) => sql`count(*) filter (where ${inCur} and ${NOT_DRAFT} and ${cond})::int`;
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      created: (w) => sql`count(*) filter (where ${w(requests.createdAt)} and ${NOT_DRAFT})::int`,
      cancelled: (w) => sql`count(*) filter (where ${w(requests.createdAt)} and requests.status = 'cancelled')::int`,
      completed: (w) => sql`count(*) filter (where ${w(requests.completedAt)} and requests.status = 'completed')::int`,
    })},
    count(*) filter (where ${inCur} and ${NOT_DRAFT})::int as fn_published, ${step(FUNNEL_STATE.accepted)} as fn_accepted, ${step(FUNNEL_STATE.filled)} as fn_filled,
    ${step(FUNNEL_STATE.started)} as fn_started, ${step(FUNNEL_STATE.completed)} as fn_completed
    from requests where ${scope(f, "requests")} and ${anyWindow(f, requests.createdAt, requests.completedAt)}`);
  const raw = FUNNEL_STEPS.map((k) => num(r?.[`fn_${k}`]));
  const funnel = raw.map((n, i) => ({ key: FUNNEL_STEPS[i], count: Math.min(n, ...raw.slice(0, i)) }));
  return { created: pair(r, "created"), cancelled: pair(r, "cancelled"), completed: pair(r, "completed"), funnel };
}

/** Parcel outcomes on the day they were resolved, parcels registered, first-attempt, deferred, code problems, proof by code, and the median hand-over → delivery time. */
export async function parcelFacts(f: ResolvedFilters) {
  const resolved = sql`shipments.status in ('delivered','failed','returned')`;
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      sent: (w) => sql`count(*) filter (where ${w(shipments.createdAt)})::int`,
      delivered: (w) => sql`count(*) filter (where shipments.status = 'delivered' and ${w(PARCEL_OUTCOME_AT)})::int`,
      failed: (w) => sql`count(*) filter (where shipments.status = 'failed' and ${w(PARCEL_OUTCOME_AT)})::int`,
      returned: (w) => sql`count(*) filter (where shipments.status = 'returned' and ${w(PARCEL_OUTCOME_AT)})::int`,
      first: (w) => sql`count(*) filter (where shipments.status = 'delivered' and shipments.attempts <= 1 and ${w(PARCEL_OUTCOME_AT)})::int`,
      resolved: (w) => sql`count(*) filter (where ${resolved} and ${w(PARCEL_OUTCOME_AT)})::int`,
      deferred: (w) => sql`count(*) filter (where ${resolved} and shipments.defer_count > 0 and ${w(PARCEL_OUTCOME_AT)})::int`,
      otp_issue: (w) => sql`count(*) filter (where ${resolved} and (shipments.otp_attempts > 0 or shipments.fail_reason = 'no_otp') and ${w(PARCEL_OUTCOME_AT)})::int`,
      p50: (w) => sql`percentile_cont(0.5) within group (order by extract(epoch from (shipments.delivered_at - shipments.loaded_at))::float8)
        filter (where shipments.status = 'delivered' and shipments.loaded_at is not null and shipments.delivered_at >= shipments.loaded_at and ${w(PARCEL_OUTCOME_AT)})`,
    })}
    from shipments join requests on requests.id = shipments.request_id
    where ${scope(f, "shipments")} and ${anyWindow(f, PARCEL_OUTCOME_AT, shipments.createdAt)}`);
  return Object.fromEntries(["sent", "delivered", "failed", "returned", "first", "resolved", "deferred", "otp_issue", "p50"].map((k) => [k, pair(r, k)])) as Record<"sent" | "delivered" | "failed" | "returned" | "first" | "resolved" | "deferred" | "otp_issue" | "p50", Pair>;
}

/** Start punctuality: jobs whose start time (+ grace) is due, and those where the driver arrived on time. A no-show counts as late. */
export async function startFacts(f: ResolvedFilters) {
  const grace = (await getSettings()).lateGraceMin;
  const limit = sql`requests.starts_at + make_interval(mins => ${grace}::int)`;
  const counted = sql`offers.accepted_at is not null and offers.status not in ('rejected','expired','cancelled','replaced')`;
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      on_time: (w) => sql`count(*) filter (where ${w(requests.startsAt)} and ${counted} and offers.arrived_at is not null and offers.arrived_at <= ${limit})::int`,
      due: (w) => sql`count(*) filter (where ${w(requests.startsAt)} and ${counted} and (offers.arrived_at is not null or offers.status = 'no_show' or now() > ${limit}))::int`,
    })}
    from offers join requests on requests.id = offers.request_id
    where ${scope(f, "offers")} and ${anyWindow(f, requests.startsAt)}`);
  return { on_time: pair(r, "on_time"), due: pair(r, "due") };
}

/** Time to fill: publishing → the last live driver accepted, for fully staffed requests (average for both periods; percentiles and histogram for the current one). */
export async function fillFacts(f: ResolvedFilters) {
  const inCur = inWindow("x.published_at", f.cur);
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      avg: (w) => sql`avg(x.secs) filter (where ${w("x.published_at")})::float8`,
      n: (w) => sql`count(*) filter (where ${w("x.published_at")})::int`,
    })},
    percentile_cont(0.5) within group (order by x.secs) filter (where ${inCur}) as p50, percentile_cont(0.9) within group (order by x.secs) filter (where ${inCur}) as p90,
    ${histogramSelect(sql`x.secs`, FILL_EDGES, "h", inCur)}
    from (
      select requests.id, requests.published_at, extract(epoch from (max(offers.accepted_at) - requests.published_at))::float8 as secs
      from requests join offers on offers.request_id = requests.id and offers.accepted_at is not null and offers.status not in ('rejected','expired','cancelled','replaced','no_show')
      where ${scope(f, "requests")} and requests.published_at is not null and requests.slots_filled >= requests.quantity and ${anyWindow(f, requests.publishedAt)}
      group by requests.id, requests.published_at having max(offers.accepted_at) >= requests.published_at
    ) x`);
  const p = (v: unknown) => (v == null ? null : Number(v));
  return { avg: pair(r, "avg"), n: pair(r, "n").cur ?? 0, p50: p(r?.p50), p90: p(r?.p90), histogram: histogramFromRow(r ?? {}, FILL_EDGES) };
}
