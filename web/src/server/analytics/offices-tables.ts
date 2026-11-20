import { sql, type SQL } from "drizzle-orm";
import { can } from "../auth/permissions";
import { getSettings } from "../settings";
import { withDrivers } from "./drivers-sql";
import { num, rows } from "./guard";
import { withOffices } from "./offices-sql";
import { defineTable, type DrillColumn } from "./registry";

type Row = Record<string, unknown>;
const MONEY = ["earnedCents", "paidCents", "pendingCents"];
const nu = (key: string, label: string, phone = true): DrillColumn => ({ key, label, type: "number", align: "end", ...(phone ? {} : { phone: false }) });
const pc = (key: string, label: string, phone = true): DrillColumn => ({ key, label, type: "percent", align: "end", ...(phone ? {} : { phone: false }) });
const cash = (key: string, label: string, phone = true): DrillColumn => ({ key, label, type: "money", align: "end", ...(phone ? {} : { phone: false }) });

/** Every courier office with its fleet, work, quality, earnings and turnover in the period (sortable). */
defineTable({
  report: "offices", name: "scorecards", title: "rpp.tbl_off_cards",
  columns: [
    { key: "name", label: "rpp.col_office", type: "link", href: "/admin/offices/{id}" }, { key: "city", label: "rpp.col_city", type: "enum", ns: "city", phone: false },
    { key: "agreement", label: "rpp.col_agreement", type: "enum", ns: "rpp.agr", phone: false }, nu("fleet", "rpp.col_fleet"), nu("activeDrivers", "rpp.col_active_drivers"), pc("utilisation", "rpp.col_util", false),
    nu("jobs", "rpp.col_jobs"), nu("delivered", "rpp.col_delivered"), pc("success", "rpp.col_success"), pc("onTime", "rpp.col_ontime", false), { key: "rating", label: "rpp.col_rating", type: "number", align: "end", phone: false },
    cash("earnedCents", "rpp.col_earned"), cash("paidCents", "rpp.col_paid", false), cash("pendingCents", "rpp.col_pending", false), nu("links", "rpp.col_links", false), nu("unlinks", "rpp.col_unlinks", false),
    { key: "verification", label: "rpp.col_verification", type: "enum", ns: "rpp.ver", phone: false },
  ],
  moneyKeys: MONEY,
  sorts: { name: sql`lower(name)`, city: sql`city`, agreement: sql`agreement_state`, fleet: sql`fleet`, activeDrivers: sql`drv_c`, utilisation: sql`util_c`, jobs: sql`jobs_c`, delivered: sql`deliv_c`, success: sql`succ_c`, onTime: sql`ontime_rate_c`,
    rating: sql`rating_c`, earnedCents: sql`earned_c`, paidCents: sql`paid_c`, pendingCents: sql`pending`, links: sql`links_c`, unlinks: sql`unlinks_c`, verification: sql`verification` },
  defaultSort: { key: "delivered", dir: "desc" }, tiebreak: sql`id`,
  async query({ filters: f, user, limit, offset, order }) {
    const money = can(user, "finance.view"), grace = (await getSettings()).lateGraceMin;
    const [list, [t]] = await Promise.all([
      rows<Row>(withOffices(f, money, grace, sql`select id, name, city, agreement_state as agreement, verification, fleet, drv_c as "activeDrivers", util_c as utilisation, jobs_c as jobs, deliv_c as delivered, succ_c as success,
        ontime_rate_c as "onTime", round(rating_c::numeric, 2)::float8 as rating, earned_c as "earnedCents", paid_c as "paidCents", pending as "pendingCents", links_c as links, unlinks_c as unlinks
        from od order by ${order} limit ${limit} offset ${offset}`)),
      rows<Row>(withOffices(f, money, grace, sql`select count(*)::int as n from od`)),
    ]);
    return { rows: list, total: num(t?.n) };
  },
});

/** The drivers of courier offices: who they work for, what they delivered, how they performed and earned in the period (an office filter narrows to its drivers). */
defineTable({
  report: "offices", name: "drivers", title: "rpp.tbl_off_drivers",
  columns: [
    { key: "name", label: "rpp.col_driver", type: "link", href: "/admin/drivers/{id}" }, { key: "office", label: "rpp.col_office", type: "link", href: "/admin/offices/{officeId}", phone: false },
    { key: "vehicle", label: "rpp.col_vehicle", type: "enum", ns: "vehicle", phone: false }, { key: "availability", label: "rpp.col_availability", type: "enum", ns: "rpp.avail", phone: false },
    nu("jobs", "rpp.col_jobs"), nu("delivered", "rpp.col_delivered"), pc("success", "rpp.col_success"), pc("onTime", "rpp.col_ontime", false), { key: "rating", label: "rpp.col_rating", type: "number", align: "end", phone: false },
    cash("earnCents", "rpp.col_earned"), { key: "online", label: "rpp.col_online", type: "duration", align: "end", phone: false },
  ],
  moneyKeys: ["earnCents"],
  sorts: { name: sql`lower(name)`, office: sql`lower(office_name)`, vehicle: sql`vehicle`, availability: sql`availability`, jobs: sql`jobs_c`, delivered: sql`deliv_c`, success: sql`succ_c`, onTime: sql`ontime_rate_c`, rating: sql`rating_c`, earnCents: sql`earn_c`, online: sql`online_c` },
  defaultSort: { key: "delivered", dir: "desc" }, tiebreak: sql`id`,
  async query({ filters: f, user, limit, offset, order }) {
    const money = can(user, "finance.view"), grace = (await getSettings()).lateGraceMin;
    const where: SQL = sql`(office_id is not null or acc_c > 0)`;
    const [list, [t]] = await Promise.all([
      rows<Row>(withDrivers(f, money, grace, sql`select id, name, office_name as office, office_id as "officeId", vehicle, availability, jobs_c as jobs, deliv_c as delivered, succ_c as success, ontime_rate_c as "onTime",
        round(rating_c::numeric, 2)::float8 as rating, earn_c as "earnCents", online_c as online from dd where ${where} order by ${order} limit ${limit} offset ${offset}`, { officeOnly: true })),
      rows<Row>(withDrivers(f, money, grace, sql`select count(*)::int as n from dd where ${where}`, { officeOnly: true })),
    ]);
    return { rows: list, total: num(t?.n) };
  },
});

