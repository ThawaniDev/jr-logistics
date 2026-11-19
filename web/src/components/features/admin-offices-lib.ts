import type { Tone } from "@/components/ui";

/** Pure view logic of the admin offices / drivers / users pages (kept free of React so it can be unit-tested). */

export const OFFICE_STATES = ["all", "verified", "review", "rejected", "suspended"] as const;
export type OfficeState = (typeof OFFICE_STATES)[number];
export const DRIVER_STATES = ["all", "available", "pending", "suspended"] as const;
export type DriverState = (typeof DRIVER_STATES)[number];
export const JOB_SCOPES = ["all", "active", "completed", "issues"] as const;
export type JobScope = (typeof JOB_SCOPES)[number];
export const USER_ROLES = ["all", "business", "driver", "office", "staff", "admin"] as const;
export type UserRoleFilter = (typeof USER_ROLES)[number];

const pick = <T extends readonly string[]>(list: T, v: string | null | undefined, fallback: T[number]): T[number] => (v && (list as readonly string[]).includes(v) ? v : fallback);
/** URL / query values are untrusted: anything that is not a known filter falls back to the default. */
export const parseOfficeState = (v: string | null | undefined) => pick(OFFICE_STATES, v, "all");
export const parseDriverState = (v: string | null | undefined) => pick(DRIVER_STATES, v, "all");
export const parseJobScope = (v: string | null | undefined) => pick(JOB_SCOPES, v, "all");
export const parseUserRole = (v: string | null | undefined) => pick(USER_ROLES, v, "all");
export const parseAgreementFilter = (v: string | null | undefined): "" | "pending" | "none" => (v === "pending" || v === "none" ? v : "");
export const parseDriverLink = (v: string | null | undefined): "" | "office" | "direct" => (v === "office" || v === "direct" ? v : "");

/** Query value for the API: the "all" filter is simply left out. */
export const apiFilter = (v: string) => (v === "all" ? "" : v);

export type VerifyAction = "verify" | "request_info" | "reject" | "suspend";
/**
 * The verification decisions staff can still take on an account (`POST /admin/users/:id/verification`).
 * Same rule as before the redesign: "verify" is pointless when already verified, "suspend" when already suspended; the others
 * stay available so a new note can be recorded.
 */
export function verificationActions(status: string | null | undefined): VerifyAction[] {
  const all: VerifyAction[] = ["verify", "request_info", "reject", "suspend"];
  return all.filter((a) => !(a === "verify" && status === "verified") && !(a === "suspend" && status === "suspended"));
}
/** Every decision except "verify" needs a note for the account holder (the API rejects an empty one). */
export const needsNote = (a: VerifyAction) => a !== "verify";

export type AgreementKey = "none" | "pending" | "accepted" | "expired" | "superseded";
export interface AgreementView { key: AgreementKey; tone: Tone; label: string }
/** Badge for the latest agreement of an office. An accepted agreement past its expiry date no longer counts. */
export function agreementView(status: string | null | undefined, expiresAt?: string | Date | null, now = Date.now()): AgreementView {
  if (!status) return { key: "none", tone: "neutral", label: "rdq.agr_none" };
  if (status === "pending_acceptance") return { key: "pending", tone: "warn", label: "adm.agr_pending" };
  if (status === "accepted") return expiresAt && new Date(expiresAt).getTime() <= now ? { key: "expired", tone: "danger", label: "status.expired" } : { key: "accepted", tone: "success", label: "adm.agr_accepted" };
  return { key: "superseded", tone: "neutral", label: "adm.agr_superseded" };
}

/** Why an office cannot receive jobs yet (`readiness.issues` of `GET /admin/offices/:id`) → message key. */
export const ISSUE_KEY: Record<string, string> = {
  not_verified: "rdq.issue_not_verified", suspended: "rdq.issue_suspended", agreement_pending: "rdq.issue_agreement_pending",
  no_agreement: "rdq.issue_no_agreement", agreement_expired: "rdq.issue_agreement_expired",
};
export const issueKey = (i: string) => ISSUE_KEY[i] ?? "rdq.issue_other";

/** A driver is "suspended" by the strike policy (until a date) or because the account itself is suspended. */
export function driverSuspension(d: { suspendedUntil?: string | Date | null; status?: string | null }, now = Date.now()): { active: boolean; until: Date | null; account: boolean } {
  const until = d.suspendedUntil ? new Date(d.suspendedUntil) : null;
  const timed = !!until && until.getTime() > now;
  return { active: timed || d.status === "suspended", until: timed ? until : null, account: d.status === "suspended" };
}

export interface StrikeInput { policyEnabled: boolean; warnAt: number; suspendAt: number; windowDays: number; resetAt?: string | Date | null; recent: Array<{ at: string | Date; ref?: string; requestId?: string; reason?: string | null }> }
/** Which cancellations still count toward the strike policy (inside the window and after the last reset) and how close the driver is to the limits. */
export function strikeView(s: StrikeInput, now = Date.now()) {
  const from = now - s.windowDays * 864e5;
  const reset = s.resetAt ? new Date(s.resetAt).getTime() : 0;
  const rows = s.recent.map((e) => { const at = new Date(e.at).getTime(); return { ...e, counted: at > from && at > reset }; });
  const count = rows.filter((r) => r.counted).length;
  const level: "ok" | "warn" | "suspend" = !s.policyEnabled ? "ok" : count >= s.suspendAt ? "suspend" : count >= s.warnAt ? "warn" : "ok";
  return { count, level, rows, max: s.suspendAt };
}

/** Document rows for an owner: the newest file of each type, plus the required types that have no file at all. */
export function documentRows<T extends { type: string; createdAt: string | Date }>(docs: T[], required: Array<{ key: string; required: boolean }>) {
  const newest = new Map<string, T>();
  for (const d of [...docs].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))) if (!newest.has(d.type)) newest.set(d.type, d);
  const have = required.map((r) => ({ key: r.key, required: r.required, doc: newest.get(r.key) ?? null }));
  const extra = [...newest.entries()].filter(([k]) => !required.some((r) => r.key === k)).map(([k, doc]) => ({ key: k, required: false, doc }));
  return [...have, ...extra];
}

/** Rating label "★ 4.5" or an em dash. */
export const ratingText = (r: number | null | undefined) => (r ? `★ ${r}` : "—");

/** The table footer (pager) is only worth showing when the list spans more than one page. */
export const needsPager = (total: number, size: number) => total > size;

/** Whole days from now until a date (negative once it has passed); `null` without a date. A date-only value (`2026-12-01`) is read as the start of that day. */
export function daysUntil(d: string | Date | null | undefined, now = Date.now()): number | null {
  if (!d) return null;
  const t = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`).getTime() : new Date(d).getTime();
  return Math.floor((t - now) / 864e5);
}
/** True when the date is already behind us. */
export const isPast = (d: string | Date | null | undefined, now = Date.now()) => !!d && new Date(d).getTime() <= now;
