"use client";
import { useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Badge, ErrorState, Section, SearchBox, Segmented, Select, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { PARCEL_GROUPS, type ParcelGroup } from "@/server/details-people-lib";
import { hasAny, qs, useDebounced, useTx } from "./admin-common";
import { ListEmpty, LoadingRows, Money, pagerFooter } from "./admin-offices-common";
import { PeriodBar, usePeriod } from "./admin-driver-common";

const SIZE = 10;
const LABEL: Record<ParcelGroup, string> = { all: "common.all", delivered: "shipstatus.delivered", failed: "shipstatus.failed", returned: "shipstatus.returned", open: "dv2.g_open" };

/** Parcels a driver carried: delivered / failed / returned with the reason, attempts and times, filters in one row and a CSV export (`reports.export`). */
export function DriverParcelsTab({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const [period, setPeriod] = usePeriod("all"); const [group, setGroup] = useState<ParcelGroup>("all"); const [reason, setReason] = useState(""); const [city, setCity] = useState("");
  const [q, setQ] = useState(""); const dq = useDebounced(q.trim()); const [page, setPage] = useState(1);
  const query = { period, group: group === "all" ? "" : group, q: dq, reason, city };
  const { data, error, mutate } = useApi(`/admin/drivers/${id}/parcels${qs({ ...query, page, pageSize: SIZE })}`, { keepPreviousData: true });
  const rows: any[] = data?.items ?? []; const loading = !data && !error; const canRequest = hasAny(me, "requests.view");
  const head = [t("dv2.col_parcel"), t("req.ref"), t("dv2.col_recipient"), t("common.status"), t("dv2.col_reason"), t("dv2.col_arrived"), t("dv2.col_outcome"), { label: t("dv2.col_cod"), align: "end" as const }];
  const filtered = group !== "all" || !!dq || !!reason || !!city || period !== "all";
  const reasonLabel = (r: string) => tx(`stopfail.${r}`, r);
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  return (
    <div data-testid="dv2-parcels"><Section title={t("dv2.parcels_title")} description={t("dv2.parcels_sub")} flush
      actions={hasPerm(me, "reports.export") ? <a href={`/api/v1/admin/drivers/${id}/parcels${qs({ ...query, format: "csv" })}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline" data-testid="dv2-parcels-csv"><Download className="size-4" aria-hidden />{t("dtk.export")}</a> : undefined}>
      <Table stack bare dense label={t("dv2.parcels_title")} head={head}
        toolbar={<>
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t("dv2.search_parcels")} label={t("dv2.search_parcels")} />
          <Segmented label={t("dv2.parcels_title")} value={group} onChange={(k) => { setGroup(k as ParcelGroup); setPage(1); }} options={PARCEL_GROUPS.map((k) => ({ key: k, label: t(LABEL[k]), count: data?.counts?.[k] }))} />
          <div className="w-44"><Select aria-label={t("dv2.col_reason")} value={reason} onChange={(e) => { setReason(e.target.value); setPage(1); }} options={[{ value: "", label: t("dv2.any_reason") }, ...(data?.reasons ?? []).map((r: any) => ({ value: r.reason, label: `${reasonLabel(r.reason)} (${r.count})` }))]} /></div>
          <div className="w-40"><Select aria-label={t("reg.city")} value={city} onChange={(e) => { setCity(e.target.value); setPage(1); }} options={[{ value: "", label: t("dv2.any_city") }, ...(data?.cities ?? []).map((c: any) => ({ value: c.city, label: `${tx(`city.${c.city}`, c.city)} (${c.count})` }))]} /></div>
          <PeriodBar value={period} onChange={(p) => { setPeriod(p); setPage(1); }} />
        </>}
        empty={!loading && rows.length === 0 ? <ListEmpty filtered={filtered} onClear={() => { setQ(""); setGroup("all"); setReason(""); setCity(""); setPeriod("all"); setPage(1); }} title={t("dv2.parcels_none")} hint={t("dv2.parcels_none_hint")} /> : undefined}
        footer={data ? pagerFooter(page, data.total, SIZE, setPage) : undefined}>
        {loading ? <LoadingRows cols={head.length} rows={4} /> : rows.map((p) => {
          const outcome = p.deliveredAt ?? p.failedAt ?? p.returnedAt;
          return (
            <tr key={p.id} data-testid={`dv2-parcel-${p.id}`}>
              <Td>{canRequest ? <Link href={`/admin/parcels/${p.id}`} className="ltr-num font-semibold text-accent hover:underline">{p.code}</Link> : <span className="ltr-num font-semibold">{p.code}</span>}<span className="block text-xs text-muted">{p.business ?? "—"}</span></Td>
              <Td label={t("req.ref")}>{canRequest ? <Link href={`/admin/requests/${p.requestId}`} className="ltr-num text-accent hover:underline">{p.ref}</Link> : <span className="ltr-num">{p.ref}</span>}</Td>
              <Td label={t("dv2.col_recipient")}>{p.recipient}<span className="block text-xs text-muted">{tx(`city.${p.city}`, p.city)}</span></Td>
              <Td label={t("common.status")}><span className="inline-flex flex-wrap items-center gap-1.5"><StatusBadge status={p.status} ns="shipstatus" />{p.attempts > 1 && <Badge tone="warn">{t("dv2.attempts_n", { n: p.attempts })}</Badge>}{p.deferrals > 0 && <Badge>{t("dv2.deferred_n", { n: p.deferrals })}</Badge>}</span></Td>
              <Td label={t("dv2.col_reason")} className="max-w-56">{p.failReason ? <><span className="font-medium">{reasonLabel(p.failReason)}</span>{p.failNote && <span className="block truncate text-xs text-muted" title={p.failNote}>{p.failNote}</span>}</> : <span className="text-muted">—</span>}</Td>
              <Td label={t("dv2.col_arrived")} className="whitespace-nowrap text-muted">{p.arrivedAt ? fmtDateTime(p.arrivedAt, locale) : "—"}</Td>
              <Td label={t("dv2.col_outcome")} className="whitespace-nowrap text-muted">{outcome ? fmtDateTime(outcome, locale) : "—"}{p.distanceM != null && <span className="block text-xs">{t("dv2.distance_m", { n: p.distanceM })}</span>}</Td>
              <Td label={t("dv2.col_cod")} align="end">{p.codCents > 0 ? <span className={p.codCollectedCents == null ? "text-gold" : ""}><Money cents={p.codCollectedCents ?? p.codCents} /></span> : <span className="text-muted">—</span>}</Td>
            </tr>
          );
        })}
      </Table>
    </Section></div>
  );
}
