"use client";
import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Skeleton } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { notesPath, type TableRef } from "./fleet-lib";

/**
 * "How to read this": the notes of the table on screen (what each day / person / period is counted on, what a dash means, where a figure cannot be known) for the selected period,
 * in the viewer's language. Fetched only when the disclosure is opened, and again when the table or the period changes while it stays open.
 */
export function FleetNotes({ tref, qs }: { tref: TableRef; qs: string }) {
  const { t, locale } = useI18n();
  const [opened, setOpened] = useState(false);
  const { data, error, isLoading, mutate } = useApi<{ notes: string[] }>(opened ? notesPath(tref, qs, locale) : null);
  return (
    <details data-testid="fr-notes" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true); }} className="group rounded-card border border-line bg-card px-4 py-3 text-sm">
      <summary className="flex cursor-pointer select-none items-center gap-2 font-medium"><BookOpen className="size-4 text-muted" aria-hidden />{t("fr.notes_title")}</summary>
      <div className="mt-3" aria-live="polite">
        {error ? <p className="text-xs text-muted" data-testid="fr-notes-error">{t("fr.notes_error")} <button type="button" onClick={() => mutate()} className="text-accent hover:underline">{t("common.retry")}</button></p>
          : isLoading || !data ? <div className="space-y-2" aria-busy="true"><Skeleton className="h-3 w-5/6" /><Skeleton className="h-3 w-4/6" /><Skeleton className="h-3 w-3/6" /></div>
          : data.notes.length === 0 ? <p className="text-xs text-muted">{t("fr.notes_none")}</p>
          : <ul className="list-disc space-y-1.5 ps-5 text-xs text-muted marker:text-line" data-testid="fr-notes-list">{data.notes.map((n, i) => <li key={i} className="text-start"><span className="text-ink/80">{n}</span></li>)}</ul>}
      </div>
    </details>
  );
}
