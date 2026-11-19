"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Ban, Bike, CarFront, Car, CheckCheck, Flag, PackageX, Pencil, Rocket, Siren, Trash2 } from "lucide-react";
import { Badge, Breadcrumbs, Button, DetailHeader, ErrorState, LinkTabs, Notice, PageLoading, StatusBadge } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { WarehouseLocationNotice } from "./business-warehouse";
import { DETAILS_EDITABLE, IncompleteBanner } from "./business-shipments-complete";
import { useRefreshShipments } from "./business-shipments-table";
import type { ShipmentPage } from "./business-shipments-lib";
import { RequestDialogs, useRequestActions } from "./business-views-request-dialogs";
import { RequestProvider, UNDELIVERED, publishFields, type RequestCtx } from "./business-views-request-ctx";
import { isLive } from "./business-views-lib";
import { post } from "@/lib/api";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

const SVC_ICON = { delivery_driver: Bike, car_with_driver: CarFront, car_without_driver: Car } as const;

/**
 * The order's layout: loads it once (and again every 15 s), shows the header with every order-level action, the notices that matter on every
 * section, the section tabs (real routes) and mounts the dialogs. The sections read what they need through `useRequest()`.
 */
export function RequestShell({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n(); const router = useRouter();
  const { data, error, mutate } = useApi(`/requests/${id}`, { refreshInterval: 15000 });
  const { data: cat } = useApi("/catalog"); const { data: ov } = useApi("/business/overview");
  // Parcel counts for the tab, banners, the re-ship button and the "N stops" line (the Parcels section has its own paged query).
  const { data: ship } = useApi<ShipmentPage>(data?.manifest ? `/requests/${id}/shipments?page=1&pageSize=1` : null, { refreshInterval: 15000 });
  const refreshShipments = useRefreshShipments(id);
  const c = useRequestActions(id, () => { void mutate(); }, refreshShipments);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;

  const r = data.request; const offers: any[] = data.offers; const manifest = !!data.manifest; const base = `/business/requests/${id}`;
  const incomplete: number = manifest && DETAILS_EDITABLE.includes(r.status) ? Number(data.incompleteParcels) || 0 : 0;
  const counts = ship?.counts ?? {}; const undelivered = UNDELIVERED.reduce((n, k) => n + (counts[k] ?? 0), 0);
  const blocked = !!ov?.requireVerification && ov.verificationStatus !== "verified";
  const live = isLive(r.status);
  const missing = publishFields(r.service).filter(([k]) => c.pubErrs[k]);
  const canComplete = offers.some((o) => o.status === "pending_settlement") && offers.every((o) => ["pending_settlement", "completed", "cancelled", "rejected", "no_show", "replaced", "expired", "offered"].includes(o.status));
  const reship = () => c.a.run("reship", () => post(`/requests/${id}/reship`, {}), { onDone: (d: any) => router.push(`/business/requests/new?draft=${d.id}`) });
  const changed = () => { void mutate(); void refreshShipments(); };
  const ctx: RequestCtx = {
    id, base, data, r, offers, manifest, ship, incomplete, undelivered, live, blocked, cat, mutate: () => { void mutate(); }, refreshShipments, open: c.open, act: c.act, busy: c.a.is,
    openReport: c.setReport, openComplete: () => c.setCompleting(true),
  };
  const Icon = SVC_ICON[r.service as keyof typeof SVC_ICON] ?? Bike;
  const needsAction = offers.some((o) => ["arrived", "delivered_reported"].includes(o.status));
  const editHref = `/business/requests/new?draft=${id}`;
  const draft = r.status === "draft";

  return (
    <RequestProvider value={ctx}>
      <Breadcrumbs items={[{ label: t("nav.requests"), href: "/business/requests" }, { label: r.ref }]} />
      <DetailHeader
        avatar={<span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent" aria-hidden><Icon className="size-7" /></span>}
        name={r.ref}
        badges={<><StatusBadge status={r.status} />{needsAction && <Badge tone="warn">{t("ubz.action_badge")}</Badge>}</>}
        subtitle={<span className="inline-flex flex-wrap items-center gap-x-1.5"><span className="font-medium text-ink">{r.title || t(`svc.${r.service}`)}</span><span aria-hidden>·</span>{t(`city.${r.pickupCity}`)}<ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />{t(`city.${r.deliveryCity}`)}</span>}
        facts={[
          { label: t("req.starts"), value: fmtDateTime(r.startsAt, locale) },
          { label: t("wizard.vehicle"), value: r.vehicleType ? `${t(`vehicle.${r.vehicleType}`)}${r.temperature ? ` · ${t(`temp.${r.temperature}`)}` : ""}` : "—" },
          { label: t("wizard.days"), value: <span className="ltr-num tabular-nums">{fmtNum(r.durationDays, locale)}</span> },
          { label: t("rdz.published_at"), value: r.publishedAt ? fmtDateTime(r.publishedAt, locale) : t("status.draft") },
        ]}
        actions={<>
          {draft && <Button size="sm" disabled={blocked} onClick={() => { c.setTerms(false); c.open("publish"); }} data-testid="order-publish"><Rocket className="size-4" aria-hidden />{t("wizard.publish")}</Button>}
          {draft && <Link href={editHref}><Button variant="secondary" size="sm"><Pencil className="size-4" aria-hidden />{t("bz.draft_edit")}</Button></Link>}
          {draft && <Button variant="danger" size="sm" onClick={() => c.open("discard", undefined, { reason: "" })}><Trash2 className="size-4" aria-hidden />{t("bz.draft_discard")}</Button>}
          {!draft && <Button variant="secondary" size="sm" onClick={() => c.setReport({ requestId: id, requestRef: r.ref })} data-testid="order-report"><Flag className="size-4" aria-hidden />{t("act.report_problem")}</Button>}
          {live && <Button variant="gold" size="sm" onClick={() => c.open("urgent", undefined, { reason: "" })} data-testid="order-urgent"><Siren className="size-4" aria-hidden />{t("req.urgent")}</Button>}
          {live && <Button variant="danger" size="sm" onClick={() => c.open("cancel", undefined, { reason: "" })} data-testid="order-cancel"><Ban className="size-4" aria-hidden />{t("req.cancel")}</Button>}
          {manifest && !draft && undelivered > 0 && <Button size="sm" variant="secondary" loading={c.a.is("reship")} onClick={reship} data-testid="order-reship"><PackageX className="size-4" aria-hidden />{t("bs.reship", { n: undelivered })}</Button>}
          {canComplete && r.status !== "completed" && <Button size="sm" loading={c.a.is("complete")} onClick={() => c.a.run("complete", () => post(`/requests/${id}/complete`), { success: "req.completed_ok", onDone: () => { void mutate(); } })} data-testid="order-complete"><CheckCheck className="size-4" aria-hidden />{t("req.complete")}</Button>}
        </>}
      />

      <div className="mb-5 space-y-3 empty:hidden">
        {draft && <Notice tone="info">{t("req.draft_note")} <Link href={editHref} className="font-semibold text-cyan underline">{t("bz.draft_edit")}</Link></Notice>}
        {c.whRefused && <WarehouseLocationNotice always tone="danger" />}
        {draft && !c.whRefused && r.service !== "car_without_driver" && <WarehouseLocationNotice />}
        {draft && blocked && <Notice tone="warn" title={t("verify.pending_title")}>{t("verify.pending_body")} <Link href="/business/documents" className="font-semibold text-cyan underline">{t("verify.go_documents")}</Link></Notice>}
        {missing.length > 0 && <Notice tone="danger" title={t("bz.publish_missing")}><ul className="list-disc ps-5">{missing.map(([k, label]) => <li key={k}>{t(label)}: {k === "startsAt" ? c.pubErrs[k] : k === "shipments" ? t("err.MANIFEST_REQUIRED") : t("val.required")}</li>)}</ul><Link href={editHref} className="mt-1 inline-block font-semibold text-cyan underline">{t("bz.draft_edit")}</Link></Notice>}
        {r.cancelReason && <Notice tone="danger" title={t("status.cancelled")}>{r.cancelReason}</Notice>}
        <IncompleteBanner n={incomplete} onComplete={() => c.setCompleting(true)} />
      </div>

      <LinkTabs label={t("rdz.order_sections")} tabs={[
        { href: base, label: t("rdz.tab_overview") },
        ...(manifest ? [{ href: `${base}/parcels`, label: t("bs.shipments"), count: ship?.total }] : []),
        { href: `${base}/money`, label: t("rdz.tab_money") },
        { href: `${base}/activity`, label: t("rdz.tab_activity") },
      ]} />
      {children}
      <RequestDialogs id={id} c={c} cat={cat} manifest={manifest} blocked={blocked} onChanged={changed} />
    </RequestProvider>
  );
}
