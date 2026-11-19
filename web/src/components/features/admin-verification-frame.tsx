"use client";
import type { ReactNode } from "react";
import { Building2, Factory, FileCheck2, ShieldCheck, Truck } from "lucide-react";
import { ErrorState, LinkTabs, PageHeader, Stat, StatGrid } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny } from "./admin-common";

/** Queue sizes of the whole workspace (`GET /admin/verification/summary`); the sub-pages revalidate it through `useRefreshCompanies` after a decision. */
export const useVerificationSummary = () => useApi("/admin/verification/summary", { shouldRetryOnError: false });

/** The verification workspace: one header, the queue sizes as KPIs (each links to its queue) and the route tabs; the queue itself is the sub-page. */
export function VerificationFrame({ children }: { children: ReactNode }) {
  const { t, locale } = useI18n(); const me = useUser();
  const { data: s, error, mutate } = useVerificationSummary();
  const canDocs = hasAny(me, "documents.review", "verification.manage");
  const load = !s && !error; const n = (v?: number) => fmtNum(v, locale);
  const biz = s ? s.business.pending + s.business.infoRequested : undefined, off = s ? s.offices.pending + s.offices.infoRequested : undefined;
  const tone = (v?: number) => ((v ?? 0) > 0 ? "gold" as const : "muted" as const);
  const tabs = [
    { href: "/admin/verification", label: t("rdp.vf_accounts"), count: biz != null && off != null ? biz + off : undefined },
    ...(canDocs ? [{ href: "/admin/verification/documents", label: t("verify.documents"), count: s?.documents?.total }] : []),
    { href: "/admin/verification/drivers", label: t("nav.drivers"), count: s?.drivers.pending },
  ];
  return (
    <>
      <PageHeader title={t("nav.verification")} subtitle={t("verify.admin_sub")} icon={<ShieldCheck className="size-5" />} />
      {error ? <div className="mb-5"><ErrorState error={error} retry={() => mutate()} /></div> : (
        <StatGrid cols={canDocs ? 4 : 3} className="mb-5">
          <Stat label={t("rdp.vf_companies")} value={n(biz)} hint={s ? t("rdp.vf_split", { p: n(s.business.pending), i: n(s.business.infoRequested) }) : undefined} tone={tone(biz)} icon={<Factory className="size-5" />} href="/admin/verification?kind=business" loading={load} />
          <Stat label={t("rdp.vf_offices")} value={n(off)} hint={s ? t("rdp.vf_split", { p: n(s.offices.pending), i: n(s.offices.infoRequested) }) : undefined} tone={tone(off)} icon={<Building2 className="size-5" />} href="/admin/verification?kind=office" loading={load} />
          <Stat label={t("rdp.vf_drivers")} value={n(s?.drivers.pending)} hint={t("rdp.vf_drivers_hint")} tone={tone(s?.drivers.pending)} icon={<Truck className="size-5" />} href="/admin/verification/drivers" loading={load} />
          {canDocs && <Stat label={t("rdp.vf_docs")} value={n(s?.documents?.total)} hint={t("rdp.vf_docs_hint")} tone={tone(s?.documents?.total)} icon={<FileCheck2 className="size-5" />} href="/admin/verification/documents" loading={load} />}
        </StatGrid>)}
      <LinkTabs label={t("nav.verification")} tabs={tabs} />
      {children}
    </>
  );
}
