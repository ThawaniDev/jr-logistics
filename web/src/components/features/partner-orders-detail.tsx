"use client";
import { useState } from "react";
import Link from "next/link";
import { Archive, ArrowDownLeft, ArrowUpRight, ExternalLink, FilePlus2, MapPin, Package, Printer, RefreshCw, RotateCcw, Search, Timer } from "lucide-react";
import { Badge, Breadcrumbs, Button, DetailHeader, ErrorState, InfoGrid, Notice, PageLoading, Section, StatusBadge, Table, Td, useAction, type Tone } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError, post } from "@/lib/api";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { mapsUrl } from "./business-fieldops-lib";
import { JR_EVENTS, PartnerStatusBadge, prettyStatus, providerName, type Connection, type PartnerOrderDetail } from "./business-shipments-partner";
import { canRefresh, cancelledByKey, isOpen, isRestorable, kgOf, pickupPairs, txOr } from "./partner-orders-lib";
import { CityValue, CodValue, DismissDialog, OrderStateBadge, PhoneValue, isAdminApi, ordersHome, requestHref, useCityNames, useCreateFromOrders, useOrderPerms, useRestore } from "./partner-orders-parts";

type ConnView = Connection & { business?: string | null; businessId?: string };
const OUTCOME_TONE: Record<string, Tone> = { ok: "success", ignored: "neutral", error: "danger" };
const OUTBOX_TONE: Record<string, Tone> = { queued: "neutral", sent: "success", dead: "danger", skipped: "neutral", retry_wait: "warn" };

/** One incoming order: identifiers, actions, recipient, parcel details, the partner's status, the JR parcel, the timeline and the updates JR sent back. */
export function PartnerOrderView({ id, apiBase }: { id: string; apiBase: string }) {
  const { t, locale } = useI18n(); const perms = useOrderPerms(apiBase); const a = useAction();
  const r = useApi<PartnerOrderDetail>(perms.view ? `${apiBase}/orders/${id}` : null);
  const o = r.data;
  const cr = useApi<ConnView>(o ? `${apiBase}/connections/${o.connectionId}` : null, { shouldRetryOnError: false });
  const { names } = useCityNames();
  const create = useCreateFromOrders(apiBase);
  const [dismissing, setDismissing] = useState(false);
  const restore = useRestore(apiBase, () => { void r.mutate(); });

  if (!perms.view) return <ErrorState error={new ApiError("FORBIDDEN", "Forbidden", 403)} />;
  if (r.error) return <ErrorState error={r.error} retry={() => r.mutate()} />;
  if (!o) return <PageLoading />;

  const conn = cr.data;
  const pname = providerName(t, o.provider, o.providerLabel);
  const admin = isAdminApi(apiBase);
  const home = ordersHome(apiBase);
  const refresh = () => a.run("refresh", () => post<PartnerOrderDetail>(`${apiBase}/orders/${o.id}/refresh`), { success: "iord.refreshed", onDone: (d) => { void r.mutate(d, { revalidate: false }); } });
  const when = (iso: string | null | undefined) => (iso ? <span className="ltr-num">{fmtDateTime(iso, locale)}</span> : "—");
  const evLabel = (k: string) => ((JR_EVENTS as readonly string[]).includes(k) ? t(`iord.ev_${k}`) : txOr(t, `iord.kind_${k}`, prettyStatus(k)));
  const dirLabel = (d: string) => { const k = `iord.dir_${d}`; const s = t(k, { name: pname }); return s === k ? prettyStatus(d) : s; };
  const slot = o.slot && (o.slot.from || o.slot.to) ? [o.slot.from, o.slot.to].filter(Boolean).map((s) => fmtDateTime(s!, locale)).join(" – ") : null;
  const pickup = pickupPairs(o.pickup);
  const kg = kgOf(o.weightGrams);

  const actions = (
    <>
      {perms.create && isOpen(o) && <Button loading={create.busy} onClick={() => create.start([o.id])} data-testid="order-create"><FilePlus2 className="size-4" aria-hidden />{t("iord.create_order")}</Button>}
      {o.parcel && <Link href={requestHref(apiBase, o.parcel.requestId)} data-testid="order-open-request"><Button variant="secondary"><ExternalLink className="size-4" aria-hidden />{t("iord.open_request", { ref: o.parcel.requestRef })}</Button></Link>}
      {perms.manage && canRefresh(conn) && <Button variant="secondary" loading={a.is("refresh")} onClick={refresh} data-testid="order-refresh"><RefreshCw className="size-4" aria-hidden />{t("iord.refresh", { name: pname })}</Button>}
      {o.labelUrl && o.mode === "carrier" && <a href={o.labelUrl} target="_blank" rel="noopener noreferrer" data-testid="order-label"><Button variant="secondary" tabIndex={-1}><Printer className="size-4" aria-hidden />{t("iord.print_label")}</Button></a>}
      {o.trackingUrl && <a href={o.trackingUrl} target="_blank" rel="noopener noreferrer"><Button variant="ghost" tabIndex={-1}><Search className="size-4" aria-hidden />{t("iord.tracking")}</Button></a>}
      {perms.manage && isOpen(o) && <Button variant="danger" onClick={() => setDismissing(true)} data-testid="order-dismiss"><Archive className="size-4" aria-hidden />{t("iord.set_aside")}</Button>}
      {perms.manage && isRestorable(o) && <Button variant="secondary" loading={restore.busy} onClick={() => restore.run([o.id])} data-testid="order-restore"><RotateCcw className="size-4" aria-hidden />{t("iord.restore")}</Button>}
    </>
  );

  return (
    <>
      <Breadcrumbs items={[{ label: t("nav.integrations"), href: admin ? "/admin/integrations" : "/business/integrations" }, { label: t("iord.nav"), href: home }, { label: o.displayRef }]} />
      <DetailHeader name={o.displayRef}
        avatar={<span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-cyan/10 text-cyan" aria-hidden><Package className="size-7" /></span>}
        badges={<><OrderStateBadge state={o.state} /><Badge tone="info">{pname}</Badge></>}
        subtitle={<>{t("iord.via", { connection: o.connectionName ?? conn?.name ?? "—", provider: pname })}{admin && conn?.business ? <> · {perms.companies && conn.businessId ? <Link href={`/admin/companies/${conn.businessId}`} className="text-cyan hover:underline">{conn.business}</Link> : conn.business}</> : null}</>}
        facts={[
          { label: t("iord.f_external_ref"), value: <span className="ltr-num" dir="ltr">{o.externalRef}</span> },
          { label: t("iord.f_external_id"), value: o.externalId ? <span className="ltr-num" dir="ltr">{o.externalId}</span> : "—" },
          { label: t("iord.f_invoice"), value: o.invoice ? <span className="ltr-num" dir="ltr">{o.invoice}</span> : "—" },
          { label: t("iord.f_awb"), value: o.awb ? <span className="ltr-num" dir="ltr" data-testid="order-awb">{o.awb}</span> : "—" },
          { label: t("iord.h_received"), value: when(o.createdAt) },
          { label: t("iord.f_updated"), value: when(o.updatedAt) },
        ]}
        actions={actions} />

      {o.state === "cancelled" && (
        <div className="mb-5">
          {o.cancelledBy === "partner"
            ? <Notice tone="danger" title={t("iord.cancelled_partner_title", { name: pname })}>{t("iord.cancelled_partner_body")}{o.cancelReason ? ` ${t("iord.reason", { reason: o.cancelReason })}` : ""}</Notice>
            : <Notice tone="neutral" title={t("iord.set_aside_title")}><span data-testid="order-set-aside">{t("iord.set_aside_body", { who: t(cancelledByKey(o.cancelledBy)), date: fmtDateTime(o.cancelledAt, locale) })}{o.cancelReason ? ` ${t("iord.reason", { reason: o.cancelReason })}` : ""}</span></Notice>}
        </div>
      )}
      {isOpen(o) && !o.detailsComplete && <div className="mb-5"><Notice tone="warn">{t("iord.incomplete_note")}</Notice></div>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t("iord.s_recipient")}>
          <InfoGrid items={[
            { label: t("iord.f_name"), value: o.recipientName ? <span dir="auto">{o.recipientName}</span> : "—" },
            { label: t("iord.f_phone"), value: <PhoneValue o={o} /> },
            { label: t("iord.f_email"), value: o.recipientEmail ? <span className="ltr-num" dir="ltr">{o.recipientEmail}</span> : "—" },
            { label: t("iord.f_city"), value: <><CityValue o={o} names={names} />{o.city && o.cityRaw && <span className="mt-0.5 block text-xs font-normal text-muted" dir="auto">{t("iord.f_city_raw", { raw: o.cityRaw })}</span>}</> },
            { label: t("iord.f_address"), value: <>{o.address ? <span dir="auto">{o.address}</span> : "—"}{o.lat != null && o.lng != null && <a href={mapsUrl(o.lat, o.lng)} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1 text-xs font-normal text-cyan hover:underline" data-testid="order-map"><MapPin className="size-3.5" aria-hidden />{t("iord.map")}</a>}</> },
          ]} />
        </Section>

        <Section title={t("iord.s_shipment")}>
          <InfoGrid items={[
            { label: t("iord.f_cod"), value: <CodValue cents={o.codCents} className={o.codCents ? "ltr-num font-semibold text-gold" : "text-muted"} /> },
            { label: t("iord.f_pieces"), value: fmtNum(o.pieces, locale) },
            { label: t("iord.f_weight"), value: kg != null ? t("iord.kg", { n: fmtNum(kg, locale) }) : "—" },
            { label: t("iord.f_slot"), value: slot ? <span className="inline-flex items-center gap-1"><Timer className="size-3.5 text-muted" aria-hidden />{slot}</span> : "—" },
            { label: t("iord.f_contents"), value: o.contents ? <span dir="auto">{o.contents}</span> : "—" },
            { label: t("iord.f_notes"), value: o.notes ? <span dir="auto">{o.notes}</span> : "—" },
          ]} />
          {pickup.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <p className="mb-2 text-xs text-muted">{t("iord.f_pickup")}</p>
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">{pickup.map((p) => <div key={p.key} className="flex min-w-0 gap-2"><dt className="shrink-0 text-muted">{prettyStatus(p.key.replace(/\./g, " "))}</dt><dd className="min-w-0 break-words font-medium" dir="auto">{p.value}</dd></div>)}</dl>
            </div>
          )}
          {o.items && o.items.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <p className="mb-2 text-xs text-muted">{t("iord.f_items")}</p>
              <ul className="divide-y divide-line/70 text-sm" data-testid="order-items">
                {o.items.map((it, i) => <li key={i} className="flex items-center justify-between gap-3 py-1.5"><span className="min-w-0"><span dir="auto">{it.name || "—"}</span>{it.sku && <span className="ltr-num ms-2 text-xs text-muted" dir="ltr">{it.sku}</span>}</span><span className="tabular-nums text-muted">× {fmtNum(it.qty, locale)}</span></li>)}
              </ul>
            </div>
          )}
        </Section>

        <Section title={t("iord.s_partner", { name: pname })}>
          <div className="space-y-3">
            {o.partnerStatus ? <PartnerStatusBadge status={o.partnerStatus} at={o.partnerStatusAt} provider={pname} /> : <p className="text-sm text-muted">{t("iord.no_partner_status", { name: pname })}</p>}
            <p className="text-sm">{o.detailsComplete ? <Badge tone="success">{t("iord.complete_yes")}</Badge> : <Badge tone="warn">{t("iord.complete_no")}</Badge>}</p>
          </div>
        </Section>

        <Section title={t("iord.s_parcel")}>
          {o.parcel ? (
            <InfoGrid items={[
              { label: t("iord.p_code"), value: <span className="ltr-num" dir="ltr" data-testid="order-parcel-code">{o.parcel.code}</span> },
              { label: t("iord.p_status"), value: <StatusBadge status={o.parcel.status} ns="shipstatus" /> },
              { label: t("iord.p_request"), value: <Link href={requestHref(apiBase, o.parcel.requestId)} className="ltr-num text-cyan hover:underline">{o.parcel.requestRef}</Link> },
              { label: t("iord.p_request_status"), value: <StatusBadge status={o.parcel.requestStatus} /> },
              ...(o.parcel.deliveredAt ? [{ label: t("iord.p_delivered"), value: when(o.parcel.deliveredAt) }] : []),
              ...(o.parcel.failedAt ? [{ label: t("iord.p_failed"), value: <>{when(o.parcel.failedAt)}{o.parcel.failReason && <span className="mt-0.5 block text-xs font-normal text-muted">{txOr(t, `stopfail.${o.parcel.failReason}`, prettyStatus(o.parcel.failReason))}</span>}</> }] : []),
            ]} />
          ) : <p className="text-sm text-muted">{o.state === "cancelled" ? t("iord.no_parcel_cancelled") : t("iord.no_parcel_open")}</p>}
        </Section>
      </div>

      <div className="mt-5 grid gap-5">
        <Section title={t("iord.s_timeline")} flush>
          {o.events.length === 0 ? <p className="p-5 text-sm text-muted">{t("iord.no_events")}</p> : (
            <ol className="divide-y divide-line/70" data-testid="order-timeline">
              {o.events.map((e) => (
                <li key={e.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                  <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${e.direction === "out" ? "bg-accent/10 text-accent" : "bg-cyan/10 text-cyan"}`} aria-hidden>{e.direction === "out" ? <ArrowUpRight className="size-4 rtl:-scale-x-100" /> : <ArrowDownLeft className="size-4 rtl:-scale-x-100" />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{evLabel(e.kind)}</span><span className="text-xs text-muted">{dirLabel(e.direction)}</span><Badge tone={OUTCOME_TONE[e.outcome] ?? "neutral"}>{txOr(t, `iord.out_${e.outcome}`, e.outcome)}</Badge></div>
                    {e.summary && <p className="mt-0.5 break-words text-xs text-muted" dir="auto">{e.summary}</p>}
                  </div>
                  <span className="ltr-num shrink-0 text-xs text-muted">{fmtDateTime(e.createdAt, locale)}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title={t("iord.s_updates", { name: pname })} flush>
          {o.updates.length === 0 ? <p className="p-5 text-sm text-muted">{t("iord.no_updates")}</p> : (
            <Table bare stack label={t("iord.s_updates", { name: pname })} head={[t("iord.u_action"), t("iord.u_status"), { label: t("iord.u_attempts"), align: "end" }, t("iord.u_error"), t("iord.u_when"), t("iord.u_sent")]}>
              {o.updates.map((u) => (
                <tr key={u.id} data-testid="order-update" className="align-top">
                  <Td label={t("iord.u_action")} className="font-medium">{evLabel(u.action)}</Td>
                  <Td label={t("iord.u_status")}><Badge tone={OUTBOX_TONE[u.status] ?? "neutral"}>{txOr(t, `iord.ob_${u.status}`, prettyStatus(u.status))}</Badge></Td>
                  <Td label={t("iord.u_attempts")} num>{fmtNum(u.attempts, locale)}</Td>
                  <Td label={t("iord.u_error")} className="max-w-[22rem] break-words text-xs text-danger">{u.lastError || <span className="text-muted">—</span>}</Td>
                  <Td label={t("iord.u_when")} className="whitespace-nowrap text-xs text-muted">{fmtDateTime(u.createdAt, locale)}</Td>
                  <Td label={t("iord.u_sent")} className="whitespace-nowrap text-xs text-muted">{u.sentAt ? fmtDateTime(u.sentAt, locale) : "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      </div>
      {create.dialog}
      {dismissing && <DismissDialog apiBase={apiBase} orders={[o]} onClose={() => setDismissing(false)} onDone={() => { setDismissing(false); void r.mutate(); }} />}
    </>
  );
}
