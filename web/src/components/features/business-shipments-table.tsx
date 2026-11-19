"use client";
import { useEffect, useState } from "react";
import { AlertCircle, Ban, Camera, Copy, Eye, FileImage, KeyRound, Pencil, PenLine, Printer, ScanLine } from "lucide-react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Badge, Button, Checkbox, EmptyState, ErrorState, Input, KV, Modal, Notice, PageLoading, Pagination, SearchBox, Segmented, Table, Td, Textarea, errText, fieldErrors, useAction, type Tone } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { patch, post } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { PartnerStatusBadge, labelable, printLabels, providerName, usePartnerConnections, type Connection } from "./business-shipments-partner";
import { partnerStatusText } from "./timeline";
import { FIELD_ERR_KEY, SHIPMENT_STATUS_ORDER, codCentsOf, detailsMissing, fromServer, validateRow, type ManifestRow, type RType, type ShipmentItem, type ShipmentPage } from "./business-shipments-lib";
import { DETAILS_EDITABLE } from "./business-shipments-complete";
import { MediaLightbox, MediaThumb, ShipmentPhotos, type LightboxTarget } from "./business-shipments-media";

const PAGE_SIZE = 50;
const ACTIVE_REQUEST = ["published", "filling", "assigned", "confirmed", "in_progress"];
const TONE: Record<string, Tone> = { pending: "warn", loaded: "info", delivered: "success", failed: "danger", returned: "neutral", missing: "danger", cancelled: "neutral" };

export const ShipBadge = ({ status }: { status: string }) => { const { t } = useI18n(); return <Badge tone={TONE[status] ?? "neutral"}>{t(`shipstatus.${status}`)}</Badge>; };
/** Recipient name / phone / address still to come (the parcel was booked "details later"). */
export const DetailsMissingBadge = ({ className }: { className?: string }) => { const { t } = useI18n(); return <Badge tone="warn" className={className}><AlertCircle className="size-3" aria-hidden />{t("pb.details_missing")}</Badge>; };

/** Cash on delivery of a parcel: what is due, and what the driver actually collected once it is delivered (E17). */
export function CodCell({ s }: { s: Pick<ShipmentItem, "status" | "codCents" | "codCollectedCents"> }) {
  const { t, locale } = useI18n();
  const due = s.codCents ?? 0;
  if (!(due > 0) && s.codCollectedCents == null) return <span className="text-muted">—</span>;
  if (s.status === "delivered" && s.codCollectedCents != null) return <span className="ltr-num font-medium text-accent" data-testid="parcel-cod-collected">{t("fob.cod_collected_amount", { amount: fmtMoney(s.codCollectedCents, locale) })}</span>;
  const lost = ["failed", "returned", "missing", "cancelled"].includes(s.status);
  return <span data-testid="parcel-cod"><span className={cn("ltr-num font-medium", lost && "text-muted line-through")}>{fmtMoney(due, locale)}</span>{lost && <span className="block text-muted">{t("fob.cod_not_collected")}</span>}</span>;
}

/** Stop-fail reasons are i18n codes; unknown ones are shown as they are. */
export function useReason() {
  const { t } = useI18n();
  return (r: string | null | undefined) => { if (!r) return ""; const k = t(`stopfail.${r}`); return k.startsWith("stopfail.") ? r : k; };
}
const canChange = (s: ShipmentItem, requestStatus: string) => s.status === "pending" && ACTIVE_REQUEST.includes(requestStatus);
/** Fixing or completing a parcel is also allowed while the request is still a draft; withdrawing (cancel) is not. */
const canEdit = (s: ShipmentItem, requestStatus: string) => s.status === "pending" && DETAILS_EDITABLE.includes(requestStatus);

/** Re-fetch everything that shows parcels of this request. */
export function useRefreshShipments(requestId: string) {
  const { mutate } = useSWRConfig();
  return () => mutate((k) => typeof k === "string" && (k.startsWith(`/requests/${requestId}/shipments`) || k.startsWith("/shipments/") || k === `/requests/${requestId}` || k === `shipments-all:${requestId}`));
}

function CopyBtn({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  return <button type="button" aria-label={label} title={label} className="rounded-md p-1 text-muted hover:text-ink" onClick={() => navigator.clipboard.writeText(value).then(() => toast.success(t("common.copied")))}><Copy className="size-3.5" /></button>;
}

// ───────── Section on the request page ─────────
export function ShipmentsSection({ requestId, requestStatus, onChanged, incomplete = 0, onCompleteDetails }: { requestId: string; requestStatus: string; onChanged: () => void; incomplete?: number; onCompleteDetails?: () => void }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useUrlState("status"); const [qIn, setQIn] = useState(""); const [q, setQ] = useState(""); const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null); const [proof, setProof] = useState<ShipmentItem | null>(null);
  const [edit, setEdit] = useState<ShipmentItem | null>(null); const [cancel, setCancel] = useState<ShipmentItem | null>(null);
  const reason = useReason();
  const { items: conns } = usePartnerConnections();
  const connOf = (id: string | null | undefined) => (id ? conns.find((c) => c.id === id) : undefined);
  const partnerName = (c: Connection | undefined) => (c ? providerName(t, c.provider, c.providerLabel) : undefined);
  const [picked, setPicked] = useState<Set<string>>(new Set()); const [printing, setPrinting] = useState(false);
  useEffect(() => { const id = setTimeout(() => { setQ(qIn.trim()); setPage(1); }, 350); return () => clearTimeout(id); }, [qIn]);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (status) qs.set("status", status);
  if (q) qs.set("q", q);
  const { data, error, mutate } = useApi<ShipmentPage>(`/requests/${requestId}/shipments?${qs}`, { refreshInterval: 15000, keepPreviousData: true });
  const refresh = useRefreshShipments(requestId);
  const changed = () => { void refresh(); onChanged(); };
  const counts = data?.counts ?? {}; const all = Object.values(counts).reduce((a, b) => a + b, 0);
  // Label printing: only parcels that came from a connection that can print, and that carry the partner's barcode.
  const printable = (s: ShipmentItem) => !!s.externalRef && labelable(connOf(s.partnerId));
  const printableOnPage = (data?.items ?? []).filter(printable);
  const pickedItems = printableOnPage.filter((s) => picked.has(s.id));
  const toggle = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const print = async (list: ShipmentItem[]) => {
    const by = new Map<string, string[]>();
    for (const s of list) if (s.partnerId && s.externalRef) by.set(s.partnerId, [...(by.get(s.partnerId) ?? []), s.externalRef]);
    setPrinting(true);
    try { await printLabels([...by].map(([connectionId, identifiers]) => ({ connectionId, identifiers })), t); }
    catch (e) { toast.error(errText(e, t)); }
    finally { setPrinting(false); }
  };
  const options = [{ key: "", label: t("common.all"), count: all }, ...SHIPMENT_STATUS_ORDER.filter((k) => (counts[k] ?? 0) > 0 || k === status).map((k) => ({ key: k, label: t(`shipstatus.${k}`), count: counts[k] ?? 0 }))];
  const toolbar = (
    <>
      <SearchBox value={qIn} onChange={setQIn} placeholder={t("bs.search")} label={t("bs.search")} />
      <Segmented label={t("bs.filter_status")} options={options} value={status} onChange={(k) => { setStatus(k); setPage(1); }} />
      {incomplete > 0 && onCompleteDetails && <Button size="sm" variant="secondary" className="ms-auto" data-testid="shipments-complete-details" onClick={onCompleteDetails}><AlertCircle className="size-4" aria-hidden />{t("pb.complete_details")} <span className="tabular-nums">({fmtNum(incomplete, locale)})</span></Button>}
    </>
  );

  return (
    <section aria-label={t("bs.shipments")} className="space-y-4" data-testid="parcels-section">
      {printableOnPage.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg2/50 px-3 py-2" data-testid="label-bar">
          <Checkbox checked={pickedItems.length === printableOnPage.length} onChange={(e) => setPicked(e.target.checked ? new Set(printableOnPage.map((s) => s.id)) : new Set())} label={t("intg.select_labelable", { n: fmtNum(printableOnPage.length, locale) })} />
          <Button size="sm" variant="secondary" className="ms-auto" disabled={pickedItems.length === 0} loading={printing} onClick={() => print(pickedItems)}><Printer className="size-4" />{t("intg.print_labels", { n: fmtNum(pickedItems.length, locale) })}</Button>
        </div>
      )}
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : (
        <>
          <Table stack toolbar={toolbar} label={t("bs.shipments")} head={["#", t("bs.f_code"), t("bs.recipient"), t("bs.f_address"), t("common.status"), t("bs.when"), t("bs.proof"), t("fob.f_cod_short"), t("bs.issue"), { label: t("common.open"), srOnly: true }]}
            empty={data.items.length === 0 ? <div className="p-5"><EmptyState title={q || status ? t("common.no_results") : t("bs.no_shipments")} hint={q || status ? t("ubz.no_results_hint") : undefined} action={q || status ? <Button variant="secondary" onClick={() => { setQIn(""); setStatus(""); setPage(1); }}>{t("bz.clear_filters")}</Button> : undefined} /></div> : undefined}>
            {data.items.map((s) => (
              <tr key={s.id} data-testid="shipment-row" data-code={s.code} data-incomplete={detailsMissing(s) ? "1" : undefined} className="align-top">
                <Td label="#" className="tabular-nums text-muted"><span className="inline-flex items-center gap-2">{printable(s) && <input type="checkbox" className="size-4 accent-[var(--jr-accent)]" aria-label={t("intg.pick_label", { code: s.code })} checked={picked.has(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} />}{fmtNum(s.seq, locale)}</span></Td>
                <Td label={t("bs.f_code")}><span className="inline-flex items-center gap-1"><span className="ltr-num font-medium" dir="ltr">{s.code}</span><CopyBtn value={s.code} label={t("bs.copy_code")} /></span>{s.externalRef && <span className="ltr-num block text-xs text-muted" dir="ltr">{s.externalRef}</span>}</Td>
                <Td label={t("bs.recipient")}><p className="font-medium">{s.recipientName || "—"}</p><p className="ltr-num text-xs text-muted" dir="ltr">{s.recipientPhone || "—"}</p><div className="mt-1 flex flex-wrap items-center gap-1"><Badge>{t(`rtype.${s.recipientType}`)}</Badge>{detailsMissing(s) && <span data-testid="details-missing-badge"><DetailsMissingBadge /></span>}</div></Td>
                <Td label={t("bs.f_address")} className="max-w-[240px] text-muted">{s.address || "—"}</Td>
                <Td label={t("common.status")}><ShipBadge status={s.status} />{s.driverName && <p className="mt-1 text-xs text-muted">{s.driverName}</p>}<PartnerStatusBadge status={s.partnerStatus} at={s.partnerStatusAt} provider={partnerName(connOf(s.partnerId))} /></Td>
                <Td label={t("bs.when")} className="whitespace-nowrap text-xs text-muted">{s.deliveredAt ? fmtDateTime(s.deliveredAt, locale) : s.failedAt ? fmtDateTime(s.failedAt, locale) : "—"}</Td>
                <Td label={t("bs.proof")} className="text-xs">
                  {s.proofType === "otp" ? <span className="inline-flex items-center gap-1 text-accent"><KeyRound className="size-3.5" aria-hidden />{t("bs.proof_otp")}</span>
                    : s.proofType === "scan" ? <span className="inline-flex items-center gap-1 text-accent" data-testid="proof-scan"><ScanLine className="size-3.5" aria-hidden />{t("fob.proof_scan")}</span>
                    : s.proofType === "receipt" ? <div className="space-y-1"><button type="button" className="inline-flex items-center gap-1 text-cyan hover:underline" onClick={() => setProof(s)}><FileImage className="size-3.5" aria-hidden />{t("bs.proof_receipt")}</button>{s.receiverName && <p className="text-muted">{s.receiverName}</p>}</div> : <span className="text-muted">—</span>}
                  {s.hasSignature && <span className="mt-1 flex items-center gap-1 text-muted" data-testid="proof-signature"><PenLine className="size-3.5" aria-hidden />{t("fob.signed")}</span>}
                </Td>
                <Td label={t("fob.f_cod_short")} className="whitespace-nowrap text-xs"><CodCell s={s} /></Td>
                <Td label={t("bs.issue")} className="max-w-[200px] text-xs">{s.failReason ? <><p className="font-medium text-danger">{reason(s.failReason)}</p>{s.failNote && <p className="text-muted">{s.failNote}</p>}</> : <span className="text-muted">—</span>}
                  {(s.mediaCount ?? 0) > 0 && <button type="button" className="mt-1 inline-flex items-center gap-1 text-cyan hover:underline" onClick={() => setOpen(s.id)} data-testid="parcel-photos-link"><Camera className="size-3.5" aria-hidden />{t("fob.photos_n", { n: fmtNum(s.mediaCount ?? 0, locale) })}</button>}</Td>
                <Td align="end"><div className="flex items-center justify-end gap-1">
                  <Button size="sm" variant="ghost" aria-label={t("bs.details")} title={t("bs.details")} onClick={() => setOpen(s.id)}><Eye className="size-4" /></Button>
                  {printable(s) && <Button size="sm" variant="ghost" aria-label={t("intg.print_label")} title={t("intg.print_label")} disabled={printing} onClick={() => print([s])}><Printer className="size-4" /></Button>}
                  {canEdit(s, requestStatus) && <Button size="sm" variant="ghost" data-testid="edit-parcel" aria-label={t("bs.edit_parcel")} title={t("bs.edit_parcel")} onClick={() => setEdit(s)}><Pencil className="size-4" /></Button>}
                  {canChange(s, requestStatus) && <Button size="sm" variant="ghost" aria-label={t("bs.cancel_parcel")} title={t("bs.cancel_parcel")} className="text-danger" onClick={() => setCancel(s)}><Ban className="size-4" /></Button>}
                </div></Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page} total={data.total} pageSize={PAGE_SIZE} onPage={setPage} />
        </>
      )}
      {open && <ShipmentDrawer id={open} requestStatus={requestStatus} conns={conns} onPrint={(s) => print([s])} onClose={() => setOpen(null)} onEdit={setEdit} onCancel={setCancel} onProof={setProof} />}
      {proof && <ProofDialog item={proof} onClose={() => setProof(null)} />}
      {edit && <EditParcelDialog item={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); changed(); }} />}
      {cancel && <CancelParcelDialog item={cancel} onClose={() => setCancel(null)} onDone={() => { setCancel(null); setOpen(null); changed(); }} />}
    </section>
  );
}

// ───────── Receipt photo ─────────
export function ProofDialog({ item, onClose }: { item: Pick<ShipmentItem, "id" | "code" | "receiverName">; onClose: () => void }) {
  const { t } = useI18n(); const [failed, setFailed] = useState(false);
  return (
    <Modal open onClose={onClose} title={t("bs.proof_title", { code: item.code })} footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}>
      {item.receiverName && <p className="text-sm"><span className="text-muted">{t("bs.receiver")}:</span> <span className="font-medium">{item.receiverName}</span></p>}
      {failed ? <Notice tone="warn">{t("bs.proof_load_failed")}</Notice> : (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin stream, not an optimisable static asset
        <img src={`/api/v1/shipments/${item.id}/proof`} alt={t("bs.proof_alt", { code: item.code })} className="max-h-[70vh] w-full rounded-xl border border-line object-contain" onError={() => setFailed(true)} />
      )}
    </Modal>
  );
}

// ───────── One parcel: details + timeline ─────────
interface Ev { id: string; type: string; actorName: string | null; actorRole: string; createdAt: string; payload?: { reason?: string; note?: string; providerLabel?: string; status?: string; kind?: string; mediaId?: string; signatureMediaId?: string; proofType?: string; codCents?: number } | null }

function ShipmentDrawer({ id, requestStatus, conns, onPrint, onClose, onEdit, onCancel, onProof }: { id: string; requestStatus: string; conns: Connection[]; onPrint: (s: ShipmentItem) => void; onClose: () => void; onEdit: (s: ShipmentItem) => void; onCancel: (s: ShipmentItem) => void; onProof: (s: ShipmentItem) => void }) {
  const { t, locale } = useI18n(); const reason = useReason();
  const { data, error, mutate } = useApi<{ shipment: ShipmentItem; events: Ev[] }>(`/shipments/${id}`, { refreshInterval: 15000 });
  const [light, setLight] = useState<LightboxTarget | null>(null);
  const s = data?.shipment;
  const link = s ? `${window.location.origin}/track/${encodeURIComponent(s.code)}` : "";
  const evName = (type: string) => { const k = t(`event.${type}`); return k.startsWith("event.") ? type : k; };
  return (
    <>
    <Modal open onClose={onClose} title={s ? t("bs.parcel_title", { code: s.code }) : t("bs.details")} footer={<>
      {s && s.externalRef && labelable(conns.find((c) => c.id === s.partnerId)) && <Button variant="secondary" size="sm" onClick={() => onPrint(s)}><Printer className="size-4" />{t("intg.print_label")}</Button>}
      {s && canEdit(s, requestStatus) && <Button variant="secondary" size="sm" onClick={() => onEdit(s)}><Pencil className="size-4" />{t("bs.edit_parcel")}</Button>}
      {s && canChange(s, requestStatus) && <Button variant="danger" size="sm" onClick={() => onCancel(s)}><Ban className="size-4" />{t("bs.cancel_parcel")}</Button>}
      <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button></>}>
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !s ? <PageLoading /> : (
        <>
          <div className="flex flex-wrap items-center gap-2"><ShipBadge status={s.status} /><Badge>{t(`rtype.${s.recipientType}`)}</Badge>{detailsMissing(s) && <DetailsMissingBadge />}</div>
          <dl className="divide-y divide-line">
            <KV label={t("bs.f_name")}>{s.recipientName || "—"}</KV>
            <KV label={t("bs.f_phone")}><span className="ltr-num" dir="ltr">{s.recipientPhone || "—"}</span></KV>
            <KV label={t("bs.f_address")}>{s.address || "—"}</KV>
            {s.contents && <KV label={t("bs.f_contents")}>{s.contents}</KV>}
            {s.notes && <KV label={t("bs.f_notes")}>{s.notes}</KV>}
            {s.externalRef && <KV label={t("bs.f_ref")}><span className="ltr-num" dir="ltr">{s.externalRef}</span></KV>}
            {s.partnerStatus && <KV label={t("intg.partner_status")}><PartnerStatusBadge status={s.partnerStatus} at={s.partnerStatusAt} provider={(() => { const c = conns.find((x) => x.id === s.partnerId); return c ? providerName(t, c.provider, c.providerLabel) : undefined; })()} /></KV>}
            {s.driverName && <KV label={t("bs.driver")}>{s.driverName}</KV>}
            {s.attempts > 0 && <KV label={t("bs.attempts")}>{fmtNum(s.attempts, locale)}</KV>}
            {s.deliveredAt && <KV label={t("bs.delivered_at")}>{fmtDateTime(s.deliveredAt, locale)}</KV>}
            {(s.codCents ?? 0) > 0 && <KV label={t("fob.f_cod")}><span className="ltr-num" data-testid="drawer-cod">{fmtMoney(s.codCents ?? 0, locale)}</span></KV>}
            {s.codCollectedCents != null && <KV label={t("fob.cod_collected")}><span className="ltr-num text-accent" data-testid="drawer-cod-collected">{fmtMoney(s.codCollectedCents, locale)}{s.codCollectedAt && <span className="block text-xs font-normal text-muted">{fmtDateTime(s.codCollectedAt, locale)}</span>}</span></KV>}
            {s.proofType && <KV label={t("bs.proof")}>{s.proofType === "otp" ? t("bs.proof_otp") : s.proofType === "scan" ? <span data-testid="drawer-proof-scan">{t("fob.proof_scan_long")}</span> : <span className="inline-flex flex-wrap items-center justify-end gap-2">{s.receiverName}{s.hasProof && <button type="button" className="inline-flex items-center gap-1 text-cyan hover:underline" onClick={() => onProof(s)}><FileImage className="size-3.5" aria-hidden />{t("bs.proof_receipt")}</button>}</span>}</KV>}
            {s.hasSignature && <KV label={t("fob.signature")}>{t("fob.signature_captured")}</KV>}
            {s.failReason && <KV label={t("bs.issue")}><span className="text-danger">{reason(s.failReason)}</span>{s.failNote && <span className="block text-xs font-normal text-muted">{s.failNote}</span>}</KV>}
          </dl>
          <ShipmentPhotos shipmentId={s.id} expected={s.mediaCount == null ? !!s.hasSignature || s.status !== "pending" : (s.mediaCount ?? 0) > 0 || !!s.hasSignature} onOpen={setLight} />
          <div className="rounded-xl border border-line p-3">
            <p className="mb-1 text-xs font-semibold text-muted">{t("bs.tracking_link")}</p>
            <div className="flex items-center gap-2"><code dir="ltr" className="flex-1 break-all text-xs text-cyan">{link}</code><CopyBtn value={link} label={t("bs.copy_link")} /></div>
            <p className="mt-1 text-xs text-muted">{t("bs.tracking_hint")}</p>
          </div>
          {s.demoOtp && (
            <div className="rounded-xl border border-gold/40 bg-gold/5 p-3" data-testid="demo-otp">
              <p className="text-xs font-semibold text-gold">{t("bs.demo_code")}</p>
              <p className="ltr-num text-2xl font-extrabold tracking-[0.3em] text-gold" dir="ltr">{s.demoOtp}</p>
              <p className="text-xs text-muted">{t("bs.demo_code_hint")}</p>
            </div>
          )}
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("bs.parcel_timeline")}</h3>
            {data.events.length === 0 ? <p className="text-sm text-muted">{t("timeline.empty")}</p> : (
              <ol className="relative space-y-3 border-s border-line ps-5">
                {data.events.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -start-[25px] top-1.5 size-2.5 rounded-full bg-accent ring-4 ring-card" aria-hidden />
                    <p className="text-sm font-medium">{evName(e.type)}</p>
                    <p className="text-xs text-muted">{e.actorName ? `${e.actorName} · ` : ""}{t(`role.${e.actorRole}`)} · {fmtDateTime(e.createdAt, locale)}</p>
                    {e.type === "partner_status" ? <p className="mt-0.5 text-xs text-muted">{partnerStatusText(e.payload, t).join(" · ")}</p>
                      : (e.payload?.reason || e.payload?.note) && <p className="mt-0.5 whitespace-pre-line text-xs text-muted">{e.payload.reason ? `“${reason(e.payload.reason)}”${e.payload.note ? " — " : ""}` : ""}{e.payload.note ? (e.payload.reason ? e.payload.note : `“${e.payload.note}”`) : ""}</p>}
                    {e.payload?.proofType === "scan" && <p className="mt-0.5 text-xs text-muted">{t("fob.proof_scan_long")}</p>}
                    {typeof e.payload?.codCents === "number" && e.payload.codCents > 0 && <p className="mt-0.5 text-xs text-muted">{t("fob.ev_cash_collected", { amount: fmtMoney(e.payload.codCents, locale) })}</p>}
                    {(e.payload?.mediaId || e.payload?.signatureMediaId) && (
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {e.payload?.mediaId && <MediaThumb className="size-14" shipmentId={s.id} mediaId={e.payload.mediaId} label={t(e.type === "stop_deferred" ? "fob.media_defer" : "fob.media_fail")} onOpen={() => setLight({ shipmentId: s.id, mediaId: e.payload!.mediaId!, kind: e.type === "stop_deferred" ? "defer" : "fail", note: e.payload?.note ?? null, at: e.createdAt, by: e.actorName })} />}
                        {e.payload?.signatureMediaId && <MediaThumb className="size-14" shipmentId={s.id} mediaId={e.payload.signatureMediaId} label={t("fob.media_signature")} onOpen={() => setLight({ shipmentId: s.id, mediaId: e.payload!.signatureMediaId!, kind: "signature", at: e.createdAt, by: e.actorName })} />}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </Modal>
    {light && <MediaLightbox target={light} onClose={() => setLight(null)} />}
    </>
  );
}

// ───────── Fix a typo before hand-over ─────────
function EditParcelDialog({ item, onClose, onSaved }: { item: ShipmentItem; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n(); const a = useAction();
  const [row, setRow] = useState<ManifestRow>(() => ({ ...fromServer(item as unknown as Record<string, unknown>), uid: item.id }));
  const [serverErr, setServerErr] = useState<Record<string, string>>({}); const [show, setShow] = useState(false);
  // A parcel booked "details later" may be saved partially (progress is kept); a complete one can no longer be blanked.
  const partial = detailsMissing(item);
  const up = (p: Partial<ManifestRow>) => { setRow((r) => ({ ...r, ...p })); setServerErr({}); };
  const client = show ? validateRow(row, { partial }) : {};
  const err = (f: keyof ManifestRow & string) => { const k = serverErr[f] ?? (client as Record<string, string>)[f]; return k ? t(k) : undefined; };
  const submit = () => {
    if (Object.keys(validateRow(row, { partial })).length) { setShow(true); return; }
    a.run("edit", () => patch(`/shipments/${item.id}`, { recipientType: row.recipientType, recipientName: row.recipientName.trim() || null, recipientPhone: row.recipientPhone.trim() || null, address: row.address.trim() || null, contents: row.contents.trim() || null, notes: row.notes.trim() || null, externalRef: row.externalRef.trim() || null, ...(codCentsOf(row.cod) !== (item.codCents ?? 0) ? { codCents: codCentsOf(row.cod) } : {}) }),
      { success: "bs.parcel_updated", onDone: onSaved, onError: (e) => { const fe = fieldErrors(e); setServerErr(Object.fromEntries(Object.keys(fe).filter((k) => k in FIELD_ERR_KEY).map((k) => [k === "codCents" ? "cod" : k, FIELD_ERR_KEY[k]]))); } });
  };
  const types: RType[] = ["consumer", "business"];
  return (
    <Modal open onClose={onClose} title={t("bs.edit_title", { code: item.code })} footer={<><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button loading={a.is("edit")} data-testid="edit-parcel-save" onClick={submit}>{t("common.save")}</Button></>}>
      <Notice tone={partial ? "warn" : "info"}>{partial ? t("pb.edit_partial_note") : t("bs.edit_note")}</Notice>
      <div role="radiogroup" aria-label={t("bs.recipient_type")} className="inline-flex overflow-hidden rounded-xl border border-line">
        {types.map((k) => <button key={k} type="button" role="radio" aria-checked={row.recipientType === k} onClick={() => up({ recipientType: k })} className={cn("px-3 py-1.5 text-xs transition", row.recipientType === k ? "bg-accent font-semibold text-accent-ink" : "bg-bg2 text-muted hover:text-ink")}>{t(`rtype.${k}`)}</button>)}
      </div>
      <p className="text-xs text-muted">{t(`rtype.${row.recipientType}_hint`)}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t("bs.f_name")} data-testid="edit-name" value={row.recipientName} onChange={(e) => up({ recipientName: e.target.value })} error={err("recipientName")} maxLength={120} required={!partial} />
        <Input label={t("bs.f_phone")} data-testid="edit-phone" type="tel" ltr value={row.recipientPhone} onChange={(e) => up({ recipientPhone: e.target.value })} error={err("recipientPhone")} maxLength={20} required={!partial} />
        <div className="sm:col-span-2"><Input label={t("bs.f_address")} data-testid="edit-address" value={row.address} onChange={(e) => up({ address: e.target.value })} error={err("address")} maxLength={300} required={!partial} /></div>
        <Input label={t("bs.f_ref")} ltr value={row.externalRef} onChange={(e) => up({ externalRef: e.target.value })} error={err("externalRef")} maxLength={80} />
        <Input label={t("bs.f_contents")} value={row.contents} onChange={(e) => up({ contents: e.target.value })} error={err("contents")} maxLength={300} />
        <div className="sm:col-span-2"><Input label={t("bs.f_notes")} value={row.notes} onChange={(e) => up({ notes: e.target.value })} error={err("notes")} maxLength={500} /></div>
        <div className="sm:col-span-2"><Input label={t("fob.f_cod")} ltr inputMode="decimal" data-testid="edit-cod" value={row.cod} onChange={(e) => up({ cod: e.target.value })} error={err("cod")} hint={t("fob.cod_hint")} maxLength={14} placeholder="0.00" /></div>
      </div>
      {item.recipientPhone && item.recipientPhone !== row.recipientPhone.trim() && <p className="text-xs text-muted">{t("bs.edit_phone_note")}</p>}
    </Modal>
  );
}

// ───────── Withdraw one order (refunded immediately) ─────────
function CancelParcelDialog({ item, onClose, onDone }: { item: ShipmentItem; onClose: () => void; onDone: () => void }) {
  const { t, locale } = useI18n(); const a = useAction(); const [reason, setReason] = useState("");
  return (
    <Modal open onClose={onClose} title={t("bs.cancel_title", { code: item.code })} footer={<><Button variant="ghost" onClick={onClose}>{t("common.back")}</Button><Button variant="danger" loading={a.is("cx")} disabled={reason.trim().length < 3} onClick={() => a.run("cx", () => post<{ cancelled: boolean; refundedCents: number }>(`/shipments/${item.id}/cancel`, { reason: reason.trim() }), { onDone: (r) => { toast.success(t("bs.parcel_cancelled", { amount: fmtMoney(r.refundedCents, locale) })); onDone(); } })}>{t("bs.cancel_confirm")}</Button></>}>
      <Notice tone="warn">{t("bs.cancel_note", { name: item.recipientName })}</Notice>
      <Textarea label={t("req.reason")} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} hint={t("bz.min_3")} required />
    </Modal>
  );
}

