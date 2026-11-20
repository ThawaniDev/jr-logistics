import { sql, type SQL } from "drizzle-orm";
import type { User } from "@/db/schema";
import { err } from "@/lib/errors";
import { contains } from "@/lib/sql";
import { can } from "../auth/permissions";
import { getSettings } from "../settings";
import { bucketSql } from "./buckets";
import { allOf, inWindow } from "./conditions";
import {
  AGGS, canAgg, canGroup, canSort, isNumeric, isTemporal, list, maskSql, resolve, type Agg, type Column, type Ctx, type Dataset, type FilterDef,
} from "./explorer-core";
import { parseFilters, type ResolvedFilters } from "./filters";
import type { MultiKey } from "./keys";
import { dayStart, addDays, isYmd } from "./time";

/** Hard limits of the explorer (every query is bounded: rows, offset, columns, groups, aggregations). */
export const LIMITS = { pageSize: 100, maxOffset: 10_000, countCap: 100_000, exportCap: 100_000, batch: 2000, groups: 500, columns: 40, aggs: 6, search: 80, enumValues: 25 } as const;
export interface Viewer { money: boolean; sensitive: boolean }
export const viewerOf = (u: Pick<User, "role" | "permissions">): Viewer => ({ money: can(u, "finance.view"), sensitive: can(u, "drivers.sensitive") });
/** A dataset the viewer may use at all (every extra permission it needs). */
export const datasetAllowed = (d: Dataset, u: Pick<User, "role" | "permissions">) => (d.needs ?? []).every((p) => can(u, p));
export const availableColumns = (d: Dataset, v: Viewer): Column[] => d.columns.filter((c) => !(c.money && !v.money));
export const availableFilters = (d: Dataset, v: Viewer): FilterDef[] => d.filters.filter((f) => !(f.money && !v.money) && !(f.pii && !v.sensitive));
export const masked = (c: Column, v: Viewer) => !!c.mask && !v.sensitive;
export const sortable = (c: Column, v: Viewer) => canSort(c) && !masked(c, v);
export const groupable = (c: Column, v: Viewer) => canGroup(c) && !masked(c, v);
export const aggregable = (c: Column, v: Viewer) => canAgg(c) && !masked(c, v);

export interface GroupSpec { col: Column; bucket: "day" | "week" | "month" | null }
export interface AggSpec { key: string; fn: Agg; col: Column | null }
export interface Parsed {
  ds: Dataset; viewer: Viewer; f: ResolvedFilters; ctx: Ctx; all: boolean; cols: Column[]; sort: { col: Column; dir: "asc" | "desc" };
  page: number; pageSize: number; q: string; conds: SQL[]; echo: Record<string, string>; group: GroupSpec | null; aggs: AggSpec[];
  /** The shared filters the dataset does not honour (told to the user, never silently dropped). */
  ignored: MultiKey[];
}

const fail = (field: string, message: string) => err("VALIDATION", message, { field });
const ENUM_RE = /^[A-Za-z0-9_.-]{1,40}$/;
const NUM = "-?\\d+(?:\\.\\d+)?";
const NUM_RANGE = new RegExp(`^(${NUM})?\\.\\.(${NUM})?$`);
const DAY_RANGE = /^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/;
const csv = (v: string | null) => (v ? [...new Set(v.split(",").map((x) => x.trim()).filter(Boolean))] : []);

/** One dataset filter → SQL; throws 422 naming `f.<key>` for any malformed value. */
function filterSql(fd: FilterDef, raw: string, ctx: Ctx): SQL {
  const e = resolve(fd.sql, ctx), field = `f.${fd.key}`;
  switch (fd.kind) {
    case "enum": {
      const vals = csv(raw);
      if (!vals.length || vals.length > LIMITS.enumValues || vals.some((v) => (fd.values ? !(fd.values as readonly string[]).includes(v) : !ENUM_RE.test(v)))) throw fail(field, "Not a valid value");
      return sql`${e} in (${list(vals)})`;
    }
    case "text": {
      const s = raw.trim().slice(0, LIMITS.search);
      if (!s) throw fail(field, "Not a valid value");
      return sql`${e}::text ilike ${contains(s)}`;
    }
    case "flag": {
      if (raw !== "yes" && raw !== "no") throw fail(field, "Use yes or no");
      return raw === "yes" ? sql`coalesce((${e}), false)` : sql`not coalesce((${e}), false)`;
    }
    case "num": {
      const m = NUM_RANGE.exec(raw);
      if (!m || (m[1] === undefined && m[2] === undefined)) throw fail(field, "Use min..max");
      const k = fd.money ? 100 : 1, parts: SQL[] = [];
      if (m[1] !== undefined) parts.push(sql`${e} >= ${Math.round(Number(m[1]) * k * 1e4) / 1e4}`);
      if (m[2] !== undefined) parts.push(sql`${e} <= ${Math.round(Number(m[2]) * k * 1e4) / 1e4}`);
      return allOf(...parts);
    }
    case "date": {
      const m = DAY_RANGE.exec(raw);
      if (!m || (!m[1] && !m[2]) || (m[1] && !isYmd(m[1])) || (m[2] && !isYmd(m[2]))) throw fail(field, "Use YYYY-MM-DD..YYYY-MM-DD");
      if (m[1] && m[2] && m[1] > m[2]) throw fail(field, "The end date is before the start date");
      const parts: SQL[] = [];
      if (fd.dateOnly) { if (m[1]) parts.push(sql`${e} >= ${m[1]}::date`); if (m[2]) parts.push(sql`${e} <= ${m[2]}::date`); }
      else { if (m[1]) parts.push(sql`${e} >= ${dayStart(m[1]).toISOString()}::timestamptz`); if (m[2]) parts.push(sql`${e} < ${dayStart(addDays(m[2], 1)).toISOString()}::timestamptz`); }
      return allOf(...parts);
    }
  }
}

function parseGroup(ds: Dataset, v: Viewer, raw: string | null): GroupSpec | null {
  if (!raw) return null;
  const [key, b] = raw.split("~");
  const c = availableColumns(ds, v).find((x) => x.key === key);
  if (!c || !groupable(c, v)) throw fail("group", "This column cannot be grouped");
  if (b && (!isTemporal(c.type) || !["day", "week", "month"].includes(b))) throw fail("group", "Use day, week or month on a date column");
  return { col: c, bucket: isTemporal(c.type) ? ((b as GroupSpec["bucket"]) ?? "day") : null };
}
function parseAggs(ds: Dataset, v: Viewer, raw: string | null): AggSpec[] {
  const out: AggSpec[] = [];
  for (const item of csv(raw)) {
    const [fn, key] = item.split(":");
    if (!(AGGS as readonly string[]).includes(fn)) throw fail("agg", "Unknown aggregation");
    if (fn === "count") { if (key) throw fail("agg", "count takes no column"); continue; }
    const c = availableColumns(ds, v).find((x) => x.key === key);
    if (!c || !aggregable(c, v) || !isNumeric(c.type)) throw fail("agg", "This column cannot be aggregated");
    out.push({ key: `a${out.length}`, fn: fn as Agg, col: c });
  }
  if (out.length > LIMITS.aggs) throw fail("agg", `At most ${LIMITS.aggs} aggregations`);
  return out;
}

/** Validates one explorer request against its dataset and the viewer's permissions. Everything the client names is looked up in the registry; nothing else reaches SQL. */
export async function parseRequest(user: User, ds: Dataset, query: URLSearchParams, runtime?: Ctx): Promise<Parsed> {
  const viewer = viewerOf(user);
  const avail = availableColumns(ds, viewer);
  const f = parseFilters(query);
  const ctx: Ctx = runtime ?? { graceMin: (await getSettings()).lateGraceMin };
  const askedCols = csv(query.get("cols"));
  if (askedCols.length > LIMITS.columns) throw fail("cols", `At most ${LIMITS.columns} columns`);
  const cols = askedCols.length ? askedCols.map((k) => avail.find((c) => c.key === k) ?? (() => { throw fail("cols", `Unknown column "${k}"`); })()) : avail.filter((c) => c.default);
  const sortKey = query.get("sort") || ds.defaultSort.key;
  const sortCol = avail.find((c) => c.key === sortKey);
  if (!sortCol || !sortable(sortCol, viewer)) throw fail("sort", "This column cannot be sorted");
  const dir = query.get("dir") || (sortKey === ds.defaultSort.key ? ds.defaultSort.dir : "asc");
  if (dir !== "asc" && dir !== "desc") throw fail("dir", "dir must be asc or desc");
  const intParam = (k: string, def: number, min: number, max: number) => { const r = query.get(k); if (r == null || r === "") return def; const n = Number(r); if (!Number.isInteger(n) || n < min || n > max) throw fail(k, `${k} must be a whole number between ${min} and ${max}`); return n; };
  const page = intParam("page", 1, 1, 100_000), pageSize = intParam("pageSize", 25, 1, LIMITS.pageSize);
  const q = (query.get("q") ?? "").trim();
  if (q.length > LIMITS.search) throw fail("q", `At most ${LIMITS.search} characters`);
  // dataset filters: `f.<key>=…`; a key the dataset does not define is an error (a typo must not silently widen an export)
  const defs = new Map(availableFilters(ds, viewer).map((x) => [x.key, x]));
  const conds: SQL[] = [], echo: Record<string, string> = {};
  for (const [k, raw] of query.entries()) {
    if (!k.startsWith("f.") || raw === "") continue;
    const fd = defs.get(k.slice(2));
    if (!fd) throw fail(k, "Unknown filter");
    if (k in echo) continue;
    conds.push(filterSql(fd, raw.trim(), ctx)); echo[k] = raw.trim();
  }
  if (q) {
    const like = contains(q), fields = [...ds.search, ...(viewer.sensitive ? ds.searchPii ?? [] : [])];
    conds.push(sql`(${sql.join(fields.map((c) => sql`${c}::text ilike ${like}`), sql` or `)})`);
  }
  return {
    ds, viewer, f, ctx, all: query.get("all") === "1", cols, sort: { col: sortCol, dir }, page, pageSize, q, conds, echo,
    group: parseGroup(ds, viewer, query.get("group")), aggs: parseAggs(ds, viewer, query.get("agg")), ignored: f.active.filter((k) => !ds.keys.includes(k)),
  };
}

/** The SQL expression of a column for this viewer: personal data is masked in the database, so unmasked values are never loaded for viewers who may not see them. */
export function exprOf(c: Column, p: Pick<Parsed, "viewer" | "ctx">): SQL {
  const e = resolve(c.sql, p.ctx);
  return masked(c, p.viewer) ? maskSql(c.mask!, e) : e;
}

/** The WHERE of a request: the dataset's own condition, the shared filters it honours, the period (unless "all time"), its filters and the text search. */
export function whereOf(p: Parsed): SQL {
  return allOf(p.ds.base, p.ds.shared(p.f), p.all ? undefined : inWindow(p.ds.time.sql, p.f.cur), ...p.conds);
}
export const orderOf = (p: Parsed): SQL => sql`${exprOf(p.sort.col, p)} ${sql.raw(p.sort.dir)} nulls last, ${p.ds.id} asc`;

/** `select <id>, <chosen columns>, <hidden link fields> …`: aliases are the columns' own whitelisted keys. */
export function selectList(p: Parsed): SQL {
  const parts: SQL[] = [sql`${p.ds.id} as id`], seen = new Set<string>(["id"]);
  for (const c of p.cols) {
    parts.push(sql`${exprOf(c, p)} as ${sql.raw(`"${c.key}"`)}`); seen.add(c.key);
  }
  for (const c of p.cols) for (const [name, e] of Object.entries(c.fields ?? {})) if (!seen.has(name)) { seen.add(name); parts.push(sql`${e} as ${sql.raw(`"${name}"`)}`); }
  return sql.join(parts, sql`, `);
}
const AGG_SQL: Record<Exclude<Agg, "count">, (e: SQL) => SQL> = {
  sum: (e) => sql`sum(${e})::float8`, avg: (e) => sql`avg(${e})::float8`, min: (e) => sql`min(${e})::float8`, max: (e) => sql`max(${e})::float8`,
  p50: (e) => sql`percentile_cont(0.5) within group (order by ${e})::float8`, p90: (e) => sql`percentile_cont(0.9) within group (order by ${e})::float8`,
};
/** The grouped query: one row per distinct value of the group column with the row count and the requested aggregations (at most `LIMITS.groups` groups). */
export function groupQuery(p: Parsed): SQL {
  const g = p.group!, base = exprOf(g.col, p);
  const dim = g.bucket ? bucketSql(g.col.type === "date" ? sql`(${base}::timestamp::timestamptz)` : base, g.bucket) : sql`${base}`;
  const aggs = p.aggs.map((a) => sql`, ${AGG_SQL[a.fn as Exclude<Agg, "count">](exprOf(a.col!, p))} as ${sql.raw(a.key)}`);
  return sql`select ${dim} as g, count(*)::int as n${sql.join(aggs, sql``)} ${p.ds.from} where ${whereOf(p)} group by 1 order by n desc, g asc nulls last limit ${LIMITS.groups + 1}`;
}
export const countQuery = (p: Parsed, cap: number): SQL => sql`select count(*)::int as n from (select 1 ${p.ds.from} where ${whereOf(p)} limit ${cap + 1}) c`;
export const pageQuery = (p: Parsed, limit: number, offset: number): SQL => sql`select ${selectList(p)} ${p.ds.from} where ${whereOf(p)} order by ${orderOf(p)} limit ${limit} offset ${offset}`;
