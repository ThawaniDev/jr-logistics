"use client";
import { useState } from "react";
import { Star } from "lucide-react";
import { Button, Checkbox, Input, Modal, Notice, Textarea, fieldErrors, useAction } from "@/components/ui";
import { CustodyHandoverModal } from "./business-custody";
import { ReceiveCashDialog } from "./business-cod";
import { SupportComposer, type SupportLink } from "./support";
import { HandoverDialog, ReturnsDialog } from "./business-shipments-handover";
import { CompleteDetailsDialog } from "./business-shipments-complete";
import { ApiError, post } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import type { ModalKind, OpenModal } from "./business-views-request-ctx";

/** All the state behind the order's action buttons and dialogs, kept in the order layout so every section can open them. */
export function useRequestActions(id: string, mutate: () => void, refreshShipments: () => Promise<unknown>) {
  const a = useAction();
  const [m, setM] = useState<ModalKind>(null); const [v, setV] = useState<any>({});
  const [completing, setCompleting] = useState(false); const [report, setReport] = useState<null | SupportLink>(null);
  const [terms, setTerms] = useState(false); const [pubErrs, setPubErrs] = useState<Record<string, string>>({}); const [whRefused, setWhRefused] = useState(false);
  const done = () => { setM(null); setV({}); mutate(); void refreshShipments(); };
  const open: OpenModal = (kind, offer, init = {}) => { setV(init); setM({ kind, offer } as ModalKind); };
  const act = (key: string, path: string, body: unknown, success = "common.saved", onError?: (e: unknown) => void) => { void a.run(key, () => post(path, body), { success, onDone: done, onError }); };
  const publish = () => a.run("publish", () => post(`/requests/${id}/publish`, { termsAccepted: terms }), {
    success: "wizard.published", onDone: () => { setTerms(false); setPubErrs({}); setWhRefused(false); done(); },
    onError: (e) => { setWhRefused(e instanceof ApiError && e.code === "WAREHOUSE_LOCATION_REQUIRED"); setPubErrs(e instanceof ApiError && e.code === "MANIFEST_REQUIRED" ? { shipments: "1" } : fieldErrors(e)); setM(null); },
  });
  return { a, m, setM, v, setV, completing, setCompleting, report, setReport, terms, setTerms, pubErrs, whRefused, done, open, act, publish };
}
export type RequestActions = ReturnType<typeof useRequestActions>;

/** Every confirmation / small form of an order. Mounted once by the order layout; sections open them through `ctx.open(...)`. */
export function RequestDialogs({ id, c, cat, manifest, blocked, onChanged }: { id: string; c: RequestActions; cat: any; manifest: boolean; blocked: boolean; onChanged: () => void }) {
  const { t } = useI18n();
  const { a, m, setM, v, setV, act, done } = c;
  const close = () => setM(null);
  const offer = (m as any)?.offer;
  return (
    <>
      <Modal open={m?.kind === "cancel"} onClose={close} title={t("req.cancel")} footer={<><Button variant="ghost" onClick={close}>{t("common.back")}</Button><Button variant="danger" loading={a.is("cancel")} disabled={(v.reason?.trim().length ?? 0) < 3} onClick={() => act("cancel", `/requests/${id}/cancel`, { reason: v.reason }, "req.cancelled_ok")} data-testid="order-cancel-confirm">{t("req.cancel_confirm")}</Button></>}>
        <Notice tone="info">{t("req.cancel_note")}</Notice><Textarea label={t("req.reason")} value={v.reason ?? ""} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </Modal>
      <Modal open={m?.kind === "publish"} onClose={close} title={t("wizard.publish")} footer={<><Button variant="ghost" onClick={close}>{t("common.cancel")}</Button><Button loading={a.is("publish")} disabled={!c.terms || blocked} onClick={c.publish} data-testid="order-publish-confirm">{t("wizard.publish")}</Button></>}>
        <ul className="list-disc space-y-1 ps-5 text-sm text-muted"><li>{t("wizard.ob1")}</li><li>{t("wizard.ob2")}</li><li>{t("wizard.ob3")}</li></ul>
        <Checkbox checked={c.terms} onChange={(e) => c.setTerms(e.target.checked)} label={<>{t("wizard.accept_terms")} {cat?.terms?.version && <span className="text-xs text-muted">v{cat.terms.version}</span>}</>} />
      </Modal>
      <Modal open={m?.kind === "discard"} onClose={close} title={t("bz.draft_discard")} footer={<><Button variant="ghost" onClick={close}>{t("common.back")}</Button><Button variant="danger" loading={a.is("discard")} onClick={() => act("discard", `/requests/${id}/cancel`, { reason: (v.reason?.trim().length ?? 0) >= 3 ? v.reason.trim() : t("bz.draft_discarded") }, "bz.draft_discarded")}>{t("bz.draft_discard_confirm")}</Button></>}>
        <Notice tone="info">{t("bz.draft_discard_note")}</Notice><Textarea label={t("req.reason")} value={v.reason ?? ""} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </Modal>
      <Modal open={m?.kind === "urgent"} onClose={close} title={t("req.urgent")} footer={<><Button variant="ghost" onClick={close}>{t("common.cancel")}</Button><Button loading={a.is("urgent")} disabled={!v.reason} onClick={() => act("urgent", `/requests/${id}/urgent-help`, { reason: t(`urgent.${v.reason}`), note: v.note, ...(offer ? { offerId: offer.id } : {}) }, "req.urgent_sent")}>{t("common.submit")}</Button></>}>
        {offer && <Notice tone="info">{t("bz.urgent_for_driver", { name: offer.driver.name })}</Notice>}
        <div className="flex flex-wrap gap-2">{["driver_late", "driver_unreachable", "wrong_count", "safety", "other"].map((k) => <button key={k} type="button" onClick={() => setV({ ...v, reason: k })} aria-pressed={v.reason === k} className={cn("rounded-full border px-3 py-1.5 text-sm", v.reason === k ? "border-gold bg-gold/10 text-gold" : "border-line text-muted")}>{t(`urgent.${k}`)}</button>)}</div>
        <Textarea label={t("support.details")} value={v.note ?? ""} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </Modal>
      <Modal open={m?.kind === "noshow"} onClose={close} title={t("act.no_show")} footer={<><Button variant="ghost" onClick={close}>{t("common.cancel")}</Button><Button variant="danger" loading={a.is("ns")} disabled={!v.reason?.trim()} onClick={() => act("ns", `/offers/${offer.id}/attendance`, { present: false, reason: v.reason })}>{t("common.confirm")}</Button></>}>
        <Notice tone="info">{t("req.noshow_note")}</Notice><Textarea label={t("req.reason")} value={v.reason ?? ""} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </Modal>
      <Modal open={m?.kind === "loading" && !manifest} onClose={close} title={t("act.record_loading")} footer={<><Button variant="ghost" onClick={close}>{t("common.cancel")}</Button><Button loading={a.is("ld")} onClick={() => act("ld", `/offers/${offer.id}/loading`, { units: Number(v.units) })}>{t("common.save")}</Button></>}>
        <Input label={t("units.loaded")} type="number" min={0} value={v.units ?? ""} onChange={(e) => setV({ ...v, units: e.target.value })} hint={t("req.loading_hint")} />
      </Modal>
      {m?.kind === "handover" && <HandoverDialog requestId={id} offerId={m.offer.id} onClose={close} onDone={done} onCompleteDetails={() => { close(); c.setCompleting(true); }} />}
      {c.completing && <CompleteDetailsDialog requestId={id} onClose={() => c.setCompleting(false)} onChanged={onChanged} />}
      {m?.kind === "cash" && <ReceiveCashDialog offerId={m.offer.id} onClose={close} onDone={() => onChanged()} />}
      {m?.kind === "returns" && <ReturnsDialog requestId={id} offerId={m.offer.id} onClose={close} onDone={done} />}
      {m?.kind === "custody" && <CustodyHandoverModal offerId={m.offer.id} itemTypes={cat?.custodyItemTypes ?? []} onClose={close} onDone={done} />}
      <Modal open={m?.kind === "rate"} onClose={close} title={t("act.rate")} footer={<><Button variant="ghost" onClick={close}>{t("common.cancel")}</Button><Button loading={a.is("rt")} onClick={() => act("rt", `/offers/${offer.id}/rate`, { stars: v.stars, comment: v.comment })}>{t("common.submit")}</Button></>}>
        <div className="flex justify-center gap-1" role="radiogroup" aria-label={t("act.rate")}>{[1, 2, 3, 4, 5].map((s) => <button key={s} type="button" role="radio" aria-checked={v.stars === s} aria-label={`${s}`} onClick={() => setV({ ...v, stars: s })}><Star className={cn("size-9", s <= (v.stars ?? 0) ? "fill-gold text-gold" : "text-line")} /></button>)}</div>
        <Textarea label={t("rate.comment")} value={v.comment ?? ""} onChange={(e) => setV({ ...v, comment: e.target.value })} />
      </Modal>
      {c.report && <SupportComposer kind="ticket" switchable link={c.report} onClose={() => c.setReport(null)} onCreated={() => onChanged()} />}
    </>
  );
}
