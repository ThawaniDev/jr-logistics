import { sql, type SQL } from "drizzle-orm";
import { auditLogs, offers, officeInvites, ratings, settlements } from "@/db/schema";
import { anyWindow, BILLED, NOT_DRAFT, PARCEL_OUTCOME_AT, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { twin, twinOrZero } from "./companies-lib";
import { KEPT, punctuality, STARTS } from "./drivers-lib";

/** Settlement states that are earned but not paid yet. */
export const PENDING_STATES = sql`settlements.status in ('pending_review','approved','batch_ready')`;
const ids = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

/**
 * The per-office table every offices query reads (`with ${officeRows(...)} select … from od`). One row per courier-office account (an office filter narrows it).
 * Work is attributed to the office the driver belonged to when the offer was made (`offers.office_id`, the payee). `_c` = this period, `_p` = the comparison period.
 *   acc jobs drv      offers accepted in the period (by acceptance), the ones kept, distinct drivers who accepted        due ontime  punctuality (by the request's start)
 *   deliv fail ret    parcels by outcome time · rn rsum  ratings the office's drivers received and their stars         earned paid  provider amount settled (by creation) / paid out (by payment) (money)
 *   pending           earned but not paid yet, as of now (money) · fleet verified_n avail_n  drivers affiliated now, verified, available · links unlinks  drivers who joined / left in the period
 *   agreement agreement_exp  latest agreement state and expiry · succ_c ontime_rate_c rating_c util_c (ratios, NULL without a base)
 */
export function officeRows(f: ResolvedFilters, money: boolean, grace: number): SQL {
  const { due, ontime } = punctuality(grace);
  const drvCond = f.driver.length ? sql`and dp.user_id in (${ids(f.driver)})` : sql``;
  return sql`
  ow as (
    select offers.office_id as id, ${twin(f, {
      acc: (w) => sql`count(*) filter (where ${w(offers.acceptedAt)})::int`,
      jobs: (w) => sql`count(*) filter (where ${w(offers.acceptedAt)} and ${KEPT})::int`,
      drv: (w) => sql`count(distinct offers.driver_id) filter (where ${w(offers.acceptedAt)})::int`,
      due, ontime,
    })}
    from offers join requests on requests.id = offers.request_id
    where ${scope(f, "offers")} and offers.office_id is not null and ${anyWindow(f, offers.acceptedAt, STARTS)} group by offers.office_id
  ),
  pw as (
    select offers.office_id as id, ${twin(f, {
      deliv: (w) => sql`count(*) filter (where shipments.status = 'delivered' and ${w(PARCEL_OUTCOME_AT)})::int`,
      fail: (w) => sql`count(*) filter (where shipments.status = 'failed' and ${w(PARCEL_OUTCOME_AT)})::int`,
      ret: (w) => sql`count(*) filter (where shipments.status = 'returned' and ${w(PARCEL_OUTCOME_AT)})::int`,
    })}
    from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
    where ${scope(f, "shipments")} and offers.office_id is not null and ${NOT_DRAFT} and ${anyWindow(f, PARCEL_OUTCOME_AT)} group by offers.office_id
  ),
  rw as (
    select offers.office_id as id, ${twin(f, { rn: (w) => sql`count(*) filter (where ${w(ratings.createdAt)})::int`, rsum: (w) => sql`coalesce(sum(ratings.stars) filter (where ${w(ratings.createdAt)}), 0)::float8` })}
    from ratings join offers on offers.id = ratings.offer_id join requests on requests.id = offers.request_id
    where ratings.ratee_id = offers.driver_id and ${scope(f, "offers")} and offers.office_id is not null and ${anyWindow(f, ratings.createdAt)} group by offers.office_id
  ),
  ew as (${money ? sql`
    select settlements.office_id as id, ${twin(f, {
      earned: (w) => sql`coalesce(sum(settlements.provider_cents) filter (where ${w(settlements.createdAt)}), 0)::float8`,
      paid: (w) => sql`coalesce(sum(settlements.provider_cents) filter (where settlements.status = 'paid' and ${w(settlements.paidAt)}), 0)::float8`,
    })},
      coalesce(sum(settlements.provider_cents) filter (where ${PENDING_STATES}), 0)::float8 as pending
    from settlements join requests on requests.id = settlements.request_id
    where ${scope(f, "settlements")} and settlements.office_id is not null and ${BILLED} and (${anyWindow(f, settlements.createdAt, settlements.paidAt)} or ${PENDING_STATES}) group by settlements.office_id`
    : sql`select null::uuid as id, null::float8 as earned_c, null::float8 as earned_p, null::float8 as paid_c, null::float8 as paid_p, null::float8 as pending where false`}
  ),
  fl as (
    select dp.office_id as id, count(*)::int as fleet, count(*) filter (where dp.verification_status = 'verified')::int as verified_n, count(*) filter (where dp.availability = 'available')::int as avail_n
    from driver_profiles dp where dp.office_id is not null ${drvCond} group by dp.office_id
  ),
  lk as (
    select office_invites.office_id as id, ${twin(f, { links: (w) => sql`count(*) filter (where office_invites.status = 'accepted' and ${w(officeInvites.respondedAt)})::int` })}
    from office_invites where ${anyWindow(f, officeInvites.respondedAt)} group by office_invites.office_id
  ),
  ul as (
    select audit_logs.actor_id as id, ${twin(f, { unlinks: (w) => sql`count(*) filter (where ${w(auditLogs.createdAt)})::int` })}
    from audit_logs where audit_logs.action = 'office.unlink_driver' and ${anyWindow(f, auditLogs.createdAt)} group by audit_logs.actor_id
  ),
  ag as (select distinct on (office_id) office_id as id, status as agreement, expires_at as agreement_exp from office_agreements order by office_id, created_at desc),
  od0 as (
    select u.id, coalesce(op.office_name, u.name) as name, coalesce(op.city, u.city) as city, u.status as user_status, u.created_at as signup_at, coalesce(op.verification_status, 'pending') as verification,
      ${twinOrZero(f, "ow", ["acc", "jobs", "drv", "due", "ontime"])}, ${twinOrZero(f, "pw", ["deliv", "fail", "ret"])}, ${twinOrZero(f, "rw", ["rn", "rsum"])},
      ${money ? sql`${twinOrZero(f, "ew", ["earned", "paid"])}, coalesce(ew.pending, 0) as pending` : sql`null::float8 as earned_c, null::float8 as earned_p, null::float8 as paid_c, null::float8 as paid_p, null::float8 as pending`},
      coalesce(fl.fleet, 0) as fleet, coalesce(fl.verified_n, 0) as verified_n, coalesce(fl.avail_n, 0) as avail_n,
      ${twinOrZero(f, "lk", ["links"])}, ${twinOrZero(f, "ul", ["unlinks"])}, ag.agreement,
      case when ag.agreement is null then 'none' when ag.agreement = 'accepted' and ag.agreement_exp is not null and ag.agreement_exp < now() then 'expired' else ag.agreement end as agreement_state
    from users u left join office_profiles op on op.user_id = u.id left join ow on ow.id = u.id left join pw on pw.id = u.id left join rw on rw.id = u.id left join ew on ew.id = u.id
      left join fl on fl.id = u.id left join lk on lk.id = u.id left join ul on ul.id = u.id left join ag on ag.id = u.id
    where u.role = 'office' ${f.office.length ? sql`and u.id in (${ids(f.office)})` : sql``}
  ),
  od as (
    select od0.*, deliv_c::float8 / nullif(deliv_c + fail_c + ret_c, 0) as succ_c, ontime_c::float8 / nullif(due_c, 0) as ontime_rate_c, rsum_c / nullif(rn_c, 0) as rating_c, least(1, drv_c::float8 / nullif(fleet, 0)) as util_c
    from od0
  )`;
}
/** `with <officeRows> select …`. */
export const withOffices = (f: ResolvedFilters, money: boolean, grace: number, select: SQL): SQL => sql`with ${officeRows(f, money, grace)} ${select}`;
