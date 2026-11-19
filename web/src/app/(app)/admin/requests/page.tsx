"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Download, ListChecks, Truck, UserX } from "lucide-react";
import { Button, EmptyState, ErrorState, PageHeader, PageLoading, Pagination, SearchBox, Segmented, Select, Stat, StatGrid, Toolbar } from "@/components/ui";
import { useApi, useUrlPatch, useUrlState } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { useUser, hasPerm } from "@/components/layout/auth-context";
import { LinkButton, ToolbarDates, hasAny, qs, splitParcelCode, useCityNames, useDebounced, usePeriodFilter, useUrlPage } from "@/components/features/admin-common";
import { RequestsTable } from "@/components/features/admin-ops-requests";
import { alertsOfType, cleanStatus, REQUEST_FILTER_STATUSES, sumCounts, LIVE_REQUEST_STATUSES } from "@/components/features/admin-ops-lib";

const SIZE = 20;

function Inner() {
  const { t } = useI18n(); const me = useUser(); const sp = useSearchParams(); const router = useRouter(); const patch = useUrlPatch();
  const [statusRaw, setStatus] = useUrlState("status"); const status = cleanStatus(statusRaw);
  const [city, setCity] = useUrlState("city"); const [page, setPage] = useUrlPage();
  const period = usePeriodFilter();
  const [q, setQ] = useState(sp.get("q") ?? ""); const dq = useDebounced(q.trim());
  const { cities } = useCityNames();
  // A pasted parcel code (JR-000012-007) finds its request by the ref part; opening the row pre-filters the parcel list to that code.
  const parcel = splitParcelCode(dq);
  const list = useApi(`/admin/requests${qs({ page, pageSize: SIZE, status, q: parcel?.ref ?? dq, city, from: period.range.from, to: period.range.to })}`, { keepPreviousData: true, refreshInterval: 30000 });
  const stats = useApi("/admin/stats", { shouldRetryOnError: false }); const alerts = useApi("/admin/ops/alerts", { shouldRetryOnError: false, refreshInterval: 60000 });
  const { data, error, mutate } = list;
  // Deep links from other pages (`?go=1&q=<ref>`) jump straight into the request when the ref matches exactly one row.
  const go = sp.get("go") === "1";
  useEffect(() => {
    if (go && data?.items?.length === 1 && data.items[0].ref.toLowerCase() === dq.toLowerCase()) router.replace(`/admin/requests/${data.items[0].id}`);
  }, [go, data, dq, router]);

  const filtered = !!(dq || status || city || period.active);
  const counts: Record<string, number> | undefined = stats.data?.requests;
  // Status counts are platform-wide, so they are shown only while no other filter narrows the list (they would not match the rows).
  const showCounts = !!counts && !(dq || city || period.active);
  const all = counts ? Object.values(counts).reduce((a, n) => a + n, 0) : 0;
  const clear = () => { setQ(""); patch({ status: "", city: "", from: "", to: "" }); };
  const onQ = (v: string) => { setQ(v); if (page > 1) setPage(1); };
  const ac = alerts.data?.items;
  const loadingKpi = !counts && !stats.error;

  return (
    <>
      <PageHeader title={t("nav.requests")} subtitle={t("rda.req_sub")}
        actions={hasPerm(me, "reports.view") ? <LinkButton href={`/admin/reports${qs({ type: "requests", from: period.from, to: period.to })}`} data-testid="admin-requests-report"><Download className="size-4" aria-hidden />{t("nav.reports")}</LinkButton> : undefined} />
      <section aria-label={t("rda.at_a_glance")} className="mb-5">
        <StatGrid>
          <Stat loading={loadingKpi} label={t("admin.live_requests")} value={stats.error ? "—" : sumCounts(counts, LIVE_REQUEST_STATUSES)} icon={<ListChecks className="size-5" />} tone="cyan" hint={t("rda.live_hint", { n: (counts?.published ?? 0) + (counts?.filling ?? 0) })} />
          <Stat loading={loadingKpi} label={t("status.in_progress")} value={stats.error ? "—" : counts?.in_progress ?? 0} icon={<Truck className="size-5" />} tone="accent" href="/admin/requests?status=in_progress" hint={t("rda.in_progress_hint")} />
          <Stat loading={!ac && !alerts.error} label={t("rda.unfilled_label")} value={alerts.error ? "—" : alertsOfType(ac, "unfilled_soon")} icon={<AlertTriangle className="size-5" />} tone={alertsOfType(ac, "unfilled_soon") ? "gold" : "muted"} href={hasAny(me, "requests.view") ? "/admin/operations" : undefined} hint={t("rda.unfilled_hint")} />
          <Stat loading={!ac && !alerts.error} label={t("alert.driver_late")} value={alerts.error ? "—" : alertsOfType(ac, "driver_late")} icon={<UserX className="size-5" />} tone={alertsOfType(ac, "driver_late") ? "danger" : "muted"} href="/admin/operations" hint={t("rda.late_hint")} />
        </StatGrid>
      </section>
      <Toolbar>
        <Segmented label={t("common.status")} value={status} onChange={(k) => setStatus(k)}
          options={[{ key: "", label: t("common.all"), count: showCounts ? all : undefined }, ...REQUEST_FILTER_STATUSES.map((k) => ({ key: k, label: t(`status.${k}`), count: showCounts ? (counts?.[k] ?? 0) : undefined }))]} />
      </Toolbar>
      <Toolbar end={<>{filtered && <Button variant="ghost" size="sm" onClick={clear} data-testid="admin-requests-clear">{t("uxa.clear_filters")}</Button>}{data && <span className="text-sm text-muted" data-testid="admin-requests-total">{t("uxa.total_n", { n: data.total })}</span>}</>}>
        <SearchBox value={q} onChange={onQ} label={t("common.search")} placeholder={t("uxa.req_search_ph")} />
        <div className="w-44"><Select aria-label={t("wizard.pickup_city")} placeholder={t("rda.all_cities")} options={cities} value={city} onChange={(e) => setCity(e.target.value)} /></div>
        <ToolbarDates from={period.from} to={period.to} onFrom={period.setFrom} onTo={period.setTo} />
      </Toolbar>
      {parcel && <p className="mb-3 text-xs text-muted">{t("uxa.req_parcel_hint", { code: parcel.code, ref: parcel.ref })}</p>}
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : data.items.length === 0 ? (
        <EmptyState icon={<ListChecks className="size-9" aria-hidden />} title={t("common.no_results")} hint={dq ? t("uxa.req_no_match_hint") : filtered ? t("rda.req_empty_filtered") : t("rda.req_empty")} action={filtered ? <Button variant="secondary" onClick={clear}>{t("uxa.clear_filters")}</Button> : undefined} />
      ) : <>
        <RequestsTable items={data.items} parcel={parcel?.code} />
        <Pagination page={page} total={data.total} pageSize={SIZE} onPage={setPage} />
      </>}
    </>
  );
}
export default function AdminRequests() { return <Suspense fallback={<PageLoading />}><Inner /></Suspense>; }
