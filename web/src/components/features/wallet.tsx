"use client";
import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CreditCard, Download, FlaskConical, Info, Lock, Wallet } from "lucide-react";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";
import { Badge, Button, EmptyState, ErrorState, Input, Modal, Notice, PageHeader, PageLoading, Pagination, Section, Segmented, Stat, StatGrid, StatusBadge, Table, Td, errText, useAction } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { ApiError, get, post } from "@/lib/api";
import { fmtDateTime, fmtMoney, isoToRiyadhLocal } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { ledgerGroups, ledgerKinds, walletTone } from "./business-views-lib";
import { InvoicesSection } from "./business-views-wallet";

/** "250" / "250.5" / "250.50" → halalas. Anything else (exponents, 3 decimals, negatives, text) is rejected instead of silently rounded. */
const AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/;
/** Arabic-Indic / Persian digits and the Arabic decimal mark typed on a phone keyboard are accepted too. */
const latinDigits = (v: string) => v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٫,،]/g, ".");
export const parseSar = (v: string): number | null => { const s = latinDigits(v.trim()); return AMOUNT_RE.test(s) ? Math.round(Number(s) * 100) : null; };
const QUICK_TOPUPS = [100, 500, 1000, 5000]; // SAR
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const sar = (c: number) => (c / 100).toFixed(2);

/** +SAR 24.00 / −SAR 24.00 / – : the sign is part of the text so colour is never the only cue. */
function Delta({ cents, locale }: { cents: number; locale: Parameters<typeof fmtMoney>[1] }) {
  if (!cents) return <span className="text-muted">—</span>;
  return <span className={cn("ltr-num tabular-nums font-semibold", cents > 0 ? "text-accent" : "text-ink")}>{cents > 0 ? "+" : "−"}{fmtMoney(Math.abs(cents), locale)}</span>;
}

/** The wallet of any portal (company: balance + reservations + invoices; driver / office: earnings + withdrawals). */
export function WalletPage() { return <Suspense fallback={<PageLoading />}><WalletView /></Suspense>; }

function WalletView() {
  const { t, locale } = useI18n(); const me = useUser(); const a = useAction();
  const earner = me.role !== "business";
  const [page, setPage] = useState(1);
  const groups = ledgerGroups(earner);
  const [rawGroup, setGroup] = useUrlState("kind"); const group = groups.some((g) => g.key === rawGroup) ? rawGroup : "";
  const kinds = ledgerKinds(earner, group);
  const { data, error, mutate } = useApi(`/wallet?page=${page}${kinds.length ? `&kind=${kinds.join(",")}` : ""}`, { keepPreviousData: true }); const wd = useApi(earner ? "/withdrawals" : null);
  const { data: prof } = useApi("/profile");
  const [modal, setModal] = useState<null | "topup" | "withdraw">(null); const [amount, setAmount] = useState(""); const [touched, setTouched] = useState(false); const [needIban, setNeedIban] = useState(false);
  const [exporting, setExporting] = useState(false);
  // One idempotency key per top-up attempt: a retry after a network error can never charge twice; a fresh key is made only after success.
  const topupKey = useRef<string | null>(null);
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const linked = prof?.profile?.officeLinkStatus === "linked";
  const cents = parseSar(amount);
  const available: number = data.availableCents;
  const tooMuch = modal === "withdraw" && cents != null && cents > available;
  const amountError = !touched ? undefined : amount.trim() === "" || cents == null ? t("ubz.amount_invalid") : cents < 100 ? t("ubz.amount_min") : tooMuch ? t("ubz.amount_exceeds") : undefined;
  const canSubmit = cents != null && cents >= 100 && !tooMuch;
  const open = (m: "topup" | "withdraw") => { setAmount(""); setTouched(false); setNeedIban(false); setModal(m); };
  const close = () => { setModal(null); setNeedIban(false); };
  const after = () => { topupKey.current = null; setModal(null); setAmount(""); setTouched(false); mutate(); wd.mutate(); globalMutate("/wallet"); };
  const submit = () => {
    setTouched(true);
    if (!canSubmit || cents == null) return;
    if (modal === "topup") {
      topupKey.current ??= crypto.randomUUID();
      return a.run("go", () => post("/wallet/topup", { amountCents: cents, idempotencyKey: topupKey.current }), { success: "wallet.topup_done", onDone: after });
    }
    return a.run("go", () => post("/withdrawals", { amountCents: cents }), { success: "wallet.withdraw_done", onDone: after, onError: (e) => setNeedIban(e instanceof ApiError && e.code === "VALIDATION" && e.details.field === "iban") });
  };

  // Statement: every ledger page (never just the filtered view), newest first, as a UTF-8 CSV (BOM so Excel shows Arabic correctly), times in Riyadh.
  async function exportCsv() {
    setExporting(true);
    try {
      const first = await get("/wallet?page=1");
      const rows: any[] = [...first.entries];
      const pages = Math.min(Math.ceil(first.total / first.pageSize), 200);
      for (let p = 2; p <= pages; p++) rows.push(...(await get(`/wallet?page=${p}`)).entries);
      const head = [t("common.date"), t("wallet.type"), t("ubz.col_available"), earner ? t("wallet.held") : t("wallet.reserved"), t("wallet.simulated")];
      const lines = [head, ...rows.map((e) => [isoToRiyadhLocal(e.createdAt).replace("T", " "), kindLabel(e.kind), sar(e.availableDeltaCents), sar(earner ? e.heldDeltaCents ?? 0 : e.reservedDeltaCents), e.simulated ? "1" : ""])];
      const blob = new Blob(["﻿" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob); const el = document.createElement("a");
      el.href = url; el.download = `jr-wallet-statement-${isoToRiyadhLocal(new Date().toISOString()).slice(0, 10)}.csv`; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success(t("ubz.export_done", { n: rows.length }));
    } catch (e) { toast.error(errText(e, t)); } finally { setExporting(false); }
  }
  const kindLabel = (k: string) => { const v = t(`ledger.${k}`); return v.startsWith("ledger.") ? k : v; };
  const kindHelp = (k: string) => { const v = t(`ubz.ledger_${k}`); return v.startsWith("ubz.ledger_") ? null : v; };
  const groupLabel = (k: string) => (k === "" ? t("common.all") : t(`rdz.led_${k}`));
  const withdrawn: number = (wd.data?.items ?? []).filter((w: any) => w.status === "paid").reduce((s: number, w: any) => s + (w.amountCents ?? 0), 0);
  const credit: number = data.creditLimitCents ?? 0;
  const noEntriesAtAll = data.total === 0 && !group;

  return (
    <>
      <PageHeader title={t(me.role === "office" ? "nav.payouts" : earner ? "nav.earnings" : "nav.wallet")} subtitle={earner ? t("rdz.earn_sub") : t("ubz.wallet_sub")} actions={<>
        {!earner ? <Button onClick={() => open("topup")} data-testid="wallet-topup"><ArrowDownLeft className="size-4" aria-hidden />{t("wallet.topup")}</Button> : (!linked || available > 0) && <Button onClick={() => open("withdraw")} disabled={available <= 0} data-testid="wallet-withdraw"><ArrowUpRight className="size-4" aria-hidden />{t("wallet.withdraw")}</Button>}
      </>} />
      {!earner && <div className="mb-5"><Notice tone="warn" title={t("wallet.sim_title")}><span className="flex items-center gap-2"><FlaskConical className="size-4 shrink-0" aria-hidden />{t("wallet.sim_note")}</span></Notice></div>}
      {linked && <div className="mb-5"><Notice tone="info">{t("wallet.linked_note")}</Notice></div>}

      <StatGrid cols={3} className="mb-5">
        <Stat label={t("wallet.available")} value={<span className="ltr-num">{fmtMoney(available, locale)}</span>} hint={earner ? t("ubz.available_hint_earner") : t("ubz.available_hint")} tone={walletTone(available)} icon={<Wallet className="size-5" />} />
        {!earner
          ? <Stat label={t("wallet.reserved")} value={<span className="ltr-num">{fmtMoney(data.reservedCents, locale)}</span>} hint={t("ubz.reserved_hint2")} tone="gold" icon={<Lock className="size-5" />} />
          : <Stat label={t("wallet.held")} value={<span className="ltr-num">{fmtMoney(data.heldCents, locale)}</span>} hint={t("wallet.held_hint")} tone="gold" icon={<Lock className="size-5" />} />}
        {!earner
          ? <Stat label={t("rdz.k_credit")} value={<span className="ltr-num">{fmtMoney(credit, locale)}</span>} hint={credit > 0 ? t("rdz.k_credit_hint", { amount: fmtMoney(credit, locale) }) : t("rdz.k_credit_none")} tone="muted" icon={<CreditCard className="size-5" />} />
          : <Stat label={t("rdz.k_withdrawn")} value={<span className="ltr-num">{fmtMoney(withdrawn, locale)}</span>} hint={t("rdz.k_withdrawn_hint")} tone="muted" icon={<ArrowUpRight className="size-5" />} loading={wd.isLoading} />}
      </StatGrid>
      <details className="group mb-6 rounded-card border border-line bg-card/50 p-4 text-sm" open={!earner && data.total === 0}>
        <summary className="flex cursor-pointer items-center gap-2 font-medium text-muted marker:content-none"><Info className="size-4 text-cyan" aria-hidden />{t("ubz.how_title")}</summary>
        <ul className="mt-3 list-disc space-y-1.5 ps-5 text-muted">
          {(earner ? ["ubz.how_e1", "ubz.how_e2", "ubz.how_e3"] : ["ubz.how_b1", "ubz.how_b2", "ubz.how_b3", "ubz.how_b4"]).map((k) => <li key={k}>{t(k)}</li>)}
        </ul>
      </details>

      <div className="space-y-6">
        {earner && wd.data?.items?.length > 0 && (
          <Section title={t("wallet.withdrawals")} flush>
            <Table bare stack label={t("wallet.withdrawals")} head={[t("common.date"), { label: t("common.amount"), align: "end" }, t("common.status"), t("wallet.reference")]}>
              {wd.data.items.map((w: any) => <tr key={w.id}><Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(w.createdAt, locale)}</Td><Td label={t("common.amount")} num>{fmtMoney(w.amountCents, locale)}</Td><Td label={t("common.status")}><StatusBadge status={w.status} ns="wdstatus" /></Td><Td label={t("wallet.reference")} className="ltr-num text-muted">{w.paymentRef ?? w.note ?? "—"}</Td></tr>)}
            </Table>
          </Section>
        )}

        <Section title={t("wallet.history")} id="transactions" flush actions={data.entries.length > 0 || group ? <Button variant="secondary" size="sm" loading={exporting} onClick={exportCsv} data-testid="wallet-export"><Download className="size-4" aria-hidden />{t("ubz.export_csv")}</Button> : undefined}>
          {noEntriesAtAll ? (
            <div className="p-5"><EmptyState title={t("wallet.no_entries")} hint={earner ? undefined : t("ubz.no_entries_hint")} action={earner ? undefined : <Button onClick={() => open("topup")}><ArrowDownLeft className="size-4" aria-hidden />{t("wallet.topup")}</Button>} /></div>
          ) : (
            <>
              <div className="border-b border-line px-4 py-3"><Segmented label={t("rdz.led_filter")} value={group} onChange={(k) => { setGroup(k); setPage(1); }} options={[{ key: "", label: groupLabel("") }, ...groups.map((g) => ({ key: g.key, label: groupLabel(g.key) }))]} /></div>
              {data.entries.length === 0 ? <div className="p-5"><EmptyState title={t("common.no_results")} hint={t("rdz.led_none_hint")} action={<Button variant="secondary" onClick={() => setGroup("")}>{t("bz.clear_filters")}</Button>} /></div> : (
                <Table bare stack label={t("wallet.history")} head={[t("common.date"), t("wallet.type"), { label: t("ubz.col_available"), align: "end" }, { label: earner ? t("wallet.held") : t("wallet.reserved"), align: "end" }]}>
                  {data.entries.map((e: any) => { const help = kindHelp(e.kind); return (
                    <tr key={e.id} data-testid="wallet-entry">
                      <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(e.createdAt, locale)}</Td>
                      <Td label={t("wallet.type")}><span className="block text-end sm:text-start"><span className="font-medium">{kindLabel(e.kind)}</span>{e.simulated && <Badge tone="warn" className="ms-2">{t("wallet.simulated")}</Badge>}{e.requestRef && <span className="ms-2 text-xs">{!earner && e.requestId ? <Link href={`/business/requests/${e.requestId}/money`} className="ltr-num font-medium text-accent hover:underline">{e.requestRef}</Link> : <span className="ltr-num text-muted">{e.requestRef}</span>}</span>}{help && <span className="block text-xs text-muted">{help}</span>}</span></Td>
                      <Td label={t("ubz.col_available")} align="end"><Delta cents={e.availableDeltaCents} locale={locale} /></Td>
                      <Td label={earner ? t("wallet.held") : t("wallet.reserved")} align="end"><Delta cents={earner ? e.heldDeltaCents ?? 0 : e.reservedDeltaCents} locale={locale} /></Td>
                    </tr>); })}
                </Table>
              )}
              <div className="px-5 pb-4"><Pagination page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} /></div>
            </>
          )}
        </Section>

        {!earner && <InvoicesSection />}
      </div>

      <Modal open={!!modal} onClose={close} busy={a.any} title={t(modal === "withdraw" ? "wallet.withdraw" : "wallet.topup")} footer={<><Button variant="ghost" disabled={a.any} onClick={close}>{t("common.cancel")}</Button><Button loading={a.any} disabled={touched && !canSubmit} onClick={submit}>{canSubmit && cents != null ? t(modal === "withdraw" ? "ubz.confirm_withdraw" : "ubz.confirm_topup", { amount: fmtMoney(cents, locale) }) : t("common.confirm")}</Button></>}>
        {modal === "topup" && <Notice tone="warn">{t("wallet.sim_note")}</Notice>}
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
          <Input label={t("wallet.amount_sar")} type="text" inputMode="decimal" autoComplete="off" ltr value={amount} error={amountError} onBlur={() => amount && setTouched(true)} onChange={(e) => setAmount(e.target.value)} autoFocus disabled={a.any} placeholder="0.00" />
          {modal === "topup" && <div className="flex flex-wrap gap-2" role="group" aria-label={t("ubz.quick_amounts")}>{QUICK_TOPUPS.map((v) => <button key={v} type="button" disabled={a.any} onClick={() => { setAmount(String(v)); setTouched(true); }} className="jr-tap rounded-full border border-line px-3 py-1 text-sm text-muted transition hover:border-accent/60 hover:text-ink disabled:opacity-50"><span className="ltr-num">{fmtMoney(v * 100, locale)}</span></button>)}</div>}
          {modal === "withdraw" && <div className="flex items-center justify-between gap-3 text-xs text-muted"><span>{t("ubz.available_now", { amount: fmtMoney(available, locale) })}</span><button type="button" className="font-semibold text-cyan hover:underline" onClick={() => { setAmount(sar(available)); setTouched(true); }}>{t("ubz.withdraw_all")}</button></div>}
          {canSubmit && cents != null && <p className="rounded-xl bg-bg2 px-3 py-2 text-sm">{t("ubz.balance_after", { amount: fmtMoney(modal === "withdraw" ? available - cents : available + cents, locale) })}</p>}
          <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>{t("common.confirm")}</button>
        </form>
        {modal === "withdraw" && <p className="text-xs text-muted">{t("wallet.withdraw_hint")}</p>}
        {modal === "withdraw" && needIban && <Notice tone="warn">{t("m.iban_missing")} <Link href={`/${me.role}/profile`} className="font-semibold underline">{t("profile.open")}</Link></Notice>}
      </Modal>
    </>
  );
}
