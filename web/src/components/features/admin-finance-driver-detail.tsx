"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Banknote, Coins, Download, Hourglass, Loader2, Package, Wallet } from "lucide-react";
import { Badge, Breadcrumbs, DetailHeader, ErrorState, Notice, PageLoading, Section, Stat, StatGrid, StatusBadge, Tabs } from "@/components/ui";
import { useApi, useUrlPatch } from "@/components/ui/data";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { API_PREFIX } from "@/components/reports/fleet/fleet-lib";
import { useDownload } from "@/components/reports/fleet/useDownload";
import { hasAny, useTx } from "./admin-common";
import { CashTab, LedgerTab, SettlementsTab, StatementTab, WithdrawalsTab, type TabKey } from "./admin-finance-driver-tabs";
import { Money } from "./admin-finance-drivers-table";
import { FinPeriod, type PeriodParams } from "./fin-period";
import { NoAccess } from "./admin-finance-parts";

const TABS: TabKey[] = ["statement", "settlements", "ledger", "withdrawals", "cash"];
/** `from=…&to=…`, `period=all` or nothing (the default 30 days): the period part of every request of this page. */
export const periodString = (p: PeriodParams): string => (p.period === "all" ? "period=all" : p.from && p.to ? `from=${p.from}&to=${p.to}` : "");

/** `/admin/finance/drivers/:id`: one driver's money — summary cards (the figures of the list row), then Statement · Settlements · Wallet ledger · Withdrawals · Cash on delivery for the chosen period. */
export function FinanceDriverDetail({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx(); const sp = useSearchParams(); const patch = useUrlPatch(); const dl = useDownload();
  const per: PeriodParams = { from: sp.get("from") ?? "", to: sp.get("to") ?? "", period: sp.get("period") ?? "" };
  const tabRaw = sp.get("tab") ?? "statement"; const tab: TabKey = (TABS as string[]).includes(tabRaw) ? (tabRaw as TabKey) : "statement";
  const period = periodString(per); const canView = hasPerm(me, "finance.view");
  const { data, error, mutate } = useApi(canView ? `/admin/finance/drivers/${id}${period ? `?${period}` : ""}` : null, { keepPreviousData: true, shouldRetryOnError: false });
  const crumbs = (name: string) => [{ label: t("nav.finance"), href: "/admin/finance" }, { label: t("nav.fin_drivers"), href: "/admin/finance/drivers" }, { label: name }];
  if (!canView) return <NoAccess title={t("nav.fin_drivers")} />;
  if (error && !data) return <><Breadcrumbs items={crumbs("…")} /><ErrorState error={error} retry={() => mutate()} /></>;
  if (!data) return <PageLoading />;
  const d = data.driver as Record<string, any>; const counts = data.counts as Record<TabKey, number>; const via = !!d.paidViaOffice;
  const m = (c: number | null | undefined, testId: string) => <span data-testid={testId}><Money c={c ?? 0} /></span>;
  const range = data.period.mode === "all" ? t("fdr.period_all") : `${fmtDate(`${data.period.from}T12:00:00+03:00`, locale)} – ${fmtDate(`${data.period.to}T12:00:00+03:00`, locale)}`;
  const fullHref = `${API_PREFIX}/admin/finance/drivers/${id}/statement?${period ? `${period}&` : ""}format=xlsx&lang=${locale}`;
  const preparing = dl.busy === "full";
  return (
    <>
      <Breadcrumbs items={crumbs(String(d.name))} />
      <div data-testid="fdd-header">
        <DetailHeader name={String(d.name)}
          subtitle={<span className="inline-flex flex-wrap items-center gap-x-2">{d.username && <span className="ltr-num" dir="ltr" data-testid="fdd-username">{d.username}</span>}{d.phone && <span className="ltr-num" dir="ltr">· {d.phone}</span>}{d.city && <span>· {tx(`city.${d.city}`, d.city)}</span>}</span>}
          badges={<><StatusBadge status={d.status} />{d.verification && <StatusBadge status={d.verification} />}</>}
          facts={[
            { label: t("fdr.col_officeName"), value: d.officeId ? (hasAny(me, "offices.view", "offices.manage") ? <Link href={`/admin/offices/${d.officeId}`} className="text-accent hover:underline" data-testid="fdd-office">{d.officeName ?? "—"}</Link> : d.officeName ?? "—") : <span data-testid="fdd-office"><Badge>{t("fdr.independent")}</Badge></span> },
            { label: t("fdr.col_lastPayoutAt"), value: d.lastPayoutAt ? fmtDate(d.lastPayoutAt, locale) : "—" },
            { label: t("fdr.col_lastJobAt"), value: d.lastJobAt ? fmtDate(d.lastJobAt, locale) : "—" },
          ]}
          actions={<>
            {hasAny(me, "drivers.view") && <Link href={`/admin/drivers/${id}`} className="jr-tap inline-flex h-9 items-center rounded-xl border border-line bg-bg2 px-3 text-sm hover:bg-card" data-testid="fdd-open-driver">{t("fdr.open_driver")}</Link>}
            <span title={hasPerm(me, "reports.export") ? undefined : t("fr.export_needs_perm")} className="inline-flex">
              <button type="button" disabled={!hasPerm(me, "reports.export") || !!dl.busy} onClick={() => dl.run("full", fullHref, "finance-driver-statement.xlsx")} data-testid="fdd-download-full"
                className="jr-tap inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl bg-accent px-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                {preparing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}{preparing ? t("fdr.dl_preparing") : t("fdr.dl_full")}
              </button>
            </span></>} />
      </div>
      {via && <div className="mb-4"><Notice tone="info"><span data-testid="fdd-via-office">{t("fdr.via_office_note", { office: String(d.officeName ?? "") })}</span></Notice></div>}
      <div className="mb-4 rounded-card border border-line bg-card p-3 sm:p-4"><FinPeriod value={per} onChange={(p) => patch({ from: p.from, to: p.to, period: p.period })} testId="fdd-period" /></div>
      <div className="mb-5 space-y-4" data-testid="fdd-cards">
        <Section title={t("fdr.grp_wallet")}>
          <StatGrid cols={4}>
            <Stat label={t("fdr.col_walletAvailableCents")} value={via ? <span className="text-base text-muted">{t("fdr.paid_via_office")}</span> : m(d.walletAvailableCents, "fdd-wallet-available")} icon={<Wallet className="size-5" />} tone="accent" />
            <Stat label={t("fdr.col_walletHeldCents")} value={via ? <span className="text-base text-muted">—</span> : m(d.walletHeldCents, "fdd-wallet-held")} hint={t("wallet.held_hint")} tone={d.walletHeldCents ? "gold" : "muted"} />
            <Stat label={t("fdr.col_walletPendingCents")} value={via ? <span className="text-base text-muted">—</span> : m(d.walletPendingCents, "fdd-wallet-pending")} icon={<Hourglass className="size-5" />} tone={d.walletPendingCents ? "gold" : "muted"} />
            <Stat label={t("fdr.col_cashHeldCents")} value={m(d.cashHeldCents, "fdd-cash-held")} icon={<Coins className="size-5" />} tone={d.cashHeldCents ? "gold" : "muted"} hint={t("fdr.cash_held_hint", { collected: fmtMoney(d.cashCollectedCents, locale), remitted: fmtMoney(d.cashRemittedCents, locale) })} />
          </StatGrid>
        </Section>
        <Section title={t("fdr.grp_lifetime")}>
          <StatGrid cols={4}>
            <Stat label={t("fdr.col_earnedCents")} value={m(d.earnedCents, "fdd-earned")} icon={<Banknote className="size-5" />} tone="cyan" hint={t("fdr.jobs_parcels", { jobs: fmtNum(d.jobs, locale), parcels: fmtNum(d.delivered, locale) })} />
            <Stat label={t("fdr.col_paidCents")} value={m(d.paidCents, "fdd-paid")} tone="accent" hint={via ? t("fdr.paid_to_office_hint") : undefined} />
            <Stat label={t("fdr.col_pendingCents")} value={m(d.pendingCents, "fdd-pending")} icon={<Hourglass className="size-5" />} tone={d.pendingCents ? "gold" : "muted"} hint={d.payoutFailedCents ? t("fdr.payout_failed_hint", { amount: fmtMoney(d.payoutFailedCents, locale) }) : undefined} />
            <Stat label={t("fdr.col_wdPaidCents")} value={m(d.wdPaidCents, "fdd-wd-paid")} icon={<Package className="size-5" />} tone="muted" hint={t("fdr.wd_hint", { requested: fmtMoney(d.wdRequestedCents, locale), pending: fmtMoney(d.wdPendingCents, locale) })} />
          </StatGrid>
        </Section>
        <Section title={t("fdr.d_period_title", { range })}>
          <StatGrid cols={4}>
            <Stat label={t("fdr.col_periodEarnedCents")} value={m(d.periodEarnedCents, "fdd-p-earned")} tone="cyan" hint={t("fdr.jobs_parcels", { jobs: fmtNum(d.periodJobs, locale), parcels: fmtNum(d.periodParcels, locale) })} />
            <Stat label={t("fdr.col_periodPaidCents")} value={m(d.periodPaidCents, "fdd-p-paid")} tone="accent" />
            <Stat label={t("fdr.col_periodCashCollectedCents")} value={m(d.periodCashCollectedCents, "fdd-p-cash-collected")} tone="muted" />
            <Stat label={t("fdr.col_periodCashRemittedCents")} value={m(d.periodCashRemittedCents, "fdd-p-cash-remitted")} tone="muted" />
          </StatGrid>
        </Section>
      </div>
      <Tabs label={t("fdr.sections")} value={tab} onChange={(k) => patch({ tab: k === "statement" ? "" : k })} tabs={TABS.map((k) => ({ key: k, label: t(`fdr.tab_${k}`), count: counts[k] }))} />
      {tab === "statement" && <StatementTab key={`s${period}`} id={id} period={period} />}
      {tab === "settlements" && <SettlementsTab key={`e${period}`} id={id} period={period} />}
      {tab === "ledger" && <LedgerTab key={`l${period}`} id={id} period={period} />}
      {tab === "withdrawals" && <WithdrawalsTab key={`w${period}`} id={id} period={period} />}
      {tab === "cash" && <CashTab key={`c${period}`} id={id} period={period} />}
    </>
  );
}
