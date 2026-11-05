"use client";
import { useI18n } from "@/i18n/provider";
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="bg-hero flex min-h-dvh flex-col items-center justify-center gap-4 px-5 text-center" role="alert">
      <h1 className="text-2xl font-bold">{t("common.error_title")}</h1><p className="text-muted">{t("err.INTERNAL")}</p>{error.digest && <p className="ltr-num text-xs text-muted">{error.digest}</p>}
      <button onClick={reset} className="rounded-xl bg-accent px-6 py-3 font-semibold text-accent-ink">{t("common.retry")}</button>
    </div>
  );
}
