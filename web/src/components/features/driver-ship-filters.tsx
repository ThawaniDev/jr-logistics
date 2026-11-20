"use client";
import { SearchBox } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import { SHIP_FILTERS, countFor, type ShipCounters, type ShipFilter } from "./driver-shipments-lib";

const LABEL: Record<ShipFilter, string> = { all: "common.all", todo: "fod.stat_to_deliver", delivered: "fod.stat_delivered", failed: "fod.stat_not_delivered" };
const ACTIVE: Record<ShipFilter, string> = { all: "border-ink/40 bg-ink/10 text-ink", todo: "border-cyan/60 bg-cyan/15 text-cyan", delivered: "border-accent/60 bg-accent/15 text-accent", failed: "border-danger/60 bg-danger/15 text-danger" };

/** Filter chips (All / To deliver / Delivered / Not delivered, each with its count) and the search box of the run sheet. The chips scroll sideways on a phone. */
export function ShipFilters({ counters, filter, onFilter, query, onQuery }: { counters: ShipCounters; filter: ShipFilter; onFilter: (f: ShipFilter) => void; query: string; onQuery: (q: string) => void }) {
  const { t, locale } = useI18n();
  return (
    <div className="space-y-3">
      <div role="group" aria-label={t("jf2.filters_label")} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {SHIP_FILTERS.map((f) => {
          const on = filter === f; const n = countFor(counters, f);
          return (
            <button key={f} type="button" data-testid={`ship-filter-${f}`} data-count={n} aria-pressed={on} onClick={() => onFilter(f)}
              className={cn("inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition", on ? ACTIVE[f] : "border-line bg-bg2 text-muted hover:text-ink")}>
              {t(LABEL[f])}<span className={cn("ltr-num rounded-full px-1.5 text-xs tabular-nums", on ? "bg-bg/40" : "bg-bg")}>{fmtNum(n, locale)}</span>
            </button>
          );
        })}
      </div>
      <SearchBox value={query} onChange={onQuery} testId="ship-search" className="sm:w-full" label={t("jf2.search_label")} placeholder={t("jf2.search_ph")} />
    </div>
  );
}
