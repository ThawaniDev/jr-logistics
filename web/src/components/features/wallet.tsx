"use client";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, FlaskConical, Lock, Wallet } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, PageHeader, PageLoading, Stat, StatusBadge, Table, Td, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDateTime, fmtMoney, sarToCents } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { mutate as globalMutate } from "swr";

export function WalletPage() {
  const { t, locale } = useI18n(); const me = useUser(); const a = useAction();
  const { data, error, mutate } = useApi("/wallet"); const wd = useApi(me.role === "business" ? null : "/withdrawals");
  const { data: prof } = useApi("/profile");
  const [modal, setModal] = useState<null | "topup" | "withdraw">(null); const [amount, setAmount] = useState("");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const linked = prof?.profile?.officeLinkStatus === "linked";
  const after = () => { setModal(null); setAmount(""); mutate(); wd.mutate(); globalMutate("/wallet"); };
  const submit = () => modal === "topup"
    ? a.run("go", () => post("/wallet/topup", { amountCents: sarToCents(amount), idempotencyKey: crypto.randomUUID() }), { success: "wallet.topup_done", onDone: after })
    : a.run("go", () => post("/withdrawals", { amountCents: sarToCents(amount) }), { success: "wallet.withdraw_done", onDone: after });
  const earner = me.role !== "business";
  return (
    <>
      <PageHeader title={t(earner ? "nav.earnings" : "nav.wallet")} actions={me.role === "business" ? <Button onClick={() => setModal("topup")}><ArrowDownLeft className="size-4" />{t("wallet.topup")}</Button> : !linked && <Button onClick={() => setModal("withdraw")} disabled={data.availableCents <= 0}><ArrowUpRight className="size-4" />{t("wallet.withdraw")}</Button>} />
      {me.role === "business" && <div className="mb-5"><Notice tone="warn" title={t("wallet.sim_title")}><span className="flex items-center gap-2"><FlaskConical className="size-4" />{t("wallet.sim_note")}</span></Notice></div>}
      {linked && <div className="mb-5"><Notice tone="info">{t("wallet.linked_note")}</Notice></div>}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label={t("wallet.available")} value={<span className="ltr-num">{fmtMoney(data.availableCents, locale)}</span>} icon={<Wallet className="size-5" />} />
        {me.role === "business" ? <Stat label={t("wallet.reserved")} value={<span className="ltr-num">{fmtMoney(data.reservedCents, locale)}</span>} hint={t("wallet.reserved_hint")} tone="gold" icon={<Lock className="size-5" />} /> : <Stat label={t("wallet.held")} value={<span className="ltr-num">{fmtMoney(data.heldCents, locale)}</span>} hint={t("wallet.held_hint")} tone="gold" icon={<Lock className="size-5" />} />}
      </div>
      {earner && wd.data?.items?.length > 0 && (
        <div className="mb-6"><h2 className="mb-3 font-semibold">{t("wallet.withdrawals")}</h2>
          <Table head={[t("common.date"), t("common.amount"), t("common.status"), t("wallet.reference")]}>
            {wd.data.items.map((w: any) => <tr key={w.id}><Td>{fmtDateTime(w.createdAt, locale)}</Td><Td className="ltr-num tabular-nums">{fmtMoney(w.amountCents, locale)}</Td><Td><StatusBadge status={w.status} ns="wdstatus" /></Td><Td className="ltr-num text-muted">{w.paymentRef ?? w.note ?? "—"}</Td></tr>)}
          </Table></div>
      )}
      <h2 className="mb-3 font-semibold">{t("wallet.history")}</h2>
      {data.entries.length === 0 ? <EmptyState title={t("wallet.no_entries")} /> : (
        <Table head={[t("common.date"), t("wallet.type"), t("common.amount")]}>
          {data.entries.map((e: any) => { const d = e.availableDeltaCents + e.reservedDeltaCents * 0; const amt = e.availableDeltaCents !== 0 ? e.availableDeltaCents : e.reservedDeltaCents; return (
            <tr key={e.id}><Td className="text-muted">{fmtDateTime(e.createdAt, locale)}</Td><Td>{t(`ledger.${e.kind}`)} {e.simulated && <Badge tone="warn" className="ms-2">{t("wallet.simulated")}</Badge>}</Td><Td className={`ltr-num tabular-nums font-semibold ${d + amt >= 0 ? "text-accent" : "text-ink"}`}>{fmtMoney(amt, locale)}</Td></tr>); })}
        </Table>
      )}
      <Modal open={!!modal} onClose={() => setModal(null)} title={t(modal === "topup" ? "wallet.topup" : "wallet.withdraw")} footer={<><Button variant="ghost" onClick={() => setModal(null)}>{t("common.cancel")}</Button><Button loading={a.any} disabled={!(Number(amount) > 0)} onClick={submit}>{t("common.confirm")}</Button></>}>
        {modal === "topup" && <Notice tone="warn">{t("wallet.sim_note")}</Notice>}
        <Input label={t("wallet.amount_sar")} type="number" inputMode="decimal" min="1" step="0.01" ltr value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        {modal === "withdraw" && <p className="text-xs text-muted">{t("wallet.withdraw_hint")}</p>}
      </Modal>
    </>
  );
}
