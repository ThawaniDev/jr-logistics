"use client";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { partyHref } from "./admin-finance-parts";

/** The company a rule is negotiated for, linked to its page (the name needs `users.view`; without it a plain "Business" badge). */
export function RuleScope({ id }: { id: string | null }) {
  const { t } = useI18n(); const me = useUser();
  const canName = hasPerm(me, "users.view");
  const { data } = useApi(id && canName ? `/admin/users/${id}` : null, { shouldRetryOnError: false });
  if (!id) return <Badge>{t("pricing.global")}</Badge>;
  const name = data?.profile?.companyName ?? data?.user?.name;
  return name ? <Link href={partyHref("business", id)!} className="inline-flex items-center gap-1 text-accent hover:underline"><Building2 className="size-3.5 shrink-0" aria-hidden />{name}</Link> : <Badge tone="info">{t("pricing.business")}</Badge>;
}

/** "Riyadh → Any" for the cities of a rule. */
export function useRuleRoute() {
  const { t } = useI18n();
  return (r: { pickupCity: string | null; deliveryCity: string | null }) => `${r.pickupCity ? t(`city.${r.pickupCity}`) : t("pricing.any")} → ${r.deliveryCity ? t(`city.${r.deliveryCity}`) : t("pricing.any")}`;
}

/** SAR text for an input from halalas ("12.50"), and back. */
export const centsToInput = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));
/** Percentage change from `a` to `b` (null when it cannot be computed). */
export const pctChange = (a: number, b: number): number | null => (a > 0 ? Math.round(((b - a) / a) * 1000) / 10 : null);
/** Margin as a share of the customer price (0–100), null without a price. */
export const marginPct = (price: number, cost: number): number | null => (price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : null);
