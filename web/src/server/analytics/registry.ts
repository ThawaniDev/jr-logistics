import { sql, type SQL } from "drizzle-orm";
import type { User } from "@/db/schema";
import { err } from "@/lib/errors";
import { audit } from "../audit";
import { can, requirePerm } from "../auth/permissions";
import type { Permission } from "../catalog";
import { localeOf, translator } from "../export/context";
import { rawCsv, tableCsv } from "../export/drill-csv";
import { tableXlsx, XLSX_MIME } from "../export/table-export";
import type { XlType } from "../export/xlsx-xml";
import { parseFilters, filtersMeta, type ResolvedFilters } from "./filters";

/**
 * The drill-down contract: `GET /admin/analytics/:report/table/:name?<filters>&page&pageSize&sort&dir[&format=csv]`.
 * A report registers its tables with `defineTable()` (in its own route file); the generic route in `routes/admin-analytics.ts` does the rest: permissions,
 * filter parsing, paging, whitelisted sorting, the response shape, CSV export (needs `reports.export`, audited as `report.export`, formula-injection safe through
 * `toCsv`, UTF-8 with BOM so Excel reads Arabic), Excel export (`format=xlsx&lang=ar|en|ur`: same permission, row cap and audit as CSV, localized headers, real number formats and
 * a Notes sheet — see `server/export/`) and the `DrillTable` component renders it. Tables are NOT cached (they are paged and user-driven).
 */
export type ColType = "text" | "number" | "money" | "percent" | "duration" | "distance" | "date" | "datetime" | "status" | "enum" | "link";
export interface DrillColumn {
  key: string;
  /** i18n key of the header. */
  label: string;
  type?: ColType;
  /** For `enum`/`status`: the dictionary namespace (`svc`, `city`, `vehicle`, `status`, `settle` …) the raw value is translated with. */
  ns?: string;
  /** For `link`: the target with `{field}` placeholders filled from the row (`/admin/companies/{companyId}`). */
  href?: string;
  /** A second, muted line under the value (the row field to show). */
  sub?: string;
  align?: "start" | "end";
  /** Excel export only: force the cell type when it cannot be derived from `type` (`km` for a distance the API gives in metres, `int`). Money (`...Cents`), percent, duration and dates need no hint. */
  xl?: XlType;
  /** `false`: leave the column out of the card layout on phones (long tables become tall stacks of cards; keep the identifying and key numbers). */
  phone?: boolean;
}
export interface DrillQuery {
  filters: ResolvedFilters; user: User; limit: number; offset: number;
  /** `order by` fragment (already whitelisted) incl. the tie-break; splice it after `order by`. */
  order: SQL;
  sort: { key: string; dir: "asc" | "desc" };
}
export interface DrillDef {
  report: string; name: string;
  /** i18n key of the table's title. */
  title: string;
  columns: DrillColumn[];
  /** Sortable columns: key → SQL expression to order by. A key that is not here cannot be sorted. */
  sorts: Record<string, SQL>;
  defaultSort: { key: string; dir: "asc" | "desc" };
  /** A unique, stable expression appended to the ORDER BY so paging never skips or repeats a row (e.g. `requests.id`). */
  tiebreak?: SQL;
  /** Permissions required on top of `reports.view` (ALL of them): `["finance.view"]` for money tables. */
  needs?: Permission[];
  /** Rows per query when the table is exported (CSV / Excel / workbook); default `CSV_PAGE` (1 000). Raise it only for tables whose query costs the same for 1 000 rows as for 25 000. */
  exportPage?: number;
  /** Column/row-field keys that need `finance.view`; they are removed for everybody else (the table then simply has fewer columns). */
  moneyKeys?: string[];
  query(q: DrillQuery): Promise<{ rows: Array<Record<string, unknown>>; total: number }>;
}

/** Path segments under `/admin/analytics/` that belong to the framework (`options`, `overview`, `notes`, `workbook`): a NEW report cannot be called `options`, `notes` or `workbook`
 * (`overview` is the one existing report with that name: it is the Overview and has its own tables). `defineTable` refuses them, so the routes `:report/notes` and `workbook/:kind/:id` can never collide. */
export const RESERVED_REPORTS: readonly string[] = ["options", "notes", "workbook"];
const TABLES = new Map<string, DrillDef>();
export const defineTable = (def: DrillDef) => {
  if (RESERVED_REPORTS.includes(def.report)) throw new Error(`"${def.report}" is a reserved analytics path name`);
  TABLES.set(`${def.report}/${def.name}`, def);
};
export const getTable = (report: string, name: string) => TABLES.get(`${report}/${name}`);
export const listTables = (report?: string) => [...TABLES.values()].filter((d) => !report || d.report === report);

export const MAX_PAGE_SIZE = 100;
export const CSV_PAGE = 1000;
export const MAX_CSV_ROWS = 50_000;

export function shape(def: DrillDef, user: User) {
  for (const p of def.needs ?? []) requirePerm(user, p);
  const hide = new Set(can(user, "finance.view") ? [] : def.moneyKeys ?? []);
  return { hide, columns: def.columns.filter((c) => !hide.has(c.key)) };
}
const PG_TS = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$/;
/** Raw SQL returns timestamptz as `2026-11-19 05:28:38.384301+03`, which not every browser parses: every timestamp leaves the API as an ISO-8601 UTC string. */
export function isoValue(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") { const m = PG_TS.exec(v); if (m) { const d = new Date(`${m[1]}T${m[2].replace(/(\.\d{3})\d+/, "$1")}${m[3]}:${m[4] ?? "00"}`); if (!Number.isNaN(d.getTime())) return d.toISOString(); } }
  return v;
}
const strip = (rows: Array<Record<string, unknown>>, hide: Set<string>) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !hide.has(k)).map(([k, v]) => [k, isoValue(v)])));

function sortOf(def: DrillDef, query: URLSearchParams) {
  const key = query.get("sort") || def.defaultSort.key;
  if (!(key in def.sorts)) throw err("VALIDATION", "This column cannot be sorted", { field: "sort" });
  const d = query.get("dir") || (key === def.defaultSort.key ? def.defaultSort.dir : "asc");
  if (d !== "asc" && d !== "desc") throw err("VALIDATION", "dir must be asc or desc", { field: "dir" });
  return { key, dir: d as "asc" | "desc" };
}
const orderOf = (def: DrillDef, s: { key: string; dir: "asc" | "desc" }): SQL =>
  def.tiebreak ? sql`${def.sorts[s.key]} ${sql.raw(s.dir)} nulls last, ${def.tiebreak} asc` : sql`${def.sorts[s.key]} ${sql.raw(s.dir)} nulls last`;
const intParam = (query: URLSearchParams, k: string, def: number, min: number, max: number) => {
  const raw = query.get(k); if (raw == null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw err("VALIDATION", `${k} must be a whole number between ${min} and ${max}`, { field: k });
  return n;
};

/**
 * Walks a table in pages of `page` rows (default `CSV_PAGE`) up to `MAX_CSV_ROWS` (the cap of every export); `truncated` says the cap was hit. Every page re-runs the table's query, so a table
 * whose query is expensive however few rows it returns (a per-driver-per-day grid) sets `exportPage` on its definition: 50 pages of 1 000 rows took 93 s on a year of data, 2 pages of 25 000 ≈ 6 s.
 */
export async function pageAll(fetch: (limit: number, offset: number) => Promise<Array<Record<string, unknown>>>, page: number = CSV_PAGE): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean }> {
  let out: Array<Record<string, unknown>> = []; let truncated = false;
  for (let offset = 0; ; offset += page) {
    const part = await fetch(page, offset);
    out = out.concat(part);
    if (part.length < page) break;
    if (out.length >= MAX_CSV_ROWS) { out = out.slice(0, MAX_CSV_ROWS); truncated = true; break; }
  }
  return { rows: out, truncated };
}
/** Every row of a table for one viewer (money fields the viewer may not see removed, timestamps as ISO strings), sorted like the table's default (or `sort`/`dir` of the query). */
export async function collectTable(user: User, def: DrillDef, filters: ResolvedFilters, query: URLSearchParams = new URLSearchParams()) {
  const { hide, columns } = shape(def, user);
  const sort = sortOf(def, query), order = orderOf(def, sort);
  const all = await pageAll(async (limit, offset) => strip((await def.query({ filters, user, limit, offset, order, sort })).rows, hide), def.exportPage);
  return { ...all, columns, hidden: hide.size > 0 };
}

/** The JSON (or CSV, or Excel) answer of one registered table for one viewer. */
export async function runTable(user: User, def: DrillDef, query: URLSearchParams): Promise<unknown | Response> {
  requirePerm(user, "reports.view");
  const { hide, columns } = shape(def, user);
  const filters = parseFilters(query);
  const sort = sortOf(def, query);
  const order = orderOf(def, sort);
  const format = query.get("format") ?? "json";
  if (format !== "json" && format !== "csv" && format !== "xlsx") throw err("VALIDATION", "format must be json, csv or xlsx", { field: "format" });
  if (format === "csv" || format === "xlsx") {
    requirePerm(user, "reports.export");
    const rawKeys = format === "csv" && query.get("headers") === "keys"; // `headers=keys`: the machine form (column keys, money in halalas)
    const tr = rawKeys ? null : translator(localeOf(query, user)); // an invalid `lang` is refused before any query runs
    const { rows: out, truncated } = await pageAll(async (limit, offset) => strip((await def.query({ filters, user, limit, offset, order, sort })).rows, hide), def.exportPage);
    await audit(user, "report.export", "report", `${def.report}/${def.name}`, { rows: out.length, truncated, filters: filters.canonical, ...(format === "xlsx" ? { format: "xlsx" } : {}) });
    if (tr && format === "csv") {
      return new Response("\uFEFF" + (await tableCsv(tr, columns, out)), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${def.report}-${def.name}.csv"`, "cache-control": "no-store" } });
    }
    if (tr) {
      const file = await tableXlsx({ tr, report: def.report, table: def.name, titleKey: def.title, columns, rows: out, truncated, max: MAX_CSV_ROWS, filters, moneyHidden: hide.size > 0 });
      const { from, to } = filters.cur;
      return new Response(new Uint8Array(file), { headers: { "content-type": XLSX_MIME, "content-disposition": `attachment; filename="${def.report}-${def.name}-${from}_${to}.xlsx"`, "cache-control": "no-store" } });
    }
    const body = rawCsv(columns, out);
    return new Response("\uFEFF" + body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${def.report}-${def.name}.csv"`, "cache-control": "no-store" } });
  }
  const page = intParam(query, "page", 1, 1, 100_000), pageSize = intParam(query, "pageSize", 25, 1, MAX_PAGE_SIZE);
  const res = await def.query({ filters, user, limit: pageSize, offset: (page - 1) * pageSize, order, sort });
  return {
    meta: { ...filtersMeta(filters), generatedAt: new Date().toISOString() },
    title: def.title, columns: columns.map((c) => ({ ...c, sortable: c.key in def.sorts })),
    rows: strip(res.rows, hide), page, pageSize, total: res.total, sort,
  };
}
