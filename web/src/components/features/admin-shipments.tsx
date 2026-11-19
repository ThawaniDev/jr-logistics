"use client";
import { useState } from "react";
import { AlertCircle, AlertTriangle, Clock, Download, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, EmptyState, ErrorState, Modal, Notice, PageLoading, Pagination, SearchBox, Section, Segmented, Table, Td, errText } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { get } from "@/lib/api";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { Timeline } from "@/components/features/timeline";
import { downloadCsv, qs, useDebounced } from "./admin-common";

const SIZE = 50;
/** Pin distance above which the delivery is flagged for audit (metres). It never blocks anything. */
export const PIN_FLAG_M = 500;
const STATUSES = ["pending", "loaded", "delivered", "failed", "returned", "missing", "cancelled"];
const STATUS_TONE: Record<string, "neutral" | "info" | "warn" | "success" | "danger"> = { pending: "neutral", loaded: "info", delivered: "success", failed: "danger", returned: "warn", missing: "danger", cancelled: "neutral" };

export function ShipStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{t(`shipstatus.${status}`)}</Badge>;
}

/** Per-offer parcel counters, one compact line. */
export function ParcelStats({ parcels }: { parcels: { total: number; pending: number; loaded: number; delivered: number; failed: number; returned: number; missing: number } | null | undefined }) {
  const { t } = useI18n();
  if (!parcels) return null;
  return <p className="text-xs text-muted">{t("shipadm.parcel_stats", { total: parcels.total, delivered: parcels.delivered, loaded: parcels.loaded, failed: parcels.failed, returned: parcels.returned, missing: parcels.missing })}</p>;
}

/** Receipt photo of a business recipient (GET /shipments/:id/proof). Rendered only while open so nothing is fetched otherwise. */
function ReceiptDialog({ shipment, onClose }: { shipment: any | null; onClose: () => void }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState<string | null>(null);
  const bad = !!shipment && failed === shipment.id;
  return (
    <Modal open={!!shipment} onClose={onClose} title={t("shipadm.receipt_title", { code: shipment?.code ?? "" })} footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}>
      {shipment && (bad ? <Notice tone="danger">{t("shipadm.receipt_error")}</Notice> : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin image, not optimisable */}
          <img src={`/api/v1/shipments/${shipment.id}/proof`} alt={t("shipadm.receipt_alt", { code: shipment.code })} className="mx-auto max-h-[70vh] w-auto rounded-xl border border-line" onError={() => setFailed(shipment.id)} />
          {shipment.receiverName && <p className="text-sm text-muted">{t("shipadm.received_by", { name: shipment.receiverName })}</p>}
        </>
      ))}
    </Modal>
  );
}

/** Per-parcel timeline (GET /shipments/:id). */
function ParcelTimelineDialog({ shipment, onClose }: { shipment: any | null; onClose: () => void }) {
  const { t } = useI18n();
  const { data, error, mutate } = useApi(shipment ? `/shipments/${shipment.id}` : null, { shouldRetryOnError: false });
  return (
    <Modal open={!!shipment} onClose={onClose} title={t("shipadm.timeline_title", { code: shipment?.code ?? "" })} footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}>
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : <Timeline bare events={data.events} />}
    </Modal>
  );
}

function Row({ s, onReceipt, onTimeline }: { s: any; onReceipt: () => void; onTimeline: () => void }) {
  const { t, locale } = useI18n();
  const far = typeof s.deliveredDistanceM === "number" && s.deliveredDistanceM > PIN_FLAG_M;
  const when = s.deliveredAt ?? s.failedAt ?? s.returnedAt;
  return (
    <tr className="align-top" data-testid="admin-parcel-row">
      <Td label={t("shipadm.col_parcel")}><p className="ltr-num font-semibold">{s.seq}</p><p className="ltr-num text-xs text-muted">{s.code}</p>{s.externalRef && <p className="ltr-num text-xs text-muted">{s.externalRef}</p>}{s.partnerStatus && <p className="mt-1 text-xs text-muted" title={s.partnerStatusAt ? fmtDateTime(s.partnerStatusAt, locale) : undefined}>{t("uxa.partner_status", { status: s.partnerStatus })}</p>}</Td>
      <Td label={t("shipadm.col_recipient")}><p className="font-medium">{s.recipientName || "—"}</p><p className="text-xs text-muted">{s.recipientPhone ? <a href={`tel:${s.recipientPhone}`} className="ltr-num hover:text-ink hover:underline">{s.recipientPhone}</a> : "—"}</p><div className="mt-1 flex flex-wrap items-center gap-1"><Badge tone={s.recipientType === "business" ? "info" : "neutral"}>{t(`rtype.${s.recipientType}`)}</Badge>{s.detailsComplete === false && <Badge tone="warn" className="whitespace-nowrap"><AlertCircle className="size-3" aria-hidden />{t("pb.details_missing")}</Badge>}</div></Td>
      <Td label={t("shipadm.col_address")} className="max-w-56 text-muted">{s.address || "—"}{s.city ? ` · ${t(`city.${s.city}`)}` : ""}</Td>
      <Td label={t("common.status")}>
        <ShipStatusBadge status={s.status} />
        {s.failReason && <p className="mt-1 text-xs text-danger">{t(`stopfail.${s.failReason}`)}</p>}
        {s.failNote && <p className="text-xs text-muted">“{s.failNote}”</p>}
      </Td>
      <Td label={t("shipadm.col_driver")}><p>{s.driverName ?? "—"}</p><p className="text-xs text-muted">{t("shipadm.attempts", { n: s.attempts ?? 0 })}</p></Td>
      <Td label={t("shipadm.col_delivery")} className="text-xs">
        {when ? <p className="text-muted">{fmtDateTime(when, locale)}</p> : <p className="text-muted">—</p>}
        {s.status === "delivered" && s.proofType && <p>{t(s.proofType === "receipt" ? "shipadm.proof_receipt" : s.proofType === "scan" ? "fob.proof_scan" : "shipadm.proof_otp")}</p>}
        {(s.codCents ?? 0) > 0 && <p className="ltr-num text-gold" data-testid="admin-parcel-cod">{t("fob.f_cod_short")}: {fmtMoney(s.codCollectedCents ?? s.codCents, locale)}</p>}
        {s.receiverName && <p className="text-muted">{t("shipadm.received_by", { name: s.receiverName })}</p>}
        {typeof s.deliveredDistanceM === "number" && (far
          ? <Badge tone="warn" className="mt-1"><AlertTriangle className="size-3" aria-hidden />{t("shipadm.pin_far", { n: Math.round(s.deliveredDistanceM) })}</Badge>
          : <p className="text-muted">{t("shipadm.pin_distance", { n: Math.round(s.deliveredDistanceM) })}</p>)}
      </Td>
      <Td align="end">
        <div className="flex flex-wrap justify-end gap-1">
          {s.hasProof && s.proofType === "receipt" && <Button size="sm" variant="secondary" onClick={onReceipt}><ImageIcon className="size-4" aria-hidden />{t("shipadm.receipt")}</Button>}
          <Button size="sm" variant="ghost" onClick={onTimeline}><Clock className="size-4" aria-hidden />{t("shipadm.timeline")}</Button>
        </div>
      </Td>
    </tr>
  );
}

/** Read-only manifest of a delivery request for staff: counts per status, search, pagination, receipt photos and per-parcel timelines. */
export function ShipmentsPanel({ requestId, initialQuery = "" }: { requestId: string; initialQuery?: string }) {
  const { t } = useI18n();
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState(""); const [page, setPage] = useState(1); const [q, setQ] = useState(initialQuery); const dq = useDebounced(q.trim());
  const [receipt, setReceipt] = useState<any>(null); const [tl, setTl] = useState<any>(null);
  const { data, error, mutate } = useApi(`/requests/${requestId}/shipments${qs({ status, q: dq, page, pageSize: SIZE })}`, { keepPreviousData: true, refreshInterval: 30000 });
  /** Every parcel matching the current filter (not just this page), 200 per call, as a spreadsheet for the warehouse / the customer call. */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows: any[] = [];
      for (let p = 1; p <= 10; p++) {
        const r = await get(`/requests/${requestId}/shipments${qs({ status, q: dq, page: p, pageSize: 200 })}`);
        rows.push(...r.items);
        if (rows.length >= r.total || r.items.length === 0) break;
      }
      downloadCsv(`parcels-${requestId.slice(0, 8)}.csv`,
        [t("shipadm.col_parcel"), t("uxa.col_order_ref"), t("shipadm.col_recipient"), t("auth.phone"), t("shipadm.col_address"), t("common.status"), t("uxa.col_fail_reason"), t("shipadm.col_driver"), t("shipadm.col_delivery")],
        rows.map((s) => [s.code, s.externalRef, s.recipientName, s.recipientPhone, s.address, t(`shipstatus.${s.status}`), s.failReason ? t(`stopfail.${s.failReason}`) : "", s.driverName, s.deliveredAt ?? s.failedAt ?? s.returnedAt ?? ""]));
    } catch (e) { toast.error(errText(e, t)); } finally { setExporting(false); }
  };
  const counts: Record<string, number> = data?.counts ?? {};
  const all = Object.values(counts).reduce((a, n) => a + n, 0);
  const filtered = !!(dq || status);
  const clear = () => { setQ(""); setStatus(""); setPage(1); };
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3">
      <Segmented label={t("common.status")} value={status} onChange={(k) => { setStatus(k); setPage(1); }}
        options={[{ key: "", label: t("common.all"), count: all }, ...STATUSES.filter((s) => (counts[s] ?? 0) > 0 || status === s).map((s) => ({ key: s, label: t(`shipstatus.${s}`), count: counts[s] ?? 0 }))]} />
      <SearchBox className="sm:ms-auto" value={q} onChange={(v) => { setQ(v); setPage(1); }} label={t("common.search")} placeholder={t("shipadm.search_ph")} />
    </div>
  );
  return (
    <Section id="request-parcels" title={t("shipadm.panel_title")} description={t("shipadm.panel_sub")} flush className="mb-6"
      actions={data && data.total > 0 ? <Button variant="secondary" size="sm" loading={exporting} onClick={exportCsv} data-testid="admin-parcels-export"><Download className="size-4" aria-hidden />{t("uxa.export_parcels")}</Button> : undefined}>
      {toolbar}
      {error ? <div className="p-5"><ErrorState error={error} retry={() => mutate()} /></div> : !data ? <div className="p-5"><PageLoading /></div> : data.items.length === 0 ? (
        <div className="p-5"><EmptyState title={t("shipadm.empty")} hint={filtered ? t("uxa.parcels_filtered_hint") : undefined} action={filtered ? <Button variant="secondary" onClick={clear}>{t("uxa.clear_filters")}</Button> : undefined} /></div>
      ) : (
        <>
          <Table bare stack label={t("shipadm.panel_title")} head={[t("shipadm.col_parcel"), t("shipadm.col_recipient"), t("shipadm.col_address"), t("common.status"), t("shipadm.col_driver"), t("shipadm.col_delivery"), { label: t("common.open"), srOnly: true }]}>
            {data.items.map((s: any) => <Row key={s.id} s={s} onReceipt={() => setReceipt(s)} onTimeline={() => setTl(s)} />)}
          </Table>
          <div className="border-t border-line px-5 pb-4">
            <Pagination page={page} total={data.total} pageSize={SIZE} onPage={setPage} />
            <p className="mt-2 text-xs text-muted">{t("shipadm.pin_hint", { n: PIN_FLAG_M })}</p>
          </div>
        </>
      )}
      <ReceiptDialog shipment={receipt} onClose={() => setReceipt(null)} />
      <ParcelTimelineDialog shipment={tl} onClose={() => setTl(null)} />
    </Section>
  );
}
