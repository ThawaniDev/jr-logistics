"use client";
import Link from "next/link";
import { HandCoins } from "lucide-react";
import { Badge, EmptyState, ErrorState, Notice, PageHeader, PageLoading, Section } from "@/components/ui";
import { CashTotals } from "@/components/features/driver-cash-totals";
import { useApi } from "@/components/ui/data";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import type { CashSummary } from "@/components/features/driver-fieldops-utils";

/** E17 — cash on delivery the driver collected and has not yet handed to the warehouse ("Cash with me"). The warehouse records what it receives. */
export default function CashWithMe() {
  const { t, locale } = useI18n();
  const { data, error, mutate } = useApi<CashSummary>("/driver/cash", { refreshInterval: 60_000, revalidateOnFocus: true });
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const money = (c: number) => <span className="ltr-num">{fmtMoney(c, locale)}</span>;
  const orders = data.orders ?? []; const recent = data.recent ?? [];
  return (
    <>
      <PageHeader title={t("nav.cash_with_me")} subtitle={t("fod.cash_sub")} />
      <div className="mb-5"><Notice tone="info" title={t("fod.cash_explain_title")}>{t("fod.cash_explain")}</Notice></div>

      <div className="mb-8"><CashTotals data={data} /></div>

      <h2 className="mb-3 font-semibold">{t("fod.cash_orders")}</h2>
      {orders.length === 0 ? <div className="mb-8"><EmptyState icon={<HandCoins className="size-9" />} title={t("fod.cash_orders_empty")} hint={t("fod.cash_orders_empty_hint")} /></div> : (
        <ul className="mb-8 grid gap-3 lg:grid-cols-2" data-testid="cash-orders">
          {orders.map((o) => (
            <li key={o.offerId} data-testid="cash-row" data-ref={o.ref} data-outstanding={o.outstandingCents} className="space-y-3 rounded-card border border-line bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><Link href={`/driver/jobs/${o.offerId}`} className="ltr-num font-semibold text-cyan underline">{o.ref}</Link>{o.businessName && <p className="text-xs text-muted">{o.businessName}</p>}</div>
                {o.outstandingCents > 0 ? <Badge tone="warn">{t("fod.cash_with_me")}: <span className="ltr-num">{fmtMoney(o.outstandingCents, locale)}</span></Badge> : <Badge tone="success">{t("fod.cash_settled")}</Badge>}
              </div>
              <dl className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-xl bg-bg2 p-2"><dt className="text-[11px] text-muted">{t("fod.cash_parcels")}</dt><dd className="ltr-num font-bold">{fmtNum(o.parcels, locale)}</dd></div>
                <div className="rounded-xl bg-bg2 p-2"><dt className="text-[11px] text-muted">{t("fod.cash_collected")}</dt><dd className="font-bold">{money(o.collectedCents)}</dd></div>
                <div className="rounded-xl bg-bg2 p-2"><dt className="text-[11px] text-muted">{t("fod.cash_received")}</dt><dd className="font-bold">{money(o.receivedCents)}</dd></div>
              </dl>
              {o.lastCollectedAt && <p className="text-xs text-muted">{t("fod.cash_last", { when: fmtDateTime(o.lastCollectedAt, locale) })}</p>}
            </li>
          ))}
        </ul>
      )}

      <Section title={t("fod.cash_recent")} flush>
        {recent.length === 0 ? <p className="p-5 text-sm text-muted">{t("fod.cash_recent_empty")}</p> : (
          <ul className="divide-y divide-line" data-testid="cash-recent">
            {recent.map((r) => (
              <li key={r.id} data-testid="cash-recent-row" data-ref={r.ref} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div className="min-w-0"><p className="font-medium"><span className="ltr-num">{r.ref}</span>{r.receivedByName && <span className="text-muted"> · {t("fod.cash_received_by", { name: r.receivedByName })}</span>}</p>{r.note && <p className="text-xs text-muted">{r.note}</p>}<p className="text-xs text-muted">{fmtDateTime(r.createdAt, locale)}</p></div>
                <span className="ltr-num font-bold text-accent">{fmtMoney(r.amountCents, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
