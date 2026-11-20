import { sql, type SQL } from "drizzle-orm";
import { requests } from "@/db/schema";
import { riyadhDow, riyadhHour } from "./buckets";
import { anyWindow, inWindow, scope, twinRead, twinSelect } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { rows } from "./guard";
import {
  APPROVAL_S, ARRIVAL_M, COUNTED, DELAY_S, DRIVEN, dueJob, FILLED, JOB_S, JOIN_PIN, lateJob, LOADING_S, onTimeJob, RESOLVED, SLOTS, WORK_DONE,
} from "./ops-sql";
import { cellsOf, roundPair, type Row } from "./ops-util";
import { histogramFromRow, histogramSelect } from "./stats";

/** Edges (seconds after the start time) of the lateness histogram: on or before the start (< 1 s), < 5 min, 5–15 min, 15–30 min, 30–60 min, 1–2 h, ≥ 2 h. */
export const LATE_EDGES = [1, 300, 900, 1800, 3600, 7200];
/** Edges (seconds) of the job-duration histogram: < 30 min, 30–60 min, 1–2 h, 2–4 h, 4–6 h, 6–12 h, ≥ 12 h. */
export const JOB_EDGES = [1800, 3600, 7200, 14_400, 21_600, 43_200];

/**
 * Execution facts of the jobs (accepted offers that were not withdrawn with their request) whose request was due to START in the period — the same cohort as the
 * Overview's on-time KPI, so the numbers agree: punctuality under the platform's start-SLA rule (grace = `settings.lateGraceMin`), no-shows, arrival distance from the
 * warehouse pin, loading, route approval, job duration, parcels per job and completion.
 */
export async function execFacts(f: ResolvedFilters, grace: number) {
  const base = (w: (c: string) => SQL, extra: SQL = sql`true`) => sql`${w("requests.starts_at")} and ${COUNTED} and ${extra}`;
  const pct = (p: number, expr: SQL, extra: SQL) => (w: (c: string) => SQL) => sql`percentile_cont(${sql.raw(String(p))}) within group (order by ${expr}) filter (where ${base(w, extra)})`;
  const cnt = (extra: SQL) => (w: (c: string) => SQL) => sql`count(*) filter (where ${base(w, extra)})::int`;
  const arrived = sql`offers.arrived_at is not null`;
  const inCur = inWindow(requests.startsAt, f.cur);
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      due: (w) => sql`count(*) filter (where ${w("requests.starts_at")} and ${dueJob(grace)})::int`, on_time: (w) => sql`count(*) filter (where ${w("requests.starts_at")} and ${onTimeJob(grace)})::int`,
      late: (w) => sql`count(*) filter (where ${w("requests.starts_at")} and ${lateJob(grace)})::int`, no_show: cnt(sql`offers.status = 'no_show'`),
      arrived: cnt(arrived), delay_p50: pct(0.5, sql`greatest(${DELAY_S}, 0)`, arrived), delay_p90: pct(0.9, sql`greatest(${DELAY_S}, 0)`, arrived),
      dist_n: cnt(sql`${ARRIVAL_M} is not null`), dist_p50: pct(0.5, ARRIVAL_M, sql`${ARRIVAL_M} is not null`), dist_p90: pct(0.9, ARRIVAL_M, sql`${ARRIVAL_M} is not null`),
      load_p50: pct(0.5, LOADING_S, sql`${LOADING_S} is not null`), load_p90: pct(0.9, LOADING_S, sql`${LOADING_S} is not null`), load_n: cnt(sql`${LOADING_S} is not null`),
      appr_p50: pct(0.5, APPROVAL_S, sql`${APPROVAL_S} is not null`), appr_p90: pct(0.9, APPROVAL_S, sql`${APPROVAL_S} is not null`),
      job_p50: pct(0.5, JOB_S, sql`${JOB_S} is not null`), job_p90: pct(0.9, JOB_S, sql`${JOB_S} is not null`), job_n: cnt(sql`${JOB_S} is not null`),
      parcels: (w) => sql`coalesce(sum(offers.loaded_units) filter (where ${base(w, sql`offers.loaded_units is not null`)}), 0)::float8`, parcel_jobs: cnt(sql`offers.loaded_units is not null`),
      started: cnt(sql`offers.attendance_at is not null`), finished: cnt(sql`offers.attendance_at is not null and ${WORK_DONE}`),
    })}, ${histogramSelect(DELAY_S, LATE_EDGES, "hl", sql`${inCur} and ${COUNTED} and ${arrived}`)}, ${histogramSelect(JOB_S, JOB_EDGES, "hj", sql`${inCur} and ${COUNTED} and ${JOB_S} is not null`)}
    from offers join requests on requests.id = offers.request_id ${JOIN_PIN}
    where ${scope(f, "offers")} and ${DRIVEN} and ${anyWindow(f, requests.startsAt)}`);
  const p = (k: string) => twinRead(r, k);
  return {
    due: p("due"), onTime: p("on_time"), late: p("late"), noShow: p("no_show"), arrived: p("arrived"), started: p("started"), finished: p("finished"), parcels: p("parcels"), parcelJobs: p("parcel_jobs"),
    delay: { p50: p("delay_p50"), p90: p("delay_p90"), histogram: histogramFromRow(r ?? {}, LATE_EDGES, "hl") },
    distance: { p50: roundPair(p("dist_p50")), p90: roundPair(p("dist_p90")), n: p("dist_n") }, // whole metres
    loading: { p50: p("load_p50"), p90: p("load_p90"), n: p("load_n") }, approval: { p50: p("appr_p50"), p90: p("appr_p90") },
    job: { p50: p("job_p50"), p90: p("job_p90"), n: p("job_n"), histogram: histogramFromRow(r ?? {}, JOB_EDGES, "hj") },
  };
}
export type ExecFacts = Awaited<ReturnType<typeof execFacts>>;

/** Stops resolved per hour on the road: every resolved stop (delivered, failed, returned) of routes started and finished in the period ÷ the hours between route approval and the end of the route. */
export async function stopsFacts(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      stops: (w) => sql`coalesce(sum(x.stops) filter (where ${w("x.starts_at")}), 0)::float8`, secs: (w) => sql`coalesce(sum(x.secs) filter (where ${w("x.starts_at")}), 0)::float8`,
    })}
    from (
      select requests.starts_at, count(*) filter (where shipments.status in ('delivered','failed','returned'))::int as stops, extract(epoch from (offers.delivered_at - offers.route_approved_at))::float8 as secs
      from offers join requests on requests.id = offers.request_id join shipments on shipments.offer_id = offers.id
      where ${scope(f, "offers")} and ${COUNTED} and offers.route_approved_at is not null and offers.delivered_at > offers.route_approved_at and ${anyWindow(f, requests.startsAt)}
      group by offers.id, requests.starts_at, offers.delivered_at, offers.route_approved_at
    ) x`);
  return { stops: twinRead(r, "stops"), secs: twinRead(r, "secs") };
}

/** How parcels got onto the vehicle (scanned by the driver vs handed over by the warehouse), for requests due to start in the period. */
export async function loadingFacts(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      scan: (w) => sql`count(*) filter (where ${w("requests.starts_at")} and shipments.loaded_via = 'driver_scan')::int`,
      warehouse: (w) => sql`count(*) filter (where ${w("requests.starts_at")} and shipments.loaded_via = 'warehouse')::int`,
    })}
    from shipments join requests on requests.id = shipments.request_id
    where ${scope(f, "shipments")} and shipments.loaded_via is not null and ${anyWindow(f, requests.startsAt)}`);
  return { scan: twinRead(r, "scan"), warehouse: twinRead(r, "warehouse") };
}

/**
 * "Peak pressure" heatmaps (Riyadh weekday × hour of the request's start time, current period): driver slots that stayed unfilled, and jobs that started late
 * or never started (no-shows). Both answer "when is the platform short of drivers?".
 */
export async function pressureHeat(f: ResolvedFilters, grace: number) {
  const [unfilled, late] = await Promise.all([
    rows<Row>(sql`
      select ${riyadhDow(requests.startsAt)} as dow, ${riyadhHour(requests.startsAt)} as hr, coalesce(sum(greatest(${SLOTS} - ${FILLED}, 0)), 0)::int as n
      from requests where ${scope(f, "requests")} and requests.status <> 'draft' and ${DRIVEN} and ${RESOLVED} and requests.starts_at < now() and ${inWindow(requests.startsAt, f.cur)} group by 1, 2`),
    rows<Row>(sql`
      select ${riyadhDow(requests.startsAt)} as dow, ${riyadhHour(requests.startsAt)} as hr, count(*)::int as n
      from offers join requests on requests.id = offers.request_id
      where ${scope(f, "offers")} and ${DRIVEN} and ${lateJob(grace)} and ${inWindow(requests.startsAt, f.cur)} group by 1, 2`),
  ]);
  return { unfilled: cellsOf(unfilled as never), late: cellsOf(late as never) };
}
