"use client";
import { MapPin } from "lucide-react";
import { Badge, Card, EmptyState, ErrorState, Notice, PageHeader, PageLoading } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

// Saudi Arabia bounding box for a dependency-free plot (map provider is an open owner decision).
const BOX = { minLat: 16, maxLat: 33, minLng: 34, maxLng: 56 };
export default function LiveMap() {
  const { t, locale } = useI18n();
  const { data, error, mutate } = useApi("/admin/ops/map", { refreshInterval: 20000 }); const { data: cat } = useApi("/catalog");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data || !cat) return <PageLoading />;
  const pos = (lat: number, lng: number) => ({ left: `${((lng - BOX.minLng) / (BOX.maxLng - BOX.minLng)) * 100}%`, top: `${(1 - (lat - BOX.minLat) / (BOX.maxLat - BOX.minLat)) * 100}%` });
  return (
    <>
      <PageHeader title={t("nav.live_map")} subtitle={t("map.sub")} actions={<Badge tone="info">{t("map.count", { n: data.items.length })}</Badge>} />
      <div className="mb-4"><Notice tone="info">{t("map.privacy")}</Notice></div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="relative aspect-[4/3] overflow-hidden p-0" aria-label={t("nav.live_map")}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,var(--jr-card),var(--jr-bg))]" />
          {cat.cities.map((c: any) => <span key={c.key} className="absolute -translate-x-1/2 -translate-y-1/2 text-[10px] text-muted" style={pos(c.lat, c.lng)}>• {c[locale]}</span>)}
          {data.items.map((d: any) => <span key={d.id} title={d.name} className={`absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ${d.status === "on_job" ? "bg-gold ring-gold/30" : "bg-accent ring-accent/30"}`} style={pos(d.lat, d.lng)} />)}
        </Card>
        <Card className="max-h-[480px] space-y-2 overflow-y-auto">
          {data.items.length === 0 ? <EmptyState icon={<MapPin className="size-9" />} title={t("map.none")} /> : data.items.map((d: any) => <div key={d.id} className="flex items-center justify-between rounded-xl bg-bg2 px-3 py-2 text-sm"><div><p className="font-medium">{d.name}</p><p className="text-xs text-muted">{fmtTime(d.updatedAt, locale)}</p></div><Badge tone={d.status === "on_job" ? "warn" : "success"}>{t(`map.${d.status}`)}</Badge></div>)}
        </Card>
      </div>
    </>
  );
}
