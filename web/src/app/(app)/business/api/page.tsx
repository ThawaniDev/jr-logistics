"use client";
import { useState } from "react";
import { Copy, KeyRound, Plus, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, PageHeader, PageLoading, StatusBadge, Table, Td, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post, put } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

export default function ApiPage() {
  const { t, locale } = useI18n(); const a = useAction();
  const keys = useApi("/business/api-keys"); const hook = useApi("/business/webhook");
  const [name, setName] = useState(""); const [created, setCreated] = useState<any>(null); const [url, setUrl] = useState<string | null>(null); const [secret, setSecret] = useState<string | null>(null);
  if (keys.error) return <ErrorState error={keys.error} retry={() => keys.mutate()} />;
  if (!keys.data || !hook.data) return <PageLoading />;
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success(t("common.copied")));
  return (
    <>
      <PageHeader title={t("nav.api")} subtitle={t("api.sub")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="size-5 text-accent" />{t("api.keys")}</h2>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); a.run("k", () => post("/business/api-keys", { name }), { onDone: (r) => { setCreated(r); setName(""); keys.mutate(); } }); }}>
            <div className="flex-1"><Input aria-label={t("api.key_name")} placeholder={t("api.key_name")} value={name} onChange={(e) => setName(e.target.value)} minLength={2} required /></div><Button type="submit" loading={a.is("k")}><Plus className="size-4" />{t("api.create")}</Button>
          </form>
          {keys.data.items.length === 0 ? <EmptyState title={t("api.no_keys")} /> : (
            <ul className="divide-y divide-line">
              {keys.data.items.map((k: any) => (
                <li key={k.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div><p className="font-medium">{k.name} {k.revokedAt && <Badge tone="danger">{t("api.revoked")}</Badge>}</p><p className="ltr-num text-xs text-muted">{k.prefix}… · {k.lastUsedAt ? fmtDateTime(k.lastUsedAt, locale) : t("api.never_used")}</p></div>
                  {!k.revokedAt && <Button size="sm" variant="danger" onClick={() => a.run("r" + k.id, () => post(`/business/api-keys/${k.id}/revoke`), { success: "api.revoked_ok", onDone: () => keys.mutate() })}>{t("api.revoke")}</Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="space-y-4">
          <h2 className="flex items-center gap-2 font-semibold"><Webhook className="size-5 text-cyan" />{t("api.webhook")}</h2>
          <p className="text-sm text-muted">{t("api.webhook_sub")}</p>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); a.run("w", () => put("/business/webhook", { url: (url ?? hook.data.url) || null }), { onDone: (r) => { setSecret(r.secret ?? null); hook.mutate(); } }); }}>
            <div className="flex-1"><Input aria-label="URL" ltr type="url" placeholder="https://example.com/webhooks/jr" value={url ?? hook.data.url ?? ""} onChange={(e) => setUrl(e.target.value)} /></div><Button type="submit" loading={a.is("w")}>{t("common.save")}</Button>
          </form>
          {hook.data.url && <p className="text-xs text-muted">{t("api.sig_note")}</p>}
        </Card>
      </div>
      <Card className="mt-6 space-y-2 text-sm"><h3 className="font-semibold">{t("api.docs")}</h3>
        <pre dir="ltr" className="overflow-x-auto rounded-xl bg-bg2 p-4 text-xs leading-relaxed text-cyan">{`curl -X POST $BASE/api/v1/jobs \\
  -H "X-API-Key: jrk_…" -H "Idempotency-Key: order-1001" \\
  -H "Content-Type: application/json" \\
  -d '{"service":"delivery_driver","quantity":2,"shipmentsPerDriver":25,
       "vehicleType":"sedan","pickupCity":"riyadh","deliveryCity":"riyadh",
       "startsAt":"2026-12-01T05:00:00Z"}'
# GET /api/v1/jobs · GET /api/v1/jobs/{id} · GET /api/v1/jobs/{id}/events`}</pre></Card>
      {hook.data.deliveries?.length > 0 && <div className="mt-6"><h3 className="mb-3 font-semibold">{t("api.deliveries")}</h3><Table head={[t("common.date"), t("api.event"), t("common.status"), t("api.attempts")]}>{hook.data.deliveries.slice(0, 15).map((d: any) => <tr key={d.id}><Td className="text-muted">{fmtDateTime(d.createdAt, locale)}</Td><Td className="ltr-num">{d.event}</Td><Td><StatusBadge status={d.status} /></Td><Td className="tabular-nums">{d.attempts}</Td></tr>)}</Table></div>}
      <Modal open={!!created} onClose={() => setCreated(null)} title={t("api.key_created")} footer={<Button onClick={() => setCreated(null)}>{t("common.done")}</Button>}>
        <Notice tone="warn">{t("api.key_once")}</Notice><div className="flex items-center gap-2 rounded-xl bg-bg2 p-3"><code dir="ltr" className="flex-1 break-all text-xs text-accent">{created?.key}</code><Button size="sm" variant="secondary" onClick={() => copy(created.key)}><Copy className="size-4" /></Button></div>
      </Modal>
      <Modal open={!!secret} onClose={() => setSecret(null)} title={t("api.secret_created")} footer={<Button onClick={() => setSecret(null)}>{t("common.done")}</Button>}>
        <Notice tone="warn">{t("api.key_once")}</Notice><div className="flex items-center gap-2 rounded-xl bg-bg2 p-3"><code dir="ltr" className="flex-1 break-all text-xs text-accent">{secret}</code><Button size="sm" variant="secondary" onClick={() => copy(secret!)}><Copy className="size-4" /></Button></div>
      </Modal>
    </>
  );
}
