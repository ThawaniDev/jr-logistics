"use client";
import { Suspense, use, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Car, KeyRound, Package } from "lucide-react";
import { Badge, Breadcrumbs, Button, DetailHeader, ErrorState, PageLoading, StatusBadge, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { Timeline } from "@/components/features/timeline";
import { post } from "@/lib/api";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser, hasPerm } from "@/components/layout/auth-context";
import { ShipmentsPanel } from "@/components/features/admin-shipments";
import { hasAny } from "@/components/features/admin-common";
import { RouteText } from "@/components/features/admin-ops-requests";
import { BusinessSection, DetailsSection, DriversSection, FinancialsSection } from "@/components/features/admin-ops-request-parts";
import { AssignModal, CancelModal } from "@/components/features/admin-ops-request-actions";
import { LIVE_REQUEST_STATUSES } from "@/components/features/admin-ops-lib";

export default function AdminRequest({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<PageLoading />}><Inner params={params} /></Suspense>;
}

const SERVICE_ICON = { delivery_driver: Package, car_with_driver: Car, car_without_driver: KeyRound } as const;

function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n(); const a = useAction(); const me = useUser(); const sp = useSearchParams();
  const { data, error, mutate } = useApi(`/requests/${id}`, { refreshInterval: 20000 });
  const [modal, setModal] = useState<null | "assign" | "cancel">(null);
  const biz = useApi(data?.request?.businessId && hasPerm(me, "users.view") ? `/admin/users/${data.request.businessId}` : null, { shouldRetryOnError: false });
  const crumbs = [{ label: t("nav.requests"), href: "/admin/requests" }, { label: data?.request?.ref ?? "…" }];
  if (error) return <><Breadcrumbs items={crumbs} /><ErrorState error={error} retry={() => mutate()} /></>;
  if (!data) return <PageLoading />;
  const r = data.request; const live = (LIVE_REQUEST_STATUSES as readonly string[]).includes(r.status);
  const can = (p: string) => hasPerm(me, p);
  const open = ["published", "filling"].includes(r.status);
  const Icon = SERVICE_ICON[r.service as keyof typeof SERVICE_ICON] ?? Package;
  const run = (key: string, path: string) => a.run(key, () => post(path), { success: "common.saved", onDone: () => mutate() });
  const full = r.slotsFilled >= r.quantity;
  return (
    <>
      <Breadcrumbs items={crumbs} />
      <DetailHeader
        name={r.ref}
        avatar={<span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent" aria-hidden><Icon className="size-7" /></span>}
        badges={<><StatusBadge status={r.status} /><Badge tone="info">{t(`svc.${r.service}`)}</Badge></>}
        subtitle={<RouteText from={r.pickupCity} to={r.deliveryCity} />}
        facts={[
          { label: t("req.slots"), value: <span className="ltr-num tabular-nums"><span className={full ? "text-accent" : "text-gold"}>{r.slotsFilled}</span>/{r.quantity}</span> },
          { label: t("req.starts"), value: fmtDateTime(r.startsAt, locale) },
          { label: t("req.total"), value: <span className="ltr-num">{fmtMoney(r.totalCents, locale)}</span> },
          { label: t("wizard.vehicle"), value: r.vehicleType ? t(`vehicle.${r.vehicleType}`) : "—" },
        ]}
        actions={<>
          {open && can("requests.assign") && <Button size="sm" data-testid="admin-req-assign" onClick={() => setModal("assign")}>{t("admin.assign_driver")}</Button>}
          {open && hasAny(me, "replacements.manage", "requests.assign") && <Button size="sm" variant="secondary" data-testid="admin-req-rematch" loading={a.is("rm")} onClick={() => run("rm", `/admin/requests/${id}/rematch`)}>{t("ops.rematch")}</Button>}
          {can("requests.edit") && r.status === "confirmed" && r.service === "car_without_driver" && <Button size="sm" data-testid="admin-req-fulfil" loading={a.is("fr")} onClick={() => run("fr", `/admin/requests/${id}/fulfil-rental`)}>{t("admin.fulfil_rental")}</Button>}
          {can("requests.edit") && live && <Button size="sm" variant="danger" data-testid="admin-req-cancel" onClick={() => setModal("cancel")}>{t("req.cancel")}</Button>}
        </>}
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><DriversSection data={data} onDone={() => mutate()} onAssign={open && can("requests.assign") ? () => setModal("assign") : undefined} /></div>
        <div className="space-y-4">
          <DetailsSection data={data} />
          <BusinessSection requestId={id} businessId={r.businessId} biz={biz} />
          <FinancialsSection r={r} />
        </div>
      </div>
      {data.manifest && <ShipmentsPanel requestId={id} initialQuery={sp.get("parcel") ?? ""} />}
      <Timeline events={data.timeline} />
      <AssignModal requestId={id} open={modal === "assign"} onClose={() => setModal(null)} onDone={() => mutate()} />
      <CancelModal requestId={id} open={modal === "cancel"} onClose={() => setModal(null)} onDone={() => mutate()} />
    </>
  );
}
