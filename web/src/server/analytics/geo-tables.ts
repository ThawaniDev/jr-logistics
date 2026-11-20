import { sql } from "drizzle-orm";
import { can } from "../auth/permissions";
import { cityRows, gridCells, routeRows } from "./geo-queries";
import { zonesOf } from "./geo-lib";
import { memoryPage } from "./ops-util";
import { defineTable, type DrillColumn } from "./registry";

/**
 * Drill-down tables of the Geography report (`GET /admin/analytics/geography/table/<name>`, CSV for `reports.export`). Cities, routes and grid cells are bounded SQL aggregates
 * (≤ ~50, ≤ 100, ≤ 2000 rows), so the same aggregate as the report feeds the table and the table is sorted and paged in memory: table and charts can never disagree.
 */
const REPORT = "geography";
const rec = <T extends { id: string }>(r: { rows: T[]; total: number }) => ({ rows: r.rows.map((x) => ({ ...x }) as Record<string, unknown>), total: r.total });
const PLACEHOLDER = sql`1`; // sorting is done in memory; the registry only checks the key is whitelisted
const sorts = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, PLACEHOLDER]));
const col = (key: string, label: string, type: DrillColumn["type"], o: Partial<DrillColumn> = {}): DrillColumn => ({ key, label: `rpo.${label}`, type, ...o });
const num = (key: string, label: string, o: Partial<DrillColumn> = {}) => col(key, label, "number", { align: "end", ...o });

const CITY_COLS = [
  col("city", "col_city", "enum", { ns: "city" }), num("requests", "col_requests"), num("pickupRequests", "col_pickups", { phone: false }), num("parcels", "col_parcels"), num("delivered", "col_delivered", { phone: false }), num("failedAll", "col_failed", { phone: false }),
  col("successRate", "col_success", "percent", { align: "end" }), col("avgDeliverySecs", "col_avg_delivery", "duration", { align: "end", phone: false }), num("slots", "col_slots", { phone: false }),
  num("unserved", "col_unserved", { phone: false }), col("unservedRate", "col_unserved_rate", "percent", { align: "end", phone: false }), num("drivers", "col_drivers", { phone: false }),
  num("activeDrivers", "col_active_drivers", { phone: false }), num("activeCompanies", "col_active_companies", { phone: false }), col("gmv", "col_gmv", "money", { align: "end" }),
];
defineTable({
  report: REPORT, name: "cities", title: "rpo.tbl_cities", columns: CITY_COLS, moneyKeys: ["gmv"],
  sorts: sorts(CITY_COLS.map((c) => c.key)), defaultSort: { key: "parcels", dir: "desc" },
  async query({ filters: f, user, limit, offset, sort }) {
    const items = (await cityRows(f, can(user, "finance.view"))).map((r) => ({ ...r, id: r.key, city: r.key, failedAll: r.failed + r.returned }));
    return rec(memoryPage(items, sort, limit, offset));
  },
});

const ROUTE_COLS = [
  col("pickup", "col_from", "enum", { ns: "city" }), col("delivery", "col_to", "enum", { ns: "city" }), num("requests", "col_requests"), num("parcels", "col_parcels"), num("delivered", "col_delivered", { phone: false }),
  num("failed", "col_failed", { phone: false }), col("successRate", "col_success", "percent", { align: "end" }), col("avgDeliverySecs", "col_avg_delivery", "duration", { align: "end", phone: false }), col("gmv", "col_gmv", "money", { align: "end" }),
];
defineTable({
  report: REPORT, name: "routes", title: "rpo.tbl_routes", columns: ROUTE_COLS, moneyKeys: ["gmv"],
  sorts: sorts(ROUTE_COLS.map((c) => c.key)), defaultSort: { key: "requests", dir: "desc" },
  async query({ filters: f, user, limit, offset, sort }) { return rec(memoryPage(await routeRows(f, can(user, "finance.view")), sort, limit, offset)); },
});

const ZONE_COLS = [
  col("zone", "col_zone", "text"), col("city", "col_city", "enum", { ns: "city", phone: false }), num("parcels", "col_parcels"), num("delivered", "col_delivered", { phone: false }), num("failed", "col_failed", { phone: false }),
  col("successRate", "col_success", "percent", { align: "end" }), col("share", "col_share", "percent", { align: "end", phone: false }),
];
defineTable({
  report: REPORT, name: "zones", title: "rpo.tbl_zones", columns: ZONE_COLS,
  sorts: sorts(ZONE_COLS.map((c) => c.key)), defaultSort: { key: "parcels", dir: "desc" },
  async query({ filters: f, limit, offset, sort }) { return rec(memoryPage(zonesOf(await gridCells(f, 2000)), sort, limit, offset)); },
});
