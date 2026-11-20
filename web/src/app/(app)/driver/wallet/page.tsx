"use client";
import { ErrorState, Notice, PageLoading } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { WalletPage } from "@/components/features/wallet";
import { ManagedWallet } from "@/components/features/driver-wallet-managed";
import { useI18n } from "@/i18n/provider";

export default function Page() {
  const { t } = useI18n();
  // The same key as the top bar's wallet chip (one request). J4: a driver of an office has no wallet to show, only who manages it and his cash.
  const { data, error, mutate } = useApi("/wallet", { refreshInterval: 60_000 });
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  if (data.managedByOffice) return <ManagedWallet officeName={data.officeName ?? null} />;
  // E18: no review / approval step — the earnings arrive in this wallet as soon as a job ends.
  // The wallet owns its page header; the note is placed right under it (flex order) instead of above it.
  return (
    <div className="flex flex-col [&>header]:order-first">
      <div className="order-[-1] mb-5" data-testid="wallet-auto-note"><Notice tone="info">{t("fod.wallet_auto_note")}</Notice></div>
      <WalletPage />
    </div>
  );
}
