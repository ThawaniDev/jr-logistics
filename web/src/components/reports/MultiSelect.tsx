"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n/provider";
import { useApi } from "@/components/ui/data";
import { useClampX } from "./useClamp";

export interface Option { key: string; label: string; sub?: string | null }
export type OptionKind = "company" | "office" | "driver";
/** Display names of accounts the user picked (so chips and buttons never show a bare id), shared by every MultiSelect on the page. */
export const pickedNames = new Map<string, string>();

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const h = setTimeout(() => setD(v), ms); return () => clearTimeout(h); }, [v, ms]);
  return d;
}

/**
 * A button that opens a checkbox list (a popover that stays inside the viewport). Give it either static `options`, or `kind` for accounts that are searched on the server
 * (`GET /admin/analytics/options?kind=…&q=…`, 20 matches). `selected` are option keys; `onChange` gets the next list.
 */
export function MultiSelect({ label, icon, options, kind, selected: selectedProp, onChange, testId }: { label: string; icon?: ReactNode; options?: Option[]; kind?: OptionKind; selected: string[]; onChange: (next: string[]) => void; testId?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // The URL is the source of truth but it updates a moment after the click: show the click at once, and let the URL take over when it arrives.
  const [local, setLocal] = useState<{ base: string; value: string[] } | null>(null);
  const base = selectedProp.join(",");
  const selected = local && local.base === base ? local.value : selectedProp;
  const change = (next: string[]) => { setLocal({ base, value: next }); onChange(next); };
  const wrap = useRef<HTMLDivElement>(null); const btn = useRef<HTMLButtonElement>(null); const search = useRef<HTMLInputElement>(null);
  const { ref, shift } = useClampX<HTMLDivElement>(open);
  const dq = useDebounced(q);
  const remote = useApi<{ items: Array<{ id: string; name: string; sub: string | null }> }>(kind && open ? `/admin/analytics/options?kind=${kind}&q=${encodeURIComponent(dq.trim())}` : null, { keepPreviousData: true });
  const list: Option[] = kind ? (remote.data?.items ?? []).map((x) => ({ key: x.id, label: x.name, sub: x.sub })) : (options ?? []).filter((o) => !q.trim() || o.label.toLowerCase().includes(q.trim().toLowerCase()));
  for (const o of list) if (kind) pickedNames.set(o.key, o.label);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("pointerdown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  useEffect(() => { if (open) requestAnimationFrame(() => (search.current ?? ref.current?.querySelector<HTMLElement>("input"))?.focus()); }, [open, ref]);
  const searchable = !!kind || (options?.length ?? 0) > 8;
  const toggle = (k: string) => change(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  return (
    <div ref={wrap} className="relative">
      <button ref={btn} type="button" data-testid={testId} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen((o) => !o); setQ(""); }}
        className={cn("jr-tap inline-flex h-9 items-center gap-1.5 rounded-xl border bg-bg2 px-3 text-sm transition hover:border-accent/60", selected.length ? "border-accent/50 text-ink" : "border-line text-muted")}>
        {icon}<span>{label}</span>
        {selected.length > 0 && <span className="rounded-full bg-accent/15 px-1.5 text-xs font-semibold tabular-nums text-accent">{selected.length}</span>}
        <ChevronDown className={cn("size-4 transition", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div ref={ref} role="dialog" aria-label={label} style={{ transform: `translateX(${shift}px)` }} className="absolute start-0 top-full z-40 mt-1.5 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-line bg-card shadow-xl">
          {searchable && (
            <div className="relative border-b border-line p-2">
              <Search className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input ref={search} type="text" autoComplete="off" aria-label={t("rpf.f_search")} placeholder={t("rpf.f_search")} value={q} onChange={(e) => setQ(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-bg2 ps-8 pe-2 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none" />
            </div>
          )}
          <ul className="max-h-64 overflow-y-auto py-1" role="group" aria-label={label}>
            {list.length === 0 && <li className="px-3 py-3 text-sm text-muted">{kind && remote.isLoading ? t("uxa.searching") : t("rpf.f_no_options")}</li>}
            {list.map((o) => (
              <li key={o.key}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-bg2/70">
                  <input type="checkbox" className="size-4 shrink-0 accent-[var(--jr-accent)]" checked={selected.includes(o.key)} onChange={() => { if (kind) pickedNames.set(o.key, o.label); toggle(o.key); }} />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.sub && <span className="shrink-0 text-xs text-muted">{o.sub}</span>}
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
            <button type="button" disabled={!selected.length} onClick={() => change([])} className="rounded-lg px-2 py-1 text-xs text-muted hover:text-ink disabled:opacity-40">{t("rpf.f_clear")}</button>
            <button type="button" onClick={() => { setOpen(false); btn.current?.focus(); }} className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-accent-ink">{t("rpf.f_done")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
