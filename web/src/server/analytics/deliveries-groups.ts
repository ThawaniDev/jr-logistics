import { sql } from "drizzle-orm";
import { shipments } from "@/db/schema";
import { anyWindow, inWindow, PARCEL_OUTCOME_AT as OUT, scope, twinRead, twinSelect } from "./conditions";
import { namesOf, MIN_VOLUME, secsBetween, type Row } from "./finance-core";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { FROM } from "./deliveries-facts";
import { OTHERS } from "./deliveries-keys";

export const DIMS = ["city", "service", "vehicle", "company", "office", "driver"] as const;
export type Dim = (typeof DIMS)[number];
export interface GroupRow { dim: Dim; key: string; name: string | null; delivered: number; failed: number; resolved: number; prevDelivered: number | null; prevResolved: number | null; avgSecs: number | null }
const NAMED: readonly Dim[] = ["company", "office", "driver"];
const TOP = 30, WORST = 10;

/**
 * Parcels with an outcome per city, service, vehicle type, company, courier office and driver: delivered / failed counts (the previous period beside them), the
 * average delivery time, and for the long lists (companies, offices, drivers) only the busiest {TOP} plus the {WORST} lowest success rates among groups with at least
 * MIN_VOLUME resolved parcels, so a ranking never celebrates or blames a group on three parcels.
 */
export async function groups(f: ResolvedFilters): Promise<GroupRow[]> {
  const base = sql`select requests.delivery_city::text as city, requests.service::text as service, coalesce(requests.vehicle_type, '') as vehicle, requests.business_id::text as company,
      offers.office_id::text as office, offers.driver_id::text as driver, shipments.status as status, ${OUT} as out_at, ${secsBetween(shipments.loadedAt, shipments.deliveredAt)} as secs
    from shipments join requests on requests.id = shipments.request_id left join offers on offers.id = shipments.offer_id
    where ${scope(f, "shipments")} and shipments.status in ('delivered','failed','returned') and ${anyWindow(f, OUT)}`;
  const twin = twinSelect(f, {
    del: (w) => sql`count(*) filter (where status = 'delivered' and ${w("out_at")})::int`,
    res: (w) => sql`count(*) filter (where ${w("out_at")})::int`,
    fail: (w) => sql`count(*) filter (where status in ('failed','returned') and ${w("out_at")})::int`,
    secs: (w) => sql`avg(secs) filter (where status = 'delivered' and secs between 0 and 172800 and ${w("out_at")})::float8`,
  });
  const branch = (d: Dim) => sql`select ${sql.raw(`'${d}'`)} as dim, ${sql.raw(d)} as k, ${twin} from base where ${sql.raw(d)} is not null group by ${sql.raw(d)}`;
  const min = sql.raw(String(MIN_VOLUME));
  const r = await rows<Row>(sql`
    with base as (${base})
    select * from (
      select u.*, row_number() over (partition by u.dim order by u.res_c desc, u.k) as rv,
        case when u.res_c >= ${min} then row_number() over (partition by u.dim, (u.res_c >= ${min}) order by u.del_c::float8 / nullif(u.res_c, 0) asc, u.res_c desc, u.k) end as rw
      from (${sql.join(DIMS.map(branch), sql` union all `)}) u where u.res_c > 0
    ) x where x.rv <= ${sql.raw(String(TOP))} or x.rw <= ${sql.raw(String(WORST))}`);
  const names = await namesOf(r.filter((x) => NAMED.includes(x.dim as Dim)).map((x) => String(x.k)));
  return r.map((x) => {
    const dim = x.dim as Dim, key = String(x.k);
    return {
      dim, key, name: NAMED.includes(dim) ? names.get(key) ?? null : null, delivered: num(x.del_c), failed: num(x.fail_c), resolved: num(x.res_c),
      prevDelivered: f.prev ? twinRead(x, "del").prev ?? 0 : null, prevResolved: f.prev ? twinRead(x, "res").prev ?? 0 : null, avgSecs: twinRead(x, "secs").cur,
    };
  });
}

export interface ReasonRow { reason: string; n: number; prev: number | null }
export interface MatrixRow { key: string; name: string | null; total: number; by: Record<string, number> }
const REASON_KEYS = 5, MATRIX_ROWS = 8;

/** Why parcels were not delivered: overall (with the previous period), and by city and by company (the 15 companies with most failures). */
export async function failureReasons(f: ResolvedFilters) {
  const twin = twinSelect(f, { n: (w) => sql`count(*) filter (where ${w("out_at")})::int` });
  const r = await rows<Row>(sql`
    with b as (select shipments.fail_reason as reason, requests.delivery_city::text as city, requests.business_id::text as company, ${OUT} as out_at ${FROM}
      where ${scope(f, "shipments")} and shipments.status in ('failed','returned') and shipments.fail_reason is not null and ${anyWindow(f, OUT)})
    select 'all' as dim, '' as k, reason, ${twin} from b group by reason
    union all select 'city', city, reason, ${twin} from b where city is not null group by city, reason
    union all select 'company', company, reason, ${twin} from b where company in (select company from b where ${inWindow("out_at", f.cur)} group by company order by count(*) desc limit 15) group by company, reason`);
  const all: ReasonRow[] = r.filter((x) => x.dim === "all").map((x) => ({ reason: String(x.reason), n: num(x.n_c), prev: f.prev ? twinRead(x, "n").prev ?? 0 : null })).filter((x) => x.n > 0 || (x.prev ?? 0) > 0).sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason));
  const top = all.slice(0, REASON_KEYS).map((x) => x.reason);
  const matrix = (dim: "city" | "company"): MatrixRow[] => {
    const m = new Map<string, MatrixRow>();
    for (const x of r.filter((y) => y.dim === dim && num(y.n_c) > 0)) {
      const row = m.get(String(x.k)) ?? { key: String(x.k), name: null, total: 0, by: {} };
      const reason = top.includes(String(x.reason)) ? String(x.reason) : OTHERS;
      row.by[reason] = (row.by[reason] ?? 0) + num(x.n_c); row.total += num(x.n_c); m.set(row.key, row);
    }
    return [...m.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key)).slice(0, MATRIX_ROWS);
  };
  const byCity = matrix("city"), byCompany = matrix("company");
  const names = await namesOf(byCompany.map((x) => x.key));
  for (const c of byCompany) c.name = names.get(c.key) ?? null;
  return { all, top, byCity, byCompany };
}
export type Reasons = Awaited<ReturnType<typeof failureReasons>>;
