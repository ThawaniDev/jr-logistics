import type { User } from "@/db/schema";
import { err } from "@/lib/errors";
import { audit } from "../audit";
import { hit } from "../auth/ratelimit";
import { requirePerm } from "../auth/permissions";
import { toCsv } from "../ops";
import { isTemporal } from "./explorer-core";
import { allDatasets, getDataset } from "./explorer-registry";
import {
  aggregable, availableColumns, availableFilters, countQuery, datasetAllowed, groupable, groupQuery, LIMITS, masked, pageQuery, parseRequest, sortable, viewerOf, type Parsed,
} from "./explorer-query";
import { num, rows } from "./guard";
import { isoValue } from "./registry";
import "./explorer-datasets-ops";
import "./explorer-datasets-fin";
import "./explorer-datasets-people";
import "./explorer-datasets-support";

/** Exports per user per minute (a fixed window in Postgres, so it holds across server instances). */
export const EXPORTS_PER_MINUTE = 6;

/** Explorer access: the data needs both report permissions (the shared filter bar reads `reports.view`; CSV and this tool are `reports.export`). */
function guard(user: User) { requirePerm(user, "reports.view"); requirePerm(user, "reports.export"); }
function lookup(user: User, key: string) {
  const ds = getDataset(key);
  if (!ds) throw err("NOT_FOUND", "Unknown dataset");
  if (!datasetAllowed(ds, user)) throw err("FORBIDDEN", "Missing permission");
  return ds;
}
const norm = (v: unknown): unknown => { const x = isoValue(v); return x !== null && typeof x === "object" ? JSON.stringify(x) : x; };
const cleanRow = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, norm(v)]));

/** `GET /admin/analytics/explorer/datasets`: what this viewer can query — datasets, their columns (money columns only with `finance.view`, personal data flagged as masked), filters and limits. */
export async function explorerCatalog(user: User) {
  guard(user);
  const v = viewerOf(user);
  return {
    limits: { pageSize: LIMITS.pageSize, maxOffset: LIMITS.maxOffset, countCap: LIMITS.countCap, exportCap: LIMITS.exportCap, columns: LIMITS.columns, aggs: LIMITS.aggs, groups: LIMITS.groups },
    viewer: v,
    datasets: allDatasets().filter((d) => datasetAllowed(d, user)).map((d) => ({
      key: d.key, group: d.group, time: d.time.label, keys: d.keys, defaultSort: d.defaultSort,
      columns: availableColumns(d, v).map((c) => ({ key: c.key, type: c.type, ns: c.ns, values: c.values, default: !!c.default, masked: masked(c, v), sortable: sortable(c, v), groupable: groupable(c, v), aggregable: aggregable(c, v), temporal: isTemporal(c.type) })),
      filters: availableFilters(d, v).map((x) => ({ key: x.key, kind: x.kind, ns: x.ns, values: x.values, money: !!x.money, dateOnly: !!x.dateOnly })),
      hasSearchPii: !!d.searchPii?.length && v.sensitive,
    })),
  };
}

function metaOf(p: Parsed) {
  return {
    dataset: p.ds.key, all: p.all, period: p.all ? null : { from: p.f.cur.from, to: p.f.cur.to, days: p.f.cur.days }, ignored: p.ignored, filters: p.echo, q: p.q,
    generatedAt: new Date().toISOString(), maskedColumns: p.cols.filter((c) => masked(c, p.viewer)).map((c) => c.key), moneyHidden: !p.viewer.money && p.ds.columns.some((c) => c.money),
  };
}

/** One page of a dataset, or — with `group` — the grouped summary. */
async function page(p: Parsed) {
  const offset = (p.page - 1) * p.pageSize;
  if (offset >= LIMITS.maxOffset) throw err("VALIDATION", `Only the first ${LIMITS.maxOffset} rows can be paged through: narrow the filters or export the data`, { field: "page" });
  const [list, [t]] = await Promise.all([rows(pageQuery(p, p.pageSize, offset)), rows(countQuery(p, LIMITS.countCap))]);
  const total = Math.min(num(t?.n), LIMITS.countCap);
  return {
    meta: metaOf(p),
    columns: p.cols.map((c) => ({ key: c.key, type: c.type, ns: c.ns, href: c.href, sortable: sortable(c, p.viewer), masked: masked(c, p.viewer) })),
    rows: list.map(cleanRow), page: p.page, pageSize: p.pageSize, total, totalCapped: num(t?.n) > LIMITS.countCap, sort: { key: p.sort.col.key, dir: p.sort.dir }, offsetCap: LIMITS.maxOffset,
  };
}
async function grouped(p: Parsed) {
  const g = p.group!;
  const list = await rows(groupQuery(p));
  const truncated = list.length > LIMITS.groups;
  return {
    meta: metaOf(p), group: { key: g.col.key, type: g.col.type, ns: g.col.ns, bucket: g.bucket }, aggs: p.aggs.map((a) => ({ key: a.key, fn: a.fn, column: a.col!.key, type: a.col!.type })),
    rows: list.slice(0, LIMITS.groups).map(cleanRow), truncated, groupCap: LIMITS.groups,
  };
}

/** The explorer's CSV: header = column keys, UTF-8 with BOM, formula injection neutralised by `toCsv`. Grouped requests export the summary (≤ 500 groups). */
function csvResponse(name: string, body: BodyInit, extra: Record<string, string> = {}) {
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store", ...extra } });
}
const exportAudit = (user: User, p: Parsed, d: Record<string, unknown>) =>
  audit(user, "report.export", "report", `explorer/${p.ds.key}`, { dataset: p.ds.key, filters: p.f.canonical, datasetFilters: p.echo, q: p.q || undefined, all: p.all, columns: p.cols.map((c) => c.key), ...d }).catch(() => undefined);

async function exportGrouped(user: User, p: Parsed) {
  const res = await grouped(p);
  const label = (a: { fn: string; column: string }) => `${a.fn}_${a.column}`;
  const keys = ["group", "count", ...res.aggs.map(label)];
  const data = res.rows.map((r) => ({ group: r.g, count: r.n, ...Object.fromEntries(res.aggs.map((a) => [label(a), r[a.key]])) }));
  await exportAudit(user, p, { rows: data.length, group: p.group!.col.key, aggs: res.aggs.map(label), truncated: res.truncated });
  return csvResponse(`explorer-${p.ds.key}-summary`, "\uFEFF" + toCsv(keys, data) + "\n");
}

async function exportRows(user: User, p: Parsed) {
  const [t] = await rows(countQuery(p, LIMITS.exportCap));
  const total = Math.min(num(t?.n), LIMITS.exportCap), truncated = num(t?.n) > LIMITS.exportCap;
  const keys = p.cols.map((c) => c.key), header = keys.join(","), enc = new TextEncoder();
  let offset = 0, closed = false;
  const finish = (d: Record<string, unknown>) => { if (closed) return Promise.resolve(); closed = true; return exportAudit(user, p, { rows: offset, expected: total, truncated, ...d }); };
  const stream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(enc.encode("\uFEFF" + header + "\n")); },
    async pull(c) {
      try {
        const left = total - offset;
        const batch = left > 0 ? await rows(pageQuery(p, Math.min(LIMITS.batch, left), offset)) : [];
        if (!batch.length) { await finish({}); c.close(); return; }
        offset += batch.length;
        c.enqueue(enc.encode(toCsv(keys, batch.map(cleanRow)).slice(header.length + 1) + "\n"));
      } catch (e) { await finish({ failed: true }); c.error(e); }
    },
    async cancel() { await finish({ aborted: true }); },
  });
  return csvResponse(`explorer-${p.ds.key}`, stream, { "x-export-rows": String(total), "x-export-truncated": truncated ? "1" : "0" });
}

/** `GET /admin/analytics/explorer/:dataset` — JSON page, JSON group summary, or (with `format=csv`) the streamed export. */
export async function explorerQuery(user: User, key: string, query: URLSearchParams): Promise<unknown | Response> {
  guard(user);
  const ds = lookup(user, key);
  const format = query.get("format") ?? "json";
  if (format !== "json" && format !== "csv") throw err("VALIDATION", "format must be json or csv", { field: "format" });
  const p = await parseRequest(user, ds, query);
  if (format === "csv") {
    await hit(`explorer:export:${user.id}`, EXPORTS_PER_MINUTE, 60);
    return p.group ? exportGrouped(user, p) : exportRows(user, p);
  }
  return p.group ? grouped(p) : page(p);
}
