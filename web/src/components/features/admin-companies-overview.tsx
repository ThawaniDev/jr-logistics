"use client";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { Badge, EmptyState, ErrorState, InfoGrid, ProgressBar, Section, StatusBadge, Table, Td, CellPair } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useTx } from "./admin-common";
import { companyTabs, companyTabHref } from "./admin-companies-lib";
import { useCompany } from "./admin-companies-ctx";
import { CompanyKpiStrip, type CompanyStats } from "./admin-company-detail-kpis";
import { CompanyAlerts, CompanyCharts, CompanyHealth } from "./admin-company-detail-charts";
import { CompanyProfileFacts } from "./admin-company-detail-profile";
import { parsePeriod } from "./admin-company-detail-lib";

/**
 * Overview tab: what needs attention (alerts), the KPI strip with a period selector and the change against the period before, the charts, the health score with its formula,
 * the recent orders, the profile facts (registration and VAT numbers, contact, source, verification history) and the account / warehouse state.
 */
export function CompanyOverview() {
  const { t, locale } = useI18n(); const me = useUser(); const c = useCompany(); const tx = useTx();
  const can = (p: string) => hasPerm(me, p);
  const tabs = companyTabs(can); const href = (k: Parameters<typeof companyTabHref>[1]) => (tabs.includes(k) ? companyTabHref(c.id, k) : undefined);
  const [raw, setPeriod] = useUrlState("period", "30d"); const period = parsePeriod(raw);
  const stats = useApi<CompanyStats>(`/admin/companies/${c.id}/stats?period=${period}`, { keepPreviousData: true, shouldRetryOnError: false });
  const { data: o, error, mutate } = useApi(`/admin/companies/${c.id}/overview`, { shouldRetryOnError: false });
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  const money = (n?: number | null) => fmtMoney(n, locale);
  const seeOrders = can("requests.view"), docs = o?.documents, wh = c.profile.warehouse;
  const st = stats.data, loading = !st && !stats.error;
  return (
    <div className="space-y-5">
      {st && <CompanyAlerts alerts={st.alerts} />}
      {stats.error && !st ? <ErrorState error={stats.error} retry={() => stats.mutate()} /> : <CompanyKpiStrip id={c.id} data={st} loading={loading} period={period} onPeriod={(p) => setPeriod(p === "30d" ? "" : p)} />}
      {(st?.charts || loading) && <CompanyCharts stats={st} loading={loading} />}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {seeOrders && (
            <Section title={t("rdp.recent_orders")} flush actions={href("orders") && <Link href={companyTabHref(c.id, "orders")} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">{t("common.view_all")}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></Link>}>
              {!o ? <div className="p-5 text-sm text-muted">{t("uxa.loading")}</div> : !o.recent?.length ? <div className="p-5"><EmptyState title={t("biz.no_requests")} hint={t("rdp.no_orders_hint")} /></div> : (
                <Table bare stack label={t("rdp.recent_orders")} head={[t("req.ref"), t("req.route"), t("req.starts"), { label: t("req.total"), align: "end" }, t("common.status")]}>
                  {o.recent.map((r: any) => (
                    <tr key={r.id} data-testid="companies-recent-order">
                      <Td label={t("req.ref")}><CellPair href={`/admin/requests/${r.id}`} title={<span className="ltr-num font-semibold">{r.ref}</span>} sub={tx(`svc.${r.service}`, r.service)} /></Td>
                      <Td label={t("req.route")} className="text-muted">{tx(`city.${r.pickupCity}`, r.pickupCity)}<ArrowRight className="mx-1 inline size-3.5 rtl:rotate-180" aria-hidden />{tx(`city.${r.deliveryCity}`, r.deliveryCity)}</Td>
                      <Td label={t("req.starts")} className="whitespace-nowrap text-muted">{fmtDateTime(r.startsAt, locale)}</Td>
                      <Td label={t("req.total")} num>{r.totalCents == null ? "—" : money(r.totalCents)}</Td>
                      <Td label={t("common.status")}><StatusBadge status={r.status} /></Td>
                    </tr>))}
                </Table>)}
            </Section>)}
          <CompanyProfileFacts />
        </div>
        <div className="space-y-5">
          <CompanyHealth stats={st} />
          <Section title={t("rdp.account_section")}>
            <InfoGrid cols={1} items={[
              { label: t("verify.title"), value: <StatusBadge status={c.profile.verificationStatus} /> },
              { label: t("rdp.account_state"), value: c.status === "suspended" ? <Badge tone="danger">{t("rdp.account_suspended")}</Badge> : <StatusBadge status={c.status} /> },
              ...(c.profile.verificationNote ? [{ label: t("rdp.last_note"), value: c.profile.verificationNote }] : []),
              { label: t("rdp.api_webhook"), value: c.profile.hasWebhook ? <Badge tone="success">{t("rdp.webhook_on")}</Badge> : <Badge>{t("rdp.webhook_off")}</Badge> },
            ]} />
            {docs && docs.requiredTotal > 0 && <div className="mt-4"><div className="mb-1.5 flex items-center justify-between text-xs text-muted"><span>{t("ubz.docs_progress", { done: docs.requiredApproved, total: docs.requiredTotal })}</span>{href("documents") && <Link href={companyTabHref(c.id, "documents")} className="text-accent hover:underline">{docs.toReview > 0 ? t("rdp.ov_docs_review", { n: docs.toReview }) : t("verify.documents")}</Link>}</div><ProgressBar value={docs.requiredApproved} max={docs.requiredTotal} tone={docs.requiredApproved < docs.requiredTotal ? "gold" : "accent"} label={t("verify.documents")} /></div>}
          </Section>
          <Section title={t("foa.wh_title")} actions={href("warehouse") && <Link href={companyTabHref(c.id, "warehouse")} className="text-sm text-accent hover:underline">{t("rdp.manage")}</Link>}>
            <div className="flex flex-wrap items-center gap-2"><Badge tone={wh ? "success" : "warn"}><MapPin className="size-3" aria-hidden />{wh ? t("foa.wh_loc_set") : t("foa.wh_loc_missing")}</Badge></div>
            <p className="mt-2 text-xs text-muted">{wh ? <span className="ltr-num">{wh.lat.toFixed(5)}, {wh.lng.toFixed(5)}</span> : t("rdp.wh_missing_hint")}</p>
          </Section>
        </div>
      </div>
    </div>
  );
}
