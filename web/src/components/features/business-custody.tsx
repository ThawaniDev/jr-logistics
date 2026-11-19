"use client";
import { useState } from "react";
import { Plus, Trash2, Undo2 } from "lucide-react";
import { mutate as globalMutate } from "swr";
import { Button, Input, Modal, Notice, Select, StatusBadge, Textarea, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

const MAX_ITEMS = 20;
const OUTCOMES = ["returned", "not_returned", "damaged"] as const;
const OPEN_STATUSES = ["handed_over", "acknowledged"];
export const custodyKey = (offerId: string) => `/offers/${offerId}/custody`;

/** Items handed to one driver, each with its status and (while still open) a return action. */
export function OfferCustody({ offerId, canReturn }: { offerId: string; canReturn: boolean }) {
  const { t, locale } = useI18n(); const a = useAction();
  const { data, error, mutate } = useApi(custodyKey(offerId));
  const [ret, setRet] = useState<any>(null); const [outcome, setOutcome] = useState<string>("returned"); const [note, setNote] = useState("");
  const items: any[] = data?.items ?? [];
  if (error) return <p className="text-xs text-danger">{t("bz.custody_load_failed")} <button type="button" className="underline" onClick={() => mutate()}>{t("common.retry")}</button></p>;
  if (items.length === 0) return null;
  const label = (x: any) => `${x.qty}× ${t(`custody.${x.itemType}`)}${x.description ? ` — ${x.description}` : ""}`;
  const close = () => { setRet(null); setOutcome("returned"); setNote(""); };
  const submit = () => a.run("ret", () => post(`/custody/${ret.id}/return`, { outcome, note: note.trim() || undefined }), { success: "bz.custody_returned_ok", onDone: () => { close(); void mutate(); } });
  return (
    <div className="space-y-2 rounded-xl border border-line p-3">
      <p className="text-xs font-semibold text-muted">{t("bz.custody_title")}</p>
      <ul className="space-y-2">
        {items.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="min-w-0"><p className="font-medium">{label(x)}</p>{x.returnNote && <p className="text-xs text-muted">{x.returnNote}</p>}{x.returnedAt && <p className="text-xs text-muted">{fmtDateTime(x.returnedAt, locale)}</p>}</div>
            <div className="flex items-center gap-2">
              <StatusBadge status={x.status} />
              {canReturn && OPEN_STATUSES.includes(x.status) && <Button size="sm" variant="secondary" onClick={() => setRet(x)}><Undo2 className="size-4" />{t("bz.custody_return")}</Button>}
            </div>
          </li>
        ))}
      </ul>
      {ret && (
        <Modal open onClose={close} busy={a.is("ret")} title={t("bz.custody_return_title")} footer={<><Button variant="ghost" onClick={close}>{t("common.cancel")}</Button><Button loading={a.is("ret")} onClick={submit}>{t("common.confirm")}</Button></>}>
          <Notice tone="info">{t("bz.custody_return_hint", { item: label(ret) })}</Notice>
          <Select label={t("bz.custody_outcome")} options={OUTCOMES.map((k) => ({ value: k, label: t(`status.${k}`) }))} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          <Textarea label={t("bz.custody_note")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Modal>
      )}
    </div>
  );
}

type Row = { itemType: string; qty: string; description: string };
/** Hand several items to a driver in one go (the API accepts up to 20). Mount only while open. */
export function CustodyHandoverModal({ offerId, itemTypes, onClose, onDone }: { offerId: string; itemTypes: string[]; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n(); const a = useAction();
  const [rows, setRows] = useState<Row[]>([{ itemType: itemTypes[0] ?? "", qty: "1", description: "" }]);
  const upd = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const valid = rows.length > 0 && rows.every((r) => r.itemType && Number(r.qty) >= 1 && Number.isInteger(Number(r.qty)) && Number(r.qty) <= 100);
  const submit = () => a.run("cu", () => post(custodyKey(offerId), { items: rows.map((r) => ({ itemType: r.itemType, qty: Number(r.qty), ...(r.description.trim() ? { description: r.description.trim() } : {}) })) }),
    { success: "bz.custody_handed_ok", onDone: () => { void globalMutate(custodyKey(offerId)); onDone(); } });
  return (
    <Modal open onClose={onClose} busy={a.is("cu")} title={t("act.custody")} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={a.is("cu")} disabled={!valid} onClick={submit}>{t("common.confirm")}</Button></>}>
      <div className="space-y-4">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-[1fr_96px_auto]">
            <Select label={t("custody.item")} options={itemTypes.map((k) => ({ value: k, label: t(`custody.${k}`) }))} value={r.itemType} onChange={(e) => upd(i, { itemType: e.target.value })} />
            <Input label={t("custody.qty")} type="number" min={1} max={100} value={r.qty} onChange={(e) => upd(i, { qty: e.target.value })} />
            <div className="flex items-end">{rows.length > 1 && <Button variant="ghost" size="sm" aria-label={t("bz.custody_remove")} title={t("bz.custody_remove")} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>}</div>
            <div className="sm:col-span-3"><Input label={t("bz.custody_desc")} value={r.description} onChange={(e) => upd(i, { description: e.target.value })} maxLength={200} /></div>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" size="sm" disabled={rows.length >= MAX_ITEMS} onClick={() => setRows((r) => [...r, { itemType: itemTypes[0] ?? "", qty: "1", description: "" }])}><Plus className="size-4" />{t("bz.custody_add")}</Button>
          <p className="text-xs text-muted">{t("bz.custody_limit")}</p>
        </div>
      </div>
    </Modal>
  );
}
