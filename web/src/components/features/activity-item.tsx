"use client";
import { useState, type ComponentType } from "react";
import Link from "next/link";
import { Activity, Bell, ChevronDown, FileCheck2, LifeBuoy, LogIn, MessageSquare, Package, Plug, Power, Send, ShieldCheck, Star, StickyNote, Wallet } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import type { ActivityItem, ActivityKind } from "@/server/activity-core";
import { JsonView } from "./activity-raw";
import { diffRows, hasDetails, itemTone, refHref, refLabelKey, renderTitle, scalarRows, TONE_CLS } from "./activity-lib";

export const KIND_ICON: Record<ActivityKind, ComponentType<{ className?: string }>> = {
  event: Activity, parcel: Package, audit: ShieldCheck, chat: MessageSquare, notification: Bell, money: Wallet, support: LifeBuoy, rating: Star, note: StickyNote,
  document: FileCheck2, login: LogIn, availability: Power, message: Send, integration: Plug,
};

/** Audit entries with `{ field: { from, to } }` diffs render as a before / after table. */
function Diff({ diff }: { diff: unknown }) {
  const { t } = useI18n(); const rows = diffRows(diff);
  if (!rows) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-start text-xs">
        <thead className="bg-bg2 text-muted"><tr><th className="px-3 py-1.5 text-start font-medium">{t("dtk.field")}</th><th className="px-3 py-1.5 text-start font-medium">{t("dtk.before")}</th><th className="px-3 py-1.5 text-start font-medium">{t("dtk.after")}</th></tr></thead>
        <tbody className="divide-y divide-line">{rows.map((r) => <tr key={r.key}><td className="px-3 py-1.5 font-medium">{r.key}</td><td dir="ltr" className="px-3 py-1.5 text-start text-muted">{r.from}</td><td dir="ltr" className="px-3 py-1.5 text-start">{r.to}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** One entry of the activity timeline: tone-coloured icon, translated title, who / when, links to what it mentions, and the stored details on demand. */
export function ActivityRow({ item, last }: { item: ActivityItem; last?: boolean }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const Icon = KIND_ICON[item.kind];
  const tone = itemTone(item);
  const details = item.details as Record<string, unknown> | null;
  const expandable = hasDetails(details);
  const facts = details && typeof details === "object" && !Array.isArray(details) ? scalarRows(details).slice(0, 8) : [];
  const actorName = item.actor?.name ?? (item.actor?.role === "system" || (!item.actor?.id && item.actor?.role) ? t("dtk.by_system") : null);
  return (
    <li className="relative flex gap-3 pb-4" data-testid="dtk-item" data-kind={item.kind} data-title={item.titleKey}>
      {!last && <span aria-hidden className="absolute start-4 top-9 bottom-0 w-px -translate-x-1/2 bg-line rtl:translate-x-1/2" />}
      <span className={cn("z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", TONE_CLS[tone])}><Icon className="size-4" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-sm font-medium leading-snug [overflow-wrap:anywhere]">{renderTitle(item, t, locale)}</p>
          {expandable && (
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t(open ? "dtk.hide_details" : "dtk.details")} data-testid="dtk-item-toggle" className="jr-tap -my-1 shrink-0 rounded-lg p-1.5 text-muted hover:bg-card hover:text-ink">
              <ChevronDown className={cn("size-4 transition", open && "rotate-180")} aria-hidden />
            </button>
          )}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <time dateTime={item.at} className="ltr-num tabular-nums">{fmtTime(item.at, locale)}</time>
          {actorName && <span>· {actorName}{item.actor?.role && item.actor.role !== "system" && <span className="ms-1">({t(`role.${item.actor.role}`)})</span>}</span>}
          <span className="hidden sm:inline">· {t(`dtk.kind_${item.kind}`)}</span>
        </p>
        {item.refs.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {item.refs.map((r) => {
              const href = refHref(r);
              const label = <><span className="text-muted">{t(refLabelKey(r))}</span> <span className="ltr-num">{r.label ?? r.id.slice(0, 8)}</span></>;
              return href ? <Link key={`${r.type}:${r.id}`} href={href} className="rounded-full border border-line bg-bg2 px-2 py-0.5 text-xs hover:border-accent/60">{label}</Link> : <Badge key={`${r.type}:${r.id}`}>{label}</Badge>;
            })}
          </div>
        )}
        {open && expandable && (
          <div className="mt-2 space-y-2" data-testid="dtk-item-details">
            {item.table === "audit_logs" && <Diff diff={details?.diff} />}
            {facts.length > 0 && <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">{facts.map((f) => <div key={f.key} className="flex gap-2"><dt className="shrink-0 text-muted">{f.key}</dt><dd dir="ltr" className="ltr-num min-w-0 break-all text-start">{f.value}</dd></div>)}</dl>}
            <JsonView data={item.details} />
          </div>
        )}
      </div>
    </li>
  );
}
