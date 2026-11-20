import { sql, type SQL } from "drizzle-orm";
import { offers } from "@/db/schema";
import { PARCEL_OUTCOME_AT, type Metric } from "./conditions";
import { KEPT, PUSHED, STARTS } from "./drivers-lib";
import { COUNTED, FLEET, haversineSql, stepOk, stepSec, validPin } from "./fleet-lib";

/**
 * The additive building blocks of the fleet metrics, grouped by the time anchor they share (a daily table groups each family by its own anchor; the per-driver chain `dx` reads
 * them together). Every entry is a sum or a count, so offices, totals and days are plain sums of them; averages and rates are formed on top (`fleet-metrics.ts`).
 * Time columns are seconds, distances metres. Never alias `offers`, `requests`, `shipments`.
 */
type W = Parameters<Metric>[0];
const secs = (a: SQL, b: SQL) => stepSec(a, b);

/** Offers the platform pushed, by creation: how they were answered. */
export const offeredFamily = (): Record<string, Metric> => {
  const pushed = (w: W) => sql`${w(offers.createdAt)} and ${PUSHED}`;
  const answered = (w: W) => sql`${pushed(w)} and offers.accepted_at is not null`;
  return {
    declined: (w) => sql`count(*) filter (where ${pushed(w)} and offers.status = 'rejected')::int`,
    timedout: (w) => sql`count(*) filter (where ${pushed(w)} and offers.status = 'expired')::int`,
    resp_sec: (w) => sql`coalesce(sum(${secs(sql`offers.created_at`, sql`offers.accepted_at`)}) filter (where ${answered(w)}), 0)::float8`,
    resp_n: (w) => sql`count(*) filter (where ${answered(w)})::int`,
  };
};

/** Start punctuality, by the request's start time: jobs that arrived at/before the start, after it within the grace, and after start + grace. */
export const startFamily = (grace: number): Record<string, Metric> => {
  const limit = sql`requests.starts_at + make_interval(mins => ${grace}::int)`;
  const arrived = (w: W) => sql`${w(STARTS)} and ${COUNTED} and offers.arrived_at is not null`;
  const cnt = (cond: SQL): Metric => (w) => sql`count(*) filter (where ${arrived(w)} and ${cond})::int`;
  const after = secs(sql`requests.starts_at`, sql`offers.arrived_at`), cap = sql.raw(String(FLEET.maxStepSec));
  // one job counts at most 16 hours early or late, so a request whose start time was never moved cannot swamp an average
  return {
    punctual: cnt(sql`offers.arrived_at <= requests.starts_at`),
    late: cnt(sql`offers.arrived_at > requests.starts_at and offers.arrived_at <= ${limit}`),
    very_late: cnt(sql`offers.arrived_at > ${limit}`),
    late_sec: (w) => sql`coalesce(sum(least(${cap}, ${after})) filter (where ${arrived(w)} and offers.arrived_at > requests.starts_at), 0)::float8`,
    delta_sec: (w) => sql`coalesce(sum(greatest(-${cap}, least(${cap}, ${after}))) filter (where ${arrived(w)}), 0)::float8`,
  };
};

/** Time at the warehouse and on the job, per kept job accepted in the period (a step with a missing or implausible timestamp pair is left out). */
export const jobFamily = (): Record<string, Metric> => {
  const kept = (w: W) => sql`${w(offers.acceptedAt)} and ${KEPT}`;
  const step = (name: string, a: SQL, b: SQL): Record<string, Metric> => ({
    [`${name}_sec`]: (w) => sql`coalesce(sum(${secs(a, b)}) filter (where ${kept(w)} and ${stepOk(a, b, FLEET.maxStepSec)}), 0)::float8`,
    [`${name}_n`]: (w) => sql`count(*) filter (where ${kept(w)} and ${stepOk(a, b, FLEET.maxStepSec)})::int`,
  });
  const cap = sql.raw(String(FLEET.maxStepSec));
  const jobOk = sql`offers.final_at is not null and offers.arrived_at is not null`;
  return {
    ...step("attend", sql`offers.arrived_at`, sql`offers.attendance_at`),
    ...step("load", sql`coalesce(offers.attendance_at, offers.arrived_at)`, sql`offers.loaded_at`),
    ...step("wait", sql`offers.arrived_at`, sql`offers.loaded_at`),
    ...step("plan", sql`offers.loaded_at`, sql`offers.route_approved_at`),
    job_sec: (w) => sql`coalesce(sum(least(${cap}, greatest(0, ${secs(sql`offers.arrived_at`, sql`offers.final_at`)}))) filter (where ${kept(w)} and ${jobOk}), 0)::float8`,
    job_n: (w) => sql`count(*) filter (where ${kept(w)} and ${jobOk})::int`,
  };
};

/** The delivered parcel's pin: where the driver recorded the delivery, else the destination pin. */
const dLat = sql`coalesce(shipments.delivered_lat, shipments.lat)`, dLng = sql`coalesce(shipments.delivered_lng, shipments.lng)`;
/** Parcels by outcome time: door time, load → delivered, distances, first attempt, deferrals, proof and COD parcels. `radius_m` / `route_m` are NULL when no parcel has the data. */
export const parcelFamily = (): Record<string, Metric> => {
  const done = (w: W) => sql`shipments.status = 'delivered' and ${w(PARCEL_OUTCOME_AT)}`;
  const step = (name: string, a: SQL, max: number): Record<string, Metric> => ({
    [`${name}_sec`]: (w) => sql`coalesce(sum(${secs(a, sql`shipments.delivered_at`)}) filter (where ${done(w)} and ${stepOk(a, sql`shipments.delivered_at`, max)}), 0)::float8`,
    [`${name}_n`]: (w) => sql`count(*) filter (where ${done(w)} and ${stepOk(a, sql`shipments.delivered_at`, max)})::int`,
  });
  const cnt = (cond: SQL): Metric => (w) => sql`count(*) filter (where ${done(w)} and ${cond})::int`;
  const radius = haversineSql(sql`requests.pickup_lat`, sql`requests.pickup_lng`, dLat, dLng);
  return {
    ...step("stop", sql`shipments.arrived_at`, FLEET.maxStopSec),
    ...step("parcel", sql`shipments.loaded_at`, FLEET.maxStepSec),
    radius_m: (w) => sql`sum(${radius}) filter (where ${done(w)} and ${validPin(sql`requests.pickup_lat`, sql`requests.pickup_lng`)} and ${validPin(dLat, dLng)})::float8`,
    route_m: (w) => sql`sum(shipments.leg_distance_m) filter (where ${done(w)} and shipments.leg_distance_m is not null)::float8`,
    first_att: cnt(sql`shipments.attempts <= 1`),
    deferrals: (w) => sql`coalesce(sum(shipments.defer_count) filter (where ${w(PARCEL_OUTCOME_AT)}), 0)::int`,
    proof_otp: cnt(sql`shipments.proof_type = 'otp'`),
    proof_receipt: cnt(sql`shipments.proof_type = 'receipt'`),
    cod_parcels: cnt(sql`shipments.cod_cents > 0`),
  };
};

export const names = (m: Record<string, Metric>): string[] => Object.keys(m);
/** The metrics whose total is NULL (not 0) when no row has the data. */
export const NULLABLE_PARCEL = ["radius_m", "route_m"] as const;
