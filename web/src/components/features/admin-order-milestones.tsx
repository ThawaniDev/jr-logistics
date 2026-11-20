"use client";
import { Check, Circle } from "lucide-react";
import { Section } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/format";
import { fmtDur } from "@/components/reports/chartTheme";
import { useI18n } from "@/i18n/provider";

export interface MilestoneRow { key: string; at: string | null; fromPrevS: number | null; sinceCreatedS: number | null }

/** The order's life as milestones, each with the time it took since the previous one that was reached (created → published → first offer → … → completed or cancelled). */
export function MilestoneList({ items, closed }: { items: MilestoneRow[]; closed: string | null }) {
  const { t, locale } = useI18n();
  const reached = items.filter((m) => m.at).length;
  const last = [...items].reverse().find((m) => m.at);
  const total = last?.sinceCreatedS ?? null;
  return (
    <Section title={t("dv1.milestones_title")} description={total != null && reached > 1 ? t("dv1.milestones_total", { time: fmtDur(total, locale) }) : t("dv1.milestones_sub")} id="order-milestones">
      <ol className="relative space-y-3 border-s border-line ps-6" data-testid="dv1-milestones">
        {items.map((m) => {
          const label = m.key === "closed" ? t(closed ? `dv1.ms_closed_${closed}` : "dv1.ms_closed_none") : t(`dv1.ms_${m.key}`);
          return (
            <li key={m.key} className="relative flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5" data-milestone={m.key} data-reached={m.at ? "1" : "0"}>
              <span className={cn("absolute -start-[33px] top-0.5 flex size-5 items-center justify-center rounded-full ring-4 ring-card", m.at ? "bg-accent text-accent-ink" : "bg-line text-muted")} aria-hidden>{m.at ? <Check className="size-3" /> : <Circle className="size-2" />}</span>
              <span className={cn("text-sm font-medium", !m.at && "text-muted")}>{label}</span>
              <span className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted">
                {m.at ? <><span>{fmtDateTime(m.at, locale)}</span>{m.fromPrevS != null && <span className="ltr-num rounded-full bg-line/50 px-2 py-0.5 tabular-nums" title={t("dv1.since_previous")}>+{fmtDur(Math.max(0, m.fromPrevS), locale)}</span>}</> : <span>{t("dv1.not_reached")}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
