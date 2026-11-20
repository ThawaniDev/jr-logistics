"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { Badge, CellPair, StatusBadge } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { fmtDur, fmtPercent } from "../chartTheme";
import { fillHref, valueLabel } from "./explorer-lib";

/** One value of the explorer table, formatted by its column type (money in SAR, durations in the viewer's language, dates in Riyadh time, enums translated). */
export function Cell({ type, ns, href, value, row, long }: { type: string; ns?: string; href?: string; value: unknown; row: Record<string, unknown>; long?: boolean }): ReactNode {
  const { t, locale } = useI18n();
  if (value === null || value === undefined || value === "") return <span className="text-muted">—</span>;
  const num = (s: string) => <span className="ltr-num tabular-nums">{s}</span>;
  switch (type) {
    case "money": return num(fmtMoney(Number(value), locale));
    case "number": return num(fmtNum(Number(value), locale));
    case "percent": return num(fmtPercent(Number(value), locale));
    case "duration": return num(fmtDur(Number(value), locale));
    case "date": return fmtDate(String(value), locale);
    case "datetime": return fmtDateTime(String(value), locale);
    case "bool": return <Badge tone={value ? "success" : "neutral"}>{t(value ? "rpq.yn.yes" : "rpq.yn.no")}</Badge>;
    case "status": { const k = `${ns ?? "status"}.${value}`; return t(k) !== k ? <StatusBadge status={String(value)} ns={ns ?? "status"} /> : <Badge>{valueLabel(t, ns, String(value))}</Badge>; }
    case "enum": return valueLabel(t, ns, String(value));
    case "link": return href ? <CellPair title={<span className="ltr-num">{String(value)}</span>} href={fillHref(href, row)} /> : <span className="ltr-num">{String(value)}</span>;
    default: {
      const s = String(value);
      if (href) return <Link href={fillHref(href, row)} className="text-accent hover:underline">{s}</Link>;
      return long || s.length < 60 ? <span className={long ? "whitespace-pre-wrap break-words" : undefined}>{s}</span> : <span title={s} className="block max-w-72 truncate">{s}</span>;
    }
  }
}
