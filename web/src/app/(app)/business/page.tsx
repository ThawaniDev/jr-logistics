"use client";
import Link from "next/link";
import { FilePlus2, ListChecks, Wallet, CheckCircle2, Clock, ShieldAlert } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Notice, PageHeader, PageLoading, Stat, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";

export default function BusinessDashboard() {
  const { t, locale } = useI18n(); const me = useUser();
  const ov = useApi("/business/overview"); const reqs = useApi("/requests?pageSize=6"); const wal = useApi("/wallet");
  if (ov.error) return <ErrorState error={ov.error} retry={() => ov.mutate()} />;
  if (!ov.data || !reqs.data || !wal.data) return <PageLoading />;
  const r = ov.data.requests as Record<string, number>;
  const active = (r.published ?? 0) + (r.filling ?? 0) + (r.assigned ?? 0) + (r.confirmed ?? 0) + (r.in_progress ?? 0);
  const verified = ov.data.verificationStatus === "verified";
  return (
    <>
      <PageHeader title={t("biz.welcome", { name: me.name })} subtitle={t("biz.sub")} actions={<Link href="/business/requests/new"><Button disabled={!verified}><FilePlus2 className="size-4" />{t("nav.new_request")}</Button></Link>} />
      {!verified && <div className="mb-5"><Notice tone="warn" title={t(`verify.${ov.data.verificationStatus}_title`)}>{t(`verify.${ov.data.verificationStatus}_body`)} <Link href="/business/documents" className="font-semibold text-cyan underline">{t("verify.go_documents")}</Link></Notice></div>}
      {verified && wal.data.availableCents < 10000 && <div className="mb-5"><Notice tone="info">{t("biz.low_funds")} <Link href="/business/wallet" className="font-semibold text-cyan underline">{t("wallet.topup")}</Link></Notice></div>}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("biz.active")} value={active} icon={<Clock className="size-5" />} tone="cyan" />
        <Stat label={t("biz.completed")} value={r.completed ?? 0} icon={<CheckCircle2 className="size-5" />} />
        <Stat label={t("wallet.available")} value={<span className="ltr-num">{fmtMoney(wal.data.availableCents, locale)}</span>} icon={<Wallet className="size-5" />} tone="gold" />
        <Stat label={t("biz.spent")} value={<span className="ltr-num">{fmtMoney(ov.data.totalSpentCents, locale)}</span>} icon={<ListChecks className="size-5" />} tone="muted" />
      </div>
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{t("biz.recent")}</h2><Link href="/business/requests" className="text-sm text-cyan hover:underline">{t("common.view_all")}</Link></div>
      {reqs.data.items.length === 0 ? <EmptyState title={t("biz.no_requests")} hint={t("biz.no_requests_hint")} action={<Link href="/business/requests/new"><Button disabled={!verified}>{t("nav.new_request")}</Button></Link>} /> : (
        <Table head={[t("req.ref"), t("req.service"), t("req.starts"), t("req.slots"), t("common.status")]}>
          {reqs.data.items.map((x: any) => <tr key={x.id} className="hover:bg-bg2/60"><Td><Link href={`/business/requests/${x.id}`} className="ltr-num font-semibold text-accent hover:underline">{x.ref}</Link></Td><Td>{t(`svc.${x.service}`)}</Td><Td className="text-muted">{fmtDateTime(x.startsAt, locale)}</Td><Td className="tabular-nums">{x.slotsFilled}/{x.quantity}</Td><Td><StatusBadge status={x.status} /></Td></tr>)}
        </Table>
      )}
    </>
  );
}
