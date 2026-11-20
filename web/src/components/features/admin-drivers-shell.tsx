"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Link2Off } from "lucide-react";
import { Badge, Breadcrumbs, Button, DetailHeader, ErrorState, LinkTabs, Notice, PageLoading, StatusBadge } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { hasAny, useTx } from "./admin-common";
import { AccountStatusButton, LiftSuspensionButton, UnlinkOfficeModal } from "./admin-drivers-actions";
import { driverSuspension, ratingText } from "./admin-offices-lib";
import { EditAccountButton } from "./admin-create-pages";
import { Ago, RiskChips, secondsSince } from "./admin-driver-common";

/** Shared frame of every `/admin/drivers/:id/…` page: breadcrumbs, entity header with actions, notices and the route tabs. */
export function DriverShell({ id, children }: { id: string; children: ReactNode }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const { data: d, error, mutate } = useApi(`/admin/drivers/${id}/overview`, { shouldRetryOnError: false });
  const st = useApi(`/admin/drivers/${id}/standing`, { shouldRetryOnError: false });
  const [unlink, setUnlink] = useState(false);
  const root = { label: t("nav.drivers"), href: "/admin/drivers" };
  if (error) return <><Breadcrumbs items={[root]} /><ErrorState error={error} retry={() => mutate()} /></>;
  if (!d) return <PageLoading />;
  const base = `/admin/drivers/${id}`; const sus = driverSuspension(d); const canOffice = hasAny(me, "offices.view", "offices.manage");
  const tabs = [
    { href: base, label: t("rdq.tab_overview") },
    { href: `${base}/jobs`, label: t("rdq.tab_jobs") },
    { href: `${base}/parcels`, label: t("dv2.tab_parcels") },
    { href: `${base}/location`, label: t("dv2.tab_location") },
    ...(hasAny(me, "finance.view", "wallets.view", "cod.manage") ? [{ href: `${base}/wallet`, label: t("rdq.tab_wallet_cash") }] : []),
    ...(hasPerm(me, "reports.view") ? [{ href: `${base}/reports`, label: t("fr.tab_reports") }] : []),
    ...(hasAny(me, "documents.review", "verification.manage") ? [{ href: `${base}/documents`, label: t("nav.documents") }] : []),
    { href: `${base}/security`, label: t("dv2.tab_security") },
    { href: `${base}/reviews`, label: t("dv2.tab_reviews") },
    { href: `${base}/activity`, label: t("dv2.tab_activity") },
    { href: `${base}/notes`, label: t("dv2.tab_notes") },
    { href: `${base}/raw`, label: t("dv2.tab_raw") },
  ];
  const stand = st.data; const plate = d.vehiclePlate as string | null;
  return (
    <>
      <Breadcrumbs items={[root, { label: d.name }]} />
      <DetailHeader name={d.name}
        subtitle={<span className="inline-flex flex-wrap items-center gap-x-2" data-testid="dv2-driver-sub">{[d.vehicleType ? t(`vehicle.${d.vehicleType}`) : null, d.vehicleTemperature ? t(`temp.${d.vehicleTemperature}`) : null].filter(Boolean).join(" · ")}{plate && <span className="ltr-num rounded-md border border-line bg-bg2 px-1.5 text-xs font-semibold text-ink">{plate}</span>}{d.city && <span>· {tx(`city.${d.city}`, d.city)}</span>}</span>}
        badges={<>
          {sus.active ? <Badge tone="danger">{t("status.suspended")}</Badge> : <StatusBadge status={d.status} />}
          <StatusBadge status={d.verificationStatus} />
          <Badge tone={d.availability === "available" ? "success" : "neutral"}>{d.availability === "available" ? t("map.available") : t("adm.unavailable")}</Badge>
        </>}
        facts={[
          { label: t("auth.phone"), value: <span className="ltr-num" data-testid="rdq-driver-phone">{d.phone ?? "—"}</span> },
          { label: t("role.office"), value: d.officeId ? (canOffice ? <Link href={`/admin/offices/${d.officeId}`} className="text-accent hover:underline">{d.office ?? "—"}</Link> : d.office ?? "—") : <Badge>{t("adm.direct")}</Badge> },
          { label: t("driver.rating"), value: d.rating ? <span>{ratingText(d.rating)} <span className="text-xs text-muted">({t("adm.ratings_n", { n: d.ratingCount ?? 0 })})</span></span> : "—" },
          { label: t("rdq.col_joined"), value: d.createdAt ? fmtDate(d.createdAt, locale) : "—" },
          { label: t("dv2.last_active"), value: stand ? <Ago seconds={secondsSince(stand.lastSeenAt)} /> : "—" },
        ]}
        actions={<>
          <EditAccountButton kind="driver" id={id} />
          {sus.active && !sus.account && <LiftSuspensionButton driverId={id} name={d.name} onDone={() => mutate()} />}
          {d.officeId && hasPerm(me, "offices.manage") && <Button size="sm" variant="danger" data-testid="rdq-driver-unlink" onClick={() => setUnlink(true)}><Link2Off className="size-4" aria-hidden />{t("adm.unlink_office")}</Button>}
          <AccountStatusButton user={d} onDone={() => mutate()} />
        </>} />
      {stand && <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="dv2-risk-row"><span className="text-xs font-medium text-muted">{t("dv2.risks")}</span><RiskChips risks={stand.risks} fmtMoney={(c) => fmtMoney(c, locale)} /></div>}
      {sus.active && <div className="mb-4"><Notice tone="danger" title={t("driver.suspended")}>{sus.until ? t("rdq.suspended_until_staff", { d: fmtDateTime(sus.until, locale) }) : t("rdq.account_suspended")}</Notice></div>}
      {d.openComplaints > 0 && <div className="mb-4"><Notice tone="warn">{t("adm.open_complaints_n", { n: d.openComplaints })}{hasPerm(me, "complaints.manage") && <> · <Link href="/admin/complaints" className="text-accent hover:underline">{t("nav.complaints")}</Link></>}</Notice></div>}
      <LinkTabs label={t("rdq.driver_sections")} tabs={tabs} />
      {children}
      <UnlinkOfficeModal driver={unlink ? { id, name: d.name } : null} office={d.office ?? ""} onClose={() => setUnlink(false)} onDone={() => mutate()} />
    </>
  );
}
