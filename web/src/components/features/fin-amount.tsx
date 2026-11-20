"use client";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";

const TAG = { en: "en-GB", ur: "ur-PK-u-nu-latn", ar: "ar-SA-u-nu-latn-ca-gregory" } as const;
/** An amount (halalas in) without the currency, two decimals, digits kept left-to-right: keeps a table of money columns narrow. The page says "SAR" once. Zero is muted. */
export function Amount({ c, className }: { c: number | null | undefined; className?: string }) {
  const { locale } = useI18n();
  return <span className={cn("ltr-num tabular-nums", c === 0 && "text-muted", className)}>{new Intl.NumberFormat(TAG[locale as keyof typeof TAG] ?? TAG.en, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((c ?? 0) / 100)}</span>;
}
