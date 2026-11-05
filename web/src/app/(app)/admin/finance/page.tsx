"use client";
import { useState } from "react";
import { Banknote, Play } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, PageHeader, PageLoading, Pagination, Stat, StatusBadge, Table, Tabs, Td, Textarea, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser, hasPerm } from "@/components/layout/auth-context";

export default function Finance() {
  const { t, locale } = useI18n(); const a = useAction(); const me = useUser();
  const [tab, setTab] = useState("settlements"); const [st, setSt] = useState("pending_review"); const [page, setPage] = useState(1);
  const [m, setM] = useState<null | { kind: "reject" | "pay_wd" | "reject_wd"; item: any }>(null); const [v, setV] = useState("");
  const sum = useApi("/admin/finance/summary"); const sets = useApi(`/admin/finance/settlements?status=${st}&page=${page}`); const wds = useApi("/admin/finance/withdrawals?status=pending");
  if (sum.error) return <ErrorState error={sum.error} retry={() => sum.mutate()} />;
  if (!sum.data) return <PageLoading />;
  const refresh = () => { sum.mutate(); sets.mutate(); wds.mutate(); setM(null); setV(""); };
  const act = (key: string, path: string, body?: unknown) => a.run(key, () => post(path, body), { success: "common.saved", onDone: refresh });
  const s = sum.data;
  return (
    <>
      <PageHeader title={t("nav.finance")} subtitle={t("fin.sub")} actions={hasPerm(me, "payouts.execute") && <Button loading={a.is("batch")} onClick={() => confirm(t("fin.batch_confirm")) && a.run("batch", () => post("/admin/finance/payout-batches"), { onDone: (b: any) => { refresh(); alert(t("fin.batch_done", { paid: b.paidCount, failed: b.failedCount })); } })}><Play className="size-4" />{t("fin.run_batch")}</Button>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("fin.platform_revenue")} value={<span className="ltr-num">{fmtMoney(s.platformRevenueCents, locale)}</span>} tone="accent" icon={<Banknote className="size-5" />} />
        <Stat label={t("fin.pending_payouts")} value={<span className="ltr-num">{fmtMoney(s.pendingPayoutCents, locale)}</span>} hint={t("fin.n_settlements", { n: s.pendingSettlements })} tone="gold" />
        <Stat label={t("fin.escrow")} value={<span className="ltr-num">{fmtMoney(s.userBalances.reservedCents, locale)}</span>} tone="cyan" />
        <Stat label={t("fin.wallet_liability")} value={<span className="ltr-num">{fmtMoney(s.userBalances.availableCents + s.userBalances.heldCents, locale)}</span>} tone="muted" />
      </div>
      <div className="mb-4"><Notice tone="warn">{t("fin.simulated_note")}</Notice></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "settlements", label: t("nav.settlements") }, { key: "withdrawals", label: t("wallet.withdrawals"), count: wds.data?.items?.length }]} />
      {tab === "settlements" && <>
        <Tabs value={st} onChange={(k) => { setSt(k); setPage(1); }} tabs={["pending_review", "reviewed", "approved", "failed", "paid", "rejected"].map((k) => ({ key: k, label: t(`settle.${k}`) }))} />
        {!sets.data ? <PageLoading /> : sets.data.items.length === 0 ? <EmptyState title={t("fin.none")} /> : <>
          <Table head={[t("common.date"), t("units.final"), t("fin.customer"), t("fin.provider"), t("admin.margin"), t("common.status"), ""]}>
            {sets.data.items.map((x: any) => <tr key={x.id}><Td className="text-muted">{fmtDateTime(x.createdAt, locale)}</Td><Td className="tabular-nums">{x.finalUnits}</Td><Td className="ltr-num tabular-nums">{fmtMoney(x.customerCents, locale)}</Td><Td className="ltr-num tabular-nums">{fmtMoney(x.providerCents, locale)} {x.officeId && <Badge tone="info">{t("admin.office_driver")}</Badge>}</Td><Td className="ltr-num tabular-nums text-gold">{fmtMoney(x.marginCents, locale)}</Td><Td><StatusBadge status={x.status} ns="settle" />{x.note && <p className="text-xs text-danger">{x.note}</p>}</Td>
              <Td><div className="flex flex-wrap gap-1">
                {x.status === "pending_review" && hasPerm(me, "settlements.review") && <Button size="sm" variant="secondary" loading={a.is("rv" + x.id)} onClick={() => act("rv" + x.id, `/admin/finance/settlements/${x.id}/review`)}>{t("fin.review")}</Button>}
                {["pending_review", "reviewed"].includes(x.status) && hasPerm(me, "settlements.approve") && <Button size="sm" loading={a.is("ap" + x.id)} onClick={() => act("ap" + x.id, `/admin/finance/settlements/${x.id}/approve`)}>{t("verify.approve")}</Button>}
                {x.status === "approved" && hasPerm(me, "payouts.execute") && <Button size="sm" loading={a.is("py" + x.id)} onClick={() => act("py" + x.id, `/admin/finance/settlements/${x.id}/pay`)}>{t("fin.pay")}</Button>}
                {x.status === "failed" && hasPerm(me, "payouts.execute") && <Button size="sm" variant="gold" loading={a.is("rt" + x.id)} onClick={() => act("rt" + x.id, `/admin/finance/settlements/${x.id}/retry`)}>{t("fin.retry")}</Button>}
                {!["paid", "rejected"].includes(x.status) && hasPerm(me, "settlements.review") && <Button size="sm" variant="danger" onClick={() => { setM({ kind: "reject", item: x }); setV(""); }}>{t("verify.reject")}</Button>}</div></Td></tr>)}
          </Table><Pagination page={page} total={sets.data.total} pageSize={25} onPage={setPage} /></>}
      </>}
      {tab === "withdrawals" && (!wds.data ? <PageLoading /> : wds.data.items.length === 0 ? <EmptyState title={t("fin.no_withdrawals")} /> : (
        <Table head={[t("common.name"), t("common.amount"), "IBAN", t("common.date"), ""]}>
          {wds.data.items.map((w: any) => <tr key={w.id}><Td className="font-medium">{w.userName}</Td><Td className="ltr-num font-semibold tabular-nums">{fmtMoney(w.amountCents, locale)}</Td><Td className="ltr-num text-xs text-muted">{w.iban}</Td><Td className="text-muted">{fmtDateTime(w.createdAt, locale)}</Td>
            <Td>{hasPerm(me, "withdrawals.manage") && <div className="flex gap-1"><Button size="sm" onClick={() => { setM({ kind: "pay_wd", item: w }); setV(""); }}>{t("fin.mark_paid")}</Button><Button size="sm" variant="danger" onClick={() => { setM({ kind: "reject_wd", item: w }); setV(""); }}>{t("verify.reject")}</Button></div>}</Td></tr>)}
        </Table>))}
      <Modal open={!!m} onClose={() => setM(null)} title={m?.kind === "pay_wd" ? t("fin.mark_paid") : t("verify.reject")} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.any} disabled={!v.trim()} onClick={() => m!.kind === "reject" ? act("m", `/admin/finance/settlements/${m!.item.id}/reject`, { reason: v }) : act("m", `/admin/finance/withdrawals/${m!.item.id}/decision`, m!.kind === "pay_wd" ? { decision: "paid", paymentRef: v } : { decision: "rejected", note: v })}>{t("common.confirm")}</Button></>}>
        {m?.kind === "pay_wd" ? <><Notice tone="warn">{t("fin.manual_transfer_note")}</Notice><Input label={t("wallet.reference")} ltr value={v} onChange={(e) => setV(e.target.value)} /></> : <Textarea label={t("req.reason")} value={v} onChange={(e) => setV(e.target.value)} />}
      </Modal>
    </>
  );
}
