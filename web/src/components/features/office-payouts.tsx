"use client";
import { BadgeCheck, Coins, Hourglass } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { WalletPage } from "./wallet";

/**
 * Payouts: the shared wallet (balance, withdrawal request, statement) with the office's settlement pipeline under its header —
 * money still in review, approved and waiting, and paid into the wallet — each linking to the settlements behind it.
 * The wallet component owns its own header, so the strip is placed right after it with flex `order` instead of editing the shared file.
 */
export function OfficePayouts() {
  const { t, locale } = useI18n();
  const { data } = useApi<{ money: { pendingCents: number; approvedCents: number; paidCents: number } }>("/office/reports");
  const m = data?.money;
  const money = (c: number | undefined) => (c == null ? "—" : <span className="ltr-num">{fmtMoney(c, locale)}</span>);
  return (
    <div className="flex flex-col [&>header]:order-first">
      <section aria-label={t("rdo.pay_pipeline")} className="order-[-1] mb-4">
        <StatGrid cols={3}>
          <Stat label={t("office.money_pending")} value={money(m?.pendingCents)} loading={!m} icon={<Hourglass className="size-5" />} tone="gold" hint={t("rdo.set_pending_hint")} href="/office/settlements?status=pending_review" />
          <Stat label={t("office.money_approved")} value={money(m?.approvedCents)} loading={!m} icon={<BadgeCheck className="size-5" />} tone="cyan" hint={t("rdo.set_approved_hint")} href="/office/settlements?status=approved" />
          <Stat label={t("office.paid_total")} value={money(m?.paidCents)} loading={!m} icon={<Coins className="size-5" />} hint={t("rdo.pay_paid_hint")} href="/office/settlements?status=paid" />
        </StatGrid>
      </section>
      <WalletPage />
    </div>
  );
}
