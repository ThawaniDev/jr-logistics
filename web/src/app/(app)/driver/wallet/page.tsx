"use client";
import { Notice } from "@/components/ui";
import { WalletPage } from "@/components/features/wallet";
import { useI18n } from "@/i18n/provider";

export default function Page() {
  const { t } = useI18n();
  // E18: no review / approval step — the earnings arrive in this wallet as soon as a job ends.
  // The wallet owns its page header; the note is placed right under it (flex order) instead of above it.
  return (
    <div className="flex flex-col [&>header]:order-first">
      <div className="order-[-1] mb-5" data-testid="wallet-auto-note"><Notice tone="info">{t("fod.wallet_auto_note")}</Notice></div>
      <WalletPage />
    </div>
  );
}
