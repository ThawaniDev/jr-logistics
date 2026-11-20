"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, Download, Link2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, errText, Input } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { fmtNum } from "@/lib/format";
import { addView, apiParams, downloadCsv, rawViews, readViews, removeView, storeViews, subscribeViews, type CatalogDataset, type ExplorerState, type SavedView } from "./explorer-lib";

/** Export the filtered result as CSV (up to the cap, streamed by the server; every export is audited and rate-limited). */
export function ExportButton({ ds, state, sharedQs, cap }: { ds: CatalogDataset; state: ExplorerState; sharedQs: string; cap: number }) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const q = `${sharedQs ? `${sharedQs}&` : ""}${apiParams(state, ds)}&format=csv`;
      const r = await downloadCsv(`/api/v1/admin/analytics/explorer/${ds.key}?${q}`, `${ds.key}.csv`);
      toast.success(Number.isFinite(r.rows) ? t(r.truncated ? "rpq.x_export_capped" : "rpq.x_export_done", { n: fmtNum(r.rows, locale) }) : t("rpq.x_export_started"));
    } catch (e) { toast.error(errText(e, t)); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={run} loading={busy} data-testid="rpq-x-export"><Download className="size-4" aria-hidden />{t(state.group ? "rpq.x_export_summary" : "rpq.x_export")}</Button>
      <p className="text-xs text-muted">{t("rpq.x_export_hint", { n: fmtNum(cap, locale) })}</p>
    </div>
  );
}

/** Saved views: a name for the current query (dataset, period, filters, columns, sort, grouping), kept in this browser; and a link that opens exactly this view. */
export function SavedViews() {
  const { t } = useI18n();
  const router = useRouter(), path = usePathname(), sp = useSearchParams();
  const raw = useSyncExternalStore(subscribeViews, rawViews, () => null);
  const views = useMemo<SavedView[]>(() => readViews(raw), [raw]);
  const [name, setName] = useState("");
  const persist = (next: SavedView[]) => { if (!storeViews(next)) toast.error(t("rpq.x_views_unavailable")); };
  const current = () => { const q = new URLSearchParams(sp.toString()); q.delete("page"); return q.toString(); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}${path}${current() ? `?${current()}` : ""}`); toast.success(t("common.copied")); } catch { toast.error(t("rpq.x_copy_failed")); }
  };
  return (
    <details className="rounded-card border border-line bg-card" data-testid="rpq-x-views">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-semibold"><Bookmark className="size-4 text-muted" aria-hidden />{t("rpq.x_views")}<span className="ltr-num rounded-full bg-bg2 px-2 text-xs text-muted" data-testid="rpq-x-views-count">{views.length}</span></summary>
      <div className="space-y-4 border-t border-line p-4">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; persist(addView(views, name, current())); setName(""); }}>
          <div className="min-w-48 flex-1"><Input label={t("rpq.x_view_name")} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} data-testid="rpq-x-view-name" /></div>
          <Button type="submit" variant="secondary" disabled={!name.trim()} data-testid="rpq-x-view-save">{t("rpq.x_view_save")}</Button>
          <Button type="button" variant="secondary" onClick={copy} data-testid="rpq-x-copy-link"><Link2 className="size-4" aria-hidden />{t("rpq.x_copy_link")}</Button>
        </form>
        {views.length === 0 ? <p className="text-sm text-muted" data-testid="rpq-x-views-empty">{t("rpq.x_views_empty")}</p> : (
          <ul className="divide-y divide-line/70" data-testid="rpq-x-views-list">
            {views.map((v) => (
              <li key={v.id} className="flex items-center gap-2 py-2" data-testid="rpq-x-view">
                <button type="button" onClick={() => router.push(`${path}?${v.qs}`)} className="min-w-0 flex-1 truncate text-start text-sm font-medium text-accent hover:underline" data-testid="rpq-x-view-open">{v.name}</button>
                <Button variant="ghost" size="sm" aria-label={t("rpq.x_view_delete", { name: v.name })} onClick={() => persist(removeView(views, v.id))} data-testid="rpq-x-view-delete"><Trash2 className="size-4" aria-hidden /></Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">{t("rpq.x_views_hint")}</p>
      </div>
    </details>
  );
}
