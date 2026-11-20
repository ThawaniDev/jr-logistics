/**
 * Pure rules of the company / user / ticket / complaint detail views (decisions G6–G8). No I/O and no React, so the server modules and the UI share ONE
 * definition of every number the owner asked to see "with its formula" (SLA targets, the health score, the alerts) and the unit tests can pin them.
 */
import { addDays, addMonths, riyadhDay, startOfMonth, type Ymd } from "./analytics/time";
import { presetRange, previousRange, windowOf, type Bucket, type Range, type Window } from "./analytics/periods";

// ───────── SLA ─────────
/** Support targets, defined once: a first public response within 4 h of opening, resolution within 48 h. Tickets and complaints use the same clocks. */
export const SLA = { firstResponseSec: 4 * 3600, resolutionSec: 48 * 3600, atRiskShare: 0.25 } as const;

export type SlaState = "met" | "met_late" | "on_track" | "at_risk" | "breached";
export interface SlaClock { targetSec: number; elapsedSec: number; remainingSec: number | null; state: SlaState; doneAt: string | null }
export interface SlaPair { firstResponse: SlaClock; resolution: SlaClock }

const ms = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).getTime());

/** One clock. Running: elapsed = now − start; done: elapsed = done − start and the state says whether the target was met. `at_risk` = the last quarter of the target is left. */
export function slaClock(start: Date | string, done: Date | string | null | undefined, now: Date | number, targetSec: number): SlaClock {
  const s = ms(start) ?? 0, d = ms(done), n = typeof now === "number" ? now : now.getTime();
  const elapsedSec = Math.max(0, Math.round(((d ?? n) - s) / 1000));
  if (d != null) return { targetSec, elapsedSec, remainingSec: null, state: elapsedSec <= targetSec ? "met" : "met_late", doneAt: new Date(d).toISOString() };
  const remainingSec = targetSec - elapsedSec;
  return { targetSec, elapsedSec, remainingSec, state: remainingSec < 0 ? "breached" : remainingSec <= targetSec * SLA.atRiskShare ? "at_risk" : "on_track", doneAt: null };
}
/**
 * Both clocks of a ticket or complaint. The first-response clock stops at `firstResponseAt`; the resolution clock stops at `resolvedAt` (a reopened ticket has no
 * `resolvedAt`, so its clock runs again from the original opening time — the customer has been waiting since then).
 */
export function slaFor(row: { createdAt: Date | string; firstResponseAt?: Date | string | null; resolvedAt?: Date | string | null }, now: Date | number = Date.now()): SlaPair {
  return {
    firstResponse: slaClock(row.createdAt, row.firstResponseAt, now, SLA.firstResponseSec),
    resolution: slaClock(row.createdAt, row.resolvedAt, now, SLA.resolutionSec),
  };
}
/** The clock that matters most right now (worst state first), for badges in lists. */
export function worstSla(p: SlaPair): SlaState {
  const rank: Record<SlaState, number> = { breached: 4, at_risk: 3, on_track: 2, met_late: 1, met: 0 };
  return rank[p.firstResponse.state] >= rank[p.resolution.state] ? p.firstResponse.state : p.resolution.state;
}

// ───────── Periods ─────────
export const COMPANY_PERIODS = ["30d", "90d", "12m", "all"] as const;
export type CompanyPeriod = (typeof COMPANY_PERIODS)[number];
export const isCompanyPeriod = (v: unknown): v is CompanyPeriod => (COMPANY_PERIODS as readonly unknown[]).includes(v);
/** The most months an "all time" chart draws. */
export const MAX_ALL_MONTHS = 60;

export interface PeriodWindows { key: CompanyPeriod; cur: Window; prev: Window | null; bucket: Bucket }
/**
 * The windows behind the period selector, in Riyadh calendar days (the same convention as every report): `30d` / `90d` end today and are compared with the same
 * number of days right before; `12m` = the last 12 calendar months up to today (compared with the same dates a year earlier); `all` starts the day the account was
 * created (at most 60 months back) and has no comparison. Buckets: days for 30 d, weeks up to 120 days, months beyond.
 */
export function resolvePeriod(key: CompanyPeriod, today: Ymd, accountCreated: Date | string): PeriodWindows {
  let r: Range;
  if (key === "30d") r = { from: addDays(today, -29), to: today };
  else if (key === "90d") r = { from: addDays(today, -89), to: today };
  else if (key === "12m") r = presetRange("12m", today);
  else { const born = riyadhDay(new Date(accountCreated)), floor = startOfMonth(addMonths(today, -(MAX_ALL_MONTHS - 1))); r = { from: born > floor ? born : floor, to: today }; if (r.from > r.to) r = { from: today, to: today }; }
  const cur = windowOf(r.from, r.to);
  const before = (n: number): Range => ({ from: addDays(r.from, -n), to: addDays(r.from, -1) });
  const pr = key === "all" ? null : key === "12m" ? previousRange(r, "12m") : before(cur.days);
  const prev = pr ? windowOf(pr.from, pr.to) : null;
  const bucket: Bucket = cur.days <= 31 ? "day" : cur.days <= 120 ? "week" : "month";
  return { key, cur, prev, bucket };
}

// ───────── Company health ─────────
/** Weights of the five health components (they add up to 100; a component without data is left out and the rest re-weighted). */
export const HEALTH_WEIGHTS = { recency: 30, frequency: 20, success: 25, cancellations: 15, support: 10 } as const;
export type HealthKey = keyof typeof HEALTH_WEIGHTS;
/** Days without an order after which the recency score is 0, and the days up to which it is 100. */
export const HEALTH_RECENCY = { fullUntilDays: 7, zeroAtDays: 90 } as const;
/** Orders per 30 days that earn the full frequency score. */
export const HEALTH_FULL_ORDERS_PER_30D = 8;
/** A cancellation rate at which the cancellation score reaches 0. */
export const HEALTH_CANCEL_ZERO_AT = 0.3;
export const HEALTH_BANDS = { healthy: 75, watch: 50 } as const;

export interface HealthInputs {
  /** Whole days since the newest non-draft order; null = never ordered. */
  daysSinceLastOrder: number | null;
  /** Non-draft orders created in the last 90 days. */
  orders90: number;
  /** delivered ÷ (delivered + failed + returned) over the last 90 days; null = no parcel outcomes. */
  successRate: number | null;
  /** Cancelled ÷ non-draft orders created in the last 90 days; null = no orders. */
  cancellationRate: number | null;
  /** Tickets and complaints that are still open now (null = the viewer may not see support data, so the component is left out). */
  openSupport: number | null;
  /** Complaints filed in the last 90 days. */
  complaints90: number | null;
}
export interface HealthPart { key: HealthKey; weight: number; score: number | null }
export interface Health { score: number | null; band: "healthy" | "watch" | "risk" | null; parts: HealthPart[] }

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
/** Score of each component, 0–100, or null when there is nothing to judge (never a made-up 0). */
export function healthParts(i: HealthInputs): HealthPart[] {
  const d = i.daysSinceLastOrder;
  const recency = d == null ? null : clamp(100 * (1 - (d - HEALTH_RECENCY.fullUntilDays) / (HEALTH_RECENCY.zeroAtDays - HEALTH_RECENCY.fullUntilDays)));
  const frequency = d == null ? null : clamp(((i.orders90 / 3) / HEALTH_FULL_ORDERS_PER_30D) * 100);
  const success = i.successRate == null ? null : clamp(i.successRate * 100);
  const cancellations = i.cancellationRate == null ? null : clamp(100 * (1 - i.cancellationRate / HEALTH_CANCEL_ZERO_AT));
  const support = i.openSupport == null ? null : clamp(100 - 25 * i.openSupport - 10 * (i.complaints90 ?? 0));
  const raw: Record<HealthKey, number | null> = { recency, frequency, success, cancellations, support };
  return (Object.keys(HEALTH_WEIGHTS) as HealthKey[]).map((key) => ({ key, weight: HEALTH_WEIGHTS[key], score: raw[key] == null ? null : Math.round(raw[key]!) }));
}
/**
 * Weighted mean of the components that have data. Without at least one NON-support component (a company that never ordered) there is no score: "not enough data",
 * not a flattering 100 earned by having had no tickets.
 */
export function healthScore(i: HealthInputs): Health {
  const parts = healthParts(i);
  const judged = parts.filter((p) => p.score != null);
  if (!judged.some((p) => p.key !== "support")) return { score: null, band: null, parts };
  const w = judged.reduce((a, p) => a + p.weight, 0);
  const score = Math.round(judged.reduce((a, p) => a + p.weight * (p.score as number), 0) / w);
  return { score, band: score >= HEALTH_BANDS.healthy ? "healthy" : score >= HEALTH_BANDS.watch ? "watch" : "risk", parts };
}

// ───────── Company alerts ─────────
export type AlertKey = "no_orders" | "never_ordered" | "wallet_low" | "failure_up" | "cancel_up" | "credit_high" | "integration_errors" | "sla_breached";
export interface CompanyAlert { key: AlertKey; tone: "danger" | "warn"; params: Record<string, string | number> }
export const ALERT_RULES = { noOrdersDays: 45, neverOrderedAfterDays: 14, failureRisePp: 0.05, failureMinOutcomes: 10, cancelRisePp: 0.1, cancelMinOrders: 5, creditHigh: 0.8 } as const;

export interface AlertInputs {
  accountAgeDays: number; verified: boolean;
  daysSinceLastOrder: number | null;
  /** available + credit limit, in halalas (null = viewer may not see money). */
  spendableCents: number | null; nextOrder: { ref: string; totalCents: number } | null; avgOrderCents: number | null;
  failureRate: { cur: number | null; prev: number | null; outcomes: number };
  cancellationRate: { cur: number | null; prev: number | null; orders: number };
  creditUse: number | null;
  integrationErrors: number; slaBreached: number;
}
/** Every rule is a plain comparison on numbers the stats already return; an alert is never raised from missing data. */
export function companyAlerts(i: AlertInputs): CompanyAlert[] {
  const out: CompanyAlert[] = [], R = ALERT_RULES;
  if (i.daysSinceLastOrder == null) { if (i.verified && i.accountAgeDays >= R.neverOrderedAfterDays) out.push({ key: "never_ordered", tone: "warn", params: { days: i.accountAgeDays } }); }
  else if (i.daysSinceLastOrder >= R.noOrdersDays) out.push({ key: "no_orders", tone: "warn", params: { days: i.daysSinceLastOrder } });
  if (i.spendableCents != null) {
    if (i.nextOrder && i.spendableCents < i.nextOrder.totalCents) out.push({ key: "wallet_low", tone: "danger", params: { ref: i.nextOrder.ref, need: i.nextOrder.totalCents, have: i.spendableCents } });
    else if (!i.nextOrder && i.avgOrderCents != null && i.avgOrderCents > 0 && i.spendableCents < i.avgOrderCents) out.push({ key: "wallet_low", tone: "warn", params: { ref: "", need: Math.round(i.avgOrderCents), have: i.spendableCents } });
  }
  const f = i.failureRate;
  if (f.cur != null && f.prev != null && f.outcomes >= R.failureMinOutcomes && f.cur - f.prev >= R.failureRisePp) out.push({ key: "failure_up", tone: "danger", params: { cur: Math.round(f.cur * 100), prev: Math.round(f.prev * 100) } });
  const c = i.cancellationRate;
  if (c.cur != null && c.prev != null && c.orders >= R.cancelMinOrders && c.cur - c.prev >= R.cancelRisePp) out.push({ key: "cancel_up", tone: "warn", params: { cur: Math.round(c.cur * 100), prev: Math.round(c.prev * 100) } });
  if (i.creditUse != null && i.creditUse >= R.creditHigh) out.push({ key: "credit_high", tone: "warn", params: { pct: Math.round(i.creditUse * 100) } });
  if (i.integrationErrors > 0) out.push({ key: "integration_errors", tone: "warn", params: { n: i.integrationErrors } });
  if (i.slaBreached > 0) out.push({ key: "sla_breached", tone: "danger", params: { n: i.slaBreached } });
  return out;
}

// ───────── Handling history (ticket / complaint) ─────────
export interface AuditRow { id: string; at: string | Date; action: string; actorId: string | null; actorName: string | null; diff: unknown }
export type HistoryKind = "status" | "priority" | "assign" | "resolve" | "reopen" | "resolution" | "hold";
export interface HistoryItem { id: string; at: string; kind: HistoryKind; from: string | null; to: string | null; actor: { id: string | null; name: string | null }; note?: string | null }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
/**
 * What the audit rows of ONE ticket / complaint say happened to its handling: status, priority and assignment changes (with who and from → to), resolution and
 * reopen events, settlement-hold switches. `assignName` turns a user id into a name (ids not found stay ids and the UI shows "—"). Unknown actions are skipped.
 */
export function handlingHistory(entity: "ticket" | "complaint", rows: AuditRow[], assignName: (id: string | null) => string | null = () => null): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const r of rows) {
    const at = new Date(r.at).toISOString(), actor = { id: r.actorId, name: r.actorName }, d = obj(r.diff);
    const push = (kind: HistoryKind, from: string | null, to: string | null, note?: string | null, n = 0) => out.push({ id: `${r.id}:${n}`, at, kind, from, to, actor, note });
    if (r.action === `${entity}.resolve`) { push("resolve", null, "resolved"); continue; }
    if (r.action === `${entity}.reopen`) { push("reopen", "resolved", "open"); continue; }
    if (r.action !== `${entity}.update`) continue;
    const from = obj(d.from), patch = entity === "ticket" ? obj(d.patch) : d;
    let n = 0;
    if (str(patch.status)) push("status", str(from.status), str(patch.status), str(patch.resolution), n++);
    if (str(patch.priority)) push("priority", str(from.priority), str(patch.priority), null, n++);
    const toId = patch.assignToMe === true ? r.actorId : str(patch.assignTo) ?? str(patch.assignedTo);
    const unassigned = patch.assignTo === null && "assignTo" in patch;
    if (patch.assignToMe === true || str(patch.assignTo) || unassigned) push("assign", assignName(str(from.assignedTo)), toId ? assignName(toId) ?? toId : null, null, n++);
    if (entity === "complaint" && str(patch.resolution) && !str(patch.status)) push("resolution", null, null, str(patch.resolution), n++);
    if (entity === "complaint" && typeof patch.holdsSettlement === "boolean") push("hold", null, patch.holdsSettlement ? "on" : "off", null, n++);
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
}

// ───────── Canned replies ─────────
/** Every ticket category of every role (a category may belong to several roles; the list is the union). */
export const CANNED_CATEGORIES = [
  "driver_no_show", "shipment_count", "location_issue", "payment_issue", "cod_issue", "replacement_request", "urgent", "app_problem", "other",
  "business_not_ready", "not_put_to_work", "shipment_count_differs", "attendance_issue", "driver_assignment", "settlement_issue", "agreement", "documents",
] as const;
export const CANNED_GENERIC = ["ack", "need_info", "thanks"] as const;
/** i18n keys of the templates offered for a category: its own one first, then the three general ones. Unknown categories get only the general ones. */
export function cannedKeys(category: string): string[] {
  const own = (CANNED_CATEGORIES as readonly string[]).includes(category) ? [`dv3.canned_${category}`] : [];
  return [...own, ...CANNED_GENERIC.map((g) => `dv3.canned_g_${g}`)];
}
/** First name for a greeting: the first word of the name, or an empty string (the templates read well without it). */
export const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

// ───────── Small helpers ─────────
/** Whole percent, or null when the denominator is 0 (no data is not 0%). */
export const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null);
/** `203.0.113.45` → `203.0.113.•••`, an IPv6 address keeps its first two groups. Used for viewers without `drivers.sensitive`. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 2).join(":")}:•••`;
  const p = ip.split(".");
  return p.length === 4 ? `${p.slice(0, 3).join(".")}.•••` : "•••";
}
/** The device in plain words from a user-agent string ("Chrome on macOS"); personal strings stay out of the screen. */
export function deviceOf(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /okhttp|Dart|Flutter/i.test(ua) ? "App" : null;
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  return [browser, os].filter(Boolean).join(" · ") || null;
}
