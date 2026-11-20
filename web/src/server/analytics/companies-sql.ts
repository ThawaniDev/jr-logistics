import { sql, inArray, type SQL } from "drizzle-orm";
import { complaints, requests, settlements, shipments, tickets } from "@/db/schema";
import { anyWindow, BILLED, inWindow, NOT_DRAFT, PARCEL_OUTCOME_AT, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { asOfWindow, healthSql, tsz, twin, twinOrZero } from "./companies-lib";

/**
 * The per-company table every companies query reads (`with ${companyRows(...)} select … from d`). One row per company that has placed a request that matches the
 * filters up to the end of the period; columns (`_c` = this period, `_p` = comparison period, NULL without one):
 *   req cancelled-canc api  requests created (non-draft), cancelled, created through the API          deliv fail ret reg cod  parcels by outcome / registered / with cash on delivery
 *   gmv ord                 billed amount and settled requests (money; NULL columns without `money`) iss  tickets + complaints the company opened
 *   first_at last_c last_p  first request ever, last request before the end of this / the comparison period      orders_to_c / _p  requests before that moment
 *   before_c / _p           requests before the period started                                         silent_c / silent_p  days between the last request and the moment
 *   succ_c, gap_days, health_c, verification, located, city, name, signup_at, source
 * Never alias `requests`, `shipments`, `settlements`: `scope()` references them by name.
 */
export function companyRows(f: ResolvedFilters, money: boolean): SQL {
  const asOf = asOfWindow(f.cur), asOfP = f.prev ? asOfWindow(f.prev) : null;
  const created = sql`requests.created_at`;
  const pre = (d: Date | null, expr: (t: SQL) => SQL, none: SQL) => (d ? expr(tsz(d)) : none);
  const co = f.company.length ? sql`and ${inArray(tickets.openedBy, f.company)}` : sql``, coC = f.company.length ? sql`and ${inArray(complaints.filedBy, f.company)}` : sql``;
  return sql`
  rq as (
    select requests.business_id as id,
      ${twin(f, {
        req: (w) => sql`count(*) filter (where ${w(requests.createdAt)})::int`,
        canc: (w) => sql`count(*) filter (where ${w(requests.createdAt)} and requests.status = 'cancelled')::int`,
        api: (w) => sql`count(*) filter (where ${w(requests.createdAt)} and requests.created_via = 'api')::int`,
      })},
      count(*) filter (where ${created} < ${tsz(asOf)})::int as orders_to_c,
      ${pre(asOfP, (t) => sql`count(*) filter (where ${created} < ${t})::int`, sql`null::int`)} as orders_to_p,
      min(${created}) as first_at,
      max(${created}) filter (where ${created} < ${tsz(asOf)}) as last_c,
      ${pre(asOfP, (t) => sql`max(${created}) filter (where ${created} < ${t})`, sql`null::timestamptz`)} as last_p,
      count(*) filter (where ${created} < ${tsz(f.cur.start)})::int as before_c,
      ${pre(f.prev?.start ?? null, (t) => sql`count(*) filter (where ${created} < ${t})::int`, sql`null::int`)} as before_p
    from requests where ${scope(f, "requests")} and ${NOT_DRAFT} group by requests.business_id
  ),
  pc as (
    select requests.business_id as id, ${twin(f, {
      deliv: (w) => sql`count(*) filter (where shipments.status = 'delivered' and ${w(PARCEL_OUTCOME_AT)})::int`,
      fail: (w) => sql`count(*) filter (where shipments.status = 'failed' and ${w(PARCEL_OUTCOME_AT)})::int`,
      ret: (w) => sql`count(*) filter (where shipments.status = 'returned' and ${w(PARCEL_OUTCOME_AT)})::int`,
      reg: (w) => sql`count(*) filter (where ${w(shipments.createdAt)})::int`,
      cod: (w) => sql`count(*) filter (where ${w(shipments.createdAt)} and shipments.cod_cents > 0)::int`,
    })}
    from shipments join requests on requests.id = shipments.request_id
    where ${scope(f, "shipments")} and ${NOT_DRAFT} and ${anyWindow(f, PARCEL_OUTCOME_AT, shipments.createdAt)} group by requests.business_id
  ),
  st as (${money ? sql`
    select settlements.business_id as id, ${twin(f, {
      gmv: (w) => sql`coalesce(sum(settlements.customer_cents) filter (where ${w(settlements.createdAt)}), 0)::float8`,
      ord: (w) => sql`count(distinct settlements.request_id) filter (where ${w(settlements.createdAt)})::int`,
    })}
    from settlements join requests on requests.id = settlements.request_id
    where ${scope(f, "settlements")} and ${BILLED} and ${NOT_DRAFT} and ${anyWindow(f, settlements.createdAt)} group by settlements.business_id`
    : sql`select null::uuid as id, null::float8 as gmv_c, null::float8 as gmv_p, null::float8 as ord_c, null::float8 as ord_p where false`}
  ),
  sup as (
    select s.id, count(*)::int as iss_c from (
      select tickets.opened_by as id from tickets where ${inWindow(tickets.createdAt, f.cur)} ${co}
      union all select complaints.filed_by from complaints where ${inWindow(complaints.createdAt, f.cur)} ${coC}
    ) s group by s.id
  ),
  b as (select * from rq left join pc using (id) left join st using (id) left join sup using (id)),
  cr as (
    select b.id, b.first_at, b.last_c, b.last_p, b.orders_to_c, b.orders_to_p, b.before_c, b.before_p,
      ${twinOrZero(f, "b", ["req", "canc", "api", "deliv", "fail", "ret", "reg", "cod"])}, ${money ? twinOrZero(f, "b", ["gmv", "ord"]) : sql`null::float8 as gmv_c, null::float8 as gmv_p, null::float8 as ord_c, null::float8 as ord_p`},
      coalesce(b.iss_c, 0) as iss_c,
      coalesce(bp.company_name, u.name) as name, u.city as city, u.created_at as signup_at, u.source as source,
      coalesce(bp.verification_status, 'pending') as verification, (bp.warehouse_lat is not null and bp.warehouse_lng is not null) as located
    from b join users u on u.id = b.id left join business_profiles bp on bp.user_id = u.id where b.orders_to_c > 0
  ),
  d1 as (
    select cr.*,
      extract(epoch from (${tsz(asOf)} - last_c)) / 86400.0 as silent_c,
      ${asOfP ? sql`extract(epoch from (${tsz(asOfP)} - last_p)) / 86400.0` : sql`null::float8`} as silent_p,
      deliv_c::float8 / nullif(deliv_c + fail_c + ret_c, 0) as succ_c,
      case when orders_to_c >= 2 then extract(epoch from (last_c - first_at)) / 86400.0 / (orders_to_c - 1) end as gap_days
    from cr
  ),
  d as (select d1.*, ${healthSql(f.cur.days)} as health_c from d1)`;
}
/** `with <companyRows> select …` helper: wraps the rows CTE and the caller's final select. */
export const withCompanies = (f: ResolvedFilters, money: boolean, select: SQL): SQL => sql`with ${companyRows(f, money)} ${select}`;
