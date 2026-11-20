"use client";
import { Banknote, HandCoins, Wallet } from "lucide-react";
import { Stat, StatGrid } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import type { CashSummary } from "./driver-fieldops-utils";

/** The driver's cash on delivery in three numbers: collected · handed over to the warehouse · still with him. Shared by "Cash with me" and the office driver's wallet page. */
export function CashTotals({ data }: { data: Pick<CashSummary, "collectedCents" | "receivedCents" | "outstandingCents"> }) {
  const { t, locale } = useI18n();
  const money = (c: number) => <span className="ltr-num">{fmtMoney(c, locale)}</span>;
  return (
    <div data-testid="cash-totals">
      <StatGrid cols={3}>
        <div data-testid="cash-total-collected" data-value={data.collectedCents} className="[&>*]:h-full"><Stat label={t("fod.cash_collected")} value={money(data.collectedCents)} icon={<Banknote className="size-5" />} tone="cyan" hint={t("rdo.d_cash_collected_hint")} /></div>
        <div data-testid="cash-total-received" data-value={data.receivedCents} className="[&>*]:h-full"><Stat label={t("fod.cash_received")} value={money(data.receivedCents)} icon={<Wallet className="size-5" />} tone="accent" hint={t("rdo.d_cash_received_hint")} /></div>
        <div data-testid="cash-total-outstanding" data-value={data.outstandingCents} className="[&>*]:h-full"><Stat label={t("fod.cash_with_me")} value={money(data.outstandingCents)} hint={data.outstandingCents > 0 ? t("fod.cash_hand_over") : t("fod.cash_nothing")} icon={<HandCoins className="size-5" />} tone={data.outstandingCents > 0 ? "gold" : "muted"} /></div>
      </StatGrid>
    </div>
  );
}
