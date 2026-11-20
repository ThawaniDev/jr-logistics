"use client";
import { useState } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";

/**
 * The bar at the bottom of the role editor: what is unsaved (counts, expandable to the exact permissions), Discard and Save.
 * `meta` lists other unsaved changes (name, description) as text. For a role that does not exist yet (`isNew`) it counts the chosen permissions instead.
 */
export function UnsavedBar({ added, removed, meta, total, isNew, dirty, canSave, busy, error, onSave, onDiscard }: {
  added: string[]; removed: string[]; meta: string[]; total: number; isNew: boolean; dirty: boolean; canSave: boolean; busy: boolean; error: string | null; onSave: () => void; onDiscard: () => void;
}) {
  const { t } = useI18n(); const [open, setOpen] = useState(false);
  const n = added.length + removed.length + meta.length;
  const list = (perms: string[], tone: "success" | "danger") => perms.map((p) => <li key={p}><Badge tone={tone}>{tone === "success" ? <Plus className="size-3" aria-hidden /> : <Minus className="size-3" aria-hidden />}{t(`rjp.${p}`)}</Badge></li>);
  return (
    <div data-testid="rj-bar" className={cn("rounded-card border p-3", dirty ? "sticky bottom-3 z-10 border-accent/60 bg-card/95 shadow-lg backdrop-blur" : "border-line bg-card")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p role="status" data-testid="rj-bar-status" className="min-w-0 flex-1 text-sm">
          {!dirty ? <span className="text-muted">{t("rj.no_changes")}</span> : isNew ? <span className="font-medium">{t("rj.new_summary", { n: total })}</span> : (
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-medium">{t("rj.changes_n", { n })}</span>
              {added.length > 0 && <Badge tone="success"><Plus className="size-3" aria-hidden /><span className="ltr-num">{t("rj.diff_added", { n: added.length })}</span></Badge>}
              {removed.length > 0 && <Badge tone="danger"><Minus className="size-3" aria-hidden /><span className="ltr-num">{t("rj.diff_removed", { n: removed.length })}</span></Badge>}
            </span>)}
        </p>
        {dirty && !isNew && n > 0 && <button type="button" data-testid="rj-bar-details" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10">{t(open ? "rj.hide_details" : "rj.show_details")}<ChevronDown className={cn("size-3.5 transition", open && "rotate-180")} aria-hidden /></button>}
        <div className="ms-auto flex gap-2">
          <Button variant="ghost" data-testid="rj-discard" disabled={!dirty || busy} onClick={onDiscard}>{t("rj.discard")}</Button>
          <Button data-testid="rj-save" loading={busy} disabled={!dirty || !canSave} onClick={onSave}>{t(isNew ? "rj.create_confirm" : "rj.save")}</Button>
        </div>
      </div>
      {open && dirty && !isNew && (
        <div className="mt-3 space-y-2 border-t border-line pt-3 text-sm" data-testid="rj-bar-diff">
          {meta.length > 0 && <p className="text-muted">{meta.join(" · ")}</p>}
          {added.length > 0 && <div><p className="mb-1 text-xs font-semibold text-muted">{t("rj.diff_added", { n: added.length })}</p><ul className="flex flex-wrap gap-1.5">{list(added, "success")}</ul></div>}
          {removed.length > 0 && <div><p className="mb-1 text-xs font-semibold text-muted">{t("rj.diff_removed", { n: removed.length })}</p><ul className="flex flex-wrap gap-1.5">{list(removed, "danger")}</ul></div>}
        </div>)}
      {error && <p role="alert" data-testid="rj-bar-error" className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
