"use client";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BadgeCheck, Banknote, Coins, Hourglass, XCircle } from "lucide-react";
import { Button, CellPair, EmptyState, ErrorState, Notice, PageHeader, PageLoading, Pagination, SearchBox, Segmented, Stat, StatGrid, StatusBadge, Table, Td } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { useAllRows } from "./office-data";
import { SETTLEMENT_STATUSES, isSettlementStatus, matchesQuery, paginate, settlementCounts, sumBy, type OfficeSettlement } from "./office-lib";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

const PAGE = 25;
interface Money { paidCents: number; approvedCents: number; pendingCents: number; failedCents: number; rejectedCents: number }

function Settlements() {
  const { t, locale } = useI18n(); const sp = useSearchParams();
  const [statusRaw, setStatus] = useUrlState("status", "all");
  const status = isSettlementStatus(statusRaw) ? statusRaw : "all";
  const [q, setQ] = useState(sp.get("q") ?? ""); const [page, setPage] = useState(1);
  const all = useAllRows<OfficeSettlement>("/office/settlements", { revalidateOnFocus: true });
  const report = useApi<{ money: Money }>("/office/reports", { revalidateOnFocus: true });
  const items = all.data?.items;
  const counts = useMemo(() => settlementCounts(items ?? []), [items]);
  const rows = useMemo(() => (items ?? []).filter((s) => (status === "all" || s.status === status) && matchesQuery(q, s.ref, s.driver)), [items, status, q]);
  if (all.error && !items) return <ErrorState error={all.error} retry={() => all.mutate()} />;
  if (!items) return <PageLoading />;

  const m = report.data?.money;
  const money = (c: number | undefined) => (c == null ? "—" : <span className="ltr-num">{fmtMoney(c, locale)}</span>);
  const pageNo = Math.min(page, Math.max(1, Math.ceil(rows.length / PAGE)));
  const href = (s: string) => (s === "all" ? "/office/settlements" : `/office/settlements?status=${s}`);
  const toolbar = (
    <>
      <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t("rdo.set_search")} label={t("rdo.set_search")} />
      <Segmented label={t("common.status")} value={status} onChange={(k) => { setStatus(k); setPage(1); }} options={[{ key: "all", label: t("common.all"), count: counts.all }, ...SETTLEMENT_STATUSES.map((s) => ({ key: s, label: t(`settle.${s}`), count: counts[s] }))]} />
    </>
  );

  return (
    <>
      <PageHeader title={t("nav.settlements")} subtitle={t("office.settle_sub")} actions={<Link href="/office/wallet"><Button variant="secondary"><Banknote className="size-4" aria-hidden />{t("nav.payouts")}</Button></Link>} />
      <StatGrid cols={4} className="mb-5">
        <Stat label={t("office.money_pending")} value={money(m?.pendingCents)} loading={!m && !report.error} icon={<Hourglass className="size-5" />} tone="gold" hint={t("rdo.set_pending_hint")} href={href("pending_review")} />
        <Stat label={t("office.money_approved")} value={money(m?.approvedCents)} loading={!m && !report.error} icon={<BadgeCheck className="size-5" />} tone="cyan" hint={t("rdo.set_approved_hint")} href={href("approved")} />
        <Stat label={t("office.paid_total")} value={money(m?.paidCents)} loading={!m && !report.error} icon={<Coins className="size-5" />} hint={t("rdo.set_paid_hint")} href={href("paid")} />
        <Stat label={t("office.money_failed")} value={money(m?.failedCents)} loading={!m && !report.error} icon={<XCircle className="size-5" />} tone={m && m.failedCents > 0 ? "danger" : "muted"} hint={m ? t("rdo.set_failed_hint", { amount: fmtMoney(m.rejectedCents, locale) }) : undefined} href={href("failed")} />
      </StatGrid>
      {all.data?.truncated && <div className="mb-4"><Notice tone="info">{t("rdo.truncated_set", { n: items.length, total: all.data.total })}</Notice></div>}
      <Table stack label={t("nav.settlements")} toolbar={toolbar}
        head={[t("req.ref"), t("office.driver"), { label: t("units.final"), align: "end" }, { label: t("common.amount"), align: "end" }, t("common.status"), t("common.date"), t("office.paid_on")]}
        footer={rows.length > 0 ? <p className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted"><span>{t("rdo.set_count", { n: fmtNum(rows.length, locale) })}</span><span>{t("rdo.set_total")}: <strong className="ltr-num tabular-nums text-ink">{fmtMoney(sumBy(rows, (s) => s.amountCents), locale)}</strong></span></p> : undefined}
        empty={rows.length === 0 ? <EmptyState icon={<Coins className="size-9" aria-hidden />} title={items.length === 0 ? t("office.no_settlements") : t("common.no_results")} hint={items.length === 0 ? t("rdo.set_empty_hint") : t("rdo.set_no_match")}
          action={items.length > 0 ? <Button variant="secondary" onClick={() => { setQ(""); setStatus("all"); }}>{t("rdo.clear_filters")}</Button> : undefined} /> : null}>
        {paginate(rows, pageNo, PAGE).map((s) => (
          <tr key={s.id} data-testid="office-settlement-row" data-ref={s.ref}>
            <Td label={t("req.ref")}><CellPair href={`/office/jobs?status=all&ref=${encodeURIComponent(s.ref)}`} title={<span className="ltr-num">{s.ref}</span>} /></Td>
            <Td label={t("office.driver")}><CellPair title={<Link href={`/office/drivers/${s.driverId}`} className="hover:text-accent hover:underline">{s.driver}</Link>} /></Td>
            <Td label={t("units.final")} num>{s.finalUnits != null ? fmtNum(s.finalUnits, locale) : "—"}</Td>
            <Td label={t("common.amount")} num className="whitespace-nowrap font-semibold">{fmtMoney(s.amountCents, locale)}</Td>
            <Td label={t("common.status")}><StatusBadge status={s.status} ns="settle" /></Td>
            <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(s.createdAt, locale)}</Td>
            <Td label={t("office.paid_on")} className="whitespace-nowrap text-muted">{fmtDate(s.paidAt, locale)}</Td>
          </tr>
        ))}
      </Table>
      <Pagination page={pageNo} total={rows.length} pageSize={PAGE} onPage={setPage} />
    </>
  );
}
export function OfficeSettlements() { return <Suspense fallback={<PageLoading />}><Settlements /></Suspense>; }
