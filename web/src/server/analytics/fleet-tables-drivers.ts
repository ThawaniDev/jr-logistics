import { sql } from "drizzle-orm";
import { can } from "../auth/permissions";
import { ACTIVE_ANY } from "./drivers-sql";
import { moneyFields, selectMetrics } from "./fleet-metrics";
import { moneyDailyChain, opsDailyChain } from "./fleet-daily-sql";
import { failureRows, jobRows } from "./fleet-rows-sql";
import { FAILURE_COLS, JOB_COLS, JOB_SORTS, FAILURE_SORTS } from "./fleet-tables-rows";
import { cityCol, dateCol, dayPage, driverCol, driverDayPage, driverPage, metricCols, metricSorts, officeNameCol, vehicleCol, who } from "./fleet-tables-lib";
import { defineTable } from "./registry";

/**
 * Drill-down tables of the Drivers report (`GET /admin/analytics/drivers/table/<name>`): `perf` (every metric per driver), `daily` (one row per Riyadh day), `money` / `money_daily`
 * (finance.view), `jobs` (one row per job) and `failures` (by reason). They honour every report filter and read the selected period only. See memory/FLEET_REPORTS.md §3–4.
 */
export const DRIVER_PERF = [
  "offered", "declined", "timedout", "decline_rate", "acceptance", "resp_avg", "resp_p90",
  "jobs", "active_days", "online_days", "jobs_per_active_day", "parcels_per_active_day", "online", "deliv_per_online_hour", "parcels_per_job",
  "punctual", "late", "very_late", "on_time", "late_avg_min", "arrival_delta_avg_min", "attend_avg_min", "load_avg_min", "wait_avg_min", "plan_avg_min",
  "stop_avg_min", "parcel_avg_min", "job_avg_min", "radius_m", "route_m", "gps_m",
  "delivered", "failed", "returned", "pending_parcels", "success", "first_attempt", "deferrals", "proof_otp", "proof_receipt", "cod_parcels",
  "rating", "rating_count", "stars1", "stars2", "stars3", "stars4", "stars5", "complaints", "complaints_open", "strikes", "suspensions",
] as const;
export const DRIVER_MONEY = ["jobs", "delivered", "online", "customer", "earn", "margin", "vat", "refund", "adjust", "paid", "pending", "cod_collected", "cod_remitted", "cod_held", "earn_per_job", "earn_per_parcel", "earn_per_hour"] as const;
export const DAILY_OPS = [
  "registered", "online_drivers", "drivers_with_jobs", "online", "offered", "declined", "timedout", "cancelled", "jobs", "delivered", "failed", "returned", "punctual", "late", "very_late",
  "late_avg_min", "wait_avg_min", "load_avg_min", "stop_avg_min", "parcel_avg_min", "job_avg_min", "radius_m", "deliv_per_online_hour",
] as const;
/** The day-by-day numbers of ONE driver (the "Daily by driver" sheet of a workbook): one row per driver and day that had offers, jobs, parcels or online time. */
export const PERF_DAILY = [
  "online", "offered", "declined", "timedout", "cancelled", "jobs", "delivered", "failed", "returned", "punctual", "late", "very_late", "late_avg_min", "arrival_delta_avg_min",
  "wait_avg_min", "load_avg_min", "stop_avg_min", "parcel_avg_min", "job_avg_min", "radius_m", "deliv_per_online_hour",
] as const;
export const DAILY_MONEY = ["jobs", "delivered", "customer", "earn", "margin", "vat", "refund", "adjust", "paid", "cod_collected", "cod_remitted", "earn_per_job", "earn_per_parcel", "earn_per_hour"] as const;
const IDENT = sql`id, name, coalesce(office_name, 'direct') as office, vehicle, city`;
const SORT_IDENT = { name: sql`lower(name)`, office: sql`lower(office)`, vehicle: sql`vehicle`, city: sql`city` };
const PHONE = ["jobs", "delivered", "success", "on_time", "rating", "late"];

defineTable({
  report: "drivers", name: "perf", title: "fr.tbl_drivers_perf",
  columns: [driverCol, officeNameCol, vehicleCol, cityCol, ...metricCols(DRIVER_PERF, PHONE)],
  moneyKeys: [], sorts: { ...SORT_IDENT, ...metricSorts(DRIVER_PERF) }, defaultSort: { key: "delivered", dir: "desc" }, tiebreak: sql`id`,
  async query(q) { const w = await who(q); return driverPage(w, sql`${IDENT}, ${selectMetrics(DRIVER_PERF)}`, ACTIVE_ANY, q.order, q.limit, q.offset); },
});

defineTable({
  report: "drivers", name: "money", title: "fr.tbl_drivers_money", needs: ["finance.view"],
  columns: [driverCol, officeNameCol, ...metricCols(DRIVER_MONEY, ["delivered", "earn", "paid"])], moneyKeys: moneyFields(DRIVER_MONEY),
  sorts: { name: SORT_IDENT.name, office: SORT_IDENT.office, ...metricSorts(DRIVER_MONEY) }, defaultSort: { key: "earnCents", dir: "desc" }, tiebreak: sql`id`,
  async query(q) {
    const w = await who(q);
    return driverPage(w, sql`id, name, coalesce(office_name, 'direct') as office, ${selectMetrics(DRIVER_MONEY)}`, sql`(${ACTIVE_ANY} or pending_c > 0 or paid_c > 0 or cod_held_c > 0 or cod_collected_c > 0 or cod_remitted_c > 0)`, q.order, q.limit, q.offset);
  },
});

defineTable({
  report: "drivers", name: "daily", title: "fr.tbl_drivers_daily",
  columns: [dateCol, ...metricCols(DAILY_OPS, ["jobs", "delivered", "online_drivers"])], sorts: { date: sql`"date"`, ...metricSorts(DAILY_OPS) }, defaultSort: { key: "date", dir: "desc" }, tiebreak: sql`t`,
  async query(q) { const w = await who(q); return dayPage(w, (keys) => opsDailyChain(w.f, w.grace, keys, "drivers"), DAILY_OPS, q.order, q.limit, q.offset); },
});

defineTable({
  report: "drivers", name: "perf_daily", title: "fr.tbl_drivers_perf_daily",
  columns: [dateCol, { ...driverCol, key: "driver" }, officeNameCol, ...metricCols(PERF_DAILY, ["jobs", "delivered"])],
  sorts: { date: sql`"date"`, driver: sql`lower(driver)`, office: sql`lower(office)`, ...metricSorts(PERF_DAILY) }, defaultSort: { key: "date", dir: "desc" }, tiebreak: sql`"driverId"`,
  async query(q) { const w = await who(q); return driverDayPage(w, (keys) => opsDailyChain(w.f, w.grace, keys, "drivers", "driver"), PERF_DAILY, q.order, q.limit, q.offset); },
});

defineTable({
  report: "drivers", name: "money_daily", title: "fr.tbl_drivers_money_daily", needs: ["finance.view"],
  columns: [dateCol, ...metricCols(DAILY_MONEY, ["delivered", "earn"])], moneyKeys: moneyFields(DAILY_MONEY), sorts: { date: sql`"date"`, ...metricSorts(DAILY_MONEY) }, defaultSort: { key: "date", dir: "desc" }, tiebreak: sql`t`,
  async query(q) { const w = await who(q); return dayPage(w, (keys) => moneyDailyChain(w.f, keys, "drivers"), DAILY_MONEY, q.order, q.limit, q.offset); },
});

defineTable({
  report: "drivers", name: "jobs", title: "fr.tbl_drivers_jobs", columns: JOB_COLS, moneyKeys: ["codCollectedCents", "codRemittedCents", "earnCents"], sorts: JOB_SORTS,
  defaultSort: { key: "startsAt", dir: "desc" }, tiebreak: sql`id`,
  async query(q) { return jobRows(q.filters, can(q.user, "finance.view"), "drivers", q.limit, q.offset, q.order); },
});

defineTable({
  report: "drivers", name: "failures", title: "fr.tbl_drivers_failures", columns: FAILURE_COLS, sorts: FAILURE_SORTS, defaultSort: { key: "count", dir: "desc" }, tiebreak: sql`id`,
  async query(q) { return failureRows(q.filters, "drivers", q.limit, q.offset, q.order); },
});
