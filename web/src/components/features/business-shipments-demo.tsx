"use client";
import { useMemo, useState } from "react";
import { FlaskConical, Search } from "lucide-react";
import { Badge, Button, ErrorState, Input, Modal, Notice, PageLoading } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { fmtMoney, fmtNum } from "@/lib/format";
import { demoToRow, type DemoShipment, type DemoShipmentPage, type ManifestRow } from "./business-shipments-lib";

/** The "Demo data" tag shown wherever demo parcels can be added. */
export const DemoBadge = () => { const { t } = useI18n(); return <Badge tone="warn" className="uppercase tracking-wide"><FlaskConical className="size-3" aria-hidden />{t("pb.demo_label")}</Badge>; };

/** Search text of one demo parcel: number, order reference, recipient, district, address and contents. */
const haystack = (d: DemoShipment) => `${d.n} ${d.ref} ${d.recipientName} ${d.district} ${d.address} ${d.contents ?? ""}`.toLowerCase();

interface Props {
  city: string; cityLabel: string;
  /** Lower-cased order references already in the manifest (those demo parcels are skipped). */
  existingRefs: Set<string>;
  /** How many more parcels the order can still take. */
  room: number;
  onClose: () => void;
  /** `added` rows to append and how many picks were skipped because they were already in the list. */
  onAdd: (rows: ManifestRow[], skipped: number) => void;
}

/** Picker for the 80 fictitious parcels of a demo/test deployment. Mount only while open. */
export function DemoPickerDialog({ city, cityLabel, existingRefs, room, onClose, onAdd }: Props) {
  const { t, locale } = useI18n();
  const { data, error, mutate } = useApi<DemoShipmentPage>(`/business/demo-shipments?city=${encodeURIComponent(city)}`, { shouldRetryOnError: false });
  const [q, setQ] = useState(""); const [picked, setPicked] = useState<Set<number>>(new Set());
  const items = useMemo(() => data?.items ?? [], [data]);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (needle ? items.filter((d) => haystack(d).includes(needle)) : items), [items, needle]);
  const inList = (d: DemoShipment) => existingRefs.has(d.ref.toLowerCase());
  const chosen = items.filter((d) => picked.has(d.n));
  const willSkip = chosen.filter(inList).length;
  const fresh = chosen.filter((d) => !inList(d));
  const over = Math.max(0, fresh.length - room);

  const toggle = (n: number, on: boolean) => setPicked((p) => { const x = new Set(p); if (on) x.add(n); else x.delete(n); return x; });
  const pick = (list: DemoShipment[]) => setPicked(new Set(list.map((d) => d.n)));
  const submit = () => onAdd(fresh.slice(0, Math.max(0, room)).map(demoToRow), willSkip);

  return (
    <Modal open onClose={onClose} title={t("pb.demo_title")}
      footer={<>
        <Button variant="ghost" data-testid="demo-cancel" onClick={onClose}>{t("common.cancel")}</Button>
        <Button data-testid="demo-add-selected" disabled={chosen.length === 0 || room <= 0} onClick={submit}>{t("pb.demo_add", { n: fmtNum(chosen.length, locale) })}</Button>
      </>}>
      <div data-testid="demo-modal" className="space-y-4">
        <div className="flex flex-wrap items-center gap-2"><span data-testid="demo-label"><DemoBadge /></span><p className="text-sm text-muted">{t("pb.demo_hint", { n: fmtNum(data?.total ?? 0, locale), city: cityLabel })}</p></div>
        {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : (
          <>
            <div className="relative"><Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden /><Input aria-label={t("pb.demo_search")} placeholder={t("pb.demo_search")} className="ps-9" data-testid="demo-search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} /></div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="secondary" data-testid="demo-select-all" disabled={shown.length === 0} onClick={() => pick(shown)}>{t("pb.demo_select_all", { n: fmtNum(shown.length, locale) })}</Button>
              {[10, 25, 50].map((n) => <Button key={n} type="button" size="sm" variant="secondary" data-testid={`demo-first-${n}`} disabled={shown.length === 0} onClick={() => pick(shown.slice(0, n))}>{t("pb.demo_first", { n: fmtNum(n, locale) })}</Button>)}
              <Button type="button" size="sm" variant="ghost" data-testid="demo-clear" disabled={picked.size === 0} onClick={() => setPicked(new Set())}>{t("pb.demo_clear")}</Button>
              <span className="ms-auto text-sm font-medium tabular-nums" role="status" data-testid="demo-selected-count">{t("pb.demo_selected", { n: fmtNum(chosen.length, locale) })}</span>
            </div>
            {willSkip > 0 && <Notice tone="warn"><span data-testid="demo-skip-note">{t("pb.demo_will_skip", { n: fmtNum(willSkip, locale) })}</span></Notice>}
            {over > 0 && <Notice tone="warn">{t("pb.demo_over", { n: fmtNum(room, locale) })}</Notice>}
            {shown.length === 0 ? <p className="py-4 text-center text-sm text-muted">{t("common.no_results")}</p> : (
              <ul className="max-h-[50vh] divide-y divide-line overflow-auto rounded-card border border-line" aria-label={t("pb.demo_list_label")}>
                {shown.map((d) => (
                  <li key={d.n} data-testid="demo-item" data-ref={d.ref}>
                    <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-bg2/60">
                      <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--jr-accent)]" checked={picked.has(d.n)} onChange={(e) => toggle(d.n, e.target.checked)} aria-label={t("pb.demo_pick", { ref: d.ref })} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="ltr-num font-semibold tabular-nums" dir="ltr">{d.ref}</span><span className="font-medium">{d.recipientName}</span>
                          <Badge tone={d.recipientType === "business" ? "info" : "neutral"}>{t(`rtype.${d.recipientType}`)}</Badge>
                          {inList(d) && <Badge tone="success">{t("pb.demo_in_list")}</Badge>}
                        </span>
                        <span className="block text-xs text-muted">{d.district ? `${d.district} · ` : ""}{d.address}</span>
                        {d.contents && <span className="block text-xs text-muted">{t("bs.f_contents")}: {d.contents}</span>}
                        {(d.codCents ?? 0) > 0 && <span className="block text-xs text-gold" data-testid="demo-cod">{t("fob.f_cod")}: <span className="ltr-num">{fmtMoney(d.codCents ?? 0, locale)}</span></span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
