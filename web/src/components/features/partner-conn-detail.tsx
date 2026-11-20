"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Pause, Play, Plug, PlugZap, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Breadcrumbs, Button, DetailHeader, InfoGrid, Input, LinkTabs, Modal, Notice, Section as UiSection, errText } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError, api, patch, post } from "@/lib/api";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import type { Connection, FreshCredentials, Provider } from "./business-shipments-partner";
import { FASTCOO_ORDER_SUFFIX, canPoll, connApi, connRoute, modeOf, ordersHref, type ConnScope, type FreshView } from "./partner-conn-lib";
import { CopyBox, DocsLink, FieldsForm, Health, LimitsBox, ManualSetup, ModeBadge, Section, TestResult, When, initialValues, modeHint, providerDesc, providerName, serverFieldError, toPayload, useTest, validateForm, type FormValues } from "./partner-conn-parts";
import { AuthModes } from "./partner-conn-fresh";

interface Problem { id: string; action: string; status: "dead" | "retry_wait" | "skipped"; attempts: number; lastError: string | null; code: string | null; createdAt: string }
export interface OutboxData { counts: Record<string, number>; problems: Problem[] }

interface ConnCtx {
  scope: ConnScope; conn: Connection; provider: Provider | undefined; name: string;
  reload: () => Promise<unknown>;
  outbox: ReturnType<typeof useApi<OutboxData>>; problems: number; showOutbox: boolean;
  /** This connection's page (`{routeBase}/:id`). */
  base: string;
  askRotate: () => void; rotating: boolean;
}
const Ctx = createContext<ConnCtx | null>(null);
export function useConnection(): ConnCtx { const c = useContext(Ctx); if (!c) throw new Error("useConnection outside the connection layout"); return c; }

/**
 * One connection's layout, for the company portal and the staff console alike (`scope` says which API / routes): breadcrumb, header with
 * mode and the connection-level actions (test, pause, delete), the section tabs (real routes: setup · sync & statuses · orders · activity ·
 * failed updates) and the confirmations. The sections read the connection through `useConnection()`.
 */
export function ConnectionShell({ scope, conn, providers, reload, onFresh, children }: { scope: ConnScope; conn: Connection; providers: Provider[]; reload: () => Promise<unknown>; onFresh: (f: FreshView) => void; children: ReactNode }) {
  const { t, locale } = useI18n(); const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null); const [confirm, setConfirm] = useState<null | "delete" | "rotate">(null);
  const test = useTest(conn, () => { void reload(); }, scope);
  const showOutbox = !!conn.capabilities && conn.capabilities.push.length > 0;
  const outbox = useApi<OutboxData>(connApi(scope, conn.id, "/outbox"), { refreshInterval: 30000 });
  const provider = providers.find((p) => p.key === conn.provider);
  const name = providerName(t, conn.provider, conn.providerLabel);
  const base = connRoute(scope, conn.id);
  const problems = outbox.data?.problems.filter((p) => p.status !== "skipped").length ?? 0;
  const mode = modeOf(conn);
  const manage = scope.canManage;

  const act = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try { await fn(); if (success) toast.success(t(success)); await reload(); return true; }
    catch (e) { toast.error(errText(e, t)); return false; }
    finally { setBusy(null); }
  };
  const toggleStatus = () => act("status", () => patch(connApi(scope, conn.id), { status: conn.status === "active" ? "disabled" : "active" }), conn.status === "active" ? "intg.paused_ok" : "intg.resumed_ok");
  const remove = async () => {
    setBusy("delete");
    // The company's list is refreshed (the connection leaves it); the staff list loads its own data when it opens.
    try { await api("DELETE", connApi(scope, conn.id)); toast.success(t("intg.deleted_ok")); setConfirm(null); router.push(scope.routeBase); if (!scope.staff) void reload(); }
    catch (e) { toast.error(errText(e, t)); } finally { setBusy(null); }
  };
  const rotate = async () => {
    setBusy("rotate");
    try { const r = await post<FreshCredentials>(connApi(scope, conn.id, "/rotate-token")); setConfirm(null); onFresh({ conn, creds: r, kind: "rotated" }); void reload(); router.push(base); }
    catch (e) { toast.error(errText(e, t)); } finally { setBusy(null); }
  };

  const companyHref = scope.staff && conn.businessId ? `/admin/companies/${conn.businessId}` : null;
  const facts = [
    ...(scope.staff ? [{ label: t("iv2.company"), value: companyHref
      ? <Link href={companyHref} className="inline-flex items-center gap-1 text-cyan hover:underline" data-testid="conn-company"><Building2 className="size-3.5 shrink-0" aria-hidden />{conn.business ?? t("iv2.company_unknown")}</Link>
      : conn.business ?? "—" }] : []),
    { label: t("iv2.orders_open"), value: <Link href={ordersHref(scope, conn.id)} className="ltr-num text-cyan hover:underline" data-testid="conn-open-orders">{fmtNum(conn.orders?.open ?? 0, locale)}</Link> },
    { label: t("iv2.orders_in_jr"), value: <span className="ltr-num">{fmtNum(conn.orders?.inJr ?? 0, locale)}</span> },
    { label: t("iv2.last_ok"), value: <When at={conn.lastOkAt} /> },
  ];

  return (
    <Ctx.Provider value={{ scope, conn, provider, name, reload, outbox, problems, showOutbox, base, askRotate: () => setConfirm("rotate"), rotating: busy === "rotate" }}>
      <Breadcrumbs items={[{ label: t("nav.integrations"), href: scope.routeBase }, { label: conn.name }]} />
      <DetailHeader
        avatar={<span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-cyan/10 text-cyan" aria-hidden><Plug className="size-7" /></span>}
        name={conn.name}
        subtitle={<>
          <span className="block">{name} · {providerDesc(t, conn.provider, provider?.description ?? "")}</span>
          {mode && <span className="mt-1 block text-xs" data-testid="conn-mode-hint">{modeHint(t, mode, name)}</span>}
        </>}
        badges={<><Badge tone={conn.status === "active" ? "success" : "neutral"}>{t(conn.status === "active" ? "intg.st_active" : "intg.st_disabled")}</Badge><ModeBadge mode={mode} name={name} /></>}
        facts={facts}
        actions={manage ? <>
          <Button size="sm" variant="secondary" loading={test.busy} onClick={test.run} data-testid="test-connection"><PlugZap className="size-4" aria-hidden />{t("intg.test")}</Button>
          <Button size="sm" variant="secondary" loading={busy === "status"} onClick={toggleStatus} data-testid="pause-connection">{conn.status === "active" ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}{t(conn.status === "active" ? "intg.pause" : "intg.resume")}</Button>
          <Button size="sm" variant="danger" onClick={() => setConfirm("delete")} data-testid="delete-connection"><Trash2 className="size-4" aria-hidden />{t("intg.delete")}</Button>
        </> : undefined} />
      {!manage && <div className="mb-5"><Notice tone="info"><span data-testid="conn-view-only">{t("iv2.view_only")}</span></Notice></div>}
      {test.result && <div className="mb-5"><TestResult r={test.result} name={name} /></div>}
      {conn.status === "disabled" && <div className="mb-5"><Notice tone="warn">{t("intg.paused_note", { name })}</Notice></div>}
      <LinkTabs label={t("rdz.int_sections")} tabs={[
        { href: base, label: t("intg.tab_setup") },
        { href: `${base}/sync`, label: t("iv2.tab_sync") },
        { href: ordersHref(scope, conn.id), label: t("iv2.tab_orders"), count: conn.orders?.open || undefined },
        { href: `${base}/activity`, label: t("intg.tab_activity") },
        ...(showOutbox ? [{ href: `${base}/failed`, label: t("intg.tab_failed"), count: problems || undefined }] : []),
      ]} />
      {children}
      <Modal open={confirm === "delete"} onClose={() => setConfirm(null)} busy={busy === "delete"} title={t("intg.delete_title", { name: conn.name })} footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button><Button variant="danger" loading={busy === "delete"} onClick={remove} data-testid="confirm-delete">{t("intg.delete_confirm")}</Button></>}>
        <Notice tone="warn">{t("intg.delete_note", { name })}</Notice>
        {(conn.orders?.open ?? 0) > 0 && <p className="text-sm text-muted">{t("iv2.delete_orders_note", { n: conn.orders?.open ?? 0 })}</p>}
      </Modal>
      <Modal open={confirm === "rotate"} onClose={() => setConfirm(null)} busy={busy === "rotate"} title={conn.carrier ? t("iv2.rotate_carrier_title") : t("intg.rotate_title")} footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button><Button variant="danger" loading={busy === "rotate"} onClick={rotate} data-testid="confirm-rotate">{t("intg.rotate")}</Button></>}>
        <Notice tone="warn">{conn.carrier ? t("iv2.rotate_carrier_note", { name }) : conn.webhookAuth === "url" ? t("iv2.rotate_url_note", { name }) : t("intg.rotate_note", { name })}</Notice>
      </Modal>
    </Ctx.Provider>
  );
}

/** Setup: connection details, how the partner reaches JR (carrier API / webhook), and on-demand checks. Mapping and behaviour live in Sync & statuses. */
export function SetupTab() {
  const { t } = useI18n();
  const { conn, provider, name, reload, problems, base } = useConnection();
  const caps = conn.capabilities;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <aside className="space-y-6 lg:order-2">
        <UiSection title={t("intg.health")}>
          <Health c={conn} />
          {canPoll(caps) && <CheckNow />}
        </UiSection>
        {provider && <LimitsBox providers={[provider]} />}
        <DocsLink href={provider?.docsUrl} />
      </aside>
      <div className="min-w-0 space-y-6 lg:order-1 lg:col-span-2">
        {problems > 0 && <Notice tone="danger" title={t("intg.problems_title", { n: problems })}>{t("intg.problems_hint")} <Link href={`${base}/failed`} className="font-semibold underline">{t("intg.tab_failed")}</Link></Notice>}
        {provider && <EditForm key={conn.id} conn={conn} provider={provider} onSaved={reload} />}
        {conn.carrier && <CarrierSection />}
        {caps?.webhookIn && conn.webhookUrl && <ReceiveSection />}
        {caps && (caps.push.length > 0 || caps.webhookIn || caps.track || caps.carrierApi) && (
          <Link href={`${base}/sync`} className="flex items-center justify-between gap-3 rounded-card border border-line bg-card p-4 text-sm transition hover:border-accent/50" data-testid="setup-sync-link">
            <span><span className="block font-semibold">{t("iv2.tab_sync")}</span><span className="mt-0.5 block text-xs text-muted">{t("iv2.setup_sync_hint", { name })}</span></span>
            <ArrowRight className="size-4 shrink-0 text-muted rtl:rotate-180" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}

/** "Check now": ask the system for new orders and the current status of open ones, outside the schedule. */
function CheckNow() {
  const { t } = useI18n();
  const { scope, conn, name, reload } = useConnection();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await post<{ imported: number; tracked: number; changed: number; error?: string | null }>(connApi(scope, conn.id, "/poll"));
      if (r.error) toast.error(t("iv2.poll_failed", { name, error: r.error }));
      else toast.success(t("iv2.poll_done", { imported: r.imported ?? 0, tracked: r.tracked ?? 0, changed: r.changed ?? 0 }));
      await reload();
    } catch (e) { toast.error(errText(e, t)); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
      <p className="text-xs text-muted">{t("iv2.poll_intro", { name })}</p>
      <p className="text-xs text-muted">{t("iv2.last_poll")}: <When at={conn.lastPollAt} /></p>
      <Button size="sm" variant="secondary" loading={busy} disabled={!scope.canManage || conn.status !== "active"} onClick={run} data-testid="poll-now"><RefreshCw className="size-4" aria-hidden />{t("iv2.poll_now")}</Button>
      {conn.status !== "active" && <p className="text-xs text-muted">{t("iv2.poll_paused")}</p>}
    </div>
  );
}

/** Carrier systems (Omniful) call JR's carrier API: base URL + client ID to copy, the two auth modes, and what JR saw of them. */
function CarrierSection() {
  const { t, locale } = useI18n();
  const { scope, conn, name, askRotate, rotating } = useConnection();
  const c = conn.carrier!; const rt = conn.runtime;
  return (
    <Section title={t("iv2.carrier_title", { name })} hint={t("iv2.carrier_sub", { name })} testId="carrier-section">
      <CopyBoxes>
        <CopyField label={t("iv2.carrier_base_url")} value={c.baseUrl} testId="carrier-base-url" />
        <CopyField label={t("iv2.carrier_client_id")} value={c.clientId} testId="carrier-client-id" />
      </CopyBoxes>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-bg2/60 p-3 text-sm">
        <span className="text-muted">{t("iv2.carrier_key_label")}: <code dir="ltr" className="text-xs">{conn.tokenPrefix ? `${conn.tokenPrefix}…` : "—"}</code> <span className="text-xs">{t("iv2.carrier_key_hidden")}</span></span>
        {scope.canManage && <Button size="sm" variant="ghost" onClick={askRotate} loading={rotating} data-testid="rotate-token"><RefreshCw className="size-4" aria-hidden />{t("iv2.carrier_rotate")}</Button>}
      </div>
      <AuthModes name={name} />
      <div className="border-t border-line pt-4" data-testid="carrier-runtime">
        <p className="mb-3 text-sm font-medium">{t("iv2.runtime_title", { name })}</p>
        <InfoGrid cols={2} items={[
          { label: t("iv2.runtime_webhook"), value: rt.webhookRegistered
            ? <span><Badge tone="success">{t("iv2.runtime_registered")}</Badge>{rt.webhookHost && <code dir="ltr" className="ms-2 text-xs">{rt.webhookHost}</code>}{rt.webhookRegisteredAt && <span className="mt-0.5 block text-xs text-muted">{fmtDateTime(rt.webhookRegisteredAt, locale)}</span>}</span>
            : <span><Badge tone="warn">{t("iv2.runtime_not_registered")}</Badge><span className="mt-0.5 block text-xs font-normal text-muted">{t("iv2.runtime_not_registered_hint", { name })}</span></span> },
          { label: t("iv2.runtime_last_call"), value: <When at={rt.lastCarrierCallAt} never={t("iv2.runtime_no_call", { name })} /> },
          { label: t("iv2.runtime_auth_mode"), value: rt.authMode ? <code dir="ltr" className="text-xs text-cyan">{rt.authMode}</code> : <span className="text-muted">—</span> },
        ]} />
      </div>
    </Section>
  );
}
const CopyBoxes = ({ children }: { children: ReactNode }) => <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
const CopyField = ({ label, value, testId }: { label: string; value: string; testId: string }) => <div className="min-w-0"><CopyBox label={label} value={value} testId={testId} /></div>;

/** How the system tells JR about changes: JR's webhook address (header token, or token inside the address), with automatic set-up where the API offers it. */
function ReceiveSection() {
  const { t } = useI18n();
  const { scope, conn, provider, name, reload, askRotate, rotating } = useConnection();
  const [busy, setBusy] = useState(false); const [autoErr, setAutoErr] = useState<string | null>(null); const [manual, setManual] = useState(false);
  const caps = conn.capabilities!;
  const autoConnect = async () => {
    setBusy(true); setAutoErr(null);
    try { await post(connApi(scope, conn.id, "/register-webhook")); toast.success(t("intg.auto_ok", { name })); await reload(); }
    catch (e) { setAutoErr(`${errText(e, t)}${e instanceof ApiError && e.message && e.message !== e.code ? ` — ${e.message}` : ""}`); }
    finally { setBusy(false); }
  };
  if (conn.webhookAuth === "url") return (
    <Section title={t("intg.receive_title")} hint={t("intg.receive_sub", { name })} testId="receive-url-auth">
      <p className="text-sm text-muted">{t("iv2.url_auth_intro", { name })}</p>
      <div>
        <p className="mb-1 text-xs font-medium text-muted">{t("iv2.url_template")}</p>
        <code dir="ltr" data-testid="webhook-url-template" className="block break-all rounded-xl bg-bg2 p-3 text-start text-xs text-accent">{conn.webhookUrlTemplate ?? `${conn.webhookUrl}/{token}`}</code>
      </div>
      <Notice tone="info">{t("iv2.url_auth_once")}</Notice>
      {conn.provider === "fastcoo" && <p className="text-xs text-muted">{t("iv2.fastcoo_suffix", { suffix: FASTCOO_ORDER_SUFFIX })}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-sm">
        <span className="text-muted">{t("intg.token")}: <code dir="ltr" className="text-xs">{conn.tokenPrefix ? `${conn.tokenPrefix}…` : "—"}</code></span>
        {scope.canManage && <Button size="sm" variant="ghost" onClick={askRotate} loading={rotating} data-testid="rotate-token"><RefreshCw className="size-4" aria-hidden />{t("iv2.url_rotate")}</Button>}
      </div>
    </Section>
  );
  return (
    <Section title={t("intg.receive_title")} hint={t("intg.receive_sub", { name })}>
      {caps.registerWebhook && (
        <div className="space-y-2">
          <p className="text-sm text-muted">{t("intg.auto_intro", { name })}</p>
          <Button type="button" variant="secondary" loading={busy} disabled={!scope.canManage} onClick={autoConnect} data-testid="connect-auto-detail"><RefreshCw className="size-4" aria-hidden />{t("intg.auto_button")}</Button>
          {conn.runtime.webhookRegistered && <p className="text-xs text-muted">{t("iv2.runtime_registered")}{conn.runtime.webhookRegisteredAt ? <> · <When at={conn.runtime.webhookRegisteredAt} /></> : null}</p>}
          {autoErr && <Notice tone="danger" title={t("intg.auto_failed")}>{autoErr}</Notice>}
        </div>
      )}
      <div className="border-t border-line pt-4">
        <button type="button" className="text-sm font-medium text-cyan hover:underline" aria-expanded={manual} onClick={() => setManual((m) => !m)}>{manual ? t("intg.manual_hide") : t("intg.manual_show")}</button>
        {manual && <div className="mt-3"><ManualSetup provider={provider} providerLabel={name} webhookUrl={conn.webhookUrl!} token={null} prefix={conn.tokenPrefix} onRotate={scope.canManage ? askRotate : undefined} rotating={rotating} /></div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-sm">
        <span className="text-muted">{t("intg.token")}: <code dir="ltr" className="text-xs">{conn.tokenPrefix ? `${conn.tokenPrefix}…` : "—"}</code></span>
        {scope.canManage && <Button size="sm" variant="ghost" onClick={askRotate} data-testid="rotate-token"><RefreshCw className="size-4" aria-hidden />{t("intg.rotate")}</Button>}
      </div>
    </Section>
  );
}

/** Name + generated fields. Secrets show "saved ••••" and are only replaced when something is typed. Read-only for staff without integrations.manage. */
function EditForm({ conn, provider, onSaved }: { conn: Connection; provider: Provider; onSaved: () => Promise<unknown> }) {
  const { t } = useI18n(); const { scope } = useConnection();
  const [name, setName] = useState(conn.name); const [values, setValues] = useState<FormValues>(() => initialValues(provider, conn));
  const [errors, setErrors] = useState<Record<string, string>>({}); const [formError, setFormError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const ro = !scope.canManage;
  const save = async () => {
    const e = validateForm(t, provider, values, conn); if (name.trim().length < 2) e.__name = t("val.required");
    setErrors(e); setFormError(null); if (Object.keys(e).length) return;
    setBusy(true);
    try { await patch(connApi(scope, conn.id), { name: name.trim(), ...toPayload(provider, values) }); toast.success(t("common.saved")); setValues((v) => ({ ...v, sec: {} })); await onSaved(); }
    catch (err) { const f = serverFieldError(err, provider, t); if (f) setErrors({ [f.field]: f.message }); else setFormError(errText(err, t)); }
    finally { setBusy(false); }
  };
  return (
    <Section title={t("intg.details_title")}>
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); if (!ro) void save(); }}>
        <Input label={t("intg.conn_name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} error={errors.__name} required disabled={ro} data-testid="edit-conn-name" />
        <FieldsForm provider={provider} values={values} onChange={setValues} errors={errors} connection={conn} disabled={ro} />
        {formError && <Notice tone="danger">{formError}</Notice>}
        {!ro && <div className="flex justify-end"><Button type="submit" loading={busy} data-testid="save-connection">{t("common.save")}</Button></div>}
      </form>
    </Section>
  );
}
