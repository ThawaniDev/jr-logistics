"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { Pause, Play, Plug, PlugZap, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Breadcrumbs, Button, DetailHeader, EmptyState, Input, LinkTabs, Modal, Notice, Section as UiSection, errText } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError, api, patch, post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import type { Connection, PushAction, Provider } from "@/components/features/business-shipments-partner";
import type { OutboxData } from "./activity";
import { useIntegrations } from "./shell";
import { DocsLink, FieldsForm, Health, LimitsBox, ManualSetup, Section, TestResult, Toggle, initialValues, providerDesc, providerName, serverFieldError, toPayload, useTest, validateForm, type FormValues } from "./parts";

const PUSH_ORDER: PushAction[] = ["cancelled", "returned", "failed", "delivered"];

interface ConnCtx { conn: Connection; provider: Provider | undefined; name: string; reload: () => void; outbox: ReturnType<typeof useApi<OutboxData>>; problems: number; showOutbox: boolean; base: string }
const Ctx = createContext<ConnCtx | null>(null);
export function useConnection(): ConnCtx { const c = useContext(Ctx); if (!c) throw new Error("useConnection outside the connection layout"); return c; }

/**
 * One connection's layout: breadcrumb + header with the connection-level actions (test, pause, delete), the section tabs (real routes:
 * setup · activity · failed updates) and the two confirmations. The sections read the connection through `useConnection()`.
 */
export function ConnectionShell({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n(); const router = useRouter();
  const { providers, conns, reload, setFresh } = useIntegrations();
  const conn = conns.find((c) => c.id === id);
  const [busy, setBusy] = useState<string | null>(null); const [confirm, setConfirm] = useState<null | "delete" | "rotate">(null);
  const test = useTest(conn ?? ({ id } as Connection), reload);
  const showOutbox = !!conn?.capabilities && conn.capabilities.push.length > 0;
  const outbox = useApi<OutboxData>(conn ? `/integrations/connections/${id}/outbox` : null, { refreshInterval: 30000 });
  if (!conn) return <><Breadcrumbs items={[{ label: t("nav.integrations"), href: "/business/integrations" }]} /><EmptyState icon={<Plug className="size-9" aria-hidden />} title={t("intg.not_found")} action={<Button onClick={() => router.push("/business/integrations")}>{t("intg.back_list")}</Button>} /></>;
  const provider = providers.find((p) => p.key === conn.provider);
  const name = providerName(t, conn.provider, conn.providerLabel);
  const base = `/business/integrations/${id}`;
  const problems = outbox.data?.problems.filter((p) => p.status !== "skipped").length ?? 0;

  const act = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try { await fn(); if (success) toast.success(t(success)); reload(); return true; }
    catch (e) { toast.error(errText(e, t)); return false; }
    finally { setBusy(null); }
  };
  const toggleStatus = () => act("status", () => patch(`/integrations/connections/${conn.id}`, { status: conn.status === "active" ? "disabled" : "active" }), conn.status === "active" ? "intg.paused_ok" : "intg.resumed_ok");
  const remove = async () => { if (await act("delete", () => api("DELETE", `/integrations/connections/${conn.id}`), "intg.deleted_ok")) { setConfirm(null); router.push("/business/integrations"); } };
  const rotate = async () => {
    setBusy("rotate");
    try { const r = await post<{ inboundToken: string; webhookUrl: string }>(`/integrations/connections/${conn.id}/rotate-token`); setConfirm(null); setFresh({ conn, token: r.inboundToken, webhookUrl: r.webhookUrl, kind: "rotated" }); reload(); router.push(base); }
    catch (e) { toast.error(errText(e, t)); } finally { setBusy(null); }
  };

  return (
    <Ctx.Provider value={{ conn, provider, name, reload, outbox, problems, showOutbox, base }}>
      <RotateBridge value={{ ask: () => setConfirm("rotate"), rotating: busy === "rotate" }}>
        <Breadcrumbs items={[{ label: t("nav.integrations"), href: "/business/integrations" }, { label: conn.name }]} />
        <DetailHeader
          avatar={<span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-cyan/10 text-cyan" aria-hidden><Plug className="size-7" /></span>}
          name={conn.name} subtitle={`${name} · ${providerDesc(t, conn.provider, provider?.description ?? "")}`}
          badges={<Badge tone={conn.status === "active" ? "success" : "neutral"}>{t(conn.status === "active" ? "intg.st_active" : "intg.st_disabled")}</Badge>}
          actions={<>
            <Button size="sm" variant="secondary" loading={test.busy} onClick={test.run} data-testid="test-connection"><PlugZap className="size-4" aria-hidden />{t("intg.test")}</Button>
            <Button size="sm" variant="secondary" loading={busy === "status"} onClick={toggleStatus}>{conn.status === "active" ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}{t(conn.status === "active" ? "intg.pause" : "intg.resume")}</Button>
            <Button size="sm" variant="danger" onClick={() => setConfirm("delete")} data-testid="delete-connection"><Trash2 className="size-4" aria-hidden />{t("intg.delete")}</Button>
          </>} />
        {test.result && <div className="mb-5"><TestResult r={test.result} name={name} /></div>}
        {conn.status === "disabled" && <div className="mb-5"><Notice tone="warn">{t("intg.paused_note", { name })}</Notice></div>}
        <LinkTabs label={t("rdz.int_sections")} tabs={[{ href: base, label: t("intg.tab_setup") }, { href: `${base}/activity`, label: t("intg.tab_activity") }, ...(showOutbox ? [{ href: `${base}/failed`, label: t("intg.tab_failed"), count: problems || undefined }] : [])]} />
        {children}
        <Modal open={confirm === "delete"} onClose={() => setConfirm(null)} title={t("intg.delete_title", { name: conn.name })} footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button><Button variant="danger" loading={busy === "delete"} onClick={remove} data-testid="confirm-delete">{t("intg.delete_confirm")}</Button></>}>
          <Notice tone="warn">{t("intg.delete_note", { name })}</Notice>
        </Modal>
        <Modal open={confirm === "rotate"} onClose={() => setConfirm(null)} title={t("intg.rotate_title")} footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button><Button variant="danger" loading={busy === "rotate"} onClick={rotate} data-testid="confirm-rotate">{t("intg.rotate")}</Button></>}>
          <Notice tone="warn">{t("intg.rotate_note", { name })}</Notice>
        </Modal>
      </RotateBridge>
    </Ctx.Provider>
  );
}

/** The Setup section asks the layout to open the "new token" confirmation. */
const RotateCtx = createContext<{ ask: () => void; rotating: boolean }>({ ask: () => {}, rotating: false });
function RotateBridge({ value, children }: { value: { ask: () => void; rotating: boolean }; children: ReactNode }) { return <RotateCtx.Provider value={value}>{children}</RotateCtx.Provider>; }

/** Setup: connection details, how the partner reaches JR, and what JR sends back. */
export function SetupTab() {
  const { t } = useI18n();
  const { conn, provider, name, reload, problems, base } = useConnection(); const rot = useContext(RotateCtx);
  const [busy, setBusy] = useState<string | null>(null); const [autoErr, setAutoErr] = useState<string | null>(null); const [manual, setManual] = useState(false);
  const caps = conn.capabilities;
  const autoConnect = async () => {
    setBusy("auto"); setAutoErr(null);
    try { await post(`/integrations/connections/${conn.id}/register-webhook`); toast.success(t("intg.auto_ok", { name })); reload(); }
    catch (e) { setAutoErr(`${errText(e, t)}${e instanceof ApiError && e.message && e.message !== e.code ? ` — ${e.message}` : ""}`); }
    finally { setBusy(null); }
  };
  const setSetting = async (key: string, body: object) => {
    setBusy(key);
    try { await patch(`/integrations/connections/${conn.id}`, { settings: body }); toast.success(t("common.saved")); reload(); }
    catch (e) { toast.error(errText(e, t)); } finally { setBusy(null); }
  };
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <aside className="space-y-6 lg:order-2">
        <UiSection title={t("intg.health")}><Health c={conn} /></UiSection>
        {provider && <LimitsBox providers={[provider]} />}
        <DocsLink href={provider?.docsUrl} />
      </aside>
      <div className="min-w-0 space-y-6 lg:order-1 lg:col-span-2">
        {problems > 0 && <Notice tone="danger" title={t("intg.problems_title", { n: problems })}>{t("intg.problems_hint")} <a href={`${base}/failed`} className="font-semibold underline">{t("intg.tab_failed")}</a></Notice>}
        {provider && <EditForm key={conn.id} conn={conn} provider={provider} onSaved={reload} />}
        {caps?.webhookIn && conn.webhookUrl && (
          <Section title={t("intg.receive_title")} hint={t("intg.receive_sub", { name })}>
            {caps.registerWebhook && (
              <div className="space-y-2">
                <p className="text-sm text-muted">{t("intg.auto_intro", { name })}</p>
                <Button type="button" variant="secondary" loading={busy === "auto"} onClick={autoConnect} data-testid="connect-auto-detail"><RefreshCw className="size-4" aria-hidden />{t("intg.auto_button")}</Button>
                {autoErr && <Notice tone="danger" title={t("intg.auto_failed")}>{autoErr}</Notice>}
              </div>
            )}
            <div className="border-t border-line pt-4">
              <button type="button" className="text-sm font-medium text-cyan hover:underline" aria-expanded={manual} onClick={() => setManual((m) => !m)}>{manual ? t("intg.manual_hide") : t("intg.manual_show")}</button>
              {manual && <div className="mt-3"><ManualSetup provider={provider} providerLabel={name} webhookUrl={conn.webhookUrl} token={null} prefix={conn.tokenPrefix} onRotate={rot.ask} rotating={rot.rotating} /></div>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-sm">
              <span className="text-muted">{t("intg.token")}: <code dir="ltr" className="text-xs">{conn.tokenPrefix ? `${conn.tokenPrefix}…` : "—"}</code></span>
              <Button size="sm" variant="ghost" onClick={rot.ask} data-testid="rotate-token"><RefreshCw className="size-4" aria-hidden />{t("intg.rotate")}</Button>
            </div>
          </Section>
        )}
        {caps && (caps.webhookIn || caps.push.length > 0) && (
          <Section title={t("intg.settings_title")} hint={t("intg.settings_sub")}>
            <div className="divide-y divide-line">
              {caps.webhookIn && <Toggle testId="set-autoCancel" checked={conn.settings.autoCancel} busy={busy === "autoCancel"} onChange={(v) => setSetting("autoCancel", { autoCancel: v })} label={t("intg.set_autocancel")} hint={t("intg.set_autocancel_hint", { name })} />}
              {PUSH_ORDER.filter((a) => caps.push.includes(a)).map((a) => (
                <Toggle key={a} testId={`set-sync-${a}`} checked={!!conn.settings.sync?.[a]} busy={busy === `sync-${a}`} onChange={(v) => setSetting(`sync-${a}`, { sync: { [a]: v } })}
                  label={t(`intg.sync_${a}`, { name })} hint={t(`intg.sync_${a}_hint`, { name })} warn={t("intg.sync_warn", { name })} />
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

/** Name + generated fields. Secrets show "saved ••••" and are only replaced when something is typed. */
function EditForm({ conn, provider, onSaved }: { conn: Connection; provider: Provider; onSaved: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(conn.name); const [values, setValues] = useState<FormValues>(() => initialValues(provider, conn));
  const [errors, setErrors] = useState<Record<string, string>>({}); const [formError, setFormError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const save = async () => {
    const e = validateForm(t, provider, values, conn); if (name.trim().length < 2) e.__name = t("val.required");
    setErrors(e); setFormError(null); if (Object.keys(e).length) return;
    setBusy(true);
    try { await patch(`/integrations/connections/${conn.id}`, { name: name.trim(), ...toPayload(provider, values) }); toast.success(t("common.saved")); setValues((v) => ({ ...v, sec: {} })); onSaved(); }
    catch (err) { const f = serverFieldError(err, provider, t); if (f) setErrors({ [f.field]: f.message }); else setFormError(errText(err, t)); }
    finally { setBusy(false); }
  };
  return (
    <Section title={t("intg.details_title")}>
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Input label={t("intg.conn_name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} error={errors.__name} required />
        <FieldsForm provider={provider} values={values} onChange={setValues} errors={errors} connection={conn} />
        {formError && <Notice tone="danger">{formError}</Notice>}
        <div className="flex justify-end"><Button type="submit" loading={busy} data-testid="save-connection">{t("common.save")}</Button></div>
      </form>
    </Section>
  );
}
