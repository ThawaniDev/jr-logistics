"use client";
import type { ReactNode } from "react";
import type { ValueFormat } from "./chartTheme";
import { ChartCard } from "./ChartCard";
import { BarRows, type BarRow } from "./BarRows";

/** A top-N (or bottom-N) list: rank, name (a link when `href` is set), a bar scaled to the best, the value and the change against the comparison period. */
export function RankedList({ title, description, rows, format = "number", good = "higher", loading, actions, testId }: { title: string; description?: string; rows: BarRow[]; format?: ValueFormat; good?: "higher" | "lower" | "neutral"; loading?: boolean; actions?: ReactNode; testId?: string }) {
  return (
    <ChartCard title={title} description={description} height="auto" loading={loading} empty={!loading && rows.length === 0} actions={actions} testId={testId}>
      <BarRows rows={rows} format={format} ranked good={good} label={title} />
    </ChartCard>
  );
}
