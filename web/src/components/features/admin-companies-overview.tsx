"use client";
import Link from "next/link";
import { ArrowRight, CheckCircle2, FileCheck2, LifeBuoy, Lock, MapPin, Receipt, Truck, Wallet, Coins } from "lucide-react";
import { Badge, EmptyState, ErrorState, InfoGrid, ProgressBar, Section, Stat, StatGrid, StatusBadge, Table, Td, CellPair } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useTx } from "./admin-common";
import { companyTabs, companyTabHref } from "./admin-companies-lib";
import { useCompany } from "./admin-companies-ctx";

/** Overview tab: what needs attention (KPIs that link to the tab that handles it), the recent orders, and the account / warehouse state. */
export function CompanyOverview() {
  const { t, locale } = useI18n(); const me = useUser(); const c = useCompany(); const tx = useTx();
  const can = (p: string) => hasPerm(me, p);
  const tabs = companyTabs(can); const href = (k: Parameters<typeof companyTabHref>[1]) => (tabs.includes(k) ? companyTabHref(c.id, k) : undefined);
  const { data: o, error, mutate } = useApi(`/admin/companies/${c.id}/overview`, { shouldRetryOnError: false });
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  const load = !o; const money = (n?: number | null) => fmtMoney(n, locale);
  const seeOrders = can("requests.view"), seeWallet = can("finance.view") || can("wallets.view"), seeSpend = can("finance.view"), seeCod = can("cod.manage") || can("finance.view");
  const seeSupport = can("tickets.view") || can("complaints.manage"), seeDocs = can("documents.review") || can("verification.manage");
  const cases = o?.support ? (o.support.openTickets ?? 0) + (o.support.openComplaints ?? 0) : 0;
  const docs = o?.documents; const wallet = o?.wallet;
  const wh = c.profile.warehouse;
  return (
    <div className="space-y-5">
      <StatGrid cols={4}>
        {seeOrders && <Stat label={t("rdp.ov_active")} value={fmtNum(o?.orders.open, locale)} hint={o ? t("rdp.ov_active_hint", { n: fmtNum(o.orders.total, locale) }) : undefined} tone="cyan" icon={<Truck className="size-5" />} href={href("orders")} loading={load} />}
        {seeOrders && <Stat label={t("biz.completed")} value={fmtNum(o?.orders.completed, locale)} hint={o ? t("rdp.ov_lost_hint", { n: fmtNum(o.orders.lost, locale) }) : undefined} icon={<CheckCircle2 className="size-5" />} href={href("orders") && `${companyTabHref(c.id, "orders")}?status=completed`} loading={load} />}
        {seeSpend && <Stat label={t("rdp.ov_billed")} value={money(o?.spend?.billedCents)} hint={o?.spend ? t("rdp.ov_billed_hint", { n: fmtNum(o.spend.settlements, locale) }) : undefined} tone="gold" icon={<Receipt className="size-5" />} href={href("finance")} loading={load} />}
        {seeSupport && <Stat label={t("rdp.ov_cases")} value={fmtNum(cases, locale)} hint={o?.support ? t("rdp.ov_cases_hint", { t: fmtNum(o.support.openTickets ?? 0, locale), c: fmtNum(o.support.openComplaints ?? 0, locale) }) : undefined} tone={cases > 0 ? "danger" : "muted"} icon={<LifeBuoy className="size-5" />} href={can("tickets.view") ? `/admin/cases?q=${encodeURIComponent(c.contactName)}` : undefined} loading={load} />}
        {seeWallet && <Stat label={t("wallet.available")} value={money(wallet?.availableCents)} hint={wallet ? (wallet.creditLimitCents > 0 ? t("rdp.ov_credit_hint", { amount: money(wallet.creditLimitCents) }) : t("rdp.ov_wallet_hint")) : undefined} tone={(wallet?.availableCents ?? 0) < 0 ? "danger" : "accent"} icon={<Wallet className="size-5" />} href={href("finance")} loading={load} />}
        {seeWallet && <Stat label={t("wallet.reserved")} value={money(wallet?.reservedCents)} hint={wallet ? t("rdp.ov_held_hint", { amount: money(wallet.heldCents) }) : undefined} tone="muted" icon={<Lock className="size-5" />} href={href("finance")} loading={load} />}
        {seeCod && <Stat label={t("rdp.ov_cod")} value={money(o?.cod?.outstandingCents)} hint={o?.cod ? t("rdp.ov_cod_hint", { amount: money(o.cod.collectedCents) }) : undefined} tone={(o?.cod?.outstandingCents ?? 0) > 0 ? "gold" : "muted"} icon={<Coins className="size-5" />} href={href("finance")} loading={load} />}
        {seeDocs && <Stat label={t("verify.documents")} value={docs ? `${docs.requiredApproved}/${docs.requiredTotal}` : "—"} hint={docs ? (docs.toReview > 0 ? t("rdp.ov_docs_review", { n: fmtNum(docs.toReview, locale) }) : t("rdp.ov_docs_hint")) : undefined} tone={docs && docs.requiredApproved < docs.requiredTotal ? "gold" : "accent"} icon={<FileCheck2 className="size-5" />} href={href("documents")} loading={load} />}
      </StatGrid>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
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
        </div>
        <div className="space-y-5">
          <Section title={t("rdp.account_section")}>
            <InfoGrid cols={1} items={[
              { label: t("verify.title"), value: <StatusBadge status={c.profile.verificationStatus} /> },
              { label: t("rdp.account_state"), value: c.status === "suspended" ? <Badge tone="danger">{t("rdp.account_suspended")}</Badge> : <StatusBadge status={c.status} /> },
              ...(c.profile.verificationNote ? [{ label: t("rdp.last_note"), value: c.profile.verificationNote }] : []),
              { label: t("rdp.api_webhook"), value: c.profile.hasWebhook ? <Badge tone="success">{t("rdp.webhook_on")}</Badge> : <Badge>{t("rdp.webhook_off")}</Badge> },
            ]} />
            {docs && docs.requiredTotal > 0 && <div className="mt-4"><div className="mb-1.5 flex items-center justify-between text-xs text-muted"><span>{t("ubz.docs_progress", { done: docs.requiredApproved, total: docs.requiredTotal })}</span></div><ProgressBar value={docs.requiredApproved} max={docs.requiredTotal} tone={docs.requiredApproved < docs.requiredTotal ? "gold" : "accent"} label={t("verify.documents")} /></div>}
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
