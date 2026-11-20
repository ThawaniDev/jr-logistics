"use client";
import { useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inbox } from "lucide-react";
import { Button, ErrorState, Notice, PageLoading, Section } from "@/components/ui";
import { post } from "@/lib/api";
import { fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cityLabel, cityVerdict, fromOrdersHref, parseOrderIds, seedFrom, type OrdersManifest, type OrdersSeed } from "./partner-orders-lib";
import { BUSINESS_API, MixedCitiesBody, ProblemsNotice, useCityNames } from "./partner-orders-parts";

export { seedForm, type OrdersSeed } from "./partner-orders-lib";

const ORDERS_HOME = "/business/integrations/orders";

/**
 * Loads the manifest of the orders in the link once per visit (the editor then owns the rows) and hands the form its seed. Orders of several
 * cities are refused here as well (one delivery order serves one city), with a way to go on with one city's orders.
 */
export function OrdersPrefill({ raw, children }: { raw: string; children: (seed: OrdersSeed) => ReactNode }) {
  const { t } = useI18n(); const router = useRouter();
  const ids = useMemo(() => parseOrderIds(raw), [raw]);
  const [nonce] = useState(() => Date.now());
  const { data, error, mutate } = useSWR(ids.length ? `orders-manifest:${nonce}:${ids.join(",")}` : null, async () => {
    const m = await post<OrdersManifest>(`${BUSINESS_API}/orders/manifest`, { ids });
    return { m, seed: seedFrom(m) };
  }, { revalidateOnFocus: false, revalidateIfStale: false, revalidateOnReconnect: false });
  const back = <Link href={ORDERS_HOME}><Button variant="secondary" size="sm"><Inbox className="size-4" aria-hidden />{t("iord.prefill_back")}</Button></Link>;
  if (ids.length === 0) return <Notice tone="warn" title={t("iord.prefill_bad_link")}><div className="mt-2">{back}</div></Notice>;
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const { m, seed } = data;
  if (cityVerdict(m).kind === "mixed") {
    return <Section title={t("iord.mixed_title")}><MixedCitiesBody m={m} onPick={(pick) => router.replace(fromOrdersHref(pick))} /><div className="mt-4">{back}</div></Section>;
  }
  if (seed.rows.length === 0) {
    return <div className="space-y-4"><Notice tone="warn" title={t("iord.prefill_none")}>{t("iord.prefill_none_hint")}</Notice><ProblemsNotice problems={m.problems} /><div>{back}</div></div>;
  }
  return <>{children(seed)}</>;
}

/** Shown above the form: how many orders came in, the city that was set, and what still needs fixing in the parcel list. */
export function OrdersPrefillNotice({ seed }: { seed: OrdersSeed }) {
  const { t, locale } = useI18n(); const { names } = useCityNames();
  return (
    <div className="space-y-3" data-testid="orders-prefill">
      <Notice tone="info" title={t("iord.prefill_title", { n: fmtNum(seed.orders, locale) })}>
        {t("iord.prefill_body")}{" "}
        {seed.deliveryCity ? t("iord.prefill_city", { city: cityLabel(t, seed.deliveryCity, { ...seed.cityNames, ...names }) }) : t("iord.prefill_no_city")}{" "}
        <Link href={ORDERS_HOME} className="font-semibold text-cyan underline">{t("iord.prefill_back")}</Link>
      </Notice>
      <ProblemsNotice problems={seed.problems} />
    </div>
  );
}
