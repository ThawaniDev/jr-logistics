import { sql, type SQL } from "drizzle-orm";
import { can } from "../auth/permissions";
import { getSettings } from "../settings";
import type { User } from "@/db/schema";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import type { DrillColumn, DrillQuery } from "./registry";
import { dailyKeys, currentOnly } from "./fleet-lib";
import { columnOf, selectMetrics, sortOf } from "./fleet-metrics";
import { withFleet, type FleetOpts } from "./fleet-sql";
import { withFleetOffices } from "./fleet-office-sql";

/** Helpers shared by the drivers' and the offices' fleet tables: the page runner, identity columns and the daily grid runner. Every query reads ONE period (no comparison window). */
type Row = Record<string, unknown>;
export interface Who { f: ResolvedFilters; money: boolean; grace: number }
export async function who(q: Pick<DrillQuery, "filters" | "user">): Promise<Who> {
  return { f: currentOnly(q.filters), money: can(q.user as User, "finance.view"), grace: (await getSettings()).lateGraceMin };
}
const strip = (list: Row[]) => list.map(({ total_n: _t, ...r }) => r);

/** One page of `select <cols> from <rel> where <where>` over a fleet chain; the total comes from a window count (a second query only when a page past the end is empty). */
async function paged(run: (select: SQL) => SQL, rel: string, cols: SQL, where: SQL, order: SQL, limit: number, offset: number) {
  const r = sql.raw(rel);
  const list = await rows<Row>(run(sql`select q.*, count(*) over ()::int as total_n from (select ${cols} from ${r} where ${where}) q order by ${order} limit ${limit} offset ${offset}`));
  const total = list.length ? num(list[0].total_n) : offset > 0 ? num((await rows<Row>(run(sql`select count(*)::int as n from ${r} where ${where}`)))[0]?.n) : 0;
  return { rows: strip(list), total };
}
/** A page of drivers (`dx`). */
export const driverPage = (w: Who, cols: SQL, where: SQL, order: SQL, limit: number, offset: number, opts: FleetOpts = {}) =>
  paged((s) => withFleet(w.f, w.money, w.grace, s, opts), "dx", cols, where, order, limit, offset);
/** A page of offices (`fp`). */
export const officePage = (w: Who, cols: SQL, where: SQL, order: SQL, limit: number, offset: number) =>
  paged((s) => withFleetOffices(w.f, w.money, w.grace, s), "fp", cols, where, order, limit, offset);

/** A page of the daily grid: `chain` ends in the relation `dday`; every Riyadh day of the period is a row (a period over 366 days is refused). */
export async function dayPage(w: Who, chain: (keys: string[]) => SQL, metrics: readonly string[], order: SQL, limit: number, offset: number) {
  const keys = dailyKeys(w.f);
  const list = await rows<Row>(sql`with ${chain(keys)} select t as id, t as "date", ${selectMetrics(metrics)} from dday order by ${order} limit ${limit} offset ${offset}`);
  return { rows: list, total: keys.length };
}

/** A page of driver × day rows: `chain` (an operations chain by driver) ends in `dday`, which has one row per driver and day that had something; the driver's name and office are joined on. */
export async function driverDayPage(w: Who, chain: (keys: string[]) => SQL, metrics: readonly string[], order: SQL, limit: number, offset: number) {
  const keys = dailyKeys(w.f);
  const q = sql`with ${chain(keys)} select q.*, count(*) over ()::int as total_n from (
    select dday.id || ':' || dday.t as id, dday.id as "driverId", dday.t as "date", u.name as driver, coalesce(op.office_name, ou.name, 'direct') as office, ${selectMetrics(metrics)}
    from dday join users u on u.id = dday.id join driver_profiles dp on dp.user_id = u.id left join users ou on ou.id = dp.office_id left join office_profiles op on op.user_id = dp.office_id
  ) q order by ${order} limit ${limit} offset ${offset}`;
  const list = await rows<Row>(q);
  const total = list.length ? num(list[0].total_n) : offset > 0 ? num((await rows<Row>(sql`with ${chain(keys)} select count(*)::int as n from dday`))[0]?.n) : 0;
  return { rows: strip(list), total };
}

// ───────── columns ─────────
export const dateCol: DrillColumn = { key: "date", label: "fr.col_date", type: "date" };
export const driverCol: DrillColumn = { key: "name", label: "fr.col_driver", type: "link", href: "/admin/drivers/{id}" };
export const officeNameCol: DrillColumn = { key: "office", label: "fr.col_office", type: "enum", ns: "fr.office", phone: false };
export const vehicleCol: DrillColumn = { key: "vehicle", label: "fr.col_vehicle", type: "enum", ns: "vehicle", phone: false };
export const cityCol: DrillColumn = { key: "city", label: "fr.col_city", type: "enum", ns: "city", phone: false };
/** Metric columns in order; the keys in `phoneKeys` stay in the card layout on a phone. */
export const metricCols = (keys: readonly string[], phoneKeys: readonly string[] = []): DrillColumn[] => keys.map((k) => columnOf(k, { phone: phoneKeys.includes(k) }));
/** `sorts` for a list of metric keys (the quoted output alias of each). */
export const metricSorts = sortOf;
