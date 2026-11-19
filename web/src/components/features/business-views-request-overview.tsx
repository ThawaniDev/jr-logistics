"use client";
import { Clock, PackageCheck, PackageX, Users, Wallet } from "lucide-react";
import { InfoGrid, Notice, Section, Stat, StatGrid } from "@/components/ui";
import { DriversSection } from "./business-views-request-drivers";
import { useRequest } from "./business-views-request-ctx";
import { fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

/** The order's facts as a label / value list (everything the wizard asked). */
function OrderDetails() {
  const { t, locale } = useI18n(); const { r, manifest, ship } = useRequest();
  const dash = "—";
  const items: Array<{ label: string; value: React.ReactNode }> = [
    ...(r.shipmentsPerDriver ? [{ label: t("wizard.shipments_per_driver"), value: <span className="ltr-num">{fmtNum(r.shipmentsPerDriver, locale)}</span> }] : []),
    { label: t("wizard.pickup_address"), value: r.pickupAddress ?? dash },
    manifest ? { label: t("bs.stops"), value: ship ? t("bs.stops_in_city", { n: fmtNum(ship.total, locale), city: t(`city.${r.deliveryCity}`) }) : dash } : { label: t("wizard.delivery_address"), value: r.deliveryAddress ?? dash },
    ...(r.title ? [{ label: t("bz.title"), value: r.title }] : []),
    ...(!manifest && r.recipientName ? [{ label: t("wizard.recipient_name"), value: r.recipientName }] : []),
    ...(!manifest && r.recipientPhone ? [{ label: t("wizard.recipient_phone"), value: <span className="ltr-num" dir="ltr">{r.recipientPhone}</span> }] : []),
    ...(!manifest && r.contents ? [{ label: t("wizard.contents"), value: r.contents }] : []),
    ...(r.notes ? [{ label: t("bz.notes"), value: <span className="whitespace-pre-line">{r.notes}</span> }] : []),
  ];
  return <Section title={t("rdz.order_details")} className="lg:sticky lg:top-24"><InfoGrid cols={1} items={items} /></Section>;
}

/** Overview: where the order stands (KPIs), the drivers with every action, and the order's facts. */
export function RequestOverview() {
  const { t, locale } = useI18n(); const { base, r, data, manifest, ship, undelivered } = useRequest();
  const counts = ship?.counts ?? {};
  const delivered = counts.delivered ?? 0, failed = counts.failed ?? 0, total = ship?.total ?? 0, inTransit = (counts.loaded ?? 0);
  const priced = !!r.pricingSnapshot;
  return (
    <div className="space-y-5">
      <StatGrid cols={4}>
        <Stat label={t("req.drivers")} value={<span className="ltr-num">{r.slotsFilled}/{r.quantity}</span>} hint={data.offeredCount > 0 ? t("req.waiting_offers", { n: data.offeredCount }) : r.slotsFilled >= r.quantity ? t("rdz.k_drivers_full") : t("rdz.k_drivers_open")} icon={<Users className="size-5" />} tone="cyan" />
        {manifest ? (
          <>
            <Stat label={t("rdz.k_parcels_delivered")} value={<span className="ltr-num">{fmtNum(delivered, locale)}/{fmtNum(total, locale)}</span>} hint={inTransit > 0 ? t("rdz.k_in_transit", { n: fmtNum(inTransit, locale) }) : t("rdz.k_parcels_hint")} icon={<PackageCheck className="size-5" />} href={`${base}/parcels?status=delivered`} loading={!ship} />
            <Stat label={t("rdz.k_failed")} value={fmtNum(failed, locale)} hint={undelivered > 0 ? t("rdz.k_not_delivered", { n: fmtNum(undelivered, locale) }) : t("rdz.k_none_failed")} icon={<PackageX className="size-5" />} tone={failed > 0 ? "danger" : "muted"} href={`${base}/parcels?status=failed`} loading={!ship} />
          </>
        ) : (
          <Stat label={t("wizard.days")} value={<span className="ltr-num">{fmtNum(r.durationDays, locale)}</span>} hint={t("rdz.k_duration_hint")} icon={<Clock className="size-5" />} />
        )}
        <Stat label={t("req.total")} value={<span className="ltr-num">{priced ? fmtMoney(r.totalCents, locale) : "—"}</span>} hint={priced ? t("rdz.k_reserved_hint", { amount: fmtMoney(r.reservedCents, locale) }) : t("req.no_price_yet")} icon={<Wallet className="size-5" />} tone="gold" href={`${base}/money`} />
      </StatGrid>

      {r.status === "confirmed" && r.service === "car_without_driver" && <Notice tone="info">{t("req.rental_note")}</Notice>}
      {manifest && r.status !== "draft" && data.unassignedParcels > 0 && <Notice tone="warn" title={t("bs.unassigned_title")}>{t("bs.unassigned_body", { n: fmtNum(data.unassignedParcels, locale) })}</Notice>}
      {manifest && r.allowPartial === false && ["draft", "published", "filling"].includes(r.status) && <Notice tone="info">{t("bs.all_or_nothing_note")}</Notice>}
      {manifest && r.status !== "draft" && undelivered > 0 && <Notice tone="info">{t("bs.reship_hint", { n: fmtNum(undelivered, locale) })}</Notice>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2"><DriversSection /></div>
        <div className="min-w-0"><OrderDetails /></div>
      </div>
    </div>
  );
}
