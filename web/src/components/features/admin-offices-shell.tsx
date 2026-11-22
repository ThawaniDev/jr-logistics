"use client";
import type { ReactNode } from "react";
import { Building2, UserRound } from "lucide-react";
import { Breadcrumbs, DetailHeader, ErrorState, LinkTabs, PageLoading, StatusBadge } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { hasAny, useTx } from "./admin-common";
import { OfficeActions } from "./admin-offices-actions";
import { EditAccountButton } from "./admin-create-pages";
import { AgreementBadge } from "./admin-offices-common";

/** Shared frame of every `/admin/offices/:id/…` page: breadcrumbs, the entity header with its actions, and the route tabs. */
export function OfficeShell({ id, children }: { id: string; children: ReactNode }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const { data: o, error, mutate } = useApi(`/admin/offices/${id}`, { shouldRetryOnError: false });
  const root = { label: t("nav.offices"), href: "/admin/offices" };
  if (error) return <><Breadcrumbs items={[root]} /><ErrorState error={error} retry={() => mutate()} /></>;
  if (!o) return <PageLoading />;
  const base = `/admin/offices/${id}`;
  const tabs = [
    { href: base, label: t("rdq.tab_overview") },
    ...(hasAny(me, "offices.view", "offices.manage", "drivers.view") ? [{ href: `${base}/drivers`, label: t("req.drivers"), count: o.counts.drivers }] : []),
    ...(hasAny(me, "offices.view", "offices.manage") ? [{ href: `${base}/jobs`, label: t("rdq.tab_jobs"), count: o.counts.activeJobs || undefined }] : []),
    ...(o.money ? [{ href: `${base}/money`, label: t("dv2.tab_money") }] : []),
    ...(hasPerm(me, "reports.view") ? [{ href: `${base}/reports`, label: t("fr.tab_reports") }] : []),
    ...(hasAny(me, "offices.view") ? [{ href: `${base}/agreements`, label: t("nav.agreement") }] : []),
    ...(hasAny(me, "documents.review", "verification.manage") ? [{ href: `${base}/documents`, label: t("nav.documents") }] : []),
    { href: `${base}/security`, label: t("dv2.tab_security") },
    { href: `${base}/activity`, label: t("dv2.tab_activity") },
    { href: `${base}/notes`, label: t("dv2.tab_notes") },
    { href: `${base}/raw`, label: t("dv2.tab_raw") },
  ];
  return (
    <>
      <Breadcrumbs items={[root, { label: o.officeName }]} />
      <DetailHeader name={o.officeName} avatar={<span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent" aria-hidden><Building2 className="size-7" /></span>}
        subtitle={<span className="inline-flex flex-wrap items-center gap-x-2"><UserRound className="size-4" aria-hidden />{o.contact}{o.email && <span className="text-muted/80 light:text-muted">· {o.email}</span>}</span>}
        badges={<><StatusBadge status={o.status} /><StatusBadge status={o.verificationStatus} /><AgreementBadge status={o.agreement?.status} expiresAt={o.agreement?.expiresAt} /></>}
        facts={[
          { label: t("auth.phone"), value: <span className="ltr-num" data-testid="rdq-office-phone">{o.phone ?? "—"}</span> },
          { label: t("reg.city"), value: tx(`city.${o.city}`, o.city) },
          { label: t("reg.cr"), value: <span className="ltr-num">{o.crNumber ?? "—"}</span> },
          { label: t("rdq.col_joined"), value: fmtDate(o.createdAt, locale) },
          { label: t("req.drivers"), value: <span data-testid="dv2-office-drivers">{o.counts.drivers}<span className="text-xs text-muted"> · {t("rdq.drivers_hint", { available: o.counts.availableDrivers, busy: o.counts.onJob })}</span></span> },
        ]}
        actions={<><EditAccountButton kind="office" id={id} /><OfficeActions office={o} onChanged={() => mutate()} /></>} />
      <LinkTabs label={t("rdq.office_sections")} tabs={tabs} />
      {children}
    </>
  );
}
