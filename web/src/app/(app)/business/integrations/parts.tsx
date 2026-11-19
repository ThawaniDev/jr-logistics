"use client";
import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Copy, ExternalLink, Info, Loader2, TriangleAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button, Checkbox, Input, Notice, Section as UiSection, Select, errText } from "@/components/ui";
import { ApiError, post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { providerName, tx, type Connection, type Provider, type ProviderField } from "@/components/features/business-shipments-partner";

/** Building blocks of the Integrations page: generated form, token panel, health, test result, switch. */
export { providerName };
export type TFn = (k: string, v?: Record<string, string | number>) => string;

export const providerDesc = (t: TFn, key: string, fallback: string) => tx(t, `intg.provider.${key}.desc`, fallback);
/** Honest, plain-language limits of a partner's API; empty when we have none to state. */
export const providerLimits = (t: TFn, key: string) => tx(t, `intg.provider.${key}.limits`, "");
const fieldLabel = (t: TFn, p: string, f: ProviderField) => tx(t, `intg.field.${p}.${f.key}`, f.label);
const fieldHelp = (t: TFn, p: string, f: ProviderField) => tx(t, `intg.field.${p}.${f.key}_help`, f.help ?? "");

// ───────── copy box ─────────
export function CopyBox({ label, value, testId }: { label: string; value: string; testId?: string }) {
  const { t } = useI18n();
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">{label}</p>
      <div className="flex items-center gap-2 rounded-xl bg-bg2 p-3">
        <code dir="ltr" data-testid={testId} className="min-w-0 flex-1 break-all text-start text-xs text-accent">{value}</code>
        <Button type="button" size="sm" variant="secondary" aria-label={`${t("intg.copy")}: ${label}`} onClick={() => navigator.clipboard.writeText(value).then(() => toast.success(t("common.copied")))}><Copy className="size-4" /></Button>
      </div>
    </div>
  );
}

// ───────── manual setup (URL + token + header names) ─────────
export function ManualSetup({ provider, providerLabel, webhookUrl, token, prefix, onRotate, rotating }: { provider: Provider | undefined; providerLabel: string; webhookUrl: string; token: string | null; prefix?: string | null; onRotate?: () => void; rotating?: boolean }) {
  const { t } = useI18n();
  const headers = provider?.inboundTokenHeaders ?? [];
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t("intg.manual_intro", { name: providerLabel })}</p>
      <ol className="list-decimal space-y-1 ps-5 text-sm text-muted">
        <li>{t("intg.manual_s1", { name: providerLabel })}</li>
        <li>{t("intg.manual_s2")}</li>
        <li>{t("intg.manual_s3")}</li>
      </ol>
      <CopyBox label={t("intg.webhook_url")} value={webhookUrl} testId="webhook-url" />
      {token ? <CopyBox label={t("intg.token")} value={token} testId="inbound-token" /> : (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">{t("intg.token")}</p>
          <p className="text-sm"><code dir="ltr" className="text-xs">{prefix ? `${prefix}…` : "—"}</code> <span className="text-xs text-muted">{t("intg.token_hidden")}</span></p>
          {onRotate && <Button type="button" size="sm" variant="secondary" className="mt-2" loading={rotating} onClick={onRotate}>{t("intg.token_new")}</Button>}
        </div>
      )}
      {headers.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">{t("intg.headers")}</p>
          <div className="flex flex-wrap gap-1.5" dir="ltr">{headers.map((h) => <code key={h} className="rounded-md bg-bg2 px-2 py-0.5 text-xs text-cyan">{h}</code>)}</div>
          <p className="mt-1 text-xs text-muted">{t("intg.headers_hint")}</p>
        </div>
      )}
    </div>
  );
}

// ───────── health ─────────
type Kind = "auth" | "unavailable" | "other";
/** The server stores the last failure as text; this maps it back to "key rejected" / "cannot reach" for the plain-language line. */
export function errorKindOf(msg: string): Kind {
  if (/rejected the credentials|unauthori[sz]ed|\b40[13]\b|api key/i.test(msg)) return "auth";
  if (/unavailable|cannot reach|did not answer|time ?out|network|ECONN|ENOTFOUND/i.test(msg)) return "unavailable";
  return "other";
}
export function Health({ c, compact }: { c: Connection; compact?: boolean }) {
  const { t, locale } = useI18n();
  const name = providerName(t, c.provider, c.providerLabel);
  let tone: "ok" | "bad" | "idle" = "idle"; let line: string;
  if (c.status === "disabled") line = t("intg.health_paused");
  else if (c.lastError) { tone = "bad"; line = t(`intg.health_${errorKindOf(c.lastError)}`, { name }); }
  else if (c.lastOkAt) { tone = "ok"; line = t("intg.health_ok", { time: fmtDateTime(c.lastOkAt, locale) }); }
  else line = t("intg.health_untested");
  const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" ? XCircle : Info;
  return (
    <div className="space-y-1.5 text-sm" data-testid="health">
      <p className={`flex items-start gap-2 ${tone === "ok" ? "text-accent" : tone === "bad" ? "text-danger" : "text-muted"}`}><Icon className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{line}</span></p>
      {c.status === "active" && c.lastError && c.lastOkAt && <p className="ps-6 text-xs text-muted">{t("intg.last_ok", { time: fmtDateTime(c.lastOkAt, locale) })}</p>}
      {!compact && c.status === "active" && c.lastError && <p className="ps-6 text-xs text-muted break-words" dir="auto"><span className="font-medium">{t("intg.tech_detail")}:</span> {c.lastError}</p>}
      {c.capabilities?.webhookIn && <p className="ps-6 text-xs text-muted">{c.lastEventAt ? t("intg.last_event", { time: fmtDateTime(c.lastEventAt, locale) }) : t("intg.no_events")}</p>}
    </div>
  );
}

// ───────── test connection ─────────
export interface TestOutcome { ok: boolean; message: string; kind?: string }
export function useTest(c: Connection, after: () => void) {
  const [busy, setBusy] = useState(false); const [result, setResult] = useState<TestOutcome | null>(null);
  const { t } = useI18n();
  const run = async () => {
    setBusy(true);
    try { setResult(await post<TestOutcome>(`/integrations/connections/${c.id}/test`)); after(); }
    catch (e) { setResult(null); toast.error(errText(e, t)); }
    finally { setBusy(false); }
  };
  return { busy, result, run };
}
export function TestResult({ r, name }: { r: TestOutcome; name: string }) {
  const { t } = useI18n();
  if (r.ok) return <Notice tone="success" title={t("intg.test_ok_title")}><span data-testid="test-result">{t("intg.test_ok", { name })}</span></Notice>;
  const kind = ["auth", "unavailable", "config", "rejected", "not_found"].includes(r.kind ?? "") ? r.kind! : "other";
  return (
    <Notice tone="danger" title={t("intg.test_bad_title")}>
      <span data-testid="test-result">{t(`intg.test_${kind}`, { name })}</span>
      {r.message && <span className="mt-1 block break-words text-xs text-muted" dir="auto">{t("intg.tech_detail")}: {r.message}</span>}
    </Notice>
  );
}

// ───────── switch ─────────
export function Toggle({ checked, onChange, label, hint, warn, disabled, busy, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; warn?: string; disabled?: boolean; busy?: boolean; testId?: string }) {
  const id = `sw-${testId ?? label.replace(/\W+/g, "").slice(0, 24)}`;
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p id={id} className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
        {warn && <p className="mt-1 flex items-start gap-1.5 text-xs text-gold"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />{warn}</p>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={id} data-testid={testId} disabled={disabled || busy} onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition disabled:opacity-60 ${checked ? "border-accent bg-accent" : "border-line bg-bg2"}`}>
        <span className={`absolute start-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5 rtl:-translate-x-5" : ""}`}>{busy && <Loader2 className="size-3 animate-spin text-accent-ink" aria-hidden />}</span>
      </button>
    </div>
  );
}

// ───────── generated form ─────────
export type FormValues = { cfg: Record<string, string | boolean>; sec: Record<string, string> };
export const initialValues = (p: Provider, c?: Connection): FormValues => ({
  cfg: Object.fromEntries(p.fields.filter((f) => !f.secret).map((f) => [f.key, c?.config?.[f.key] ?? f.default ?? (f.type === "boolean" ? false : "")])) as Record<string, string | boolean>,
  sec: {},
});
const validUrl = (v: string) => { try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; } };

/** Client-side check with the same rules the server applies; returns { fieldKey → message }. */
export function validateForm(t: TFn, p: Provider, v: FormValues, c?: Connection): Record<string, string> {
  const e: Record<string, string> = {};
  for (const f of p.fields) {
    if (f.secret) { if (f.required && !v.sec[f.key]?.trim() && !c?.hasSecret?.[f.key]) e[f.key] = t("val.required"); continue; }
    if (f.type === "boolean") continue;
    const val = String(v.cfg[f.key] ?? "").trim();
    if (f.required && !val) e[f.key] = t("val.required");
    else if (val && f.type === "url" && !validUrl(val)) e[f.key] = t("intg.val_url");
    else if (val.length > 300) e[f.key] = t("bs.val_too_long");
  }
  return e;
}
export function toPayload(p: Provider, v: FormValues) {
  const config: Record<string, string | boolean> = {}; const secrets: Record<string, string> = {};
  for (const f of p.fields) {
    if (f.secret) { const s = v.sec[f.key]?.trim(); if (s) secrets[f.key] = s; }
    else if (f.type === "boolean") config[f.key] = !!v.cfg[f.key];
    else config[f.key] = String(v.cfg[f.key] ?? "").trim();
  }
  return { config, secrets };
}
/** Server validation names the offending field in details.field; map it onto our field keys. */
export function serverFieldError(e: unknown, p: Provider, t: TFn): { field: string; message: string } | null {
  if (!(e instanceof ApiError) || e.code !== "VALIDATION") return null;
  const field = String(e.details.field ?? "");
  const f = p.fields.find((x) => x.key === field) ?? (/url/i.test(field) ? p.fields.find((x) => x.type === "url") : undefined);
  if (!f) return null;
  return { field: f.key, message: /required/i.test(e.message) ? t("val.required") : f.type === "url" ? t("intg.val_url_server") : e.message };
}

export function FieldsForm({ provider, values, onChange, errors, connection }: { provider: Provider; values: FormValues; onChange: (v: FormValues) => void; errors: Record<string, string>; connection?: Connection }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      {provider.fields.map((f) => {
        const label = fieldLabel(t, provider.key, f); const help = fieldHelp(t, provider.key, f);
        if (f.type === "boolean") return <Checkbox key={f.key} checked={!!values.cfg[f.key]} onChange={(e) => onChange({ ...values, cfg: { ...values.cfg, [f.key]: e.target.checked } })} label={<><span className="font-medium text-ink">{label}</span>{help && <span className="mt-0.5 block text-xs">{help}</span>}</>} />;
        if (f.type === "select") return <Select key={f.key} label={label} hint={help || undefined} error={errors[f.key]} required={f.required} value={String(values.cfg[f.key] ?? "")} options={f.options ?? []} onChange={(e) => onChange({ ...values, cfg: { ...values.cfg, [f.key]: e.target.value } })} />;
        if (f.secret || f.type === "password") {
          const saved = !!connection?.hasSecret?.[f.key];
          return <Input key={f.key} label={label} type="password" ltr autoComplete="new-password" spellCheck={false} required={f.required && !saved} error={errors[f.key]} data-testid={`field-${f.key}`}
            placeholder={saved ? t("intg.secret_saved") : f.placeholder} hint={saved ? `${help ? `${help} ` : ""}${t("intg.secret_keep")}` : help || undefined}
            value={values.sec[f.key] ?? ""} onChange={(e) => onChange({ ...values, sec: { ...values.sec, [f.key]: e.target.value } })} />;
        }
        return <Input key={f.key} label={label} type={f.type === "url" ? "url" : "text"} ltr={f.type === "url"} inputMode={f.type === "url" ? "url" : undefined} required={f.required} error={errors[f.key]} placeholder={f.placeholder} hint={help || undefined} data-testid={`field-${f.key}`}
          value={String(values.cfg[f.key] ?? "")} onChange={(e) => onChange({ ...values, cfg: { ...values.cfg, [f.key]: e.target.value } })} />;
      })}
    </div>
  );
}

// ───────── small shared bits ─────────
export function DocsLink({ href }: { href: string | null | undefined }) {
  const { t } = useI18n();
  if (!href || !/^https:\/\//i.test(href)) return null;
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-cyan hover:underline">{t("intg.docs")}<ExternalLink className="size-3.5 rtl:-scale-x-100" aria-hidden /></a>;
}

/** Plain-language info box about what a partner's API can and cannot do. */
export function LimitsBox({ providers }: { providers: Provider[] }) {
  const { t } = useI18n();
  const shown = providers.map((p) => ({ p, text: providerLimits(t, p.key) })).filter((x) => x.text);
  if (shown.length === 0) return null;
  return (
    <Notice tone="info" title={t("intg.limits_title")}>
      <div className="space-y-2">{shown.map(({ p, text }) => <p key={p.key} className="text-sm"><span className="font-semibold">{providerName(t, p.key, p.label)}: </span>{text}</p>)}</div>
    </Notice>
  );
}

export function useBeforeUnloadWarning(active: boolean, message: string) {
  useEffect(() => {
    if (!active) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = message; return message; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [active, message]);
}

export function Section({ title, hint, children, actions }: { title: string; hint?: string; children: ReactNode; actions?: ReactNode }) {
  return <UiSection title={title} description={hint} actions={actions}><div className="space-y-4">{children}</div></UiSection>;
}
