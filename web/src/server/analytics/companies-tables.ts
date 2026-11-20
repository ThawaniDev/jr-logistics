import { sql, type SQL } from "drizzle-orm";
import { can } from "../auth/permissions";
import { HEALTH, RISK } from "./companies-lib";
import { withCompanies } from "./companies-sql";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { defineTable, type DrillColumn } from "./registry";

type Row = Record<string, unknown>;
const raw = (n: number) => sql.raw(String(n));
const MONEY = ["gmvCents", "aovCents"];

/** Runs `select <cols> from d where <where> order by … limit …` and the matching count over the per-company table. */
async function page(f: ResolvedFilters, money: boolean, cols: SQL, where: SQL, order: SQL, limit: number, offset: number) {
  const [list, [t]] = await Promise.all([
    rows<Row>(withCompanies(f, money, sql`select ${cols} from d where ${where} order by ${order} limit ${limit} offset ${offset}`)),
    rows<Row>(withCompanies(f, money, sql`select count(*)::int as n from d where ${where}`)),
  ]);
  return { rows: list, total: num(t?.n) };
}
const name: DrillColumn = { key: "name", label: "rpp.col_company", type: "link", href: "/admin/companies/{id}" };
const city: DrillColumn = { key: "city", label: "rpp.col_city", type: "enum", ns: "city", phone: false };
const ver: DrillColumn = { key: "verification", label: "rpp.col_verification", type: "enum", ns: "rpp.ver", phone: false };
const SORT_BASE = { name: sql`lower(name)`, city: sql`city`, verification: sql`verification`, signupAt: sql`signup_at` };

/** Every company that placed a request in the period, with all the metrics (sortable). */
defineTable({
  report: "companies", name: "leaderboard", title: "rpp.tbl_cmp_leaders",
  columns: [
    name, city,
    { key: "requests", label: "rpp.col_requests", type: "number", align: "end" }, { key: "parcels", label: "rpp.col_parcels", type: "number", align: "end" },
    { key: "delivered", label: "rpp.col_delivered", type: "number", align: "end", phone: false }, { key: "success", label: "rpp.col_success", type: "percent", align: "end" },
    { key: "cancelRate", label: "rpp.col_cancel_rate", type: "percent", align: "end", phone: false },
    { key: "gmvCents", label: "rpp.col_gmv", type: "money", align: "end" }, { key: "aovCents", label: "rpp.col_aov", type: "money", align: "end", phone: false },
    { key: "codShare", label: "rpp.col_cod_share", type: "percent", align: "end", phone: false }, { key: "apiShare", label: "rpp.col_api_share", type: "percent", align: "end", phone: false },
    { key: "health", label: "rpp.col_health", type: "number", align: "end" }, { key: "lastOrderAt", label: "rpp.col_last_order", type: "date" },
    ver, { key: "signupAt", label: "rpp.col_signup", type: "date", phone: false },
  ],
  moneyKeys: MONEY,
  sorts: { ...SORT_BASE, lastOrderAt: sql`last_c`, requests: sql`req_c`, parcels: sql`reg_c`, delivered: sql`deliv_c`, success: sql`succ_c`, cancelRate: sql`canc_c::float8 / nullif(req_c, 0)`, gmvCents: sql`gmv_c`, aovCents: sql`gmv_c / nullif(ord_c, 0)`,
    codShare: sql`cod_c::float8 / nullif(reg_c, 0)`, apiShare: sql`api_c::float8 / nullif(req_c, 0)`, health: sql`health_c` },
  defaultSort: { key: "requests", dir: "desc" }, tiebreak: sql`id`,
  query: ({ filters: f, user, limit, offset, order }) => page(f, can(user, "finance.view"), sql`
    id, name, city, verification, req_c as requests, reg_c as parcels, deliv_c as delivered, succ_c as success, canc_c::float8 / nullif(req_c, 0) as "cancelRate",
    gmv_c as "gmvCents", gmv_c / nullif(ord_c, 0) as "aovCents", cod_c::float8 / nullif(reg_c, 0) as "codShare", api_c::float8 / nullif(req_c, 0) as "apiShare",
    health_c as health, last_c as "lastOrderAt", signup_at as "signupAt"`, sql`req_c > 0`, order, limit, offset),
});

/** Companies that stopped ordering: silent for 14–59 days after at least 2 requests (at risk), or 60+ days (churned). */
defineTable({
  report: "companies", name: "at-risk", title: "rpp.tbl_cmp_risk",
  columns: [
    name, city, { key: "state", label: "rpp.col_state", type: "enum", ns: "rpp.risk" }, { key: "lastOrderAt", label: "rpp.col_last_order", type: "date" },
    { key: "silentDays", label: "rpp.col_silent_days", type: "number", align: "end" }, { key: "gapDays", label: "rpp.col_gap_days", type: "number", align: "end", phone: false },
    { key: "orders", label: "rpp.col_orders_total", type: "number", align: "end" }, ver, { key: "signupAt", label: "rpp.col_signup", type: "date", phone: false },
  ],
  sorts: { ...SORT_BASE, lastOrderAt: sql`last_c`, state: sql`silent_c`, silentDays: sql`silent_c`, gapDays: sql`gap_days`, orders: sql`orders_to_c` },
  defaultSort: { key: "orders", dir: "desc" }, tiebreak: sql`id`,
  query: ({ filters: f, limit, offset, order }) => page(f, false, sql`
    id, name, city, verification, last_c as "lastOrderAt", signup_at as "signupAt", round(silent_c::numeric, 0)::int as "silentDays", round(gap_days::numeric, 1)::float8 as "gapDays", orders_to_c as orders,
    case when silent_c >= ${raw(HEALTH.silentDays)} then 'churned' else 'at_risk' end as state`,
    sql`silent_c >= ${raw(RISK.atRiskFrom)} and (silent_c >= ${raw(HEALTH.silentDays)} or orders_to_c >= ${raw(RISK.minOrders)})`, order, limit, offset),
});

/** Companies whose first request fell in the period, and how long after signing up they placed it. */
defineTable({
  report: "companies", name: "new", title: "rpp.tbl_cmp_new",
  columns: [
    name, city, { key: "source", label: "rpp.col_source", type: "enum", ns: "rpp.src", phone: false }, { key: "signupAt", label: "rpp.col_signup", type: "date", phone: false },
    { key: "firstOrderAt", label: "rpp.col_first_order", type: "datetime" }, { key: "toFirst", label: "rpp.col_to_first", type: "duration", align: "end" },
    { key: "requests", label: "rpp.col_requests", type: "number", align: "end" }, { key: "parcels", label: "rpp.col_parcels", type: "number", align: "end", phone: false },
    { key: "gmvCents", label: "rpp.col_gmv", type: "money", align: "end" }, ver,
  ],
  moneyKeys: MONEY,
  sorts: { ...SORT_BASE, firstOrderAt: sql`first_at`, source: sql`source`, toFirst: sql`first_at - signup_at`, requests: sql`req_c`, parcels: sql`reg_c`, gmvCents: sql`gmv_c` },
  defaultSort: { key: "firstOrderAt", dir: "desc" }, tiebreak: sql`id`,
  query: ({ filters: f, user, limit, offset, order }) => page(f, can(user, "finance.view"), sql`
    id, name, city, source, verification, signup_at as "signupAt", first_at as "firstOrderAt", greatest(0, extract(epoch from (first_at - signup_at)))::float8 as "toFirst",
    req_c as requests, reg_c as parcels, gmv_c as "gmvCents"`, sql`req_c > 0 and before_c = 0`, order, limit, offset),
});
