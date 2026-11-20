"use client";
import { useEffect, useMemo, useState } from "react";
import useSWRInfinite from "swr/infinite";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { fetcher } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import type { ActivityEntity, ActivityItem, ActivityResult } from "@/server/activity-core";
import { ActivityLogView } from "./activity-view";
import { NO_FILTERS, exportPath, feedPath, KINDS, type Filters } from "./activity-lib";

export interface ActivityLogProps {
  entity: ActivityEntity; id: string;
  /** Show only these kinds (and offer only these chips). Default: every kind the entity has. */
  kinds?: string[];
  /** Embedded teaser: no filters, no export, the newest `pageSize` (default 8) entries and "load more". */
  compact?: boolean; pageSize?: number; title?: string;
}

/**
 * The shared activity log (decision G6): everything that happened to / around one record, newest first, grouped by day —
 * kind chips with counts, text / person / period filters, expandable stored details, CSV export, load more.
 * Mount it on any detail page: `<ActivityLog entity="request" id={id} />` (see memory/DATA_CAPTURE.md).
 * This component owns the data and the filter state; `ActivityLogView` draws it.
 */
export function ActivityLog({ entity, id, kinds, compact, pageSize, title }: ActivityLogProps) {
  const { t } = useI18n(); const me = useUser();
  const size = pageSize ?? (compact ? 8 : 30);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [qInput, setQInput] = useState("");
  // people seen in the log so far (kept while a person filter narrows the list, so the filter can be changed again)
  const [actors, setActors] = useState<Record<string, string>>({});
  // text search waits for a pause in typing, then restarts from the first page
  useEffect(() => { const h = setTimeout(() => setF((x) => (x.q === qInput ? x : { ...x, q: qInput })), 300); return () => clearTimeout(h); }, [qInput]);
  const effective: Filters = useMemo(() => ({ ...f, kinds: f.kinds.length ? f.kinds : kinds ?? [] }), [f, kinds]);
  const { data, error, size: pages, setSize, isLoading, isValidating, mutate } = useSWRInfinite<ActivityResult>(
    (i, prev) => (prev && (prev.items.length < prev.pageSize || prev.page * prev.pageSize >= prev.total) ? null : feedPath(entity, id, effective, i + 1, size)), fetcher, {
      revalidateFirstPage: true, keepPreviousData: true, revalidateOnFocus: false,
      onSuccess: (got) => setActors((cur) => { const next = { ...cur }; for (const p of got) for (const it of p.items) if (it.actor?.id && it.actor.name) next[it.actor.id] = it.actor.name; return next; }),
    });
  const first = data?.[0];
  const items = useMemo(() => {
    const seen = new Set<string>(), out: ActivityItem[] = [];
    for (const p of data ?? []) for (const it of p.items) { const k = `${it.table}:${it.id}`; if (!seen.has(k)) { seen.add(k); out.push(it); } }
    return out;
  }, [data]);
  const chips = (kinds?.length ? KINDS.filter((k) => kinds.includes(k)) : KINDS).filter((k) => (first?.kindCounts[k] ?? 0) > 0 || f.kinds.includes(k));
  const toggle = (k: string) => setF((x) => ({ ...x, kinds: x.kinds.includes(k) ? x.kinds.filter((y) => y !== k) : [...x.kinds, k] }));
  return (
    <ActivityLogView title={title ?? t("dtk.title")} compact={compact} first={first} items={items} total={first?.total ?? 0} pages={pages} loading={isLoading || !first} error={error && !data ? error : null} validating={isValidating}
      filters={f} qInput={qInput} actors={actors} chips={chips} canExport={!compact && hasPerm(me, "reports.export")} exportHref={exportPath(entity, id, effective)}
      onClearKinds={() => setF((x) => ({ ...x, kinds: [] }))} onToggleKind={toggle} onQ={setQInput} onActor={(actorId) => setF((x) => ({ ...x, actorId }))}
      onFrom={(from) => setF((x) => ({ ...x, from }))} onTo={(to) => setF((x) => ({ ...x, to }))}
      onClear={() => { setF(NO_FILTERS); setQInput(""); }} onMore={() => setSize(pages + 1)} onRetry={() => mutate()} />
  );
}
