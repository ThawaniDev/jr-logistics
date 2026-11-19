"use client";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Banknote } from "lucide-react";
import { Button, ErrorState, Input, Modal, Notice, PageLoading, Select, Textarea, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError, post } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { formatSarInput, receiveAmountCheck } from "./business-fieldops-lib";

/** `GET /business/cod` (E.7): what drivers hold of the warehouse's cash, per driver and per order. */
export interface CodOrder { offerId: string; requestId: string; ref: string; collectedCents: number; receivedCents: number; outstandingCents: number }
export interface CodDriver { driverId: string; driverName: string; phoneMasked: string | null; outstandingCents: number; orders: CodOrder[] }
export interface CodOverview { totals: { collectedCents: number; receivedCents: number; outstandingCents: number }; drivers: CodDriver[] }
export const COD_KEY = "/business/cod";
export const REMITTANCES_KEY = "/business/cod/remittances";

/** Re-fetch everything that shows cash figures: the cash page, its history, the request page (per-driver cash) and the dashboard. */
export function useRefreshCod() {
  const { mutate } = useSWRConfig();
  return () => mutate((k) => typeof k === "string" && (k.startsWith(COD_KEY) || k.startsWith("/requests/") || k === "/business/overview"));
}

/** Drivers that still hold cash, each with only the orders where something is outstanding. */
export function holdersOf(data: CodOverview | undefined): CodDriver[] {
  return (data?.drivers ?? [])
    .map((d) => ({ ...d, orders: (d.orders ?? []).filter((o) => o.outstandingCents > 0) }))
    .filter((d) => d.orders.length > 0);
}

interface Props {
  /** Pre-select this order (and its driver) — used from a request's driver card. */
  offerId?: string;
  /** Pre-select this driver — used from the driver rows of the cash page. */
  driverId?: string;
  onClose: () => void;
  onDone?: () => void;
}

/**
 * "Receive money from driver": pick the driver (only those holding cash), the order, the amount (default = everything outstanding on it), an optional note.
 * One component for the cash page and the request page. Mount only while open.
 */
export function ReceiveCashDialog({ offerId, driverId, onClose, onDone }: Props) {
  const { t, locale } = useI18n(); const a = useAction(); const refresh = useRefreshCod();
  const { data, error, mutate } = useApi<CodOverview>(COD_KEY, { revalidateOnMount: true });
  const [pickDriver, setPickDriver] = useState<string | null>(null); const [pickOrder, setPickOrder] = useState<string | null>(null);
  const [amount, setAmount] = useState<string | null>(null); const [note, setNote] = useState(""); const [touched, setTouched] = useState(false);
  const [serverMax, setServerMax] = useState<number | null>(null);

  const holders = holdersOf(data);
  const driver = holders.find((d) => d.driverId === (pickDriver ?? driverId))
    ?? (pickDriver === null && offerId ? holders.find((d) => d.orders.some((o) => o.offerId === offerId)) : undefined)
    ?? (pickDriver === null && holders.length === 1 ? holders[0] : undefined);
  const orders = driver?.orders ?? [];
  const order = orders.find((o) => o.offerId === (pickOrder ?? offerId)) ?? (pickOrder === null && orders.length === 1 ? orders[0] : undefined);
  const amountText = amount ?? (order ? formatSarInput(order.outstandingCents) : "");
  const outstanding = order?.outstandingCents ?? 0;
  const check = order ? receiveAmountCheck(amountText, outstanding) : null;
  const errKey = serverMax != null ? "max" : check?.error;
  const errMsg = !errKey ? undefined : errKey === "max" ? t("fob.rcv_err_max", { max: fmtMoney(serverMax ?? outstanding, locale) }) : errKey === "invalid" ? t("fob.rcv_err_invalid") : touched ? t("fob.rcv_err_required") : undefined;
  const remaining = order && check && !check.error ? outstanding - check.cents : null;

  const submit = () => {
    setTouched(true);
    if (!order || !check || check.error) return;
    return a.run("rcv", () => post(`/business/cod/receive`, { offerId: order.offerId, amountCents: check.cents, ...(note.trim() ? { note: note.trim() } : {}) }), {
      onDone: () => { toast.success(t("fob.rcv_ok", { amount: fmtMoney(check.cents, locale) })); void refresh(); onDone?.(); onClose(); },
      onError: (e) => {
        if (e instanceof ApiError && e.code === "VALIDATION" && e.details.field === "amountCents") {
          const max = typeof e.details.max === "number" ? e.details.max : null;
          if (amount !== null) setServerMax(max ?? 0); // a typed amount: say what the real maximum is
          void mutate(); // somebody else recorded cash meanwhile: the default amount follows the fresh figures
        }
      },
    });
  };

  return (
    <Modal open onClose={onClose} busy={a.any} title={t("fob.rcv_title")}
      footer={<><Button variant="ghost" disabled={a.any} onClick={onClose} data-testid="cod-receive-cancel">{t("common.cancel")}</Button><Button loading={a.is("rcv")} disabled={!order || !!check?.error} onClick={submit} data-testid="cod-receive-submit"><Banknote className="size-4" aria-hidden />{t("fob.rcv_confirm")}</Button></>}>
      <div data-testid="cod-receive-dialog" className="space-y-4">
        {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : holders.length === 0 ? <Notice tone="info">{t("fob.rcv_none")}</Notice> : (
          <>
            <Notice tone="info">{t("fob.rcv_note")}</Notice>
            <Select label={t("fob.rcv_driver")} placeholder={t("common.select")} value={driver?.driverId ?? ""} data-testid="cod-driver-select"
              options={holders.map((d) => ({ value: d.driverId, label: `${d.driverName}${d.phoneMasked ? ` · ${d.phoneMasked}` : ""} — ${fmtMoney(d.outstandingCents, locale)}` }))}
              onChange={(e) => { setPickDriver(e.target.value); setPickOrder(null); setAmount(null); setServerMax(null); setTouched(false); }} />
            <Select label={t("fob.rcv_order")} placeholder={t("common.select")} value={order?.offerId ?? ""} disabled={!driver} data-testid="cod-order-select"
              options={orders.map((o) => ({ value: o.offerId, label: `${o.ref} — ${fmtMoney(o.outstandingCents, locale)}` }))}
              onChange={(e) => { setPickOrder(e.target.value); setAmount(null); setServerMax(null); setTouched(false); }} />
            {order && (
              <dl className="grid grid-cols-3 gap-2 text-center text-xs" data-testid="cod-order-figures">
                <div className="rounded-lg bg-bg2 px-1 py-2"><dt className="text-muted">{t("fob.cash_collected")}</dt><dd className="ltr-num font-bold tabular-nums">{fmtMoney(order.collectedCents, locale)}</dd></div>
                <div className="rounded-lg bg-bg2 px-1 py-2"><dt className="text-muted">{t("fob.cash_received")}</dt><dd className="ltr-num font-bold tabular-nums">{fmtMoney(order.receivedCents, locale)}</dd></div>
                <div className="rounded-lg bg-bg2 px-1 py-2"><dt className="text-muted">{t("fob.cash_outstanding")}</dt><dd className="ltr-num font-bold tabular-nums text-gold">{fmtMoney(order.outstandingCents, locale)}</dd></div>
              </dl>
            )}
            <div className="space-y-1.5">
              <Input label={t("fob.rcv_amount")} ltr inputMode="decimal" value={amountText} disabled={!order} data-testid="cod-amount" error={errMsg}
                onChange={(e) => { setAmount(e.target.value); setServerMax(null); setTouched(true); }} hint={order ? t("fob.rcv_amount_hint", { max: fmtMoney(outstanding, locale) }) : undefined} required />
              {order && <button type="button" className="text-xs font-semibold text-cyan hover:underline" onClick={() => { setAmount(formatSarInput(outstanding)); setServerMax(null); }} data-testid="cod-amount-all">{t("fob.rcv_all", { amount: fmtMoney(outstanding, locale) })}</button>}
            </div>
            {remaining != null && <p className="text-xs text-muted" role="status" data-testid="cod-remaining">{remaining > 0 ? t("fob.rcv_remaining", { amount: fmtMoney(remaining, locale) }) : t("fob.rcv_settles")}</p>}
            <Textarea label={t("fob.rcv_note_label")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} data-testid="cod-note" />
          </>
        )}
      </div>
    </Modal>
  );
}
