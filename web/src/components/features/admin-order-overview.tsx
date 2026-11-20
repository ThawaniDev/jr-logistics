"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Notice, Section } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { BreakdownTable, DonutChart, HistogramChart, seriesColor, fmtDur } from "@/components/reports";
import { fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { ActivityLog } from "./activity-log";
import { useOrder } from "./admin-order-ctx";
import { MilestoneList } from "./admin-order-milestones";
import { OrderMap, type MapPoint, type MapTone } from "./admin-order-map-view";
import { BusinessSection, DetailsSection, FinancialsSection } from "./admin-ops-request-parts";

const SEVERITY = { critical: "danger", warning: "warn", info: "info" } as const;
const TARGET: Record<string, (id: string) => string | null> = {
  unfilled: (id) => `/admin/requests/${id}/drivers`, driver_late: (id) => `/admin/requests/${id}/drivers`, no_coords: (id) => `/admin/requests/${id}/parcels`,
  unassigned: (id) => `/admin/requests/${id}/parcels?offerId=none`, details_missing: (id) => `/admin/requests/${id}/parcels?incomplete=1`, returns_pending: (id) => `/admin/requests/${id}/parcels?status=failed`,
  cod_outstanding: (id) => `/admin/requests/${id}/money`,
};
const STATUS_TONE: Record<string, MapTone> = { delivered: "accent", loaded: "gold", pending: "muted", failed: "danger", returned: "danger", missing: "danger", cancelled: "muted" };
const SLICE_COLOR: Record<string, string> = { delivered: seriesColor(0), loaded: seriesColor(4), pending: seriesColor(7), failed: seriesColor(3), returned: seriesColor(1), missing: seriesColor(6), cancelled: seriesColor(2) };

/** What deserves attention on this order right now, most severe first, each with a link to where it is handled. */
function Alerts({ items, id }: { items: Array<{ key: string; severity: "critical" | "warning" | "info"; params: Record<string, number> }>; id: string }) {
  const { t, locale } = useI18n(); const me = useUser();
  if (!items.length) return <p className="mb-5 rounded-xl border border-accent/30 bg-accent/10 px-4 py-2.5 text-sm text-accent" data-testid="dv1-alerts-clear">{t("dv1.alerts_clear")}</p>;
  return (
    <section aria-label={t("dv1.alerts_title")} className="mb-5 space-y-2" data-testid="dv1-alerts">
      {items.map((a) => {
        const href = a.key === "cod_outstanding" && !hasPerm(me, "finance.view") ? null : TARGET[a.key]?.(id) ?? null;
        return (
          <div key={a.key} data-alert={a.key} data-severity={a.severity}>
            <Notice tone={SEVERITY[a.severity]}>
              <span className="flex flex-wrap items-center justify-between gap-2"><span className="inline-flex items-center gap-2"><AlertTriangle className="size-4 shrink-0" aria-hidden />{t(`dv1.alert_${a.key}`, { ...a.params, amount: fmtMoney(a.params.cents ?? 0, locale) })}</span>
                {href && <Link href={href} className="text-sm font-medium underline-offset-2 hover:underline">{t("dv1.alert_open")}</Link>}</span>
            </Notice>
          </div>
        );
      })}
    </section>
  );
}

/** Overview: alerts, milestones with elapsed times, this order's offers funnel, parcel mix, failure reasons, delivery-time distribution and a map of the pickup pin and delivery points. */
export function OrderOverview() {
  const { t, locale } = useI18n(); const router = useRouter(); const me = useUser(); const sp = useSearchParams();
  const { id, data } = useOrder();
  // old deep links (`/admin/requests/:id?parcel=<code>`) land on the manifest with the search filled in
  const parcel = sp.get("parcel");
  useEffect(() => { if (parcel) router.replace(`/admin/requests/${id}/parcels?q=${encodeURIComponent(parcel)}`); }, [parcel, id, router]);
  const biz = useApi(data.request.businessId && hasPerm(me, "users.view") ? `/admin/users/${data.request.businessId}` : null, { shouldRetryOnError: false });
  const f = data.funnel, mix = data.parcelMix, dl = data.delivery, map = data.map;
  const offered = f.offered || 0;
  const row = (key: string, value: number, tone?: "accent" | "cyan" | "gold" | "danger") => ({ key, label: t(`dv1.funnel_${key}`), value, share: offered > 0 ? value / offered : null, tone });
  const funnel = [row("offered", f.offered, "cyan"), row("accepted", f.accepted), row("arrived", f.arrived), row("loaded", f.loaded), row("delivered", f.delivered),
    ...(["cancelled", "noShow", "replaced", "rejected", "expired"] as const).filter((k) => f[k] > 0).map((k) => row(k, f[k], "danger"))];
  const slices = Object.keys(SLICE_COLOR).map((k) => ({ key: k, label: t(`shipstatus.${k}`), value: mix[k] ?? 0, color: SLICE_COLOR[k] }));
  const failTotal = data.failureReasons.reduce((s: number, r: any) => s + r.n, 0);
  const reasons = data.failureReasons.map((r: any) => ({ key: r.reason, label: r.reason === "more" ? t("dv1.reason_more") : t(`stopfail.${r.reason}`) === `stopfail.${r.reason}` ? r.reason.replace(/_/g, " ") : t(`stopfail.${r.reason}`), value: r.n, share: failTotal > 0 ? r.n / failTotal : null, tone: "danger" as const }));
  const buckets = dl.buckets.map((b: any) => ({ label: b.to == null ? t("dv1.hist_over", { time: fmtDur(b.from, locale) }) : b.from === 0 ? t("dv1.hist_under", { time: fmtDur(b.to, locale) }) : `${fmtDur(b.from, locale)} – ${fmtDur(b.to, locale)}`, count: b.count }));
  const points: MapPoint[] = [
    ...(map.pickup ? [{ id: "pickup", lat: map.pickup.lat, lng: map.pickup.lng, tone: "cyan" as MapTone, big: true, label: t("dv1.map_pickup") }] : []),
    ...map.points.map((p: any) => ({ id: p.id, lat: p.lat, lng: p.lng, tone: STATUS_TONE[p.status] ?? "muted", label: `${p.code} · ${t(`shipstatus.${p.status}`)}` })),
  ];
  return (
    <>
      <Alerts items={data.alerts} id={id} />
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><MilestoneList items={data.milestones} closed={data.flags.closed} /></div>
        <div className="space-y-4">
          <DetailsSection data={{ request: data.request, manifest: data.flags.manifest, unassignedParcels: data.kpis.parcels.unassigned }} />
          <BusinessSection requestId={id} businessId={data.request.businessId} biz={biz} />
          <FinancialsSection r={data.request} />
        </div>
      </div>
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <BreakdownTable title={t("dv1.funnel_title")} description={t("dv1.funnel_sub")} rows={funnel} testId="dv1-funnel" />
        {data.flags.manifest && <DonutChart title={t("dv1.mix_title")} description={t("dv1.mix_sub")} slices={slices} centerLabel={t("dv1.mix_center")} testId="dv1-mix" />}
        {data.flags.manifest && <BreakdownTable title={t("dv1.reasons_title")} description={t("dv1.reasons_sub")} rows={reasons} testId="dv1-reasons" />}
        {data.flags.manifest && <HistogramChart title={t("dv1.delivery_title")} description={t("dv1.delivery_sub")} buckets={buckets} unit={t("dv1.unit_parcels")} testId="dv1-delivery"
          stats={dl.n > 0 ? <span className="ltr-num text-xs text-muted">{t("dv1.delivery_stats", { p50: dl.p50 == null ? "—" : fmtDur(dl.p50, locale), p90: dl.p90 == null ? "—" : fmtDur(dl.p90, locale) })}</span> : undefined} />}
      </div>
      {data.flags.manifest && (
        <Section title={t("dv1.map_title")} description={map.unlocated > 0 ? t("dv1.map_sub_unlocated", { n: map.located, m: map.unlocated }) : t("dv1.map_sub", { n: map.located })} className="mb-5" id="order-map">
          <OrderMap points={points} label={t("dv1.map_title")} emptyHint={t("dv1.map_empty_hint")} onSelect={(p) => { if (p.id !== "pickup") router.push(`/admin/parcels/${p.id}`); }}
            legend={[{ tone: "cyan", label: t("dv1.map_pickup") }, { tone: "accent", label: t("shipstatus.delivered") }, { tone: "gold", label: t("shipstatus.loaded") }, { tone: "muted", label: t("shipstatus.pending") }, { tone: "danger", label: t("shipstatus.failed") }]} />
        </Section>
      )}
      <ActivityLog entity="request" id={id} compact kinds={["event"]} title={t("dv1.latest_events")} />
      <p className="mt-3 text-end text-sm"><Link href={`/admin/requests/${id}/activity`} className="text-accent hover:underline" data-testid="dv1-open-activity">{t("dv1.open_activity")}</Link></p>
    </>
  );
}
