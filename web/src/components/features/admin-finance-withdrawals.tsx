"use client";
import { useState } from "react";
import { mutate as refreshGlobal } from "swr";
import { ArrowDownToLine, CheckCircle2, Clock3, XCircle } from "lucide-react";
import { Button, CellPair, Input, KV, Modal, Notice, PageHeader, Pagination, Segmented, Stat, StatGrid, StatusBadge, Table, Td, Toolbar, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { CopyButton, ReasonModal, hasAny, qs, relTime } from "./admin-common";
import { ListBody, Money, NoAccess, NoRows, PAGE, partyHref, useUrlFilters } from "./admin-finance-parts";

type Decision = null | { kind: "pay" | "reject"; item: any };

export function WithdrawalsView() {
  const { t, locale } = useI18n(); const me = useUser(); const a = useAction();
  const ok = hasAny(me, "finance.view", "withdrawals.manage"); const canManage = hasPerm(me, "withdrawals.manage");
  const [f, setF] = useUrlFilters(["status"] as const);
  const st = ["paid", "rejected", "all"].includes(f.status) ? f.status : "pending";
  const [page, setPage] = useState(1);
  const [m, setM] = useState<Decision>(null); const [ref, setRef] = useState("");
  const list = useApi(ok ? `/admin/finance/withdrawals${qs({ status: st === "all" ? "" : st, page, pageSize: PAGE })}` : null, { keepPreviousData: true });
  const stats = useApi(ok ? "/admin/finance/withdrawals/stats" : null, { keepPreviousData: true, shouldRetryOnError: false });
  if (!ok) return <NoAccess title={t("nav.fin_withdrawals")} />;
  const s = stats.data;
  const go = (k: string) => { setPage(1); setF({ status: k === "pending" ? "" : k }); };
  const done = () => { void list.mutate(); void stats.mutate(); void refreshGlobal("/admin/stats"); setM(null); setRef(""); };
  const decide = (body: unknown) => a.run("wd", () => post(`/admin/finance/withdrawals/${m!.item.id}/decision`, body), { success: "common.saved", onDone: done });
  return (
    <>
      <PageHeader title={t("nav.fin_withdrawals")} subtitle={t("rdf.wd_sub")} icon={<ArrowDownToLine className="size-5" />} />
      <div className="mb-5"><StatGrid cols={4}>
        <Stat label={t("rdf.wd_waiting")} value={s && <span data-testid="fin-wd-pending-n">{s.pending.n}</span>} hint={s && <Money c={s.pending.cents} />} icon={<Clock3 className="size-5" />} tone={s && s.pending.n > 0 ? "gold" : "muted"} loading={!s} href="/admin/finance/withdrawals" />
        <Stat label={t("rdf.wd_oldest")} value={s && (s.pending.oldestAt ? relTime(s.pending.oldestAt, locale) : "—")} hint={s && (s.pending.oldestAt ? fmtDateTime(s.pending.oldestAt, locale) : t("rdf.wd_nothing_waiting"))} icon={<Clock3 className="size-5" />} tone="muted" loading={!s} />
        <Stat label={t("rdf.wd_paid_out")} value={s && <Money c={s.paid.cents} />} hint={t("rdf.requests_n", { n: s?.paid.n ?? 0 })} icon={<CheckCircle2 className="size-5" />} tone="accent" loading={!s} href="/admin/finance/withdrawals?status=paid" />
        <Stat label={t("status.rejected")} value={s && s.rejected.n} hint={s && <Money c={s.rejected.cents} />} icon={<XCircle className="size-5" />} tone="muted" loading={!s} href="/admin/finance/withdrawals?status=rejected" />
      </StatGrid></div>
      {canManage && <div className="mb-4"><Notice tone="warn">{t("fin.simulated_note")}</Notice></div>}
      <Toolbar>
        <Segmented label={t("common.status")} value={st} onChange={go} options={[
          { key: "pending", label: t("status.pending"), count: s?.pending.n }, { key: "paid", label: t("status.paid"), count: s?.paid.n },
          { key: "rejected", label: t("status.rejected"), count: s?.rejected.n }, { key: "all", label: t("common.all"), count: s?.all.n }]} />
      </Toolbar>
      <ListBody error={list.error} loaded={!!list.data} isEmpty={list.data?.items.length === 0} retry={() => list.mutate()}
        emptyState={<NoRows title={st === "pending" ? t("fin.no_withdrawals") : t("rdf.wd_empty")} hint={t("rdf.wd_empty_hint")} filtered={false} onReset={() => go("pending")} icon={<ArrowDownToLine className="size-9" aria-hidden />} />}>
        <Table stack label={t("nav.fin_withdrawals")} head={[t("common.name"), { label: t("adm.balance"), align: "end" }, { label: t("common.amount"), align: "end" }, "IBAN", t("common.date"), t("common.status"), { label: t("rdf.actions"), srOnly: true }]}>
          {list.data?.items.map((w: any) => (
            <tr key={w.id} data-testid={`fin-wd-row-${w.id}`}>
              <Td label={t("common.name")}><CellPair href={partyHref(w.userRole, w.userId)} title={w.userName} sub={w.userRole ? t(`role.${w.userRole}`) : undefined} /></Td>
              <Td label={t("adm.balance")} num className="text-muted"><Money c={w.balanceCents} /></Td>
              <Td label={t("common.amount")} num className="font-semibold"><Money c={w.amountCents} /></Td>
              <Td label="IBAN"><div className="flex items-center gap-1"><div className="min-w-0"><div className="ltr-num truncate text-xs">{w.iban}</div>{w.bankName && <div className="truncate text-xs text-muted">{w.bankName}</div>}</div>{w.iban && <CopyButton value={w.iban} label={t("uxa.copy_iban")} />}</div></Td>
              <Td label={t("common.date")}><CellPair title={<span className="whitespace-nowrap text-sm font-normal">{fmtDateTime(w.createdAt, locale)}</span>} sub={relTime(w.createdAt, locale)} /></Td>
              <Td label={t("common.status")}><StatusBadge status={w.status} />{w.paymentRef && <p className="ltr-num mt-1 text-xs text-muted">{w.paymentRef}</p>}{w.note && <p className="mt-1 max-w-48 text-xs text-muted">{w.note}</p>}</Td>
              <Td>{canManage && w.status === "pending" && <div className="flex flex-wrap gap-1.5"><Button size="sm" data-testid={`fin-wd-pay-${w.id}`} onClick={() => { setM({ kind: "pay", item: w }); setRef(""); }}>{t("fin.mark_paid")}</Button><Button size="sm" variant="danger" data-testid={`fin-wd-reject-${w.id}`} onClick={() => setM({ kind: "reject", item: w })}>{t("verify.reject")}</Button></div>}</Td>
            </tr>))}
        </Table>
        <Pagination page={page} total={list.data?.total ?? 0} pageSize={PAGE} onPage={setPage} />
      </ListBody>
      <Modal open={m?.kind === "pay"} onClose={() => setM(null)} busy={a.is("wd")} title={t("fin.mark_paid")} footer={<><Button variant="ghost" disabled={a.is("wd")} onClick={() => setM(null)}>{t("common.cancel")}</Button><Button data-testid="fin-wd-pay-confirm" loading={a.is("wd")} disabled={!ref.trim()} onClick={() => decide({ decision: "paid", paymentRef: ref.trim() })}>{t("common.confirm")}</Button></>}>
        <Notice tone="warn">{t("fin.manual_transfer_note")}</Notice>
        {m?.kind === "pay" && <dl className="text-sm">
          <KV label={t("common.name")}>{m.item.userName}</KV>
          <KV label={t("common.amount")}><span className="font-semibold"><Money c={m.item.amountCents} /></span></KV>
          <KV label="IBAN"><span className="ltr-num">{m.item.iban}</span><CopyButton value={m.item.iban ?? ""} label={t("uxa.copy_iban")} /></KV>
        </dl>}
        <Input label={t("wallet.reference")} ltr value={ref} onChange={(e) => setRef(e.target.value)} data-testid="fin-wd-ref" />
      </Modal>
      <ReasonModal open={m?.kind === "reject"} title={t("verify.reject")} danger busy={a.is("wd")} onClose={() => setM(null)} onSubmit={(r) => decide({ decision: "rejected", note: r })} />
    </>
  );
}
