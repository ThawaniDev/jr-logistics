import { sql, type SQL } from "drizzle-orm";
import { BUSINESS_DOC_TYPES, DRIVER_DOC_TYPES, OFFICE_DOC_TYPES } from "../catalog";
import type { Insight } from "./insights";
import { pct1, type Pair } from "./companies-lib";

/** Pure pieces of the growth & onboarding report: required documents per role, backlog age buckets, stalled-onboarding rules, the funnel shape and the insights. */
export const ROLES = ["business", "driver", "office"] as const;
export type GrowthRole = (typeof ROLES)[number];
export const REQUIRED_DOCS: Record<GrowthRole, string[]> = {
  business: BUSINESS_DOC_TYPES.filter((d) => d.required).map((d) => d.key),
  driver: DRIVER_DOC_TYPES.filter((d) => d.required).map((d) => d.key),
  office: OFFICE_DOC_TYPES.filter((d) => d.required).map((d) => d.key),
};
/** Age (days) edges of the backlog buckets: under 1 day, 1–3, 3–7, 7–14, 14 or more (`width_bucket` indexes 0..4). */
export const BACKLOG_EDGES = [1, 3, 7, 14];
/** Stalled-onboarding rules (days): the account has been waiting this long on the user or on the first step after approval. */
export const STALLED = { blockedDays: 3, activationDays: 7 } as const;
export const STALLED_REASONS = ["no_documents", "docs_rejected", "info_requested", "not_ordered", "no_job"] as const;
export type StalledReason = (typeof STALLED_REASONS)[number];
export const GEO_LIMIT = 12;

const lit = (xs: string[]) => sql.join(xs.map((x) => sql.raw(`'${x}'`)), sql`, `);
/** `true` when the user (alias `u`) has submitted every required document of their role (SQL). */
export const docsSubmittedSql = (u = "u"): SQL => sql`(case ${sql.raw(`${u}.role`)} ${sql.join(ROLES.map((r) => sql`when ${sql.raw(`'${r}'`)} then (select count(distinct d.type) from documents d where d.owner_id = ${sql.raw(`${u}.id`)} and d.type in (${lit(REQUIRED_DOCS[r])})) >= ${sql.raw(String(REQUIRED_DOCS[r].length))}`), sql` `)} else false end)`;
/** The verification state of an account of any role (SQL, over `bp`, `op`, `dp` left-joined profiles). */
export const VERIFICATION_SQL = sql`coalesce(bp.verification_status, op.verification_status, dp.verification_status, 'pending')`;
/** Joins the three profile tables to `users u`. */
export const PROFILES_SQL = sql`left join business_profiles bp on bp.user_id = u.id left join office_profiles op on op.user_id = u.id left join driver_profiles dp on dp.user_id = u.id`;

export interface FunnelRow { role: GrowthRole; registered: number; docs: number; verified: number; rejected: number; info: number; pending: number }
/** The funnel of one role: registered → documents submitted → verified, each step clamped to the one before, plus the branches an account can be in (rejected, info requested, pending review). */
export function funnelOf(r: FunnelRow) {
  const raw = [r.registered, r.docs, r.verified];
  const steps = (["registered", "docs", "verified"] as const).map((key, i) => ({ key, count: Math.min(raw[i], ...raw.slice(0, i)) }));
  return { role: r.role, steps, branches: { rejected: r.rejected, info: r.info, pending: r.pending } };
}
/** Counts per age bucket from `(bucket index, n)` pairs; always one entry per bucket. */
export const backlogBuckets = (raw: Array<{ b: number; n: number }>) =>
  Array.from({ length: BACKLOG_EDGES.length + 1 }, (_, i) => ({ from: i === 0 ? null : BACKLOG_EDGES[i - 1], to: BACKLOG_EDGES[i] ?? null, count: raw.filter((x) => x.b === i).reduce((s, x) => s + x.n, 0) }));
/** Active accounts in the 24 hours, 7 days and 30 days before a moment; `null` when that section could not be computed. */
export interface ActiveCounts { roles: Record<GrowthRole, { dau: number | null; wau: number | null; mau: number | null }>; dau: number | null; wau: number | null; mau: number | null }
/** DAU ÷ MAU, null without a base. */
export const stickiness = (dau: number | null, mau: number | null): number | null => (dau == null || !mau ? null : dau / mau);

export interface GrowthInsightInput {
  signups: Pair; verifyRate: number | null; ttvP90: number | null; docReject: number | null; backlog: number; oldest: number; stalled: number; companyActivation: number | null; driverActivation: number | null;
  stickiness: number | null; loginFail: number | null; topSource: { key: string; share: number } | null; signupsCount: number; topCity: { key: string; share: number } | null;
}
/** Plain-language observations about the growth report (keys `rpp.ins_gro_*`). */
export function growthInsights(i: GrowthInsightInput): Insight[] {
  const out: Insight[] = [];
  if (i.signupsCount < 5) out.push({ key: "rpp.ins_gro_sparse", tone: "info", vars: { n: i.signupsCount } });
  if (i.backlog > 0) out.push({ key: i.oldest >= 7 ? "rpp.ins_gro_backlog_old" : "rpp.ins_gro_backlog", tone: i.oldest >= 7 ? "bad" : "info", vars: { n: i.backlog, d: Math.floor(i.oldest) }, href: "/admin/verification" });
  if (i.stalled > 0) out.push({ key: "rpp.ins_gro_stalled", tone: "bad", vars: { n: i.stalled } });
  if (i.verifyRate != null && i.signupsCount >= 5 && i.verifyRate < 0.5) out.push({ key: "rpp.ins_gro_verify_low", tone: "bad", vars: { n: pct1(i.verifyRate) } });
  if (i.ttvP90 != null && i.ttvP90 > 3 * 86400) out.push({ key: "rpp.ins_gro_ttv_slow", tone: "bad", vars: { d: Math.round((i.ttvP90 / 86400) * 10) / 10 } });
  if (i.docReject != null && i.docReject >= 0.3) out.push({ key: "rpp.ins_gro_reject_high", tone: "bad", vars: { n: pct1(i.docReject) } });
  if (i.companyActivation != null && i.companyActivation < 0.4 && i.signupsCount >= 5) out.push({ key: "rpp.ins_gro_company_low", tone: "bad", vars: { n: pct1(i.companyActivation) } });
  if (i.driverActivation != null && i.driverActivation < 0.5) out.push({ key: "rpp.ins_gro_driver_low", tone: "bad", vars: { n: pct1(i.driverActivation) } });
  if (i.stickiness != null && i.stickiness < 0.15) out.push({ key: "rpp.ins_gro_sticky_low", tone: "info", vars: { n: pct1(i.stickiness) } });
  if (i.loginFail != null && i.loginFail >= 0.2) out.push({ key: "rpp.ins_gro_login_fail", tone: "bad", vars: { n: pct1(i.loginFail) } });
  if (i.topSource && i.topSource.share >= 0.8 && i.signupsCount >= 5) out.push({ key: "rpp.ins_gro_source", tone: "info", refs: { source: `rpp.src.${i.topSource.key}` }, vars: { n: pct1(i.topSource.share) } });
  if (i.topCity && i.topCity.share >= 0.6 && i.signupsCount >= 5) out.push({ key: "rpp.ins_gro_city", tone: "info", refs: { city: `city.${i.topCity.key}` }, vars: { n: pct1(i.topCity.share) } });
  return out.slice(0, 8);
}
