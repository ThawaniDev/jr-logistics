import { sql, type SQL } from "drizzle-orm";
import { can } from "../auth/permissions";
import { getSettings } from "../settings";
import { withDrivers, ACTIVE_ANY } from "./drivers-sql";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { defineTable, type DrillColumn } from "./registry";

type Row = Record<string, unknown>;
const MONEY = ["earnCents"];
/** Identity columns: the phone and the national id are masked unless the viewer has `drivers.sensitive`. */
const phoneSql = (sens: boolean): SQL => (sens ? sql`phone` : sql`case when phone is null then null else left(phone, 4) || '•••' || right(phone, 2) end`);
const nidSql = (sens: boolean): SQL => (sens ? sql`national_id` : sql`case when national_id is null then null else '••••' || right(national_id, 3) end`);

async function page(f: ResolvedFilters, money: boolean, cols: SQL, where: SQL, order: SQL, limit: number, offset: number) {
  const grace = (await getSettings()).lateGraceMin;
  const [list, [t]] = await Promise.all([
    rows<Row>(withDrivers(f, money, grace, sql`select ${cols} from dd where ${where} order by ${order} limit ${limit} offset ${offset}`)),
    rows<Row>(withDrivers(f, money, grace, sql`select count(*)::int as n from dd where ${where}`)),
  ]);
  return { rows: list, total: num(t?.n) };
}
const name: DrillColumn = { key: "name", label: "rpp.col_driver", type: "link", href: "/admin/drivers/{id}" };
const phone: DrillColumn = { key: "phone", label: "rpp.col_phone", type: "text", phone: false };
const office: DrillColumn = { key: "office", label: "rpp.col_office", type: "text", phone: false };
const vehicle: DrillColumn = { key: "vehicle", label: "rpp.col_vehicle", type: "enum", ns: "vehicle", phone: false };
const city: DrillColumn = { key: "city", label: "rpp.col_city", type: "enum", ns: "city", phone: false };
const pc = (key: string, label: string, phoneShow = true): DrillColumn => ({ key, label, type: "percent", align: "end", ...(phoneShow ? {} : { phone: false }) });
const nu = (key: string, label: string, phoneShow = true): DrillColumn => ({ key, label, type: "number", align: "end", ...(phoneShow ? {} : { phone: false }) });
const BASE_SORT = { name: sql`lower(name)`, vehicle: sql`vehicle`, city: sql`city`, office: sql`lower(office_name)`, phone: sql`phone` };
const FLAG_BASE_SORT = { name: BASE_SORT.name, office: BASE_SORT.office, phone: BASE_SORT.phone };
const COMMON = sql`id, name, vehicle, city, office_name as office, accept_c as acceptance, succ_c as success, ontime_rate_c as "onTime", cancel_c as "cancelRate"`;

/** Every driver with activity in the period: all the quality, volume, earnings and time metrics (sortable). */
defineTable({
  report: "drivers", name: "scorecards", title: "rpp.tbl_drv_cards",
  columns: [
    name, phone, vehicle, city, office, pc("acceptance", "rpp.col_acceptance"), { key: "responseP50", label: "rpp.col_response", type: "duration", align: "end", phone: false },
    nu("jobs", "rpp.col_jobs"), nu("delivered", "rpp.col_delivered", false), pc("success", "rpp.col_success"), pc("onTime", "rpp.col_ontime", false), pc("cancelRate", "rpp.col_cancel_rate", false),
    { key: "rating", label: "rpp.col_rating", type: "number", align: "end" }, { key: "earnCents", label: "rpp.col_earnings", type: "money", align: "end" },
    { key: "online", label: "rpp.col_online", type: "duration", align: "end", phone: false }, pc("utilisation", "rpp.col_util", false), nu("flags", "rpp.col_flags", false),
    { key: "nationalId", label: "rpp.col_national_id", type: "text", phone: false },
  ],
  moneyKeys: MONEY,
  sorts: { ...BASE_SORT, acceptance: sql`accept_c`, responseP50: sql`resp_p50`, jobs: sql`jobs_c`, delivered: sql`deliv_c`, success: sql`succ_c`, onTime: sql`ontime_rate_c`, cancelRate: sql`cancel_c`, rating: sql`rating_c`,
    earnCents: sql`earn_c`, online: sql`online_c`, utilisation: sql`util_c`, flags: sql`flags`, nationalId: sql`national_id` },
  defaultSort: { key: "jobs", dir: "desc" }, tiebreak: sql`id`,
  query: ({ filters: f, user, limit, offset, order }) => {
    const sens = can(user, "drivers.sensitive");
    return page(f, can(user, "finance.view"), sql`${COMMON}, ${phoneSql(sens)} as phone, ${nidSql(sens)} as "nationalId", resp_p50 as "responseP50", jobs_c as jobs, deliv_c as delivered, round(rating_c::numeric, 2)::float8 as rating,
      earn_c as "earnCents", online_c as online, util_c as utilisation, flags`, ACTIVE_ANY, order, limit, offset);
  },
});

/** Drivers who trip a reliability rule (with at least the minimum volume): the most serious reason and how many rules they trip. */
defineTable({
  report: "drivers", name: "unreliable", title: "rpp.tbl_drv_flags",
  columns: [
    name, phone, { key: "reason", label: "rpp.col_reason", type: "enum", ns: "rpp.flag" }, nu("flags", "rpp.col_flags"), pc("acceptance", "rpp.col_acceptance", false), pc("cancelRate", "rpp.col_cancel_rate"),
    pc("success", "rpp.col_success"), pc("onTime", "rpp.col_ontime", false), { key: "rating", label: "rpp.col_rating", type: "number", align: "end", phone: false }, nu("strikes", "rpp.col_strikes", false),
    { key: "suspendedUntil", label: "rpp.col_suspended_until", type: "date", phone: false }, office,
  ],
  sorts: { ...FLAG_BASE_SORT, reason: sql`reason`, flags: sql`flags`, acceptance: sql`accept_c`, cancelRate: sql`cancel_c`, success: sql`succ_c`, onTime: sql`ontime_rate_c`, rating: sql`rating_c`, strikes: sql`cancelled_c`, suspendedUntil: sql`suspended_until` },
  defaultSort: { key: "flags", dir: "desc" }, tiebreak: sql`id`,
  query: ({ filters: f, user, limit, offset, order }) => page(f, false, sql`${COMMON}, ${phoneSql(can(user, "drivers.sensitive"))} as phone, reason, flags, round(rating_c::numeric, 2)::float8 as rating, cancelled_c as strikes,
    case when suspended_now then suspended_until end as "suspendedUntil"`, sql`flags > 0 and (suspended_now or ${ACTIVE_ANY})`, order, limit, offset),
});

const LAST_JOB = sql`(select max(offers.accepted_at) from offers where offers.driver_id = dd.id)`;
/** Verified drivers with no job in the period: when they last worked, how long ago, and whether they are available. */
defineTable({
  report: "drivers", name: "inactive", title: "rpp.tbl_drv_inactive",
  columns: [
    name, phone, vehicle, city, office, { key: "lastJobAt", label: "rpp.col_last_job", type: "date" }, { key: "daysIdle", label: "rpp.col_days_idle", type: "number", align: "end" },
    nu("jobsTotal", "rpp.col_jobs_total", false), { key: "availability", label: "rpp.col_availability", type: "enum", ns: "rpp.avail", phone: false },
    { key: "lastSeenAt", label: "rpp.col_last_seen", type: "date", phone: false }, { key: "signupAt", label: "rpp.col_signup", type: "date", phone: false },
  ],
  sorts: { ...BASE_SORT, lastJobAt: LAST_JOB, daysIdle: sql`now() - coalesce(${LAST_JOB}, signup_at)`, jobsTotal: sql`jobs_completed`, availability: sql`availability`, lastSeenAt: sql`last_seen_at`, signupAt: sql`signup_at` },
  defaultSort: { key: "daysIdle", dir: "desc" }, tiebreak: sql`id`,
  query: ({ filters: f, user, limit, offset, order }) => page(f, false, sql`id, name, vehicle, city, office_name as office, ${phoneSql(can(user, "drivers.sensitive"))} as phone, ${LAST_JOB} as "lastJobAt",
    floor(extract(epoch from (now() - coalesce(${LAST_JOB}, signup_at))) / 86400)::int as "daysIdle", jobs_completed as "jobsTotal", availability, last_seen_at as "lastSeenAt", signup_at as "signupAt"`,
    sql`verification = 'verified' and user_status = 'active' and acc_c = 0`, order, limit, offset),
});
