"use client";
import { Suspense } from "react";
import Link from "next/link";
import { Ban, Building2, RefreshCcw, Truck } from "lucide-react";
import { Badge, Button, CellPair, EmptyState, ErrorState, PageHeader, PageLoading, Segmented, Stat, StatGrid, Table, Td, Toolbar } from "@/components/ui";
import { useApi, useUrlPatch, useUrlState } from "@/components/ui/data";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { PeriodBar, PrevNext, hasAny, qs, useTx, usePeriodFilter, useUrlPage } from "@/components/features/admin-common";
import { cancellationKpis, cancellationParty, filterParty, isFollowOn, PARTIES, partyCounts, type Party } from "@/components/features/admin-ops-lib";

const SIZE = 50;
const PARTY_LABEL = { business: "role.business", driver: "role.driver", ops: "nav.operations" } as const;

function Inner() {
  const { t, locale } = useI18n(); const me = useUser(); const patch = useUrlPatch(); const tx = useTx();
  const period = usePeriodFilter();
  const [partyRaw, setParty] = useUrlState("party"); const party = (PARTIES as string[]).includes(partyRaw) ? partyRaw : "";
  const [page, setPage] = useUrlPage();
  const { data, error, mutate } = useApi(`/admin/cancellations${qs({ page, pageSize: SIZE, from: period.range.from, to: period.range.to })}`, { keepPreviousData: true });
  const kind = (k: string) => (k === "request_cancelled" ? t("adm.request_cancelled") : t(`status.${k}`));
  // Offers withdrawn along with a cancelled request are listed as follow-ons of that decision, not as driver cancellations (see admin-ops-lib).
  const items: any[] = (data?.items ?? []).map((x: any) => ({ ...x, followOn: isFollowOn(x), party: cancellationParty(x) }));
  const c = partyCounts(items); const k = cancellationKpis(items); const shown = filterParty(items, party);
  const complete = !!data && items.length === data.total; // every event of the period is on screen, so the counts below are exact
  const scope = complete ? t("rda.cx_scope_period") : t("rda.on_this_page");
  const filtered = !!(party || period.active);
  const clear = () => patch({ party: "", from: "", to: "" });
  const loading = !data && !error;
  return (
    <>
      <PageHeader title={t("nav.cancellations")} subtitle={t("adm.cancellations_sub")} />
      <section aria-label={t("rda.at_a_glance")} className="mb-5">
        <StatGrid>
          <Stat loading={loading} label={t("rda.cx_events")} value={data?.total ?? 0} icon={<Ban className="size-5" />} tone={data?.total ? "danger" : "muted"} hint={period.active ? t("rda.cx_in_range") : t("rda.period_all")} />
          <Stat loading={loading} label={t("rda.cx_requests")} value={k.requests} icon={<Building2 className="size-5" />} tone="cyan" hint={scope} />
          <Stat loading={loading} label={t("rda.cx_drivers")} value={k.drivers} icon={<Truck className="size-5" />} tone={k.drivers ? "gold" : "muted"} hint={scope} />
          <Stat loading={loading} label={t("rda.cx_ops")} value={k.replaced} icon={<RefreshCcw className="size-5" />} tone="muted" hint={scope} />
        </StatGrid>
      </section>
      <Toolbar end={<>{filtered && <Button variant="ghost" size="sm" onClick={clear} data-testid="admin-cx-clear">{t("uxa.clear_filters")}</Button>}{data && <span className="text-sm text-muted">{t("uxa.total_n", { n: data.total })}</span>}</>}>
        <Segmented label={t("adm.party")} value={party} onChange={(k) => setParty(k)} options={[{ key: "", label: t("common.all"), count: items.length }, ...PARTIES.map((p: Party) => ({ key: p, label: t(PARTY_LABEL[p]), count: c[p] }))]} />
      </Toolbar>
      <Toolbar><PeriodBar p={period} /></Toolbar>
      {data && !complete && party && <p className="mb-3 text-xs text-muted">{t("rda.cx_page_filter_note")}</p>}
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : shown.length === 0 ? (
        <EmptyState icon={<Ban className="size-9" aria-hidden />} title={t("common.no_results")} hint={filtered ? t("rda.cx_empty_filtered") : t("rda.cx_empty")} action={filtered ? <Button variant="secondary" onClick={clear}>{t("uxa.clear_filters")}</Button> : undefined} />
      ) : <>
        <Table stack label={t("nav.cancellations")} head={[t("common.date"), t("req.ref"), t("adm.party"), t("adm.who"), t("adm.event"), t("req.reason")]}>
          {shown.map((x, i) => (
            <tr key={`${x.requestId}-${x.kind}-${i}`} data-testid="admin-cx-row" data-kind={x.followOn ? "follow_on" : x.kind}>
              <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(x.at, locale)}</Td>
              <Td label={t("req.ref")}><CellPair title={hasAny(me, "requests.view") ? <Link href={`/admin/requests/${x.requestId}`} className="ltr-num text-accent hover:underline">{x.ref}</Link> : <span className="ltr-num">{x.ref}</span>} /></Td>
              <Td label={t("adm.party")}><Badge tone={x.party === "driver" ? "warn" : x.party === "business" ? "info" : "neutral"}>{t(PARTY_LABEL[x.party as Party] ?? "nav.operations")}</Badge></Td>
              <Td label={t("adm.who")}>{x.who}</Td>
              <Td label={t("adm.event")}><Badge tone={x.kind === "replaced" || x.followOn ? "neutral" : "danger"}>{x.followOn ? t("rda.cx_offer_withdrawn") : kind(x.kind)}</Badge></Td>
              <Td label={t("req.reason")} className="max-w-72 text-muted">{x.reason ? tx(`stopfail.${x.reason}`, x.reason) : "—"}</Td>
            </tr>
          ))}
        </Table>
        <PrevNext page={page} hasNext={items.length > 0 && page * SIZE < data.total} onPage={setPage} />
      </>}
    </>
  );
}
export default function Cancellations() { return <Suspense fallback={<PageLoading />}><Inner /></Suspense>; }
