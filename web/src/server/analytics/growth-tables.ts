import { sql, type SQL } from "drizzle-orm";
import { can } from "../auth/permissions";
import { inWindow } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { STALLED_SQL } from "./growth-facts";
import { num, rows } from "./guard";
import { PROFILES_SQL, ROLES, VERIFICATION_SQL } from "./growth-lib";
import { defineTable, type DrillColumn } from "./registry";

type Row = Record<string, unknown>;
const ROLE_LIST = sql.join(ROLES.map((r) => sql.raw(`'${r}'`)), sql`, `);
const NAME = sql`coalesce(bp.company_name, op.office_name, u.name)`;
const SEG = sql`case u.role when 'business' then 'companies' when 'driver' then 'drivers' else 'offices' end`;
const city = (f: ResolvedFilters): SQL => (f.city.length ? sql`and u.city in (${sql.join(f.city.map((c) => sql`${c}`), sql`, `)})` : sql``);
/** The phone is shown only to viewers with `drivers.sensitive`; everybody else sees the first 4 and last 2 digits. */
const phone = (sens: boolean): SQL => (sens ? sql`u.phone` : sql`case when u.phone is null then null else left(u.phone, 4) || '•••' || right(u.phone, 2) end`);
/** The columns every account row starts with (alias `u`, the three profiles left-joined). */
const WHO = (sens: boolean): SQL => sql`u.id, ${NAME} as name, u.role, ${SEG} as seg, ${phone(sens)} as phone, u.city, ${VERIFICATION_SQL} as verification`;

/** `select * from (select <cols> from <from> where <inner>) x [where <outer>] order … limit …` and its count. */
async function page(cols: SQL, from: SQL, inner: SQL, outer: SQL | null, order: SQL, limit: number, offset: number) {
  const base = sql`from (select ${cols} ${from} where ${inner}) x ${outer ? sql`where ${outer}` : sql``}`;
  const [list, [t]] = await Promise.all([rows<Row>(sql`select * ${base} order by ${order} limit ${limit} offset ${offset}`), rows<Row>(sql`select count(*)::int as n ${base}`)]);
  return { rows: list, total: num(t?.n) };
}
const who: DrillColumn[] = [
  { key: "name", label: "rpp.col_account", type: "link", href: "/admin/{seg}/{id}" }, { key: "role", label: "rpp.col_role", type: "enum", ns: "rpp.role" },
  { key: "phone", label: "rpp.col_phone", type: "text", phone: false }, { key: "city", label: "rpp.col_city", type: "enum", ns: "city", phone: false },
];
const ver: DrillColumn = { key: "verification", label: "rpp.col_verification", type: "enum", ns: "rpp.ver" };
const WHO_SORT = { name: sql`lower(name)`, role: sql`role`, phone: sql`phone`, city: sql`city`, verification: sql`verification` };
const inRoles = sql`u.role in (${ROLE_LIST})`;

/** Accounts created in the period (companies, drivers, offices) with their source, verification state and sign-in activity. */
defineTable({
  report: "growth", name: "signups", title: "rpp.tbl_gro_signups",
  columns: [...who, { key: "source", label: "rpp.col_source", type: "enum", ns: "rpp.src", phone: false }, ver, { key: "signupAt", label: "rpp.col_signup", type: "datetime" },
    { key: "lastLoginAt", label: "rpp.col_last_login", type: "datetime", phone: false }, { key: "logins", label: "rpp.col_logins", type: "number", align: "end", phone: false }],
  sorts: { ...WHO_SORT, source: sql`source`, signupAt: sql`"signupAt"`, lastLoginAt: sql`"lastLoginAt"`, logins: sql`logins` },
  defaultSort: { key: "signupAt", dir: "desc" }, tiebreak: sql`id`,
  query: ({ filters: f, user, limit, offset, order }) => page(
    sql`${WHO(can(user, "drivers.sensitive"))}, u.source, u.created_at as "signupAt", u.last_login_at as "lastLoginAt", u.login_count as logins`,
    sql`from users u ${PROFILES_SQL}`, sql`${inRoles} and ${inWindow("u.created_at", f.cur)} ${city(f)}`, null, order, limit, offset),
});

/** Accounts waiting for a staff decision: the oldest waiting document first. */
defineTable({
  report: "growth", name: "pending", title: "rpp.tbl_gro_pending",
  columns: [...who, ver, { key: "waiting", label: "rpp.col_waiting_docs", type: "number", align: "end" }, { key: "since", label: "rpp.col_waiting_since", type: "datetime" }, { key: "ageDays", label: "rpp.col_age_days", type: "number", align: "end" },
    { key: "signupAt", label: "rpp.col_signup", type: "date", phone: false }],
  sorts: { ...WHO_SORT, waiting: sql`waiting`, since: sql`since`, ageDays: sql`since`, signupAt: sql`"signupAt"` },
  defaultSort: { key: "since", dir: "asc" }, tiebreak: sql`id`,
  query: ({ filters: f, user, limit, offset, order }) => page(
    sql`${WHO(can(user, "drivers.sensitive"))}, w.n as waiting, w.since, floor(extract(epoch from (now() - w.since)) / 86400)::int as "ageDays", u.created_at as "signupAt"`,
    sql`from users u ${PROFILES_SQL} join (select owner_id, count(*)::int as n, min(created_at) as since from documents where status in ('submitted', 'under_review') group by owner_id) w on w.owner_id = u.id`,
    sql`${inRoles} and ${VERIFICATION_SQL} in ('pending', 'info_requested', 'expired') ${city(f)}`, null, order, limit, offset),
});

/** Accounts whose onboarding has stopped: what they are stuck on and for how long. */
defineTable({
  report: "growth", name: "stalled", title: "rpp.tbl_gro_stalled",
  columns: [...who, { key: "reason", label: "rpp.col_stall_reason", type: "enum", ns: "rpp.stall" }, ver, { key: "daysStuck", label: "rpp.col_days_stuck", type: "number", align: "end" }, { key: "signupAt", label: "rpp.col_signup", type: "date", phone: false }],
  sorts: { ...WHO_SORT, reason: sql`reason`, daysStuck: sql`"daysStuck"`, signupAt: sql`"signupAt"` },
  defaultSort: { key: "daysStuck", dir: "desc" }, tiebreak: sql`id`,
  query: ({ filters: f, user, limit, offset, order }) => page(
    sql`${WHO(can(user, "drivers.sensitive"))}, ${STALLED_SQL()} as reason, u.created_at as "signupAt",
      floor(extract(epoch from (now() - coalesce((select max(d.reviewed_at) from documents d where d.owner_id = u.id), u.created_at))) / 86400)::int as "daysStuck"`,
    sql`from users u ${PROFILES_SQL}`, sql`${inRoles} and u.status = 'active' ${city(f)}`, sql`reason is not null`, order, limit, offset),
});
