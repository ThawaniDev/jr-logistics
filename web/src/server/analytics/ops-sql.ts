import { sql, type SQL } from "drizzle-orm";
import { SERVICES } from "../catalog";

/**
 * SQL fragments of the Operations and Geography reports. Like `conditions.ts` they use table-qualified names (`requests`, `offers`, `shipments` — never aliased) and
 * `bp` for `business_profiles` where noted. The meaning of each fragment is stated in the KPI definitions (`ops-defs.ts`); change both together.
 */
const DRIVERLESS = SERVICES.filter((s) => s.driverless).map((s) => s.key);
/** Requests that look for drivers (a vehicle rental without a driver has no slots to fill and no offers). */
export const DRIVEN = sql`requests.service not in (${sql.join(DRIVERLESS.map((k) => sql`${k}`), sql`, `)})`;
/** Driver slots the business asked for. A partly staffed request is later shrunk to what was staffed (`quantity = slots_filled`), the price snapshot keeps the original. */
export const SLOTS = sql`coalesce(round((requests.pricing_snapshot->>'quantity')::numeric)::int, requests.quantity)`;
export const FILLED = sql`least(requests.slots_filled, ${SLOTS})`;
/** Cancelled by its own business before any slot was filled: the demand was withdrawn, not left unserved. */
export const WITHDRAWN = sql`(requests.status = 'cancelled' and coalesce(requests.cancelled_by = requests.business_id, false) and requests.slots_filled = 0)`;
/** Still open and not yet due: it has not had its chance to fill. */
export const OPEN_FUTURE = sql`(requests.status in ('published','filling') and requests.starts_at > now())`;
/** The requests whose staffing outcome is known (counted by the fill KPIs). */
export const RESOLVED = sql`(not ${OPEN_FUTURE} and not ${WITHDRAWN})`;

/** Seconds from publishing to a milestone, null when the milestone is missing or before publishing. */
const gap = (t: SQL) => sql`case when ${t} >= requests.published_at then extract(epoch from (${t} - requests.published_at))::float8 end`;
/** The capture columns (migration 0012) with the offers as fallback for rows the capture missed. COALESCE only evaluates the sub-select when the column is null. */
export const G_OFFER = gap(sql`coalesce(requests.first_offer_at, (select min(o.created_at) from offers o where o.request_id = requests.id))`);
export const G_ACCEPT = gap(sql`coalesce(requests.first_accepted_at, (select min(o.accepted_at) from offers o where o.request_id = requests.id and o.accepted_at is not null))`);
export const G_FILL = gap(sql`coalesce(requests.filled_at, case when requests.slots_filled >= ${SLOTS} then (select (array_agg(o.accepted_at order by o.accepted_at))[${SLOTS}] from offers o where o.request_id = requests.id and o.accepted_at is not null) end)`);

/** An accepted job that was not withdrawn together with its request. */
export const COUNTED = sql`(offers.accepted_at is not null and offers.status not in ('rejected','expired','cancelled','replaced'))`;
/** Reasons written on the offers of a request that was cancelled / called off: the driver did not decide those. */
export const FOLLOW_ON = sql`('request_cancelled','not_fully_staffed')`;
/** An accepted job whose driver was lost afterwards (cancelled, no-show, replaced) so a replacement had to be found. */
export const LOST_JOB = sql`(offers.accepted_at is not null and (offers.status in ('no_show','replaced') or (offers.status = 'cancelled' and coalesce(offers.cancel_reason, '') not in ('request_cancelled','not_fully_staffed'))))`;
/** Start time plus the allowed grace (`settings.lateGraceMin`): the platform's start-SLA limit (`startSla` in server/ops.ts, the Overview's on-time KPI). */
export const startLimit = (grace: number) => sql`(requests.starts_at + make_interval(mins => ${grace}::int))`;
/** Jobs whose start (plus grace) has passed or whose driver already arrived; a no-show counts as due (and late). */
export const dueJob = (grace: number) => sql`(${COUNTED} and (offers.arrived_at is not null or offers.status = 'no_show' or now() > ${startLimit(grace)}))`;
export const onTimeJob = (grace: number) => sql`(${COUNTED} and offers.arrived_at is not null and offers.arrived_at <= ${startLimit(grace)})`;
export const lateJob = (grace: number) => sql`(${COUNTED} and ((offers.arrived_at is not null and offers.arrived_at > ${startLimit(grace)}) or offers.status = 'no_show' or (offers.arrived_at is null and now() > ${startLimit(grace)})))`;
/** Seconds the driver arrived after the start time (negative = early). */
export const DELAY_S = sql`extract(epoch from (offers.arrived_at - requests.starts_at))::float8`;

/** The warehouse pin: the request's own pickup pin, else the business's warehouse pin (needs `left join business_profiles bp on bp.user_id = requests.business_id`). */
export const PIN_LAT = sql`coalesce(requests.pickup_lat, bp.warehouse_lat)`;
export const PIN_LNG = sql`coalesce(requests.pickup_lng, bp.warehouse_lng)`;
/** Great-circle distance in metres between where the driver checked in and the warehouse pin (null when either is unknown). */
export const ARRIVAL_M = sql`(case when offers.arrived_lat is not null and offers.arrived_lng is not null and ${PIN_LAT} is not null and ${PIN_LNG} is not null then
  6371000 * 2 * asin(least(1, sqrt(power(sin(radians(offers.arrived_lat - ${PIN_LAT}) / 2), 2) + cos(radians(${PIN_LAT})) * cos(radians(offers.arrived_lat)) * power(sin(radians(offers.arrived_lng - ${PIN_LNG}) / 2), 2)))) end)`;
export const JOIN_PIN = sql`left join business_profiles bp on bp.user_id = requests.business_id`;

/** Seconds between two offer timestamps, null when either is missing or they are in the wrong order. */
export const secsBetween = (a: SQL, b: SQL) => sql`(case when ${a} is not null and ${b} is not null and ${b} >= ${a} then extract(epoch from (${b} - ${a}))::float8 end)`;
export const LOADING_S = secsBetween(sql`offers.arrived_at`, sql`offers.loaded_at`);
export const APPROVAL_S = secsBetween(sql`offers.loaded_at`, sql`offers.route_approved_at`);
/** The driver started working (route approved, or attendance confirmed for jobs without a route) → reported the work done. */
export const JOB_S = secsBetween(sql`coalesce(offers.route_approved_at, offers.attendance_at)`, sql`offers.delivered_at`);

export const WORK_DONE = sql`(offers.delivered_at is not null or offers.status in ('pending_settlement','completed'))`;
export const list = (xs: readonly string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
/** `count(*) filter (where …)::int as name` (aggregate select item). */
export const cnt = (cond: SQL, name: string) => sql`count(*) filter (where ${cond})::int as ${sql.raw(name)}`;
