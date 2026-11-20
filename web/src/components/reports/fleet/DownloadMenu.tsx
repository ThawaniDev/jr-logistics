"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import type { Format } from "./fleet-lib";
import { useClampX } from "../useClamp";

/**
 * "Download" of one table: a menu with the Excel workbook (`.xlsx`, localized headers and a notes sheet) and the plain CSV. `canExport` false (no `reports.export`) leaves the
 * button disabled with a hint. The links are real (`href`), so they can be copied or opened in a new tab; a plain click is handled by `run`, which shows progress and errors.
 */
export function DownloadMenu({ href, busy, run, canExport, fileBase, testId = "fr-download" }: {
  href: (format: Format) => string; busy: string | null; run: (key: string, url: string, fallbackName: string) => void; canExport: boolean; fileBase: string; testId?: string;
}) {
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
  const preparing = busy === `${testId}:xlsx` || busy === `${testId}:csv`;
  const item = (format: Format, icon: ReactNode, label: string, hint: string) => {
    const url = href(format);
    return (
      <a role="menuitem" href={url} download data-testid={`${testId}-${format}`} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); setOpen(false); run(`${testId}:${format}`, url, `${fileBase}.${format}`); }}
        className="jr-tap flex items-start gap-2.5 px-3 py-2 text-sm hover:bg-bg2/70 focus-visible:bg-bg2/70">
        <span className="mt-0.5 text-muted" aria-hidden>{icon}</span>
        <span className="min-w-0"><span className="block font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
      </a>
    );
  };
  return (
    <div ref={wrap} className="relative print:hidden">
      <span title={canExport ? undefined : t("fr.export_needs_perm")} className="inline-flex">
        <button ref={btn} type="button" data-testid={testId} disabled={!canExport || !!busy} aria-haspopup="menu" aria-expanded={open} aria-label={canExport ? undefined : `${t("fr.download")} — ${t("fr.export_needs_perm")}`}
          onClick={() => setOpen((o) => !o)}
          className="jr-tap inline-flex h-8 items-center gap-2 rounded-xl border border-line bg-bg2 px-3 text-xs text-ink transition hover:border-accent/60 hover:bg-card disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-10">
          {preparing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}{t("fr.download")}<ChevronDown className={cn("size-3.5 transition", open && "rotate-180")} aria-hidden />
        </button>
      </span>
      {open && (
        <div ref={ref} role="menu" aria-label={t("fr.download")} style={{ transform: `translateX(${shift}px)` }} className="absolute end-0 top-full z-40 mt-1.5 w-64 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-line bg-card py-1 shadow-xl">
          {item("xlsx", <FileSpreadsheet className="size-4" />, t("fr.dl_xlsx"), t("fr.dl_xlsx_hint"))}
          {item("csv", <FileText className="size-4" />, t("fr.dl_csv"), t("fr.dl_csv_hint"))}
        </div>
      )}
    </div>
  );
}
