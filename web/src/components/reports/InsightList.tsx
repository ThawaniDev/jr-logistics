"use client";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Lightbulb } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n/provider";
import type { Insight } from "@/server/analytics/insights";
import { ChartCard } from "./ChartCard";

const ICON = { good: CheckCircle2, bad: AlertTriangle, info: Lightbulb } as const;
const TONE = { good: "text-accent", bad: "text-danger", info: "text-cyan" } as const;

/** Server-generated observations (`Insight`): an icon by tone and a sentence from the dictionary; `refs` are translated first (KPI names, weekdays, cities). */
export function InsightList({ title, description, items, loading, testId }: { title: string; description?: string; items: Insight[]; loading?: boolean; testId?: string }) {
  const t = useT();
  return (
    <ChartCard title={title} description={description} height="auto" loading={loading} empty={!loading && items.length === 0} testId={testId}>
      <ul className="space-y-3">
        {items.map((i, n) => {
          const I = ICON[i.tone];
          const vars = { ...i.vars, ...Object.fromEntries(Object.entries(i.refs ?? {}).map(([k, v]) => [k, t(v)])) };
          const text = t(i.key, vars);
          return (
            <li key={`${i.key}-${n}`} className="flex items-start gap-3 text-sm">
              <I className={cn("mt-0.5 size-4 shrink-0", TONE[i.tone])} aria-hidden />
              <p className="min-w-0 flex-1 leading-relaxed">{i.href ? <Link href={i.href} className="hover:underline">{text}</Link> : text}</p>
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}
