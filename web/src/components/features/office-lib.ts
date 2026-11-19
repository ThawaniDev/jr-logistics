/**
 * Pure helpers of the courier-office portal (no React, no fetching): job / driver / settlement filters and counts, report periods,
 * agreement summary, document alerts and the dashboard's "needs attention" list. Unit-tested in tests/unit/office-lib.test.ts.
 */
import { isoToRiyadhLocal, riyadhLocalToIso } from "@/lib/format";

export interface Parcels { total: number; delivered: number; failed: number; returned: number; pending: number; loaded: number; missing: number }
export interface OfficeJob {
  offerId: string; requestId: string; ref: string; service: string; status: string; driver: string; driverId: string; business: string | null;
  startsAt: string; pickupCity: string; deliveryCity: string; expectedUnits: number; finalUnits: number | null; parcels: Parcels | null; lastActivityAt: string;
}
export interface OfficeDriver {
  id: string; name: string; phone: string; city: string | null; vehicleType: string | null; vehicleTemperature: string | null; verificationStatus: string;
  availability: string; onJob: boolean; jobsCompleted: number; rating: number | null; activeOfferId: string | null; parcels: Parcels | null;
}
export interface OfficeSettlement { id: string; requestId: string; ref: string; driverId: string; driver: string; finalUnits: number | null; amountCents: number; status: string; createdAt: string; paidAt: string | null }
export interface OfficeAgreement { id: string; version: number; status: string; terms: string | null; acceptedAt: string | null; expiresAt: string | null; effectiveAt: string | null; createdAt: string }

const DAY = 86_400_000;

// ───────── generic list helpers ─────────
/**
 * Case-insensitive "contains" over several fields. Phone numbers also match ignoring spaces and dashes, and a local number typed with its
 * leading zero (0500000015) finds the stored international form (+966500000015).
 */
export function matchesQuery(q: string, ...fields: Array<string | null | undefined>): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const digits = needle.replace(/\D/g, "").replace(/^0+/, "");
  return fields.some((f) => {
    if (!f) return false;
    const hay = f.toLowerCase();
    if (hay.includes(needle)) return true;
    return digits.length >= 3 && hay.replace(/\D/g, "").includes(digits);
  });
}
export function paginate<T>(items: T[], page: number, size: number): T[] { return items.slice((Math.max(page, 1) - 1) * size, Math.max(page, 1) * size); }
/** `?page=3` → 3; anything that is not a positive integer → 1. */
export const toPage = (v: string | null | undefined) => { const n = Number(v); return Number.isInteger(n) && n >= 1 ? n : 1; };
export const sumBy = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);

// ───────── jobs ─────────
/** Every status in which an office's job is still running or waiting for the driver (the server's busy set plus "offered"). */
export const ACTIVE_JOB = ["offered", "accepted", "arrived", "attendance_confirmed", "delivered_reported", "qty_disputed", "pending_settlement"];
export const NOT_COMPLETED_JOB = ["cancelled", "no_show", "replaced", "expired"];
/** A job can be handed to another driver only before the driver started working. */
export const REPLACEABLE_JOB = ["accepted", "arrived"];
/** The chat closes once the job is over. */
export const CLOSED_JOB = ["completed", "cancelled", "replaced", "no_show", "expired", "rejected"];
export type JobFilter = "active" | "attention" | "completed" | "closed" | "all";
export const JOB_FILTERS: JobFilter[] = ["active", "attention", "completed", "closed", "all"];
export const isJobFilter = (v: string): v is JobFilter => (JOB_FILTERS as string[]).includes(v);

/** Disputed quantity, or an active route with parcels that were not delivered / cannot be found. */
export function jobNeedsAttention(j: Pick<OfficeJob, "status" | "parcels">): boolean {
  if (!ACTIVE_JOB.includes(j.status)) return false;
  return j.status === "qty_disputed" || (j.parcels?.failed ?? 0) > 0 || (j.parcels?.missing ?? 0) > 0;
}
export function jobMatches(j: Pick<OfficeJob, "status" | "parcels">, f: JobFilter): boolean {
  switch (f) {
    case "active": return ACTIVE_JOB.includes(j.status);
    case "attention": return jobNeedsAttention(j);
    case "completed": return j.status === "completed";
    case "closed": return NOT_COMPLETED_JOB.includes(j.status);
    default: return true;
  }
}
export function jobCounts(jobs: Array<Pick<OfficeJob, "status" | "parcels">>): Record<JobFilter, number> {
  const out: Record<JobFilter, number> = { active: 0, attention: 0, completed: 0, closed: 0, all: jobs.length };
  for (const j of jobs) for (const f of JOB_FILTERS) if (f !== "all" && jobMatches(j, f)) out[f]++;
  return out;
}
/** Jobs still waiting for the driver to answer the offer. */
export const waitingJobs = (jobs: Array<Pick<OfficeJob, "status">>) => jobs.filter((j) => j.status === "offered").length;
/** Share of finished jobs that ended in a completed delivery; `null` when nothing finished yet. */
export function completionPct(completed: number, notCompleted: number): number | null { const n = completed + notCompleted; return n ? Math.round((completed / n) * 100) : null; }
/** Parcels with a final outcome (delivered, not delivered, or already back at the warehouse) out of all parcels, 0..100; `null` for count-based jobs that have no parcel rows. */
export function parcelPct(p: Parcels | null | undefined): number | null { return p && p.total > 0 ? Math.min(100, Math.round(((p.delivered + p.failed + p.returned) / p.total) * 100)) : null; }

// ───────── drivers ─────────
export type DriverState = "all" | "available" | "on_job" | "offline" | "unverified" | "invited";
export const DRIVER_STATES: DriverState[] = ["all", "available", "on_job", "offline", "unverified", "invited"];
export const isDriverState = (v: string): v is DriverState => (DRIVER_STATES as string[]).includes(v);
export const driverVerified = (d: Pick<OfficeDriver, "verificationStatus">) => d.verificationStatus === "verified";
/** Same definition as the dashboard counter: verified, online and not on a job. */
export const driverAvailable = (d: Pick<OfficeDriver, "verificationStatus" | "availability" | "onJob">) => driverVerified(d) && d.availability === "available" && !d.onJob;
export function driverMatches(d: Pick<OfficeDriver, "verificationStatus" | "availability" | "onJob">, s: DriverState): boolean {
  switch (s) {
    case "available": return driverAvailable(d);
    case "on_job": return d.onJob;
    case "offline": return driverVerified(d) && !d.onJob && d.availability !== "available";
    case "unverified": return !driverVerified(d);
    case "invited": return false; // invitations are a separate list
    default: return true;
  }
}
export function driverCounts(drivers: Array<Pick<OfficeDriver, "verificationStatus" | "availability" | "onJob">>, invites: number): Record<DriverState, number> {
  const out: Record<DriverState, number> = { all: drivers.length, available: 0, on_job: 0, offline: 0, unverified: 0, invited: invites };
  for (const d of drivers) for (const s of ["available", "on_job", "offline", "unverified"] as const) if (driverMatches(d, s)) out[s]++;
  return out;
}

// ───────── settlements ─────────
export const SETTLEMENT_STATUSES = ["pending_review", "reviewed", "approved", "paid", "failed", "rejected"] as const;
/** Money the office is still waiting for: not paid yet and not rejected. */
export const SETTLEMENT_OPEN = ["pending_review", "reviewed", "approved", "failed"];
export const isSettlementStatus = (v: string): boolean => (SETTLEMENT_STATUSES as readonly string[]).includes(v);
export function settlementCounts(rows: Array<Pick<OfficeSettlement, "status">>): Record<string, number> {
  const out: Record<string, number> = { all: rows.length };
  for (const s of SETTLEMENT_STATUSES) out[s] = 0;
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

// ───────── report periods ─────────
export type Period = "all" | "today" | "7d" | "30d" | "month" | "custom";
export const PERIODS: Period[] = ["all", "today", "7d", "30d", "month", "custom"];
export const isPeriod = (v: string): v is Period => (PERIODS as string[]).includes(v);
const isoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** Today's date in Riyadh (the portal's business day), as YYYY-MM-DD. */
export const riyadhToday = (now: Date) => isoToRiyadhLocal(now.toISOString()).slice(0, 10);
/** The from / to dates (Riyadh, inclusive, "" = open) of a period. Custom dates that are not real dates are ignored. */
export function periodRange(p: Period, now: Date, custom: { from?: string; to?: string } = {}): { from: string; to: string } {
  const today = riyadhToday(now);
  switch (p) {
    case "today": return { from: today, to: today };
    case "7d": return { from: addDays(today, -6), to: today };
    case "30d": return { from: addDays(today, -29), to: today };
    case "month": return { from: `${today.slice(0, 8)}01`, to: today };
    case "custom": return { from: custom.from && isoDate(custom.from) ? custom.from : "", to: custom.to && isoDate(custom.to) ? custom.to : "" };
    default: return { from: "", to: "" };
  }
}
export const periodInvalid = (r: { from: string; to: string }) => !!r.from && !!r.to && r.from > r.to;
/** Query string of `/office/reports` for a range ("" when open on both ends). */
export function periodQuery(r: { from: string; to: string }): string {
  return [r.from && `from=${encodeURIComponent(riyadhLocalToIso(`${r.from}T00:00`))}`, r.to && `to=${encodeURIComponent(riyadhLocalToIso(`${r.to}T23:59`))}`].filter(Boolean).join("&");
}

// ───────── agreement ─────────
export type AgreementState = "none" | "pending" | "active" | "expiring" | "expired";
export interface AgreementSummary { state: AgreementState; active: OfficeAgreement | null; pending: OfficeAgreement | null; daysLeft: number | null; history: OfficeAgreement[] }
export const AGREEMENT_WARN_DAYS = 30;
/**
 * What the office must know about its agreement. `active` is the accepted version that still counts (the server checks `expires_at > now`),
 * `pending` a newer version waiting for acceptance. State priority: pending (accepting it fixes an expired or expiring one) > expired > expiring > active;
 * "none" when no version is waiting or accepted.
 * `daysLeft` is whole days until the active version expires (`null` = it never expires).
 */
export function agreementSummary(items: OfficeAgreement[], now: Date): AgreementSummary {
  const sorted = [...items].sort((a, b) => b.version - a.version);
  const accepted = sorted.find((a) => a.status === "accepted") ?? null;
  const pending = sorted.find((a) => a.status === "pending_acceptance") ?? null;
  const daysLeft = accepted?.expiresAt ? Math.ceil((Date.parse(accepted.expiresAt) - now.getTime()) / DAY) : null;
  const expired = !!accepted && daysLeft !== null && Date.parse(accepted.expiresAt!) <= now.getTime();
  const active = accepted && !expired ? accepted : null;
  const state: AgreementState = !accepted && !pending ? "none" : pending ? "pending" : expired ? "expired" : daysLeft !== null && daysLeft <= AGREEMENT_WARN_DAYS ? "expiring" : "active";
  return { state, active, pending, daysLeft: expired ? 0 : daysLeft, history: sorted };
}

// ───────── documents ─────────
export interface DocRow { type: string; status: string; expiresOn: string | null; createdAt: string }
export const DOC_WARN_DAYS = 30;
/** Counts over the latest upload of each document type: expired, expiring within 30 days, rejected / needing more information. */
export function docAlerts(docs: DocRow[], now: Date): { expired: number; expiring: number; attention: number } {
  const today = Math.floor(Date.parse(`${riyadhToday(now)}T00:00:00Z`) / DAY);
  const latest = new Map<string, DocRow>();
  for (const d of [...docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) if (!latest.has(d.type)) latest.set(d.type, d);
  const out = { expired: 0, expiring: 0, attention: 0 };
  for (const d of latest.values()) {
    if (d.status === "rejected" || d.status === "info_requested") out.attention++;
    if (!d.expiresOn) continue;
    const left = Math.floor(Date.parse(`${d.expiresOn}T00:00:00Z`) / DAY) - today;
    if (left < 0) out.expired++; else if (left <= DOC_WARN_DAYS) out.expiring++;
  }
  return out;
}

// ───────── dashboard: what needs attention ─────────
export interface Attention { id: string; tone: "danger" | "warn" | "info"; key: string; vars?: Record<string, string | number>; href: string; cta: string }
export interface AttentionInput {
  readiness?: { verification: string; agreement: string; ready: boolean } | null;
  agreement?: AgreementSummary | null;
  docs?: { expired: number; expiring: number; attention: number } | null;
  drivers?: Array<Pick<OfficeDriver, "verificationStatus">> | null;
  invites?: number;
  opportunities?: { ready: number } | null;
  jobs?: Array<Pick<OfficeJob, "status" | "parcels">> | null;
  failedCents?: number;
}
const RANK = { danger: 0, warn: 1, info: 2 } as const;
/** The dashboard list, most urgent first. Empty means "all clear". */
export function attentionItems(i: AttentionInput): Attention[] {
  const out: Attention[] = [];
  if (i.readiness && i.readiness.verification !== "verified") out.push({ id: "verify", tone: "danger", key: "rdo.att_verify", href: "/office/documents", cta: "rdo.cta_documents" });
  const ag = i.agreement;
  if (ag?.state === "expired") out.push({ id: "agreement", tone: "danger", key: "rdo.att_agreement_expired", href: "/office/agreement", cta: "rdo.cta_agreement" });
  else if (ag?.state === "pending") out.push({ id: "agreement", tone: "warn", key: "rdo.att_agreement_pending", vars: { v: ag.pending?.version ?? 0 }, href: "/office/agreement", cta: "rdo.cta_accept" });
  else if (ag?.state === "expiring") out.push({ id: "agreement", tone: "warn", key: "rdo.att_agreement_expiring", vars: { n: ag.daysLeft ?? 0 }, href: "/office/agreement", cta: "rdo.cta_agreement" });
  else if (ag?.state === "none" && i.readiness?.verification === "verified") out.push({ id: "agreement", tone: "info", key: "rdo.att_agreement_none", href: "/office/agreement", cta: "rdo.cta_agreement" });
  if (i.docs?.expired) out.push({ id: "docs_expired", tone: "danger", key: "rdo.att_docs_expired", vars: { n: i.docs.expired }, href: "/office/documents", cta: "rdo.cta_documents" });
  if (i.docs?.attention) out.push({ id: "docs_attention", tone: "danger", key: "rdo.att_docs_attention", vars: { n: i.docs.attention }, href: "/office/documents", cta: "rdo.cta_documents" });
  if (i.docs?.expiring) out.push({ id: "docs_expiring", tone: "warn", key: "rdo.att_docs_expiring", vars: { n: i.docs.expiring }, href: "/office/documents", cta: "rdo.cta_documents" });
  if (i.failedCents && i.failedCents > 0) out.push({ id: "failed_pay", tone: "danger", key: "rdo.att_failed_payouts", href: "/office/settlements?status=failed", cta: "rdo.cta_settlements" });
  const disputed = (i.jobs ?? []).filter(jobNeedsAttention).length;
  if (disputed) out.push({ id: "jobs", tone: "warn", key: "rdo.att_jobs", vars: { n: disputed }, href: "/office/jobs?status=attention", cta: "rdo.cta_review" });
  const unverified = (i.drivers ?? []).filter((d) => d.verificationStatus !== "verified").length;
  if (unverified) out.push({ id: "drivers_unverified", tone: "warn", key: "rdo.att_drivers_unverified", vars: { n: unverified }, href: "/office/drivers?state=unverified", cta: "rdo.cta_review" });
  if (i.opportunities?.ready) out.push({ id: "opps", tone: "info", key: "rdo.att_opps", vars: { n: i.opportunities.ready }, href: "/office/opportunities?filter=ready", cta: "rdo.cta_assign" });
  if (i.invites) out.push({ id: "invites", tone: "info", key: "rdo.att_invites", vars: { n: i.invites }, href: "/office/drivers?state=invited", cta: "rdo.cta_review" });
  return out.sort((a, b) => RANK[a.tone] - RANK[b.tone]);
}

// ───────── opportunities ─────────
export interface OfficeOpp {
  id: string; ref: string; service: string; quantity: number; slotsFilled: number; vehicleType: string | null; temperature: string | null; pickupCity: string; deliveryCity: string;
  startsAt: string; durationDays: number | null; preferred: boolean; business: string | null; windowEndsAt: string | null; providerAmountCents: number | null;
  eligibleDrivers: Array<{ id: string; name: string; score?: number }>; ineligibleDrivers: Array<{ id: string; name: string; reasons: string[] }>;
}
export type OppFilter = "all" | "ready" | "none" | "preferred";
export const OPP_FILTERS: OppFilter[] = ["all", "ready", "none", "preferred"];
export const isOppFilter = (v: string): v is OppFilter => (OPP_FILTERS as string[]).includes(v);
export function oppMatches(o: Pick<OfficeOpp, "eligibleDrivers" | "preferred">, f: OppFilter): boolean {
  switch (f) {
    case "ready": return o.eligibleDrivers.length > 0;
    case "none": return o.eligibleDrivers.length === 0;
    case "preferred": return o.preferred;
    default: return true;
  }
}
export function oppCounts(opps: Array<Pick<OfficeOpp, "eligibleDrivers" | "preferred">>): Record<OppFilter, number> {
  return { all: opps.length, ready: opps.filter((o) => oppMatches(o, "ready")).length, none: opps.filter((o) => oppMatches(o, "none")).length, preferred: opps.filter((o) => o.preferred).length };
}
export const openSlots = (o: Pick<OfficeOpp, "quantity" | "slotsFilled">) => Math.max(0, o.quantity - o.slotsFilled);
