"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, AlertTriangle, Download, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Checkbox, EmptyState, ErrorState, PageLoading, Pagination, SearchBox, Section, Segmented, Select, Table, Td, Toolbar, errText } from "@/components/ui";
import { useApi, useUrlPatch } from "@/components/ui/data";
import { get } from "@/lib/api";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { fmtDur } from "@/components/reports/chartTheme";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { LinkButton, downloadCsv, useCityNames, useDebounced, useUrlPage } from "./admin-common";
import { PIN_FLAG_M, ReceiptDialog, ShipStatusBadge } from "./admin-shipments";
import { useOrder } from "./admin-order-ctx";
import { parcelFiltersActive, parcelQuery, type ParcelFilters } from "./admin-order-lib";

const SIZE = 50;
const STATUSES = ["pending", "loaded", "delivered", "failed", "returned", "missing", "cancelled"];

function Row({ s, name, onReceipt }: { s: any; name: (c: string) => string; onReceipt: () => void }) {
  const { t, locale } = useI18n();
  const far = typeof s.deliveredDistanceM === "number" && s.deliveredDistanceM > PIN_FLAG_M;
  const end = s.deliveredAt ?? s.failedAt;
  return (
    <tr className="align-top" data-testid="admin-parcel-row" data-code={s.code}>
      <Td label={t("shipadm.col_parcel")}>
        <p className="ltr-num"><span className="text-xs text-muted">#{s.seq} </span><Link href={`/admin/parcels/${s.id}`} className="font-semibold text-accent hover:underline" data-testid="dv1-parcel-link">{s.code}</Link></p>
        {s.externalRef && <p className="ltr-num text-xs text-muted">{s.externalRef}</p>}
        {s.partnerStatus && <p className="mt-1 text-xs text-muted">{t("uxa.partner_status", { status: s.partnerStatus })}</p>}
      </Td>
      <Td label={t("shipadm.col_recipient")}>
        <p className="font-medium">{s.recipientName || "—"}</p><p className="ltr-num text-xs text-muted">{s.recipientPhone ?? "—"}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1"><Badge tone={s.recipientType === "business" ? "info" : "neutral"}>{t(`rtype.${s.recipientType}`)}</Badge>{!s.detailsComplete && <Badge tone="warn" className="whitespace-nowrap"><AlertCircle className="size-3" aria-hidden />{t("pb.details_missing")}</Badge>}</div>
      </Td>
      <Td label={t("shipadm.col_address")} className="max-w-56 text-muted">{s.address || "—"} · {name(s.city)}{!s.located && <p className="mt-1 text-xs text-gold">{t("dv1.no_pin")}</p>}</Td>
      <Td label={t("common.status")}>
        <ShipStatusBadge status={s.status} />
        {s.failReason && <p className="mt-1 text-xs text-danger">{t(`stopfail.${s.failReason}`) === `stopfail.${s.failReason}` ? s.failReason : t(`stopfail.${s.failReason}`)}</p>}
        {s.failNote && <p className="text-xs text-muted">“{s.failNote}”</p>}
      </Td>
      <Td label={t("shipadm.col_driver")}>
        <p>{s.driverName ?? "—"}</p>
        <p className="text-xs text-muted">{t("shipadm.attempts", { n: s.attempts })}{s.deferCount > 0 && ` · ${t("dv1.col_defers", { n: s.deferCount })}`}{s.stopOrder != null && ` · ${t("dv1.col_stop", { n: s.stopOrder })}`}</p>
      </Td>
      <Td label={t("shipadm.col_delivery")} className="text-xs">
        {s.status === "delivered" && s.proofType && <p>{t(s.proofType === "receipt" ? "shipadm.proof_receipt" : s.proofType === "scan" ? "fob.proof_scan" : "shipadm.proof_otp")}</p>}
        {s.receiverName && <p className="text-muted">{t("shipadm.received_by", { name: s.receiverName })}</p>}
        {typeof s.deliveredDistanceM === "number" && (far ? <Badge tone="warn" className="mt-1"><AlertTriangle className="size-3" aria-hidden />{t("shipadm.pin_far", { n: Math.round(s.deliveredDistanceM) })}</Badge> : <p className="text-muted">{t("shipadm.pin_distance", { n: Math.round(s.deliveredDistanceM) })}</p>)}
        {!s.proofType && s.status !== "delivered" && <p className="text-muted">—</p>}
      </Td>
      <Td label={t("fob.f_cod_short")} className="text-xs" align="end">
        {s.codCents > 0 ? <p className="ltr-num text-gold" data-testid="admin-parcel-cod">{t("dv1.col_cod_due", { amount: fmtMoney(s.codCents, locale) })}{s.codCollectedCents != null && <span className="block text-muted">{t("dv1.col_cod_collected", { amount: fmtMoney(s.codCollectedCents, locale) })}</span>}</p> : <span className="text-muted">—</span>}
      </Td>
      <Td label={t("dv1.col_times")} className="whitespace-nowrap text-xs text-muted">
        {([["dv1.col_loaded", s.loadedAt], ["dv1.col_arrived", s.arrivedAt], [s.status === "delivered" ? "dv1.col_delivered" : "dv1.col_failed", end]] as const).map(([k, v]) => <p key={k}>{t(k)}: <span className="text-ink">{v ? fmtDateTime(v, locale) : "—"}</span></p>)}
        {s.dwellS != null && <p>{t("dv1.col_dwell", { time: fmtDur(s.dwellS, locale) })}</p>}
      </Td>
      <Td align="end">
        <div className="flex flex-wrap justify-end gap-1">
          {s.hasProof && s.proofType === "receipt" && <Button size="sm" variant="secondary" onClick={onReceipt}><ImageIcon className="size-4" aria-hidden />{t("shipadm.receipt")}</Button>}
          <LinkButton size="sm" variant="ghost" href={`/admin/parcels/${s.id}`} aria-label={`${t("common.open")} ${s.code}`}>{t("common.open")}</LinkButton>
        </div>
      </Td>
    </tr>
  );
}

/** The order's manifest: every parcel with its status, recipient, driver, attempts, proof, cash and timestamps; filtered and paged by the server; CSV of the filtered list. */
export function OrderParcels() {
  const { t, locale } = useI18n(); const me = useUser(); const sp = useSearchParams(); const patch = useUrlPatch(); const { cities: cityOpts, name: cityName } = useCityNames();
  const { id } = useOrder();
  const [page, setPage] = useUrlPage();
  const [q, setQ] = useState(sp.get("q") ?? sp.get("parcel") ?? ""); const dq = useDebounced(q.trim());
  const [exporting, setExporting] = useState(false); const [receipt, setReceipt] = useState<any>(null);
  const f: ParcelFilters = { status: sp.get("status") ?? "", offerId: sp.get("offerId") ?? "", city: sp.get("city") ?? "", q: dq, cod: sp.get("cod") === "1", incomplete: sp.get("incomplete") === "1", page };
  const path = `/admin/requests/${id}/parcels`;
  const { data, error, mutate } = useApi(`${path}${parcelQuery({ ...f, page }, { pageSize: SIZE })}`, { keepPreviousData: true, refreshInterval: 30000 });
  const counts: Record<string, number> = data?.counts ?? {}, all = Object.values(counts).reduce((a, n) => a + n, 0), filtered = parcelFiltersActive(f);
  const set = (k: string, v: string) => patch({ [k]: v });
  const clear = () => { setQ(""); patch({ status: "", offerId: "", city: "", cod: "", incomplete: "" }); };
  const canExport = hasPerm(me, "reports.export");
  /** With `reports.export` the server builds the full CSV; without it the page's own columns are exported from the filtered list (what the old manifest allowed). */
  const exportRows = async () => {
    setExporting(true);
    try {
      const rows: any[] = [];
      for (let p = 1; p <= 20; p++) { const r = await get(`${path}${parcelQuery({ ...f, page: p }, { pageSize: 100 })}`); rows.push(...r.items); if (rows.length >= r.total || !r.items.length) break; }
      downloadCsv(`parcels-${id.slice(0, 8)}.csv`, [t("shipadm.col_parcel"), t("uxa.col_order_ref"), t("shipadm.col_recipient"), t("auth.phone"), t("shipadm.col_address"), t("common.status"), t("uxa.col_fail_reason"), t("shipadm.col_driver"), t("shipadm.col_delivery")],
        rows.map((s) => [s.code, s.externalRef, s.recipientName, s.recipientPhone, s.address, t(`shipstatus.${s.status}`), s.failReason ? t(`stopfail.${s.failReason}`) : "", s.driverName, s.deliveredAt ?? s.failedAt ?? s.returnedAt ?? ""]));
    } catch (e) { toast.error(errText(e, t)); } finally { setExporting(false); }
  };
  const exportBtn = !data || data.total === 0 ? undefined : canExport
    ? <LinkButton size="sm" download href={`/api/v1${path}${parcelQuery(f, { format: "csv" })}`} data-testid="admin-parcels-export"><Download className="size-4" aria-hidden />{t("uxa.export_parcels")}</LinkButton>
    : <Button variant="secondary" size="sm" loading={exporting} onClick={exportRows} data-testid="admin-parcels-export"><Download className="size-4" aria-hidden />{t("uxa.export_parcels")}</Button>;
  const driverOpts = data ? [{ value: "none", label: t("dv1.f_unassigned", { n: data.drivers.find((d: any) => !d.offerId)?.n ?? 0 }) }, ...data.drivers.filter((d: any) => d.offerId).map((d: any) => ({ value: d.offerId, label: `${d.name ?? "—"} (${fmtNum(d.n, locale)})` }))] : [];
  return (
    <Section id="request-parcels" title={t("shipadm.panel_title")} description={t("shipadm.panel_sub")} flush className="mb-6" actions={exportBtn}>
      <div className="space-y-3 border-b border-line px-4 py-3 sm:px-5">
        <Toolbar className="mb-0">
          <Segmented label={t("common.status")} value={f.status} onChange={(k) => set("status", k)} options={[{ key: "", label: t("common.all"), count: all }, ...STATUSES.filter((s) => (counts[s] ?? 0) > 0 || f.status === s).map((s) => ({ key: s, label: t(`shipstatus.${s}`), count: counts[s] ?? 0 }))]} />
        </Toolbar>
        <Toolbar className="mb-0" end={filtered ? <Button variant="ghost" size="sm" onClick={clear} data-testid="dv1-parcels-clear">{t("uxa.clear_filters")}</Button> : undefined}>
          <SearchBox className="w-full sm:w-80" value={q} onChange={(v) => { setQ(v); if (page > 1) setPage(1); }} label={t("common.search")} placeholder={t("dv1.parcels_search_ph")} />
          <div className="w-48"><Select aria-label={t("dv1.filter_driver")} placeholder={t("dv1.filter_driver_all")} options={driverOpts} value={f.offerId} onChange={(e) => set("offerId", e.target.value)} /></div>
          <div className="w-40"><Select aria-label={t("wizard.pickup_city")} placeholder={t("rda.all_cities")} options={(data?.cities ?? []).map((c: any) => ({ value: c.city, label: `${cityOpts.find((o) => o.value === c.city)?.label ?? c.city} (${fmtNum(c.n, locale)})` }))} value={f.city} onChange={(e) => set("city", e.target.value)} /></div>
          <Checkbox checked={f.cod} onChange={(e) => set("cod", e.target.checked ? "1" : "")} label={t("dv1.filter_cod", { n: data?.withCod ?? 0 })} />
          <Checkbox checked={f.incomplete} onChange={(e) => set("incomplete", e.target.checked ? "1" : "")} label={t("dv1.filter_incomplete", { n: data?.incomplete ?? 0 })} />
        </Toolbar>
      </div>
      {error && !data ? <div className="p-5"><ErrorState error={error} retry={() => mutate()} /></div> : !data ? <div className="p-5"><PageLoading /></div> : data.items.length === 0 ? (
        <div className="p-5"><EmptyState title={t("shipadm.empty")} hint={filtered ? t("uxa.parcels_filtered_hint") : undefined} action={filtered ? <Button variant="secondary" onClick={clear}>{t("uxa.clear_filters")}</Button> : undefined} /></div>
      ) : (
        <>
          <Table bare stack label={t("shipadm.panel_title")} head={[t("shipadm.col_parcel"), t("shipadm.col_recipient"), t("shipadm.col_address"), t("common.status"), t("shipadm.col_driver"), t("shipadm.col_delivery"), { label: t("fob.f_cod_short"), align: "end" }, t("dv1.col_times"), { label: t("common.open"), srOnly: true }]}>
            {data.items.map((s: any) => <Row key={s.id} s={s} name={cityName} onReceipt={() => setReceipt(s)} />)}
          </Table>
          <div className="border-t border-line px-4 pb-4 sm:px-5">
            <Pagination page={page} total={data.total} pageSize={SIZE} onPage={setPage} />
            <p className="mt-2 text-xs text-muted" data-testid="admin-parcels-total">{t("uxa.total_n", { n: data.total })} · {t("shipadm.pin_hint", { n: PIN_FLAG_M })}</p>
          </div>
        </>
      )}
      <ReceiptDialog shipment={receipt} onClose={() => setReceipt(null)} />
    </Section>
  );
}
