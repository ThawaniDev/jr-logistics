"use client";
import { useState } from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import { Button, Card, Notice, errText } from "@/components/ui";
import { ApiError, post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import type { Connection, Provider } from "@/components/features/business-shipments-partner";
import { ManualSetup, providerName, useBeforeUnloadWarning } from "./parts";

export interface Fresh { conn: Connection; token: string; webhookUrl: string; kind: "created" | "rotated" }

/** Shown once after a connection is created or its token rotated. The token is never retrievable again, so this stays on screen until the user says they have saved it. */
export function FreshTokenCard({ fresh, provider, onDone, onChanged }: { fresh: Fresh; provider: Provider | undefined; onDone: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false); const [connected, setConnected] = useState(false); const [problem, setProblem] = useState<string | null>(null);
  const name = providerName(t, fresh.conn.provider, fresh.conn.providerLabel);
  const canAuto = !!provider?.capabilities.registerWebhook;
  useBeforeUnloadWarning(!connected, t("intg.leave_warning"));

  const auto = async () => {
    setBusy(true); setProblem(null);
    try { await post(`/integrations/connections/${fresh.conn.id}/register-webhook`); setConnected(true); onChanged(); }
    catch (e) { setProblem(`${errText(e, t)}${e instanceof ApiError && e.message && e.message !== e.code ? ` — ${e.message}` : ""}`); }
    finally { setBusy(false); }
  };

  return (
    <Card className="mb-6 space-y-4 border-gold/50" data-testid="fresh-token" role="region" aria-label={t("intg.token_once_title")}>
      <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="size-5 text-gold" aria-hidden />{fresh.kind === "created" ? t("intg.created_title", { name: fresh.conn.name }) : t("intg.rotated_title", { name: fresh.conn.name })}</h2>
      {connected ? (
        <Notice tone="success" title={t("intg.auto_done_title")}><span data-testid="auto-connected">{t("intg.auto_done", { name })}</span></Notice>
      ) : (
        <>
          <Notice tone="warn" title={t("intg.token_once_title")}>{t("intg.token_once")}</Notice>
          {canAuto ? (
            <>
              <p className="text-sm text-muted">{t("intg.auto_intro", { name })}</p>
              <div><Button type="button" loading={busy} onClick={auto} data-testid="connect-auto">{t("intg.auto_button")}</Button></div>
              {problem && <Notice tone="danger" title={t("intg.auto_failed")}>{problem}</Notice>}
              <details className="rounded-xl border border-line p-3">
                <summary className="cursor-pointer text-sm font-medium">{t("intg.manual_instead")}</summary>
                <div className="mt-3"><ManualSetup provider={provider} providerLabel={name} webhookUrl={fresh.webhookUrl} token={fresh.token} /></div>
              </details>
            </>
          ) : <ManualSetup provider={provider} providerLabel={name} webhookUrl={fresh.webhookUrl} token={fresh.token} />}
        </>
      )}
      <div className="flex justify-end"><Button type="button" variant={connected ? "primary" : "secondary"} onClick={onDone} data-testid="token-saved">{connected ? <CheckCircle2 className="size-4" /> : null}{connected ? t("common.done") : t("intg.saved_it")}</Button></div>
    </Card>
  );
}
