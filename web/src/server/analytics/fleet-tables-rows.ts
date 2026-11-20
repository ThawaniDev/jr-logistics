import { sql } from "drizzle-orm";
import type { DrillColumn } from "./registry";

/** Columns of the row-level fleet tables (one row per job, per settlement, per failure reason) shared by the drivers and the offices reports. Labels `fr.col_*`, help `fr.help_*`. */
const col = (key: string, label: string, type: DrillColumn["type"], o: Partial<DrillColumn> = {}): DrillColumn => ({ key, label: `fr.col_${label}`, type, ...(type === "number" || type === "money" || type === "percent" ? { align: "end" as const } : {}), ...o });
const REQ = "/admin/requests/{requestId}";

export const JOB_COLS: DrillColumn[] = [
  col("ref", "order", "link", { href: REQ, sub: "company" }), col("driver", "driver", "link", { href: "/admin/drivers/{driverId}" }), col("office", "office", "enum", { ns: "fr.office", phone: false }),
  col("startsAt", "starts_at", "datetime", { phone: false }), col("arrivedAt", "arrived_at", "datetime", { phone: false }), col("lateMin", "late_min", "number"), col("waitMin", "wait_min", "number", { phone: false }),
  col("loadMin", "load_min", "number", { phone: false }), col("planMin", "plan_min", "number", { phone: false }), col("expected", "expected", "number", { phone: false }), col("delivered", "delivered", "number"),
  col("failed", "failed", "number", { phone: false }), col("returned", "returned", "number", { phone: false }), col("radiusM", "radius_m", "distance", { phone: false }),
  col("codCollectedCents", "cod_collected", "money", { phone: false }), col("codRemittedCents", "cod_remitted", "money", { phone: false }), col("earnCents", "earn", "money"), col("status", "status", "status", { ns: "jobstatus" }),
];
export const JOB_SORTS = {
  ref: sql`ref`, driver: sql`lower(driver)`, office: sql`lower(office)`, startsAt: sql`"startsAt"`, arrivedAt: sql`"arrivedAt"`, lateMin: sql`"lateMin"`, waitMin: sql`"waitMin"`, loadMin: sql`"loadMin"`, planMin: sql`"planMin"`,
  expected: sql`expected`, delivered: sql`delivered`, failed: sql`failed`, returned: sql`returned`, radiusM: sql`"radiusM"`, codCollectedCents: sql`"codCollectedCents"`, codRemittedCents: sql`"codRemittedCents"`,
  earnCents: sql`"earnCents"`, status: sql`status`,
};
export const FAILURE_COLS: DrillColumn[] = [
  col("reason", "reason", "enum", { ns: "stopfail" }), col("count", "count", "number"), col("share", "share", "percent"), col("drivers", "drivers_affected", "number"),
];
export const FAILURE_SORTS = { reason: sql`reason`, count: sql`count`, share: sql`share`, drivers: sql`drivers` };
export const EARNING_COLS: DrillColumn[] = [
  col("ref", "order", "link", { href: REQ, sub: "company" }), col("driver", "driver", "link", { href: "/admin/drivers/{driverId}" }), col("office", "office", "enum", { ns: "fr.office", phone: false }),
  col("customerCents", "customer", "money"), col("earnCents", "earn", "money"), col("marginCents", "margin", "money", { phone: false }), col("vatCents", "vat", "money", { phone: false }),
  col("refundCents", "refund", "money", { phone: false }), col("status", "status", "status", { ns: "settle" }), col("createdAt", "created_at", "datetime", { phone: false }), col("paidAt", "paid_at", "datetime", { phone: false }),
];
export const EARNING_SORTS = {
  ref: sql`ref`, driver: sql`lower(driver)`, office: sql`lower(office)`, customerCents: sql`"customerCents"`, earnCents: sql`"earnCents"`, marginCents: sql`"marginCents"`, vatCents: sql`"vatCents"`,
  refundCents: sql`"refundCents"`, status: sql`status`, createdAt: sql`"createdAt"`, paidAt: sql`"paidAt"`,
};
export const EARNING_MONEY = ["customerCents", "earnCents", "marginCents", "vatCents", "refundCents"];
