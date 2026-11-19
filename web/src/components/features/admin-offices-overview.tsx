"use client";
import Link from "next/link";
import { CheckCircle2, Handshake, Receipt, Truck, Wallet, CircleDollarSign, CircleAlert } from "lucide-react";
import { ErrorState, InfoGrid, Notice, PageLoading, ProgressBar, Section, Stat, StatGrid, StatusBadge } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, useTx } from "./admin-common";
import { AgreementBadge, Money } from "./admin-offices-common";
import { agreementView, issueKey } from "./admin-offices-lib";

/** Overview tab: what needs attention (KPIs that open the matching tab), readiness to receive jobs, and the office's details. */
export function OfficeOverview({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const { data: o, error, mutate } = useApi(`/admin/offices/${id}`);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!o) return <PageLoading />;
  const base = `/admin/offices/${id}`; const m = o.money; const c = o.counts; const view = agreementView(o.agreement?.status, o.agreement?.expiresAt);
  const canAgreements = hasAny(me, "offices.view"), canDocs = hasAny(me, "documents.review", "verification.manage");
  const canFleet = hasAny(me, "offices.view", "offices.manage", "drivers.view"), canJobs = hasAny(me, "offices.view", "offices.manage");
  const docs = o.documents; const docsDone = docs && docs.approved === docs.required;
  const checks: Array<{ label: string; ok: boolean; value: React.ReactNode; href?: string }> = [
    { label: t("verify.title"), ok: o.verificationStatus === "verified", value: <StatusBadge status={o.verificationStatus} /> },
    { label: t("common.status"), ok: o.status === "active", value: <StatusBadge status={o.status} /> },
    ...(docs ? [{ label: t("verify.documents"), ok: !!docsDone, value: <span className="ltr-num">{docs.approved}/{docs.required}</span>, href: canDocs ? `${base}/documents` : undefined }] : []),
    { label: t("nav.agreement"), ok: view.key === "accepted", value: <AgreementBadge status={o.agreement?.status} expiresAt={o.agreement?.expiresAt} />, href: canAgreements ? `${base}/agreements` : undefined },
  ];
  return (
    <div className="space-y-5">
      <section aria-label={t("rdq.kpis")}>
        <StatGrid cols={m ? 6 : 3}>
          <Stat label={t("req.drivers")} value={c.drivers} icon={<Truck className="size-5" />} href={canFleet ? `${base}/drivers` : undefined} tone="cyan" hint={t("rdq.drivers_hint", { available: c.availableDrivers, busy: c.onJob })} />
          <Stat label={t("office.active_jobs")} value={c.activeJobs} icon={<Receipt className="size-5" />} href={canJobs ? `${base}/jobs` : undefined} hint={t("rdq.jobs_done_hint", { n: c.completedJobs })} tone={c.activeJobs ? "accent" : "muted"} />
          {m && <Stat label={t("rdq.kpi_pending_payouts")} value={<Money cents={m.pendingPayoutCents} />} icon={<CircleDollarSign className="size-5" />} href={canJobs ? `${base}/jobs` : undefined} hint={t("rdq.n_settlements", { n: m.pendingCount })} tone={m.pendingPayoutCents ? "gold" : "muted"} />}
          {m && <Stat label={t("office.paid_total")} value={<Money cents={m.paidCents} />} icon={<CheckCircle2 className="size-5" />} href={canJobs ? `${base}/jobs` : undefined} hint={t("rdq.n_settlements", { n: m.paidCount })} tone="accent" />}
          {m && <Stat label={t("office.wallet_balance")} value={<Money cents={m.walletAvailableCents} />} icon={<Wallet className="size-5" />} hint={m.walletHeldCents ? t("rdq.wallet_held", { amount: fmtMoney(m.walletHeldCents, locale) }) : t("wallet.available")} tone="cyan" />}
          <Stat label={t("nav.agreement")} value={t(view.label)} icon={<Handshake className="size-5" />} href={canAgreements ? `${base}/agreements` : undefined} hint={o.agreement ? t("office.agreement_v", { v: o.agreement.version }) : t("office.no_agreement")} tone={view.tone === "success" ? "accent" : view.tone === "warn" ? "gold" : view.tone === "danger" ? "danger" : "muted"} />
        </StatGrid>
      </section>

      {o.readiness.ready
        ? <Notice tone="success" title={t("rdq.ready_title")}>{t("rdq.ready_body")}</Notice>
        : <Notice tone="warn" title={t("rdq.not_ready_title")}><ul className="list-disc ps-5">{o.readiness.issues.map((i: string) => <li key={i}>{t(issueKey(i))}</li>)}</ul></Notice>}
      {o.verificationNote && <Notice tone="info" title={t("verify.note")}>{o.verificationNote}</Notice>}

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={t("adm.details")} className="lg:col-span-2" id="rdq-office-details">
          <InfoGrid cols={2} items={[
            { label: t("reg.office_name"), value: o.officeName },
            { label: t("rdq.contact_person"), value: o.contact },
            { label: t("auth.phone"), value: <span className="ltr-num">{o.phone ?? "—"}</span> },
            { label: t("rdq.email"), value: <span className="ltr-num">{o.email ?? "—"}</span> },
            { label: t("reg.cr"), value: <span className="ltr-num">{o.crNumber ?? "—"}</span> },
            { label: t("reg.city"), value: tx(`city.${o.city}`, o.city) },
            { label: t("reg.address"), value: o.address ?? "—" },
            { label: t("rdq.col_joined"), value: fmtDate(o.createdAt, locale) },
            ...(o.taxNumber !== undefined ? [{ label: t("reg.tax"), value: <span className="ltr-num">{o.taxNumber ?? "—"}</span> }] : []),
            ...(o.iban !== undefined ? [{ label: t("rdq.bank"), value: <span className="ltr-num">{[o.bankName, o.iban].filter(Boolean).join(" · ") || "—"}</span> }] : []),
          ]} />
        </Section>
        <Section title={t("rdq.readiness")} description={t("rdq.readiness_sub")}>
          <ul className="space-y-3 text-sm" data-testid="rdq-office-checklist">
            {checks.map((k) => (
              <li key={k.label} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">{k.ok ? <CheckCircle2 className="size-4 text-accent" aria-hidden /> : <CircleAlert className="size-4 text-gold" aria-hidden />}{k.href ? <Link href={k.href} className="hover:underline">{k.label}</Link> : k.label}</span>
                {k.value}
              </li>
            ))}
          </ul>
          {docs && <div className="mt-4"><ProgressBar value={docs.approved} max={Math.max(docs.required, 1)} tone={docsDone ? "accent" : "gold"} label={t("ubz.docs_progress", { done: docs.approved, total: docs.required })} /><p className="mt-1.5 text-xs text-muted">{t("ubz.docs_progress", { done: docs.approved, total: docs.required })}</p></div>}
        </Section>
      </div>
    </div>
  );
}
