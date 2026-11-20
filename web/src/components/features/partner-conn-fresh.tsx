"use client";
import { useState } from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import { Button, Card, Notice, errText } from "@/components/ui";
import { ApiError, post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import type { Provider } from "./business-shipments-partner";
import { FASTCOO_ORDER_SUFFIX, connApi, urlCarriesToken, type ConnScope, type FreshView } from "./partner-conn-lib";
import { CopyBox, ManualSetup, providerName, useBeforeUnloadWarning } from "./partner-conn-parts";

export type { FreshView };

/**
 * Shown once after a connection is created or its credentials rotated. Nothing here can be retrieved again (JR keeps fingerprints only), so
 * the card stays until the user says they saved it. Carrier systems (Omniful) get base URL + API key + client ID + client secret; systems that
 * cannot send headers (Shipox, Fastcoo) get the full webhook address, which carries the token; the others get URL + token (+ automatic set-up).
 */
export function FreshTokenCard({ fresh, provider, scope, onDone, onChanged, doneLabel }: { fresh: FreshView; provider: Provider | undefined; scope: Pick<ConnScope, "apiBase">; onDone: () => void; onChanged: () => void; doneLabel?: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false); const [connected, setConnected] = useState(false); const [problem, setProblem] = useState<string | null>(null);
  const name = providerName(t, fresh.conn.provider, fresh.conn.providerLabel);
  const { creds } = fresh;
  const canAuto = !!provider?.capabilities.registerWebhook && !!creds.webhookUrl;
  const inUrl = urlCarriesToken(creds);
  useBeforeUnloadWarning(!connected, t("intg.leave_warning"));

  const auto = async () => {
    setBusy(true); setProblem(null);
    try { await post(connApi(scope, fresh.conn.id, "/register-webhook")); setConnected(true); onChanged(); }
    catch (e) { setProblem(`${errText(e, t)}${e instanceof ApiError && e.message && e.message !== e.code ? ` — ${e.message}` : ""}`); }
    finally { setBusy(false); }
  };

  const webhook = creds.webhookUrl && (inUrl ? (
    <div className="space-y-3" data-testid="fresh-webhook-url-auth">
      <p className="text-sm text-muted">{t("iv2.fresh_url_intro", { name })}</p>
      <CopyBox label={t("iv2.fresh_url_label")} value={creds.webhookUrl} testId="webhook-url" secret />
      <p className="text-xs text-muted">{t("iv2.fresh_url_secret")}</p>
      {fresh.conn.provider === "fastcoo" && <p className="text-xs text-muted">{t("iv2.fastcoo_suffix", { suffix: FASTCOO_ORDER_SUFFIX })}</p>}
    </div>
  ) : canAuto ? (
    <>
      <p className="text-sm text-muted">{t("intg.auto_intro", { name })}</p>
      <div><Button type="button" loading={busy} onClick={auto} data-testid="connect-auto">{t("intg.auto_button")}</Button></div>
      {problem && <Notice tone="danger" title={t("intg.auto_failed")}>{problem}</Notice>}
      <details className="rounded-xl border border-line p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("intg.manual_instead")}</summary>
        <div className="mt-3"><ManualSetup provider={provider} providerLabel={name} webhookUrl={creds.webhookUrl} token={creds.inboundToken} /></div>
      </details>
    </>
  ) : <ManualSetup provider={provider} providerLabel={name} webhookUrl={creds.webhookUrl} token={creds.inboundToken} />);

  return (
    <Card className="mb-6 space-y-4 border-gold/50" data-testid="fresh-token" role="region" aria-label={creds.carrier ? t("iv2.creds_once_title") : t("intg.token_once_title")}>
      <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="size-5 text-gold" aria-hidden />{fresh.kind === "created" ? t("intg.created_title", { name: fresh.conn.name }) : t("intg.rotated_title", { name: fresh.conn.name })}</h2>
      {connected ? (
        <Notice tone="success" title={t("intg.auto_done_title")}><span data-testid="auto-connected">{t("intg.auto_done", { name })}</span></Notice>
      ) : (
        <>
          {creds.carrier
            ? <Notice tone="warn" title={t("iv2.creds_once_title")}>{t("iv2.creds_once", { name })}</Notice>
            : <Notice tone="warn" title={t("intg.token_once_title")}>{t("intg.token_once")}</Notice>}
          {creds.carrier && (
            <div className="space-y-3" data-testid="fresh-carrier">
              <p className="text-sm text-muted">{t("iv2.carrier_fresh_intro", { name })}</p>
              <CopyBox label={t("iv2.carrier_base_url")} value={creds.carrier.baseUrl} testId="fresh-base-url" />
              <CopyBox label={t("iv2.carrier_api_key")} value={creds.carrier.apiKey} testId="fresh-api-key" secret />
              <div className="grid gap-3 sm:grid-cols-2">
                <CopyBox label={t("iv2.carrier_client_id")} value={creds.carrier.clientId} testId="fresh-client-id" />
                <CopyBox label={t("iv2.carrier_client_secret")} value={creds.carrier.clientSecret} testId="fresh-client-secret" secret />
              </div>
              <AuthModes name={name} />
            </div>
          )}
          {webhook}
        </>
      )}
      <div className="flex justify-end"><Button type="button" variant={connected ? "primary" : "secondary"} onClick={onDone} data-testid="token-saved">{connected ? <CheckCircle2 className="size-4" /> : null}{connected ? t("common.done") : doneLabel ?? t("intg.saved_it")}</Button></div>
    </Card>
  );
}

/** The two ways a carrier system can authenticate: the API key itself, or client ID + client secret exchanged for a short-lived token. */
export function AuthModes({ name }: { name: string }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-line p-3 text-sm" data-testid="carrier-auth-modes">
      <p className="font-medium">{t("iv2.auth_modes_title", { name })}</p>
      <ul className="mt-1.5 list-disc space-y-1 ps-5 text-muted">
        <li><code dir="ltr" className="text-xs text-cyan">api_key</code> {t("iv2.auth_mode_api_key")}</li>
        <li><code dir="ltr" className="text-xs text-cyan">access_token</code> {t("iv2.auth_mode_access_token")}</li>
      </ul>
      <p className="mt-1.5 text-xs text-muted">{t("iv2.auth_modes_same")}</p>
    </div>
  );
}
