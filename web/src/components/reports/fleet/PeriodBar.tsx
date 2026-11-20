"use client";
import { useMemo, useState, type ReactNode } from "react";
import { CalendarRange } from "lucide-react";
import { Input } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { fmtDate } from "@/lib/format";
import type { ReportFilterState } from "../useReportFilters";
import { FLEET_PRESETS, rangeLimits } from "./fleet-lib";
import { Pills } from "./Pills";

/**
 * The period bar of the fleet centre: presets (today, 7 / 30 / 90 days, month to date) or a custom range of at most 366 days, and the comparison with the previous period.
 * State lives in the URL through `useReportFilters()` (so a link keeps the period); the entity is fixed, so there are no other filters. `actions` sits at the end (the workbook).
 */
export function PeriodBar({ f, actions }: { f: ReportFilterState; actions?: ReactNode }) {
  const { t, locale } = useI18n();
  // The two dates of a custom range are edited one after the other, faster than the URL round trip: keep the latest pair locally until the URL catches up.
  const key = `${f.from}|${f.to}`;
  const [draft, setDraft] = useState<{ key: string; from: string; to: string } | null>(null);
  const from = draft && draft.key === key ? draft.from : f.from, to = draft && draft.key === key ? draft.to : f.to;
  const setRange = (nf: string, nt: string) => { setDraft({ key, from: nf, to: nt }); f.set({ from: nf, to: nt, preset: "" }); };
  const lim = rangeLimits(from, to);
  const options = useMemo(() => {
    // A preset the bar does not list (a shared link with `preset=qtd`) is still shown, so the selection is never invisible.
    const keys: string[] = [...FLEET_PRESETS];
    if (f.preset !== "custom" && !keys.includes(f.preset)) keys.push(f.preset);
    return [...keys.map((p) => ({ key: p, label: t(`rpf.preset_${p}`), testId: `fr-period-${p}` })), { key: "custom", label: t("rpf.preset_custom"), testId: "fr-period-custom" }];
  }, [f.preset, t]);
  const pick = (k: string) => (k === "custom" ? f.set({ preset: "", from: f.from, to: f.to }) : f.set({ preset: k, from: "", to: "" }));
  const date = (d: string) => <span>{fmtDate(`${d}T12:00:00+03:00`, locale)}</span>;
  // The URL is the source of truth but it updates a moment after the click: show the click at once, and let the URL take over when it arrives.
  const [local, setLocal] = useState<{ base: string; on: boolean } | null>(null);
  const comparing = local && local.base === f.compare ? local.on : f.compare !== "none";
  const toggleCompare = (on: boolean) => { setLocal({ base: f.compare, on }); f.set({ compare: on ? "" : "none" }); };
  return (
    <section aria-label={t("rpf.f_period")} className="rounded-card border border-line bg-card p-3 sm:p-4" data-testid="fr-period">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 print:hidden">
        <div className="min-w-0 max-w-full">
          <p className="mb-1.5 text-xs font-medium text-muted">{t("rpf.f_period")}</p>
          <Pills label={t("rpf.f_period")} value={f.preset} onChange={pick} options={options} testId="fr-period-presets" />
        </div>
        {f.preset === "custom" && (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Input type="date" label={t("rpf.f_from")} value={from} min={lim.minFrom} max={to} onChange={(e) => e.target.value && setRange(e.target.value, e.target.value > to ? e.target.value : to)} className="h-9" data-testid="fr-period-from" />
            <Input type="date" label={t("rpf.f_to")} value={to} min={from} max={lim.maxTo} onChange={(e) => e.target.value && setRange(e.target.value < from ? e.target.value : from, e.target.value)} className="h-9" data-testid="fr-period-to" />
          </div>
        )}
        <label className="flex h-9 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" role="switch" data-testid="fr-period-compare" checked={comparing} onChange={(e) => toggleCompare(e.target.checked)} className="size-4 accent-[var(--jr-accent)]" />
          <span>{t("fr.compare")}</span>
        </label>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:ms-auto">{actions}</div>}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3 text-xs text-muted print:mt-0 print:border-0 print:pt-0" data-testid="fr-period-summary" aria-live="polite">
        <CalendarRange className="size-3.5 shrink-0" aria-hidden />
        <span>{t("rpf.showing")}</span>
        <span className="font-medium text-ink">{date(f.from)}{f.from !== f.to && <> – {date(f.to)}</>}</span>
        <span aria-hidden>·</span><span>{t("rpf.days_n", { n: f.days })}</span>
        <span aria-hidden>·</span>
        {f.prev ? <span>{t("rpf.compared")} <span className="font-medium text-ink">{date(f.prev.from)}{f.prev.from !== f.prev.to && <> – {date(f.prev.to)}</>}</span></span> : <span>{t("rpf.not_compared")}</span>}
      </p>
    </section>
  );
}
