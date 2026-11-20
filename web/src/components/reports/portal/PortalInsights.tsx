"use client";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Lightbulb } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import type { Insight } from "@/server/analytics/portal-insights";
import { ChartCard } from "../ChartCard";
import { insightText } from "./lib";

const ICON = { good: CheckCircle2, bad: AlertTriangle, info: Lightbulb } as const;
const TONE = { good: "text-accent", bad: "text-danger", info: "text-cyan" } as const;

/** The generated observations of a portal report: like the Overview's list, but amounts are formatted as money in the viewer's language and cities as their names. */
export function PortalInsights({ title, description, items, cityName, testId = "insights" }: { title: string; description?: string; items: Insight[]; cityName?: (key: string) => string | undefined; testId?: string }) {
  const { t, locale } = useI18n();
  return (
    <ChartCard testId={testId} title={title} description={description} height="auto" empty={items.length === 0} name={title}>
      <ul className="space-y-3">
        {items.map((i, n) => {
          const I = ICON[i.tone], text = insightText(i, t, locale, cityName);
          return (
            <li key={`${i.key}-${n}`} className="flex items-start gap-3 text-sm" data-testid={`${testId}-item`}>
              <I className={cn("mt-0.5 size-4 shrink-0", TONE[i.tone])} aria-hidden />
              <p className="min-w-0 flex-1 leading-relaxed">{i.href ? <Link href={i.href} className="hover:underline">{text}</Link> : text}</p>
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}
