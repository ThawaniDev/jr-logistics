import { sql, type SQL } from "drizzle-orm";
import type { User } from "@/db/schema";
import { err } from "@/lib/errors";
import { audit } from "../audit";
import { toCsv } from "../ops";
import { localeOf, translator } from "../export/context";
import { tableXlsx, XLSX_MIME } from "../export/table-export";
import { MAX_CSV_ROWS, MAX_PAGE_SIZE, isoValue, pageAll, type DrillColumn } from "./registry";
import { portalCtx, portalMeta, type PortalCtx, type PortalRole } from "./portal-scope";

/**
 * Drill-down tables of the portal reports: `GET /<business|office>/analytics/table/:name?<filters>&page&pageSize&sort&dir[&format=csv]`. Same response contract as the admin tables
 * (`DrillTable`-compatible), but the scope is the SIGNED-IN owner (`portalCtx`), there is no staff permission, and the owner may export CSV of their own data (audited as
 * `report.export`, formula-injection safe, UTF-8 with BOM) or as Excel (`format=xlsx&lang=ar|en|ur`, same rules, see `server/export/`). A table is registered with `definePortalTable()` in a module the route file imports.
 */
export interface PortalQuery { c: PortalCtx; limit: number; offset: number; order: SQL; sort: { key: string; dir: "asc" | "desc" } }
export interface PortalTableDef {
  portal: PortalRole; name: string;
  /** i18n key of the title. */
  title: string;
  columns: DrillColumn[];
  /** Sortable columns: key → SQL expression to order by (a key that is not here cannot be sorted). */
  sorts: Record<string, SQL>;
  defaultSort: { key: string; dir: "asc" | "desc" };
  /** Unique, stable expression appended to the ORDER BY so paging never skips or repeats a row. */
  tiebreak: SQL;
  query(q: PortalQuery): Promise<{ rows: Array<Record<string, unknown>>; total: number }>;
}
const TABLES = new Map<string, PortalTableDef>();
export const definePortalTable = (def: PortalTableDef) => { TABLES.set(`${def.portal}/${def.name}`, def); };
export const getPortalTable = (portal: PortalRole, name: string) => TABLES.get(`${portal}/${name}`);
export const listPortalTables = (portal?: PortalRole) => [...TABLES.values()].filter((d) => !portal || d.portal === portal);

const intParam = (q: URLSearchParams, k: string, def: number, min: number, max: number) => {
  const raw = q.get(k); if (raw == null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw err("VALIDATION", `${k} must be a whole number between ${min} and ${max}`, { field: k });
  return n;
};
const strip = (rows: Array<Record<string, unknown>>) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, isoValue(v)])));

/** Every row of one portal table for the signed-in owner (default sort, capped like every export): what the workbook export bundles. */
export async function collectPortalTable(def: PortalTableDef, c: PortalCtx) {
  const sort = { ...def.defaultSort };
  const order = sql`${def.sorts[sort.key]} ${sql.raw(sort.dir)} nulls last, ${def.tiebreak} asc`;
  return pageAll(async (limit, offset) => strip((await def.query({ c, limit, offset, order, sort })).rows));
}

/** The JSON (or CSV, or Excel) answer of one table for the signed-in owner. */
export async function runPortalTable(user: User, role: PortalRole, name: string, query: URLSearchParams): Promise<unknown | Response> {
  const def = getPortalTable(role, name);
  if (!def) throw err("NOT_FOUND", "Unknown report table");
  const c = await portalCtx(user, query, role);
  const key = query.get("sort") || def.defaultSort.key;
  if (!Object.hasOwn(def.sorts, key)) throw err("VALIDATION", "This column cannot be sorted", { field: "sort" }); // own keys only: `__proto__` / `constructor` are not columns
  const dir = query.get("dir") || (key === def.defaultSort.key ? def.defaultSort.dir : "asc");
  if (dir !== "asc" && dir !== "desc") throw err("VALIDATION", "dir must be asc or desc", { field: "dir" });
  const sort = { key, dir: dir as "asc" | "desc" };
  const order = sql`${def.sorts[key]} ${sql.raw(sort.dir)} nulls last, ${def.tiebreak} asc`;
  const format = query.get("format") ?? "json";
  if (format !== "json" && format !== "csv" && format !== "xlsx") throw err("VALIDATION", "format must be json, csv or xlsx", { field: "format" });
  if (format === "csv" || format === "xlsx") {
    const tr = format === "xlsx" ? translator(localeOf(query, user)) : null;
    const { rows: out, truncated } = await pageAll(async (limit, offset) => strip((await def.query({ c, limit, offset, order, sort })).rows));
    await audit(user, "report.export", "report", `${role}/${name}`, { rows: out.length, truncated, filters: c.f.canonical, ...(format === "xlsx" ? { format: "xlsx" } : {}) });
    if (tr) {
      const file = await tableXlsx({ tr, report: `portal-${role}`, table: name, titleKey: def.title, columns: def.columns, rows: out, truncated, max: MAX_CSV_ROWS, filters: c.f, skipFilters: ["company", "office"] });
      return new Response(new Uint8Array(file), { headers: { "content-type": XLSX_MIME, "content-disposition": `attachment; filename="${role}-${name}-${c.f.cur.from}_${c.f.cur.to}.xlsx"`, "cache-control": "no-store" } });
    }
    const body = toCsv(def.columns.map((x) => x.key), out);
    return new Response("\uFEFF" + body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${role}-${name}.csv"`, "cache-control": "no-store" } });
  }
  const page = intParam(query, "page", 1, 1, 100_000), pageSize = intParam(query, "pageSize", 25, 1, MAX_PAGE_SIZE);
  const res = await def.query({ c, limit: pageSize, offset: (page - 1) * pageSize, order, sort });
  return {
    meta: portalMeta(c, { empty: res.total === 0, failed: [], generatedAt: Date.now(), cached: false }), title: def.title,
    columns: def.columns.map((x) => ({ ...x, sortable: Object.hasOwn(def.sorts, x.key) })), rows: strip(res.rows), page, pageSize, total: res.total, sort,
  };
}
