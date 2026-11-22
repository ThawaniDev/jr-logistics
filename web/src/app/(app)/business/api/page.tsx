"use client";
import { useState } from "react";
import { Activity, Copy, KeyRound, Plus, RefreshCw, Send, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, EmptyState, ErrorState, Input, Modal, Notice, PageHeader, PageLoading, Section, Stat, StatGrid, StatusBadge, Table, Td, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useB2bEnabled } from "@/components/features/business-shipments-policy";
import { post, put } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };

export default function ApiPage() {
  const { t, locale } = useI18n(); const a = useAction(); const b2b = useB2bEnabled(); // J3: while B2B shipments are off the docs say so and the example has no business recipient
  const keys = useApi("/business/api-keys"); const hook = useApi("/business/webhook");
  const [name, setName] = useState(""); const [created, setCreated] = useState<any>(null); const [url, setUrl] = useState<string | null>(null); const [secret, setSecret] = useState<string | null>(null); const [rotate, setRotate] = useState(false); const [revoke, setRevoke] = useState<any>(null);
  if (keys.error || hook.error) return <ErrorState error={keys.error ?? hook.error} retry={() => { keys.mutate(); hook.mutate(); }} />;
  if (!keys.data || !hook.data) return <PageLoading />;
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success(t("common.copied")), () => toast.error(t("ubz.copy_failed")));
  const activeKeys = keys.data.items.filter((k: any) => !k.revokedAt).length; const MAX_KEYS = 5; // server limit
  const trimmed = name.trim();
  const deliveries: any[] = (hook.data.deliveries ?? []).slice(0, 15); const logs: any[] = (hook.data.apiLogs ?? []).slice(0, 20);
  const failedDeliveries = deliveries.filter((d) => ["failed", "dead_letter", "retry_wait"].includes(d.status)).length; const failedCalls = logs.filter((l) => l.status >= 400).length;
  return (
    <>
      <PageHeader title={t("nav.api")} subtitle={t("api.sub")} />
      <StatGrid cols={4} className="mb-6">
        <Stat label={t("api.keys")} value={<span className="ltr-num">{activeKeys}/{MAX_KEYS}</span>} hint={activeKeys >= MAX_KEYS ? t("ubz.keys_full") : t("rdz.api_k_keys_hint")} icon={<KeyRound className="size-5" />} tone={activeKeys > 0 ? "accent" : "muted"} href="#keys" />
        <Stat label={t("api.webhook")} value={hook.data.url ? t("rdz.api_on") : t("rdz.api_off")} hint={hook.data.url ? <span className="ltr-num truncate" dir="ltr">{hostOf(hook.data.url)}</span> : t("rdz.api_k_hook_hint")} icon={<Webhook className="size-5" />} tone={hook.data.url ? "cyan" : "muted"} href="#webhook" />
        <Stat label={t("api.deliveries")} value={<span className="ltr-num">{deliveries.length}</span>} hint={deliveries.length === 0 ? t("bz.deliveries_none") : failedDeliveries > 0 ? t("rdz.api_k_failed", { n: failedDeliveries }) : t("rdz.api_k_all_ok")} icon={<Send className="size-5" />} tone={failedDeliveries > 0 ? "danger" : "muted"} href="#deliveries" />
        <Stat label={t("bz.api_logs")} value={<span className="ltr-num">{logs.length}</span>} hint={logs.length === 0 ? t("bz.api_no_logs") : failedCalls > 0 ? t("rdz.api_k_errors", { n: failedCalls }) : t("rdz.api_k_all_ok")} icon={<Activity className="size-5" />} tone={failedCalls > 0 ? "gold" : "muted"} href="#calls" />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section id="keys" className="scroll-mt-24" title={<span className="flex items-center gap-2"><KeyRound className="size-5 text-accent" aria-hidden />{t("api.keys")}</span>} actions={<span className="text-xs text-muted tabular-nums">{t("ubz.keys_used", { n: activeKeys, max: MAX_KEYS })}</span>}>
          <div className="space-y-4">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (activeKeys >= MAX_KEYS) return; a.run("k", () => post("/business/api-keys", { name: trimmed }), { onDone: (r) => { setCreated(r); setName(""); keys.mutate(); } }); }}>
              <div className="flex-1"><Input aria-label={t("api.key_name")} placeholder={t("api.key_name")} value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={60} required disabled={activeKeys >= MAX_KEYS} /></div><Button type="submit" loading={a.is("k")} disabled={trimmed.length < 2 || activeKeys >= MAX_KEYS}><Plus className="size-4" aria-hidden />{t("api.create")}</Button>
            </form>
            {activeKeys >= MAX_KEYS && <p className="text-xs text-gold">{t("ubz.keys_full")}</p>}
            {keys.data.items.length === 0 ? <EmptyState title={t("api.no_keys")} hint={t("rdz.api_no_keys_hint")} /> : (
              <ul className="divide-y divide-line">
                {keys.data.items.map((k: any) => (
                  <li key={k.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0"><p className="font-medium">{k.name} {k.revokedAt && <Badge tone="danger">{t("api.revoked")}</Badge>}</p><p className="ltr-num truncate text-xs text-muted">{k.prefix}… · {k.lastUsedAt ? fmtDateTime(k.lastUsedAt, locale) : t("api.never_used")}</p></div>
                    {!k.revokedAt && <Button size="sm" variant="danger" onClick={() => setRevoke(k)}>{t("api.revoke")}</Button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
        <Section id="webhook" className="scroll-mt-24" title={<span className="flex items-center gap-2"><Webhook className="size-5 text-cyan" aria-hidden />{t("api.webhook")}</span>} description={t("api.webhook_sub")}>
          <div className="space-y-4">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); a.run("w", () => put("/business/webhook", { url: (url ?? hook.data.url) || null }), { onDone: (r) => { setUrl(null); if (r.secret) setSecret(r.secret); else toast.success(t(!r.url ? "bz.webhook_removed" : r.unchanged ? "bz.webhook_unchanged" : "bz.webhook_saved")); hook.mutate(); } }); }}>
              <div className="flex-1"><Input aria-label="URL" ltr type="url" placeholder="https://example.com/webhooks/jr" value={url ?? hook.data.url ?? ""} onChange={(e) => setUrl(e.target.value)} /></div><Button type="submit" loading={a.is("w")}>{t("common.save")}</Button>
            </form>
            {hook.data.url && <p className="text-xs text-muted">{t("api.sig_note")}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" disabled={!hook.data.url} onClick={() => setRotate(true)}><RefreshCw className="size-4" aria-hidden />{t("bz.rotate_secret")}</Button>
              {!hook.data.url && <p className="text-xs text-muted">{t("bz.rotate_need_url")}</p>}
            </div>
          </div>
        </Section>
      </div>

      <div className="mt-6 space-y-6">
        <Section id="deliveries" className="scroll-mt-24" title={t("api.deliveries")} flush>
          {deliveries.length === 0 ? <div className="p-5"><EmptyState title={t("bz.deliveries_none")} hint={t("rdz.api_deliveries_hint")} /></div> : <Table bare stack label={t("api.deliveries")} head={[t("common.date"), t("api.event"), t("common.status"), { label: t("bz.http_status"), align: "end" }, { label: t("api.attempts"), align: "end" }]}>{deliveries.map((d: any) => <tr key={d.id}><Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(d.createdAt, locale)}</Td><Td label={t("api.event")} className="ltr-num">{d.event}</Td><Td label={t("common.status")}><StatusBadge status={d.status} />{d.lastError && <span className="mt-1 block max-w-xs truncate text-xs text-danger" title={d.lastError}>{d.lastError}</span>}</Td><Td label={t("bz.http_status")} num className="text-muted">{d.lastStatusCode ?? "—"}</Td><Td label={t("api.attempts")} num>{d.attempts}</Td></tr>)}</Table>}
        </Section>
        <Section id="calls" className="scroll-mt-24" title={t("bz.api_logs")} flush>
          {logs.length === 0 ? <div className="p-5"><EmptyState title={t("bz.api_no_logs")} hint={t("rdz.api_logs_hint")} /></div> : <Table bare stack label={t("bz.api_logs")} head={[t("common.date"), t("bz.api_method"), t("bz.api_path"), { label: t("common.status"), align: "end" }, { label: t("bz.api_latency"), align: "end" }]}>{logs.map((l: any) => <tr key={l.id}><Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(l.createdAt, locale)}</Td><Td label={t("bz.api_method")} className="ltr-num font-medium">{l.method}</Td><Td label={t("bz.api_path")} className="ltr-num break-all text-muted">{l.path}</Td><Td label={t("common.status")} num className={`font-semibold ${l.status >= 400 ? "text-danger" : "text-accent"}`}>{l.status}</Td><Td label={t("bz.api_latency")} num className="text-muted">{l.latencyMs != null ? t("bz.api_ms", { n: l.latencyMs }) : "—"}</Td></tr>)}</Table>}
        </Section>
        <Section title={t("api.docs")}>
          <div className="space-y-2 text-sm">
        <pre dir="ltr" className="overflow-x-auto rounded-xl bg-bg2 p-4 text-xs leading-relaxed text-cyan">{`curl -X POST $BASE/api/v1/jobs \\
  -H "X-API-Key: jrk_…" -H "Idempotency-Key: order-1001" \\
  -H "Content-Type: application/json" \\
  -d '{"service":"delivery_driver","quantity":1,"shipmentsPerDriver":30,"allowPartial":true,
       "vehicleType":"sedan","pickupCity":"riyadh","deliveryCity":"riyadh",
       "pickupAddress":"Warehouse 3, Al Malaz",
       "startsAt":"2026-12-01T05:00:00Z",
       "shipments":[
         {"recipientType":"consumer","recipientName":"Mona Ali","recipientPhone":"0555555555",
          "address":"King Fahd Rd 120, Riyadh","contents":"Clothes","externalRef":"ORD-1001",
          "codCents":12050},
         ${b2b ? '{"recipientType":"business","recipientName":"Al Noor Pharmacy"' : '{"recipientName":"Sara Alharbi"'},"recipientPhone":"0501234567",
          "address":"Olaya St, Building 8, Riyadh","notes":"Gate 2","externalRef":"ORD-1002"}]}'
# "quantity" is ignored when shipments[] is sent: drivers = ceil(shipments / shipmentsPerDriver); price = shipments x unit price
# "codCents" (optional, integer halalas, 0-10000000) = cash the driver collects from the recipient on delivery: 12050 = SAR 120.50

# GET /api/v1/jobs · GET /api/v1/jobs/{id} · GET /api/v1/jobs/{id}/events
# Per-parcel status for your order system:
curl $BASE/api/v1/jobs/{id}/shipments -H "X-API-Key: jrk_…"
# → {"data":[{"id":"…","code":"JR-000012-001","externalRef":"ORD-1001","recipientType":"consumer",
#             "status":"delivered","deliveredAt":"…","proofType":"otp","failReason":null,…}]}

# Webhook events (signed like the others)
# shipment_delivered → {"event":"shipment_delivered","shipment":{"id":"…","code":"JR-000012-001","externalRef":"ORD-1001","reason":null}}
# shipment_failed    → {"event":"shipment_failed","shipment":{"id":"…","code":"JR-000012-002","externalRef":"ORD-1002","reason":"refused"}}`}</pre>
          <p><span className="font-medium">{t("bz.api_fields_label")}:</span> <code dir="ltr" className="text-xs text-cyan">service, quantity, pickupCity, deliveryCity, pickupAddress, startsAt, shipments[] (delivery) | deliveryAddress (cars)</code></p>
          <p className="text-muted">{t("bs.api_shipments_note")}</p>
          {!b2b && <p data-testid="api-b2b-off-doc" className="rounded-xl border border-gold/40 bg-gold/10 p-3 text-gold"><span className="font-medium">{t("jf2.api_b2b_title")}:</span> {t("jf2.api_b2b_off")}</p>}
          <p data-testid="api-cod-doc"><span className="font-medium">{t("fob.api_cod_title")}:</span> <code dir="ltr" className="text-xs text-cyan">shipments[].codCents (integer halalas, 0 – 10000000)</code></p>
          <p className="text-muted">{t("fob.api_cod_note")}</p>
          <h3 className="pt-2 font-semibold" id="api-details-later">{t("pb.api_later_title")}</h3>
          <p className="text-muted">{t("pb.api_later_note")}</p>
          <pre dir="ltr" aria-labelledby="api-details-later" className="overflow-x-auto rounded-xl bg-bg2 p-4 text-xs leading-relaxed text-cyan">{`curl -X POST $BASE/api/v1/jobs \\
  -H "X-API-Key: jrk_…" -H "Idempotency-Key: order-1002" -H "Content-Type: application/json" \\
  -d '{"service":"delivery_driver","shipmentsPerDriver":30,"vehicleType":"sedan",
       "pickupCity":"riyadh","deliveryCity":"riyadh","pickupAddress":"Warehouse 3, Al Malaz",
       "startsAt":"2026-12-01T05:00:00Z",
       "detailsLater":true,"shipmentCount":40,
       "shipments":[{"recipientName":"Mona Ali","recipientPhone":"0555555555","address":"King Fahd Rd 120, Riyadh","externalRef":"ORD-1001"}]}'
# → 40 parcels: the 1 above with its details + 39 blank placeholders (details to follow).
# "shipments":[] with "shipmentCount":40 books 40 blank parcels. Price and drivers follow the count (40 x unit price).
# Anything you do send is still validated (name >= 2 chars, valid Saudi mobile or +E.164, address >= 5 chars).`}</pre>
          <p className="text-muted">{t("pb.api_later_complete")}</p>
          <p><span className="font-medium">{t("pb.api_later_fields")}:</span> <code dir="ltr" className="text-xs text-cyan">detailsLater (boolean), shipmentCount (1-2000)</code></p>
          <p className="text-muted">{t("bz.api_idem")}</p>
          </div>
        </Section>
      </div>
      <Modal open={rotate} busy={a.is("rot")} onClose={() => setRotate(false)} title={t("bz.rotate_title")} footer={<><Button variant="ghost" onClick={() => setRotate(false)}>{t("common.cancel")}</Button><Button variant="danger" loading={a.is("rot")} onClick={() => a.run("rot", () => post("/business/webhook/rotate-secret"), { onDone: (r) => { setRotate(false); setSecret(r.secret); hook.mutate(); } })}>{t("bz.rotate_secret")}</Button></>}>
        <Notice tone="warn">{t("bz.rotate_note")}</Notice>
      </Modal>
      <Modal open={!!revoke} onClose={() => setRevoke(null)} busy={a.any} title={t("ubz.revoke_title")} footer={<><Button variant="ghost" disabled={a.any} onClick={() => setRevoke(null)}>{t("common.cancel")}</Button><Button variant="danger" loading={a.is("rv")} onClick={() => a.run("rv", () => post(`/business/api-keys/${revoke.id}/revoke`), { success: "api.revoked_ok", onDone: () => { setRevoke(null); keys.mutate(); } })}>{t("api.revoke")}</Button></>}>
        <Notice tone="warn">{t("ubz.revoke_body", { name: revoke?.name ?? "" })}</Notice>
      </Modal>
      <Modal open={!!created} persistent onClose={() => setCreated(null)} title={t("api.key_created")} footer={<Button onClick={() => setCreated(null)}>{t("common.done")}</Button>}>
        <Notice tone="warn">{t("api.key_once")}</Notice><div className="flex items-center gap-2 rounded-xl bg-bg2 p-3"><code dir="ltr" className="flex-1 break-all text-xs text-accent">{created?.key}</code><Button size="sm" variant="secondary" aria-label={t("ubz.copy")} onClick={() => copy(created.key)}><Copy className="size-4" aria-hidden /></Button></div>
      </Modal>
      <Modal open={!!secret} persistent onClose={() => setSecret(null)} title={t("api.secret_created")} footer={<Button onClick={() => setSecret(null)}>{t("common.done")}</Button>}>
        <Notice tone="warn">{t("api.key_once")}</Notice><div className="flex items-center gap-2 rounded-xl bg-bg2 p-3"><code dir="ltr" className="flex-1 break-all text-xs text-accent">{secret}</code><Button size="sm" variant="secondary" aria-label={t("ubz.copy")} onClick={() => copy(secret!)}><Copy className="size-4" aria-hidden /></Button></div>
      </Modal>
    </>
  );
}
