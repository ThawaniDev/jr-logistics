import { sql, type SQL } from "drizzle-orm";
import { complaints, ratings, tickets } from "@/db/schema";
import { inWindow, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { defineTable, type DrillColumn } from "./registry";
import { LOW_STARS } from "./support-sla";
import { complaintScope, COMPLAINT_FROM, FRT, RATING_FROM, secsBetween, slaSql, TICKET_FROM, WHO, WHO_JOIN } from "./support-sql";

type Row = Record<string, unknown>;
const REPORT = "support";
const sla = slaSql({ created: sql`tickets.created_at`, frt: FRT, resolved: sql`tickets.resolved_at` });
const frSecs = sql`extract(epoch from (${FRT} - tickets.created_at))`;
const rsSecs = sql`extract(epoch from (tickets.resolved_at - tickets.created_at))`;
const ageSecs = sql`case when tickets.status <> 'resolved' then extract(epoch from (now() - tickets.created_at)) end`;

const TICKET_COLUMNS: DrillColumn[] = [
  { key: "ref", label: "rpq.col_ticket", type: "link", href: "/admin/cases/{id}", sub: "subject" },
  { key: "category", label: "rpq.col_category", type: "enum", ns: "ticket_cat", phone: false },
  { key: "priority", label: "rpq.col_priority", type: "enum", ns: "rpq.pri" },
  { key: "status", label: "rpq.col_status", type: "status", ns: "status" },
  { key: "sla", label: "rpq.col_sla", type: "enum", ns: "rpq.sla" },
  { key: "who", label: "rpq.col_opened_by", type: "text", phone: false },
  { key: "roleName", label: "rpq.col_role", type: "enum", ns: "role", phone: false },
  { key: "assignee", label: "rpq.col_assignee", type: "text", phone: false },
  { key: "firstResponseSecs", label: "rpq.col_first_response", type: "duration", align: "end", phone: false },
  { key: "resolutionSecs", label: "rpq.col_resolution", type: "duration", align: "end", phone: false },
  { key: "ageSecs", label: "rpq.col_age", type: "duration", align: "end" },
  { key: "reopenCount", label: "rpq.col_reopened", type: "number", align: "end", phone: false },
  { key: "createdAt", label: "rpq.col_created", type: "datetime" },
];
const TICKET_SORTS: Record<string, SQL> = {
  ref: sql`tickets.ref`, category: sql`tickets.category`, priority: sql`tickets.priority`, status: sql`tickets.status`, who: sql`lower(${WHO})`, roleName: sql`opener.role`, assignee: sql`lower(asg.name)`,
  firstResponseSecs: frSecs, resolutionSecs: rsSecs, ageSecs, reopenCount: sql`tickets.reopen_count`, createdAt: sql`tickets.created_at`,
};
/** Several named views of the same ticket table (the page switches between them with a segmented control), each with its own extra condition. */
const ticketView = (name: string, title: string, extra: (f: ResolvedFilters) => SQL, defaultSort: { key: string; dir: "asc" | "desc" } = { key: "createdAt", dir: "desc" }) => defineTable({
  report: REPORT, name, title, columns: TICKET_COLUMNS, sorts: TICKET_SORTS, defaultSort, tiebreak: sql`tickets.id`,
  async query({ filters: f, limit, offset, order }) {
    const where = sql`${scope(f, "tickets")} and ${extra(f)}`;
    const [list, [t]] = await Promise.all([
      rows<Row>(sql`
        select tickets.id, tickets.ref, tickets.subject, tickets.category, tickets.priority, tickets.status, tickets.reopen_count as "reopenCount", tickets.created_at as "createdAt", ${WHO} as who, opener.role as "roleName", asg.name as assignee,
          ${frSecs}::float8 as "firstResponseSecs", ${rsSecs}::float8 as "resolutionSecs", ${ageSecs}::float8 as "ageSecs",
          case when ${sla.breached} then 'breached' when ${sla.atRisk} then 'at_risk' when tickets.resolved_at is not null then 'ok' else 'pending' end as sla
        ${TICKET_FROM} ${WHO_JOIN} left join users asg on asg.id = tickets.assigned_to where ${where} order by ${order} limit ${limit} offset ${offset}`),
      rows<Row>(sql`select count(*)::int as n ${TICKET_FROM} where ${where}`),
    ]);
    return { rows: list, total: num(t?.n) };
  },
});
const created = (f: ResolvedFilters) => inWindow(tickets.createdAt, f.cur);
ticketView("tickets", "rpq.tbl_tickets", created);
ticketView("tickets-open", "rpq.tbl_tickets_open", () => sql`tickets.status <> 'resolved'`, { key: "createdAt", dir: "asc" });
ticketView("tickets-breached", "rpq.tbl_tickets_breached", (f) => sql`${created(f)} and ${sla.breached}`);
ticketView("tickets-at-risk", "rpq.tbl_tickets_at_risk", () => sql`tickets.status <> 'resolved' and ${sla.atRisk}`, { key: "createdAt", dir: "asc" });
ticketView("tickets-urgent", "rpq.tbl_tickets_urgent", (f) => sql`${created(f)} and tickets.priority = 'urgent'`);
ticketView("tickets-reopened", "rpq.tbl_tickets_reopened", (f) => sql`${created(f)} and tickets.reopen_count > 0`);

const COMPLAINT_COLUMNS: DrillColumn[] = [
  { key: "ref", label: "rpq.col_complaint", type: "link", href: "/admin/complaints/{id}", sub: "snippet" },
  { key: "category", label: "rpq.col_category", type: "enum", ns: "complaint_cat", phone: false },
  { key: "priority", label: "rpq.col_priority", type: "enum", ns: "rpq.pri" },
  { key: "status", label: "rpq.col_status", type: "status", ns: "status" },
  { key: "holds", label: "rpq.col_holds", type: "enum", ns: "rpq.yn", phone: false },
  { key: "filedBy", label: "rpq.col_filed_by", type: "text", phone: false },
  { key: "roleName", label: "rpq.col_role", type: "enum", ns: "role", phone: false },
  { key: "handler", label: "rpq.col_handler", type: "text", phone: false },
  { key: "firstResponseSecs", label: "rpq.col_first_response", type: "duration", align: "end", phone: false },
  { key: "resolutionSecs", label: "rpq.col_resolution", type: "duration", align: "end", phone: false },
  { key: "createdAt", label: "rpq.col_created", type: "datetime" },
];
const COMPLAINT_SORTS: Record<string, SQL> = {
  ref: sql`complaints.ref`, category: sql`complaints.category`, priority: sql`complaints.priority`, status: sql`complaints.status`, holds: sql`complaints.holds_settlement`, filedBy: sql`lower(filer.name)`, roleName: sql`filer.role`, handler: sql`lower(h.name)`,
  firstResponseSecs: secsBetween("complaints.created_at", "complaints.first_response_at"), resolutionSecs: secsBetween("complaints.created_at", "complaints.resolved_at"), createdAt: sql`complaints.created_at`,
};
const complaintView = (name: string, title: string, extra: (f: ResolvedFilters) => SQL, defaultSort: { key: string; dir: "asc" | "desc" } = { key: "createdAt", dir: "desc" }) => defineTable({
  report: REPORT, name, title, columns: COMPLAINT_COLUMNS, sorts: COMPLAINT_SORTS, defaultSort, tiebreak: sql`complaints.id`,
  async query({ filters: f, limit, offset, order }) {
    const where = sql`${complaintScope(f)} and ${extra(f)}`;
    const [list, [t]] = await Promise.all([
      rows<Row>(sql`
        select complaints.id, complaints.ref, complaints.category, left(complaints.description, 120) as snippet, complaints.priority, complaints.status, case when complaints.holds_settlement then 'yes' else 'no' end as holds,
          filer.name as "filedBy", filer.role as "roleName", h.name as handler, ${secsBetween("complaints.created_at", "complaints.first_response_at")} as "firstResponseSecs",
          case when complaints.resolved_at is not null then ${secsBetween("complaints.created_at", "complaints.resolved_at")} end as "resolutionSecs", complaints.created_at as "createdAt"
        ${COMPLAINT_FROM} left join users h on h.id = complaints.handler_id where ${where} order by ${order} limit ${limit} offset ${offset}`),
      rows<Row>(sql`select count(*)::int as n ${COMPLAINT_FROM} where ${where}`),
    ]);
    return { rows: list, total: num(t?.n) };
  },
});
const filed = (f: ResolvedFilters) => inWindow(complaints.createdAt, f.cur);
complaintView("complaints", "rpq.tbl_complaints", filed);
complaintView("complaints-open", "rpq.tbl_complaints_open", () => sql`complaints.status in ('open', 'in_progress')`, { key: "createdAt", dir: "asc" });
complaintView("complaints-holding", "rpq.tbl_complaints_holding", () => sql`complaints.holds_settlement and complaints.status in ('open', 'in_progress')`, { key: "createdAt", dir: "asc" });

const RATING_COLUMNS: DrillColumn[] = [
  { key: "ref", label: "rpq.col_job", type: "link", href: "/admin/requests/{requestId}", sub: "rater" },
  { key: "stars", label: "rpq.col_stars", type: "number", align: "end" },
  { key: "ratee", label: "rpq.col_rated", type: "text" },
  { key: "rateeRole", label: "rpq.col_rated_role", type: "enum", ns: "role", phone: false },
  { key: "comment", label: "rpq.col_comment", type: "text" },
  { key: "createdAt", label: "rpq.col_created", type: "datetime" },
];
const RATING_SORTS: Record<string, SQL> = { ref: sql`requests.ref`, stars: sql`ratings.stars`, ratee: sql`lower(coalesce(rbp.company_name, ratee.name))`, rateeRole: sql`ratee.role`, createdAt: sql`ratings.created_at` };
const ratingView = (name: string, title: string, extra: SQL, defaultSort: { key: string; dir: "asc" | "desc" }) => defineTable({
  report: REPORT, name, title, columns: RATING_COLUMNS, sorts: RATING_SORTS, defaultSort, tiebreak: sql`ratings.id`,
  async query({ filters: f, limit, offset, order }) {
    const where = sql`${scope(f, "offers")} and ${inWindow(ratings.createdAt, f.cur)} and ${extra}`;
    const from = sql`${RATING_FROM} join users rater on rater.id = ratings.rater_id`;
    const [list, [t]] = await Promise.all([
      rows<Row>(sql`
        select ratings.id, requests.ref, requests.id as "requestId", ratings.stars, coalesce(rbp.company_name, ratee.name) as ratee, ratee.role as "rateeRole", rater.name as rater, ratings.comment, ratings.created_at as "createdAt"
        ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`),
      rows<Row>(sql`select count(*)::int as n ${from} where ${where}`),
    ]);
    return { rows: list, total: num(t?.n) };
  },
});
ratingView("low-ratings", "rpq.tbl_low_ratings", sql`ratings.stars <= ${LOW_STARS}`, { key: "createdAt", dir: "desc" });
ratingView("ratings", "rpq.tbl_ratings", sql`true`, { key: "createdAt", dir: "desc" });
