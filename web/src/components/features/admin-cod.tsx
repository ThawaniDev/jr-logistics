"use client";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button, EmptyState, Input, KV, Modal, Notice, Select, Textarea, errText } from "@/components/ui";
import { ApiError, get, post } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { qs } from "./admin-common";
import { centsToSarText, checkReceiveAmount, driversOf, ordersOf, receiveMaxFrom, uniqueWarehouses, type CodRow } from "./admin-fieldops-lib";

const Money = ({ c }: { c: number | null | undefined }) => { const { locale } = useI18n(); return <span className="ltr-num tabular-nums">{fmtMoney(c, locale)}</span>; };

/** Every order with cash, all pages (capped): feeds the warehouse / driver filters, the generic "Receive money" chooser, the segment counts and the deep link. */
export function useCodDirectory(enabled: boolean) {
  return useSWR(enabled ? "admin-cod-directory" : null, async () => {
    const rows: CodRow[] = []; let total = Number.POSITIVE_INFINITY; let truncated = false;
    for (let page = 1; rows.length < total; page++) {
      if (page > 10) { truncated = true; break; }
      const r = await get(`/admin/cod${qs({ page, pageSize: 100 })}`);
      const items: CodRow[] = r.items ?? []; rows.push(...items); total = Number(r.total ?? rows.length);
      if (items.length === 0) break;
    }
    return { rows, truncated };
  }, { revalidateOnFocus: false, shouldRetryOnError: false });
}

// ───────────────────────── Receive money ─────────────────────────
interface ReceiveProps { open: boolean; row: CodRow | null; directory: CodRow[]; onClose: () => void; onDone: () => void }

/** "Receive money from driver": fixed order (row action) or warehouse → driver → order chooser. `POST /admin/cod/receive`. */
export function ReceiveMoneyModal(props: ReceiveProps) { return props.open ? <ReceiveInner {...props} /> : null; }
function ReceiveInner({ open, row, directory, onClose, onDone }: ReceiveProps) {
  const { t, locale } = useI18n();
  const outstanding = directory.filter((r) => r.outstandingCents > 0);
  const [sel, setSel] = useState({ b: "", d: "", o: "" }); const [amountText, setAmountText] = useState<string | null>(null); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [serverMax, setServerMax] = useState<number | null>(null); const [formErr, setFormErr] = useState<string | null>(null);
  // Fixed order, or the chosen chain (a level with a single option is picked for the user).
  const warehouses = uniqueWarehouses(outstanding);
  const b = row ? row.businessId : sel.b || (warehouses.length === 1 ? warehouses[0].id : "");
  const drivers = b ? driversOf(outstanding, b) : [];
  const d = row ? row.driverId : sel.d || (drivers.length === 1 ? drivers[0].id : "");
  const orders = b && d ? ordersOf(outstanding, b, d) : [];
  const oId = row ? row.offerId : sel.o || (orders.length === 1 ? orders[0].offerId : "");
  const order = row ?? orders.find((x) => x.offerId === oId) ?? null;
  const limit = serverMax ?? order?.outstandingCents ?? 0;
  const amount = amountText ?? (order ? centsToSarText(limit) : "");
  const check = order ? checkReceiveAmount(amount, limit) : { cents: null, problem: undefined };
  const problem = amountText === null ? undefined : check.problem;
  const money = (c: number) => fmtMoney(c, locale);

  const submit = async () => {
    if (!order || check.cents === null || check.problem) return;
    setBusy(true); setFormErr(null);
    try {
      await post("/admin/cod/receive", { offerId: order.offerId, amountCents: check.cents, ...(note.trim() ? { note: note.trim() } : {}) });
      toast.success(t("foa.cod_received_ok", { amount: money(check.cents), ref: order.ref }));
      onDone(); onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === "VALIDATION") {
        const max = receiveMaxFrom(e.details);
        if (max !== null) { setServerMax(max); setFormErr(t("foa.cod_amount_server_max", { max: money(max) })); onDone(); setBusy(false); return; }
      }
      const msg = errText(e, t); setFormErr(msg); toast.error(msg);
    } finally { setBusy(false); }
  };
  const canSubmit = !!order && check.cents !== null && !check.problem && limit > 0;
  return (
    <Modal open={open} onClose={onClose} busy={busy} title={t("foa.cod_receive_title")}
      footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button><Button data-testid="foa-cod-submit" loading={busy} disabled={!canSubmit} onClick={submit}>{t("foa.cod_receive_confirm")}</Button></>}>
      <Notice tone="info">{t("foa.cod_receive_note")}</Notice>
      {row ? (
        <dl data-testid="foa-cod-fixed">
          <KV label={t("foa.cod_warehouse")}>{row.businessName}</KV><KV label={t("foa.cod_driver")}>{row.driverName}</KV><KV label={t("foa.cod_order")}><span className="ltr-num">{row.ref}</span></KV>
          <KV label={t("foa.cod_collected")}><Money c={row.collectedCents} /></KV><KV label={t("foa.cod_received")}><Money c={row.receivedCents} /></KV>
          <KV label={t("foa.cod_outstanding")}><span className="font-semibold text-gold"><Money c={limit} /></span></KV>
        </dl>
      ) : outstanding.length === 0 ? <EmptyState title={t("foa.cod_nothing_outstanding")} /> : (
        <div className="space-y-3">
          <Select data-testid="foa-cod-sel-business" label={t("foa.cod_warehouse")} placeholder={t("common.select")} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} value={b} onChange={(e) => { setSel({ b: e.target.value, d: "", o: "" }); setAmountText(null); setServerMax(null); setFormErr(null); }} />
          <Select data-testid="foa-cod-sel-driver" label={t("foa.cod_driver")} placeholder={t("common.select")} disabled={!b} options={drivers.map((x) => ({ value: x.id, label: x.name }))} value={d} onChange={(e) => { setSel({ b, d: e.target.value, o: "" }); setAmountText(null); setServerMax(null); setFormErr(null); }} />
          <Select data-testid="foa-cod-sel-order" label={t("foa.cod_order")} placeholder={t("common.select")} disabled={!d} options={orders.map((x) => ({ value: x.offerId, label: `${x.ref} · ${t("foa.cod_outstanding")} ${money(x.outstandingCents)}` }))} value={oId} onChange={(e) => { setSel({ b, d, o: e.target.value }); setAmountText(null); setServerMax(null); setFormErr(null); }} />
          {order && <p className="text-xs text-muted">{t("foa.cod_order_summary", { collected: money(order.collectedCents), received: money(order.receivedCents), outstanding: money(order.outstandingCents) })}</p>}
        </div>
      )}
      {(row || outstanding.length > 0) && <>
        <div className="space-y-1.5">
          <Input data-testid="foa-cod-amount" label={t("foa.cod_amount")} ltr inputMode="decimal" disabled={!order} value={amount} placeholder="0.00"
            onChange={(e) => { setAmountText(e.target.value); setFormErr(null); }}
            error={problem === "invalid" ? t("foa.cod_amount_invalid") : problem === "max" ? t("foa.cod_amount_max", { max: money(limit) }) : undefined}
            hint={order && !problem ? t("foa.cod_amount_hint", { max: money(limit) }) : undefined} />
          {order && amountText !== null && check.cents !== limit && <Button size="sm" variant="ghost" onClick={() => { setAmountText(null); setFormErr(null); }}>{t("foa.cod_full_amount")}</Button>}
        </div>
        <Textarea data-testid="foa-cod-note" label={t("foa.cod_note")} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} hint={t("foa.cod_note_hint")} />
      </>}
      {formErr && <Notice tone="danger"><span data-testid="foa-cod-error">{formErr}</span></Notice>}
    </Modal>
  );
}
