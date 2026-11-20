import type { CodDriver, CodOverview, CodWarehouse } from "./business-cod";

/**
 * The company cash page's flat "all orders" table (J6): flatten `GET /business/cod` into one row per order, filter (search, outstanding only), sort by a column, and write the CSV.
 * Pure, so the rules are unit-tested (`tests/unit/business-cod-lib.test.ts`).
 */
export interface CodRow {
  offerId: string; requestId: string; ref: string; driverId: string; driverName: string; warehouse: CodWarehouse; officeId: string | null; officeName: string | null;
  collectedCents: number; receivedCents: number; outstandingCents: number; lastCollectedAt: string | null;
}
export type CodSortKey = "ref" | "warehouse" | "office" | "driver" | "collected" | "received" | "outstanding";
export interface CodSort { key: CodSortKey; dir: "asc" | "desc" }
export const COD_SORT_DEFAULT: CodSort = { key: "outstanding", dir: "desc" };
export const COD_SORT_KEYS: readonly CodSortKey[] = ["ref", "warehouse", "office", "driver", "collected", "received", "outstanding"];
export const parseSortKey = (k: string | null | undefined): CodSortKey => ((COD_SORT_KEYS as readonly string[]).includes(k ?? "") ? (k as CodSortKey) : COD_SORT_DEFAULT.key);

/** Every order of every driver, with its driver. Missing J6 fields (an older server) become an unknown warehouse and an independent driver. */
export function flattenOrders(data: CodOverview | undefined): CodRow[] {
  return (data?.drivers ?? []).flatMap((d: CodDriver) => (d.orders ?? []).map((o) => ({
    offerId: o.offerId, requestId: o.requestId, ref: o.ref, driverId: d.driverId, driverName: d.driverName, warehouse: o.warehouse ?? { label: "", city: null },
    officeId: o.officeId ?? null, officeName: o.officeId ? (o.officeName ?? null) : null, collectedCents: o.collectedCents, receivedCents: o.receivedCents, outstandingCents: o.outstandingCents, lastCollectedAt: o.lastCollectedAt ?? null,
  })));
}

const norm = (s: string) => s.toLocaleLowerCase().normalize("NFKC");
/** Search over order number, driver, warehouse (label and city) and office; every word must match somewhere. */
export function filterOrders(rows: CodRow[], q: string, onlyOutstanding: boolean, cityLabel: (key: string) => string = (k) => k): CodRow[] {
  const words = norm(q.trim()).split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (onlyOutstanding && r.outstandingCents <= 0) return false;
    if (!words.length) return true;
    const hay = norm([r.ref, r.driverName, r.warehouse.label, r.warehouse.city ? cityLabel(r.warehouse.city) : "", r.officeName ?? ""].join(" "));
    return words.every((w) => hay.includes(w));
  });
}

const text = (r: CodRow, k: CodSortKey): string => (k === "ref" ? r.ref : k === "warehouse" ? r.warehouse.label : k === "office" ? (r.officeName ?? "") : r.driverName);
const num = (r: CodRow, k: CodSortKey): number => (k === "collected" ? r.collectedCents : k === "received" ? r.receivedCents : r.outstandingCents);
/** Stable sort by one column; text compares as the viewer's language would (numeric-aware, so JR-2 < JR-10); ties keep the newest collection first. Independent drivers sort last in the Office column. */
export function sortOrders(rows: CodRow[], s: CodSort, locale = "en"): CodRow[] {
  const sign = s.dir === "asc" ? 1 : -1;
  const isText = s.key === "ref" || s.key === "warehouse" || s.key === "office" || s.key === "driver";
  const cmp = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return rows.map((r, i) => ({ r, i })).sort((a, b) => {
    let d: number;
    if (isText) {
      const ta = text(a.r, s.key), tb = text(b.r, s.key);
      d = !ta && tb ? 1 : ta && !tb ? -1 : cmp.compare(ta, tb) * sign; // blanks (no office) always last
    } else d = (num(a.r, s.key) - num(b.r, s.key)) * sign;
    return d || (b.r.lastCollectedAt ?? "").localeCompare(a.r.lastCollectedAt ?? "") || a.i - b.i;
  }).map((x) => x.r);
}

/** CSV cell with the formula guard (a leading `= + - @`, tab or CR becomes text) and quotes where needed. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const sar = (c: number) => (c / 100).toFixed(2);
/** The table as CSV (UTF-8 BOM so Excel reads Arabic): header, then one line per row; money in SAR with two decimals. */
export function ordersCsv(rows: CodRow[], head: { ref: string; warehouse: string; city: string; office: string; driver: string; collected: string; received: string; outstanding: string }, independent: string, cityLabel: (key: string) => string = (k) => k): string {
  const lines = [[head.ref, head.warehouse, head.city, head.office, head.driver, head.collected, head.received, head.outstanding].map(csvCell).join(",")];
  for (const r of rows) lines.push([r.ref, r.warehouse.label, r.warehouse.city ? cityLabel(r.warehouse.city) : "", r.officeId ? (r.officeName ?? "") : independent, r.driverName, sar(r.collectedCents), sar(r.receivedCents), sar(r.outstandingCents)].map(csvCell).join(","));
  return "﻿" + lines.join("\n");
}
