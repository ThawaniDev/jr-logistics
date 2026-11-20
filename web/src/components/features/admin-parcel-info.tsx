"use client";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge, KV, Notice, Section, type Tone } from "@/components/ui";
import { fmtDur } from "@/components/reports/chartTheme";
import { fmtDateTime, fmtKm, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useCityNames, useTx } from "./admin-common";
import { OrderMap } from "./admin-order-map-view";
import { PIN_FLAG_M } from "./admin-shipments";

const MSG_TONE: Record<string, Tone> = { sent: "success", delivered: "success", queued: "neutral", failed: "danger" };

/** Who receives it and where: name, masked phone, address, and the delivery position against the pin on a map. */
export function ParcelRecipient({ d }: { d: any }) {
  const { t, locale } = useI18n(); const { name } = useCityNames(); const tx = useTx();
  const loc = d.location, far = typeof loc.distanceM === "number" && loc.distanceM > PIN_FLAG_M;
  const points = [
    ...(loc.pin ? [{ id: "pin", ...loc.pin, tone: "cyan" as const, big: true, label: t("dv1.loc_pin") }] : []),
    ...(loc.delivered ? [{ id: "delivered", ...loc.delivered, tone: (far ? "danger" : "accent") as "danger" | "accent", big: true, label: t("dv1.loc_delivered") }] : []),
  ];
  return (
    <>
      <Section title={t("dv1.recipient_title")} id="parcel-recipient">
        <dl>
          <KV label={t("common.name")}>{d.recipient.name || "—"}</KV>
          <KV label={t("auth.phone")}><span className="ltr-num">{d.recipient.phone ?? "—"}</span></KV>
          <KV label={t("dv1.r_type")}><Badge tone={d.recipient.type === "business" ? "info" : "neutral"}>{t(`rtype.${d.recipient.type}`)}</Badge></KV>
          <KV label={t("shipadm.col_address")}>{d.recipient.address || "—"}</KV>
          <KV label={t("reg.city")}>{name(d.recipient.city)}</KV>
          {d.parcel.contents && <KV label={t("dstop.contents")}>{d.parcel.contents}</KV>}
          {d.parcel.notes && <KV label={t("dstop.notes")}>{d.parcel.notes}</KV>}
          {d.parcel.receiverName && <KV label={t("dv1.r_received_by")}>{d.parcel.receiverName}</KV>}
        </dl>
      </Section>
      <Section title={t("dv1.loc_title")} description={loc.distanceM != null ? t("shipadm.pin_distance", { n: fmtNum(Math.round(loc.distanceM), locale) }) : undefined} id="parcel-location"
        actions={far ? <Badge tone="warn"><AlertTriangle className="size-3" aria-hidden />{t("shipadm.pin_far", { n: Math.round(loc.distanceM) })}</Badge> : undefined}>
        {!loc.pin && <Notice tone="warn">{t("dv1.loc_no_pin")}</Notice>}
        {loc.deliveredHidden && <Notice tone="info">{t("dv1.loc_hidden")}</Notice>}
        <div className="mt-3"><OrderMap points={points} lines={loc.pin && loc.delivered ? [{ points: [[loc.pin.lat, loc.pin.lng], [loc.delivered.lat, loc.delivered.lng]], tone: far ? "danger" : "accent", dashed: true }] : []} label={t("dv1.loc_title")} emptyHint={t("dv1.loc_empty")} height="h-56"
          legend={[{ tone: "cyan", label: t("dv1.loc_pin") }, { tone: far ? "danger" : "accent", label: t("dv1.loc_delivered") }]} /></div>
        {loc.geoSource && <p className="mt-2 text-xs text-muted">{t("dv1.loc_source", { source: tx(`dv1.geo_${loc.geoSource}`, loc.geoSource) })}</p>}
      </Section>
    </>
  );
}

/** Delivery code and messages: how many codes were sent, wrong attempts, when it was verified, and every SMS / message record for the parcel (recipients masked, texts never stored). */
export function ParcelOtp({ d }: { d: any }) {
  const { t, locale } = useI18n(); const tx = useTx();
  const o = d.otp, st = d.messages.stats as Record<string, number>;
  return (
    <Section title={t("dv1.otp_title")} description={t("dv1.otp_sub")} id="parcel-otp">
      <dl>
        <KV label={t("dv1.otp_sent")}><span className="ltr-num">{o.sentEvents}</span></KV>
        <KV label={t("dv1.otp_resends")}><span className="ltr-num">{o.resends}</span></KV>
        <KV label={t("dv1.otp_wrong")}><span className={`ltr-num ${o.failedEvents > 0 ? "text-gold" : ""}`}>{o.failedEvents}</span></KV>
        <KV label={t("dv1.otp_verified")}>{o.verifiedAt ? <span className="text-accent">{fmtDateTime(o.verifiedAt, locale)}</span> : "—"}</KV>
        {o.notifyFailed > 0 && <KV label={t("dv1.otp_notify_failed")}><span className="ltr-num text-danger">{o.notifyFailed}</span></KV>}
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5">{(["sent", "delivered", "queued", "failed"] as const).filter((k) => st[k]).map((k) => <Badge key={k} tone={MSG_TONE[k]}>{t(`dv1.msgst_${k}`)} · {st[k]}</Badge>)}</div>
      {d.messages.items.length === 0 ? <p className="mt-3 text-sm text-muted">{t("dv1.otp_no_messages")}</p> : (
        <ul className="mt-3 divide-y divide-line/70 text-sm" data-testid="dv1-parcel-messages">
          {d.messages.items.map((m: any) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{tx(`dv1.ch_${m.channel}`, m.channel)} · {tx(`dv1.mt_${m.type}`, m.type.replace(/_/g, " "))} <span className="ltr-num text-xs text-muted">{m.recipient ?? ""}</span></span>
              <span className="flex items-center gap-2 text-xs text-muted">{fmtDateTime(m.at, locale)}<Badge tone={MSG_TONE[m.status] ?? "neutral"}>{tx(`dv1.msgst_${m.status}`, m.status)}</Badge></span>
              {m.error && <p className="w-full text-xs text-danger">{m.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Cash on delivery of this parcel and the state of the driver's hand-over of it. */
export function ParcelCod({ d }: { d: any }) {
  const { t, locale } = useI18n(); const me = useUser(); const c = d.cod;
  const m = (v: number | null | undefined) => <span className="ltr-num">{fmtMoney(v, locale)}</span>;
  if (!c.dueCents && c.collectedCents == null) return null;
  return (
    <Section title={t("dv1.pcod_title")} id="parcel-cod" actions={hasPerm(me, "cod.manage") || hasPerm(me, "finance.view") ? <Link href="/admin/finance/cod" className="text-sm text-accent hover:underline">{t("foa.cod_open_console")}</Link> : undefined}>
      <dl data-testid="dv1-parcel-cod">
        <KV label={t("dv1.cod_due")}>{m(c.dueCents)}</KV>
        <KV label={t("foa.cod_collected")}>{c.collectedCents == null ? <Badge tone="warn">{t("dv1.pcod_not_collected")}</Badge> : <>{m(c.collectedCents)}{c.collectedAt && <span className="block text-xs font-normal text-muted">{fmtDateTime(c.collectedAt, locale)}{c.collectedBy ? ` · ${c.collectedBy}` : ""}</span>}</>}</KV>
        {c.offer && <>
          <KV label={t("foa.cod_received")}>{m(c.offer.receivedCents)}<span className="block text-xs font-normal text-muted">{t("dv1.pcod_offer_scope")}</span></KV>
          <KV label={t("foa.cod_outstanding")}><span className={c.offer.outstandingCents > 0 ? "text-gold" : ""}>{m(c.offer.outstandingCents)}</span></KV>
        </>}
      </dl>
      {c.remittances.length > 0 && <ul className="mt-3 space-y-1 text-xs text-muted">{c.remittances.map((r: any) => <li key={r.id}><span className="ltr-num">{r.ref}</span> · {fmtMoney(r.amountCents, locale)} · {fmtDateTime(r.createdAt, locale)}{r.receivedBy ? ` · ${r.receivedBy}` : ""}</li>)}</ul>}
    </Section>
  );
}

/** The planned leg to this stop against what happened: stop number, planned distance / time, time since the previous stop, time at the door, and how the route was made. */
export function ParcelRoute({ d }: { d: any }) {
  const { t, locale } = useI18n();
  const r = d.route;
  if (r.stopOrder == null && !r.provider) return null;
  return (
    <Section title={t("dv1.route_title")} id="parcel-route">
      <dl data-testid="dv1-parcel-route">
        <KV label={t("dv1.route_stop")}><span className="ltr-num">{r.stopOrder ?? "—"}</span></KV>
        <KV label={t("dv1.route_planned")}>{r.plannedDistanceM != null ? <span className="ltr-num">{fmtKm(r.plannedDistanceM, locale)}{r.plannedDurationS != null && ` · ${fmtDur(r.plannedDurationS, locale)}`}</span> : "—"}</KV>
        <KV label={t("dv1.route_actual")}>{r.actualLegS != null && r.actualLegS >= 0 ? <span className="ltr-num">{fmtDur(r.actualLegS, locale)}</span> : "—"}</KV>
        <KV label={t("dv1.route_door")}>{r.dwellS != null ? <span className="ltr-num">{fmtDur(r.dwellS, locale)}</span> : "—"}</KV>
        <KV label={t("dv1.route_how")}>{r.provider ? t(`dv1.provider_${r.provider}`) : "—"}{r.manual && <> · <Badge tone="warn">{t("dv1.f_manual_order")}</Badge></>}</KV>
      </dl>
    </Section>
  );
}

/** The warehouse-system (partner) side: the status it last reported, the incoming order, the write-back queue and the latest exchanges. */
export function ParcelPartner({ d }: { d: any }) {
  const { t, locale } = useI18n(); const tx = useTx(); const p = d.partner;
  if (!p) return null;
  return (
    <Section title={t("dv1.partner_title")} id="parcel-partner">
      <dl data-testid="dv1-parcel-partner">
        <KV label={t("dv1.partner_status")}>{p.partnerStatus ?? "—"}{p.partnerStatusAt && <span className="block text-xs font-normal text-muted">{fmtDateTime(p.partnerStatusAt, locale)}</span>}</KV>
        {p.order && <>
          <KV label={t("dv1.partner_provider")}>{p.order.provider}{p.order.connection ? ` · ${p.order.connection}` : ""}</KV>
          <KV label={t("dv1.partner_order")}><Badge tone={p.order.state === "cancelled" ? "danger" : "info"}>{tx(`dv1.partner_state_${p.order.state}`, p.order.state)}</Badge></KV>
          {p.order.awb && <KV label={t("dv1.partner_awb")}><span className="ltr-num">{p.order.awb}</span></KV>}
        </>}
      </dl>
      {p.outbox.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{p.outbox.map((o: any) => <Badge key={o.status} tone={o.status === "sent" ? "success" : o.status === "dead" ? "danger" : "neutral"}>{tx(`dv1.outbox_${o.status}`, o.status)} · {o.n}</Badge>)}</div>}
      {p.outbox.some((o: any) => o.lastError) && <p className="mt-2 text-xs text-danger">{p.outbox.find((o: any) => o.lastError)?.lastError}</p>}
      {p.events.length > 0 && <ul className="mt-3 divide-y divide-line/70 text-xs text-muted">{p.events.map((e: any) => <li key={e.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{e.direction} · {e.kind}{e.summary ? ` — ${e.summary}` : ""}</span><span>{fmtDateTime(e.at, locale)}</span></li>)}</ul>}
    </Section>
  );
}

/** Other parcels for the same recipient phone or the same address (any order), newest first, each opening its own view. */
export function ParcelSimilar({ d }: { d: any }) {
  const { t, locale } = useI18n();
  const list = (items: any[]) => (
    <ul className="divide-y divide-line/70 text-sm">{items.map((s) => (
      <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="dv1-similar-item">
        <span><Link href={`/admin/parcels/${s.id}`} className="ltr-num font-medium text-accent hover:underline">{s.code}</Link> <span className="text-xs text-muted">{s.recipientName}</span></span>
        <span className="flex items-center gap-2 text-xs text-muted">{fmtDateTime(s.createdAt, locale)}<Badge>{t(`shipstatus.${s.status}`)}</Badge></span>
      </li>))}</ul>
  );
  const a = d.similar.byPhone, b = d.similar.byAddress;
  return (
    <Section title={t("dv1.similar_title")} description={t("dv1.similar_sub")} id="parcel-similar">
      {a.length + b.length === 0 ? <p className="text-sm text-muted">{t("dv1.similar_none")}</p> : <div className="space-y-4">
        {a.length > 0 && <div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{t("dv1.similar_phone")}</h3>{list(a)}</div>}
        {b.length > 0 && <div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{t("dv1.similar_address")}</h3>{list(b)}</div>}
      </div>}
    </Section>
  );
}
