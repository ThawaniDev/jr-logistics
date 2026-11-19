"use client";
import Link from "next/link";
import { Crosshair, MapPin } from "lucide-react";
import { Badge, EmptyState, Section } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, useCityNames } from "./admin-common";
import { plotPosition, type MapDriver } from "./admin-ops-lib";

const pos = (lat: number, lng: number) => { const p = plotPosition(lat, lng); return { left: `${p.left}%`, top: `${p.top}%` }; };

/** A dependency-free plot of the drivers who shared their location (the map provider is an open owner decision). Dots are buttons: they select the driver in the list. */
export function MapCanvas({ drivers, cities, selected, onSelect }: { drivers: MapDriver[]; cities: Array<{ key: string; lat: number; lng: number; [l: string]: any }>; selected: string | null; onSelect: (id: string | null) => void }) {
  const { t, locale } = useI18n();
  return (
    <Section flush className="overflow-hidden" id="map-plot">
      <div className="relative aspect-[4/3] w-full" role="group" aria-label={t("nav.live_map")} data-testid="admin-map-canvas">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,var(--jr-card),var(--jr-bg))]" aria-hidden />
        <div className="absolute inset-0 bg-[linear-gradient(var(--jr-line)_1px,transparent_1px),linear-gradient(90deg,var(--jr-line)_1px,transparent_1px)] bg-[size:10%_10%] opacity-25" aria-hidden />
        {cities.map((c) => <span key={c.key} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] text-muted" style={pos(c.lat, c.lng)} aria-hidden>• {c[locale] ?? c.key}</span>)}
        {drivers.map((d) => {
          const on = selected === d.id;
          return (
            <button key={d.id} type="button" aria-pressed={on} aria-label={`${d.name} · ${t(`map.${d.status}`)}`} title={d.name} data-testid={`admin-map-dot-${d.id}`} onClick={() => onSelect(on ? null : d.id)}
              className={cn("absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 transition-all focus-visible:outline-2", on ? "z-20 size-4 ring-8" : "size-3 hover:size-4", d.status === "on_job" ? "bg-gold ring-gold/30" : "bg-accent ring-accent/30")} style={pos(d.lat, d.lng)} />
          );
        })}
        {drivers.length === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
            <div className="max-w-xs rounded-xl border border-line bg-card/90 px-5 py-4 text-center shadow-lg backdrop-blur" data-testid="admin-map-none"><MapPin className="mx-auto size-7 text-muted" aria-hidden /><p className="mt-1.5 font-semibold">{t("map.none")}</p><p className="mt-0.5 text-sm text-muted">{t("rda.map_none_hint")}</p></div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-5 py-3 text-xs text-muted" aria-label={t("uxa.map_legend")}>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-accent" aria-hidden />{t("map.available")}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-gold" aria-hidden />{t("map.on_job")}</span>
        <span>{t("uxa.map_fresh_note")}</span>
      </div>
    </Section>
  );
}

/** The drivers behind the dots: name (opens the driver view when the viewer may), city, last update and status. */
export function DriverList({ drivers, selected, onSelect }: { drivers: MapDriver[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const { t, locale } = useI18n(); const me = useUser(); const { name: city } = useCityNames();
  const canOpen = hasAny(me, "drivers.view");
  return (
    <Section title={t("nav.drivers")} description={t("map.count", { n: drivers.length })} flush className="max-h-[520px] overflow-hidden lg:max-h-none" id="map-drivers">
      {drivers.length === 0 ? <div className="p-5"><EmptyState icon={<MapPin className="size-9" aria-hidden />} title={t("map.none")} /></div> : (
        <ul className="max-h-[440px] divide-y divide-line/60 overflow-y-auto" data-testid="admin-map-list">
          {drivers.map((d) => (
            <li key={d.id} id={`map-driver-${d.id}`} className={cn("flex items-center justify-between gap-3 px-5 py-3 text-sm transition", selected === d.id && "bg-accent/5")}>
              <div className="min-w-0">
                <p className="truncate font-medium">{canOpen ? <Link href={`/admin/drivers/${d.id}`} className="text-accent hover:underline">{d.name}</Link> : d.name}</p>
                <p className="truncate text-xs text-muted">{d.city ? `${city(d.city)} · ` : ""}{t("uxa.map_updated", { time: fmtTime(d.updatedAt, locale) })}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={d.status === "on_job" ? "warn" : "success"}>{t(`map.${d.status}`)}</Badge>
                <button type="button" aria-pressed={selected === d.id} aria-label={t("rda.map_locate", { name: d.name })} title={t("rda.map_locate", { name: d.name })} data-testid={`admin-map-locate-${d.id}`} onClick={() => onSelect(selected === d.id ? null : d.id)}
                  className={cn("jr-tap flex size-8 items-center justify-center rounded-lg border transition", selected === d.id ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:text-ink")}><Crosshair className="size-4" aria-hidden /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
