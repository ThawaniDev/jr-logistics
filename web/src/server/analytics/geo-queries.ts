import { sql, type SQL } from "drizzle-orm";
import { offers, requests, settlements, shipments } from "@/db/schema";
import { bucketSql } from "./buckets";
import { anyWindow, BILLED, inWindow, NOT_DRAFT, PARCEL_OUTCOME_AT, scope, twinRead, twinSelect, type Metric } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { rows } from "./guard";
import { blankCity, finishCities, GRID_DEG, type Cell, type CityRow } from "./geo-lib";
import { safeDiv } from "./kpi";
import { DRIVEN, FILLED, RESOLVED, SLOTS } from "./ops-sql";
import { buildSeries } from "./ops-series";
import { asNum, type Row } from "./ops-util";

/** Seconds a delivered parcel spent between being loaded on the vehicle and being handed over (null for parcels without a load time). */
const DELIVERY_S = sql`extract(epoch from (shipments.delivered_at - shipments.loaded_at))`;
const DELIVERED_TIMED = sql`shipments.status = 'delivered' and shipments.loaded_at is not null and shipments.delivered_at >= shipments.loaded_at`;
type W = Parameters<Metric>[0];

/** The parcel metrics every Geography query shares (twin windows): registered by creation time, outcomes by `PARCEL_OUTCOME_AT`, delivery time of delivered parcels. */
const parcelMetrics = {
  registered: (w: W) => sql`count(*) filter (where ${w(shipments.createdAt)})::int`,
  delivered: (w: W) => sql`count(*) filter (where shipments.status = 'delivered' and ${w(PARCEL_OUTCOME_AT)})::int`,
  failed: (w: W) => sql`count(*) filter (where shipments.status = 'failed' and ${w(PARCEL_OUTCOME_AT)})::int`,
  returned: (w: W) => sql`count(*) filter (where shipments.status = 'returned' and ${w(PARCEL_OUTCOME_AT)})::int`,
  geocoded: (w: W) => sql`count(*) filter (where ${w(shipments.createdAt)} and shipments.lat is not null and shipments.lng is not null)::int`,
  time_secs: (w: W) => sql`coalesce(sum(${DELIVERY_S}) filter (where ${DELIVERED_TIMED} and ${w(PARCEL_OUTCOME_AT)}), 0)::float8`,
  time_n: (w: W) => sql`count(*) filter (where ${DELIVERED_TIMED} and ${w(PARCEL_OUTCOME_AT)})::int`,
};
const readParcels = (r: Row | undefined) => {
  const p = (k: string) => twinRead(r, k);
  return { registered: p("registered"), delivered: p("delivered"), failed: p("failed"), returned: p("returned"), geocoded: p("geocoded"), timeSecs: p("time_secs"), timeN: p("time_n") };
};

/** Parcel KPIs of the period (both windows) over every parcel of the filtered requests. */
export async function parcelFacts(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, parcelMetrics)} from shipments join requests on requests.id = shipments.request_id
    where ${scope(f, "shipments")} and ${anyWindow(f, PARCEL_OUTCOME_AT, shipments.createdAt)}`);
  return readParcels(r);
}

/** Request KPIs: requests created, how many cross a city border (pickup city ≠ delivery city), distinct delivery cities, driver slots asked / filled, billed amount (money). */
export async function requestFacts(f: ResolvedFilters, money: boolean) {
  const c = (extra: SQL) => (w: W) => sql`count(*) filter (where ${w(requests.createdAt)} and ${extra})::int`;
  const [r, drivers, [g]] = await Promise.all([
    rows<Row>(sql`
      select ${twinSelect(f, {
        created: c(sql`true`), cross: c(sql`requests.pickup_city <> requests.delivery_city`), cities: (w) => sql`count(distinct requests.delivery_city) filter (where ${w(requests.createdAt)})::int`,
        slots: (w) => sql`coalesce(sum(${SLOTS}) filter (where ${w(requests.createdAt)} and ${DRIVEN} and ${RESOLVED}), 0)::float8`,
        filled: (w) => sql`coalesce(sum(${FILLED}) filter (where ${w(requests.createdAt)} and ${DRIVEN} and ${RESOLVED}), 0)::float8`,
      })} from requests where ${scope(f, "requests")} and ${NOT_DRAFT} and ${anyWindow(f, requests.createdAt)}`),
    // Supply: verified, active drivers (right now) — based in the filtered cities when a city filter is set.
    rows<Row>(sql`select count(*)::int as n from users join driver_profiles dp on dp.user_id = users.id
      where users.role = 'driver' and users.status = 'active' and dp.verification_status = 'verified' ${f.city.length ? sql`and users.city in (${sql.join(f.city.map((x) => sql`${x}`), sql`, `)})` : sql``}`),
    money ? rows<Row>(sql`
      select ${twinSelect(f, { gmv: (w) => sql`coalesce(sum(settlements.customer_cents) filter (where ${w(settlements.createdAt)} and ${BILLED}), 0)::float8` })}
      from settlements join requests on requests.id = settlements.request_id where ${scope(f, "settlements")} and ${anyWindow(f, settlements.createdAt)}`) : Promise.resolve([undefined as Row | undefined]),
  ]);
  const p = (k: string) => twinRead(r[0], k);
  return { created: p("created"), cross: p("cross"), cities: p("cities"), slots: p("slots"), filled: p("filled"), drivers: asNum(drivers[0]?.n) ?? 0, gmv: money ? twinRead(g, "gmv") : null };
}
export type RequestFacts = Awaited<ReturnType<typeof requestFacts>>;

/** One row per city (the delivery city of the parcels / requests): parcels, outcomes, delivery time, driver slots, drivers, companies and — with `money` — billed amount. */
export async function cityRows(f: ResolvedFilters, money: boolean): Promise<CityRow[]> {
  const [pa, rq, pk, ad, db, gm] = await Promise.all([
    rows<Row>(sql`
      select shipments.city as k, ${twinSelect(f, parcelMetrics)} from shipments join requests on requests.id = shipments.request_id
      where ${scope(f, "shipments")} and ${anyWindow(f, PARCEL_OUTCOME_AT, shipments.createdAt)} group by shipments.city`),
    rows<Row>(sql`
      select requests.delivery_city as k, ${twinSelect(f, {
        req: (w) => sql`count(*) filter (where ${w(requests.createdAt)})::int`, companies: (w) => sql`count(distinct requests.business_id) filter (where ${w(requests.createdAt)})::int`,
        slots: (w) => sql`coalesce(sum(${SLOTS}) filter (where ${w(requests.createdAt)} and ${DRIVEN} and ${RESOLVED}), 0)::float8`,
        filled: (w) => sql`coalesce(sum(${FILLED}) filter (where ${w(requests.createdAt)} and ${DRIVEN} and ${RESOLVED}), 0)::float8`,
      })} from requests where ${scope(f, "requests")} and ${NOT_DRAFT} and ${anyWindow(f, requests.createdAt)} group by requests.delivery_city`),
    rows<Row>(sql`select requests.pickup_city as k, count(*)::int as n from requests where ${scope(f, "requests")} and ${NOT_DRAFT} and ${inWindow(requests.createdAt, f.cur)} group by requests.pickup_city`),
    rows<Row>(sql`
      select requests.delivery_city as k, count(distinct offers.driver_id)::int as n from offers join requests on requests.id = offers.request_id
      where ${scope(f, "offers")} and offers.accepted_at is not null and ${inWindow(offers.acceptedAt, f.cur)} group by requests.delivery_city`),
    rows<Row>(sql`select users.city as k, count(*)::int as n from users join driver_profiles dp on dp.user_id = users.id
      where users.role = 'driver' and users.status = 'active' and dp.verification_status = 'verified' and users.city is not null group by users.city`),
    money ? rows<Row>(sql`
      select requests.delivery_city as k, ${twinSelect(f, { gmv: (w) => sql`coalesce(sum(settlements.customer_cents) filter (where ${w(settlements.createdAt)} and ${BILLED}), 0)::float8` })}
      from settlements join requests on requests.id = settlements.request_id where ${scope(f, "settlements")} and ${anyWindow(f, settlements.createdAt)} group by requests.delivery_city`) : Promise.resolve([] as Row[]),
  ]);
  const by = new Map<string, CityRow>();
  const get = (k: unknown) => { const key = String(k ?? ""); let x = by.get(key); if (!x) { x = blankCity(key); by.set(key, x); } return x; };
  for (const r of pa) {
    const x = get(r.k), p = readParcels(r), res = (v: { cur: number | null }) => v.cur ?? 0;
    x.parcels = res(p.registered); x.prevParcels = f.prev ? p.registered.prev ?? 0 : null; x.delivered = res(p.delivered); x.failed = res(p.failed); x.returned = res(p.returned);
    x.successRate = safeDiv(p.delivered.cur, (p.delivered.cur ?? 0) + (p.failed.cur ?? 0) + (p.returned.cur ?? 0));
    x.prevSuccessRate = safeDiv(p.delivered.prev, (p.delivered.prev ?? 0) + (p.failed.prev ?? 0) + (p.returned.prev ?? 0));
    x.avgDeliverySecs = safeDiv(p.timeSecs.cur, p.timeN.cur);
  }
  for (const r of rq) { const x = get(r.k), q = twinRead(r, "req"); x.requests = q.cur ?? 0; x.prevRequests = f.prev ? q.prev ?? 0 : null; x.activeCompanies = twinRead(r, "companies").cur ?? 0; x.slots = twinRead(r, "slots").cur ?? 0; x.filled = twinRead(r, "filled").cur ?? 0; }
  for (const r of pk) get(r.k).pickupRequests = Number(r.n ?? 0);
  for (const r of ad) get(r.k).activeDrivers = Number(r.n ?? 0);
  for (const r of db) { const x = by.get(String(r.k)); if (x) x.drivers = Number(r.n ?? 0); }
  for (const r of gm) { const x = get(r.k), g = twinRead(r, "gmv"); x.gmv = g.cur ?? 0; x.prevGmv = f.prev ? g.prev ?? 0 : null; }
  return finishCities([...by.values()]);
}

export interface RouteRow { id: string; pickup: string; delivery: string; requests: number; prevRequests: number | null; parcels: number; delivered: number; failed: number; successRate: number | null; avgDeliverySecs: number | null; gmv: number | null; crossCity: boolean }
/** Top pickup → delivery city pairs of the requests created in the period (up to 100): requests, parcels and their outcomes, delivery time and — with `money` — billed amount. */
export async function routeRows(f: ResolvedFilters, money: boolean): Promise<RouteRow[]> {
  const [r, g] = await Promise.all([
    rows<Row>(sql`
      select requests.pickup_city as pickup, requests.delivery_city as delivery, ${twinSelect(f, {
        req: (w) => sql`count(distinct requests.id) filter (where ${w(requests.createdAt)})::int`, parcels: (w) => sql`count(shipments.id) filter (where ${w(requests.createdAt)})::int`,
        delivered: (w) => sql`count(shipments.id) filter (where ${w(requests.createdAt)} and shipments.status = 'delivered')::int`,
        failed: (w) => sql`count(shipments.id) filter (where ${w(requests.createdAt)} and shipments.status in ('failed','returned'))::int`,
        time_secs: (w) => sql`coalesce(sum(${DELIVERY_S}) filter (where ${w(requests.createdAt)} and ${DELIVERED_TIMED}), 0)::float8`, time_n: (w) => sql`count(shipments.id) filter (where ${w(requests.createdAt)} and ${DELIVERED_TIMED})::int`,
      })}
      from requests left join shipments on shipments.request_id = requests.id where ${scope(f, "requests")} and ${NOT_DRAFT} and ${anyWindow(f, requests.createdAt)}
      group by requests.pickup_city, requests.delivery_city having count(*) filter (where ${inWindow(requests.createdAt, f.cur)}) > 0 order by req_c desc, parcels_c desc, 1, 2 limit 100`),
    money ? rows<Row>(sql`
      select requests.pickup_city as pickup, requests.delivery_city as delivery, coalesce(sum(settlements.customer_cents) filter (where ${BILLED}), 0)::float8 as gmv
      from settlements join requests on requests.id = settlements.request_id where ${scope(f, "settlements")} and ${inWindow(settlements.createdAt, f.cur)} group by 1, 2`) : Promise.resolve([] as Row[]),
  ]);
  const gmv = new Map(g.map((x) => [`${x.pickup}>${x.delivery}`, Number(x.gmv ?? 0)]));
  return r.map((x) => {
    const q = twinRead(x, "req"), d = twinRead(x, "delivered"), fl = twinRead(x, "failed");
    return {
      id: `${x.pickup}>${x.delivery}`, pickup: String(x.pickup), delivery: String(x.delivery), requests: q.cur ?? 0, prevRequests: f.prev ? q.prev ?? 0 : null, parcels: twinRead(x, "parcels").cur ?? 0, delivered: d.cur ?? 0, failed: fl.cur ?? 0,
      successRate: safeDiv(d.cur, (d.cur ?? 0) + (fl.cur ?? 0)), avgDeliverySecs: safeDiv(twinRead(x, "time_secs").cur, twinRead(x, "time_n").cur), gmv: money ? gmv.get(`${x.pickup}>${x.delivery}`) ?? 0 : null, crossCity: x.pickup !== x.delivery,
    };
  });
}

/** Cells of the delivery-point grid (`GRID_DEG` degrees) with the parcels registered in the period: the busiest `limit` cells, with their outcomes and most common city. */
export async function gridCells(f: ResolvedFilters, limit = 400): Promise<Cell[]> {
  const deg = sql.raw(String(GRID_DEG));
  const r = await rows<Row>(sql`
    select floor(shipments.lat / ${deg})::int as gy, floor(shipments.lng / ${deg})::int as gx, count(*)::int as parcels, count(*) filter (where shipments.status = 'delivered')::int as delivered,
      count(*) filter (where shipments.status in ('failed','returned'))::int as failed, mode() within group (order by shipments.city) as city
    from shipments join requests on requests.id = shipments.request_id
    where ${scope(f, "shipments")} and shipments.lat between -90 and 90 and shipments.lng between -180 and 180 and ${inWindow(shipments.createdAt, f.cur)}
    group by 1, 2 order by parcels desc, 1, 2 limit ${limit}`);
  return r.map((x) => ({ gy: Number(x.gy), gx: Number(x.gx), parcels: Number(x.parcels), delivered: Number(x.delivered), failed: Number(x.failed), city: x.city == null ? null : String(x.city) }));
}

/** Distinct grid cells that received a parcel in each period: the "active zones" KPI (not capped like the cell list of the map). */
export async function activeZones(f: ResolvedFilters) {
  const deg = sql.raw(String(GRID_DEG));
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, { zones: (w) => sql`count(distinct (floor(shipments.lat / ${deg})::int, floor(shipments.lng / ${deg})::int)) filter (where ${w(shipments.createdAt)})::int` })}
    from shipments join requests on requests.id = shipments.request_id
    where ${scope(f, "shipments")} and shipments.lat between -90 and 90 and shipments.lng between -180 and 180 and ${anyWindow(f, shipments.createdAt)}`);
  return twinRead(r, "zones");
}

/** The busiest `keys.length` delivery cities as columns `c0…` plus `other`: delivered parcels per bucket (stacked chart). */
export const citySeries = (f: ResolvedFilters, keys: string[]) => buildSeries(f, [...keys.map((_, i) => `c${i}`), "other"], (w) => sql`
  select ${bucketSql(PARCEL_OUTCOME_AT, f.bucket)} as t,
    ${sql.join(keys.map((k, i) => sql`count(*) filter (where shipments.city = ${k})::int as ${sql.raw(`c${i}`)}`), sql`, `)}${keys.length ? sql`,` : sql``}
    count(*) filter (where ${keys.length ? sql`shipments.city not in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})` : sql`true`})::int as other
  from shipments join requests on requests.id = shipments.request_id
  where ${scope(f, "shipments")} and shipments.status = 'delivered' and ${inWindow(PARCEL_OUTCOME_AT, w)} group by 1`);
