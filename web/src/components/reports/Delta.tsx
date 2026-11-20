"use client";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { deltaPctOf } from "@/server/analytics/kpi";
import { fmtSignedPct } from "./chartTheme";

export type DeltaTone = "good" | "bad" | "flat";
/** The change pill: arrow + text, green when the change is good, red when bad, grey when flat or neutral. The text always carries the sign, so colour is not the only signal. */
export function DeltaPill({ tone, dir, children, className }: { tone: DeltaTone; dir: "up" | "down" | "flat"; children: React.ReactNode; className?: string }) {
  const I = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  return <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-xs font-semibold", tone === "good" ? "bg-accent/10 text-accent" : tone === "bad" ? "bg-danger/10 text-danger" : "bg-line/50 text-muted", className)}><I className="size-3 rtl:-scale-x-100" aria-hidden /><span className="ltr-num">{children}</span></span>;
}
/** The relative change of `value` against `prev` as a pill ("+12.4%", "New" when there was nothing before, "—" when it cannot be told). `good`: which direction is an improvement. */
export function ChangePill({ value, prev, good = "higher" }: { value: number | null; prev: number | null; good?: "higher" | "lower" | "neutral" }) {
  const { t, locale } = useI18n();
  if (value == null || prev == null) return null;
  const pct = deltaPctOf(value, prev);
  if (pct == null) return value > prev ? <DeltaPill tone={good === "lower" ? "bad" : good === "neutral" ? "flat" : "good"} dir="up">{t("rpf.new")}</DeltaPill> : <DeltaPill tone="flat" dir="flat">—</DeltaPill>;
  const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const tone: DeltaTone = pct === 0 || good === "neutral" ? "flat" : (pct > 0) === (good === "higher") ? "good" : "bad";
  return <DeltaPill tone={tone} dir={dir}>{fmtSignedPct(pct, locale)}</DeltaPill>;
}
