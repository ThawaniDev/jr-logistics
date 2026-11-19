"use client";
import { Suspense, useState } from "react";
import { Building2, CircleDot, RefreshCw, Truck, UserCheck } from "lucide-react";
import { Badge, Button, ErrorState, Notice, PageHeader, PageLoading, SearchBox, Segmented, Select, Stat, StatGrid, Toolbar } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { fmtTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useCityNames } from "@/components/features/admin-common";
import { DriverList, MapCanvas } from "@/components/features/admin-ops-map";
import { driverStats, filterDrivers, type MapDriver } from "@/components/features/admin-ops-lib";

function Inner() {
  const { t, locale } = useI18n(); const { name: cityName } = useCityNames();
  const [stamp, setStamp] = useState<Date | null>(null);
  const [status, setStatus] = useUrlState("status"); const [city, setCity] = useUrlState("city");
  const [q, setQ] = useState(""); const [selected, setSelected] = useState<string | null>(null);
  const { data, error, mutate, isValidating } = useApi<{ items: MapDriver[] }>("/admin/ops/map", { refreshInterval: 20000, onSuccess: () => setStamp(new Date()) });
  const cat = useApi<{ cities: any[] }>("/catalog");
  if (error || cat.error) return <><PageHeader title={t("nav.live_map")} subtitle={t("map.sub")} /><ErrorState error={error ?? cat.error} retry={() => { mutate(); cat.mutate(); }} /></>;
  if (!data || !cat.data) return <PageLoading />;
  const all = data.items; const st = driverStats(all);
  const cityKeys = [...new Set(all.map((d) => d.city).filter(Boolean))] as string[];
  const shown = filterDrivers(all, { status, city, q });
  const filtered = !!(status || city || q.trim());
  return (
    <>
      <PageHeader title={t("nav.live_map")} subtitle={t("map.sub")} badges={<Badge tone="info">{t("map.count", { n: st.total })}</Badge>} actions={<>
        {stamp && <span className="text-xs text-muted" aria-live="polite">{t("rda.updated_at", { time: fmtTime(stamp, locale) })}</span>}
        <Button variant="secondary" size="sm" loading={isValidating} onClick={() => mutate()} data-testid="admin-map-refresh"><RefreshCw className="size-4" aria-hidden />{t("rda.refresh")}</Button>
      </>} />
      <section aria-label={t("rda.at_a_glance")} className="mb-5">
        <StatGrid>
          <Stat label={t("rda.drivers_online")} value={st.total} icon={<Truck className="size-5" />} tone="cyan" hint={t("rda.sharing_hint")} />
          <Stat label={t("map.available")} value={st.available} icon={<UserCheck className="size-5" />} tone="accent" hint={t("rda.available_hint")} />
          <Stat label={t("map.on_job")} value={st.onJob} icon={<CircleDot className="size-5" />} tone="gold" hint={t("rda.on_job_hint")} />
          <Stat label={t("rda.cities_covered")} value={st.cities} icon={<Building2 className="size-5" />} tone="muted" hint={filtered ? t("rda.map_shown", { n: shown.length, total: st.total }) : undefined} />
        </StatGrid>
      </section>
      <div className="mb-4"><Notice tone="info">{t("map.privacy")}</Notice></div>
      <Toolbar>
        <Segmented label={t("common.status")} value={status} onChange={setStatus} options={[{ key: "", label: t("common.all"), count: st.total }, { key: "available", label: t("map.available"), count: st.available }, { key: "on_job", label: t("map.on_job"), count: st.onJob }]} />
        <div className="w-44"><Select aria-label={t("wizard.pickup_city")} placeholder={t("rda.all_cities")} options={cityKeys.map((k) => ({ value: k, label: cityName(k) }))} value={city} onChange={(e) => setCity(e.target.value)} /></div>
        <SearchBox value={q} onChange={setQ} label={t("rda.search_driver")} placeholder={t("rda.search_driver")} />
      </Toolbar>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <MapCanvas drivers={shown} cities={cat.data.cities} selected={selected} onSelect={setSelected} />
        <DriverList drivers={shown} selected={selected} onSelect={setSelected} />
      </div>
    </>
  );
}
export default function LiveMap() { return <Suspense fallback={<PageLoading />}><Inner /></Suspense>; }
