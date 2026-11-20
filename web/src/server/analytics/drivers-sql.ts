import { sql, type SQL } from "drizzle-orm";
import { offers, ratings, settlements } from "@/db/schema";
import { anyWindow, BILLED, NOT_DRAFT, PARCEL_OUTCOME_AT, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { tsz, twin, twinOrZero } from "./companies-lib";
import { DRIVER_CANCELLED, flagCountSql, flagListSql, flagReasonSql, KEPT, MAX_BUSY_SECONDS, punctuality, PUSHED, STARTS } from "./drivers-lib";
import type { Window } from "./periods";

const ids = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
/**
 * The per-driver table every drivers query reads (`with ${driverRows(...)} select … from dd`). One row per driver account (a driver or office filter narrows who is in it);
 * `_c` = this period, `_p` = the comparison period (NULL without one). Columns:
 *   offered answered accepted  offers the platform pushed (by creation date), the ones answered (accepted, rejected or expired) and accepted      resp_p50  median seconds to accept
 *   acc jobs cancelled noshow replaced  offers accepted in the period (by acceptance), the ones kept, cancelled by the driver, no-shows, replaced by staff or the office
 *   due ontime              jobs due to have started by start + grace, and arrived in time (by the request's start)        busy  seconds from arrival to the final report (≤ 16 h a job)
 *   deliv fail ret          parcels resolved (by outcome time) · rn rsum  ratings received and their stars · earn  provider amount settled (money) · online  seconds available
 *   succ_c, accept_c, cancel_c, ontime_c, rating_c, util_c (ratios, NULL without a base) · flags, reason, reasons (reliability flags) · suspended_now
 * Never alias `offers`, `requests`, `shipments`, `settlements`.
 */
export function driverRows(f: ResolvedFilters, money: boolean, grace: number, opts: { officeOnly?: boolean } = {}): SQL {
  const { due, ontime } = punctuality(grace);
  const oo = { offers: opts.officeOnly ? sql` and offers.office_id is not null` : sql``, settlements: opts.officeOnly ? sql` and settlements.office_id is not null` : sql`` };
  const maxEnd = f.prev && f.prev.end > f.cur.end ? f.prev.end : f.cur.end;
  const overlap = (w: Window | null) => (w ? sql`coalesce(sum(greatest(0, extract(epoch from (least(iv.e, ${tsz(w.end)}) - greatest(iv.s, ${tsz(w.start)}))))) filter (where iv.st = 'available'), 0)::float8` : sql`null::float8`);
  const logDrivers = f.driver.length ? sql`and l.driver_id in (${ids(f.driver)})` : sql``;
  const logOffice = f.office.length ? sql`and l.driver_id in (select user_id from driver_profiles where office_id in (${ids(f.office)}))` : sql``;
  return sql`
  ow as (
    select offers.driver_id as id,
      ${twin(f, {
        offered: (w) => sql`count(*) filter (where ${w(offers.createdAt)} and ${PUSHED})::int`,
        answered: (w) => sql`count(*) filter (where ${w(offers.createdAt)} and ${PUSHED} and (offers.accepted_at is not null or offers.status in ('rejected','expired')))::int`,
        accepted: (w) => sql`count(*) filter (where ${w(offers.createdAt)} and ${PUSHED} and offers.accepted_at is not null)::int`,
        acc: (w) => sql`count(*) filter (where ${w(offers.acceptedAt)})::int`,
        jobs: (w) => sql`count(*) filter (where ${w(offers.acceptedAt)} and ${KEPT})::int`,
        cancelled: (w) => sql`count(*) filter (where ${w(offers.acceptedAt)} and ${DRIVER_CANCELLED})::int`,
        noshow: (w) => sql`count(*) filter (where ${w(offers.acceptedAt)} and offers.status = 'no_show')::int`,
        replaced: (w) => sql`count(*) filter (where ${w(offers.acceptedAt)} and offers.status = 'replaced')::int`,
        due, ontime,
        busy: (w) => sql`coalesce(sum(least(${sql.raw(String(MAX_BUSY_SECONDS))}, greatest(0, extract(epoch from (coalesce(offers.final_at, offers.delivered_at, offers.updated_at) - offers.arrived_at)))))
          filter (where ${w(offers.acceptedAt)} and ${KEPT} and offers.arrived_at is not null), 0)::float8`,
      })},
      percentile_cont(0.5) within group (order by extract(epoch from (offers.accepted_at - offers.created_at))) filter (where offers.accepted_at is not null and ${PUSHED} and offers.created_at >= ${tsz(f.cur.start)} and offers.created_at < ${tsz(f.cur.end)}) as resp_p50
    from offers join requests on requests.id = offers.request_id
    where ${scope(f, "offers")}${oo.offers} and ${anyWindow(f, offers.createdAt, offers.acceptedAt, STARTS)} group by offers.driver_id
  ),
  pw as (
    select offers.driver_id as id, ${twin(f, {
      deliv: (w) => sql`count(*) filter (where shipments.status = 'delivered' and ${w(PARCEL_OUTCOME_AT)})::int`,
      fail: (w) => sql`count(*) filter (where shipments.status = 'failed' and ${w(PARCEL_OUTCOME_AT)})::int`,
      ret: (w) => sql`count(*) filter (where shipments.status = 'returned' and ${w(PARCEL_OUTCOME_AT)})::int`,
    })}
    from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
    where ${scope(f, "shipments")}${oo.offers} and ${NOT_DRAFT} and ${anyWindow(f, PARCEL_OUTCOME_AT)} group by offers.driver_id
  ),
  rw as (
    select ratings.ratee_id as id, ${twin(f, { rn: (w) => sql`count(*) filter (where ${w(ratings.createdAt)})::int`, rsum: (w) => sql`coalesce(sum(ratings.stars) filter (where ${w(ratings.createdAt)}), 0)::float8` })}
    from ratings join offers on offers.id = ratings.offer_id join requests on requests.id = offers.request_id
    where ratings.ratee_id = offers.driver_id and ${scope(f, "offers")}${oo.offers} and ${anyWindow(f, ratings.createdAt)} group by ratings.ratee_id
  ),
  ew as (${money ? sql`
    select settlements.driver_id as id, ${twin(f, { earn: (w) => sql`coalesce(sum(settlements.provider_cents) filter (where ${w(settlements.createdAt)}), 0)::float8` })}
    from settlements join requests on requests.id = settlements.request_id
    where ${scope(f, "settlements")}${oo.settlements} and ${BILLED} and ${anyWindow(f, settlements.createdAt)} group by settlements.driver_id`
    : sql`select null::uuid as id, null::float8 as earn_c, null::float8 as earn_p where false`}
  ),
  iv as (
    select l.driver_id as id, l.at as s, coalesce(lead(l.at) over (partition by l.driver_id order by l.at), now()) as e, l.to_status as st
    from driver_availability_log l where l.at < ${tsz(maxEnd)} ${logDrivers} ${logOffice}
  ),
  av as (select iv.id, ${overlap(f.cur)} as online_c, ${overlap(f.prev)} as online_p from iv group by iv.id),
  dr as (
    select u.id, u.name, u.phone, dp.national_id, coalesce(op.office_name, ou.name) as office_name, u.city, u.status as user_status, u.created_at as signup_at, u.last_seen_at, dp.vehicle_type as vehicle, dp.verification_status as verification, dp.availability,
      dp.office_id, dp.suspended_until, (dp.suspended_until is not null and dp.suspended_until > now()) as suspended_now, dp.rating_sum, dp.rating_count, dp.jobs_completed,
      ${twinOrZero(f, "ow", ["offered", "answered", "accepted", "acc", "jobs", "cancelled", "noshow", "replaced", "due", "ontime", "busy"])}, ow.resp_p50,
      ${twinOrZero(f, "pw", ["deliv", "fail", "ret"])}, ${twinOrZero(f, "rw", ["rn", "rsum"])},
      ${money ? twinOrZero(f, "ew", ["earn"]) : sql`null::float8 as earn_c, null::float8 as earn_p`},
      coalesce(av.online_c, 0) as online_c, ${f.prev ? sql`coalesce(av.online_p, 0)` : sql`null::float8`} as online_p
    from users u join driver_profiles dp on dp.user_id = u.id left join users ou on ou.id = dp.office_id left join office_profiles op on op.user_id = dp.office_id
      left join ow on ow.id = u.id left join pw on pw.id = u.id left join rw on rw.id = u.id left join ew on ew.id = u.id left join av on av.id = u.id
    where u.role = 'driver' ${f.driver.length ? sql`and u.id in (${ids(f.driver)})` : sql``}
      ${f.office.length ? sql`and (dp.office_id in (${ids(f.office)}) or ow.id is not null)` : sql``}
  ),
  dd as (
    select dr.*,
      deliv_c::float8 / nullif(deliv_c + fail_c + ret_c, 0) as succ_c, accepted_c::float8 / nullif(answered_c, 0) as accept_c, (cancelled_c + noshow_c)::float8 / nullif(acc_c, 0) as cancel_c,
      ontime_c::float8 / nullif(due_c, 0) as ontime_rate_c, rsum_c / nullif(rn_c, 0) as rating_c, least(busy_c, online_c) / nullif(online_c, 0) as util_c,
      (${flagCountSql()})::int as flags, ${flagReasonSql()} as reason, ${flagListSql()} as reasons
    from dr
  )`;
}
/** `with <driverRows> select …`. `grace` = Settings › late grace minutes. */
export const withDrivers = (f: ResolvedFilters, money: boolean, grace: number, select: SQL, opts: { officeOnly?: boolean } = {}): SQL => sql`with ${driverRows(f, money, grace, opts)} ${select}`;
/** A driver who did anything in the period: offers, jobs, ratings, parcels or online time. */
export const ACTIVE_ANY = sql`(offered_c > 0 or acc_c > 0 or rn_c > 0 or online_c > 0 or deliv_c + fail_c + ret_c > 0)`;
