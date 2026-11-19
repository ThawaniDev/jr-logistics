"use client";
import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Button, ErrorState, Input, Modal, Notice, PageLoading, useAction } from "@/components/ui";
import { ApiError, post } from "@/lib/api";
import { fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { detailsMissing, loadAllShipments, scanMatches, type ShipmentItem } from "./business-shipments-lib";
import { DetailsMissingBadge, ShipBadge, useReason } from "./business-shipments-table";
import { cn } from "@/lib/cn";

type Mode = "handover" | "returns";

interface PickerProps { mode: Mode; requestId: string; offerId: string; onClose: () => void; onDone: () => void; onCompleteDetails?: () => void }

/** Checklist + scan input shared by the hand-over and the returns dialogs. Mount only while open. */
function ParcelPicker({ mode, requestId, offerId, onClose, onDone, onCompleteDetails }: PickerProps) {
  const { t, locale } = useI18n(); const a = useAction(); const reason = useReason();
  const { data, error, mutate } = useSWR(`shipments-all:${requestId}`, () => loadAllShipments(requestId), { revalidateOnFocus: false });
  const wanted = mode === "handover" ? ["pending", "loaded"] : ["failed"];
  const mine: ShipmentItem[] = (data ?? []).filter((s) => s.offerId === offerId && wanted.includes(s.status));
  // Codes the server refused with DETAILS_INCOMPLETE (our list may have been out of date). They stay blocked even before the refreshed list arrives.
  const [refused, setRefused] = useState<Set<string>>(new Set());
  // A parcel without recipient details cannot be handed to the driver (decision D2): it is shown, flagged, and cannot be ticked.
  const blocked = (s: ShipmentItem) => mode === "handover" && (detailsMissing(s) || refused.has(s.code));
  // Hand-over starts with what is already on the vehicle ticked; returns start empty. `null` = untouched default.
  const [sel, setSel] = useState<Record<string, boolean> | null>(null);
  const isOn = (s: ShipmentItem) => !blocked(s) && (sel ? !!sel[s.id] : mode === "handover" && s.status === "loaded");
  const ready = mine.filter((s) => !blocked(s));
  const missingList = mine.filter(blocked);
  const materialize = () => sel ?? Object.fromEntries(mine.map((s) => [s.id, isOn(s)]));
  const toggle = (id: string, on: boolean) => setSel({ ...materialize(), [id]: on });
  const setAll = (on: boolean) => setSel(Object.fromEntries(ready.map((s) => [s.id, on])));
  const [scan, setScan] = useState(""); const [scanErr, setScanErr] = useState<string | null>(null); const [last, setLast] = useState<string | null>(null);
  const chosen = mine.filter(isOn);
  const allChosen = mine.length > 0 && chosen.length === mine.length;

  const onScan = () => {
    const v = scan.trim(); if (!v) return;
    const hit = mine.find((s) => scanMatches(s, v));
    if (hit && blocked(hit)) { setLast(null); setScanErr(t("pb.ho_scan_blocked", { code: hit.code })); return; }
    if (hit) { toggle(hit.id, true); setLast(hit.code); setScanErr(null); setScan(""); return; }
    const elsewhere = (data ?? []).some((s) => scanMatches(s, v));
    setLast(null); setScanErr(t(elsewhere ? "bs.scan_not_here" : "bs.scan_unknown", { code: v }));
  };
  const finish = (n: number) => (r: unknown) => {
    if (mode === "returns") { const x = r as { returned: number; stillOut: number }; toast.success(t("bs.returned_ok", { n: x.returned })); if (x.stillOut > 0) toast.info(t("bs.still_out", { n: x.stillOut })); } else toast.success(t("bs.handover_ok", { n }));
    onDone();
  };
  // 422 DETAILS_INCOMPLETE { count, codes }: highlight those parcels, refresh the list, and offer to hand over only the complete ones.
  const onRefused = (e: unknown) => {
    if (!(e instanceof ApiError) || e.code !== "DETAILS_INCOMPLETE") return;
    const codes = Array.isArray(e.details.codes) ? (e.details.codes as unknown[]).filter((c): c is string => typeof c === "string") : [];
    setRefused((p) => new Set([...p, ...codes])); void mutate();
  };
  const send = (codes: string[] | "all", n: number) => a.run("go", () => (mode === "handover"
    ? post(`/offers/${offerId}/loading`, codes === "all" ? { all: true } : { codes })
    : post<{ returned: number; stillOut: number }>(`/offers/${offerId}/returns`, codes === "all" ? { all: true } : { codes })), { onDone: finish(n), onError: onRefused });
  const submit = () => send(allChosen ? "all" : chosen.map((s) => s.code), chosen.length);
  // Explicit codes of everything that is complete (what is already on the vehicle stays; the incomplete ones go back to the pool).
  const handOverComplete = () => send(ready.map((s) => s.code), ready.length);
  const rest = mine.length - chosen.length - missingList.length;
  return (
    <Modal open onClose={onClose} title={mode === "handover" ? t("bs.handover_title") : t("bs.returns_title")}
      footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={a.is("go")} disabled={chosen.length === 0} data-testid="handover-submit" onClick={submit}>{mode === "handover" ? t("bs.handover_submit", { n: chosen.length }) : t("bs.returns_submit", { n: chosen.length })}</Button></>}>
      <Notice tone="info">{mode === "handover" ? t("bs.handover_note") : t("fob.returns_note")}</Notice>
      {mode === "handover" && missingList.length > 0 && (
        <div data-testid="handover-incomplete">
          <Notice tone="warn" title={t("pb.ho_incomplete_title", { n: fmtNum(missingList.length, locale) })}>
            <p>{t("pb.ho_incomplete_body")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {onCompleteDetails && <Button size="sm" data-testid="handover-complete-details" onClick={onCompleteDetails}><AlertTriangle className="size-4" aria-hidden />{t("pb.complete_details")}</Button>}
              {ready.length > 0 && <Button size="sm" variant="secondary" data-testid="handover-only-complete" loading={a.is("go")} onClick={handOverComplete}>{t("pb.ho_only_complete", { n: fmtNum(ready.length, locale) })}</Button>}
            </div>
          </Notice>
        </div>
      )}
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : mine.length === 0 ? <p className="text-sm text-muted">{mode === "handover" ? t("bs.handover_none") : t("bs.returns_none")}</p> : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); onScan(); }} className="flex items-end gap-2">
            <div className="flex-1"><Input label={t("bs.scan_label")} ltr value={scan} onChange={(e) => { setScan(e.target.value); setScanErr(null); }} error={scanErr ?? undefined} hint={t("bs.scan_hint")} autoFocus autoComplete="off" data-testid="scan-input" /></div>
            <Button type="submit" variant="secondary" aria-label={t("bs.scan_add")}><ScanLine className="size-4" />{t("bs.scan_add")}</Button>
          </form>
          {last && <p role="status" className="text-xs text-accent">{t("bs.scan_ok", { code: last })}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">{t("bs.selected_of", { n: fmtNum(chosen.length, locale), total: fmtNum(mine.length, locale) })}</span>
            <div className="flex gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => setAll(true)} disabled={ready.length === 0 || chosen.length === ready.length}>{t("bs.select_all")}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setAll(false)} disabled={chosen.length === 0}>{t("bs.select_none")}</Button></div>
          </div>
          <ul className="max-h-72 divide-y divide-line overflow-auto rounded-card border border-line" aria-label={t("bs.parcels_list")}>
            {mine.map((s) => {
              const off = blocked(s);
              return (
                <li key={s.id} data-testid="handover-item" data-code={s.code} data-incomplete={off ? "1" : undefined} className={cn(off && "bg-danger/5")}>
                  <label className={cn("flex items-start gap-3 px-3 py-2 text-sm", off ? "cursor-not-allowed" : "cursor-pointer hover:bg-bg2/60")}>
                    <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--jr-accent)]" checked={isOn(s)} disabled={off} onChange={(e) => toggle(s.id, e.target.checked)} />
                    <span className="min-w-0 flex-1"><span className="ltr-num font-medium" dir="ltr">{s.code}</span>{s.externalRef && <span className="ltr-num ms-2 text-xs text-muted" dir="ltr">{s.externalRef}</span>}
                      <span className="block truncate text-xs text-muted">{s.recipientName || "—"} · {s.address || "—"}</span>
                      {mode === "returns" && s.failReason && <span className="block text-xs text-danger">{reason(s.failReason)}</span>}</span>
                    {off ? <DetailsMissingBadge /> : <ShipBadge status={s.status} />}
                  </label>
                </li>
              );
            })}
          </ul>
          {mode === "handover" && rest > 0 && <Notice tone="warn">{t("bs.handover_unticked", { n: rest })}</Notice>}
          {mode === "returns" && rest > 0 && chosen.length > 0 && <p className="text-xs text-muted">{t("bs.returns_rest", { n: rest })}</p>}
        </>
      )}
    </Modal>
  );
}

export const HandoverDialog = (p: Omit<PickerProps, "mode">) => <ParcelPicker mode="handover" {...p} />;
export const ReturnsDialog = (p: Omit<PickerProps, "mode" | "onCompleteDetails">) => <ParcelPicker mode="returns" {...p} />;
