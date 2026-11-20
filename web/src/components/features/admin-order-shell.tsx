"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Car, KeyRound, Package, PackageX } from "lucide-react";
import { Badge, Breadcrumbs, Button, DetailHeader, EmptyState, ErrorState, LinkTabs, PageHeader, PageLoading, StatusBadge, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError, post } from "@/lib/api";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { hasAny, useTx } from "./admin-common";
import { RouteText } from "./admin-ops-requests";
import { AssignModal, CancelModal } from "./admin-ops-request-actions";
import { LIVE_REQUEST_STATUSES } from "./admin-ops-lib";
import { OrderProvider, useRefreshOrder } from "./admin-order-ctx";
import { OrderKpis } from "./admin-order-kpis";
import { orderTabHref, orderTabs, type OrderTab } from "./admin-order-lib";

const SERVICE_ICON = { delivery_driver: Package, car_with_driver: Car, car_without_driver: KeyRound } as const;

/** Shown when the id in the URL is not an order (or not one the viewer may open). */
export function NotAnOrder() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("dv1.order_not_found")} breadcrumbs={[{ label: t("nav.requests"), href: "/admin/requests" }, { label: t("dv1.order_not_found") }]} />
      <div data-testid="dv1-order-not-found"><EmptyState icon={<PackageX className="size-9" aria-hidden />} title={t("dv1.order_not_found")} hint={t("dv1.order_not_found_hint")} action={<Link href="/admin/requests"><Button variant="secondary">{t("dv1.back_to_orders")}</Button></Link>} /></div>
    </>
  );
}

/** The frame of every order view: breadcrumbs, header with state, flags, key facts and the staff actions, the KPI strip and the section tabs (each its own route). */
export function OrderShell({ id, children }: { id: string; children: ReactNode }) {
  const { t, locale } = useI18n(); const me = useUser(); const a = useAction(); const tx = useTx(); const path = usePathname();
  const { data, error, mutate } = useApi(`/admin/requests/${id}/overview`, { refreshInterval: 20000, shouldRetryOnError: false });
  const refresh = useRefreshOrder(id);
  const [modal, setModal] = useState<null | "assign" | "cancel">(null);
  const crumbs = [{ label: t("nav.requests"), href: "/admin/requests" }, { label: data?.request?.ref ?? "…" }];
  if (error) return error instanceof ApiError && error.code === "NOT_FOUND" ? <NotAnOrder /> : <><Breadcrumbs items={crumbs} /><ErrorState error={error} retry={() => mutate()} /></>;
  if (!data) return <PageLoading />;
  const r = data.request, f = data.flags, k = data.kpis;
  const can = (p: string) => hasPerm(me, p);
  const live = (LIVE_REQUEST_STATUSES as readonly string[]).includes(r.status), open = ["published", "filling"].includes(r.status);
  const Icon = SERVICE_ICON[r.service as keyof typeof SERVICE_ICON] ?? Package;
  const canCompany = hasAny(me, "users.view", "verification.manage", "offices.view");
  const run = (key: string, path: string) => a.run(key, () => post(path), { success: "common.saved", onDone: () => void refresh() });
  const full = r.slotsFilled >= r.quantity;
  const labels: Record<OrderTab, string> = { overview: t("dv1.tab_overview"), drivers: t("dv1.tab_drivers"), parcels: t("dv1.tab_parcels"), money: t("dv1.tab_money"), communication: t("dv1.tab_comms"), activity: t("dv1.tab_activity") };
  const count: Partial<Record<OrderTab, number>> = { drivers: data.funnel.offered, parcels: k.parcels.total };
  const tabs = orderTabs(can, f.manifest).map((x) => ({ href: orderTabHref(id, x), label: labels[x], count: count[x] || undefined }));
  const company = canCompany ? <Link href={`/admin/companies/${data.company.id}`} className="text-accent hover:underline" data-testid="dv1-company-link">{data.company.name}</Link> : data.company.name;
  return (
    <OrderProvider value={{ id, data, refresh, openModal: setModal }}>
      <Breadcrumbs items={crumbs} />
      <DetailHeader
        name={r.ref}
        avatar={<span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent" aria-hidden><Icon className="size-7" /></span>}
        badges={<>
          <StatusBadge status={r.status} /><Badge tone="info">{t(`svc.${r.service}`)}</Badge>
          {f.allOrNothing && <span data-testid="dv1-flag-all-or-nothing"><Badge tone="warn">{t("shipadm.all_or_nothing")}</Badge></span>}
          {f.detailsLater && <span data-testid="dv1-flag-details-later"><Badge tone="warn">{t("dv1.flag_details_later")}</Badge></span>}
          {f.partnerCreated && <span data-testid="dv1-flag-partner"><Badge tone="info">{t("dv1.flag_partner")}</Badge></span>}
          <span data-testid="dv1-flag-via"><Badge>{tx(`dv1.via_${f.createdVia}`, f.createdVia)}</Badge></span>
        </>}
        subtitle={<span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1"><RouteText from={r.pickupCity} to={r.deliveryCity} /><span aria-hidden className="text-line">•</span>{company}</span>}
        facts={[
          { label: t("req.slots"), value: <span className="ltr-num tabular-nums"><span className={full ? "text-accent" : "text-gold"}>{r.slotsFilled}</span>/{r.quantity}</span> },
          { label: t("req.starts"), value: <>{fmtDateTime(r.startsAt, locale)}{r.service !== "delivery_driver" && <span className="text-muted"> · {t("dv1.duration_days", { n: fmtNum(r.durationDays, locale) })}</span>}</> },
          { label: t("req.total"), value: <span className="ltr-num">{fmtMoney(r.totalCents, locale)}</span> },
          { label: t("wizard.vehicle"), value: r.vehicleType ? <>{t(`vehicle.${r.vehicleType}`)}{r.temperature && <span className="text-muted"> · {tx(`temp.${r.temperature}`, r.temperature)}</span>}</> : "—" },
          { label: t("dv1.fact_created"), value: fmtDateTime(r.createdAt, locale) },
          { label: t("dv1.fact_published"), value: r.publishedAt ? fmtDateTime(r.publishedAt, locale) : "—" },
          { label: t("req.ref"), value: <span className="ltr-num">{r.ref}</span> },
          { label: t("role.business"), value: <>{company}{data.company.phone && <span className="ltr-num text-muted"> · {data.company.phone}</span>}</> },
        ]}
        actions={<>
          {open && can("requests.assign") && <Button size="sm" data-testid="admin-req-assign" onClick={() => setModal("assign")}>{t("admin.assign_driver")}</Button>}
          {open && hasAny(me, "replacements.manage", "requests.assign") && <Button size="sm" variant="secondary" data-testid="admin-req-rematch" loading={a.is("rm")} onClick={() => run("rm", `/admin/requests/${id}/rematch`)}>{t("ops.rematch")}</Button>}
          {can("requests.edit") && r.status === "confirmed" && r.service === "car_without_driver" && <Button size="sm" data-testid="admin-req-fulfil" loading={a.is("fr")} onClick={() => run("fr", `/admin/requests/${id}/fulfil-rental`)}>{t("admin.fulfil_rental")}</Button>}
          {can("requests.edit") && live && <Button size="sm" variant="danger" data-testid="admin-req-cancel" onClick={() => setModal("cancel")}>{t("req.cancel")}</Button>}
        </>}
      />
      {r.status === "cancelled" && r.cancelReason && <p className="-mt-2 mb-5 rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger" data-testid="dv1-cancel-reason">{t("dv1.cancel_reason", { reason: r.cancelReason })}</p>}
      <OrderKpis kpis={k} expanded={path === orderTabHref(id, "overview")} />
      <LinkTabs label={r.ref} tabs={tabs} />
      {children}
      <AssignModal requestId={id} open={modal === "assign"} onClose={() => setModal(null)} onDone={() => void refresh()} />
      <CancelModal requestId={id} open={modal === "cancel"} onClose={() => setModal(null)} onDone={() => void refresh()} />
    </OrderProvider>
  );
}
