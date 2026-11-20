import type { explorerCatalog } from "@/server/analytics/explorer";

/** Pure helpers of the Data explorer UI: the URL state, labels, the saved views kept in localStorage, and the CSV download. Unit-tested; no React. */
export type Catalog = Awaited<ReturnType<typeof explorerCatalog>>;
export type CatalogDataset = Catalog["datasets"][number];
export type CatalogColumn = CatalogDataset["columns"][number];
export type CatalogFilter = CatalogDataset["filters"][number];
type T = (key: string, vars?: Record<string, string | number>) => string;

export interface PageResult {
  meta: { dataset: string; all: boolean; period: { from: string; to: string; days: number } | null; ignored: string[]; filters: Record<string, string>; q: string; generatedAt: string; maskedColumns: string[]; moneyHidden: boolean };
  columns: Array<{ key: string; type: string; ns?: string; href?: string; sortable: boolean; masked: boolean }>;
  rows: Array<Record<string, unknown>>; page: number; pageSize: number; total: number; totalCapped: boolean; sort: { key: string; dir: "asc" | "desc" }; offsetCap: number;
}
export interface GroupResult {
  meta: PageResult["meta"]; group: { key: string; type: string; ns?: string; bucket: string | null };
  aggs: Array<{ key: string; fn: string; column: string; type: string }>; rows: Array<Record<string, unknown>>; truncated: boolean; groupCap: number;
}

/** The explorer's own URL parameters (the shared period / filter parameters belong to `useReportFilters`). */
export interface ExplorerState {
  ds: string; cols: string[]; sort: string; dir: "asc" | "desc" | ""; q: string; all: boolean; filters: Record<string, string>; group: string; agg: string[]; ps: number;
}
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const EXPLORER_PARAMS = ["ds", "cols", "sort", "dir", "q", "all", "group", "agg", "ps"] as const;
const csv = (v: string | null) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);

export function parseState(sp: URLSearchParams): ExplorerState {
  const filters: Record<string, string> = {};
  for (const [k, v] of sp.entries()) if (k.startsWith("f.") && v) filters[k.slice(2)] = v;
  const ps = Number(sp.get("ps"));
  const dir = sp.get("dir");
  return {
    ds: sp.get("ds") ?? "", cols: csv(sp.get("cols")), sort: sp.get("sort") ?? "", dir: dir === "asc" || dir === "desc" ? dir : "", q: sp.get("q") ?? "", all: sp.get("all") === "1",
    filters, group: sp.get("group") ?? "", agg: csv(sp.get("agg")), ps: (PAGE_SIZES as readonly number[]).includes(ps) ? ps : 25,
  };
}
/** The explorer part of the API query string for one dataset: only parameters that differ from the defaults, columns the dataset still has. */
export function apiParams(s: ExplorerState, ds: CatalogDataset | undefined, page = 1): string {
  const p = new URLSearchParams();
  const known = new Set(ds?.columns.map((c) => c.key));
  const cols = s.cols.filter((c) => known.has(c));
  if (cols.length) p.set("cols", cols.join(","));
  if (s.sort && known.has(s.sort)) { p.set("sort", s.sort); if (s.dir) p.set("dir", s.dir); }
  if (s.q) p.set("q", s.q);
  if (s.all) p.set("all", "1");
  const fk = new Set(ds?.filters.map((f) => f.key));
  for (const [k, v] of Object.entries(s.filters)) if (fk.has(k) && v) p.set(`f.${k}`, v);
  if (s.group && known.has(s.group.split("~")[0])) { p.set("group", s.group); if (s.agg.length) p.set("agg", s.agg.join(",")); }
  else { p.set("pageSize", String(s.ps)); if (page > 1) p.set("page", String(page)); }
  return p.toString();
}
/** The URL patch that switches dataset: every dataset-specific parameter is cleared (columns, sort, filters, group). */
export function datasetPatch(next: string, current: URLSearchParams): Record<string, string> {
  const patch: Record<string, string> = { ds: next, cols: "", sort: "", dir: "", q: "", group: "", agg: "" };
  for (const k of current.keys()) if (k.startsWith("f.")) patch[k] = "";
  return patch;
}
/** Number of dataset filters in use (for the badge on the filter panel). */
export const activeFilters = (s: ExplorerState) => Object.keys(s.filters).length + (s.q ? 1 : 0);

export const columnLabel = (t: T, key: string) => t(`rpq.c_${key}`);
export const filterLabel = (t: T, key: string) => t(`rpq.f_${key}`);
/** The text of an enum / status value: the column's dictionary namespace, then the explorer's own `rpq.v_*` words, then the raw value. */
export function valueLabel(t: T, ns: string | undefined, value: string): string {
  if (ns) { const k = `${ns}.${value}`, s = t(k); if (s !== k) return s; }
  const k2 = `rpq.v_${value}`, s2 = t(k2);
  return s2 !== k2 ? s2 : value;
}
/** `min..max` / `from..to` from the two inputs of a range filter; "" when both are empty. */
export const rangeValue = (lo: string, hi: string) => (lo.trim() || hi.trim() ? `${lo.trim()}..${hi.trim()}` : "");
export const splitRange = (v: string | undefined): [string, string] => { const i = (v ?? "").indexOf(".."); return i < 0 ? ["", ""] : [v!.slice(0, i), v!.slice(i + 2)]; };
/** Toggles `key` in a comma list (the `cols` parameter and multi-value filters), keeping the dataset's own order. */
export function toggleIn(list: string[], key: string, order: string[]): string[] {
  const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  return order.filter((k) => next.includes(k));
}
/** `/admin/requests/{requestId}` with the row's fields. */
export const fillHref = (tpl: string, row: Record<string, unknown>) => tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(row[k] ?? "")));

/** What an input shows while it is being edited: the typed text as long as the URL value it was typed against is still current, else the URL value (no effect needed to copy state). */
export const draftOf = (draft: { for: string; v: string } | null, current: string) => (draft && draft.for === current ? draft.v : current);

// ───────── saved views (localStorage; the URL is the whole state, so a view is just a named query string) ─────────
export interface SavedView { id: string; name: string; qs: string; savedAt: number }
export const VIEWS_KEY = "jr.explorer.views.v1";
export const MAX_VIEWS = 30;
const isView = (v: unknown): v is SavedView => !!v && typeof v === "object" && typeof (v as SavedView).id === "string" && typeof (v as SavedView).name === "string" && typeof (v as SavedView).qs === "string";
export function readViews(raw: string | null): SavedView[] {
  try { const j = raw ? JSON.parse(raw) : []; return Array.isArray(j) ? j.filter(isView).slice(0, MAX_VIEWS) : []; } catch { return []; }
}
/** Adds (or replaces, by name) a view; newest first, at most `MAX_VIEWS`. The query string never carries `page`. */
export function addView(views: SavedView[], name: string, qs: string, now = Date.now()): SavedView[] {
  const clean = new URLSearchParams(qs); clean.delete("page");
  const n = name.trim().slice(0, 60);
  if (!n) return views;
  const v: SavedView = { id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: n, qs: clean.toString(), savedAt: now };
  return [v, ...views.filter((x) => x.name !== n)].slice(0, MAX_VIEWS);
}
export const removeView = (views: SavedView[], id: string) => views.filter((v) => v.id !== id);
export const VIEWS_EVENT = "jr:explorer-views";
/** The raw stored text (for `useSyncExternalStore`; null when there is none or the browser blocks storage). */
export function rawViews(): string | null { try { return window.localStorage.getItem(VIEWS_KEY); } catch { return null; } }
/** Stores the views and tells this tab's subscribers (the `storage` event only fires in other tabs). False when the browser refuses (private mode, blocked storage). */
export function storeViews(views: SavedView[]): boolean {
  try { window.localStorage.setItem(VIEWS_KEY, JSON.stringify(views)); window.dispatchEvent(new Event(VIEWS_EVENT)); return true; } catch { return false; }
}
export function subscribeViews(cb: () => void): () => void {
  window.addEventListener("storage", cb); window.addEventListener(VIEWS_EVENT, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(VIEWS_EVENT, cb); };
}

/** Downloads a CSV through fetch (so a 429 or 403 shows as a message instead of a file full of JSON). Returns the row count the server announced. */
export async function downloadCsv(url: string, filename: string): Promise<{ rows: number; truncated: boolean }> {
  const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) {
    let e: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } = {};
    try { e = await res.json(); } catch { /* not json */ }
    const { ApiError } = await import("@/lib/api");
    throw new ApiError(e.error?.code ?? "INTERNAL", e.error?.message ?? res.statusText, res.status, e.error?.details ?? {});
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return { rows: Number(res.headers.get("x-export-rows") ?? NaN), truncated: res.headers.get("x-export-truncated") === "1" };
}
