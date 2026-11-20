import { useMemo, useSyncExternalStore } from "react";
import { FD_BY_KEY, FD_COLS, FD_DEFAULT_SORT, FD_GROUPS, type FdCol, type FdRow } from "@/server/finance-drivers-lib";
import type { SortState } from "./fin-sort-table";

/** Finance › Drivers on screen: the URL state ↔ the API query, the sort toggle and the saved column choice. Pure (unit-tested in `tests/unit/finance-drivers-ui.test.ts`). */
export interface DriversUrl { q: string; office: string; city: string; status: string; hasCash: boolean; hasPending: boolean; sort: string; dir: string; page: number; from: string; to: string; period: string }
export const PAGE_SIZE = 25;

/** The API query string of the list (only non-default values). `extra` adds `format=…` for the downloads. */
export function listQuery(u: DriversUrl, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  const put = (k: string, v: string | number | boolean) => { if (v !== "" && v !== false && v !== 0) p.set(k, String(v)); };
  put("q", u.q.trim()); put("office", u.office); put("city", u.city); put("status", u.status); put("hasCash", u.hasCash ? "1" : ""); put("hasPending", u.hasPending ? "1" : "");
  if (u.sort && FD_BY_KEY.has(u.sort)) { put("sort", u.sort); put("dir", u.dir === "asc" ? "asc" : "desc"); }
  if (u.period === "all") put("period", "all"); else if (u.from && u.to) { put("from", u.from); put("to", u.to); }
  if (!extra.format) { put("page", u.page > 1 ? u.page : 0); put("pageSize", PAGE_SIZE); } // a download is the whole selection, not a page
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}
/** The current sort (`earnedCents desc` when the URL has none or a column this version does not know). */
export function sortOfUrl(sort: string, dir: string): SortState {
  return FD_BY_KEY.has(sort) ? { key: sort, dir: dir === "asc" ? "asc" : "desc" } : { ...FD_DEFAULT_SORT };
}
/** Header click: a new column starts descending for numbers and dates (biggest first) and ascending for text; the same column flips. */
export function nextSort(cur: SortState, key: string): SortState {
  if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
  const k = FD_BY_KEY.get(key)?.kind;
  return { key, dir: k === "text" || k === "enum" ? "asc" : "desc" };
}

export const UI_COLS: FdCol[] = FD_COLS.filter((c) => c.ui !== false);
export const DEFAULT_COLS: string[] = UI_COLS.filter((c) => c.on).map((c) => c.key);
export const pickerGroups = (label: (key: string) => string, groupLabel: (g: string) => string) =>
  FD_GROUPS.map((g) => ({ id: g, label: groupLabel(g), items: UI_COLS.filter((c) => c.group === g).map((c) => ({ key: c.key, label: label(c.key) })) })).filter((g) => g.items.length > 0);

const STORE = "jr.fd.cols";
/** Keys from the saved JSON text (browser storage may hold old keys: unknown keys are dropped, an empty result falls back to the defaults). */
export function parseCols(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? "null");
    const keys = Array.isArray(v) ? v.filter((k): k is string => typeof k === "string" && UI_COLS.some((c) => c.key === k)) : [];
    return keys.length ? UI_COLS.map((c) => c.key).filter((k) => keys.includes(k)) : DEFAULT_COLS;
  } catch { return DEFAULT_COLS; }
}
const listeners = new Set<() => void>();
const read = (): string => { try { return window.localStorage.getItem(STORE) ?? ""; } catch { return memory; } };
let memory = ""; // when browser storage is blocked the choice lasts until reload
export function saveCols(keys: string[]) {
  memory = JSON.stringify(keys);
  try { window.localStorage.setItem(STORE, memory); } catch { /* storage blocked */ }
  listeners.forEach((l) => l());
}
/** The viewer's column choice: the server and the first client render use the defaults (no hydration mismatch), then the saved choice. */
export function useColumns(): string[] {
  const raw = useSyncExternalStore((cb) => { listeners.add(cb); window.addEventListener("storage", cb); return () => { listeners.delete(cb); window.removeEventListener("storage", cb); }; }, read, () => "");
  return useMemo(() => parseCols(raw || null), [raw]);
}

/** Count line of a withdrawals cell (`10` requests …): the SQL sends the count under the `…N` key. */
export const countOf = (row: FdRow, col: FdCol): number | null => { const k = FD_COLS.find((c) => c.subOf === col.key); return k ? Number(row[k.key] ?? 0) : null; };
