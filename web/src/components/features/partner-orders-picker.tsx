"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Inbox, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState, ErrorState, Notice, SearchBox, Spinner, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { useDebounced } from "./admin-common";
import type { ManifestRow } from "./business-shipments-lib";
import type { PartnerOrder } from "./business-shipments-partner";
import { cityLabel, inManifest, manifestRows, newRowsOnly, ordersPath, togglePicked, type ManifestProblem, type OrdersManifest } from "./partner-orders-lib";
import { BUSINESS_API, CityValue, CodValue, ProblemsNotice, ProviderBadge, useCityNames } from "./partner-orders-parts";

const LIMIT = 200;

/**
 * "Incoming orders" source of the request form's import panel: open orders (of the request's delivery city when one is set) with checkboxes,
 * turned into manifest rows by the same endpoint as the bulk flow on the Incoming orders page, so both produce identical parcels.
 */
export function IncomingOrdersPicker({ deliveryCity, rows, room, onAdd, onClose }: { deliveryCity?: string; rows: ManifestRow[]; room: number; onAdd: (rows: ManifestRow[]) => void; onClose: () => void }) {
  const { t, locale } = useI18n(); const a = useAction(); const { names } = useCityNames();
  const [qIn, setQIn] = useState(""); const q = useDebounced(qIn.trim());
  const list = useApi<{ items: PartnerOrder[]; total: number }>(ordersPath(BUSINESS_API, { state: "open", city: deliveryCity || undefined, q, pageSize: LIMIT }), { keepPreviousData: true });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [after, setAfter] = useState<{ problems: ManifestProblem[]; skipped: string[] } | null>(null);
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const avail = items.filter((o) => !inManifest(o, rows));
  const chosen = avail.filter((o) => picked.has(o.id));
  const over = chosen.length > room;
  const cityName = deliveryCity ? cityLabel(t, deliveryCity, names) : "";

  const add = () => {
    if (chosen.length === 0 || over) return;
    void a.run("add", () => post<OrdersManifest>(`${BUSINESS_API}/orders/manifest`, { ids: chosen.map((o) => o.id) }), {
      onDone: (m) => {
        // A delivery order serves one city: rows matched to another city are never added (the list is filtered, so this only guards against races).
        const fits = m.rows.filter((r) => !deliveryCity || !r.city || r.city === deliveryCity);
        const skipped = [...new Set(m.rows.filter((r) => !fits.includes(r)).map((r) => r.externalRef))];
        const add = newRowsOnly(manifestRows({ rows: fits }), rows, room);
        if (add.length > 0) { onAdd(add); toast.success(t("iord.picker_added", { n: fmtNum(add.length, locale) })); }
        setPicked(new Set()); setAfter({ problems: m.problems, skipped });
      },
    });
  };

  return (
    <Card className="space-y-4 border-cyan/30" data-testid="orders-picker">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3"><Inbox className="mt-0.5 size-5 shrink-0 text-cyan" aria-hidden /><div><h3 className="font-semibold">{t("iord.src_orders")}</h3><p className="text-xs text-muted">{deliveryCity ? t("iord.picker_city", { city: cityName }) : t("iord.src_orders_hint")}</p></div></div>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>{t("common.close")}</Button>
      </div>
      <SearchBox value={qIn} onChange={setQIn} placeholder={t("iord.search_ph")} label={t("iord.picker_search")} className="sm:w-full" />
      {list.error && !list.data ? <ErrorState error={list.error} retry={() => list.mutate()} /> : !list.data ? <Spinner /> : items.length === 0 ? (
        <EmptyState icon={<Inbox className="size-8" aria-hidden />} title={q ? t("iord.none_match") : deliveryCity ? t("iord.picker_empty", { city: cityName }) : t("iord.none_in_view", { state: t("iord.state_open") })}
          action={<Link href="/business/integrations/orders" target="_blank" className="text-sm font-semibold text-cyan underline">{t("iord.nav")}</Link>} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button type="button" size="sm" variant="secondary" disabled={avail.length === 0} onClick={() => setPicked(togglePicked(picked, avail.map((o) => o.id), !(avail.length > 0 && avail.every((o) => picked.has(o.id)))))} data-testid="orders-picker-all">{t("iord.select_page")}</Button>
            <span className="text-muted" aria-live="polite">{t("iord.selected_n", { n: fmtNum(chosen.length, locale) })}</span>
            {avail.length === 0 && <span className="text-xs text-gold">{t("iord.picker_all_in")}</span>}
          </div>
          <ul className="max-h-96 divide-y divide-line overflow-auto rounded-card border border-line" aria-label={t("iord.nav")}>
            {items.map((o) => {
              const already = inManifest(o, rows);
              return (
                <li key={o.id} className={cn("flex items-start gap-3 px-3 py-2.5 text-sm", already && "bg-bg2/40")} data-testid="orders-picker-row" data-ref={o.displayRef}>
                  {already ? <span className="mt-1 size-4 shrink-0" aria-hidden /> : <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--jr-accent)]" aria-label={t("iord.pick", { ref: o.displayRef })} checked={picked.has(o.id)} onChange={(e) => setPicked(togglePicked(picked, [o.id], e.target.checked))} />}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="ltr-num font-medium" dir="ltr">{o.displayRef}</span><ProviderBadge o={o} />
                      {already && <Badge tone="warn">{t("iord.picker_in_list")}</Badge>}
                      {!already && !o.detailsComplete && <Badge tone="warn">{t("iord.details_incomplete")}</Badge>}
                      {!already && o.recipientPhone && !o.phoneValid && <Badge tone="danger">{t("iord.phone_invalid")}</Badge>}</div>
                    <p className="text-xs text-muted"><span dir="auto">{[o.recipientName, o.recipientPhone, o.address].filter(Boolean).join(" · ") || "—"}</span></p>
                    <div className="flex flex-wrap items-center gap-3 text-xs"><CityValue o={o} names={names} /><CodValue cents={o.codCents} className={o.codCents ? "ltr-num font-medium text-gold" : undefined} /></div>
                  </div>
                </li>
              );
            })}
          </ul>
          {list.data.total > items.length && <p className="text-xs text-muted">{t("iord.picker_more", { n: fmtNum(items.length, locale) })}</p>}
          {over && <Notice tone="danger">{t("intg.over_room", { room: fmtNum(Math.max(room, 0), locale) })}</Notice>}
          <div className="flex justify-end"><Button type="button" disabled={chosen.length === 0 || over} loading={a.is("add")} onClick={add} data-testid="orders-picker-add"><Plus className="size-4" aria-hidden />{t("iord.picker_add", { n: fmtNum(chosen.length, locale) })}</Button></div>
        </>
      )}
      {after && after.skipped.length > 0 && <Notice tone="warn">{t("iord.picker_wrong_city", { refs: after.skipped.join(", "), city: cityName })}</Notice>}
      {after && <ProblemsNotice problems={after.problems} />}
    </Card>
  );
}
