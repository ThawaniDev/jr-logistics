import { sql, type SQL } from "drizzle-orm";
import type { Permission } from "../catalog";
import { allOf, scope, type Fact } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { MULTI_KEYS, type MultiKey } from "./keys";

/**
 * The data explorer's dataset model. A dataset is DEFINED ONCE on the server (its FROM, columns, filters, joins, sort keys, permissions and masking) and the client can only
 * name what is registered: every identifier that reaches SQL comes from these definitions, every value from a parameter. See `explorer-registry.ts` and `explorer.ts`.
 */
export type ColType = "text" | "number" | "money" | "percent" | "duration" | "date" | "datetime" | "enum" | "status" | "bool" | "link";
/** How a personal-data column is masked for viewers without `drivers.sensitive` (the masking happens in SQL, so the value never leaves the database). */
export type MaskKind = "phone" | "email" | "text" | "tail" | "ip";
/** Run-time values some definitions need (settings the SQL cannot read itself). */
export interface Ctx { graceMin: number }
export type Dyn = SQL | ((c: Ctx) => SQL);
export const DATASET_GROUPS = ["operations", "finance", "people", "support", "system"] as const;
export type DatasetGroup = (typeof DATASET_GROUPS)[number];
export const AGGS = ["count", "sum", "avg", "min", "max", "p50", "p90"] as const;
export type Agg = (typeof AGGS)[number];

export interface Column {
  /** Response key, CSV header and URL value: `[a-z][A-Za-z0-9]*`. The label is the dictionary key `rpq.c_<key>` (the same key must mean the same thing in every dataset). */
  key: string;
  type: ColType;
  sql: Dyn;
  /** Dictionary namespace of an `enum` / `status` value (`ns.value`; the UI falls back to `rpq.v_<value>`, then the raw value). */
  ns?: string;
  /** The values the column can hold (when it is a closed set); lets the filter UI offer them and the tests check their translations. */
  values?: readonly string[];
  /** In the default column set. */
  default?: boolean;
  /** Needs `finance.view`: the column does not exist for anybody else. */
  money?: boolean;
  /** Personal data: masked in SQL without `drivers.sensitive`, and then neither sortable, searchable, filterable nor groupable. */
  mask?: MaskKind;
  /** `false`: not sortable (a sub-select that would run for every row). Default true. */
  sort?: boolean;
  /** Can be a group-by dimension. Default: enum, status, bool, date and datetime columns. */
  group?: boolean;
  /** Numeric aggregations allowed. Default: number, money, duration and percent columns. */
  agg?: boolean;
  /** For `link` / `text` cells: the page a value links to, with `{field}` filled from the row (`/admin/requests/{id}`). */
  href?: string;
  /** Extra hidden fields the `href` needs (alias → SQL). */
  fields?: Record<string, SQL>;
}
export type FilterKind = "enum" | "text" | "num" | "date" | "flag";
export interface FilterDef {
  /** URL parameter `f.<key>`; the label is `rpq.f_<key>`. */
  key: string;
  kind: FilterKind;
  /** The column or boolean expression the filter tests. For `flag` it is a boolean ("has / has not"). */
  sql: Dyn;
  ns?: string;
  values?: readonly string[];
  /** A money amount (typed in SAR, compared in halalas): needs `finance.view`. */
  money?: boolean;
  /** Personal data: needs `drivers.sensitive` (a filter on a masked column would let anybody read it by bisecting). */
  pii?: boolean;
  /** A `date` filter on a DATE column (no time of day): compared as calendar days, not instants. */
  dateOnly?: boolean;
}
export interface Dataset {
  /** Labels are `rpq.ds_<key>` and `rpq.ds_<key>_d`. */
  key: string;
  group: DatasetGroup;
  /** The FROM clause with every join; core tables keep their own names (`requests`, `offers` …) because the shared scope fragments use them. */
  from: SQL;
  /** Conditions that define the dataset (`users.role = 'driver'`). */
  base?: SQL;
  /** A unique, stable expression: the identifier of a row and the last sort key (paging never skips or repeats a row). */
  id: SQL;
  /** The timestamp the period filter applies to; `label` is a dictionary key. */
  time: { sql: SQL; label: string };
  /** Permissions needed on top of `reports.view` + `reports.export` (ALL of them). */
  needs?: Permission[];
  /** The shared G3 filters this dataset honours, and how (a filter that is not here is reported as "not applied"). */
  keys: readonly MultiKey[];
  shared: (f: ResolvedFilters) => SQL;
  columns: Column[];
  filters: FilterDef[];
  /** Text-search columns of the free-text box; `searchPii` only for viewers with `drivers.sensitive`. */
  search: SQL[];
  searchPii?: SQL[];
  defaultSort: { key: string; dir: "asc" | "desc" };
}

export const list = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
export const inList = (col: SQL, vals: string[]): SQL => sql`${col} in (${list(vals)})`;
export const ALL_KEYS: readonly MultiKey[] = MULTI_KEYS;
/** A dataset that reuses the shared `scope()` of a fact table (all eight filters). */
export const scopeOf = (fact: Fact) => ({ keys: ALL_KEYS, shared: (f: ResolvedFilters) => scope(f, fact) });
/** A dataset whose filters map one by one onto its own columns. */
export function mapShared(map: Partial<Record<MultiKey, (v: string[]) => SQL>>): Pick<Dataset, "keys" | "shared"> {
  const keys = Object.keys(map) as MultiKey[];
  return { keys, shared: (f) => allOf(...keys.filter((k) => f[k].length).map((k) => map[k]!(f[k]))) };
}
/** Request-level filters on a joined `requests` table (city = delivery city). */
export const REQ_MAP = {
  city: (v: string[]) => inList(sql`requests.delivery_city`, v), service: (v: string[]) => inList(sql`requests.service`, v), vehicle: (v: string[]) => inList(sql`requests.vehicle_type`, v),
  channel: (v: string[]) => inList(sql`requests.created_via`, v), status: (v: string[]) => inList(sql`requests.status`, v),
} as const;

/** The masked form of a personal-data expression (the same shapes everywhere: a phone keeps its last 4 digits, an e-mail its domain). */
export function maskSql(kind: MaskKind, e: SQL): SQL {
  switch (kind) {
    case "phone": case "tail": return sql`(case when ${e} is null then null else '•••' || right(${e}::text, ${sql.raw(kind === "phone" ? "4" : "3")}) end)`;
    case "email": return sql`(case when ${e} is null then null else '•••' || substr(${e}::text, greatest(strpos(${e}::text, '@'), 1)) end)`;
    default: return sql`(case when ${e} is null then null else '•••' end)`;
  }
}
export const isNumeric = (t: ColType) => t === "number" || t === "money" || t === "duration" || t === "percent";
export const isTemporal = (t: ColType) => t === "date" || t === "datetime";
export const canAgg = (c: Column) => c.agg ?? isNumeric(c.type);
export const canGroup = (c: Column) => c.group ?? (c.type === "enum" || c.type === "status" || c.type === "bool" || isTemporal(c.type));
export const canSort = (c: Column) => c.sort !== false;
export const resolve = (d: Dyn, c: Ctx): SQL => (typeof d === "function" ? d(c) : d);

/** `start status` of a job against its start time (the same rule as `startSla()` in `server/ops.ts`, in SQL). */
export const startStatusSql = (c: Ctx): SQL => {
  const limit = sql`(requests.starts_at + make_interval(mins => ${c.graceMin}::int))`;
  return sql`(case when offers.arrived_at is not null then (case when offers.arrived_at <= ${limit} then 'on_time' else 'late' end) when offers.status = 'no_show' then 'missed'
    when offers.status in ('offered','rejected','expired','cancelled','replaced') then 'pending' when now() > ${limit} then 'at_risk' else 'pending' end)`;
};
export const START_STATUSES = ["on_time", "late", "missed", "at_risk", "pending"] as const;

export const col = (key: string, type: ColType, e: Dyn, o: Partial<Column> = {}): Column => ({ key, type, sql: e, ...o });
export const flt = (key: string, kind: FilterKind, e: Dyn, o: Partial<FilterDef> = {}): FilterDef => ({ key, kind, sql: e, ...o });
/** Seconds from one timestamp expression to another (null when either is missing, never negative). */
export const secs = (a: SQL, b: SQL): SQL => sql`(case when ${a} is not null and ${b} is not null then greatest(0, extract(epoch from (${b} - ${a}))) end)::float8`;
/** The shared columns of every dataset that has a `created_at`. */
export const createdAt = (e: SQL, o: Partial<Column> = {}) => col("createdAt", "datetime", e, o);

/** Roles that can appear as the actor of an event or as who received money. */
export const ROLE_VALUES = ["business", "driver", "office", "staff", "admin", "system"] as const;
