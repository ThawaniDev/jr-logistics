"use client";
import Link from "next/link";
import { Plug } from "lucide-react";
import { Badge, EmptyState, ErrorState, Notice, Section, Skeleton, Table, Td } from "@/components/ui";
import { STATUS_COLOR, TrendChart, formatValue } from "@/components/reports";
import { useApi } from "@/components/ui/data";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useCompany } from "./admin-companies-ctx";
import { KpiTile } from "./admin-company-detail-kpis";

interface Data {
  partners: Array<{ id: string; provider: string; providerLabel: string; name: string; status: string; lastOkAt: string | null; lastError: string | null; lastEventAt: string | null; events30: { ok: number; ignored: number; error: number }; outbox: { queued: number; retry_wait: number; dead: number } }> | null;
  apiKeys: Array<{ id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; revokedAt: string | null; createdAt: string; calls: number; errors: number }> | null;
  webhook: { configured: boolean; host: string | null; hasSecret: boolean; delivered: number; failed: number; waiting: number; failureRate: number | null; avgAttempts: number; lastDeliveredAt: string | null; series: Array<{ t: string; ok: number; failed: number }>;
    recent: Array<{ id: string; event: string; status: string; attempts: number; statusCode: number | null; error: string | null; createdAt: string; request: { id: string; ref: string } | null }> } | null;
  api: { calls: number; clientErrors: number; serverErrors: number; errorRate: number | null; p50Ms: number | null; p95Ms: number | null; lastCallAt: string | null; series: Array<{ t: string; calls: number; errors: number }>; paths: Array<{ method: string; path: string; calls: number; errors: number }> } | null;
  hidden: string[];
}

/** Integrations tab: warehouse-system connections, API keys (last used), the outbound webhook with its 30-day delivery log, and API usage with errors and latency. */
export function CompanyIntegrations() {
  const { t, locale } = useI18n(); const c = useCompany();
  const { data, error, mutate } = useApi<Data>(`/admin/companies/${c.id}/integrations`, { shouldRetryOnError: false });
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;
  const w = data.webhook, a = data.api;
  const when = (v: string | null) => (v ? fmtDateTime(v, locale) : t("dv3.never"));
  const pct = (v: number | null) => formatValue(v, "percent", locale);
  return (
    <div className="space-y-5" data-testid="dv3-integrations">
      {data.hidden.length > 0 && <Notice tone="info">{t("dv3.hidden_parts", { parts: data.hidden.map((h) => t(`dv3.hid_${h}`)).join(", ") })}</Notice>}
      {data.partners && (
        <Section title={t("dv3.int_partners")} description={t("dv3.int_partners_sub")} flush actions={<Link href="/admin/integrations" className="text-sm text-accent hover:underline">{t("dv3.int_open_all")}</Link>}>
          {data.partners.length === 0 ? <div className="p-5"><EmptyState title={t("dv3.int_no_partners")} hint={t("dv3.int_no_partners_hint")} icon={<Plug className="size-9" aria-hidden />} /></div> : (
            <Table bare stack label={t("dv3.int_partners")} head={[t("dv3.int_system"), t("common.status"), t("dv3.int_health"), { label: t("dv3.int_events"), align: "end" }, { label: t("dv3.int_stuck"), align: "end" }]}>
              {data.partners.map((p) => (
                <tr key={p.id} data-testid="dv3-partner-row">
                  <Td label={t("dv3.int_system")}><div className="min-w-0"><p className="truncate font-medium">{p.name}</p><p className="text-xs text-muted">{p.providerLabel}</p></div></Td>
                  <Td label={t("common.status")}><Badge tone={p.status === "active" ? "success" : "neutral"}>{t(`dv3.int_st_${p.status}`)}</Badge></Td>
                  <Td label={t("dv3.int_health")}>{p.lastError ? <p className="max-w-xs break-words text-xs text-danger" data-testid="dv3-partner-error">{p.lastError}</p> : <p className="text-xs text-muted">{t("dv3.int_last_ok", { when: when(p.lastOkAt) })}</p>}</Td>
                  <Td label={t("dv3.int_events")} align="end"><span className="ltr-num tabular-nums text-xs">{t("dv3.int_events_n", { ok: fmtNum(p.events30.ok, locale), ign: fmtNum(p.events30.ignored, locale), err: fmtNum(p.events30.error, locale) })}</span></Td>
                  <Td label={t("dv3.int_stuck")} num className={p.outbox.dead + p.outbox.retry_wait > 0 ? "text-danger" : "text-muted"}>{fmtNum(p.outbox.queued + p.outbox.retry_wait + p.outbox.dead, locale)}</Td>
                </tr>))}
            </Table>)}
        </Section>)}

      {data.apiKeys && (
        <Section title={t("dv3.int_keys")} description={t("dv3.int_keys_sub")} flush>
          {data.apiKeys.length === 0 ? <div className="p-5"><EmptyState title={t("dv3.int_no_keys")} /></div> : (
            <Table bare stack label={t("dv3.int_keys")} head={[t("common.name"), t("dv3.int_prefix"), t("dv3.int_scopes"), t("dv3.int_last_used"), { label: t("dv3.int_calls"), align: "end" }, t("common.status")]}>
              {data.apiKeys.map((k) => (
                <tr key={k.id} data-testid="dv3-key-row">
                  <Td label={t("common.name")} className="font-medium">{k.name}</Td>
                  <Td label={t("dv3.int_prefix")}><code dir="ltr" className="ltr-num text-xs">{k.prefix}…</code></Td>
                  <Td label={t("dv3.int_scopes")} className="text-xs text-muted"><span dir="ltr" className="ltr-num">{k.scopes.join(", ")}</span></Td>
                  <Td label={t("dv3.int_last_used")} className="whitespace-nowrap text-muted">{when(k.lastUsedAt)}</Td>
                  <Td label={t("dv3.int_calls")} num>{fmtNum(k.calls, locale)}{k.errors > 0 && <span className="block text-xs text-danger">{t("dv3.int_errors_n", { n: fmtNum(k.errors, locale) })}</span>}</Td>
                  <Td label={t("common.status")}>{k.revokedAt ? <Badge tone="neutral">{t("dv3.int_revoked")}</Badge> : <Badge tone="success">{t("status.active")}</Badge>}</Td>
                </tr>))}
            </Table>)}
        </Section>)}

      {w && (
        <Section title={t("dv3.int_webhook")} description={w.configured ? t("dv3.int_webhook_to", { host: w.host ?? "—" }) : t("dv3.int_webhook_off")}>
          {!w.configured && w.delivered + w.failed + w.waiting === 0 ? <p className="text-sm text-muted">{t("dv3.int_webhook_none")}</p> : (
            <div className="space-y-4" data-testid="dv3-webhook">
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
                <KpiTile id="w-ok" label={t("dv3.int_delivered")} def={t("dv3.int_d_delivered")} value={fmtNum(w.delivered, locale)} hint={t("dv3.int_last_ok", { when: when(w.lastDeliveredAt) })} />
                <KpiTile id="w-failed" label={t("dv3.int_failed")} def={t("dv3.int_d_failed")} value={fmtNum(w.failed, locale)} tone={w.failed > 0 ? "danger" : undefined} />
                <KpiTile id="w-rate" label={t("dv3.int_failure_rate")} def={t("dv3.int_d_failure_rate")} value={pct(w.failureRate)} tone={(w.failureRate ?? 0) >= 0.2 ? "danger" : undefined} hint={t("dv3.int_attempts_avg", { n: formatValue(w.avgAttempts, "rate", locale) })} />
                <KpiTile id="w-wait" label={t("dv3.int_waiting")} def={t("dv3.int_d_waiting")} value={fmtNum(w.waiting, locale)} />
              </div>
              <TrendChart testId="dv3-chart-webhook" title={t("dv3.int_webhook_chart")} data={w.series} bucket="day" height={200} stacked
                series={[{ key: "ok", label: t("dv3.int_delivered"), kind: "bar", color: STATUS_COLOR.delivered }, { key: "failed", label: t("dv3.int_failed"), kind: "bar", color: STATUS_COLOR.failed }]} />
              {w.recent.length > 0 && (
                <Table stack dense label={t("dv3.int_recent_failures")} head={[t("dv3.int_event"), t("common.status"), { label: t("dv3.int_attempts"), align: "end" }, t("dv3.int_code"), t("dv3.int_error"), t("dv3.col_order"), t("common.date")]}>
                  {w.recent.map((f) => (
                    <tr key={f.id} data-testid="dv3-webhook-failure">
                      <Td label={t("dv3.int_event")} className="font-medium"><span dir="ltr" className="ltr-num">{f.event}</span></Td>
                      <Td label={t("common.status")}><Badge tone={f.status === "dead_letter" ? "danger" : "warn"}>{t(`status.${f.status}`)}</Badge></Td>
                      <Td label={t("dv3.int_attempts")} num>{f.attempts}</Td>
                      <Td label={t("dv3.int_code")} className="ltr-num">{f.statusCode ?? "—"}</Td>
                      <Td label={t("dv3.int_error")} className="max-w-xs break-words text-xs text-muted">{f.error ?? "—"}</Td>
                      <Td label={t("dv3.col_order")}>{f.request ? <Link href={`/admin/requests/${f.request.id}`} className="ltr-num text-accent hover:underline">{f.request.ref}</Link> : "—"}</Td>
                      <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(f.createdAt, locale)}</Td>
                    </tr>))}
                </Table>)}
            </div>)}
        </Section>)}

      {a && (
        <Section title={t("dv3.int_api")} description={t("dv3.int_api_sub")}>
          {a.calls === 0 ? <p className="text-sm text-muted" data-testid="dv3-api-none">{t("dv3.int_api_none")}</p> : (
            <div className="space-y-4" data-testid="dv3-api">
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
                <KpiTile id="a-calls" label={t("dv3.int_calls")} def={t("dv3.int_d_calls")} value={fmtNum(a.calls, locale)} hint={t("dv3.int_last_call", { when: when(a.lastCallAt) })} />
                <KpiTile id="a-errors" label={t("dv3.int_error_rate")} def={t("dv3.int_d_error_rate")} value={pct(a.errorRate)} tone={(a.errorRate ?? 0) >= 0.1 ? "danger" : undefined} hint={t("dv3.int_4xx_5xx", { c: fmtNum(a.clientErrors, locale), s: fmtNum(a.serverErrors, locale) })} />
                <KpiTile id="a-p50" label={t("dv3.int_p50")} def={t("dv3.int_d_latency")} value={a.p50Ms == null ? "—" : `${fmtNum(a.p50Ms, locale)} ms`} />
                <KpiTile id="a-p95" label={t("dv3.int_p95")} def={t("dv3.int_d_latency")} value={a.p95Ms == null ? "—" : `${fmtNum(a.p95Ms, locale)} ms`} />
              </div>
              <TrendChart testId="dv3-chart-api" title={t("dv3.int_api_chart")} data={a.series} bucket="day" height={200}
                series={[{ key: "calls", label: t("dv3.int_calls"), kind: "bar" }, { key: "errors", label: t("dv3.int_errors"), kind: "line", color: STATUS_COLOR.failed }]} />
              <Table stack dense label={t("dv3.int_paths")} head={[t("dv3.int_path"), { label: t("dv3.int_calls"), align: "end" }, { label: t("dv3.int_errors"), align: "end" }]}>
                {a.paths.map((p) => (
                  <tr key={`${p.method} ${p.path}`}><Td label={t("dv3.int_path")}><span dir="ltr" className="ltr-num break-all text-xs"><span className="font-semibold">{p.method}</span> {p.path}</span></Td><Td label={t("dv3.int_calls")} num>{fmtNum(p.calls, locale)}</Td><Td label={t("dv3.int_errors")} num className={p.errors ? "text-danger" : "text-muted"}>{fmtNum(p.errors, locale)}</Td></tr>))}
              </Table>
            </div>)}
        </Section>)}
    </div>
  );
}
