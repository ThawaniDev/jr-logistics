import { sql, type SQL } from "drizzle-orm";
import { allOf, requestScope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { AT_RISK_SHARE, FIRST_RESPONSE_TARGET_SEC, HELD_STATES, RESOLUTION_TARGET_SEC } from "./support-sla";

/**
 * SQL building blocks shared by the support report, its series, groups and drill-down tables. Do NOT alias `tickets`, `complaints`, `requests`, `offers` (the shared
 * scope fragments name them). The SLA rules here mirror `slaState()` in `support-sla.ts`.
 */
const list = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

/** Tickets with their request (may be missing) and the person who opened them. */
export const TICKET_FROM = sql`from tickets left join requests on requests.id = tickets.request_id join users opener on opener.id = tickets.opened_by`;
/** First staff answer: the captured time, else the first public staff reply. Never an internal note. */
export const FRT = sql`coalesce(tickets.first_response_at, (select min(r.created_at) from ticket_replies r where r.ticket_id = tickets.id and not r.internal and r.author_role in ('staff','admin')))`;
/** A display name for any opener / requester (company name, office name, else the person). */
export const WHO_JOIN = sql`left join business_profiles bp on bp.user_id = opener.id left join office_profiles op on op.user_id = opener.id`;
export const WHO = sql`coalesce(bp.company_name, op.office_name, opener.name)`;

export const COMPLAINT_FROM = sql`from complaints left join requests on requests.id = complaints.request_id left join offers on offers.id = complaints.offer_id join users filer on filer.id = complaints.filed_by`;
/** Complaints: request-level filters need a linked request; company / driver / office match who filed OR who the complaint is about (the request's company, the offer's driver / office). */
export function complaintScope(f: ResolvedFilters): SQL {
  const c = requestScope(f, { company: false });
  if (f.company.length) c.push(sql`(complaints.filed_by in (${list(f.company)}) or requests.business_id in (${list(f.company)}))`);
  if (f.driver.length) c.push(sql`(complaints.filed_by in (${list(f.driver)}) or offers.driver_id in (${list(f.driver)}))`);
  if (f.office.length) c.push(sql`(complaints.filed_by in (${list(f.office)}) or offers.office_id in (${list(f.office)}))`);
  return allOf(...c);
}
/** Ratings, with the job and its request (so `scope(f, "offers")` applies), who was rated, and the company profile of a rated company. */
export const RATING_FROM = sql`from ratings join offers on offers.id = ratings.offer_id join requests on requests.id = offers.request_id join users ratee on ratee.id = ratings.ratee_id left join business_profiles rbp on rbp.user_id = ratee.id`;

const interval = (secs: number) => sql`make_interval(secs => ${secs}::int)`;
/** The SLA tests of the report for any source of the three timestamps (a CTE row `t.*`, or the `tickets` table with `FRT`). */
export function slaSql(c: { created: SQL; frt: SQL; resolved: SQL }) {
  const respLimit = sql`(${c.created} + ${interval(FIRST_RESPONSE_TARGET_SEC)})`, resLimit = sql`(${c.created} + ${interval(RESOLUTION_TARGET_SEC)})`;
  const respDue = sql`(${c.frt} is not null or ${respLimit} <= now())`;
  const respMet = sql`(${c.frt} is not null and ${c.frt} <= ${respLimit})`;
  const resDue = sql`(${c.resolved} is not null or ${resLimit} <= now())`;
  const resMet = sql`(${c.resolved} is not null and ${c.resolved} <= ${resLimit})`;
  const breached = sql`((${respDue} and not ${respMet}) or (${resDue} and not ${resMet}))`;
  const atRisk = sql`(not ${breached} and ((${c.frt} is null and ${c.created} + ${interval(Math.round(FIRST_RESPONSE_TARGET_SEC * AT_RISK_SHARE))} <= now()) or (${c.resolved} is null and ${c.created} + ${interval(Math.round(RESOLUTION_TARGET_SEC * AT_RISK_SHARE))} <= now())))`;
  return { respDue, respMet, resDue, resMet, breached, atRisk };
}

/** Seconds from `a` to `b` (0 when `b` is earlier); null when either is missing. Pass column names (constants), not user input. */
export const secsBetween = (a: string, b: string) => sql`(case when ${sql.raw(b)} >= ${sql.raw(a)} then extract(epoch from (${sql.raw(b)} - ${sql.raw(a)})) when ${sql.raw(b)} is not null and ${sql.raw(a)} is not null then 0 end)::float8`;
export const heldStates = sql.join(HELD_STATES.map((s) => sql`${s}`), sql`, `);
