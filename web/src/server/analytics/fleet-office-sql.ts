import { sql, type SQL } from "drizzle-orm";
import { auditLogs, officeInvites, offers } from "@/db/schema";
import { anyWindow, inWindow, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { twin, twinOrZero } from "./companies-lib";
import { PUSHED } from "./drivers-lib";
import { driverRows } from "./drivers-sql";
import { dxBase, fleetChain } from "./fleet-sql";
import { SETTLE_COLS, settlementsBy } from "./fleet-sql-money";
import { idList } from "./fleet-lib";

/**
 * `fp`: one row per courier office plus one "Independent drivers" row (`id = 'direct'`, no office), built from `dx`. Work, quality and time metrics are the sums of the office's drivers
 * (a driver belongs to the office he is linked to NOW); the settlement figures (earn, customer price, margin, VAT, refunds, adjustments, paid, pending) are keyed by `settlements.office_id`
 * — what the office was paid — so they tie to the Offices report. Columns: `id name city verification agreement fleet drivers_active_c links_c unlinks_c resp_p90_c` and every `<base>_c` of `dx`.
 * With an office filter only those offices are listed (no independent row); with a driver filter only the offices (or the independent bucket) that have such a driver.
 */
/** The money columns the office row takes from its settlements instead of summing its drivers. */
const OFFICE_KEYED = ["earn", ...SETTLE_COLS, "pending"];

export function officeChain(f: ResolvedFilters, money: boolean): SQL {
  const base = dxBase(money).filter((n) => !OFFICE_KEYED.includes(n));
  const nullable = ["radius_m", "route_m", "gps_m"];
  const sums = sql.join(base.flatMap((n) => {
    const c = `dx.${n}_c`, p = `dx.${n}_p`, z = nullable.includes(n);
    return [sql.raw(`${z ? `sum(${c})` : `coalesce(sum(${c}), 0)`}::float8 as ${n}_c`), sql.raw(`${f.prev ? (z ? `sum(${p})` : `coalesce(sum(${p}), 0)`) : `null`}::float8 as ${n}_p`)];
  }), sql`, `);
  const pick = sql.join(base.flatMap((n) => nullable.includes(n) ? [sql.raw(`oa.${n}_c`), sql.raw(`oa.${n}_p`)] : [sql.raw(`coalesce(oa.${n}_c, 0) as ${n}_c`), sql.raw(`${f.prev ? `coalesce(oa.${n}_p, 0)` : "null::float8"} as ${n}_p`)]), sql`, `);
  const keyed = money ? sql`${twinOrZero(f, "om", ["earn", ...SETTLE_COLS])}, coalesce(om.pending, 0) as pending_c, null::float8 as pending_p`
    : sql.join(OFFICE_KEYED.flatMap((n) => [sql.raw(`null::float8 as ${n}_c`), sql.raw(`null::float8 as ${n}_p`)]), sql`, `);
  const officeFilter = f.office.length ? sql` and u.id in (${idList(f.office)})` : sql``;
  const zeroLink = (n: string) => sql.raw(`0::float8 as ${n}_c, ${f.prev ? "0::float8" : "null::float8"} as ${n}_p`);
  return sql`
  fol as (select office_invites.office_id as id, ${twin(f, { links: (w) => sql`count(*) filter (where office_invites.status = 'accepted' and ${w(officeInvites.respondedAt)})::int` })}
    from office_invites where ${anyWindow(f, officeInvites.respondedAt)} group by office_invites.office_id),
  ful as (select audit_logs.actor_id as id, ${twin(f, { unlinks: (w) => sql`count(*) filter (where ${w(auditLogs.createdAt)})::int` })}
    from audit_logs where audit_logs.action = 'office.unlink_driver' and ${anyWindow(f, auditLogs.createdAt)} group by audit_logs.actor_id),
  fag as (select distinct on (office_id) office_id as id, status as agreement, expires_at as agreement_exp from office_agreements order by office_id, created_at desc),
  fo as (
    select u.id::text as id, coalesce(op.office_name, u.name) as name, coalesce(op.city, u.city) as city, coalesce(op.verification_status, 'pending') as verification,
      case when fag.agreement is null then 'none' when fag.agreement = 'accepted' and fag.agreement_exp is not null and fag.agreement_exp < now() then 'expired' else fag.agreement end as agreement,
      ${twinOrZero(f, "fol", ["links"])}, ${twinOrZero(f, "ful", ["unlinks"])}
    from users u left join office_profiles op on op.user_id = u.id left join fol on fol.id = u.id left join ful on ful.id = u.id left join fag on fag.id = u.id where u.role = 'office'${officeFilter}
    ${f.office.length ? sql`` : sql`union all select 'direct', null, null, null, null, ${zeroLink("links")}, ${zeroLink("unlinks")}`}
  ),
  oa as (
    select coalesce(dx.office_id::text, 'direct') as id, count(*)::int as fleet, count(*) filter (where dx.acc_c > 0 or dx.deliv_c + dx.fail_c + dx.ret_c > 0)::int as drivers_active_c, ${sums}
    from dx group by 1
  ),
  xq as (
    select coalesce(dd.office_id::text, 'direct') as id, percentile_cont(0.9) within group (order by extract(epoch from (offers.accepted_at - offers.created_at))) as resp_p90_c
    from offers join requests on requests.id = offers.request_id join dd on dd.id = offers.driver_id
    where ${scope(f, "offers")} and ${PUSHED} and offers.accepted_at is not null and ${inWindow(offers.createdAt, f.cur)} group by 1
  ),${money ? sql`
  om as (${settlementsBy(f, sql`coalesce(settlements.office_id::text, 'direct')`, false, true)}),` : sql``}
  fp as (
    select fo.*, coalesce(oa.fleet, 0) as fleet, coalesce(oa.drivers_active_c, 0) as drivers_active_c, xq.resp_p90_c, ${pick}, ${keyed}
    from fo left join oa on oa.id = fo.id left join xq on xq.id = fo.id${money ? sql` left join om on om.id = fo.id` : sql``}
    where ${f.driver.length ? sql`oa.id is not null` : sql`true`}
  )`;
}

/** `with <driverRows>, <fleetChain>, <officeChain> select …`: the select reads `fp` (offices) — every `<base>_c` column; see `fleet-metrics.ts` for the formulas. */
export const withFleetOffices = (f: ResolvedFilters, money: boolean, grace: number, select: SQL): SQL =>
  sql`with ${driverRows(f, money, grace, {})}, ${fleetChain(f, money, grace, {})}, ${officeChain(f, money)} ${select}`;
