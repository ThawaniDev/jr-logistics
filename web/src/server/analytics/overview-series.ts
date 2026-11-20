import { sql, type SQL } from "drizzle-orm";
import { requests, settlements } from "@/db/schema";
import { bucketSql, zeroFill, type Point } from "./buckets";
import { BILLED, inWindow, NOT_DRAFT, PARCEL_OUTCOME_AT, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { rows } from "./guard";
import type { Window } from "./periods";

/** One chart series: a point per bucket (zero-filled), plus the comparison period's points aligned by position (null without comparison). */
export interface Series<K extends string> { fields: K[]; points: Array<Point<K>>; prev: Array<Point<K>> | null }

async function build<K extends string>(f: ResolvedFilters, fields: K[], query: (w: Window) => SQL): Promise<Series<K>> {
  const read = async (w: Window, keys: string[]) => zeroFill(keys, await rows<{ t: string } & Partial<Record<K, unknown>>>(query(w)), fields);
  const [points, prev] = await Promise.all([read(f.cur, f.keys), f.prev && f.prevKeys ? read(f.prev, f.prevKeys) : null]);
  return { fields, points, prev };
}

export const REQUEST_FIELDS = ["total", "completed", "active", "cancelled", "expired"] as const;
/** Requests created per bucket, stacked by where they ended up (drafts are not orders). */
export const requestsSeries = (f: ResolvedFilters) => build(f, [...REQUEST_FIELDS], (w) => sql`
  select ${bucketSql(requests.createdAt, f.bucket)} as t, count(*)::int as total,
    count(*) filter (where requests.status = 'completed')::int as completed,
    count(*) filter (where requests.status in ('published','filling','assigned','confirmed','in_progress'))::int as active,
    count(*) filter (where requests.status = 'cancelled')::int as cancelled,
    count(*) filter (where requests.status = 'expired')::int as expired
  from requests where ${scope(f, "requests")} and ${NOT_DRAFT} and ${inWindow(requests.createdAt, w)} group by 1`);

export const PARCEL_FIELDS = ["delivered", "failed", "returned"] as const;
/** Parcels per bucket by outcome, on the day the outcome happened (the same rule as the delivered-parcels KPI). */
export const parcelsSeries = (f: ResolvedFilters) => build(f, [...PARCEL_FIELDS], (w) => sql`
  select ${bucketSql(PARCEL_OUTCOME_AT, f.bucket)} as t,
    count(*) filter (where shipments.status = 'delivered')::int as delivered,
    count(*) filter (where shipments.status = 'failed')::int as failed,
    count(*) filter (where shipments.status = 'returned')::int as returned
  from shipments join requests on requests.id = shipments.request_id
  where ${scope(f, "shipments")} and ${inWindow(PARCEL_OUTCOME_AT, w)} group by 1`);

/** Billed amount and platform margin per bucket (halalas), on the day the settlement was created. Money: only for `finance.view`. */
export const moneySeries = (f: ResolvedFilters) => build(f, ["gmv", "revenue"], (w) => sql`
  select ${bucketSql(settlements.createdAt, f.bucket)} as t, coalesce(sum(settlements.customer_cents), 0)::float8 as gmv, coalesce(sum(settlements.margin_cents), 0)::float8 as revenue
  from settlements join requests on requests.id = settlements.request_id
  where ${scope(f, "settlements")} and ${BILLED} and ${inWindow(settlements.createdAt, w)} group by 1`);
