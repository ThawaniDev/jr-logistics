import { sql, type SQL } from "drizzle-orm";
import { shipments } from "@/db/schema";
import { riyadhDow, riyadhHour } from "./buckets";
import { inWindow, scope } from "./conditions";
import { buildGapSeries, buildSeries, bucketOf, secsBetween, type Row } from "./finance-core";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { FROM } from "./deliveries-facts";

export const FLOW_FIELDS = ["created", "handed", "delivered", "failed"] as const;
/** Parcels registered, handed over, delivered and failed per bucket — each on its own time (created, loaded, delivered, failed). */
export const flowSeries = (f: ResolvedFilters) => buildSeries(f, [...FLOW_FIELDS], (w) => {
  const part = (col: Parameters<typeof inWindow>[0], cond: SQL, field: (typeof FLOW_FIELDS)[number]) =>
    sql`select ${bucketOf(col, f)} as t, ${sql.join(FLOW_FIELDS.map((k) => sql`${k === field ? sql`count(*)::int` : sql`0`} as ${sql.raw(k)}`), sql`, `)} ${FROM} where ${scope(f, "shipments")} and ${cond} and ${inWindow(col, w)} group by 1`;
  const cols = sql.join(FLOW_FIELDS.map((k) => sql`sum(${sql.raw(k)})::int as ${sql.raw(k)}`), sql`, `);
  return sql`select t, ${cols} from (
    ${part(shipments.createdAt, sql`true`, "created")} union all ${part(shipments.loadedAt, sql`true`, "handed")}
    union all ${part(shipments.deliveredAt, sql`shipments.status = 'delivered'`, "delivered")} union all ${part(shipments.failedAt, sql`shipments.status in ('failed','returned')`, "failed")}) x group by t`;
});

/** Median and 90th percentile of the delivery time (hand-over → delivery) per bucket of the delivery; a bucket without deliveries is a gap. */
export const speedSeries = (f: ResolvedFilters) => buildGapSeries(f, ["p50", "p90"], (w) => sql`
  select ${bucketOf(shipments.deliveredAt, f)} as t,
    percentile_cont(0.5) within group (order by ${secsBetween(shipments.loadedAt, shipments.deliveredAt)})::float8 as p50,
    percentile_cont(0.9) within group (order by ${secsBetween(shipments.loadedAt, shipments.deliveredAt)})::float8 as p90
  ${FROM} where ${scope(f, "shipments")} and shipments.status = 'delivered' and shipments.loaded_at is not null and shipments.delivered_at >= shipments.loaded_at and ${inWindow(shipments.deliveredAt, w)} group by 1`);

/** Of the parcels registered in the period: how many were handed to a driver and how many were delivered. */
export async function funnel(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`select count(*)::int as created, count(*) filter (where shipments.loaded_at is not null)::int as handed,
      count(*) filter (where shipments.status = 'delivered')::int as delivered ${FROM}
    where ${scope(f, "shipments")} and ${inWindow(shipments.createdAt, f.cur)}`);
  const raw = [num(r?.created), num(r?.handed), num(r?.delivered)];
  // A step is never larger than the one before it (a parcel delivered by a later hand-over still entered the funnel at the top).
  return (["created", "handed", "delivered"] as const).map((key, i) => ({ key, count: Math.min(raw[i], ...raw.slice(0, i)) }));
}

/** Parcels that failed delivery by Riyadh weekday (0 = Sunday) × hour of the failure, current period. */
export async function failHeatmap(f: ResolvedFilters) {
  const r = await rows<Row>(sql`select ${riyadhDow(shipments.failedAt)} as dow, ${riyadhHour(shipments.failedAt)} as hr, count(*)::int as n ${FROM}
    where ${scope(f, "shipments")} and shipments.status in ('failed','returned') and ${inWindow(shipments.failedAt, f.cur)} group by 1, 2`);
  const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const x of r) { const d = num(x.dow), h = num(x.hr); if (d >= 0 && d < 7 && h >= 0 && h < 24) cells[d][h] = num(x.n); }
  return { cells, total: cells.flat().reduce((s, n) => s + n, 0) };
}

