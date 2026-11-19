"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ErrorState, Section, Segmented, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, qs, useTx } from "./admin-common";
import { ListEmpty, LoadingRows, Money, pagerFooter } from "./admin-offices-common";
import { JOB_SCOPES, apiFilter, type JobScope } from "./admin-offices-lib";

const SIZE = 10;

/** The jobs (offers) of an office or a driver, filterable by state (render it inside `<Section flush>`). `endpoint` is `/admin/offices/:id/jobs` or `/admin/drivers/:id/jobs`. */
export function JobsTable({ endpoint, showDriver, testid }: { endpoint: string; showDriver?: boolean; testid: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const [scope, setScope] = useState<JobScope>("all"); const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi(`${endpoint}${qs({ scope: apiFilter(scope), page, pageSize: SIZE })}`, { keepPreviousData: true });
  const canRequest = hasAny(me, "requests.view"), canBusiness = hasAny(me, "users.view", "verification.manage", "offices.view"), canDriver = hasAny(me, "drivers.view", "users.view");
  const rows: any[] = data?.items ?? []; const loading = !data && !error;
  const head = [t("req.ref"), ...(showDriver ? [t("adm.col_driver")] : []), t("office.business"), t("req.route"), { label: t("rdq.col_units"), align: "end" as const }, t("common.status"), t("req.starts")];
  const scopeLabel: Record<JobScope, string> = { all: t("common.all"), active: t("rdq.scope_active"), completed: t("status.completed"), issues: t("rdq.scope_issues") };
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  return (
    <Table stack label={t("rdq.tab_jobs")} head={head} bare dense
      toolbar={<Segmented label={t("rdq.tab_jobs")} value={scope} onChange={(k) => { setScope(k as JobScope); setPage(1); }} options={JOB_SCOPES.map((k) => ({ key: k, label: scopeLabel[k] }))} />}
      empty={!loading && rows.length === 0 ? <ListEmpty filtered={scope !== "all"} onClear={() => setScope("all")} title={t("rdq.jobs_none")} hint={t("rdq.jobs_none_hint")} /> : undefined}
      footer={data ? pagerFooter(page, data.total, SIZE, setPage) : undefined}>
      {loading ? <LoadingRows cols={head.length} rows={4} /> : rows.map((j) => (
        <tr key={j.offerId} data-testid={`${testid}-${j.offerId}`}>
          <Td>{canRequest ? <Link href={`/admin/requests/${j.requestId}`} className="ltr-num font-semibold text-accent hover:underline">{j.ref}</Link> : <span className="ltr-num font-semibold">{j.ref}</span>}</Td>
          {showDriver && <Td label={t("adm.col_driver")}>{canDriver ? <Link href={`/admin/drivers/${j.driverId}`} className="text-accent hover:underline">{j.driver}</Link> : j.driver}</Td>}
          <Td label={t("office.business")}>{canBusiness && j.businessId ? <Link href={`/admin/companies/${j.businessId}`} className="hover:underline">{j.business ?? "—"}</Link> : j.business ?? "—"}</Td>
          <Td label={t("req.route")}><span className="inline-flex items-center gap-1.5 whitespace-nowrap">{tx(`city.${j.pickupCity}`, j.pickupCity)}<ArrowRight className="size-3.5 text-muted rtl:rotate-180" aria-hidden />{tx(`city.${j.deliveryCity}`, j.deliveryCity)}</span></Td>
          <Td label={t("rdq.col_units")} num>{j.finalUnits ?? j.expectedUnits}</Td>
          <Td label={t("common.status")}><StatusBadge status={j.status} /></Td>
          <Td label={t("req.starts")} className="whitespace-nowrap text-muted">{fmtDate(j.startsAt, locale)}</Td>
        </tr>
      ))}
    </Table>
  );
}

/** Payouts (settlements) owed to an office, filterable by pending / paid / rejected. */
export function PayoutsTable({ officeId }: { officeId: string }) {
  const { t, locale } = useI18n(); const me = useUser();
  const [status, setStatus] = useState<"all" | "pending" | "paid" | "rejected">("all"); const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi(`/admin/offices/${officeId}/settlements${qs({ status: apiFilter(status), page, pageSize: SIZE })}`, { keepPreviousData: true });
  const canRequest = hasAny(me, "requests.view"), canDriver = hasAny(me, "drivers.view", "users.view");
  const rows: any[] = data?.items ?? []; const loading = !data && !error;
  const head = [t("req.ref"), t("adm.col_driver"), { label: t("rdq.col_units"), align: "end" as const }, { label: t("common.amount"), align: "end" as const }, t("common.status"), t("common.date"), t("office.paid_on")];
  const opts = [["all", t("common.all")], ["pending", t("rdq.payout_pending")], ["paid", t("status.paid")], ["rejected", t("status.rejected")]] as const;
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  return (
    <Table stack label={t("rdq.tab_payouts")} head={head} bare dense
      toolbar={<Segmented label={t("rdq.tab_payouts")} value={status} onChange={(k) => { setStatus(k as typeof status); setPage(1); }} options={opts.map(([key, label]) => ({ key, label }))} />}
      empty={!loading && rows.length === 0 ? <ListEmpty filtered={status !== "all"} onClear={() => setStatus("all")} title={t("office.no_settlements")} hint={t("rdq.payouts_none_hint")} /> : undefined}
      footer={data ? pagerFooter(page, data.total, SIZE, setPage) : undefined}>
      {loading ? <LoadingRows cols={head.length} rows={4} /> : rows.map((s) => (
        <tr key={s.id} data-testid={`rdq-payout-${s.id}`}>
          <Td>{canRequest ? <Link href={`/admin/requests/${s.requestId}`} className="ltr-num font-semibold text-accent hover:underline">{s.ref}</Link> : <span className="ltr-num font-semibold">{s.ref}</span>}</Td>
          <Td label={t("adm.col_driver")}>{canDriver ? <Link href={`/admin/drivers/${s.driverId}`} className="hover:underline">{s.driver}</Link> : s.driver}</Td>
          <Td label={t("rdq.col_units")} num>{s.finalUnits}</Td>
          <Td label={t("common.amount")} align="end"><Money cents={s.amountCents} /></Td>
          <Td label={t("common.status")}><StatusBadge status={s.status === "batch_ready" ? "approved" : s.status} /></Td>
          <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDate(s.createdAt, locale)}</Td>
          <Td label={t("office.paid_on")} className="whitespace-nowrap text-muted">{s.paidAt ? fmtDate(s.paidAt, locale) : "—"}</Td>
        </tr>
      ))}
    </Table>
  );
}

/** "Jobs & payouts" tab: the office's jobs and, for staff who may see money, what is owed to / paid to it. */
export function OfficeJobsTab({ id }: { id: string }) {
  const { t } = useI18n();
  const { data: o } = useApi(`/admin/offices/${id}`);
  return (
    <div className="space-y-6">
      <Section title={t("office.jobs_title")} description={t("rdq.jobs_sub")} flush><JobsTable endpoint={`/admin/offices/${id}/jobs`} showDriver testid="rdq-office-job" /></Section>
      {o?.money && <Section title={t("rdq.tab_payouts")} description={t("rdq.payouts_sub")} flush><PayoutsTable officeId={id} /></Section>}
    </div>
  );
}

