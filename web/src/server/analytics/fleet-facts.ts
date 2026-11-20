import { sql } from "drizzle-orm";
import type { ResolvedFilters } from "./filters";
import { rows } from "./guard";
import { pairOf, type Pair } from "./companies-lib";
import { dxBase, withFleet } from "./fleet-sql";
import type { Totals } from "./fleet-kpis";

/**
 * Totals of every additive base column over the drivers of a selection (`dx`): one pass, this period and the comparison period. For the Courier offices report only work done through an
 * office counts (`officeOnly`) and the people are the ones linked to an office or with such work in the period. Counts are 0 without data; distances and COD are NULL when nothing has the data.
 */
const NULLABLE = ["radius_m", "route_m", "gps_m"];
export async function fleetTotals(f: ResolvedFilters, money: boolean, grace: number, kind: "drivers" | "offices"): Promise<Totals> {
  const names = dxBase(money);
  const sums = sql.join(names.map((n) => sql.raw(`${NULLABLE.includes(n) ? `sum(${n}_c)` : `coalesce(sum(${n}_c), 0)`}::float8 as t_${n}_c, sum(${n}_p)::float8 as t_${n}_p`)), sql`, `);
  const officeOnly = kind === "offices";
  const where = officeOnly ? sql`where (office_id is not null or acc_c > 0)` : sql``;
  const [r] = await rows<Record<string, unknown>>(withFleet(f, money, grace, sql`select ${sums} from dx ${where}`, { officeOnly }));
  const out: Record<string, Pair> = {};
  for (const n of names) { const p = pairOf(r, `t_${n}`); out[n] = f.prev ? p : { cur: p.cur, prev: null }; }
  return out;
}
