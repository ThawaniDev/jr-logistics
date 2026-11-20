"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { fmtPercent, formatValue, type ValueFormat } from "./chartTheme";
import { ChangePill } from "./Delta";

export interface BarRow { key: string; label: ReactNode; sub?: ReactNode; value: number | null; prev?: number | null; share?: number | null; href?: string; tone?: "accent" | "cyan" | "gold" | "danger" }
const BAR = { accent: "bg-accent", cyan: "bg-cyan", gold: "bg-gold", danger: "bg-danger" } as const;

/** The shared row layout of BreakdownTable and RankedList: label (+ sub-line), a bar scaled to the largest value, the value, an optional share and change pill. */
export function BarRows({ rows, format, ranked, showShare, good, label }: { rows: BarRow[]; format: ValueFormat; ranked?: boolean; showShare?: boolean; good?: "higher" | "lower" | "neutral"; label: string }) {
  const { locale } = useI18n();
  const max = Math.max(0, ...rows.map((r) => r.value ?? 0));
  const List = ranked ? "ol" : "ul";
  return (
    <List aria-label={label} className="space-y-3">
      {rows.map((r, i) => {
        const name = r.href ? <Link href={r.href} className="text-accent hover:underline">{r.label}</Link> : r.label;
        return (
          <li key={r.key} className="min-w-0">
            <div className="flex items-baseline gap-2">
              {ranked && <span className="ltr-num w-5 shrink-0 text-xs tabular-nums text-muted">{i + 1}</span>}
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{name}</p>{r.sub && <p className="truncate text-xs text-muted">{r.sub}</p>}</div>
              <span className="ltr-num shrink-0 text-sm font-semibold tabular-nums">{formatValue(r.value, format, locale)}</span>
              {showShare && <span className="ltr-num w-11 shrink-0 text-end text-xs tabular-nums text-muted">{r.share == null ? "—" : fmtPercent(r.share, locale, 0)}</span>}
              {r.prev !== undefined && <span className="hidden w-[4.5rem] shrink-0 justify-end sm:flex"><ChangePill value={r.value} prev={r.prev} good={good} /></span>}
            </div>
            <div className={cn("mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/60", ranked && "ms-7")} aria-hidden><div className={cn("h-full rounded-full", BAR[r.tone ?? "accent"])} style={{ width: `${max > 0 ? Math.max(2, ((r.value ?? 0) / max) * 100) : 0}%` }} /></div>
            {r.prev !== undefined && <div className="mt-1 flex justify-end sm:hidden"><ChangePill value={r.value} prev={r.prev} good={good} /></div>}
          </li>
        );
      })}
    </List>
  );
}
