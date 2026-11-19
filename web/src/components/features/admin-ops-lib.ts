/**
 * Pure helpers for the admin dashboard, operations, requests, map, cancellations and reports views.
 * No React, no I/O: everything here is unit-tested in tests/unit/admin-ops-lib.test.ts.
 */

// ───────── Periods (Riyadh calendar days, "YYYY-MM-DD") ─────────
const KSA_MS = 3 * 3600_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The Riyadh calendar day of an instant (Saudi Arabia is UTC+3 all year). */
export const riyadhDay = (d: Date = new Date()) => new Date(d.getTime() + KSA_MS).toISOString().slice(0, 10);
/** `day` shifted by `n` calendar days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const isDay = (s: string | null | undefined): s is string => !!s && DAY_RE.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

export const PERIODS = ["", "today", "7d", "30d", "month"] as const;
export type PresetPeriod = (typeof PERIODS)[number];
export type PeriodKey = PresetPeriod | "custom";

/** The `from` / `to` days of a preset ("" = no limit). `to` is inclusive. */
export function periodRange(key: PresetPeriod, now: Date = new Date()): { from: string; to: string } {
  const today = riyadhDay(now);
  switch (key) {
    case "today": return { from: today, to: today };
    case "7d": return { from: addDays(today, -6), to: today };
    case "30d": return { from: addDays(today, -29), to: today };
    case "month": return { from: `${today.slice(0, 7)}-01`, to: today };
    default: return { from: "", to: "" };
  }
}
/** Which preset the two days are (so the segmented control lights up), "custom" for any other range, "" for none. */
export function matchPeriod(from: string, to: string, now: Date = new Date()): PeriodKey {
  if (!from && !to) return "";
  for (const k of PERIODS) {
    if (!k) continue;
    const r = periodRange(k, now);
    if (r.from === from && r.to === to) return k;
  }
  return "custom";
}

// ───────── Requests ─────────
/** Status order used everywhere a breakdown or a status filter is drawn. */
export const REQUEST_STATUS_ORDER = ["published", "filling", "assigned", "confirmed", "in_progress", "completed", "cancelled", "expired", "draft"] as const;
/** Statuses that count as "live" (a driver can still be needed, or is working). */
export const LIVE_REQUEST_STATUSES = ["published", "filling", "assigned", "confirmed", "in_progress"] as const;
/** The statuses staff can filter the request list by (drafts are the business's private work). */
export const REQUEST_FILTER_STATUSES = ["published", "filling", "assigned", "confirmed", "in_progress", "completed", "cancelled", "expired"] as const;

export const sumCounts = (counts: Record<string, number> | null | undefined, keys: readonly string[]) => keys.reduce((a, k) => a + (counts?.[k] ?? 0), 0);

/** Requests by status for the dashboard breakdown: non-empty statuses in canonical order with their share of the total (0–100, one decimal). */
export function statusSegments(counts: Record<string, number> | null | undefined): Array<{ status: string; n: number; pct: number }> {
  const c = counts ?? {};
  const known: string[] = [...REQUEST_STATUS_ORDER];
  const keys = [...known, ...Object.keys(c).filter((k) => !known.includes(k)).sort()];
  const total = keys.reduce((a, k) => a + (c[k] ?? 0), 0);
  return keys.filter((k) => (c[k] ?? 0) > 0).map((k) => ({ status: k, n: c[k], pct: total ? Math.round((c[k] / total) * 1000) / 10 : 0 }));
}

/** A status value from the URL, or "" when it is not one staff can filter by. */
export const cleanStatus = (s: string | null | undefined) => ((REQUEST_FILTER_STATUSES as readonly string[]).includes(s ?? "") ? (s as string) : "");

// ───────── Alerts (operations queue) ─────────
export type AlertSeverity = "critical" | "warning" | "info";
export interface OpsAlert { type: string; severity: AlertSeverity; requestId?: string; offerId?: string; ref?: string; detail?: Record<string, unknown> }
export const SEVERITIES: AlertSeverity[] = ["critical", "warning", "info"];

export function alertCounts(items: Array<{ severity: string }> | null | undefined): Record<AlertSeverity, number> {
  const out: Record<AlertSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const a of items ?? []) if (a.severity in out) out[a.severity as AlertSeverity] += 1;
  return out;
}
/** How many alerts of one type there are (e.g. `driver_late`, `unfilled_soon`). */
export const alertsOfType = (items: Array<{ type: string }> | null | undefined, type: string) => (items ?? []).filter((a) => a.type === type).length;

/** Where an alert without a request leads: the page that handles it (the caller still checks the viewer's permissions). */
export function alertTarget(a: { type: string; requestId?: string }): "request" | "verification" | "settlements" | null {
  if (a.requestId) return "request";
  if (a.type === "doc_expiring") return "verification";
  if (a.type === "settlement_pending") return "settlements";
  return null;
}

// ───────── Live map ─────────
export interface MapDriver { id: string; name: string; lat: number; lng: number; updatedAt: string; city: string | null; status: "available" | "on_job" | string }
/** Saudi Arabia bounding box for the dependency-free plot (a real map provider is an open owner decision). */
export const MAP_BOX = { minLat: 16, maxLat: 33, minLng: 34, maxLng: 56 };
/** Position in percent inside the box, clamped so a stray coordinate never leaves the card. */
export function plotPosition(lat: number, lng: number, box = MAP_BOX): { left: number; top: number } {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return { left: clamp(((lng - box.minLng) / (box.maxLng - box.minLng)) * 100), top: clamp((1 - (lat - box.minLat) / (box.maxLat - box.minLat)) * 100) };
}
export function driverStats(items: Array<{ status: string; city: string | null }> | null | undefined) {
  const list = items ?? [];
  const available = list.filter((d) => d.status === "available").length;
  const onJob = list.filter((d) => d.status === "on_job").length;
  return { total: list.length, available, onJob, cities: new Set(list.map((d) => d.city).filter(Boolean)).size };
}
export function filterDrivers<T extends { name: string; status: string; city: string | null }>(items: T[], f: { status?: string; city?: string; q?: string }): T[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return items.filter((d) => (!f.status || d.status === f.status) && (!f.city || d.city === f.city) && (!q || d.name.toLowerCase().includes(q)));
}

// ───────── Cancellations ─────────
export type Party = "business" | "driver" | "ops";
export const PARTIES: Party[] = ["business", "driver", "ops"];
export function partyCounts(items: Array<{ party: string }> | null | undefined): Record<Party, number> {
  const out: Record<Party, number> = { business: 0, driver: 0, ops: 0 };
  for (const i of items ?? []) if (i.party in out) out[i.party as Party] += 1;
  return out;
}
export const filterParty = <T extends { party: string }>(items: T[], party: string) => (party ? items.filter((i) => i.party === party) : items);

/**
 * When a request is cancelled (or called off for lack of drivers) the offers still open on it are withdrawn with it. The server lists those
 * withdrawn offers as "driver" events carrying the reason of the original decision, so they are attributed to whoever decided.
 */
const FOLLOW_ON: Record<string, Party> = { request_cancelled: "business", not_fully_staffed: "ops" };
export const isFollowOn = (i: { kind: string; reason?: string | null }) => i.kind === "cancelled" && !!i.reason && Object.prototype.hasOwnProperty.call(FOLLOW_ON, i.reason);
/** Who really decided: the follow-on rows go to the business / the platform, everything else keeps the server's party. */
export const cancellationParty = (i: { party: string; kind: string; reason?: string | null }): string => (isFollowOn(i) ? FOLLOW_ON[i.reason as string] : i.party);
/** The KPI figures of the cancellations page: requests cancelled, driver cancellations and no-shows, replacements by operations (follow-on rows are not events of their own). */
export function cancellationKpis(items: Array<{ party: string; kind: string; reason?: string | null }> | null | undefined) {
  const out = { requests: 0, drivers: 0, replaced: 0 };
  for (const i of items ?? []) {
    if (isFollowOn(i)) continue;
    if (i.kind === "request_cancelled") out.requests += 1;
    else if (i.kind === "replaced") out.replaced += 1;
    else if (i.party === "driver") out.drivers += 1;
  }
  return out;
}

// ───────── Reports ─────────
export const REPORT_TYPES = ["requests", "settlements", "cancellations", "sla", "complaints", "custody", "withdrawals", "drivers"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
/** The server refuses these report types without `finance.view`. */
export const REPORTS_NEEDING_FINANCE: readonly string[] = ["settlements", "withdrawals"];
export const reportTypesFor = (canFinance: boolean): ReportType[] => REPORT_TYPES.filter((x) => canFinance || !REPORTS_NEEDING_FINANCE.includes(x));
export const cleanReportType = (s: string | null | undefined, allowed: readonly string[]): string => (s && allowed.includes(s) ? s : allowed[0]);

/** A column is right-aligned when every filled value in it is a number (money, counts, minutes, ratings); dates and text stay start-aligned. */
export function reportColumnAlign(col: string, rows: Array<Record<string, unknown>>): "start" | "end" {
  const filled = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined && v !== "");
  return filled.length > 0 && filled.every((v) => typeof v === "number") ? "end" : "start";
}
/** A money column header says "(halalas)" in the dictionary, but the cells show SAR: drop a trailing parenthesised unit. */
export const stripUnit = (label: string) => label.replace(/\s*[(（][^)）]*[)）]\s*$/, "");
/** "1–100 of 340" style range of a page (rows on it, page size) for the "showing" line. */
export const pageRange = (page: number, pageSize: number, rowsOnPage: number) => ({ from: (page - 1) * pageSize + 1, to: (page - 1) * pageSize + rowsOnPage });

// ───────── Timeline ─────────
/** Dot colour of a job-timeline event: problems red, completions green, field movement cyan, everything else neutral. */
export function eventTone(type: string): "danger" | "accent" | "cyan" | "muted" {
  if (type === "dispute_resolved" || type === "custody_returned") return "accent";
  if (/cancel|no_show|fail|disput|reject|damaged|not_returned|expired|called_off|ended_early|replaced|withdrawn|unverified|exception/.test(type)) return "danger";
  if (/completed|delivered|confirmed|paid|returned|received/.test(type)) return "accent";
  if (/arriv|accept|assign|load|route|offers_dispatched|published|created|stop_|scanned/.test(type)) return "cyan";
  return "muted";
}
