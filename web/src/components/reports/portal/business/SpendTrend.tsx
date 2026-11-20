"use client";
import { useState } from "react";
import { Segmented } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { StackedBarChart, type TrendPoint } from "@/components/reports";
import { OTHER_KEY } from "@/server/analytics/portal-constants";
import { seriesColor } from "../../chartTheme";
import type { Bucket } from "../../types";
import { Guarded } from "../Guarded";
import { groupLabel } from "../lib";
import type { BusinessSpendingData } from "../types";

const SERVICES = ["delivery_driver", "car_with_driver", "car_without_driver"] as const;
type Dim = "service" | "vehicle" | "city";

/** What was charged per period, split by service, vehicle type or delivery city (the six biggest of each plus "other"): one stacked chart, switched with the pills above it. */
export function SpendTrend({ data, cityName }: { data: BusinessSpendingData; cityName: (key: string) => string | undefined }) {
  const { t } = useI18n();
  const [dim, setDim] = useState<Dim>("service");
  const bucket = data.meta.bucket as Bucket;
  const s = data.series;
  const pills = <Segmented label={t("rpr.sec_spend_trend")} value={dim} onChange={(k) => setDim(k as Dim)} options={(["service", "vehicle", "city"] as const).map((k) => ({ key: k, label: t(`rpr.by_${k}`) }))} />;
  const common = { testId: "chart-spend", title: t("rpr.sec_spend_trend"), description: t("rpr.sec_spend_trend_hint"), bucket, format: "money" as const, actions: pills };
  if (dim === "service") {
    return (
      <Guarded data={s.spend} title={t("rpr.sec_spend_trend")} testId="chart-spend">
        {(x) => <StackedBarChart {...common} data={x.points} prev={x.prev} series={SERVICES.map((k, i) => ({ key: k, label: t(`svc.${k}`), color: seriesColor(i) }))} />}
      </Guarded>
    );
  }
  const pivot = dim === "vehicle" ? s.byVehicle : s.byCity;
  return (
    <Guarded data={pivot} title={t("rpr.sec_spend_trend")} testId="chart-spend">
      {(x) => <StackedBarChart {...common} data={x.points as TrendPoint[]} series={x.series.map((f, i) => ({ key: f.field, label: f.key === OTHER_KEY ? t("rpr.other") : groupLabel(dim, f.key, t, cityName), color: seriesColor(i) }))} />}
    </Guarded>
  );
}
