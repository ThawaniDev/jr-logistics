/**
 * Pure helpers of the admin support / quality / system pages (cases, complaints, ratings, audit, staff, integrations).
 * No React, no I/O — unit-tested in tests/unit/admin-system-lib.test.ts. Settings helpers live in admin-system-settings-lib.ts.
 */

export const DAY_MS = 86_400_000;
export const RIYADH_OFFSET_MS = 3 * 3_600_000; // Saudi time has no daylight saving

// ───────────────────────── Paging helpers ─────────────────────────

/** Loads every page of a list (newest first) until `total` rows are in hand or `cap` pages were read; `capped` says something is missing. */
export async function loadAllPages<T>(fetchPage: (page: number) => Promise<{ items: T[]; total: number }>, cap = 5): Promise<{ items: T[]; total: number; capped: boolean }> {
  const first = await fetchPage(1);
  const items = [...first.items];
  for (let p = 2; items.length < first.total && p <= cap; p++) {
    const r = await fetchPage(p);
    if (!r.items.length) break;
    items.push(...r.items);
  }
  return { items, total: first.total, capped: items.length < first.total };
}
export const paginate = <T,>(rows: T[], page: number, size: number): T[] => rows.slice((Math.max(page, 1) - 1) * size, Math.max(page, 1) * size);

// ───────────────────────── Support cases (tickets) ─────────────────────────

export interface CaseRow {
  id: string; ref: string; status: string; priority?: string | null; category: string; subject?: string | null; description?: string | null;
  assignedTo?: string | null; assignedToName?: string | null; handlerId?: string | null; openedBy?: string; openedByName?: string | null; openedByRole?: string | null;
  filedBy?: string; filedByName?: string | null; filedByRole?: string | null; holdsSettlement?: boolean | null; createdAt: string; updatedAt: string; resolvedAt?: string | null;
}
/** Who handles a case: tickets use `assignedTo`, complaints `handlerId`. */
export const handlerOf = (c: Pick<CaseRow, "assignedTo" | "handlerId">): string | null => c.assignedTo ?? c.handlerId ?? null;
export const isUrgent = (c: Pick<CaseRow, "priority">) => c.priority === "urgent";

/** `""` = anyone, `me`, `unassigned`, or a staff user id. */
export function matchAssignee(c: Pick<CaseRow, "assignedTo" | "handlerId">, assignee: string, meId: string): boolean {
  const h = handlerOf(c);
  if (!assignee) return true;
  if (assignee === "unassigned") return !h;
  if (assignee === "me") return h === meId;
  return h === assignee;
}
/** Same fields the API searches (reference, subject / description, person), case-insensitive. */
export function matchCaseQuery(c: CaseRow, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return [c.ref, c.subject, c.description, c.openedByName, c.filedByName].some((v) => (v ?? "").toLowerCase().includes(n));
}
/** Urgent first, then the most recently touched (the order the API uses for tickets). */
export const sortCases = <T extends CaseRow>(rows: T[]): T[] => [...rows].sort((a, b) => Number(isUrgent(b)) - Number(isUrgent(a)) || +new Date(b.updatedAt) - +new Date(a.updatedAt));

export interface Slice<T> { items: T[]; total: number; capped?: boolean }
export interface CaseStats { open: number; inReview: number; active: number; unassigned: number; urgent: number; resolvedWeek: number; capped: boolean }
/**
 * KPIs of the ticket queue from three status slices. Counts of a status use the API's `total` (exact); the figures that need a look inside
 * the rows (unassigned, urgent, resolved this week) use what was loaded, and `capped` flags that more rows exist than were read.
 */
export function caseStats(q: { open?: Slice<CaseRow>; in_review?: Slice<CaseRow>; resolved?: Slice<CaseRow> }, now = Date.now()): CaseStats {
  const open = q.open?.items ?? [], review = q.in_review?.items ?? [], done = q.resolved?.items ?? [];
  const week = now - 7 * DAY_MS;
  return {
    open: q.open?.total ?? 0, inReview: q.in_review?.total ?? 0, active: (q.open?.total ?? 0) + (q.in_review?.total ?? 0),
    unassigned: open.filter((c) => !handlerOf(c)).length, urgent: [...open, ...review].filter(isUrgent).length,
    resolvedWeek: done.filter((c) => new Date(c.resolvedAt ?? c.updatedAt).getTime() >= week).length,
    capped: !!(q.open?.capped || q.in_review?.capped),
  };
}

export interface ComplaintStats { open: number; inProgress: number; active: number; holding: number; urgent: number; unassigned: number; resolvedWeek: number; capped: boolean }
export function complaintStats(q: { open?: Slice<CaseRow>; in_progress?: Slice<CaseRow>; resolved?: Slice<CaseRow> }, now = Date.now()): ComplaintStats {
  const open = q.open?.items ?? [], work = q.in_progress?.items ?? [], done = q.resolved?.items ?? [];
  const live = [...open, ...work]; const week = now - 7 * DAY_MS;
  return {
    open: q.open?.total ?? 0, inProgress: q.in_progress?.total ?? 0, active: (q.open?.total ?? 0) + (q.in_progress?.total ?? 0),
    holding: live.filter((c) => !!c.holdsSettlement).length, urgent: live.filter(isUrgent).length, unassigned: open.filter((c) => !handlerOf(c)).length,
    resolvedWeek: done.filter((c) => new Date(c.resolvedAt ?? c.updatedAt).getTime() >= week).length, capped: !!(q.open?.capped || q.in_progress?.capped),
  };
}

/** The status filter values of the case lists; `active` = everything still being worked on. */
export const TICKET_ACTIVE = ["open", "in_review"] as const;
export const COMPLAINT_ACTIVE = ["open", "in_progress"] as const;
export const activeStatuses = (kind: "tickets" | "complaints") => (kind === "tickets" ? TICKET_ACTIVE : COMPLAINT_ACTIVE) as readonly string[];
/** Statuses to read from the API for a filter value: `active` → both live statuses, `all` / "" → none (no status filter), else the one status. */
export function statusesFor(kind: "tickets" | "complaints", status: string): string[] {
  if (status === "active") return [...activeStatuses(kind)];
  if (!status || status === "all") return [""];
  return [status];
}

/** Where a person's account lives in the console (`null` for roles without an account page). */
export function entityHref(role: string | null | undefined, id: string | null | undefined): string | null {
  if (!id) return null;
  if (role === "business") return `/admin/companies/${id}`;
  if (role === "office") return `/admin/offices/${id}`;
  if (role === "driver") return `/admin/drivers/${id}`;
  if (role === "staff" || role === "admin") return `/admin/users/${id}`; // the generic user page (identity, sign-ins, activity, notes)
  return null;
}
/** The permissions that let staff open that account page (same as the sidebar entries). */
export const ENTITY_PERMS: Record<string, string[]> = { business: ["users.view", "verification.manage", "offices.view"], office: ["offices.view", "offices.manage"], driver: ["drivers.view"], staff: ["users.view"], admin: ["users.view"] };

// ───────────────────────── Ratings ─────────────────────────

export interface RatingSummary { total: number; avg: number | null; dist: [number, number, number, number, number]; low: number; lowShare: number; fiveShare: number }
/** `atMost[n]` = number of ratings with `n` stars or fewer (what `GET /admin/ratings?maxStars=n` reports as `total`), n = 1…5. */
export function ratingSummary(atMost: Record<number, number>): RatingSummary {
  const c = [1, 2, 3, 4, 5].map((n) => Math.max(0, atMost[n] ?? 0));
  const dist = c.map((v, i) => Math.max(0, v - (i ? c[i - 1] : 0))) as RatingSummary["dist"];
  const total = c[4];
  const sum = dist.reduce((a, n, i) => a + n * (i + 1), 0);
  const low = dist[0] + dist[1];
  return { total, avg: total ? Math.round((sum / total) * 100) / 100 : null, dist, low, lowShare: total ? low / total : 0, fiveShare: total ? dist[4] / total : 0 };
}

// ───────────────────────── Audit log ─────────────────────────

/** Start (UTC instant, ISO) of the Riyadh calendar day that contains `now`. */
export function riyadhDayStart(now = Date.now()): string {
  const local = now + RIYADH_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - RIYADH_OFFSET_MS).toISOString();
}
export type AuditPeriod = "today" | "7d" | "30d" | "all";
/** Lower bound of the audit period filter (`undefined` = no bound). */
export function auditFrom(period: string, now = Date.now()): string | undefined {
  const start = new Date(riyadhDayStart(now)).getTime();
  if (period === "today") return new Date(start).toISOString();
  if (period === "7d") return new Date(start - 6 * DAY_MS).toISOString();
  if (period === "30d") return new Date(start - 29 * DAY_MS).toISOString();
  return undefined;
}
/** Entities the audit log knows (used for the entity filter); the API matches the value exactly. */
export const AUDIT_ENTITIES = ["user", "settings", "ticket", "complaint", "request", "offer", "settlement", "pricing_rule", "shipment", "business", "document", "report", "users", "driver_location", "office_agreement", "role"] as const;
export const distinctActors = (items: Array<{ actorId?: string | null }>): number => new Set(items.map((i) => i.actorId).filter(Boolean)).size;
const short = (v: unknown) => { const j = JSON.stringify(v); return j === undefined ? "—" : j.length > 80 ? `${j.slice(0, 77)}…` : j; };
/**
 * `settings.update` stores `{ key: { from, to } }`: those become before / after rows. Any other shape returns `null` (show the raw JSON).
 */
export function diffRows(diff: unknown): Array<{ key: string; from: string; to: string }> | null {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return null;
  const entries = Object.entries(diff as Record<string, unknown>);
  if (!entries.length || !entries.every(([, v]) => v && typeof v === "object" && !Array.isArray(v) && ("from" in (v as object) || "to" in (v as object)))) return null;
  return entries.map(([key, v]) => ({ key, from: short((v as { from?: unknown }).from), to: short((v as { to?: unknown }).to) }));
}
/** Splits `settings.update` into its area (`settings`) and verb (`update`) for display. */
export function actionParts(action: string): { area: string; verb: string } {
  const i = action.indexOf(".");
  return i < 0 ? { area: action, verb: "" } : { area: action.slice(0, i), verb: action.slice(i + 1) };
}

// ───────────────────────── Staff ─────────────────────────

export interface StaffRow { id: string; name: string; email: string | null; staffRole: string | null; permissions: string[]; status: string; lockedUntil?: string | null; totpEnabledAt?: string | null; mustChangePassword?: boolean }
export const isLocked = (s: Pick<StaffRow, "lockedUntil">, now = Date.now()) => !!s.lockedUntil && new Date(s.lockedUntil).getTime() > now;
export interface StaffStats { total: number; active: number; suspended: number; locked: number; mfa: number; noMfa: number }
export function staffStats(rows: StaffRow[], now = Date.now()): StaffStats {
  const mfa = rows.filter((s) => !!s.totpEnabledAt).length;
  return { total: rows.length, active: rows.filter((s) => s.status === "active").length, suspended: rows.filter((s) => s.status !== "active").length, locked: rows.filter((s) => isLocked(s, now)).length, mfa, noMfa: rows.length - mfa };
}
/** Which area of the console a permission belongs to (the permission picker groups by it). Unknown permissions fall into `other`. */
export const PERM_AREAS: Record<string, readonly string[]> = {
  people: ["users.", "accounts.", "drivers.", "offices.", "verification.", "documents."],
  orders: ["requests.", "attendance.", "replacements.", "live_location.", "custody."],
  support: ["tickets.", "complaints.", "notes."],
  finance: ["finance.", "wallets.", "wallet.", "settlements.", "payouts.", "withdrawals.", "cod.", "pricing.", "refunds."],
  insights: ["reports."],
  admin: ["staff.", "settings.", "audit.", "broadcast."],
};
export const permArea = (p: string): string => Object.entries(PERM_AREAS).find(([, prefixes]) => prefixes.some((x) => p.startsWith(x)))?.[0] ?? "other";
/** Permissions grouped by area, areas in a fixed order, permissions in the order given. Empty areas are left out. */
export function groupPermissions(perms: readonly string[]): Array<{ area: string; perms: string[] }> {
  const order = [...Object.keys(PERM_AREAS), "other"];
  return order.map((area) => ({ area, perms: perms.filter((p) => permArea(p) === area) })).filter((g) => g.perms.length > 0);
}
/** True when the two permission lists hold the same permissions (order does not matter). */
export const samePerms = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((p) => b.includes(p));
export type StaffFilter = "all" | "active" | "suspended" | "locked" | "no_mfa";
export function filterStaff(rows: StaffRow[], filter: string, q: string, now = Date.now()): StaffRow[] {
  const n = q.trim().toLowerCase();
  return rows.filter((s) => {
    if (filter === "active" && s.status !== "active") return false;
    if (filter === "suspended" && s.status === "active") return false;
    if (filter === "locked" && !isLocked(s, now)) return false;
    if (filter === "no_mfa" && s.totpEnabledAt) return false;
    return !n || `${s.name} ${s.email ?? ""}`.toLowerCase().includes(n);
  });
}

// ───────────────────────── Integrations (warehouse-system connections) ─────────────────────────

export interface Conn {
  id: string; business: string; businessId: string; provider: string; providerLabel: string; name: string; status: "active" | "disabled";
  lastCheckedAt: string | null; lastOkAt: string | null; lastError: string | null; lastEventAt: string | null; createdAt: string; stuckUpdates: number;
}
export type Health = "attention" | "paused" | "new" | "ok";
/** A connection needs attention when it is switched on and either its last check failed or JR updates to the warehouse system are stuck. */
export const healthOf = (c: Pick<Conn, "status" | "lastError" | "stuckUpdates" | "lastOkAt" | "lastEventAt">): Health =>
  c.status !== "active" ? "paused" : c.lastError || c.stuckUpdates > 0 ? "attention" : !c.lastOkAt && !c.lastEventAt ? "new" : "ok";
/** The API filter of a connections view: `all` | `problems` | `active` | `disabled`. */
export function connectionFilter(view: string): { status?: "active" | "disabled"; problemsOnly?: "1" } {
  if (view === "problems") return { status: "active", problemsOnly: "1" };
  if (view === "active") return { status: "active" };
  if (view === "disabled") return { status: "disabled" };
  return {};
}

// ───────────────────────── Notifications ─────────────────────────

export type NotifFamily = "support" | "money" | "documents" | "alert" | "work" | "other";
/** Which kind of event a notification type is (drives the icon and colour in every portal's notification list). */
export function notifFamily(type: string): NotifFamily {
  if (/^(ticket|complaint)_/.test(type)) return "support";
  if (/^(payout|withdrawal|cod)_|^wallet_|^iban_/.test(type)) return "money";
  if (/^(document|verification)_|^agreement_/.test(type)) return "documents";
  if (/(cancel|no_show|failed|disputed|dispute_|suspend|rejected|expired|no_replacement|route_ended|called_off|conflict)/.test(type)) return "alert";
  if (/^(offer|request|driver|office|delivery|loading|shipment|shipments|route|returns?|partner|invite|custody|chat|attendance|job|replaced|parcels)_?/.test(type)) return "work";
  return "other";
}
