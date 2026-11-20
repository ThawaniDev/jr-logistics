"use client";
import { useState } from "react";
import { Braces, Check, ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { prettyJson, scalarRows } from "./activity-lib";

/** Copies text and says so (clipboard access can be refused: the failure is silent, the text stays selectable in the JSON view). */
export function useCopy() {
  const { t } = useI18n();
  return (text: string) => { navigator.clipboard?.writeText(text).then(() => toast.success(t("dtk.copied")), () => {}); };
}

/** Pretty-printed JSON, always left-to-right (also in Arabic / Urdu), with a copy button. */
export function JsonView({ data, className, testId }: { data: unknown; className?: string; testId?: string }) {
  const { t } = useI18n(); const copy = useCopy();
  const text = prettyJson(data);
  return (
    <div className={cn("relative rounded-xl border border-line bg-bg2", className)} data-testid={testId}>
      <button type="button" onClick={() => copy(text)} aria-label={t("dtk.copy")} className="jr-tap absolute end-1.5 top-1.5 inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2 py-1 text-xs text-muted hover:text-ink">
        <Copy className="size-3.5" aria-hidden />{t("dtk.copy")}
      </button>
      <pre dir="ltr" className="max-h-80 overflow-auto p-3 pe-24 text-start text-xs leading-relaxed text-ink/90">{text}</pre>
    </div>
  );
}

/** Label / value rows with a copy button on each value (ids, timestamps, references). */
export function KeyValueList({ rows }: { rows: Array<{ key: string; value: string }> }) {
  const { t } = useI18n(); const copy = useCopy();
  const [done, setDone] = useState<string | null>(null);
  return (
    <dl className="divide-y divide-line rounded-xl border border-line text-sm">
      {rows.map((r) => (
        <div key={r.key} className="flex items-start justify-between gap-3 px-3 py-2">
          <dt className="shrink-0 text-xs text-muted">{r.key}</dt>
          <dd className="flex min-w-0 items-start gap-2">
            <span dir="ltr" className="ltr-num min-w-0 break-all text-end">{r.value}</span>
            <button type="button" aria-label={t("dtk.copy")} onClick={() => { copy(r.value); setDone(r.key); setTimeout(() => setDone((d) => (d === r.key ? null : d)), 1500); }} className="jr-tap shrink-0 rounded p-0.5 text-muted hover:text-ink">
              {done === r.key ? <Check className="size-3.5 text-accent" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            </button>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Collapsible "raw data" box for support: the record's own fields (ids, timestamps, flags) as copyable rows, plus the full JSON on demand.
 * Pass the object exactly as the API returned it — nothing is hidden or reformatted, so what support sees is what the system holds.
 */
export function RawDataPanel({ data, title, defaultOpen = false, testId = "dtk-raw" }: { data: unknown; title?: string; defaultOpen?: boolean; testId?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen); const [json, setJson] = useState(false);
  const rows = scalarRows(data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null);
  return (
    <section className="rounded-card border border-line bg-card">
      <h2 className="font-semibold">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid={`${testId}-toggle`} className="flex w-full items-center gap-2 px-5 py-3.5 text-start">
          <Braces className="size-4 text-muted" aria-hidden />{title ?? t("dtk.raw_title")}<ChevronDown className={cn("ms-auto size-4 text-muted transition", open && "rotate-180")} aria-hidden />
        </button>
      </h2>
      {open && (
        <div className="space-y-3 border-t border-line p-5" data-testid={testId}>
          <p className="text-xs text-muted">{t("dtk.raw_hint")}</p>
          {rows.length > 0 && <KeyValueList rows={rows} />}
          <button type="button" onClick={() => setJson((j) => !j)} aria-expanded={json} className="text-xs font-medium text-accent hover:underline">{t(json ? "dtk.raw_hide_json" : "dtk.raw_show_json")}</button>
          {json && <JsonView data={data} testId={`${testId}-json`} />}
        </div>
      )}
    </section>
  );
}
