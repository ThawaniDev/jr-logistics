import { sql, type SQL } from "drizzle-orm";
import { metricSnapshots } from "@/db/schema";
import { bucketSql } from "./buckets";
import { anyWindow, inWindow, twinRead, twinSelect } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { rows } from "./guard";
import { buildSeries } from "./ops-series";
import { list } from "./ops-sql";
import { asNum, round, type Row } from "./ops-util";

/**
 * Supply vs demand from the hourly platform snapshots (`metric_snapshots`, written by the maintenance tick since migration 0012). A snapshot has no service, vehicle,
 * company, office, driver or status, so those filters cannot narrow it; the city filter selects the snapshot rows of those cities (a driver's home city for supply,
 * the pickup city for open requests), summed per hour. Without a city filter the platform row is used. Snapshots only exist from the day capture started.
 */
export { SNAPSHOT_IGNORES } from "./ops-kinds";

/** One row per snapshot hour: drivers available / busy, open requests, open (unfilled) driver slots. */
const hourly = (f: ResolvedFilters, window: SQL) => sql`
  select metric_snapshots.at as at, coalesce(sum((metric_snapshots.metrics->>'drivers_available')::float8), 0) as available, coalesce(sum((metric_snapshots.metrics->>'drivers_busy')::float8), 0) as busy,
    coalesce(sum((metric_snapshots.metrics->>'requests_open')::float8), 0) as open, coalesce(sum((metric_snapshots.metrics->>'slots_unfilled')::float8), 0) as unfilled
  from metric_snapshots
  where metric_snapshots.scope = 'hour' and ${f.city.length ? sql`metric_snapshots.city in (${list(f.city)})` : sql`metric_snapshots.city is null`} and ${window}
  group by metric_snapshots.at`;

export async function supplyFacts(f: ResolvedFilters) {
  const avg = (col: string) => (w: (c: string) => SQL) => sql`avg(x.${sql.raw(col)}) filter (where ${w("x.at")})::float8`;
  const total = (col: string) => (w: (c: string) => SQL) => sql`coalesce(sum(x.${sql.raw(col)}) filter (where ${w("x.at")}), 0)::float8`;
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, { available: avg("available"), busy: avg("busy"), open: avg("open"), unfilled: avg("unfilled"), sum_available: total("available"), sum_busy: total("busy"), hours: (w) => sql`count(*) filter (where ${w("x.at")})::int` })}
    from (${hourly(f, anyWindow(f, metricSnapshots.at))}) x`);
  const p = (k: string) => twinRead(r, k);
  return { available: p("available"), busy: p("busy"), open: p("open"), unfilled: p("unfilled"), sumAvailable: p("sum_available"), sumBusy: p("sum_busy"), hours: p("hours") };
}
export type SupplyFacts = Awaited<ReturnType<typeof supplyFacts>>;

export const SUPPLY_FIELDS = ["available", "busy", "open", "unfilled", "n"] as const;
/** Average drivers available / busy, open requests and open slots per bucket, read from the hourly snapshots. Buckets without a snapshot have `n = 0`. */
export const supplySeries = (f: ResolvedFilters) => buildSeries(f, SUPPLY_FIELDS, (w) => sql`
  select ${bucketSql("x.at", f.bucket)} as t, avg(x.available)::float8 as available, avg(x.busy)::float8 as busy, avg(x.open)::float8 as open, avg(x.unfilled)::float8 as unfilled, count(*)::int as n
  from (${hourly(f, inWindow(metricSnapshots.at, w))}) x group by 1`);

export interface SupplyCity { city: string; available: number; busy: number; open: number; unfilled: number; hours: number; utilisation: number | null; driversPerOpen: number | null }
/** Average supply and demand per snapshot city over the current period (the city filter narrows the list). Utilisation = busy ÷ (busy + available). */
export async function supplyByCity(f: ResolvedFilters): Promise<SupplyCity[]> {
  const r = await rows<Row>(sql`
    select metric_snapshots.city as city, avg((metrics->>'drivers_available')::float8)::float8 as available, avg((metrics->>'drivers_busy')::float8)::float8 as busy,
      avg((metrics->>'requests_open')::float8)::float8 as open, avg((metrics->>'slots_unfilled')::float8)::float8 as unfilled, count(*)::int as hours
    from metric_snapshots
    where metric_snapshots.scope = 'hour' and metric_snapshots.city is not null ${f.city.length ? sql`and metric_snapshots.city in (${list(f.city)})` : sql``} and ${inWindow(metricSnapshots.at, f.cur)}
    group by metric_snapshots.city order by 5 desc nulls last, 1 limit 30`);
  return r.map((x) => {
    const a = asNum(x.available) ?? 0, b = asNum(x.busy) ?? 0, o = asNum(x.open) ?? 0;
    return { city: String(x.city), available: round(a, 2) ?? 0, busy: round(b, 2) ?? 0, open: round(o, 2) ?? 0, unfilled: round(asNum(x.unfilled) ?? 0, 2) ?? 0, hours: Number(x.hours ?? 0), utilisation: a + b > 0 ? b / (a + b) : null, driversPerOpen: o > 0 ? a / o : null };
  });
}
