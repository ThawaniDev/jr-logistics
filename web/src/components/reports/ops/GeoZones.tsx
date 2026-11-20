"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Section, Skeleton, EmptyState } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import type { GeographyData } from "@/server/analytics/geo-report";
import { chartVars, formatValue, fmtPercent } from "../chartTheme";
import { DrillTable } from "../DrillTable";
import { CardFailed } from "./OpsParts";
import { dimKey } from "./ops-lib";
import type { MapZone } from "./GeoMap";

const GeoMap = dynamic(() => import("./GeoMap"), { ssr: false, loading: () => <Skeleton className="h-80 w-full sm:h-[28rem]" /> });
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Delivery-point density: the grid on the map, the busiest zones as a list, the coverage of coordinates, and the full zone table with CSV. */
export function GeoZones({ data, retry, qs, cityName }: { data: GeographyData; retry: () => void; qs: string; cityName?: (key: string) => string | undefined }) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const zones = data.zones;
  const mapZones: MapZone[] = useMemo(() => (zones ?? []).map((z) => ({
    id: z.id, south: z.south, north: z.north, west: z.west, east: z.east, parcels: z.parcels, failureRate: z.failureRate, label: z.zone,
    tip: `${z.zone}${z.city ? ` · ${dimKey("city", z.city, t, cityName)}` : ""}: ${formatValue(z.parcels, "number", locale)} ${t("rpo.unit_parcels")}${z.failureRate != null ? ` · ${t("rpo.fail_rate")} ${fmtPercent(z.failureRate, locale, 0)}` : ""}`,
  })), [zones, t, locale, cityName]);
  const sel = zones?.find((z) => z.id === selected) ?? null;
  const coverage = data.meta.registered > 0 ? data.meta.located / data.meta.registered : null;
  return (
    <>
      {zones ? (
        <section aria-label={t("rpo.c_map")} data-testid="geo-zones" style={chartVars} className="min-w-0">
          <Section title={t("rpo.c_map")} description={t("rpo.c_map_hint", { deg: data.meta.gridDeg })}
            actions={coverage != null ? <span className="text-xs text-muted" data-testid="geo-coverage">{t("rpo.map_coverage", { n: formatValue(data.meta.located, "number", locale), total: formatValue(data.meta.registered, "number", locale) })}</span> : undefined}>
            {zones.length === 0 ? <EmptyState title={t("rpf.no_data")} hint={t("rpo.map_empty")} /> : (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="min-w-0 overflow-hidden rounded-2xl"><GeoMap zones={mapZones} selectedId={selected} onSelect={setSelected} tileUrl={TILE_URL} label={t("rpo.c_map")} /></div>
                <div className="min-w-0 space-y-4">
                  {sel && (
                    <div className="rounded-xl border border-accent/40 bg-bg2 p-3 text-sm" data-testid="geo-selected">
                      <p className="ltr-num font-semibold">{sel.zone}</p>
                      {sel.city && <p className="text-xs text-muted">{dimKey("city", sel.city, t, cityName)}</p>}
                      <p className="mt-1.5"><span className="ltr-num font-semibold">{formatValue(sel.parcels, "number", locale)}</span> {t("rpo.unit_parcels")} · {t("rpo.col_success")}: <span className="ltr-num">{sel.successRate == null ? "—" : fmtPercent(sel.successRate, locale, 0)}</span></p>
                    </div>
                  )}
                  <section aria-label={t("rpo.c_busiest_zones")} data-testid="rk-zones" className="rounded-xl border border-line">
                    <div className="border-b border-line px-3 py-2"><h3 className="text-sm font-semibold">{t("rpo.c_busiest_zones")}</h3><p className="text-xs text-muted">{t("rpo.c_busiest_zones_hint")}</p></div>
                    <ol className="max-h-80 divide-y divide-line/70 overflow-y-auto">
                      {zones.slice(0, 12).map((z, i) => (
                        <li key={z.id}>
                          <button type="button" aria-pressed={z.id === selected} data-testid="zone-item" onClick={() => setSelected(z.id === selected ? null : z.id)} className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm transition hover:bg-bg2/60", z.id === selected && "bg-accent/10")}>
                            <span className="ltr-num w-5 shrink-0 text-xs tabular-nums text-muted">{i + 1}</span>
                            <span className="min-w-0 flex-1"><span className="ltr-num block truncate font-medium" dir="ltr">{z.zone}</span>{z.city && <span className="block truncate text-xs text-muted">{dimKey("city", z.city, t, cityName)}</span>}</span>
                            <span className="ltr-num shrink-0 font-semibold tabular-nums">{formatValue(z.parcels, "number", locale)}</span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </section>
                </div>
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 text-[11px] text-muted" aria-hidden>
              <span>{t("rpf.hm_less")}</span><span className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(to right, color-mix(in srgb, var(--jr-accent) 14%, transparent), var(--jr-accent))" }} /><span>{t("rpf.hm_more")}</span>
              <span className="ms-auto inline-flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm border-2 border-danger" />{t("rpo.map_hot")}</span>
            </div>
          </Section>
        </section>
      ) : <CardFailed title={t("rpo.c_map")} onRetry={retry} testId="geo-zones" />}
      <DrillTable testId="drill-zones" report="geography" name="zones" qs={qs} />
    </>
  );
}
