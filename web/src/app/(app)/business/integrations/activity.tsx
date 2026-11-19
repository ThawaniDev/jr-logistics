"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, RotateCw, Search, Wrench } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Pagination, PageLoading, Segmented, errText, type Tone } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { providerName, tx, type Connection } from "@/components/features/business-shipments-partner";

const PAGE = 20;
interface Ev { id: string; direction: "in" | "out" | "lookup" | "test"; kind: string; outcome: "ok" | "ignored" | "error"; summary: string | null; externalId: string | null; shipmentId: string | null; requestId: string | null; createdAt: string }
const OUTCOME_TONE: Record<string, Tone> = { ok: "success", ignored: "neutral", error: "danger" };

/** Everything exchanged with the partner, newest first, in plain language. */
export function ActivityLog({ conn }: { conn: Connection }) {
  const { t, locale } = useI18n();
  const [outcome, setOutcome] = useState<"" | "ok" | "ignored" | "error">(""); const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE) }); if (outcome) qs.set("outcome", outcome);
  const { data, error, mutate } = useApi<{ items: Ev[]; page: number; pageSize: number; total: number }>(`/integrations/connections/${conn.id}/events?${qs}`, { keepPreviousData: true, refreshInterval: 30000 });
  const name = providerName(t, conn.provider, conn.providerLabel);
  const dirLabel = (e: Ev) => {
    const kind = tx(t, `intg.kind_${e.kind}`, e.kind.replace(/_/g, " "));
    if (e.direction === "in") return t("intg.ev_in", { name, kind });
    if (e.direction === "out") return t("intg.ev_out", { name, kind });
    return t(e.direction === "lookup" ? "intg.ev_lookup" : "intg.ev_test", { name });
  };
  const Icon = (d: Ev["direction"]) => (d === "in" ? ArrowDownToLine : d === "out" ? ArrowUpFromLine : d === "lookup" ? Search : Wrench);
  return (
    <div className="space-y-4">
      <Segmented label={t("intg.filter_outcome")} value={outcome} onChange={(k) => { setOutcome(k as typeof outcome); setPage(1); }} options={(["", "ok", "ignored", "error"] as const).map((k) => ({ key: k, label: k ? t(`intg.out_${k}`) : t("common.all") }))} />
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : data.items.length === 0 ? (
        <EmptyState title={outcome ? t("common.no_results") : t("intg.no_activity")} hint={outcome ? undefined : t("intg.no_activity_hint")} />
      ) : (
        <>
          <ul className="divide-y divide-line rounded-card border border-line" data-testid="activity-list">
            {data.items.map((e) => { const I = Icon(e.direction); return (
              <li key={e.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <I className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{dirLabel(e)}</span><Badge tone={OUTCOME_TONE[e.outcome] ?? "neutral"}>{t(`intg.out_${e.outcome}`)}</Badge></div>
                  {e.summary && <p className="mt-0.5 break-words text-xs text-muted" dir="auto">{e.summary}</p>}
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                    <span>{fmtDateTime(e.createdAt, locale)}</span>
                    {e.externalId && <span className="ltr-num" dir="ltr">{e.externalId}</span>}
                    {e.requestId && <Link href={`/business/requests/${e.requestId}`} className="font-medium text-cyan hover:underline">{t("intg.open_request")}</Link>}
                  </p>
                </div>
              </li>); })}
          </ul>
          <p className="text-xs text-muted">{t("intg.activity_total", { n: fmtNum(data.total, locale) })}</p>
          <Pagination page={data.page} total={data.total} pageSize={PAGE} onPage={setPage} />
        </>
      )}
    </div>
  );
}

interface Problem { id: string; action: string; status: "dead" | "retry_wait" | "skipped"; attempts: number; lastError: string | null; code: string | null; createdAt: string }
export interface OutboxData { counts: Record<string, number>; problems: Problem[] }

/** Updates JR tried to send to the partner and could not. */
export function FailedUpdates({ conn, data, error, reload }: { conn: Connection; data: OutboxData | undefined; error: unknown; reload: () => void }) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const name = providerName(t, conn.provider, conn.providerLabel);
  const retry = async (id: string) => {
    setBusy(id);
    try { await post(`/integrations/outbox/${id}/retry`); toast.success(t("intg.retry_queued")); reload(); }
    catch (e) { toast.error(errText(e, t)); }
    finally { setBusy(null); }
  };
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <PageLoading />;
  const sent = data.counts.sent ?? 0; const waiting = (data.counts.queued ?? 0) + (data.counts.retry_wait ?? 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="success">{t("intg.ob_sent", { n: fmtNum(sent, locale) })}</Badge>
        {waiting > 0 && <Badge tone="warn">{t("intg.ob_waiting", { n: fmtNum(waiting, locale) })}</Badge>}
        {(data.counts.dead ?? 0) > 0 && <Badge tone="danger">{t("intg.ob_dead", { n: fmtNum(data.counts.dead, locale) })}</Badge>}
      </div>
      {data.problems.length === 0 ? <EmptyState title={t("intg.ob_none")} hint={t("intg.ob_none_hint", { name })} /> : (
        <ul className="divide-y divide-line rounded-card border border-line" data-testid="failed-updates">
          {data.problems.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t(`intg.act_${p.action}`, { name })}</span>
                  {p.code && <span className="ltr-num text-xs text-muted" dir="ltr">{p.code}</span>}
                  <Badge tone={p.status === "dead" ? "danger" : p.status === "retry_wait" ? "warn" : "neutral"}>{t(`intg.obs_${p.status}`)}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted">{t("intg.ob_tries", { n: fmtNum(p.attempts, locale) })} · {fmtDateTime(p.createdAt, locale)}</p>
                {p.lastError && <p className="mt-0.5 break-words text-xs text-muted" dir="auto">{p.lastError}</p>}
              </div>
              {p.status !== "retry_wait" && <Button size="sm" variant="secondary" loading={busy === p.id} onClick={() => retry(p.id)}><RotateCw className="size-4" />{t("intg.retry")}</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
