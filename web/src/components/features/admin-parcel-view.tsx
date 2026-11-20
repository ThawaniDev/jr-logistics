"use client";
import Link from "next/link";
import { AlertCircle, PackageX } from "lucide-react";
import { Badge, Breadcrumbs, Button, DetailHeader, EmptyState, ErrorState, PageHeader, PageLoading, Stat, StatGrid } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDur } from "@/components/reports/chartTheme";
import { ApiError } from "@/lib/api";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { ActivityLog } from "./activity-log";
import { RawDataPanel } from "./activity-raw";
import { NotesPanel } from "./notes-panel";
import { CopyButton, LinkButton, hasAny, useCityNames } from "./admin-common";
import { ParcelAttempts, ParcelJourney } from "./admin-parcel-journey";
import { ParcelEvidence } from "./admin-parcel-evidence";
import { ParcelCod, ParcelOtp, ParcelPartner, ParcelRecipient, ParcelRoute, ParcelSimilar } from "./admin-parcel-info";
import { PIN_FLAG_M, ShipStatusBadge } from "./admin-shipments";

function NotAParcel() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("dv1.parcel_not_found")} breadcrumbs={[{ label: t("nav.requests"), href: "/admin/requests" }, { label: t("dv1.parcel_not_found") }]} />
      <div data-testid="dv1-parcel-not-found"><EmptyState icon={<PackageX className="size-9" aria-hidden />} title={t("dv1.parcel_not_found")} hint={t("dv1.parcel_not_found_hint")} action={<Link href="/admin/requests"><Button variant="secondary">{t("dv1.back_to_orders")}</Button></Link>} /></div>
    </>
  );
}

/** One parcel, completely: header with the links to its order, company and driver, key figures, the journey with elapsed times, the visits, the evidence, the recipient and the delivery location, codes and messages, cash, route leg, partner sync, similar parcels, the shared activity log, notes and the raw record. */
export function ParcelView({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const { name: cityName } = useCityNames();
  const { data: d, error, mutate } = useApi(`/admin/shipments/${id}/detail`, { refreshInterval: 30000, shouldRetryOnError: false });
  if (error) return error instanceof ApiError && (error.code === "NOT_FOUND" || error.code === "VALIDATION") ? <NotAParcel /> : <><PageHeader title={t("dv1.parcel_view")} breadcrumbs={[{ label: t("nav.requests"), href: "/admin/requests" }]} /><ErrorState error={error} retry={() => mutate()} /></>;
  if (!d) return <PageLoading />;
  const p = d.parcel, r = d.request, loc = d.location;
  const canCompany = hasAny(me, "users.view", "verification.manage", "offices.view"), canDriver = hasPerm(me, "drivers.view");
  const end = p.deliveredAt ?? p.failedAt ?? p.returnedAt;
  const handover = p.loadedAt && end ? Math.max(0, (new Date(end).getTime() - new Date(p.loadedAt).getTime()) / 1000) : null;
  const far = typeof loc.distanceM === "number" && loc.distanceM > PIN_FLAG_M;
  const link = (href: string, text: string, testId: string) => <Link href={href} className="text-accent hover:underline" data-testid={testId}>{text}</Link>;
  return (
    <>
      <Breadcrumbs items={[{ label: t("nav.requests"), href: "/admin/requests" }, { label: r.ref, href: `/admin/requests/${r.id}/parcels` }, { label: p.code }]} />
      <DetailHeader
        name={p.code}
        avatar={<span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-cyan/10 text-cyan" aria-hidden><span className="ltr-num text-lg font-bold">#{p.seq}</span></span>}
        badges={<>
          <ShipStatusBadge status={p.status} /><Badge tone={p.recipientType === "business" ? "info" : "neutral"}>{t(`rtype.${p.recipientType}`)}</Badge>
          {!p.detailsComplete && <Badge tone="warn"><AlertCircle className="size-3" aria-hidden />{t("pb.details_missing")}</Badge>}
          {d.partner?.connected && <Badge tone="info">{t("dv1.flag_partner")}</Badge>}
        </>}
        subtitle={<span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">{p.externalRef && <span className="ltr-num">{t("uxa.col_order_ref")}: {p.externalRef}</span>}<CopyButton value={p.code} label={t("dv1.copy_code")} /></span>}
        facts={[
          { label: t("dv1.fact_order"), value: link(`/admin/requests/${r.id}`, r.ref, "dv1-parcel-order-link") },
          { label: t("role.business"), value: canCompany ? link(`/admin/companies/${r.businessId}`, r.businessName ?? "—", "dv1-parcel-company-link") : r.businessName ?? "—" },
          { label: t("shipadm.col_driver"), value: d.offer ? (canDriver ? link(`/admin/drivers/${d.offer.driverId}`, d.offer.driverName, "dv1-parcel-driver-link") : d.offer.driverName) : t("dv1.no_driver") },
          { label: t("dv1.fact_service"), value: t(`svc.${r.service}`) },
          { label: t("reg.city"), value: cityName(d.recipient.city) },
          { label: t("dv1.fact_created"), value: fmtDateTime(p.createdAt, locale) },
          { label: t("dv1.fact_updated"), value: fmtDateTime(p.updatedAt, locale) },
          { label: t("req.starts"), value: fmtDateTime(r.startsAt, locale) },
        ]}
        actions={<><LinkButton size="sm" href={`/admin/requests/${r.id}`} data-testid="dv1-parcel-open-order">{t("dv1.open_order")}</LinkButton><LinkButton size="sm" href={`/admin/requests/${r.id}/parcels?q=${encodeURIComponent(p.code)}`} data-testid="dv1-parcel-open-manifest">{t("dv1.open_manifest")}</LinkButton></>}
      />
      <StatGrid cols={6} className="mb-5">
        <Stat label={t("dv1.pk_attempts")} value={<span className="ltr-num">{fmtNum(p.attempts, locale)}</span>} tone={p.attempts > 1 ? "gold" : "accent"} hint={t("dv1.pk_defers", { n: p.deferCount })} />
        <Stat label={t("dv1.pk_handover")} value={<span className="ltr-num">{handover == null ? "—" : fmtDur(handover, locale)}</span>} tone="cyan" hint={t("dv1.pk_handover_hint")} />
        <Stat label={t("dv1.pk_door")} value={<span className="ltr-num">{d.route.dwellS == null ? "—" : fmtDur(d.route.dwellS, locale)}</span>} tone="muted" hint={t("dv1.pk_door_hint")} />
        <Stat label={t("dv1.pk_pin")} value={<span className="ltr-num">{loc.distanceM == null ? "—" : `${fmtNum(Math.round(loc.distanceM), locale)} m`}</span>} tone={far ? "danger" : "muted"} hint={far ? t("dv1.pk_pin_far", { n: PIN_FLAG_M }) : t("dv1.pk_pin_hint")} />
        <Stat label={t("dv1.pk_codes")} value={<span className="ltr-num">{d.otp.sentEvents}</span>} tone={d.otp.failedEvents > 0 ? "gold" : "muted"} hint={t("dv1.pk_codes_hint", { n: d.otp.failedEvents })} />
        <Stat label={t("dv1.pk_cod")} value={<span className="ltr-num">{p.status === "delivered" || d.cod.dueCents > 0 ? fmtMoney(d.cod.collectedCents ?? 0, locale) : "—"}</span>} tone="gold" hint={d.cod.dueCents > 0 ? t("dv1.pk_cod_due", { amount: fmtMoney(d.cod.dueCents, locale) }) : t("dv1.pk_no_cod")} />
      </StatGrid>
      {p.status === "failed" && p.failReason && <p className="mb-5 rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger" data-testid="dv1-parcel-fail">{t("dv1.parcel_failed", { reason: t(`stopfail.${p.failReason}`) === `stopfail.${p.failReason}` ? p.failReason : t(`stopfail.${p.failReason}`), note: p.failNote ?? "—" })}</p>}
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2"><ParcelJourney events={d.journey} code={p.code} /><ParcelAttempts attempts={d.attempts} /><ParcelEvidence id={p.id} code={p.code} hasProof={p.hasProof && p.proofType === "receipt"} receiverName={p.receiverName} media={d.media} /></div>
        <div className="space-y-4"><ParcelRecipient d={d} /><ParcelOtp d={d} /><ParcelCod d={d} /><ParcelRoute d={d} /><ParcelPartner d={d} /><ParcelSimilar d={d} /></div>
      </div>
      <div className="space-y-5">
        <ActivityLog entity="shipment" id={p.id} />
        <NotesPanel entity="shipment" id={p.id} />
        <RawDataPanel data={{ ...p, request: r, offer: d.offer, location: loc, otp: d.otp, route: d.route, partner: d.partner }} title={t("dv1.raw_title")} />
      </div>
    </>
  );
}
