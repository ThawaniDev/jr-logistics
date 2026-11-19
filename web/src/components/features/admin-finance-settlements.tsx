"use client";
import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, PauseCircle, Percent, Receipt } from "lucide-react";
import { Badge, Button, CellPair, Notice, PageHeader, Pagination, SearchBox, Segmented, Stat, StatGrid, Table, Td, Toolbar } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, dayEndIso, dayStartIso, qs, useDebounced, useTx } from "./admin-common";
import { settlementKind } from "./admin-fieldops-lib";
import { DateRangeFilter, ListBody, Money, NoAccess, NoRows, PAGE, partyHref, useUrlFilters } from "./admin-finance-parts";

/**
 * Settlements are created and paid automatically when a driver finishes a job. This is a history: `paid`, or `approved` = on hold
 * because of an open complaint (paid automatically once it is released). Rows left over in an older state are shown neutrally.
 */
export function SettleBadge({ x }: { x: { status?: string; held?: boolean } }) {
  const { t } = useI18n(); const tx = useTx();
  const kind = settlementKind(x);
  if (kind === "paid") return <Badge tone="success"><span data-testid="foa-settle-status-paid">{t("settle.paid")}</span></Badge>;
  if (kind === "hold") return <Badge tone="warn"><span data-testid="foa-settle-status-hold">{t("foa.fin_on_hold_badge")}</span></Badge>;
  return <Badge tone="neutral">{tx(`settle.${x.status}`, x.status)}</Badge>;
}

const FILTERS = ["status", "from", "to"] as const;

export function SettlementsView() {
  const { t, locale } = useI18n(); const me = useUser();
  const ok = hasAny(me, "finance.view", "settlements.review");
  const [f, setF] = useUrlFilters(FILTERS);
  const st = f.status === "paid" ? "paid" : f.status === "hold" || f.status === "approved" ? "hold" : "";
  const [q, setQ] = useState(""); const dq = useDebounced(q.trim()); const [page, setPage] = useState(1);
  const base = { q: dq, from: dayStartIso(f.from), to: dayEndIso(f.to) };
  const list = useApi(ok ? `/admin/finance/settlements${qs({ ...base, status: st === "hold" ? "approved" : st, page, pageSize: PAGE })}` : null, { keepPreviousData: true });
  const stats = useApi(ok ? `/admin/finance/settlements/stats${qs(base)}` : null, { keepPreviousData: true, shouldRetryOnError: false });
  if (!ok) return <NoAccess title={t("nav.settlements")} />;
  const s = stats.data; const filtered = !!(dq || st || f.from || f.to);
  const reset = () => { setQ(""); setPage(1); setF({ status: "", from: "", to: "" }); };
  const go = (patch: Partial<Record<(typeof FILTERS)[number], string>>) => { setPage(1); setF(patch); };
  return (
    <>
      <PageHeader title={t("nav.settlements")} subtitle={t("foa.fin_history_note")} icon={<Receipt className="size-5" />} />
      <div className="mb-5"><StatGrid cols={4}>
        <Stat label={t("rdf.settle_paid_out")} value={s && <Money c={s.paid.providerCents} />} hint={t("rdf.settlements_n", { n: s?.paid.n ?? 0 })} icon={<CheckCircle2 className="size-5" />} tone="accent" loading={!s} href="/admin/finance/settlements?status=paid" />
        <Stat label={t("foa.fin_tab_hold")} value={s && <Money c={s.hold.providerCents} />} hint={t("rdf.settlements_n", { n: s?.hold.n ?? 0 })} icon={<PauseCircle className="size-5" />} tone={s && s.hold.n > 0 ? "gold" : "muted"} loading={!s} href="/admin/finance/settlements?status=hold" />
        <Stat label={t("rdf.settle_charged")} value={s && <Money c={s.all.customerCents} />} hint={t("rdf.settle_charged_hint")} icon={<Receipt className="size-5" />} tone="cyan" loading={!s} />
        <Stat label={t("admin.margin")} value={s && <Money c={s.all.marginCents} />} hint={t("rdf.settle_margin_hint")} icon={<Percent className="size-5" />} tone="muted" loading={!s} />
      </StatGrid></div>
      {s && s.other.n > 0 && <div className="mb-4"><Notice tone="info">{t("rdf.settle_other_note", { n: s.other.n })}</Notice></div>}
      <Toolbar end={filtered && <Button variant="ghost" size="sm" onClick={reset} data-testid="fin-clear-filters">{t("uxa.clear_filters")}</Button>}>
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t("rdf.settle_search_ph")} label={t("common.search")} />
        <Segmented label={t("common.status")} value={st} onChange={(k) => go({ status: k })} options={[
          { key: "", label: t("common.all"), count: s?.all.n }, { key: "paid", label: t("settle.paid"), count: s?.paid.n }, { key: "hold", label: t("foa.fin_tab_hold"), count: s?.hold.n }]} />
        <DateRangeFilter from={f.from} to={f.to} onFrom={(v) => go({ from: v })} onTo={(v) => go({ to: v })} />
      </Toolbar>
      <ListBody error={list.error} loaded={!!list.data} isEmpty={list.data?.items.length === 0} retry={() => list.mutate()}
        emptyState={<NoRows title={t("fin.none")} hint={t("foa.fin_history_note")} filtered={filtered} onReset={reset} icon={<Receipt className="size-9" aria-hidden />} />}>
        <Table stack label={t("nav.settlements")} head={[t("foa.cod_order"), t("role.business"), t("adm.col_driver"), { label: t("rdf.units"), align: "end" }, { label: t("fin.customer"), align: "end" }, { label: t("fin.provider"), align: "end" }, { label: t("admin.margin"), align: "end" }, t("common.status")]}>
          {list.data?.items.map((x: any) => (
            <tr key={x.id} data-testid={`foa-settle-row-${x.id}`}>
              <Td label={t("foa.cod_order")}><CellPair href={`/admin/requests/${x.requestId}`} title={<span className="ltr-num font-semibold">{x.ref}</span>} sub={<span className="whitespace-nowrap">{fmtDateTime(x.createdAt, locale)}</span>} /></Td>
              <Td label={t("role.business")}>{x.businessName ? <CellPair href={partyHref("business", x.businessId)} title={x.businessName} /> : "—"}</Td>
              <Td label={t("adm.col_driver")}><CellPair href={partyHref("driver", x.driverId)} title={x.driverName}
                sub={x.officeId ? <Link href={partyHref("office", x.officeId)!} className="hover:text-ink hover:underline">{x.officeName ?? t("role.office")}</Link> : t("adm.direct")} /></Td>
              <Td label={t("rdf.units")} num>{x.finalUnits}</Td>
              <Td label={t("fin.customer")} num><Money c={x.customerCents} /></Td>
              <Td label={t("fin.provider")} num><Money c={x.providerCents} /></Td>
              <Td label={t("admin.margin")} num className="text-gold"><Money c={x.marginCents} /></Td>
              <Td label={t("common.status")}><SettleBadge x={x} />{settlementKind(x) === "hold" && <p className="mt-1 max-w-56 text-xs text-muted">{t("foa.fin_hold_hint")}</p>}</Td>
            </tr>))}
        </Table>
        <Pagination page={page} total={list.data?.total ?? 0} pageSize={PAGE} onPage={setPage} />
      </ListBody>
    </>
  );
}
