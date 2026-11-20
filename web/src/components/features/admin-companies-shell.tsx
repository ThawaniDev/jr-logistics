"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { Factory, ShieldAlert, Star } from "lucide-react";
import { Badge, Breadcrumbs, Button, DetailHeader, EmptyState, ErrorState, LinkTabs, Notice, PageHeader, PageLoading, StatusBadge } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useTx } from "./admin-common";
import { CompanyActions } from "./admin-companies-actions";
import { EditAccountButton } from "./admin-create-pages";
import { CompanyProvider, useCompany, type Company } from "./admin-companies-ctx";
import { companyFlags, companyTabHref, companyTabs, type CompanyFlag, type CompanyTab } from "./admin-companies-lib";

const FLAG: Record<CompanyFlag, { tone: "danger" | "warn"; title: string; body: string }> = {
  account_suspended: { tone: "danger", title: "rdp.flag_account_suspended_t", body: "rdp.flag_account_suspended" },
  verification_suspended: { tone: "danger", title: "rdp.flag_verif_suspended_t", body: "rdp.flag_verif_suspended" },
  pending: { tone: "warn", title: "rdp.flag_pending_t", body: "rdp.flag_pending" },
  info_requested: { tone: "warn", title: "rdp.flag_info_t", body: "rdp.flag_info" },
  rejected: { tone: "danger", title: "rdp.flag_rejected_t", body: "rdp.flag_rejected" },
};

/** Shown when the id in the URL is not a company account (a driver, an office, staff, or nothing at all). */
export function NotACompany() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("rdp.not_found_title")} breadcrumbs={[{ label: t("nav.companies"), href: "/admin/companies" }, { label: t("rdp.not_found_crumb") }]} />
      <div data-testid="companies-not-found"><EmptyState title={t("rdp.not_found_title")} hint={t("rdp.not_found_hint")} icon={<Factory className="size-9" aria-hidden />}
        action={<Link href="/admin/companies"><Button variant="secondary">{t("rdp.back_to_companies")}</Button></Link>} /></div>
    </>
  );
}

/** The frame of every company view: breadcrumbs, header with the account's state and primary actions, warnings, and the route tabs. */
export function CompanyShell({ id, children }: { id: string; children: ReactNode }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const { data: c, error, mutate } = useApi<Company>(`/admin/companies/${id}`, { shouldRetryOnError: false });
  const { data: prof } = useApi<{ taxNumber: string | null }>(c ? `/admin/companies/${id}/profile` : null, { shouldRetryOnError: false });
  if (error) return error instanceof ApiError && error.code === "NOT_FOUND" ? <NotACompany /> : <><PageHeader title={t("nav.companies")} breadcrumbs={[{ label: t("nav.companies"), href: "/admin/companies" }]} /><ErrorState error={error} retry={() => mutate()} /></>;
  if (!c) return <PageLoading />;
  const p = c.profile; const can = (perm: string) => hasPerm(me, perm);
  const flags = companyFlags({ status: c.status, verificationStatus: p.verificationStatus });
  const tabLabel: Record<CompanyTab, string> = {
    overview: t("rdp.tab_overview"), orders: t("rdp.tab_orders"), parcels: t("dv3.tab_parcels"), finance: t("rdp.tab_finance"), warehouse: t("rdp.tab_warehouse"), integrations: t("dv3.tab_integrations"), documents: t("rdp.tab_documents"),
    support: t("dv3.tab_support"), security: t("dv3.tab_security"), activity: t("dv3.tab_activity"), notes: t("dv3.tab_notes"), raw: t("dv3.tab_raw"),
  };
  const tabs = companyTabs(can).map((k) => ({
    href: companyTabHref(c.id, k), label: tabLabel[k],
    count: k === "orders" ? c.counts.orders ?? undefined : k === "documents" && c.counts.docsToReview ? c.counts.docsToReview : undefined,
  }));
  return (
    <CompanyProvider value={c}>
      <Breadcrumbs items={[{ label: t("nav.companies"), href: "/admin/companies" }, { label: c.name }]} />
      <DetailHeader name={c.name} avatar={<span aria-hidden className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent"><Factory className="size-7" /></span>}
        subtitle={<span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">{c.contactName}{p.rating != null && <span className="inline-flex items-center gap-1 text-gold"><Star className="size-3.5 fill-current" aria-hidden /><span className="ltr-num">{p.rating}</span><span className="text-xs text-muted">({p.ratingCount})</span></span>}</span>}
        badges={<><StatusBadge status={p.verificationStatus} />{c.status === "suspended" ? <Badge tone="danger">{t("rdp.account_suspended")}</Badge> : <StatusBadge status={c.status} />}</>}
        actions={<><EditAccountButton kind="business" id={c.id} /><CompanyActions company={c} /></>}
        facts={[
          { label: t("auth.phone"), value: c.phone ? <span className="ltr-num">{c.phone}</span> : "—" },
          { label: t("auth.email"), value: c.email ?? "—" },
          { label: t("reg.city"), value: c.city ? tx(`city.${c.city}`, c.city) : "—" },
          { label: t("reg.cr"), value: p.crNumber ? <span className="ltr-num">{p.crNumber}</span> : "—" },
          { label: t("reg.tax"), value: prof?.taxNumber ? <span className="ltr-num" data-testid="dv3-header-tax">{prof.taxNumber}</span> : "—" },
          { label: t("rdp.fact_contact"), value: p.responsiblePerson ?? c.contactName },
          { label: t("reg.industry"), value: p.industry ?? "—" },
          { label: t("rdp.fact_joined"), value: fmtDate(c.createdAt, locale) },
          { label: t("rdp.fact_address"), value: p.address ?? "—" },
        ]} />
      {flags.length > 0 && (
        <div className="mb-5 space-y-2" data-testid="companies-flags">
          {flags.map((f) => <Notice key={f} tone={FLAG[f].tone} title={t(FLAG[f].title)}><span data-testid={`companies-flag-${f}`}>{t(FLAG[f].body)}</span>{p.verificationNote && f !== "account_suspended" && <span className="mt-1 block text-xs text-muted">{t("rdp.last_note")}: {p.verificationNote}</span>}</Notice>)}
        </div>
      )}
      <LinkTabs label={c.name} tabs={tabs} />
      {children}
    </CompanyProvider>
  );
}

/** Wraps one tab's content: someone who types the URL of a tab they may not use sees a clear message instead of a failing request. */
export function CompanyTabGate({ tab, children }: { tab: CompanyTab; children: ReactNode }) {
  const { t } = useI18n(); const me = useUser(); const c = useCompany();
  if (companyTabs((p) => hasPerm(me, p)).includes(tab)) return <>{children}</>;
  return <EmptyState title={t("rdp.no_access")} hint={t("rdp.no_access_hint")} icon={<ShieldAlert className="size-9" aria-hidden />} action={<Link href={companyTabHref(c.id, "overview")}><Button variant="secondary">{t("rdp.tab_overview")}</Button></Link>} />;
}
