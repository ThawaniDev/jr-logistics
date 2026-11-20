import { presetRange, type Preset } from "@/server/analytics/periods";
import { addDays, diffDays, type Ymd } from "@/server/analytics/time";

/**
 * Pure helpers of the fleet report centre (no React, no fetching; unit-tested in tests/unit/fleet-ui-lib.test.ts): which views a viewer gets, which registered table
 * a view reads, and every URL the centre calls (table, notes, workbook, KPI strip). The contract is memory/FLEET_REPORTS.md (§4 tables, §5 endpoints).
 */
/** `office` / `driver`: an entity page of the back office (the id is injected as the `office` / `driver` filter); `portal`: the signed-in courier office (scope is the session). */
export type FleetKind = "office" | "driver" | "portal";
export type FleetScope = { kind: "office"; id: string } | { kind: "driver"; id: string } | { kind: "portal" };
export type FleetView = "daily" | "drivers" | "money" | "money_daily" | "jobs" | "earnings" | "failures";

/** The daily tables refuse a longer period (`VALIDATION`), so the centre never asks for one. */
export const MAX_DAILY_DAYS = 366;
/** The presets of the period bar (a custom range is the sixth choice). */
export const FLEET_PRESETS = ["today", "7d", "30d", "90d", "mtd"] as const satisfies readonly Preset[];
export const API_PREFIX = "/api/v1";

const OFFICE_VIEWS: readonly FleetView[] = ["daily", "drivers", "money", "money_daily", "jobs", "earnings", "failures"];
const DRIVER_VIEWS: readonly FleetView[] = ["daily", "money", "money_daily", "jobs", "failures"];
/** The views of each kind, in the order of the switch. */
export const VIEW_ORDER: Record<FleetKind, readonly FleetView[]> = { office: OFFICE_VIEWS, portal: OFFICE_VIEWS, driver: DRIVER_VIEWS };
/** Views that show money: they need `finance.view` in the back office (the portal owner sees their own). */
export const isMoneyView = (v: FleetView): boolean => v === "money" || v === "money_daily" || v === "earnings";

export interface FleetCaps { finance: boolean }
/** The views with one row per day: these are the ones the server refuses for a period longer than `MAX_DAILY_DAYS`. */
export const isDailyView = (v: FleetView | "perf"): boolean => v === "daily" || v === "money_daily";
export const viewsFor = (kind: FleetKind, caps: FleetCaps): FleetView[] => VIEW_ORDER[kind].filter((v) => caps.finance || !isMoneyView(v));
/** The view named in the URL when this viewer may see it, otherwise the first one (Daily). */
export function resolveView(raw: string | null | undefined, kind: FleetKind, caps: FleetCaps): FleetView {
  const list = viewsFor(kind, caps);
  return (list as string[]).includes(raw ?? "") ? (raw as FleetView) : list[0];
}

/** Which registered drill-down table a view reads. Back office: report `drivers` / `offices` (`GET /admin/analytics/:report/table/:name`); portal: `GET /office/analytics/table/:name`. */
export type TableRef = { portal: false; report: "drivers" | "offices"; name: string } | { portal: true; name: string };
export function tableFor(kind: FleetKind, view: FleetView): TableRef {
  if (kind === "portal") return { portal: true, name: view === "drivers" ? "perf" : view };
  // An office page: its drivers and what each earned come from the drivers report narrowed to the office; everything else is the office's own table.
  if (kind === "office") return view === "drivers" ? { portal: false, report: "drivers", name: "perf" } : view === "money" ? { portal: false, report: "drivers", name: "money" } : { portal: false, report: "offices", name: view };
  return { portal: false, report: "drivers", name: view };
}

/** The period (and comparison) the centre works with; `preset` is `custom` when `from` / `to` are in the URL. */
export interface PeriodLike { preset: string; from: Ymd; to: Ymd; compare: string }
/** The day range of a period: the days of a custom range, or what a preset stands for today. */
export function rangeOf(p: Pick<PeriodLike, "preset" | "from" | "to">, today: Ymd): { from: Ymd; to: Ymd; days: number } {
  const r = p.preset === "custom" ? { from: p.from, to: p.to } : presetRange(p.preset as Preset, today);
  return { ...r, days: diffDays(r.from, r.to) + 1 };
}
export const tooLong = (days: number): boolean => days > MAX_DAILY_DAYS;
/** Bounds for the two date inputs of a custom range so the pair can never exceed `MAX_DAILY_DAYS`: `from` may not be earlier than `minFrom`, `to` not later than `maxTo`. */
export const rangeLimits = (from: Ymd, to: Ymd) => ({ minFrom: addDays(to, -(MAX_DAILY_DAYS - 1)), maxTo: addDays(from, MAX_DAILY_DAYS - 1) });

/** `preset=30d&compare=prev` or `from=…&to=…&compare=…` — always explicit, so every endpoint of the centre sees the same window. */
export function periodQs(p: PeriodLike): string {
  const q = new URLSearchParams();
  if (p.preset === "custom") { q.set("from", p.from); q.set("to", p.to); } else q.set("preset", p.preset);
  q.set("compare", p.compare);
  return q.toString();
}
/** The query of the table and KPI endpoints: the period plus the fixed entity (`office=<id>` / `driver=<id>`); the portal needs none (the server scopes it to the session). */
export function entityQs(scope: FleetScope, p: PeriodLike): string {
  const base = periodQs(p);
  return scope.kind === "portal" ? base : `${base}&${scope.kind}=${encodeURIComponent(scope.id)}`;
}

export type Format = "xlsx" | "csv";
/** `/office/analytics/table/daily?…` or `/admin/analytics/drivers/table/perf?…` (no `/api/v1`, for `useApi`). */
export const tablePath = (t: TableRef, qs: string): string => `${t.portal ? "/office/analytics" : `/admin/analytics/${t.report}`}/table/${t.name}?${qs}`;
/** The download link of a table: the same query plus `format` and the language of the headers. */
export const tableDownload = (t: TableRef, qs: string, format: Format, lang: string): string => `${API_PREFIX}${tablePath(t, qs)}&format=${format}&lang=${lang}`;
/** `GET …/notes?<period + entity query>&table=<name>&lang=` → `{ notes: string[] }`: the "how to read this" lines of ONE table for the selected period (the export's Notes sheet says the same). */
export const notesPath = (t: TableRef, qs: string, lang: string): string => `${t.portal ? "/office/analytics" : `/admin/analytics/${t.report}`}/notes?${qs}&table=${t.name}&lang=${lang}`;
/** The multi-sheet workbook of the whole entity: the period filters only (the entity is in the path for the back office, the session for the portal). */
export function workbookDownload(scope: FleetScope, p: PeriodLike, lang: string): string {
  const path = scope.kind === "portal" ? "/office/analytics/workbook" : `/admin/analytics/workbook/${scope.kind}/${encodeURIComponent(scope.id)}`;
  return `${API_PREFIX}${path}?${periodQs(p)}&lang=${lang}`;
}
/** The report that feeds the KPI strip: the offices / drivers report narrowed to the entity, or the portal overview. */
export function kpiPath(scope: FleetScope, qs: string): string {
  return scope.kind === "portal" ? `/office/analytics/overview?${qs}` : `/admin/analytics/${scope.kind === "office" ? "offices" : "drivers"}?${qs}`;
}

/** The file name of a `Content-Disposition` header (`attachment; filename="x.xlsx"`, or RFC 5987 `filename*=UTF-8''…`), else `fallback`. */
export function fileNameFrom(header: string | null | undefined, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch { /* fall through */ } }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(header);
  return plain?.[1]?.trim() || fallback;
}
/** Page size of a view: a month fits on one page of a daily table. */
export const pageSizeOf = (view: FleetView): number => (view === "daily" || view === "money_daily" ? 31 : 15);
