import { sql, type SQL } from "drizzle-orm";
import { inWindow, scope } from "./conditions";
import { AGE_KEYS, ageKeySql, namesOf, type AgeKey, type Row } from "./finance-core";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { PARCEL_FROM, remitScope } from "./cod-facts";

/** An order with cash still at the driver that is at least this many days old is raised as an alert. */
export const ALERT_DAYS = 8;

/**
 * One row per driver slot (order) that has collected cash, with the cash still outstanding and how old it is: `age_days` counts from the FIRST collection on the order,
 * so the age of cash is never understated when a driver hands in part of it. Remittances are credited to the order as a whole (partial receipts allowed).
 */
export const heldOrders = (f: ResolvedFilters): SQL => sql`
  select p.*, greatest(0, p.collected - coalesce(r.amt, 0))::float8 as outstanding, coalesce(r.amt, 0)::float8 as received, extract(epoch from (now() - p.first_at)) / 86400 as age_days from (
    select offers.id as offer_id, requests.id as request_id, requests.ref, requests.business_id::text as company, offers.driver_id::text as driver, offers.office_id::text as office,
      count(*)::int as parcels, sum(shipments.cod_collected_cents)::float8 as collected, min(shipments.cod_collected_at) as first_at, max(shipments.cod_collected_at) as last_at
    ${PARCEL_FROM} join offers on offers.id = shipments.offer_id
    where ${scope(f, "shipments")} and shipments.status = 'delivered' and shipments.cod_collected_cents is not null
    group by offers.id, requests.id, requests.ref, requests.business_id, offers.driver_id, offers.office_id) p
  left join (select offer_id, sum(amount_cents) as amt from cod_remittances group by offer_id) r on r.offer_id = p.offer_id`;

export interface Holder { key: string; name: string | null; outstanding: number; orders: number; oldestDays: number }
export interface AgeRow { key: AgeKey; orders: number; cents: number }
export interface Alert { offerId: string; requestId: string; ref: string; driverId: string; driver: string | null; company: string | null; outstanding: number; ageDays: number }

/** Cash outstanding right now (the period does not apply; every other filter does): aging buckets, who holds it (driver / office / company) and the orders that have waited longest. */
export async function liveCash(f: ResolvedFilters, money: boolean) {
  const held = heldOrders(f);
  const holders = (dim: "driver" | "office" | "company") => sql`(select ${sql.raw(`'${dim}'`)} as dim, ${sql.raw(dim)} as k, sum(outstanding)::float8 as amt, count(*)::int as orders, max(age_days)::float8 as oldest
    from (${held}) h where outstanding > 0 and ${sql.raw(dim)} is not null group by ${sql.raw(dim)} order by amt desc, k limit 10)`;
  const [aging, top, alerts] = await Promise.all([
    rows<Row>(sql`select ${ageKeySql(sql`floor(age_days)`)} as bucket, count(*)::int as n, coalesce(sum(outstanding), 0)::float8 as amt, count(distinct driver)::int as drivers from (${held}) h where outstanding > 0 group by 1`),
    money ? rows<Row>(sql`${holders("driver")} union all ${holders("office")} union all ${holders("company")}`) : Promise.resolve([] as Row[]),
    money ? rows<Row>(sql`select offer_id, request_id, ref, driver, company, outstanding, age_days from (${held}) h where outstanding > 0 and age_days >= ${ALERT_DAYS} order by age_days desc, outstanding desc, offer_id limit 8`) : Promise.resolve([] as Row[]),
  ]);
  const byKey = new Map(aging.map((x) => [String(x.bucket), x]));
  const buckets: AgeRow[] = AGE_KEYS.map((key) => ({ key, orders: num(byKey.get(key)?.n), cents: num(byKey.get(key)?.amt) }));
  const holderRows = await namesOf([...top.map((x) => String(x.k)), ...alerts.flatMap((x) => [String(x.driver), String(x.company)])]);
  const dimOf = (d: string): Holder[] => top.filter((x) => x.dim === d).map((x) => ({ key: String(x.k), name: holderRows.get(String(x.k)) ?? null, outstanding: num(x.amt), orders: num(x.orders), oldestDays: num(x.oldest) }));
  const holdersTotal = (await rows<Row>(sql`select count(distinct driver)::int as n from (${held}) h where outstanding > 0`))[0];
  return {
    buckets, holders: { driver: dimOf("driver"), office: dimOf("office"), company: dimOf("company") },
    alerts: alerts.map((x): Alert => ({ offerId: String(x.offer_id), requestId: String(x.request_id), ref: String(x.ref), driverId: String(x.driver), driver: holderRows.get(String(x.driver)) ?? null, company: holderRows.get(String(x.company)) ?? null, outstanding: num(x.outstanding), ageDays: num(x.age_days) })),
    orders: buckets.reduce((s, b) => s + b.orders, 0), outstanding: buckets.reduce((s, b) => s + b.cents, 0),
    aged: { orders: buckets.filter((b) => b.key === "d8_14" || b.key === "d15").reduce((s, b) => s + b.orders, 0), cents: buckets.filter((b) => b.key === "d8_14" || b.key === "d15").reduce((s, b) => s + b.cents, 0) },
    drivers: num(holdersTotal?.n),
  };
}
export type LiveCash = Awaited<ReturnType<typeof liveCash>>;

export interface SlowRemitter { id: string; name: string | null; avgSecs: number; remittances: number }
/** Drivers who took longest to hand the cash back in the period (average of collection → receipt), at least 3 receipts each. Durations only: no amounts. */
export async function slowRemitters(f: ResolvedFilters): Promise<SlowRemitter[]> {
  const r = await rows<Row>(sql`
    select cod_remittances.driver_id::text as id, avg(extract(epoch from (cod_remittances.created_at - lc.at)))::float8 as secs, count(*)::int as n
    from cod_remittances join requests on requests.id = cod_remittances.request_id
    join lateral (select max(shipments.cod_collected_at) as at from shipments where shipments.offer_id = cod_remittances.offer_id and shipments.cod_collected_at <= cod_remittances.created_at) lc on lc.at is not null
    where ${remitScope(f)} and ${inWindow("cod_remittances.created_at", f.cur)}
    group by cod_remittances.driver_id having count(*) >= 3 order by secs desc, id limit 10`);
  const names = await namesOf(r.map((x) => String(x.id)));
  return r.map((x) => ({ id: String(x.id), name: names.get(String(x.id)) ?? null, avgSecs: num(x.secs), remittances: num(x.n) }));
}
