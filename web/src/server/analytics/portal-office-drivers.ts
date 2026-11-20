import { sql, type SQL } from "drizzle-orm";
import { offers, ratings, requests, settlements } from "@/db/schema";
import { BILLED, inWindow, PARCEL_OUTCOME_AT, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { DRIVER_CANCELLED } from "./portal-office-facts";
import type { DriverScore } from "./portal-calc";
import type { Row } from "./portal-facts";

/**
 * One scorecard per driver of the office for the current period, as ONE query (the report's lists and the sortable scorecards table share it, so they always agree).
 * Only the office's own offers, the parcels carried on them and the settlements payable to the office are counted; drivers still linked to the office but without work in
 * the period appear with zeros (so idle drivers are visible), drivers that left appear only when they worked for the office in the period.
 */
export function scorecardsSql(f: ResolvedFilters, me: string, grace: number): SQL {
  const cur = f.cur;
  const limit = sql`requests.starts_at + make_interval(mins => ${grace}::int)`;
  const counted = sql`offers.accepted_at is not null and offers.status not in ('rejected','expired','cancelled','replaced')`;
  const accepted = sql`offers.accepted_at is not null and ${inWindow(offers.acceptedAt, cur)}`;
  const fleetOnly = f.driver.length ? sql`and driver_profiles.user_id in (${sql.join(f.driver.map((d) => sql`${d}::uuid`), sql`, `)})` : sql``;
  return sql`
    with j as (
      select offers.driver_id as id,
        count(*) filter (where ${accepted})::int as jobs,
        count(*) filter (where offers.status = 'completed' and ${accepted})::int as completed,
        count(*) filter (where offers.status = 'no_show' and ${accepted})::int as no_show,
        count(*) filter (where ${DRIVER_CANCELLED} and ${accepted})::int as cancelled,
        count(*) filter (where offers.status = 'replaced' and ${accepted})::int as replaced,
        count(*) filter (where offers.source = 'system' and ${inWindow(offers.createdAt, cur)} and (offers.accepted_at is not null or offers.status in ('rejected','expired')))::int as offers_made,
        count(*) filter (where offers.source = 'system' and offers.accepted_at is not null and ${inWindow(offers.createdAt, cur)})::int as offers_accepted,
        count(*) filter (where ${inWindow(requests.startsAt, cur)} and ${counted} and offers.arrived_at is not null and offers.arrived_at <= ${limit})::int as on_time,
        count(*) filter (where ${inWindow(requests.startsAt, cur)} and ${counted} and (offers.arrived_at is not null or offers.status = 'no_show' or now() > ${limit}))::int as due
      from offers join requests on requests.id = offers.request_id
      where ${scope(f, "offers")} and (${inWindow(offers.acceptedAt, cur)} or ${inWindow(offers.createdAt, cur)} or ${inWindow(requests.startsAt, cur)}) group by offers.driver_id),
    p as (
      select offers.driver_id as id, count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*) filter (where shipments.status = 'failed')::int as failed,
        count(*) filter (where shipments.status = 'returned')::int as returned
      from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
      where ${scope(f, "shipments")} and shipments.status in ('delivered','failed','returned') and ${inWindow(PARCEL_OUTCOME_AT, cur)} group by offers.driver_id),
    e as (
      select settlements.driver_id as id, coalesce(sum(settlements.provider_cents), 0)::float8 as earnings
      from settlements join requests on requests.id = settlements.request_id where ${scope(f, "settlements")} and ${BILLED} and ${inWindow(settlements.createdAt, cur)} group by settlements.driver_id),
    r as (
      select offers.driver_id as id, sum(ratings.stars)::int as rating_sum, count(*)::int as rating_n
      from ratings join offers on offers.id = ratings.offer_id join requests on requests.id = offers.request_id
      where ${scope(f, "offers")} and ratings.ratee_id = offers.driver_id and ${inWindow(ratings.createdAt, cur)} group by offers.driver_id),
    ids as (
      select id from j union select id from p union select id from e union select id from r
      union select driver_profiles.user_id from driver_profiles where driver_profiles.office_id = ${me} ${fleetOnly}),
    card as (
      select u.id, u.name, (fp.user_id is not null) as linked, u.city,
        coalesce(j.jobs, 0) as jobs, coalesce(j.completed, 0) as completed, coalesce(j.no_show, 0) as no_show, coalesce(j.cancelled, 0) as cancelled, coalesce(j.replaced, 0) as replaced,
        coalesce(j.offers_made, 0) as offers_made, coalesce(j.offers_accepted, 0) as offers_accepted, coalesce(j.on_time, 0) as on_time, coalesce(j.due, 0) as due,
        coalesce(p.delivered, 0) as delivered, coalesce(p.failed, 0) as failed, coalesce(p.returned, 0) as returned,
        coalesce(p.delivered, 0) + coalesce(p.failed, 0) + coalesce(p.returned, 0) as resolved,
        coalesce(e.earnings, 0) as earnings, coalesce(r.rating_sum, 0) as rating_sum, coalesce(r.rating_n, 0) as rating_n
      from ids join users u on u.id = ids.id left join driver_profiles fp on fp.user_id = u.id and fp.office_id = ${me}
        left join j on j.id = ids.id left join p on p.id = ids.id left join e on e.id = ids.id left join r on r.id = ids.id)`;
}
/** The select list that adds the derived rates to a `card` row (null when the denominator is 0: "no data", never 0%). */
export const CARD_RATES = sql`
  case when resolved > 0 then delivered::float8 / resolved end as success, case when due > 0 then on_time::float8 / due end as on_time_rate,
  case when offers_made > 0 then offers_accepted::float8 / offers_made end as acceptance, case when rating_n > 0 then rating_sum::float8 / rating_n end as rating`;

const toScore = (x: Row): DriverScore => ({
  id: String(x.id), name: String(x.name ?? ""), linked: !!x.linked, jobs: num(x.jobs), completed: num(x.completed), noShow: num(x.no_show), cancelled: num(x.cancelled), replaced: num(x.replaced),
  resolved: num(x.resolved), delivered: num(x.delivered), failed: num(x.failed), returned: num(x.returned), onTime: num(x.on_time), due: num(x.due), earnings: num(x.earnings),
  offersMade: num(x.offers_made), offersAccepted: num(x.offers_accepted), ratingSum: num(x.rating_sum), ratingN: num(x.rating_n),
});
/** The scorecards of the office's drivers for the period (at most 1000, busiest first). */
export async function driverScores(f: ResolvedFilters, me: string, grace: number): Promise<DriverScore[]> {
  const r = await rows<Row>(sql`${scorecardsSql(f, me, grace)} select * from card order by jobs desc, delivered desc, name, id limit 1000`);
  return r.map(toScore);
}
