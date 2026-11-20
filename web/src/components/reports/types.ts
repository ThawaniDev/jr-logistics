import type { filtersMeta } from "@/server/analytics/filters";
import type { overviewReport } from "@/server/analytics/overview";

export type { Kpi } from "@/server/analytics/kpi";
export type { Bucket, BucketReq, Compare, Preset } from "@/server/analytics/periods";
export type { MultiKey } from "@/server/analytics/keys";
export type { ValueFormat } from "./chartTheme";

/** The `meta` block every analytics response carries (resolved period, comparison, filters, freshness). */
export type ReportMeta = ReturnType<typeof filtersMeta> & { generatedAt?: string; cached?: boolean; empty?: boolean; moneyHidden?: boolean };
export type OverviewData = Awaited<ReturnType<typeof overviewReport>>;
/** One page of a registered drill-down table (`GET /admin/analytics/:report/table/:name`). */
export interface DrillPage {
  meta: ReportMeta; title: string;
  columns: Array<{ key: string; label: string; type?: string; ns?: string; href?: string; sub?: string; align?: "start" | "end"; phone?: boolean; sortable: boolean }>;
  rows: Array<Record<string, unknown>>; page: number; pageSize: number; total: number; sort: { key: string; dir: "asc" | "desc" };
}
