"use client";
import { useId, useRef, useState } from "react";
import { Clock, ListChecks, Plus } from "lucide-react";
import { Badge, Button, Input, Notice, Pagination } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import { MAX_ROWS } from "./business-shipments-lib";

/** "Details later" (decision D1): the warehouse knows HOW MANY parcels but not every recipient yet. UI-only pieces; the state lives in the wizard. */

/** Segmented choice at the top of the Shipments step: every parcel fully detailed (strict) vs book by count. */
export function DetailsModeSwitch({ later, onChange }: { later: boolean; onChange: (later: boolean) => void }) {
  const { t } = useI18n(); const id = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  // Radio-group keyboard behaviour: arrows (either direction) move to the other option; only the selected one is in the tab order.
  const onKey = (e: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault(); onChange(!later); refs.current[later ? "full" : "later"]?.focus();
  };
  const opts = [
    { later: false, key: "full", Icon: ListChecks, title: t("pb.mode_full"), hint: t("pb.mode_full_hint") },
    { later: true, key: "later", Icon: Clock, title: t("pb.mode_later"), hint: t("pb.mode_later_hint") },
  ];
  return (
    <div data-testid="details-mode">
      <p id={id} className="mb-2 text-sm font-semibold">{t("pb.mode_label")}</p>
      <div role="radiogroup" aria-labelledby={id} onKeyDown={onKey} className="grid gap-3 sm:grid-cols-2">
        {opts.map(({ Icon, ...o }) => {
          const on = later === o.later;
          return (
            <button key={o.key} ref={(el) => { refs.current[o.key] = el; }} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} data-testid={`details-mode-${o.key}`} onClick={() => { if (!on) onChange(o.later); }}
              className={cn("flex items-start gap-3 rounded-card border p-4 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40", on ? "border-accent bg-accent/10" : "border-line bg-card hover:border-accent/50")}>
              <Icon className={cn("mt-0.5 size-5 shrink-0", on ? "text-accent" : "text-muted")} aria-hidden />
              <span className="min-w-0"><span className="block text-sm font-semibold">{o.title}</span><span className="mt-0.5 block text-xs text-muted">{o.hint}</span></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Total-parcels input. `total` is the real count (detailed rows + blank ones); typing sets the number of blank ones. A draft string is kept while
 * the field is focused so typing "40" is not interrupted by clamping to the minimum on the way ("4").
 */
function CountInput({ total, min, onTotal }: { total: number; min: number; onTotal: (n: number) => void }) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (total > 0 ? String(total) : "");
  const num = shown === "" ? NaN : Math.floor(Number(shown));
  const floor = Math.max(1, min);
  const error = draft === null || shown === "" ? undefined
    : !Number.isFinite(num) || num < 1 || num > MAX_ROWS ? t("pb.later_count_range", { max: fmtNum(MAX_ROWS, locale) })
      : num < min ? t("pb.later_count_min", { n: fmtNum(min, locale) }) : undefined;
  return (
    <Input label={t("pb.later_count")} type="number" inputMode="numeric" min={floor} max={MAX_ROWS} step={1} value={shown} placeholder={t("pb.later_count_ph")} data-testid="shipment-count-input"
      error={error} hint={t("pb.later_count_hint", { max: fmtNum(MAX_ROWS, locale) })}
      onChange={(e) => { const v = e.target.value; setDraft(v); const n = Math.floor(Number(v)); if (v !== "" && Number.isFinite(n) && n >= floor && n <= MAX_ROWS) onTotal(n); }}
      onBlur={() => setDraft(null)} />
  );
}

const PAGE = 20;

/** Count input, quick adders, the explanation, and the compact (expandable, paged) summary of the parcels whose details are still to come. */
export function LaterPanel({ detailed, blank, onBlank }: { detailed: number; blank: number; onBlank: (n: number) => void }) {
  const { t, locale } = useI18n(); const listId = useId();
  const [open, setOpen] = useState(false); const [page, setPage] = useState(1);
  const total = detailed + blank;
  const room = MAX_ROWS - total;
  const cur = Math.min(page, Math.max(1, Math.ceil(blank / PAGE)));
  const start = (cur - 1) * PAGE; const shownNow = Math.max(0, Math.min(PAGE, blank - start));
  return (
    <div className="space-y-4" data-testid="later-panel">
      <Notice tone="info" title={t("pb.later_notice_title")}><span data-testid="later-notice">{t("pb.later_notice")}</span></Notice>
      <div className="grid items-start gap-4 rounded-card border border-line bg-card p-4 sm:grid-cols-[minmax(0,260px)_1fr]">
        <CountInput total={total} min={detailed} onTotal={(n) => onBlank(Math.max(0, n - detailed))} />
        <div className="flex flex-wrap items-center gap-2 sm:pt-6">
          <Button type="button" size="sm" variant="secondary" data-testid="add-blank" disabled={room < 1} onClick={() => onBlank(blank + 1)}><Plus className="size-4" aria-hidden />{t("pb.add_blank_1")}</Button>
          <Button type="button" size="sm" variant="secondary" data-testid="add-blank-10" disabled={room < 1} onClick={() => onBlank(blank + Math.min(10, room))}><Plus className="size-4" aria-hidden />{t("pb.add_blank_n", { n: fmtNum(10, locale) })}</Button>
        </div>
      </div>
      {detailed > 0 && <p className="text-sm text-muted" data-testid="detailed-summary">{t("pb.detailed_summary", { n: fmtNum(detailed, locale), total: fmtNum(total, locale) })}</p>}
      {blank > 0 && (
        <div className="rounded-card border border-gold/40 bg-gold/5 p-4" data-testid="blank-summary">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-semibold"><Badge tone="warn">{t("pb.details_missing")}</Badge><span data-testid="blank-count">{t("pb.blank_summary", { n: fmtNum(blank, locale) })}</span></p>
              <p className="mt-1 text-xs text-muted">{t("pb.blank_summary_hint")}</p>
            </div>
            <Button type="button" size="sm" variant="ghost" data-testid="blank-expand" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)}>{open ? t("pb.blank_collapse") : t("pb.blank_expand")}</Button>
          </div>
          {open && (
            <div id={listId} className="mt-3">
              <ol start={detailed + start + 1} className="grid gap-1 sm:grid-cols-2" aria-label={t("pb.blank_list_label")}>
                {Array.from({ length: shownNow }, (_, i) => (
                  <li key={start + i} className="flex items-center justify-between gap-2 rounded-lg bg-bg2 px-3 py-1.5 text-xs">
                    <span className="tabular-nums font-medium">{t("pb.blank_item", { n: fmtNum(detailed + start + i + 1, locale) })}</span><span className="text-muted">{t("pb.blank_item_state")}</span>
                  </li>
                ))}
              </ol>
              <Pagination page={cur} total={blank} pageSize={PAGE} onPage={setPage} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
