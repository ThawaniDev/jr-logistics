"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, BookText, Download, Scale, ListFilter } from "lucide-react";
import { Badge, Button, CellPair, PageHeader, Pagination, Select, Stat, StatGrid, Table, Td, Toolbar } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { dayEndIso, dayStartIso, downloadCsv, hasAny, qs, sar, useTx } from "./admin-common";
import { AccountFilter, DateRangeFilter, FilterChip, ListBody, Money, NoAccess, NoRows, PAGE, partyHref, useUrlFilters } from "./admin-finance-parts";

export const LEDGER_KINDS = ["topup", "reserve", "release_reserve", "refund", "payout", "platform_fee", "charge", "withdrawal_hold", "withdrawal_paid", "withdrawal_release", "adjustment"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTERS = ["kind", "userId", "request", "requestId", "from", "to"] as const;

/** A balance change: green when it adds, red when it takes, a dash when the column did not move. */
export function Delta({ c }: { c: number }) {
  const { locale } = useI18n();
  if (!c) return <span className="text-muted">—</span>;
  return <span className={`ltr-num tabular-nums ${c > 0 ? "text-accent" : "text-danger"}`}>{c > 0 ? "+" : ""}{fmtMoney(c, locale)}</span>;
}

export function LedgerView() {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const ok = hasAny(me, "finance.view", "wallets.view");
  const [f, setF] = useUrlFilters(FILTERS);
  const kind = LEDGER_KINDS.includes(f.kind) ? f.kind : "";
  const userId = UUID.test(f.userId) ? f.userId : "";
  const requestId = [f.request, f.requestId].find((v) => UUID.test(v)) ?? "";
  const [page, setPage] = useState(1);
  const filter = { kind, userId, requestId, from: dayStartIso(f.from), to: dayEndIso(f.to) };
  const list = useApi(ok ? `/admin/finance/ledger${qs({ ...filter, page, pageSize: PAGE })}` : null, { keepPreviousData: true });
  const totals = useApi(ok ? `/admin/finance/ledger/totals${qs(filter)}` : null, { keepPreviousData: true, shouldRetryOnError: false });
  if (!ok) return <NoAccess title={t("nav.fin_ledger")} />;
  const s = totals.data; const filtered = !!(kind || userId || requestId || f.from || f.to);
  const go = (patch: Partial<Record<(typeof FILTERS)[number], string>>) => { setPage(1); setF(patch); };
  const reset = () => go({ kind: "", userId: "", request: "", requestId: "", from: "", to: "" });
  const items: any[] = list.data?.items ?? [];
  const csv = () => downloadCsv("ledger.csv", [t("common.date"), t("adm.owner"), t("common.role"), t("wallet.type"), t("wallet.available"), t("wallet.reserved"), t("wallet.held"), t("req.ref"), t("adm.note")],
    items.map((e) => [e.createdAt, e.owner, e.ownerRole, tx(`ledger.${e.kind}`, e.kind), sar(e.availableDeltaCents), sar(e.reservedDeltaCents), sar(e.heldDeltaCents), e.requestId ?? "", e.note ?? ""]));
  return (
    <>
      <PageHeader title={t("nav.fin_ledger")} subtitle={t("rdf.ledger_sub")} icon={<BookText className="size-5" />} />
      <div className="mb-5"><StatGrid cols={4}>
        <Stat label={t("rdf.ledger_entries")} value={s && <span className="ltr-num">{s.entries}</span>} hint={t(filtered ? "rdf.in_view" : "rdf.all_time")} icon={<BookText className="size-5" />} tone="cyan" loading={!s} />
        <Stat label={t("rdf.money_in")} value={s && <Money c={s.inCents} />} hint={t("rdf.money_in_hint")} icon={<ArrowDownLeft className="size-5" />} tone="accent" loading={!s} />
        <Stat label={t("rdf.money_out")} value={s && <Money c={s.outCents} />} hint={t("rdf.money_out_hint")} icon={<ArrowUpRight className="size-5" />} tone="gold" loading={!s} />
        <Stat label={t("rdf.net_change")} value={s && <Money c={s.netCents} />} hint={t("rdf.net_change_hint")} icon={<Scale className="size-5" />} tone={s && s.netCents < 0 ? "danger" : "muted"} loading={!s} />
      </StatGrid></div>
      <Toolbar end={<>
        {filtered && <Button variant="ghost" size="sm" onClick={reset} data-testid="fin-clear-filters">{t("uxa.clear_filters")}</Button>}
        {items.length > 0 && <Button variant="secondary" size="sm" onClick={csv} data-testid="fin-ledger-csv"><Download className="size-4" aria-hidden />{t("adm.csv_page")}</Button>}
      </>}>
        <div className="w-full sm:w-52"><Select aria-label={t("wallet.type")} placeholder={t("rdf.ledger_all_types")} options={LEDGER_KINDS.map((k) => ({ value: k, label: t(`ledger.${k}`) }))} value={kind} onChange={(e) => go({ kind: e.target.value })} data-testid="fin-ledger-kind" /></div>
        <AccountFilter value={userId} onChange={(id) => go({ userId: id })} placeholder={t("rdf.ledger_account_ph")} clearLabel={t("common.clear")} testid="fin-ledger-account" />
        <DateRangeFilter from={f.from} to={f.to} onFrom={(v) => go({ from: v })} onTo={(v) => go({ to: v })} />
        {requestId && <FilterChip testid="fin-ledger-request-chip" clearLabel={t("uxa.ledger_request_filter")} onClear={() => go({ request: "", requestId: "" })}
          label={<Link href={`/admin/requests/${requestId}`} className="hover:underline">{t("rdf.ledger_one_request")}</Link>} />}
      </Toolbar>
      <ListBody error={list.error} loaded={!!list.data} isEmpty={items.length === 0} retry={() => list.mutate()}
        emptyState={<NoRows title={t("wallet.no_entries")} hint={t("rdf.ledger_empty_hint")} filtered={filtered} onReset={reset} icon={<BookText className="size-9" aria-hidden />} />}>
        <Table stack label={t("nav.fin_ledger")} head={[t("common.date"), t("adm.owner"), t("wallet.type"), { label: t("wallet.available"), align: "end" }, { label: t("wallet.reserved"), align: "end" }, { label: t("wallet.held"), align: "end" }, t("rdf.ledger_request")]}>
          {items.map((e) => (
            <tr key={e.id}>
              <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(e.createdAt, locale)}</Td>
              <Td label={t("adm.owner")}><div className="flex items-center gap-1.5">
                <CellPair href={partyHref(e.ownerRole, e.ownerId)} title={e.ownerRole === "platform" ? t("rdf.platform_account") : e.owner} sub={e.ownerRole === "platform" ? undefined : tx(`role.${e.ownerRole}`, e.ownerRole)} />
                {e.ownerId && !userId && <button type="button" onClick={() => go({ userId: e.ownerId })} aria-label={t("rdf.ledger_filter_account")} title={t("rdf.ledger_filter_account")} className="jr-tap flex size-7 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-bg2 hover:text-ink"><ListFilter className="size-4" aria-hidden /></button>}
              </div></Td>
              <Td label={t("wallet.type")}><CellPair title={<>{tx(`ledger.${e.kind}`, e.kind)}{e.simulated && <Badge tone="warn" className="ms-1.5">{t("wallet.simulated")}</Badge>}</>} sub={e.note ? <span title={e.note}>{e.note}</span> : undefined} className="max-w-64" /></Td>
              <Td label={t("wallet.available")} num><Delta c={e.availableDeltaCents} /></Td>
              <Td label={t("wallet.reserved")} num><Delta c={e.reservedDeltaCents} /></Td>
              <Td label={t("wallet.held")} num><Delta c={e.heldDeltaCents} /></Td>
              <Td label={t("rdf.ledger_request")} className="whitespace-nowrap">{e.requestId ? <Link href={`/admin/requests/${e.requestId}`} className="text-accent hover:underline">{t("rdf.ledger_open_request")}</Link> : "—"}</Td>
            </tr>))}
        </Table>
        <Pagination page={page} total={list.data?.total ?? 0} pageSize={PAGE} onPage={setPage} />
      </ListBody>
    </>
  );
}
