import { sql } from "drizzle-orm";
import { can } from "../auth/permissions";
import { DAILY_MONEY, DAILY_OPS, DRIVER_MONEY, DRIVER_PERF } from "./fleet-tables-drivers";
import { moneyFields, selectMetrics } from "./fleet-metrics";
import { moneyDailyChain, opsDailyChain } from "./fleet-daily-sql";
import { earningRows, failureRows, jobRows } from "./fleet-rows-sql";
import { EARNING_COLS, EARNING_MONEY, EARNING_SORTS, FAILURE_COLS, FAILURE_SORTS, JOB_COLS, JOB_SORTS } from "./fleet-tables-rows";
import { cityCol, dateCol, dayPage, metricCols, metricSorts, officePage, who } from "./fleet-tables-lib";
import { defineTable, type DrillColumn } from "./registry";

/**
 * Drill-down tables of the Courier offices report (`GET /admin/analytics/offices/table/<name>`): `perf` (one row per office plus the "Independent drivers" row, `id = 'direct'`), `daily`,
 * `money`, `money_daily`, `earnings` (one row per settlement), `jobs` and `failures`. Only `perf` and `money` list independent drivers; the others cover work done through an office.
 * An office's drivers are the ones linked to it now; its settlement figures are keyed by the payee office (so they tie to the Offices report). See memory/FLEET_REPORTS.md §3–4.
 */
const OFFICE_PERF = ["fleet", "drivers_active", "links", "unlinks", ...DRIVER_PERF] as const;
const PHONE = ["fleet", "jobs", "delivered", "success", "on_time", "rating"];
const nameCol: DrillColumn = { key: "name", label: "fr.col_office", type: "enum", ns: "fr.office" };
const agreementCol: DrillColumn = { key: "agreement", label: "fr.col_agreement", type: "enum", ns: "rpp.agr", phone: false };
const verificationCol: DrillColumn = { key: "verification", label: "fr.col_verification", type: "enum", ns: "rpp.ver", phone: false };
const IDENT = sql`id, coalesce(name, 'direct') as name, city, agreement, verification`;
const SORT_IDENT = { name: sql`lower(name)`, city: sql`city`, agreement: sql`agreement`, verification: sql`verification` };

defineTable({
  report: "offices", name: "perf", title: "fr.tbl_offices_perf",
  columns: [nameCol, cityCol, agreementCol, verificationCol, ...metricCols(OFFICE_PERF, PHONE)],
  sorts: { ...SORT_IDENT, ...metricSorts(OFFICE_PERF) }, defaultSort: { key: "delivered", dir: "desc" }, tiebreak: sql`id`,
  async query(q) { const w = await who(q); return officePage(w, sql`${IDENT}, ${selectMetrics(OFFICE_PERF)}`, sql`true`, q.order, q.limit, q.offset); },
});

defineTable({
  report: "offices", name: "money", title: "fr.tbl_offices_money", needs: ["finance.view"],
  columns: [nameCol, ...metricCols(DRIVER_MONEY, ["delivered", "earn", "paid"])], moneyKeys: moneyFields(DRIVER_MONEY),
  sorts: { name: SORT_IDENT.name, ...metricSorts(DRIVER_MONEY) }, defaultSort: { key: "earnCents", dir: "desc" }, tiebreak: sql`id`,
  async query(q) { const w = await who(q); return officePage(w, sql`id, coalesce(name, 'direct') as name, ${selectMetrics(DRIVER_MONEY)}`, sql`true`, q.order, q.limit, q.offset); },
});

defineTable({
  report: "offices", name: "daily", title: "fr.tbl_offices_daily",
  columns: [dateCol, ...metricCols(DAILY_OPS, ["jobs", "delivered", "online_drivers"])], sorts: { date: sql`"date"`, ...metricSorts(DAILY_OPS) }, defaultSort: { key: "date", dir: "desc" }, tiebreak: sql`t`,
  async query(q) { const w = await who(q); return dayPage(w, (keys) => opsDailyChain(w.f, w.grace, keys, "offices"), DAILY_OPS, q.order, q.limit, q.offset); },
});

defineTable({
  report: "offices", name: "money_daily", title: "fr.tbl_offices_money_daily", needs: ["finance.view"],
  columns: [dateCol, ...metricCols(DAILY_MONEY, ["delivered", "earn"])], moneyKeys: moneyFields(DAILY_MONEY), sorts: { date: sql`"date"`, ...metricSorts(DAILY_MONEY) }, defaultSort: { key: "date", dir: "desc" }, tiebreak: sql`t`,
  async query(q) { const w = await who(q); return dayPage(w, (keys) => moneyDailyChain(w.f, keys, "offices"), DAILY_MONEY, q.order, q.limit, q.offset); },
});

defineTable({
  report: "offices", name: "earnings", title: "fr.tbl_offices_earnings", needs: ["finance.view"], columns: EARNING_COLS, moneyKeys: EARNING_MONEY, sorts: EARNING_SORTS,
  defaultSort: { key: "createdAt", dir: "desc" }, tiebreak: sql`id`,
  async query(q) { return earningRows(q.filters, "offices", q.limit, q.offset, q.order); },
});

defineTable({
  report: "offices", name: "jobs", title: "fr.tbl_offices_jobs", columns: JOB_COLS, moneyKeys: ["codCollectedCents", "codRemittedCents", "earnCents"], sorts: JOB_SORTS,
  defaultSort: { key: "startsAt", dir: "desc" }, tiebreak: sql`id`,
  async query(q) { return jobRows(q.filters, can(q.user, "finance.view"), "offices", q.limit, q.offset, q.order); },
});

defineTable({
  report: "offices", name: "failures", title: "fr.tbl_offices_failures", columns: FAILURE_COLS, sorts: FAILURE_SORTS, defaultSort: { key: "count", dir: "desc" }, tiebreak: sql`id`,
  async query(q) { return failureRows(q.filters, "offices", q.limit, q.offset, q.order); },
});
