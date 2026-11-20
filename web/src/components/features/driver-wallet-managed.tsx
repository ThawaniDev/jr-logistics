"use client";
import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";
import { Card, ErrorState, PageHeader, PageLoading } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { CashTotals } from "./driver-cash-totals";
import type { CashSummary } from "./driver-fieldops-utils";

/**
 * J4 — the wallet page of a driver who belongs to an office: one calm card saying who manages the wallet (no balance, no earnings, no withdrawals),
 * then the cash on delivery he holds, exactly as on "Cash with me".
 */
export function ManagedWallet({ officeName }: { officeName: string | null }) {
  const { t } = useI18n();
  const { data, error, mutate } = useApi<CashSummary>("/driver/cash", { refreshInterval: 60_000, revalidateOnFocus: true });
  const office = officeName ?? t("jd.your_office");
  return (
    <>
      <PageHeader title={t("jd.nav_wallet_cash")} subtitle={t("jd.wallet_sub")} />
      <Card data-testid="wallet-managed-card" className="mb-8 flex items-start gap-4 border-cyan/30 bg-cyan/5 p-5">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-cyan/15 text-cyan" aria-hidden><Building2 className="size-6" /></span>
        <div className="min-w-0 space-y-1.5">
          <h2 className="text-lg font-bold">{t("jd.managed_title")}</h2>
          <p className="text-sm text-muted">{t("jd.managed_body")}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-sm"><span className="text-muted">{t("jd.office_label")}:</span><span data-testid="wallet-managed-office" className="font-semibold">{office}</span></p>
          <p className="pt-1 text-sm font-medium">{t("jd.managed_hint")}</p>
        </div>
      </Card>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div><h2 className="font-semibold">{t("jd.cash_title")}</h2><p className="text-sm text-muted">{t("jd.cash_sub")}</p></div>
        <Link href="/driver/cash" data-testid="wallet-cash-link" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-cyan hover:underline">{t("jd.cash_open")}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></Link>
      </div>
      {error && !data ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : <CashTotals data={data} />}
    </>
  );
}
