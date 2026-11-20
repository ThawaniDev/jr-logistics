"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Badge, EmptyState, ErrorState, Pagination, Segmented, Select, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { cn } from "@/lib/cn";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { DownloadMenu } from "@/components/reports/fleet/DownloadMenu";
import { API_PREFIX, type Format } from "@/components/reports/fleet/fleet-lib";
import { useDownload } from "@/components/reports/fleet/useDownload";
import { LEDGER_KINDS, STATEMENT_SOURCES, statementTypeKey } from "@/server/finance-drivers-lib";
import { hasAny, qs, useTx } from "./admin-common";
import { Money } from "./admin-finance-drivers-table";
import { ListSkeleton } from "./admin-finance-parts";

/** The five tabs of a driver's finance page. Each one pages `GET /admin/finance/drivers/:id/<table>` for the selected period and downloads the same selection as CSV / Excel. */
export type TabKey = "statement" | "settlements" | "ledger" | "withdrawals" | "cash";
const SIZE = 25;
type Cols = Array<string | { label: string; align?: "start" | "end"; srOnly?: boolean }>;

function OrderLink({ id, refNo }: { id: string | null; refNo: string | null }) {
  const me = useUser();
  if (!refNo) return <span className="text-muted">—</span>;
  return id && hasAny(me, "requests.view") ? <Link href={`/admin/requests/${id}`} className="ltr-num whitespace-nowrap font-semibold text-accent hover:underline">{refNo}</Link> : <span className="ltr-num whitespace-nowrap font-semibold">{refNo}</span>;
}
const Dt = ({ v }: { v: string | null }) => { const { locale } = useI18n(); return <span className="whitespace-nowrap text-muted">{v ? fmtDateTime(v, locale) : "—"}</span>; };

/** Paging, filter, totals, downloads and the loading / empty / error states shared by every tab. */
function TabShell({ id, table, period, filterKey, filter, head, children, totals, emptyHint }: {
  id: string; table: TabKey; period: string; filterKey?: "status" | "kind"; filter?: { value: string; node: (v: string, set: (x: string) => void) => ReactNode }; head: Cols;
  children: (rows: any[], data: any) => ReactNode; totals?: (t: Record<string, number>) => ReactNode; emptyHint: string;
}) {
  const { t, locale } = useI18n(); const me = useUser(); const dl = useDownload();
  const [page, setPage] = useState(1); const [f, setF] = useState(filter?.value ?? "");
  const query = (extra: Record<string, string | number> = {}) => qs({ ...(Object.fromEntries(new URLSearchParams(period)) as Record<string, string | number>), ...(filterKey && f ? { [filterKey]: f } : {}), ...extra });
  const { data, error, mutate } = useApi(`/admin/finance/drivers/${id}/${table}${query({ page, pageSize: SIZE })}`, { keepPreviousData: true, shouldRetryOnError: false });
  const rows: any[] = data?.rows ?? []; const loading = !data && !error;
  const href = (fmt: Format) => `${API_PREFIX}/admin/finance/drivers/${id}/${table}${query({ format: fmt, lang: locale, ...(table === "statement" ? { scope: "table" } : {}) })}`;
  const set = (v: string) => { setF(v); setPage(1); };
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  return (
    <div data-testid={`fdd-table-${table}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        {filter?.node(f, set)}
        <div className="ms-auto"><DownloadMenu href={href} busy={dl.busy} run={dl.run} canExport={hasPerm(me, "reports.export")} fileBase={`finance-driver-${table}`} testId={`fdd-download-${table}`} /></div>
      </div>
      {data?.totals && totals && <p className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted" data-testid={`fdd-totals-${table}`}>{totals(data.totals)}</p>}
      <Table stack label={t(`fdr.tab_${table}`)} head={head}
        empty={!loading && rows.length === 0 ? <div className="p-4"><EmptyState title={t("fdr.tab_empty")} hint={emptyHint} /></div> : undefined}
        footer={data ? <Pagination page={data.page ?? page} total={data.total} pageSize={data.pageSize ?? SIZE} onPage={setPage} /> : undefined}>
        {loading ? <tr><td colSpan={head.length}><ListSkeleton rows={5} /></td></tr> : children(rows, data)}
      </Table>
    </div>
  );
}
const Total = ({ label, c, testId }: { label: string; c: number | undefined; testId?: string }) => <span>{label}: <strong className="text-ink" data-testid={testId}><Money c={c ?? 0} /></strong></span>;
const word = (src: string) => `fdr_src.${src}`;
/** A signed amount: green in, red out; cash rows are neutral (cash held is not wallet money). */
function Signed({ c, neutral }: { c: number; neutral?: boolean }) {
  const { locale } = useI18n();
  return <span className={cn("ltr-num whitespace-nowrap font-semibold tabular-nums", neutral ? "text-ink" : c > 0 ? "text-accent" : c < 0 ? "text-danger" : "text-muted")}>{c > 0 ? "+" : c < 0 ? "−" : ""}{fmtMoney(Math.abs(c), locale)}</span>;
}

export function StatementTab({ id, period }: { id: string; period: string }) {
  const { t } = useI18n(); const tx = useTx();
  return (
    <TabShell id={id} table="statement" period={period} filterKey="kind" emptyHint={t("fdr.empty_statement")}
      filter={{ value: "", node: (v, set) => <Segmented label={t("fdr.c_source")} value={v || "all"} onChange={(k) => set(k === "all" ? "" : k)} options={[{ key: "all", label: t("common.all") }, ...STATEMENT_SOURCES.map((s) => ({ key: s, label: t(word(s)) }))]} /> }}
      head={[t("fdr.c_date"), t("fdr.c_source"), t("fdr.c_type"), t("fdr.c_order"), t("fdr.c_note"), { label: t("fdr.c_amount"), align: "end" }, { label: t("fdr.c_balance"), align: "end" }]}
      totals={(x) => <><Total label={t("fdr.st_settlements")} c={x.settlementCents} testId="fdd-st-settlements" /><Total label={t("fdr.st_wallet_in")} c={x.walletInCents} /><Total label={t("fdr.st_wallet_out")} c={x.walletOutCents} /><Total label={t("fdr.st_cash_in")} c={x.cashInCents} /><Total label={t("fdr.st_cash_out")} c={x.cashOutCents} /></>}>
      {(rows) => rows.map((r) => (
        <tr key={r.id} data-testid={`fdd-st-${r.source}`}>
          <Td label={t("fdr.c_date")}><Dt v={r.at} /></Td>
          <Td label={t("fdr.c_source")}><Badge tone={r.source === "wallet" ? "info" : r.source === "settlement" ? "success" : "neutral"}>{t(word(r.source))}</Badge></Td>
          <Td label={t("fdr.c_type")}>{tx(statementTypeKey(r.source, r.kind), r.kind)}{r.source === "settlement" && <span className="ms-2"><StatusBadge status={r.kind === "batch_ready" ? "approved" : r.kind} /></span>}</Td>
          <Td label={t("fdr.c_order")}><OrderLink id={r.requestId} refNo={r.ref} /></Td>
          <Td label={t("fdr.c_note")} className="max-w-64 truncate text-muted">{r.note ?? (r.office ? t("fdr.paid_to_office", { office: r.office }) : "—")}</Td>
          <Td label={t("fdr.c_amount")} align="end"><Signed c={r.amountCents} neutral={r.source.startsWith("cod_")} /></Td>
          <Td label={t("fdr.c_balance")} align="end">{r.balanceCents == null ? <span className="text-muted">—</span> : <Money c={r.balanceCents} />}</Td>
        </tr>
      ))}
    </TabShell>
  );
}

export function SettlementsTab({ id, period }: { id: string; period: string }) {
  const { t, locale } = useI18n();
  return (
    <TabShell id={id} table="settlements" period={period} filterKey="status" emptyHint={t("fdr.empty_settlements")}
      filter={{ value: "", node: (v, set) => <Segmented label={t("common.status")} value={v || "all"} onChange={(k) => set(k === "all" ? "" : k)} options={["all", "pending", "paid", "failed", "rejected"].map((k) => ({ key: k, label: k === "all" ? t("common.all") : t(`status.${k}`) }))} /> }}
      head={[t("fdr.c_order"), t("fdr.c_company"), { label: t("fdr.c_units"), align: "end" }, { label: t("fdr.c_earned"), align: "end" }, { label: t("fdr.c_adjustment"), align: "end" }, t("fdr.c_status"), t("fdr.c_date"), t("fdr.c_paid_on"), t("fdr.c_payee")]}
      totals={(x) => <><Total label={t("fdr.c_earned")} c={x.earnedCents} testId="fdd-set-earned" /><Total label={t("fdr.col_paidCents")} c={x.paidCents} /><Total label={t("fdr.col_pendingCents")} c={x.pendingCents} /></>}>
      {(rows) => rows.map((r) => (
        <tr key={r.id} data-testid={`fdd-set-${r.id}`}>
          <Td label={t("fdr.c_order")}><OrderLink id={r.requestId} refNo={r.ref} /></Td>
          <Td label={t("fdr.c_company")}>{r.business ?? "—"}</Td>
          <Td label={t("fdr.c_units")} num>{r.finalUnits}</Td>
          <Td label={t("fdr.c_earned")} align="end"><Money c={r.earnedCents} className="font-semibold" /></Td>
          <Td label={t("fdr.c_adjustment")} align="end">{r.adjustmentCents ? <Money c={r.adjustmentCents} /> : <span className="text-muted">—</span>}</Td>
          <Td label={t("fdr.c_status")}><StatusBadge status={r.status === "batch_ready" ? "approved" : r.status} /></Td>
          <Td label={t("fdr.c_date")} className="whitespace-nowrap text-muted">{fmtDate(r.createdAt, locale)}</Td>
          <Td label={t("fdr.c_paid_on")} className="whitespace-nowrap text-muted">{r.paidAt ? fmtDate(r.paidAt, locale) : "—"}</Td>
          <Td label={t("fdr.c_payee")}>{r.officeId ? <Badge tone="info">{r.payeeOffice ?? t("role.office")}</Badge> : <span className="text-muted">{t("fdr.payee_driver")}</span>}</Td>
        </tr>
      ))}
    </TabShell>
  );
}

export function LedgerTab({ id, period }: { id: string; period: string }) {
  const { t } = useI18n(); const tx = useTx();
  return (
    <TabShell id={id} table="ledger" period={period} filterKey="kind" emptyHint={t("fdr.empty_ledger")}
      filter={{ value: "", node: (v, set) => <div className="w-52"><Select aria-label={t("fdr.c_type")} value={v} onChange={(e) => set(e.target.value)} options={[{ value: "", label: t("fdr.any_type") }, ...LEDGER_KINDS.map((k) => ({ value: k, label: tx(`ledger.${k}`, k) }))]} /></div> }}
      head={[t("fdr.c_date"), t("fdr.c_type"), { label: t("fdr.c_amount"), align: "end" }, { label: t("fdr.c_balance"), align: "end" }, t("fdr.c_order"), t("fdr.c_note"), t("fdr.c_by")]}
      totals={(x) => <><Total label={t("fdr.c_credit")} c={x.creditCents} testId="fdd-led-credit" /><Total label={t("fdr.c_debit")} c={x.debitCents} testId="fdd-led-debit" /></>}>
      {(rows) => rows.map((r) => (
        <tr key={r.id}>
          <Td label={t("fdr.c_date")}><Dt v={r.createdAt} /></Td>
          <Td label={t("fdr.c_type")}>{tx(`ledger.${r.kind}`, r.kind)}{r.simulated && <Badge className="ms-2">{t("wallet.simulated")}</Badge>}</Td>
          <Td label={t("fdr.c_amount")} align="end"><Signed c={r.availableDeltaCents || 0} /></Td>
          <Td label={t("fdr.c_balance")} align="end"><Money c={r.balanceCents} /></Td>
          <Td label={t("fdr.c_order")}><OrderLink id={r.requestId} refNo={r.ref} /></Td>
          <Td label={t("fdr.c_note")} className="max-w-64 truncate text-muted">{r.note ?? "—"}</Td>
          <Td label={t("fdr.c_by")} className="text-muted">{r.actor ?? t("dv2.system")}</Td>
        </tr>
      ))}
    </TabShell>
  );
}

export function WithdrawalsTab({ id, period }: { id: string; period: string }) {
  const { t } = useI18n();
  return (
    <TabShell id={id} table="withdrawals" period={period} filterKey="status" emptyHint={t("fdr.empty_withdrawals")}
      filter={{ value: "", node: (v, set) => <Segmented label={t("common.status")} value={v || "all"} onChange={(k) => set(k === "all" ? "" : k)} options={["all", "open", "paid", "rejected"].map((k) => ({ key: k, label: k === "all" ? t("common.all") : k === "open" ? t("fdr.s_open") : t(`status.${k}`) }))} /> }}
      head={[t("fdr.c_requested"), { label: t("fdr.c_amount"), align: "end" }, t("fdr.c_status"), t("fdr.c_bank"), t("fdr.c_payment_ref"), t("fdr.c_decided"), t("fdr.c_note")]}
      totals={(x) => <><Total label={t("fdr.col_wdRequestedCents")} c={x.requestedCents} testId="fdd-wd-requested" /><Total label={t("fdr.col_wdPaidCents")} c={x.paidCents} /><Total label={t("fdr.col_wdPendingCents")} c={x.pendingCents} /><Total label={t("fdr.col_wdRejectedCents")} c={x.rejectedCents} /></>}>
      {(rows) => rows.map((r) => (
        <tr key={r.id}>
          <Td label={t("fdr.c_requested")}><Dt v={r.createdAt} /></Td>
          <Td label={t("fdr.c_amount")} align="end"><Money c={r.amountCents} className="font-semibold" /></Td>
          <Td label={t("fdr.c_status")}><StatusBadge status={r.status} /></Td>
          <Td label={t("fdr.c_bank")}>{r.bank ?? "—"}{r.ibanTail && <span className="ltr-num block text-xs text-muted">{r.ibanTail}</span>}</Td>
          <Td label={t("fdr.c_payment_ref")} className="ltr-num text-muted">{r.paymentRef ?? "—"}</Td>
          <Td label={t("fdr.c_decided")}><Dt v={r.decidedAt} />{r.decidedBy && <span className="block text-xs text-muted">{r.decidedBy}</span>}</Td>
          <Td label={t("fdr.c_note")} className="max-w-56 truncate text-muted">{r.note ?? "—"}</Td>
        </tr>
      ))}
    </TabShell>
  );
}

export function CashTab({ id, period }: { id: string; period: string }) {
  const { t } = useI18n(); const tx = useTx(); const me = useUser();
  return (
    <TabShell id={id} table="cash" period={period} filterKey="status" emptyHint={t("fdr.empty_cash")}
      filter={{ value: "", node: (v, set) => <Segmented label={t("fdr.c_outstanding")} value={v || "all"} onChange={(k) => set(k === "all" ? "" : k)} options={[{ key: "all", label: t("common.all") }, { key: "outstanding", label: t("fdr.s_outstanding") }]} /> }}
      head={[t("fdr.c_order"), t("fdr.c_warehouse"), t("fdr.c_office"), { label: t("fdr.c_parcels"), align: "end" }, { label: t("fdr.c_collected"), align: "end" }, { label: t("fdr.c_remitted"), align: "end" }, { label: t("fdr.c_outstanding"), align: "end" }, t("fdr.c_last_collected")]}
      totals={(x) => <><Total label={t("fdr.c_collected")} c={x.collectedCents} testId="fdd-cash-collected" /><Total label={t("fdr.c_remitted")} c={x.remittedCents} testId="fdd-cash-remitted" /><Total label={t("fdr.c_outstanding")} c={x.outstandingCents} testId="fdd-cash-outstanding" /></>}>
      {(rows) => rows.map((r) => (
        <tr key={r.id} data-testid={`fdd-cash-${r.offerId}`}>
          <Td label={t("fdr.c_order")}><OrderLink id={r.requestId} refNo={r.ref} /><span className="block text-xs text-muted">{r.business ?? ""}</span></Td>
          <Td label={t("fdr.c_warehouse")}><span className="block font-medium">{r.warehouse || "—"}</span>{r.warehouseCity && <span className="block text-xs text-muted">{tx(`city.${r.warehouseCity}`, r.warehouseCity)}</span>}</Td>
          <Td label={t("fdr.c_office")}>{r.officeId ? (hasAny(me, "offices.view", "offices.manage") ? <Link href={`/admin/offices/${r.officeId}`} className="text-accent hover:underline">{r.officeName ?? "—"}</Link> : r.officeName ?? "—") : <Badge>{t("fdr.independent")}</Badge>}</Td>
          <Td label={t("fdr.c_parcels")} num>{r.parcels}</Td>
          <Td label={t("fdr.c_collected")} align="end"><Money c={r.collectedCents} /></Td>
          <Td label={t("fdr.c_remitted")} align="end"><Money c={r.remittedCents} /></Td>
          <Td label={t("fdr.c_outstanding")} align="end"><Money c={r.outstandingCents} className={r.outstandingCents > 0 ? "font-semibold text-gold" : undefined} /></Td>
          <Td label={t("fdr.c_last_collected")}><Dt v={r.lastCollectedAt} /></Td>
        </tr>
      ))}
    </TabShell>
  );
}
