"use client";
import Link from "next/link";
import { Headset } from "lucide-react";
import { Badge, EmptyState, ErrorState, Notice, Section, Skeleton, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useTx } from "./admin-common";
import { useCompany } from "./admin-companies-ctx";
import { KpiTile } from "./admin-company-detail-kpis";
import { SlaBadge } from "./admin-ticket-sla";
import type { SlaState } from "@/server/details-pure";

interface Row { id: string; ref: string; status: string; priority: string; category: string; createdAt: string; by: { id: string; name: string; role: string }; about: boolean; request: { id: string; ref: string } | null;
  sla: { worst: SlaState; firstResponse: { state: SlaState }; resolution: { state: SlaState } }; subject?: string; assignee?: string | null; handler?: string | null; holdsSettlement?: boolean }
interface Data { tickets: Row[] | null; complaints: Row[] | null; summary: { open: number; breached: number; atRisk: number; total: number }; hidden: string[] }

/** Support tab: every ticket and complaint that involves this company (opened or filed by it, or about one of its orders), with status and SLA state; each links to its own view. */
export function CompanySupport() {
  const { t, locale } = useI18n(); const c = useCompany(); const me = useUser(); const tx = useTx();
  const { data, error, mutate } = useApi<Data>(`/admin/companies/${c.id}/support`, { shouldRetryOnError: false });
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;
  const s = data.summary, who = (r: Row) => (hasPerm(me, "users.view") ? <Link href={`/admin/users/${r.by.id}`} className="text-accent hover:underline">{r.by.name}</Link> : r.by.name);
  const head = (first: string) => [first, t("common.status"), t("dv3.sla_title"), t("dv3.col_by"), t("dv3.col_order"), t("common.date")];
  return (
    <div className="space-y-5" data-testid="dv3-company-support">
      {data.hidden.length > 0 && <Notice tone="info">{t("dv3.hidden_parts", { parts: data.hidden.map((h) => t(`dv3.hid_${h}`)).join(", ") })}</Notice>}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <KpiTile id="sp-open" label={t("dv3.sp_open")} def={t("dv3.sp_d_open")} value={fmtNum(s.open, locale)} tone={s.open > 0 ? "gold" : undefined} />
        <KpiTile id="sp-breached" label={t("dv3.sp_breached")} def={t("dv3.sp_d_breached")} value={fmtNum(s.breached, locale)} tone={s.breached > 0 ? "danger" : undefined} />
        <KpiTile id="sp-risk" label={t("dv3.sp_risk")} def={t("dv3.sp_d_risk")} value={fmtNum(s.atRisk, locale)} tone={s.atRisk > 0 ? "gold" : undefined} />
        <KpiTile id="sp-total" label={t("dv3.sp_total")} def={t("dv3.sp_d_total")} value={fmtNum(s.total, locale)} hint={t("dv3.sp_total_hint")} />
      </div>
      {data.tickets && (
        <Section title={t("nav.cases")} flush>
          {data.tickets.length === 0 ? <div className="p-5"><EmptyState title={t("dv3.sp_none_tickets")} icon={<Headset className="size-9" aria-hidden />} /></div> : (
            <Table bare stack label={t("nav.cases")} head={head(t("dv3.col_case"))}>
              {data.tickets.map((r) => (
                <tr key={r.id} data-testid="dv3-support-ticket">
                  <Td label={t("dv3.col_case")}><Link href={`/admin/cases/${r.id}`} className="block min-w-0"><span className="ltr-num font-semibold text-accent hover:underline">{r.ref}</span><span dir="auto" className="block truncate text-xs text-muted">{r.subject}</span></Link></Td>
                  <Td label={t("common.status")}><span className="inline-flex flex-wrap items-center gap-1.5"><StatusBadge status={r.status} />{r.priority === "urgent" && <Badge tone="danger">{t("support.urgent")}</Badge>}{r.about && <Badge>{t("dv3.sp_about")}</Badge>}</span></Td>
                  <Td label={t("dv3.sla_title")}><SlaBadge state={r.sla.worst} /></Td>
                  <Td label={t("dv3.col_by")}>{who(r)}<span className="block text-xs text-muted">{t(`role.${r.by.role}`)}</span></Td>
                  <Td label={t("dv3.col_order")}>{r.request ? <Link href={`/admin/requests/${r.request.id}`} className="ltr-num text-accent hover:underline">{r.request.ref}</Link> : "—"}</Td>
                  <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(r.createdAt, locale)}</Td>
                </tr>))}
            </Table>)}
        </Section>)}
      {data.complaints && (
        <Section title={t("nav.complaints")} flush>
          {data.complaints.length === 0 ? <div className="p-5"><EmptyState title={t("dv3.sp_none_complaints")} /></div> : (
            <Table bare stack label={t("nav.complaints")} head={head(t("dv3.col_complaint"))}>
              {data.complaints.map((r) => (
                <tr key={r.id} data-testid="dv3-support-complaint">
                  <Td label={t("dv3.col_complaint")}><Link href={`/admin/complaints/${r.id}`} className="block min-w-0"><span className="ltr-num font-semibold text-accent hover:underline">{r.ref}</span><span className="block truncate text-xs text-muted">{tx(`complaint_cat.${r.category}`, r.category)}</span></Link></Td>
                  <Td label={t("common.status")}><span className="inline-flex flex-wrap items-center gap-1.5"><StatusBadge status={r.status === "in_progress" ? "in_progress" : r.status} />{r.priority === "urgent" && <Badge tone="danger">{t("support.urgent")}</Badge>}{r.holdsSettlement && <Badge tone="warn">{t("complaints.holds_settlement")}</Badge>}{r.about && <Badge>{t("dv3.sp_about")}</Badge>}</span></Td>
                  <Td label={t("dv3.sla_title")}><SlaBadge state={r.sla.worst} /></Td>
                  <Td label={t("dv3.col_by")}>{who(r)}<span className="block text-xs text-muted">{t(`role.${r.by.role}`)}</span></Td>
                  <Td label={t("dv3.col_order")}>{r.request ? <Link href={`/admin/requests/${r.request.id}`} className="ltr-num text-accent hover:underline">{r.request.ref}</Link> : "—"}</Td>
                  <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(r.createdAt, locale)}</Td>
                </tr>))}
            </Table>)}
        </Section>)}
    </div>
  );
}
