"use client";
import { useMemo, useState } from "react";
import { Building2, CalendarRange, Car, CircleDot, Layers, MapPin, Radio, RotateCcw, Truck, UserRound, X, type LucideIcon } from "lucide-react";
import { Button, Input, Segmented, Select } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { fmtDate } from "@/lib/format";
import { MAX_SPAN_DAYS, PRESETS, BUCKETS, COMPARES } from "@/server/analytics/periods";
import { addDays } from "@/server/analytics/time";
import type { MultiKey } from "@/server/analytics/keys";
import { MultiSelect, pickedNames, type Option, type OptionKind } from "./MultiSelect";
import type { ReportFilterState } from "./useReportFilters";

interface Opts { cities: Array<{ key: string; ar: string; en: string; ur: string }>; services: string[]; vehicles: string[]; channels: string[]; statuses: string[]; /** portal offices only: their own drivers */ drivers?: Array<{ id: string; name: string; sub?: string | null }> }
const ICON: Record<MultiKey, LucideIcon> = { city: MapPin, service: Layers, vehicle: Car, company: Building2, office: Truck, driver: UserRound, status: CircleDot, channel: Radio };
const KINDS: Partial<Record<MultiKey, OptionKind>> = { company: "company", office: "office", driver: "driver" };
/** The order the controls appear in: who (searchable accounts), where / what (fixed lists). */
export const ALL_FILTER_KEYS: MultiKey[] = ["company", "office", "driver", "city", "service", "vehicle", "status", "channel"];

/** Names of accounts that came from a shared link (ids only): one lookup per kind, cached in `pickedNames`. */
function useIdNames(kind: OptionKind, ids: string[], enabled: boolean) {
  const missing = ids.filter((i) => !pickedNames.has(i));
  const r = useApi<{ items: Array<{ id: string; name: string }> }>(enabled && missing.length ? `/admin/analytics/options?kind=${kind}&ids=${missing.join(",")}` : null);
  for (const x of r.data?.items ?? []) pickedNames.set(x.id, x.name);
}

/**
 * The shared filter bar (decision G3): period presets + custom range, comparison, bucket, multi-selects and chips. Everything is read from and written to the URL through
 * `useReportFilters()`, so the page is shareable. `keys` limits the multi-selects a report supports (default all), `compare` / `bucket` hide those controls.
 * Portals (company / courier office) pass `optionsUrl` (their own `/…/analytics/options`): the lists then come from it, accounts are never searched on the admin endpoint and
 * the driver filter of an office is a plain list of its own drivers.
 */
export function ReportFilters({ filters: f, keys = ALL_FILTER_KEYS, compare = true, bucket = true, optionsUrl }: { filters: ReportFilterState; keys?: MultiKey[]; compare?: boolean; bucket?: boolean; optionsUrl?: string }) {
  const { t, locale } = useI18n();
  const opts = useApi<Opts>(optionsUrl ?? "/admin/analytics/options");
  // The two dates of a custom range are edited one after the other, faster than the URL round trip: keep the latest pair locally until the URL catches up.
  const key = `${f.from}|${f.to}`;
  const [draft, setDraft] = useState<{ key: string; from: string; to: string } | null>(null);
  const from = draft && draft.key === key ? draft.from : f.from, to = draft && draft.key === key ? draft.to : f.to;
  const setRange = (nf: string, nt: string) => { setDraft({ key, from: nf, to: nt }); f.set({ from: nf, to: nt, preset: "" }); };
  const admin = !optionsUrl;
  useIdNames("company", f.values.company, admin); useIdNames("office", f.values.office, admin); useIdNames("driver", f.values.driver, admin);
  const shown = ALL_FILTER_KEYS.filter((k) => keys.includes(k));
  const name = (k: MultiKey, v: string): string => {
    if (k === "city") { const c = opts.data?.cities.find((x) => x.key === v); const n = c?.[locale]; return n || t(`city.${v}`) || v; }
    if (k === "service") return t(`svc.${v}`);
    if (k === "vehicle") return t(`vehicle.${v}`);
    if (k === "status") return t(`status.${v}`);
    if (k === "channel") return t(`rpf.ch_${v}`);
    return pickedNames.get(v) ?? opts.data?.drivers?.find((x) => x.id === v)?.name ?? "…";
  };
  const options = (k: MultiKey): Option[] | undefined => {
    const d = opts.data; if (!d) return [];
    if (k === "driver" && d.drivers) return d.drivers.map((x) => ({ key: x.id, label: x.name, sub: x.sub ? (t(`city.${x.sub}`) !== `city.${x.sub}` ? t(`city.${x.sub}`) : x.sub) : null }));
    const list = k === "city" ? d.cities.map((c) => c.key) : k === "service" ? d.services : k === "vehicle" ? d.vehicles : k === "status" ? d.statuses : k === "channel" ? d.channels : null;
    return list ? list.map((v) => ({ key: v, label: name(k, v) })) : undefined;
  };
  const chips = shown.flatMap((k) => f.values[k].map((v) => ({ k, v })));
  // The summary follows the selection at once (the same pure period logic the server uses), not the response that may still be on its way.
  const win = { from: f.from, to: f.to, days: f.days };
  const prev = f.prev;
  const bucketName = t(`rpf.b_${f.resolvedBucket}`);
  // Dates keep their natural direction: an Arabic date inside an LTR isolate reads scrambled.
  const date = (d: string) => <span>{fmtDate(`${d}T12:00:00+03:00`, locale)}</span>;
  const presetOptions = useMemo(() => [...PRESETS.map((p) => ({ key: p, label: t(`rpf.preset_${p}`) })), { key: "custom", label: t("rpf.preset_custom") }], [t]);
  const pickPreset = (k: string) => (k === "custom" ? f.set({ preset: "", from: f.from, to: f.to }) : f.set({ preset: k, from: "", to: "" }));
  return (
    <section aria-label={t("rpf.f_filters")} className="mb-5 rounded-card border border-line bg-card p-3 sm:p-4" data-testid="report-filters">
      <div className="space-y-3 print:hidden">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="min-w-0 max-w-full">
            <p className="mb-1.5 text-xs font-medium text-muted">{t("rpf.f_period")}</p>
            <Segmented label={t("rpf.f_period")} value={f.preset} onChange={pickPreset} options={presetOptions} />
          </div>
          {f.preset === "custom" && (
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
              <Input type="date" label={t("rpf.f_from")} value={from} min={addDays(to, -(MAX_SPAN_DAYS - 1))} max={to} onChange={(e) => e.target.value && setRange(e.target.value, e.target.value > to ? e.target.value : to)} className="h-9" data-testid="report-from" />
              <Input type="date" label={t("rpf.f_to")} value={to} min={from} max={addDays(from, MAX_SPAN_DAYS - 1)} onChange={(e) => e.target.value && setRange(e.target.value < from ? e.target.value : from, e.target.value)} className="h-9" data-testid="report-to" />
            </div>
          )}
          {(compare || bucket) && (
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
              {compare && <Select label={t("rpf.f_compare")} value={f.compare} onChange={(e) => f.set({ compare: e.target.value === "prev" ? "" : e.target.value })} className="h-9 sm:w-52" data-testid="report-compare" options={COMPARES.map((c) => ({ value: c, label: t(`rpf.cmp_${c}`) }))} />}
              {bucket && <Select label={t("rpf.f_bucket")} value={f.bucket} onChange={(e) => f.set({ bucket: e.target.value === "auto" ? "" : e.target.value })} className="h-9 sm:w-40" data-testid="report-bucket" options={BUCKETS.map((b) => ({ value: b, label: t(`rpf.b_${b}`) }))} />}
            </div>
          )}
        </div>
        {shown.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("rpf.f_filters")}>
            {shown.map((k) => { const I = ICON[k]; return <MultiSelect key={k} testId={`report-filter-${k}`} label={t(`rpf.f_${k}`)} icon={<I className="size-4" aria-hidden />} kind={admin || !options(k) ? KINDS[k] : undefined} options={options(k)} selected={f.values[k]} onChange={(n) => f.setValues(k, n)} />; })}
            {f.dirty && <Button variant="ghost" size="sm" onClick={f.reset} data-testid="report-reset"><RotateCcw className="size-3.5" aria-hidden />{t("rpf.f_reset")}</Button>}
          </div>
        )}
        {chips.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={t("rpf.f_active")} data-testid="report-chips">
            {chips.map(({ k, v }) => (
              <li key={`${k}:${v}`} className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 py-0.5 ps-2.5 pe-1 text-xs text-ink">
                <span className="text-muted">{t(`rpf.f_${k}`)}:</span>{" "}<span className="max-w-[12rem] truncate font-medium">{name(k, v)}</span>
                <button type="button" onClick={() => f.setValues(k, f.values[k].filter((x) => x !== v))} aria-label={t("rpf.f_remove", { name: name(k, v) })} className="jr-tap flex size-5 items-center justify-center rounded-full text-muted hover:bg-accent/20 hover:text-ink"><X className="size-3" aria-hidden /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3 text-xs text-muted print:mt-0 print:border-0 print:pt-0" data-testid="report-summary" aria-live="polite">
        <CalendarRange className="size-3.5 shrink-0" aria-hidden />
        <span>{t("rpf.showing")}</span>
        <span className="font-medium text-ink">{date(win.from)}{win.from !== win.to && <> – {date(win.to)}</>}</span>
        <span aria-hidden>·</span><span>{t("rpf.days_n", { n: win.days })}</span>
        <span aria-hidden>·</span><span>{t("rpf.grouped", { bucket: bucketName })}</span>
        <span aria-hidden>·</span>
        {prev ? <span>{t("rpf.compared")} <span className="font-medium text-ink">{date(prev.from)}{prev.from !== prev.to && <> – {date(prev.to)}</>}</span></span> : <span>{t("rpf.not_compared")}</span>}
      </p>
    </section>
  );
}
