"use client";
import { Download, X } from "lucide-react";
import { Button, EmptyState, ErrorState, Input, Notice, SearchBox, Section, Select, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import type { ActivityItem, ActivityResult } from "@/server/activity-core";
import { ActivityRow } from "./activity-item";
import { activeFilters, dayLabel, groupByDay, type Filters } from "./activity-lib";

export const MAX_PAGES = 20;
export interface ActivityViewProps {
  title: string; compact?: boolean; first?: ActivityResult; items: ActivityItem[]; total: number; pages: number; loading: boolean; error: unknown; validating: boolean;
  filters: Filters; qInput: string; actors: Record<string, string>; chips: readonly string[]; canExport: boolean; exportHref: string;
  onClearKinds: () => void; onToggleKind: (k: string) => void; onQ: (v: string) => void; onActor: (v: string) => void; onFrom: (v: string) => void; onTo: (v: string) => void;
  onClear: () => void; onMore: () => void; onRetry: () => void;
}

const chip = (on: boolean) => cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition", on ? "border-accent/60 bg-accent/10 font-semibold text-accent" : "border-line bg-bg2 text-muted hover:border-accent/40 hover:text-ink");
const count = "rounded-full bg-bg px-1.5 tabular-nums text-muted";

/** The presentation of `<ActivityLog>`: everything it shows, driven purely by props (the container owns fetching and filter state). */
export function ActivityLogView(p: ActivityViewProps) {
  const { t, locale } = useI18n();
  const { first, items, filters: f } = p;
  const filtered = activeFilters(f) > 0;
  const days = groupByDay(items);
  const actorOptions = Object.entries(f.actorId && !p.actors[f.actorId] ? { ...p.actors, [f.actorId]: f.actorId.slice(0, 8) } : p.actors).map(([value, label]) => ({ value, label }));
  return (
    <div data-testid="dtk-log">
      <Section title={p.title}
        actions={p.canExport && first ? <a href={p.exportHref} download data-testid="dtk-export" className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-line bg-bg2 px-3 text-xs text-ink transition hover:border-accent/60 hover:bg-card pointer-coarse:h-10"><Download className="size-4" aria-hidden />{t("dtk.export")}</a> : undefined}>
        <div className="space-y-4">
          {first && first.hidden.length > 0 && (
            <div data-testid="dtk-hidden"><Notice tone="info" title={t("dtk.hidden_title")}>{t("dtk.hidden_body", { groups: first.hidden.map((g) => t(`dtk.group_${g}`)).join(locale === "en" ? ", " : "، ") })}</Notice></div>
          )}
          {first && first.failed.length > 0 && <div data-testid="dtk-failed"><Notice tone="warn" title={t("dtk.failed_title")}>{t("dtk.failed_body", { tables: first.failed.join(", ") })}</Notice></div>}
          {!p.compact && first && (
            <>
              {p.chips.length > 1 && (
                <div role="group" aria-label={t("dtk.kinds")} className="flex flex-wrap gap-1.5">
                  <button type="button" aria-pressed={f.kinds.length === 0} onClick={p.onClearKinds} data-testid="dtk-chip-all" className={chip(f.kinds.length === 0)}>{t("dtk.filter_all")}<span className={count}>{fmtNum(Object.values(first.kindCounts).reduce((a, b) => a + b, 0), locale)}</span></button>
                  {p.chips.map((k) => (
                    <button key={k} type="button" aria-pressed={f.kinds.includes(k)} onClick={() => p.onToggleKind(k)} data-testid={`dtk-chip-${k}`} className={chip(f.kinds.includes(k))}>{t(`dtk.kind_${k}`)}<span className={count}>{fmtNum(first.kindCounts[k] ?? 0, locale)}</span></button>
                  ))}
                </div>
              )}
              <div className="grid items-end gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <SearchBox value={p.qInput} onChange={p.onQ} placeholder={t("dtk.search")} label={t("dtk.search")} className="sm:w-full" testId="dtk-search" />
                <Select data-testid="dtk-actor" label={t("dtk.actor")} value={f.actorId} onChange={(e) => p.onActor(e.target.value)} placeholder={t("dtk.actor_any")} options={actorOptions} />
                <Input data-testid="dtk-from" type="date" label={t("dtk.from")} ltr value={f.from} max={f.to || undefined} onChange={(e) => p.onFrom(e.target.value)} />
                <Input data-testid="dtk-to" type="date" label={t("dtk.to")} ltr value={f.to} min={f.from || undefined} onChange={(e) => p.onTo(e.target.value)} />
                {filtered && <Button variant="ghost" size="md" onClick={p.onClear} data-testid="dtk-clear"><X className="size-4" aria-hidden />{t("dtk.clear")}</Button>}
              </div>
            </>
          )}
          {p.error && !first ? <ErrorState error={p.error} retry={p.onRetry} />
            : p.loading ? <div className="space-y-3" aria-busy="true" role="status" data-testid="dtk-loading">{[0, 1, 2, 3].map((i) => <div key={i} className="flex gap-3"><Skeleton className="size-8 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></div>)}</div>
            : items.length === 0 ? <div data-testid="dtk-empty"><EmptyState title={t(filtered ? "dtk.empty_filtered" : "dtk.empty")} hint={t(filtered ? "dtk.empty_filtered_hint" : "dtk.empty_hint")} action={filtered ? <Button variant="secondary" size="sm" onClick={p.onClear}>{t("dtk.clear")}</Button> : undefined} /></div>
            : (
              <div className={cn("transition-opacity", p.validating && "opacity-80")}>
                {days.map((g) => (
                  <div key={g.day} className="mb-2">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{dayLabel(g.day, t, locale)}</h3>
                    <ol className="m-0 list-none p-0">{g.items.map((it, i) => <ActivityRow key={`${it.table}:${it.id}`} item={it} last={i === g.items.length - 1} />)}</ol>
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
                  <span data-testid="dtk-count" className="ltr-num">{t("dtk.shown", { n: fmtNum(items.length, locale), total: fmtNum(p.total, locale) })}</span>
                  {items.length < p.total && p.pages < MAX_PAGES && <Button variant="secondary" size="sm" loading={p.validating && p.pages > 1} onClick={p.onMore} data-testid="dtk-more">{t("dtk.load_more")}</Button>}
                  {items.length < p.total && p.pages >= MAX_PAGES && <span>{t("dtk.refine")}</span>}
                </div>
              </div>
            )}
        </div>
      </Section>
    </div>
  );
}
