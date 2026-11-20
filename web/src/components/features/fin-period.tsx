"use client";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { riyadhDay } from "@/server/analytics/time";
import { activePreset, effectiveRange, FIN_PRESETS, presetParams, type FinPreset, type PeriodParams } from "./fin-period-lib";
import { ViewToggle } from "./fin-sort-table";

export type { PeriodParams };

/** The period control of a finance page (presets, All time, custom range): state in the URL, rules in `fin-period-lib.ts`. */
export function FinPeriod({ value, onChange, testId = "fd-period" }: { value: PeriodParams; onChange: (p: PeriodParams) => void; testId?: string }) {
  const { t } = useI18n();
  const today = useMemo(() => riyadhDay(new Date()), []);
  const preset = activePreset(value, today);
  const eff = effectiveRange(value, today);
  const [custom, setCustom] = useState(false);
  const shown: FinPreset = custom ? "custom" : preset;
  const pick = (k: string) => { setCustom(k === "custom"); onChange(presetParams(k as FinPreset, today, eff)); };
  const label: Record<string, string> = { "7d": t("fdr.p_7d"), "30d": t("fdr.p_30d"), "90d": t("fdr.p_90d"), mtd: t("fdr.p_month"), ytd: t("fdr.p_year"), all: t("fdr.p_all"), custom: t("fdr.p_custom") };
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid={testId}>
      <div className="min-w-0 max-w-full">
        <p className="mb-1.5 text-xs font-medium text-muted">{t("fdr.period")}</p>
        <ViewToggle label={t("fdr.period")} testId={`${testId}-presets`} value={shown} onChange={pick} options={[...FIN_PRESETS, "all", "custom"].map((k) => ({ key: k, label: label[k] }))} />
      </div>
      {shown === "custom" && (
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Input type="date" label={t("adm.from")} ltr value={eff.from} max={eff.to} onChange={(e) => e.target.value && onChange({ from: e.target.value, to: e.target.value > eff.to ? e.target.value : eff.to, period: "" })} className="h-9" data-testid={`${testId}-from`} />
          <Input type="date" label={t("adm.to")} ltr value={eff.to} min={eff.from} onChange={(e) => e.target.value && onChange({ from: e.target.value < eff.from ? e.target.value : eff.from, to: e.target.value, period: "" })} className="h-9" data-testid={`${testId}-to`} />
        </div>
      )}
    </div>
  );
}
