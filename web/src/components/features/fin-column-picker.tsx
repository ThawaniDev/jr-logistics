"use client";
import { useEffect, useRef, useState } from "react";
import { Columns3 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { useClampX } from "@/components/reports/useClamp";

/** "Columns": a menu of checkboxes grouped by topic (which columns the table shows) with a reset to the defaults. Controlled: the owner keeps the selected keys. */
export interface PickerGroup { id: string; label: string; items: Array<{ key: string; label: string }> }
export function ColumnPicker({ groups, selected, onChange, onReset, testId = "fd-columns" }: { groups: PickerGroup[]; selected: string[]; onChange: (keys: string[]) => void; onReset: () => void; testId?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null); const btn = useRef<HTMLButtonElement>(null);
  const { ref, shift } = useClampX<HTMLDivElement>(open);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("pointerdown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  const set = new Set(selected);
  const toggle = (k: string) => { const next = new Set(set); if (next.has(k)) { if (next.size > 1) next.delete(k); } else next.add(k); onChange(groups.flatMap((g) => g.items.map((i) => i.key)).filter((x) => next.has(x))); };
  return (
    <div ref={wrap} className="relative print:hidden">
      <button ref={btn} type="button" data-testid={testId} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="jr-tap inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-bg2 px-3 text-sm text-ink transition hover:border-accent/60 hover:bg-card">
        <Columns3 className="size-4" aria-hidden />{t("fdr.columns")}<span className="rounded-full bg-bg px-1.5 text-xs tabular-nums text-muted">{selected.length}</span>
      </button>
      {open && (
        <div ref={ref} role="dialog" aria-label={t("fdr.columns")} style={{ transform: `translateX(${shift}px)` }} data-testid={`${testId}-menu`}
          className="absolute end-0 top-full z-40 mt-1.5 max-h-[70vh] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-line bg-card p-2 shadow-xl">
          {groups.map((g) => (
            <fieldset key={g.id} className="px-1 pb-2">
              <legend className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.label}</legend>
              {g.items.map((i) => (
                <label key={i.key} className={cn("flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1 text-sm hover:bg-bg2")}>
                  <input type="checkbox" checked={set.has(i.key)} onChange={() => toggle(i.key)} data-testid={`${testId}-${i.key}`} className="size-4 accent-[var(--jr-accent)]" />
                  <span className="min-w-0 truncate">{i.label}</span>
                </label>
              ))}
            </fieldset>
          ))}
          <button type="button" onClick={onReset} data-testid={`${testId}-reset`} className="jr-tap mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm hover:bg-bg2">{t("fdr.columns_reset")}</button>
        </div>
      )}
    </div>
  );
}
