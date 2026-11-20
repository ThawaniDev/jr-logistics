import { sql, type SQL } from "drizzle-orm";
import { requests, settlements, shipments } from "@/db/schema";
import { riyadhDow, riyadhHour } from "./buckets";
import { anyWindow, BILLED, inWindow, NOT_DRAFT, scope, twinRead, twinSelect } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { movers, withShare } from "./stats";

type Row = Record<string, unknown>;
const DIMS = ["city", "service", "vehicle", "channel"] as const;
export type Dim = (typeof DIMS)[number];
/** The grouping columns of the `base` CTEs below (an unset vehicle becomes the empty key). */
const BASE_COLS = sql`requests.delivery_city as city, requests.service as service, coalesce(requests.vehicle_type, '') as vehicle, requests.created_via as channel`;
const unionOf = (select: (dim: Dim) => SQL) => sql.join(DIMS.map((d) => select(d)), sql` union all `);

export interface BreakdownRow { key: string; requests: number; prevRequests: number | null; completed: number; cancelled: number; gmv: number | null; prevGmv: number | null; revenue: number | null; share: number | null }

/** Requests (created, completed, cancelled) and — with `money` — billed amount and margin per city, service, vehicle type and channel, current vs previous period. */
export async function breakdowns(f: ResolvedFilters, money: boolean): Promise<Record<Dim, BreakdownRow[]>> {
  const reqRows = await rows<Row>(sql`
    with base as (select ${BASE_COLS}, requests.status as status, requests.created_at as created_at from requests
      where ${scope(f, "requests")} and ${NOT_DRAFT} and ${anyWindow(f, requests.createdAt)})
    select * from (${unionOf((d) => sql`select ${sql.raw(`'${d}'`)} as dim, ${sql.raw(d)} as k, ${twinSelect(f, {
      req: (w) => sql`count(*) filter (where ${w("created_at")})::int`,
      done: (w) => sql`count(*) filter (where ${w("created_at")} and status = 'completed')::int`,
      cancel: (w) => sql`count(*) filter (where ${w("created_at")} and status = 'cancelled')::int`,
    })} from base group by ${sql.raw(d)}`)}) x`);
  const cashRows = money ? await rows<Row>(sql`
    with base as (select ${BASE_COLS}, settlements.customer_cents as customer, settlements.margin_cents as margin, settlements.created_at as created_at
      from settlements join requests on requests.id = settlements.request_id where ${scope(f, "settlements")} and ${BILLED} and ${anyWindow(f, settlements.createdAt)})
    select * from (${unionOf((d) => sql`select ${sql.raw(`'${d}'`)} as dim, ${sql.raw(d)} as k, ${twinSelect(f, {
      gmv: (w) => sql`coalesce(sum(customer) filter (where ${w("created_at")}), 0)::float8`,
      rev: (w) => sql`coalesce(sum(margin) filter (where ${w("created_at")}), 0)::float8`,
    })} from base group by ${sql.raw(d)}`)}) x`) : [];
  const cash = new Map(cashRows.map((r) => [`${r.dim}|${r.k}`, r]));
  const out = { city: [], service: [], vehicle: [], channel: [] } as Record<Dim, BreakdownRow[]>;
  const keys = new Set([...reqRows, ...cashRows].map((r) => `${r.dim}|${r.k}`));
  const seen = new Map(reqRows.map((r) => [`${r.dim}|${r.k}`, r]));
  for (const id of keys) {
    const [dim, key] = [id.slice(0, id.indexOf("|")) as Dim, id.slice(id.indexOf("|") + 1)];
    const r = seen.get(id), c = cash.get(id);
    const rq = twinRead(r, "req"), g = twinRead(c, "gmv"), v = twinRead(c, "rev");
    out[dim].push({ key, requests: rq.cur ?? 0, prevRequests: f.prev ? rq.prev ?? 0 : null, completed: twinRead(r, "done").cur ?? 0, cancelled: twinRead(r, "cancel").cur ?? 0, gmv: money ? g.cur ?? 0 : null, prevGmv: money && f.prev ? g.prev ?? 0 : null, revenue: money ? v.cur ?? 0 : null, share: null });
  }
  for (const d of DIMS) out[d] = withShare(out[d].sort((a, b) => b.requests - a.requests || (b.gmv ?? 0) - (a.gmv ?? 0) || a.key.localeCompare(b.key)), (r) => r.requests);
  return out;
}

/** Delivered parcels by Riyadh weekday (0 = Sunday) × hour (0–23) in the current period. */
export async function heatmap(f: ResolvedFilters) {
  const r = await rows<Row>(sql`
    select ${riyadhDow(shipments.deliveredAt)} as dow, ${riyadhHour(shipments.deliveredAt)} as hr, count(*)::int as n
    from shipments join requests on requests.id = shipments.request_id
    where ${scope(f, "shipments")} and shipments.status = 'delivered' and ${inWindow(shipments.deliveredAt, f.cur)} group by 1, 2`);
  const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const x of r) { const d = num(x.dow), h = num(x.hr); if (d >= 0 && d < 7 && h >= 0 && h < 24) cells[d][h] = num(x.n); }
  const total = cells.flat().reduce((s, n) => s + n, 0);
  return { cells, total, max: Math.max(0, ...cells.flat()) };
}

export interface CompanyRow { id: string; name: string; value: number; prev: number | null; orders: number | null }
/** Companies ranked by billed amount (`by: "gmv"`, finance) or by requests created (`by: "requests"`), with the previous period for the movers. Up to 1000 rows. */
export async function companyRanking(f: ResolvedFilters, money: boolean): Promise<{ by: "gmv" | "requests"; rows: CompanyRow[] }> {
  const metric = money ? "gmv" : "req";
  const order = f.prev ? sql`greatest(coalesce(${sql.raw(metric + "_c")}, 0), coalesce(${sql.raw(metric + "_p")}, 0))` : sql.raw(`${metric}_c`);
  const q = money ? sql`
    select settlements.business_id as id, coalesce(bp.company_name, u.name) as name, ${twinSelect(f, {
      gmv: (w) => sql`coalesce(sum(settlements.customer_cents) filter (where ${w(settlements.createdAt)}), 0)::float8`,
      orders: (w) => sql`count(distinct settlements.request_id) filter (where ${w(settlements.createdAt)})::int`,
    })}
    from settlements join requests on requests.id = settlements.request_id join users u on u.id = settlements.business_id left join business_profiles bp on bp.user_id = u.id
    where ${scope(f, "settlements")} and ${BILLED} and ${anyWindow(f, settlements.createdAt)} group by settlements.business_id, bp.company_name, u.name`
  : sql`
    select requests.business_id as id, coalesce(bp.company_name, u.name) as name, ${twinSelect(f, {
      req: (w) => sql`count(*) filter (where ${w(requests.createdAt)})::int`,
    })}
    from requests join users u on u.id = requests.business_id left join business_profiles bp on bp.user_id = u.id
    where ${scope(f, "requests")} and ${NOT_DRAFT} and ${anyWindow(f, requests.createdAt)} group by requests.business_id, bp.company_name, u.name`;
  const r = await rows<Row>(sql`select * from (${q}) x order by ${order} desc, id limit 1000`);
  return { by: money ? "gmv" : "requests", rows: r.map((x) => ({ id: String(x.id), name: String(x.name ?? ""), value: twinRead(x, metric).cur ?? 0, prev: f.prev ? twinRead(x, metric).prev ?? 0 : null, orders: money ? twinRead(x, "orders").cur ?? 0 : null })) };
}

export interface DriverRow { id: string; name: string; deliveries: number; prev: number | null; rating: number | null }
/** The 10 drivers with the most delivered parcels in the current period (previous period alongside) and their average rating. */
export async function driverRanking(f: ResolvedFilters): Promise<DriverRow[]> {
  const r = await rows<Row>(sql`
    select offers.driver_id as id, u.name as name, ${twinSelect(f, { del: (w) => sql`count(*) filter (where ${w(shipments.deliveredAt)})::int` })},
      case when dp.rating_count > 0 then dp.rating_sum::float8 / dp.rating_count end as rating
    from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id join users u on u.id = offers.driver_id left join driver_profiles dp on dp.user_id = u.id
    where ${scope(f, "shipments")} and shipments.status = 'delivered' and ${anyWindow(f, shipments.deliveredAt)}
    group by offers.driver_id, u.name, dp.rating_sum, dp.rating_count
    having count(*) filter (where ${inWindow(shipments.deliveredAt, f.cur)}) > 0
    order by del_c desc, offers.driver_id limit 10`);
  return r.map((x) => ({ id: String(x.id), name: String(x.name ?? ""), deliveries: twinRead(x, "del").cur ?? 0, prev: f.prev ? twinRead(x, "del").prev ?? 0 : null, rating: x.rating == null ? null : Math.round(Number(x.rating) * 100) / 100 }));
}

/** The 5 biggest increases and decreases among companies and among cities (same measure as the ranking: billed amount with finance access, requests otherwise). */
export function moversOf(f: ResolvedFilters, companies: { by: "gmv" | "requests"; rows: CompanyRow[] }, cities: BreakdownRow[], money: boolean) {
  if (!f.prev) return null;
  return {
    by: companies.by,
    companies: movers(companies.rows.map((c) => ({ id: c.id, name: c.name, cur: c.value, prev: c.prev ?? 0 })), 5),
    cities: movers(cities.map((c) => ({ id: c.key, name: c.key, cur: money ? c.gmv ?? 0 : c.requests, prev: money ? c.prevGmv ?? 0 : c.prevRequests ?? 0 })), 5),
  };
}
