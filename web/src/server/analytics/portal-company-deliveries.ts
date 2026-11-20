import { sql } from "drizzle-orm";
import { messageLog, shipments } from "@/db/schema";
import { anyWindow, inWindow, PARCEL_OUTCOME_AT, scope, twinSelect } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import type { Row } from "./portal-facts";
import { histogramFromRow, histogramSelect } from "./stats";

/** Delivery-quality queries of one company's parcels (everything owner-scoped through `scope()`; no recipient name, phone or address is ever selected). */
const FAILED = sql`shipments.status in ('failed','returned')`;
/** Hand-over → delivery (seconds): under 30 min, 30–60 min, 1–2 h, 2–4 h, 4–8 h, 8–24 h, 24 h or more. */
export const DELIVERY_EDGES = [1800, 3600, 7200, 14_400, 28_800, 86_400];

export interface CityRow { key: string; resolved: number; delivered: number; failed: number; prevResolved: number | null; prevFailed: number | null }
/** Parcel outcomes by the parcel's own city (current vs comparison period), busiest first. */
export async function cityOutcomes(f: ResolvedFilters): Promise<CityRow[]> {
  const r = await rows<Row>(sql`
    select shipments.city as k, ${twinSelect(f, {
      resolved: (w) => sql`count(*) filter (where shipments.status in ('delivered','failed','returned') and ${w(PARCEL_OUTCOME_AT)})::int`,
      delivered: (w) => sql`count(*) filter (where shipments.status = 'delivered' and ${w(PARCEL_OUTCOME_AT)})::int`,
      failed: (w) => sql`count(*) filter (where ${FAILED} and ${w(PARCEL_OUTCOME_AT)})::int`,
    })}
    from shipments join requests on requests.id = shipments.request_id
    where ${scope(f, "shipments")} and ${anyWindow(f, PARCEL_OUTCOME_AT)} group by shipments.city order by resolved_c desc, 1 limit 50`);
  return r.filter((x) => num(x.resolved_c) > 0 || num(x.resolved_p) > 0).map((x) => ({
    key: String(x.k ?? ""), resolved: num(x.resolved_c), delivered: num(x.delivered_c), failed: num(x.failed_c),
    prevResolved: f.prev ? num(x.resolved_p) : null, prevFailed: f.prev ? num(x.failed_p) : null,
  }));
}

export interface ReasonRow { key: string; count: number; prev: number | null }
/** Why parcels failed (a returned parcel keeps the reason it failed with), current vs comparison period. */
export async function failureReasons(f: ResolvedFilters): Promise<ReasonRow[]> {
  const r = await rows<Row>(sql`
    select coalesce(nullif(shipments.fail_reason, ''), 'other') as k, ${twinSelect(f, { n: (w) => sql`count(*) filter (where ${FAILED} and ${w(PARCEL_OUTCOME_AT)})::int` })}
    from shipments join requests on requests.id = shipments.request_id
    where ${scope(f, "shipments")} and ${anyWindow(f, PARCEL_OUTCOME_AT)} group by 1 order by n_c desc, 1 limit 20`);
  return r.map((x) => ({ key: String(x.k), count: num(x.n_c), prev: f.prev ? num(x.n_p) : null })).filter((x) => x.count > 0 || (x.prev ?? 0) > 0);
}

/** How long delivered parcels took from hand-over to the recipient (current period): histogram, median and 90th percentile. */
export async function deliveryTime(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    select count(*)::int as n, percentile_cont(0.5) within group (order by x.secs) as p50, percentile_cont(0.9) within group (order by x.secs) as p90, ${histogramSelect(sql`x.secs`, DELIVERY_EDGES, "h")}
    from (select extract(epoch from (shipments.delivered_at - shipments.loaded_at))::float8 as secs
      from shipments join requests on requests.id = shipments.request_id
      where ${scope(f, "shipments")} and shipments.status = 'delivered' and shipments.loaded_at is not null and shipments.delivered_at >= shipments.loaded_at and ${inWindow(shipments.deliveredAt, f.cur)}) x`);
  const p = (v: unknown) => (v == null ? null : Number(v));
  return { n: num(r?.n), p50: p(r?.p50), p90: p(r?.p90), histogram: histogramFromRow(r ?? {}, DELIVERY_EDGES) };
}

export const PROOFS = ["otp", "receipt", "none"] as const;
/** Delivered parcels by the proof that closed them (recipient code, signed / stamped receipt, or none recorded). */
export async function proofMix(f: ResolvedFilters) {
  const r = await rows<Row>(sql`
    select coalesce(shipments.proof_type, 'none') as k, count(*)::int as n from shipments join requests on requests.id = shipments.request_id
    where ${scope(f, "shipments")} and shipments.status = 'delivered' and ${inWindow(shipments.deliveredAt, f.cur)} group by 1`);
  const by = new Map(r.map((x) => [String(x.k), num(x.n)]));
  return PROOFS.map((k) => ({ key: k, n: by.get(k) ?? 0 }));
}

/** Parcels postponed once and what became of them, and the recipient-code problems among the parcels resolved in the period. */
export async function deferAndCodes(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    select count(*) filter (where shipments.defer_count > 0)::int as deferred,
      count(*) filter (where shipments.defer_count > 0 and shipments.status = 'delivered')::int as delivered_after,
      count(*) filter (where shipments.defer_count > 0 and ${FAILED})::int as failed_after,
      count(*) filter (where shipments.otp_attempts > 0)::int as wrong_code, count(*) filter (where shipments.otp_sends > 1)::int as resent, count(*) filter (where shipments.fail_reason = 'no_otp')::int as no_code,
      count(*)::int as resolved
    from shipments join requests on requests.id = shipments.request_id
    where ${scope(f, "shipments")} and shipments.status in ('delivered','failed','returned') and ${inWindow(PARCEL_OUTCOME_AT, f.cur)}`);
  return {
    defer: { deferred: num(r?.deferred), deliveredAfter: num(r?.delivered_after), failedAfter: num(r?.failed_after) },
    codes: { resolved: num(r?.resolved), wrongCode: num(r?.wrong_code), resent: num(r?.resent), noCode: num(r?.no_code) },
  };
}

/** Messages to the company's recipients in the period by delivery status. */
export async function smsStatus(f: ResolvedFilters) {
  const r = await rows<Row>(sql`
    select message_log.status as k, count(*)::int as n from message_log join requests on requests.id = message_log.request_id
    where ${scope(f, "requests")} and message_log.channel = 'sms' and message_log.type in ('recipient_code','recipient_track') and ${inWindow(messageLog.createdAt, f.cur)} group by 1 order by 2 desc, 1`);
  return r.map((x) => ({ key: String(x.k), n: num(x.n) }));
}

export interface ServedDriver { key: string; firstName: string; delivered: number; failed: number; rating: number | null }
/**
 * The drivers who carried the company's parcels, as the company may see them: FIRST NAME and rating only. No phone, no id (the key is a salted hash that only identifies the row),
 * so a company cannot look the person up or contact them outside the platform.
 */
export async function driversServed(f: ResolvedFilters, me: string): Promise<ServedDriver[]> {
  const r = await rows<Row>(sql`
    select substr(md5(offers.driver_id::text || ${me}), 1, 10) as k, split_part(btrim(u.name), ' ', 1) as first_name,
      count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*) filter (where ${FAILED})::int as failed,
      case when dp.rating_count > 0 then round(dp.rating_sum::numeric / dp.rating_count, 1)::float8 end as rating
    from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id join users u on u.id = offers.driver_id left join driver_profiles dp on dp.user_id = u.id
    where ${scope(f, "shipments")} and ${inWindow(PARCEL_OUTCOME_AT, f.cur)} and shipments.status in ('delivered','failed','returned')
    group by offers.driver_id, u.name, dp.rating_sum, dp.rating_count order by delivered desc, 1 limit 20`);
  return r.map((x) => ({ key: String(x.k), firstName: String(x.first_name ?? ""), delivered: num(x.delivered), failed: num(x.failed), rating: x.rating == null ? null : Number(x.rating) }));
}

/** Parcels that failed and are not yet marked as received back at the warehouse (as of now, any date): how many and how long they have been waiting. */
export async function returnsStock(f: ResolvedFilters) {
  const age = sql`coalesce(shipments.failed_at, shipments.updated_at)`;
  const [r] = await rows<Row>(sql`
    select count(*)::int as n, count(*) filter (where ${age} > now() - interval '3 days')::int as fresh,
      count(*) filter (where ${age} <= now() - interval '3 days' and ${age} > now() - interval '7 days')::int as mid, count(*) filter (where ${age} <= now() - interval '7 days')::int as old
    from shipments join requests on requests.id = shipments.request_id where ${scope(f, "shipments")} and shipments.status = 'failed'`);
  return { n: num(r?.n), fresh: num(r?.fresh), mid: num(r?.mid), old: num(r?.old) };
}
