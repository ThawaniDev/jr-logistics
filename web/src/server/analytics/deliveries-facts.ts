import { sql, type SQL } from "drizzle-orm";
import { shipments } from "@/db/schema";
import { anyWindow, inWindow, PARCEL_OUTCOME_AT as OUT, scope, twinRead, twinSelect, type Metric } from "./conditions";
import { histogramFromRow, histogramSelect, type HistBucket } from "./stats";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { secsBetween, type Pair, type Row } from "./finance-core";

/** Parcels that have an outcome (delivered, failed, returned). */
const RESOLVED = sql`shipments.status in ('delivered','failed','returned')`;
const DELIVERED = sql`shipments.status = 'delivered'`;
const SIGNED = sql`exists (select 1 from shipment_media sm where sm.shipment_id = shipments.id and sm.kind = 'signature')`;
export const FROM = sql`from shipments join requests on requests.id = shipments.request_id`;
/** Seconds from the vehicle hand-over to the delivery, and from arriving at the stop to the delivery (only for plausible, ordered timestamps). */
const LOAD_TO_DONE = secsBetween(shipments.loadedAt, shipments.deliveredAt);
const DWELL = secsBetween(shipments.arrivedAt, shipments.deliveredAt);
const HAS_LOAD = sql`shipments.loaded_at is not null and shipments.delivered_at >= shipments.loaded_at`;
const HAS_ARRIVE = sql`shipments.arrived_at is not null and shipments.delivered_at >= shipments.arrived_at`;
/** Edges of the delivery-time histogram (seconds) and of the distance-from-the-pin histogram (metres). */
export const TIME_EDGES = [900, 1800, 3600, 7200, 14_400, 28_800];
export const DIST_EDGES = [25, 50, 100, 250, 500, 1000];
export const ATTEMPT_EDGES = [1, 2, 3];
export const FAR_M = 100;

const pct = (p: number, expr: SQL, cond: SQL): Metric => (w) => sql`percentile_cont(${sql.raw(String(p))}) within group (order by ${expr}) filter (where ${DELIVERED} and ${w(shipments.deliveredAt)} and ${cond})::float8`;

/** Counts, shares, returns, proof and attempts of the parcels of the period (current and comparison in one pass). */
export async function flowFacts(f: ResolvedFilters) {
  const del = (w: (c: SQL) => SQL) => sql`${DELIVERED} and ${w(OUT)}`;
  const res = (w: (c: SQL) => SQL) => sql`${RESOLVED} and ${w(OUT)}`;
  const m: Record<string, Metric> = {
    created: (w) => sql`count(*) filter (where ${w(shipments.createdAt)})::int`,
    handed: (w) => sql`count(*) filter (where ${w(shipments.loadedAt)})::int`,
    delivered: (w) => sql`count(*) filter (where ${del(w)})::int`,
    failed: (w) => sql`count(*) filter (where shipments.status = 'failed' and ${w(OUT)})::int`,
    returned: (w) => sql`count(*) filter (where shipments.status = 'returned' and ${w(OUT)})::int`,
    missing: (w) => sql`count(*) filter (where shipments.status = 'missing' and ${w(shipments.updatedAt)})::int`,
    pending: (w) => sql`count(*) filter (where shipments.status in ('pending','loaded') and ${w(shipments.createdAt)})::int`,
    first: (w) => sql`count(*) filter (where ${del(w)} and shipments.attempts <= 1)::int`,
    attempts: (w) => sql`coalesce(sum(greatest(shipments.attempts, 1)) filter (where ${del(w)}), 0)::float8`,
    deferred: (w) => sql`count(*) filter (where ${res(w)} and shipments.defer_count > 0)::int`,
    def_del: (w) => sql`count(*) filter (where ${del(w)} and shipments.defer_count > 0)::int`,
    incomplete: (w) => sql`count(*) filter (where ${w(shipments.createdAt)} and not shipments.details_complete)::int`,
    b2b_created: (w) => sql`count(*) filter (where ${w(shipments.createdAt)} and shipments.recipient_type = 'business')::int`,
    b2c_del: (w) => sql`count(*) filter (where ${del(w)} and shipments.recipient_type = 'consumer')::int`,
    b2c_res: (w) => sql`count(*) filter (where ${res(w)} and shipments.recipient_type = 'consumer')::int`,
    b2b_del: (w) => sql`count(*) filter (where ${del(w)} and shipments.recipient_type = 'business')::int`,
    b2b_res: (w) => sql`count(*) filter (where ${res(w)} and shipments.recipient_type = 'business')::int`,
    ret_n: (w) => sql`count(*) filter (where shipments.status = 'returned' and ${w(shipments.returnedAt)} and shipments.failed_at is not null and shipments.returned_at >= shipments.failed_at)::int`,
    ret_secs: (w) => sql`coalesce(sum(${secsBetween(shipments.failedAt, shipments.returnedAt)}) filter (where shipments.status = 'returned' and ${w(shipments.returnedAt)} and shipments.failed_at is not null and shipments.returned_at >= shipments.failed_at), 0)::float8`,
    otp: (w) => sql`count(*) filter (where ${del(w)} and shipments.proof_type = 'otp')::int`,
    receipt: (w) => sql`count(*) filter (where ${del(w)} and shipments.proof_type = 'receipt')::int`,
    scan: (w) => sql`count(*) filter (where ${del(w)} and (shipments.proof_type = 'scan' or shipments.proof_type is null))::int`,
    signed: (w) => sql`count(*) filter (where ${del(w)} and ${SIGNED})::int`,
    evidence: (w) => sql`count(*) filter (where ${del(w)} and (shipments.proof_type in ('otp','receipt') or ${SIGNED}))::int`,
    sms: (w) => sql`coalesce(sum(case when ${res(w)} then (select count(*) from message_log m where m.shipment_id = shipments.id and m.channel = 'sms' and m.status <> 'failed') else 0 end), 0)::float8`,
  };
  const [r] = await rows<Row>(sql`select ${twinSelect(f, m)} ${FROM}
    where ${scope(f, "shipments")} and (${anyWindow(f, OUT, shipments.createdAt, shipments.loadedAt, shipments.returnedAt)} or (shipments.status = 'missing' and ${anyWindow(f, shipments.updatedAt)}))`);
  const out = {} as Record<string, Pair>;
  for (const name of Object.keys(m)) out[name] = twinRead(r, name);
  return out;
}
export type FlowFacts = Awaited<ReturnType<typeof flowFacts>>;

export interface Dist { hist: HistBucket[]; n: number }
/** Timing and location of the delivered parcels: percentiles for both periods, the delivery-time and distance histograms for the current one. */
export async function timingFacts(f: ResolvedFilters) {
  const inCur = inWindow(shipments.deliveredAt, f.cur);
  const m: Record<string, Metric> = {
    time_p50: pct(0.5, LOAD_TO_DONE, HAS_LOAD), time_p90: pct(0.9, LOAD_TO_DONE, HAS_LOAD), dwell_p50: pct(0.5, DWELL, HAS_ARRIVE),
    dist_p50: pct(0.5, sql`shipments.delivered_distance_m`, sql`shipments.delivered_distance_m is not null`), dist_p90: pct(0.9, sql`shipments.delivered_distance_m`, sql`shipments.delivered_distance_m is not null`),
    far: (w) => sql`count(*) filter (where ${w(shipments.deliveredAt)} and shipments.delivered_distance_m > ${FAR_M})::int`,
    dist_n: (w) => sql`count(*) filter (where ${w(shipments.deliveredAt)} and shipments.delivered_distance_m is not null)::int`,
  };
  const timeCur = sql`${DELIVERED} and ${inCur} and ${HAS_LOAD}`, distCur = sql`${DELIVERED} and ${inCur} and shipments.delivered_distance_m is not null`;
  const [r] = await rows<Row>(sql`select ${twinSelect(f, m)},
      ${histogramSelect(LOAD_TO_DONE, TIME_EDGES, "ht", timeCur)}, ${histogramSelect(sql`shipments.delivered_distance_m`, DIST_EDGES, "hd", distCur)}
    ${FROM} where ${scope(f, "shipments")} and ${DELIVERED} and ${anyWindow(f, shipments.deliveredAt)}`);
  const out = {} as Record<string, Pair>;
  for (const name of Object.keys(m)) out[name] = twinRead(r, name);
  const hist = histogramFromRow(r ?? {}, TIME_EDGES, "ht"), dist = histogramFromRow(r ?? {}, DIST_EDGES, "hd");
  return { ...out, time: { hist, n: hist.reduce((s, b) => s + b.count, 0) }, distance: { hist: dist, n: dist.reduce((s, b) => s + b.count, 0) } } as Record<string, Pair> & { time: Dist; distance: Dist };
}
export type TimingFacts = Awaited<ReturnType<typeof timingFacts>>;

/** Attempts per parcel of the parcels resolved in the current period (1, 2, 3 and more; 0 = legacy rows without the counter). */
export async function attemptsHistogram(f: ResolvedFilters): Promise<Dist> {
  const [r] = await rows<Row>(sql`select ${histogramSelect(sql`shipments.attempts`, ATTEMPT_EDGES, "h", RESOLVED)} ${FROM}
    where ${scope(f, "shipments")} and ${RESOLVED} and ${inWindow(OUT, f.cur)}`);
  const hist = histogramFromRow(r ?? {}, ATTEMPT_EDGES);
  return { hist, n: hist.reduce((s, b) => s + b.count, 0) };
}

/** OTP attempts and the evidence behind postponements, from the parcel journey (`shipment_events`). */
export async function eventFacts(f: ResolvedFilters) {
  const m: Record<string, Metric> = {
    otp_bad: (w) => sql`count(*) filter (where e.type = 'otp_failed' and ${w("e.created_at")})::int`,
    otp_ok: (w) => sql`count(*) filter (where e.type = 'otp_verified' and ${w("e.created_at")})::int`,
  };
  const note = sql`coalesce(btrim(e.payload->>'note'), '') <> ''`, photo = sql`e.payload ? 'mediaId'`, inCur = inWindow("e.created_at", f.cur);
  const [r] = await rows<Row>(sql`select ${twinSelect(f, m)},
      count(*) filter (where e.type = 'deferred' and ${inCur} and ${note} and ${photo})::int as dv_both, count(*) filter (where e.type = 'deferred' and ${inCur} and ${note} and not ${photo})::int as dv_note,
      count(*) filter (where e.type = 'deferred' and ${inCur} and not ${note} and ${photo})::int as dv_photo, count(*) filter (where e.type = 'deferred' and ${inCur} and not ${note} and not ${photo})::int as dv_none
    from shipment_events e join shipments on shipments.id = e.shipment_id join requests on requests.id = shipments.request_id
    where ${scope(f, "shipments")} and e.type in ('otp_failed','otp_verified','deferred') and ${anyWindow(f, "e.created_at")}`);
  return { otpBad: twinRead(r, "otp_bad"), otpOk: twinRead(r, "otp_ok"), deferEvidence: { both: num(r?.dv_both), note: num(r?.dv_note), photo: num(r?.dv_photo), none: num(r?.dv_none) } };
}

/** The parcels of one driver slot with the order of their outcomes, for the job-level measures. */
const jobParcels = (f: ResolvedFilters): SQL => sql`
  select shipments.offer_id, shipments.status, ${OUT} as out_at, shipments.leg_duration_s, offers.route_approved_at, min(shipments.loaded_at) over (partition by shipments.offer_id) as first_loaded,
    lag(${OUT}) over (partition by shipments.offer_id order by ${OUT}) as prev_out
  from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
  where ${scope(f, "shipments")} and ${RESOLVED} and ${anyWindow(f, OUT)}`;

/** Parcels per driver job, and the route-efficiency ratio: actual time between two consecutive stops ÷ the planned driving time of that leg. */
export async function jobFacts(f: ResolvedFilters) {
  const legOk = sql`p.status = 'delivered' and p.prev_out is not null and p.leg_duration_s > 0 and p.out_at > p.prev_out and p.out_at - p.prev_out <= interval '4 hours'`;
  const m: Record<string, Metric> = {
    del: (w) => sql`count(*) filter (where p.status = 'delivered' and ${w("p.out_at")})::int`,
    jobs: (w) => sql`count(distinct p.offer_id) filter (where p.status = 'delivered' and ${w("p.out_at")})::int`,
    actual: (w) => sql`coalesce(sum(${secsBetween(sql`p.prev_out`, sql`p.out_at`)}) filter (where ${legOk} and ${w("p.out_at")}), 0)::float8`,
    planned: (w) => sql`coalesce(sum(p.leg_duration_s) filter (where ${legOk} and ${w("p.out_at")}), 0)::float8`,
  };
  // Working time of a job = from the route approval (or the first hand-over) to its last outcome; implausible spans (< 15 min, > 16 h) are ignored.
  const hm: Record<string, Metric> = {
    n: (w) => sql`coalesce(sum(j.n) filter (where ${w("j.last_out")} and j.hrs between 0.25 and 16), 0)::float8`,
    hrs: (w) => sql`coalesce(sum(j.hrs) filter (where ${w("j.last_out")} and j.hrs between 0.25 and 16), 0)::float8`,
  };
  const [[r], [h]] = await Promise.all([rows<Row>(sql`select ${twinSelect(f, m)} from (${jobParcels(f)}) p`), rows<Row>(sql`select ${twinSelect(f, hm)} from (
    select p.offer_id, max(p.out_at) as last_out, count(*) filter (where p.status = 'delivered') as n,
      extract(epoch from (max(p.out_at) - coalesce(max(p.route_approved_at), min(p.first_loaded)))) / 3600 as hrs
    from (${jobParcels(f)}) p group by p.offer_id) j`)]);
  const g = (name: string) => twinRead(r, name);
  return { del: g("del"), jobs: g("jobs"), actual: g("actual"), planned: g("planned"), stopsN: twinRead(h, "n"), stopsHrs: twinRead(h, "hrs") };
}
export type JobFacts = Awaited<ReturnType<typeof jobFacts>>;
