"use client";
import { Suspense } from "react";
import { CalendarRange, Download, ListOrdered, Table2 } from "lucide-react";
import { Button, EmptyState, ErrorState, PageHeader, PageLoading, Pagination, Segmented, Stat, StatGrid, Table, Td, Toolbar } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser, hasPerm } from "@/components/layout/auth-context";
import { LinkButton, PeriodBar, PrevNext, qs, usePeriodFilter, useTx, useUrlPage } from "@/components/features/admin-common";
import { cleanReportType, pageRange, reportColumnAlign, reportTypesFor, stripUnit } from "@/components/features/admin-ops-lib";

const SIZE = 100;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
// Columns whose raw value is an enum code, and the translation namespace to use for it.
const ENUM_NS: Record<string, string> = { service: "svc", pickupCity: "city", deliveryCity: "city", city: "city", vehicleType: "vehicle", verificationStatus: "status", itemType: "custody", category: "complaint_cat", startStatus: "sla" };
const PERIOD_KEY = { "": "rda.period_all", today: "rda.period_today", "7d": "rda.period_7d", "30d": "rda.period_30d", month: "rda.period_month" } as const;

function Inner() {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const types = reportTypesFor(hasPerm(me, "finance.view"));
  const [typeRaw, setType] = useUrlState("type"); const type = cleanReportType(typeRaw, types);
  const period = usePeriodFilter(); const [page, setPage] = useUrlPage();
  const { data, error, mutate } = useApi(`/admin/reports/${type}${qs({ page, pageSize: SIZE, ...period.range })}`, { keepPreviousData: true });
  const cell = (col: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return "—";
    if (/Cents$/.test(col) && typeof v === "number") return fmtMoney(v, locale);
    if (typeof v === "string" && ISO.test(v)) return fmtDateTime(v, locale);
    if (col === "status") return tx(type === "settlements" ? `settle.${v}` : `status.${v}`, v);
    if (ENUM_NS[col]) return tx(`${ENUM_NS[col]}.${v}`, v);
    return String(v);
  };
  // The dictionary names money columns "Total (halalas)" but the cells show SAR, so the unit is dropped from the header.
  const colName = (c: string) => (/Cents$/.test(c) ? stripUnit(t(`col.${c}`)) : t(`col.${c}`));
  const rows: any[] = data?.rows ?? []; const cols: string[] = data?.columns ?? [];
  const total: number | undefined = typeof data?.total === "number" ? data.total : undefined;
  const r = pageRange(page, SIZE, rows.length);
  const periodLabel = period.period === "custom" ? `${period.from || "…"} – ${period.to || "…"}` : t(PERIOD_KEY[period.period]);
  const canExport = hasPerm(me, "reports.export");
  const loading = !data && !error;
  return (
    <>
      <PageHeader title={t("nav.reports")} subtitle={t("rda.reports_sub")}
        actions={canExport ? <LinkButton download href={`/api/v1/admin/reports/${type}${qs({ format: "csv", ...period.range })}`} data-testid="admin-reports-export"><Download className="size-4" aria-hidden />{t("reports.export")}</LinkButton> : undefined} />
      <section aria-label={t("rda.at_a_glance")} className="mb-5">
        <StatGrid cols={3}>
          <Stat label={t("reports.type")} value={t(`report.${type}`)} icon={<Table2 className="size-5" />} tone="cyan" hint={data ? t("rda.report_columns", { n: cols.length }) : undefined} loading={loading} />
          <Stat label={t("rda.report_rows")} value={total ?? (rows.length ? `${rows.length}${rows.length === SIZE ? "+" : ""}` : 0)} icon={<ListOrdered className="size-5" />} tone={rows.length ? "accent" : "muted"} hint={rows.length ? t("adm.showing_of", { from: r.from, to: r.to, total: total ?? r.to }) : undefined} loading={loading} />
          <Stat label={t("rda.period")} value={<span className="ltr-num text-xl">{periodLabel}</span>} icon={<CalendarRange className="size-5" />} tone="muted" hint={canExport ? t("adm.csv_full_note") : undefined} />
        </StatGrid>
      </section>
      <Toolbar><Segmented label={t("reports.type")} value={type} onChange={(k) => setType(k)} options={types.map((x) => ({ key: x, label: t(`report.${x}`) }))} /></Toolbar>
      <Toolbar end={period.active ? <Button variant="ghost" size="sm" onClick={period.clear} data-testid="admin-reports-clear">{t("uxa.clear_filters")}</Button> : undefined}><PeriodBar p={period} /></Toolbar>
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : rows.length === 0 ? (
        <EmptyState title={t("common.no_results")} hint={t("rda.reports_empty")} action={period.active ? <Button variant="secondary" onClick={period.clear}>{t("uxa.clear_filters")}</Button> : undefined} />
      ) : <>
        <Table stack dense label={t(`report.${type}`)} head={cols.map((c) => ({ label: colName(c), align: reportColumnAlign(c, rows) }))}>
          {rows.map((row, i) => (
            <tr key={i}>{cols.map((c) => {
              const align = reportColumnAlign(c, rows); const numeric = /Cents$/.test(c) || typeof row[c] === "number"; // dates keep their natural direction (an Arabic date inside an LTR isolate reads scrambled)
              return <Td key={c} label={colName(c)} align={align} className="whitespace-nowrap text-xs">{numeric ? <span className="ltr-num tabular-nums">{cell(c, row[c])}</span> : cell(c, row[c])}</Td>;
            })}</tr>
          ))}
        </Table>
        {total !== undefined ? <Pagination page={page} total={total} pageSize={SIZE} onPage={setPage} /> : <PrevNext page={page} hasNext={rows.length === SIZE} onPage={setPage} />}
      </>}
    </>
  );
}
export default function Reports() { return <Suspense fallback={<PageLoading />}><Inner /></Suspense>; }
