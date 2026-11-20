"use client";
import { useMemo, useState } from "react";
import { ArrowRight, PackageSearch } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { fmtNum } from "@/lib/format";
import { ShipCard } from "./driver-ship-card";
import { ShipFilters } from "./driver-ship-filters";
import { ShipHeader } from "./driver-ship-header";
import { SHIP_PAGE, cashCollected, cashToCollect, filterShips, isResolvedShip, nextShip, shipAccess, shipCounters, sortShips, type ShipAccess, type ShipFilter } from "./driver-shipments-lib";
import { StopPanel } from "./driver-stops-current";
import { Sheet, type Stop } from "./driver-stops-shared";
import type { PolicyInfo } from "./driver-fieldops-utils";

/** The sticky "Next up" bar: one thumb tap opens the shipment the driver should handle next. */
function NextBar({ stop, onOpen }: { stop: Stop; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <div data-testid="ship-next-bar" data-code={stop.code} className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-bg2/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">{t(stop.arrivedAt ? "jf2.next_arrived" : "jf2.next_up")}</p>
          <p className="truncate text-sm font-medium"><span className="ltr-num font-bold">{stop.code}</span>{stop.recipientName && <span className="text-muted"> · {stop.recipientName}</span>}</p>
        </div>
        <Button data-testid="ship-next-open" size="lg" className="h-12 shrink-0" onClick={onOpen}>{t(stop.arrivedAt ? "jf2.next_continue" : "jf2.next_open")}<ArrowRight className="size-5 rtl:rotate-180" aria-hidden /></Button>
      </div>
    </div>
  );
}

/**
 * The run sheet of a per-parcel job (update J2): progress, filter chips + search, one card per shipment, and the shipment sheet that opens on a tap.
 * `routing` = the platform's routing switch: off → any shipment on the vehicle accepts actions in any order; on → only the current stop (the rest are locked).
 * `interactive` = the job is being worked (`work_stops`); otherwise the cards are a read-only record.
 */
export function ShipmentsBoard({ stops, offerId, policy, routing, interactive, showType, onStopDone, onRefresh }: {
  stops: Stop[]; offerId: string; policy: PolicyInfo; routing: boolean; interactive: boolean; showType: boolean; onStopDone: (msgKey: string) => void; onRefresh: () => void;
}) {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<ShipFilter>("all"); const [query, setQuery] = useState(""); const [shown, setShown] = useState(SHIP_PAGE); const [selId, setSelId] = useState<string | null>(null);
  const sorted = useMemo(() => sortShips(stops), [stops]);
  const counters = useMemo(() => shipCounters(stops), [stops]);
  const filtered = useMemo(() => filterShips(sorted, filter, query), [sorted, filter, query]);
  const visible = filtered.slice(0, shown);
  const total = counters.total;
  const accessOf = (s: Stop): ShipAccess => (interactive ? shipAccess(s, routing) : isResolvedShip(s) ? "done" : "locked");
  const next = interactive ? nextShip(stops, routing) : null;
  const sel = selId ? stops.find((s) => s.id === selId) ?? null : null;
  const position = (s: Stop) => stops.indexOf(s) + 1; // `stops` arrive in route order: the number a stop has in the route
  const pickFilter = (f: ShipFilter) => { setFilter(f); setShown(SHIP_PAGE); };
  const pickQuery = (q: string) => { setQuery(q); setShown(SHIP_PAGE); };

  if (total === 0) return <EmptyState title={t("jf2.none_yet")} icon={<PackageSearch className="size-6" />} />;
  return (
    <div className="space-y-4" data-testid="ship-board" data-routing={routing ? "1" : "0"}>
      <ShipHeader counters={counters} cashLeftCents={cashToCollect(stops)} cashCollectedCents={cashCollected(stops)} />
      <ShipFilters counters={counters} filter={filter} onFilter={pickFilter} query={query} onQuery={pickQuery} />
      <p className="sr-only" role="status" aria-live="polite">{t("jf2.showing", { shown: fmtNum(visible.length, locale), total: fmtNum(filtered.length, locale) })}</p>

      {filtered.length === 0 ? (
        <EmptyState title={t("jf2.none_match")} hint={t("jf2.none_match_hint")} icon={<PackageSearch className="size-6" />} action={<Button variant="secondary" onClick={() => { pickFilter("all"); pickQuery(""); }}>{t("jf2.clear_filters")}</Button>} />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2" data-testid="ship-list" aria-label={t("jf2.ship_title")}>
          {visible.map((s) => <ShipCard key={s.id} stop={s} access={accessOf(s)} routing={routing} offerId={offerId} onOpen={setSelId} />)}
        </ul>
      )}
      {filtered.length > visible.length && (
        <div className="space-y-2 text-center">
          <p className="text-xs text-muted">{t("jf2.showing", { shown: fmtNum(visible.length, locale), total: fmtNum(filtered.length, locale) })}</p>
          <Button data-testid="ship-more" variant="secondary" size="lg" onClick={() => setShown((n) => n + SHIP_PAGE)}>{t("jf2.show_more", { n: fmtNum(Math.min(SHIP_PAGE, filtered.length - visible.length), locale) })}</Button>
        </div>
      )}

      {next && <NextBar stop={next} onOpen={() => setSelId(next.id)} />}

      <Sheet open={!!sel} onClose={() => setSelId(null)} title={sel ? t("jf2.sheet_title", { code: sel.code }) : ""}>
        {sel && <StopPanel key={sel.id} stop={sel} offerId={offerId} policy={policy} access={accessOf(sel)} routing={routing} showType={showType}
          position={routing ? position(sel) : undefined} total={routing ? total : undefined} onAdvanced={(k) => { setSelId(null); onStopDone(k); }} onRefresh={onRefresh} />}
      </Sheet>
    </div>
  );
}
