import { sql, type SQL } from "drizzle-orm";
import { contains } from "@/lib/sql";
import { BILLED, inWindow, PARCEL_OUTCOME_AT, TRUE } from "./analytics/conditions";
import { KEPT } from "./analytics/drivers-lib";
import { PENDING_STATES } from "./analytics/offices-sql";
import { rows } from "./analytics/guard";
import { FD_BY_KEY, FD_COLS, SUMMABLE, type FdFilters, type Period, type SortSpec } from "./finance-drivers-lib";

/**
 * Finance › Drivers (J7) — the list query. ONE statement per request: `who` (the drivers the filters pick), one grouped aggregate per money source (settlements, wallet ledger adjustments,
 * withdrawals, cash collected, cash remitted, jobs, parcels — each restricted to `who`, so a narrow selection touches few rows), then `base` = one row per driver. The definitions are the
 * ones of the fleet money table (`GET /admin/analytics/drivers/table/money`): earned = Σ provider_cents of billed (not rejected) settlements, paid = settlements paid, pending =
 * pending_review / approved / batch_ready, cash collected = Σ cod_collected_cents, remitted = Σ cod_remittances, held = max(0, collected − remitted). Period figures use the Riyadh-day window.
 */
export const at = (col: SQL | { _: unknown }, p: Period): SQL => (p.start && p.end ? inWindow(col, { start: p.start, end: p.end }) : TRUE);
const IN_WHO = (col: string): SQL => sql.raw(`${col} in (select id from who)`);

/** `phone`: the search may match phone numbers. Without `drivers.sensitive` it must not (the number is masked in the answer, so searching it would reveal it digit by digit). */
export interface WhoOpts { id?: string; phone?: boolean }
/** The drivers a list shows: identity-level filters only (the aggregates below read just these). */
export function whoCte(f: FdFilters, o: WhoOpts = {}): SQL {
  const q = f.q ? contains(f.q) : null, id = o.id, phone = o.phone !== false;
  return sql`who as (
    select u.id from users u join driver_profiles dp on dp.user_id = u.id where u.role = 'driver'
      ${id ? sql`and u.id = ${id}` : sql``}
      ${q ? (phone ? sql`and (u.name ilike ${q} or u.username ilike ${q} or u.phone ilike ${q})` : sql`and (u.name ilike ${q} or u.username ilike ${q})`) : sql``}
      ${f.office === "independent" ? sql`and dp.office_id is null` : f.office ? sql`and dp.office_id = ${f.office}` : sql``}
      ${f.city ? sql`and u.city = ${f.city}` : sql``}
      ${f.status ? sql`and u.status = ${f.status}` : sql``}
  )`;
}

function moneyCtes(p: Period): SQL {
  return sql`
  st as (
    select settlements.driver_id as id,
      coalesce(sum(settlements.provider_cents) filter (where ${BILLED}), 0)::float8 as earned,
      coalesce(sum(settlements.provider_cents) filter (where settlements.status = 'paid'), 0)::float8 as paid,
      coalesce(sum(settlements.provider_cents) filter (where ${PENDING_STATES}), 0)::float8 as pending,
      coalesce(sum(settlements.provider_cents) filter (where settlements.status = 'failed'), 0)::float8 as payout_failed,
      coalesce(sum(settlements.refund_cents) filter (where ${BILLED}), 0)::float8 as refund,
      coalesce(sum(settlements.adjustment_cents) filter (where ${BILLED}), 0)::float8 as adjust,
      max(settlements.paid_at) filter (where settlements.status = 'paid') as last_payout_at,
      coalesce(sum(settlements.provider_cents) filter (where ${BILLED} and ${at(sql`settlements.created_at`, p)}), 0)::float8 as p_earned,
      coalesce(sum(settlements.provider_cents) filter (where settlements.status = 'paid' and ${at(sql`settlements.paid_at`, p)}), 0)::float8 as p_paid
    from settlements where ${IN_WHO("settlements.driver_id")} group by settlements.driver_id
  ),
  wa as (select wallet_accounts.owner_id as id, wallet_accounts.available_cents, wallet_accounts.held_cents from wallet_accounts where wallet_accounts.kind = 'user' and ${IN_WHO("wallet_accounts.owner_id")}),
  lg as (
    select wallet_accounts.owner_id as id,
      coalesce(sum(ledger_entries.available_delta_cents), 0)::float8 as wallet_adjust,
      coalesce(sum(-ledger_entries.available_delta_cents) filter (where ledger_entries.available_delta_cents < 0), 0)::float8 as penalties
    from ledger_entries join wallet_accounts on wallet_accounts.id = ledger_entries.account_id
    where ledger_entries.kind = 'adjustment' and wallet_accounts.kind = 'user' and ${IN_WHO("wallet_accounts.owner_id")} group by wallet_accounts.owner_id
  ),
  wd as (
    select withdrawals.user_id as id,
      coalesce(sum(amount_cents), 0)::float8 as wd_requested, count(*)::int as wd_requested_n,
      coalesce(sum(amount_cents) filter (where status = 'paid'), 0)::float8 as wd_paid, (count(*) filter (where status = 'paid'))::int as wd_paid_n,
      coalesce(sum(amount_cents) filter (where status in ('pending', 'approved')), 0)::float8 as wd_pending, (count(*) filter (where status in ('pending', 'approved')))::int as wd_pending_n,
      coalesce(sum(amount_cents) filter (where status = 'rejected'), 0)::float8 as wd_rejected, (count(*) filter (where status = 'rejected'))::int as wd_rejected_n
    from withdrawals where ${IN_WHO("withdrawals.user_id")} group by withdrawals.user_id
  ),
  cc as (
    select offers.driver_id as id, coalesce(sum(shipments.cod_collected_cents), 0)::float8 as cash_collected,
      coalesce(sum(shipments.cod_collected_cents) filter (where ${at(sql`shipments.cod_collected_at`, p)}), 0)::float8 as p_cash_collected
    from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
    where ${IN_WHO("offers.driver_id")} and requests.status <> 'draft' and shipments.cod_collected_cents is not null group by offers.driver_id
  ),
  cr as (
    select cod_remittances.driver_id as id, coalesce(sum(amount_cents), 0)::float8 as cash_remitted,
      coalesce(sum(amount_cents) filter (where ${at(sql`cod_remittances.created_at`, p)}), 0)::float8 as p_cash_remitted
    from cod_remittances where ${IN_WHO("cod_remittances.driver_id")} group by cod_remittances.driver_id
  )`;
}

function workCtes(p: Period): SQL {
  return sql`
  jb as (
    select offers.driver_id as id, (count(*) filter (where ${KEPT}))::int as jobs, (count(*) filter (where ${KEPT} and ${at(sql`offers.accepted_at`, p)}))::int as p_jobs,
      max(coalesce(offers.final_at, offers.delivered_at, offers.arrived_at, offers.accepted_at)) filter (where ${KEPT}) as last_job_at
    from offers where ${IN_WHO("offers.driver_id")} group by offers.driver_id
  ),
  pc as (
    select offers.driver_id as id, (count(*) filter (where shipments.status = 'delivered'))::int as delivered, (count(*) filter (where shipments.status = 'failed'))::int as failed,
      (count(*) filter (where shipments.status = 'returned'))::int as returned, (count(*) filter (where shipments.status = 'delivered' and ${at(PARCEL_OUTCOME_AT, p)}))::int as p_delivered
    from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
    where ${IN_WHO("offers.driver_id")} and requests.status <> 'draft' group by offers.driver_id
  )`;
}

/** `with who, <aggregates>, base as (…)`: splice a `select … from base` after it. */
export function baseChain(f: FdFilters, p: Period, o: WhoOpts = {}): SQL {
  const z = (col: string) => sql.raw(`coalesce(${col}, 0)`);
  return sql`with ${whoCte(f, o)}, ${moneyCtes(p)}, ${workCtes(p)},
  base as (
    select u.id, u.name, u.username, u.phone, u.city, u.status, dp.verification_status as verification, dp.office_id, coalesce(op.office_name, ou.name) as office_name, (dp.office_id is not null) as via_office,
      case when dp.office_id is null then coalesce(wa.available_cents, 0)::float8 end as wallet_available, case when dp.office_id is null then coalesce(wa.held_cents, 0)::float8 end as wallet_held,
      case when dp.office_id is null then ${z("st.pending")} end as wallet_pending,
      ${z("jb.jobs")} as jobs, ${z("pc.delivered")} as delivered, ${z("pc.failed")} as failed, ${z("pc.returned")} as returned,
      ${z("st.earned")} as earned, ${z("st.paid")} as paid, ${z("st.pending")} as pending, ${z("st.payout_failed")} as payout_failed, ${z("st.refund")} as refund, ${z("st.adjust")} as adjust,
      ${z("lg.wallet_adjust")} as wallet_adjust, ${z("lg.penalties")} as penalties,
      ${z("wd.wd_requested")} as wd_requested, ${z("wd.wd_paid")} as wd_paid, ${z("wd.wd_pending")} as wd_pending, ${z("wd.wd_rejected")} as wd_rejected,
      ${z("wd.wd_requested_n")} as wd_requested_n, ${z("wd.wd_paid_n")} as wd_paid_n, ${z("wd.wd_pending_n")} as wd_pending_n, ${z("wd.wd_rejected_n")} as wd_rejected_n,
      ${z("cc.cash_collected")} as cash_collected, ${z("cr.cash_remitted")} as cash_remitted, greatest(0, ${z("cc.cash_collected")} - ${z("cr.cash_remitted")})::float8 as cash_held,
      ${z("jb.p_jobs")} as p_jobs, ${z("pc.p_delivered")} as p_delivered, ${z("st.p_earned")} as p_earned, ${z("st.p_paid")} as p_paid,
      ${z("cc.p_cash_collected")} as p_cash_collected, ${z("cr.p_cash_remitted")} as p_cash_remitted, st.last_payout_at, jb.last_job_at
    from who join users u on u.id = who.id join driver_profiles dp on dp.user_id = u.id
      left join users ou on ou.id = dp.office_id left join office_profiles op on op.user_id = dp.office_id
      left join wa on wa.id = u.id left join st on st.id = u.id left join lg on lg.id = u.id left join wd on wd.id = u.id left join cc on cc.id = u.id left join cr on cr.id = u.id
      left join jb on jb.id = u.id left join pc on pc.id = u.id
  )`;
}

/** Conditions on the aggregated figures (cash held, pending payout). */
export const postFilter = (f: FdFilters): SQL => sql`where ${f.hasCash ? sql`cash_held > 0` : TRUE} and ${f.hasPending ? sql`pending > 0` : TRUE}`;
const SELECT = sql.join([sql.raw("id, office_id, via_office"), ...FD_COLS.map((c) => sql.raw(`"${c.db}"`))], sql`, `);
const sortExpr = (s: SortSpec): SQL => { const c = FD_BY_KEY.get(s.key)!; return sql.raw(c.kind === "text" || c.kind === "enum" ? `lower("${c.db}")` : `"${c.db}"`); };

export async function listDriverRecords(f: FdFilters, p: Period, sort: SortSpec, limit: number, offset: number, o: WhoOpts = {}) {
  return rows<Record<string, unknown>>(sql`${baseChain(f, p, o)} select ${SELECT} from base ${postFilter(f)}
    order by ${sortExpr(sort)} ${sql.raw(sort.dir)} nulls last, lower(name) asc, id asc limit ${limit} offset ${offset}`);
}
export async function driverTotals(f: FdFilters, p: Period, o: WhoOpts = {}) {
  const sums = sql.join(SUMMABLE.map((c) => sql.raw(`coalesce(sum("${c.db}"), 0)::float8 as "${c.db}"`)), sql`, `);
  const [r] = await rows<Record<string, unknown>>(sql`${baseChain(f, p, o)} select count(*)::int as n, ${sums} from base ${postFilter(f)}`);
  return r;
}
/** Offices that have drivers (the filter's options). */
export async function officeOptions() {
  return rows<{ id: string; name: string; drivers: number }>(sql`select dp.office_id as id, coalesce(op.office_name, ou.name) as name, count(*)::int as drivers
    from driver_profiles dp join users ou on ou.id = dp.office_id left join office_profiles op on op.user_id = dp.office_id where dp.office_id is not null group by dp.office_id, op.office_name, ou.name order by 2 limit 300`);
}
/** Cities the drivers live in (the filter's options). */
export async function cityOptions() {
  return rows<{ city: string }>(sql`select distinct u.city from users u join driver_profiles dp on dp.user_id = u.id where u.role = 'driver' and u.city is not null and u.city <> '' order by 1 limit 100`);
}
