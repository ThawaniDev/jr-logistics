"use client";
import { useI18n } from "@/i18n/provider";
import type { ValueFormat } from "./chartTheme";
import { ChartCard } from "./ChartCard";
import { BarRows, type BarRow } from "./BarRows";

/** A breakdown by one dimension (city, service …): every row has its share as an inline bar, the value, the share of the total and, with `prev`, the change against the comparison period. */
export function BreakdownTable({ title, description, rows, format = "number", good = "higher", loading, testId }: { title: string; description?: string; rows: BarRow[]; format?: ValueFormat; good?: "higher" | "lower" | "neutral"; loading?: boolean; testId?: string }) {
  const { t } = useI18n();
  return (
    <ChartCard title={title} description={description} height="auto" loading={loading} empty={!loading && rows.every((r) => !r.value)} testId={testId}>
      <BarRows rows={rows} format={format} showShare good={good} label={`${title} — ${t("rpf.bd_share")}`} />
    </ChartCard>
  );
}
