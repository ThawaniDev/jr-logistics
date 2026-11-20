"use client";
import { useState } from "react";
import { ArrowLeft, Building2, Plug } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Input, Modal, Notice, SearchBox, Skeleton, errText } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import type { Connection, FreshCredentials, Mode, Provider } from "./business-shipments-partner";
import { groupByMode, splitCreated, type ConnScope } from "./partner-conn-lib";
import { DocsLink, FieldsForm, ModeBadge, initialValues, modeHint, modeLabel, providerDesc, providerLimits, providerName, serverFieldError, toPayload, validateForm, type FormValues } from "./partner-conn-parts";
import { useDebounced } from "./admin-common";

export interface CompanyPick { id: string; name: string }
const GROUP_HINT: Record<Mode, string> = { carrier: "iv2.group_carrier", merchant: "iv2.group_merchant", custom: "iv2.group_custom" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Add a connection: (staff only: pick the company) → pick a system from the catalogue, grouped by mode → a form generated from that system's
 * field list (advanced fields collapsed) → create. The created connection and the credentials to show once go to `onCreated`. Mount only while open.
 */
export function AddConnectionDialog({ providers, scope, onClose, onCreated, pickCompany, company: initialCompany }: {
  providers: Provider[]; scope: ConnScope; onClose: () => void; onCreated: (c: Connection, creds: FreshCredentials | null, company: CompanyPick | null) => void;
  pickCompany?: boolean; company?: CompanyPick | null;
}) {
  const { t } = useI18n();
  const [company, setCompany] = useState<CompanyPick | null>(initialCompany ?? null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [name, setName] = useState(""); const [values, setValues] = useState<FormValues>({ cfg: {}, sec: {} });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [formError, setFormError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const needCompany = !!pickCompany && !company;

  const pick = (p: Provider) => { setProvider(p); setName(providerName(t, p.key, p.label)); setValues(initialValues(p)); setErrors({}); setFormError(null); };
  const submit = async () => {
    if (!provider) return;
    const e = validateForm(t, provider, values);
    if (name.trim().length < 2) e.__name = t("val.required");
    setErrors(e); setFormError(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await post<Parameters<typeof splitCreated>[0]>(`${scope.apiBase}/connections`, { provider: provider.key, name: name.trim(), ...toPayload(provider, values), ...(pickCompany && company ? { businessId: company.id } : {}) });
      toast.success(t("intg.created_toast"));
      const { conn, creds } = splitCreated(r);
      onCreated(conn, creds, company);
    } catch (err) {
      const f = serverFieldError(err, provider, t);
      if (f) setErrors({ [f.field]: f.message }); else setFormError(errText(err, t));
    } finally { setBusy(false); }
  };

  const limits = provider ? providerLimits(t, provider.key) : "";
  const title = needCompany ? t("iv2.add_for_company") : provider ? t("intg.add_title_provider", { name: providerName(t, provider.key, provider.label) }) : t("intg.add_title");
  const companyBar = pickCompany && company && (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-bg2/60 px-3 py-2 text-sm" data-testid="add-company-picked">
      <span className="flex min-w-0 items-center gap-2"><Building2 className="size-4 shrink-0 text-muted" aria-hidden /><span className="text-muted">{t("iv2.add_for")}</span><span className="truncate font-medium">{company.name}</span></span>
      {!initialCompany && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setCompany(null); setProvider(null); }}>{t("iv2.change")}</Button>}
    </div>
  );
  return (
    <Modal open onClose={onClose} busy={busy} title={title}
      footer={provider && !needCompany
        ? <><Button variant="ghost" onClick={() => setProvider(null)} disabled={busy}><ArrowLeft className="size-4 rtl:rotate-180" />{t("common.back")}</Button><Button loading={busy} onClick={submit} data-testid="create-connection">{t("intg.create")}</Button></>
        : <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>}>
      {needCompany ? <CompanyStep onPick={setCompany} /> : !provider ? (
        <>
          {companyBar}
          <p className="text-sm text-muted">{t("intg.pick_sub")}</p>
          {groupByMode(providers).map((g) => (
            <section key={g.mode} className="space-y-2" data-testid={`provider-group-${g.mode}`}>
              <div><h3 className="text-sm font-semibold">{modeLabel(t, g.mode)}</h3><p className="text-xs text-muted">{t(GROUP_HINT[g.mode])}</p></div>
              <ul className="space-y-2">
                {g.items.map((p) => {
                  const pn = providerName(t, p.key, p.label);
                  return (
                    <li key={p.key}>
                      <button type="button" onClick={() => pick(p)} data-testid={`provider-${p.key}`} className="w-full rounded-card border border-line bg-bg2/40 p-4 text-start transition hover:border-accent/60">
                        <span className="flex flex-wrap items-center gap-2 font-semibold"><Plug className="size-4 text-cyan" aria-hidden />{pn}<ModeBadge mode={p.capabilities.mode} name={pn} /></span>
                        <span className="mt-1 block text-xs text-muted">{providerDesc(t, p.key, p.description)}</span>
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {p.capabilities.carrierApi && <Badge tone="info">{t("iv2.cap_carrier_api")}</Badge>}
                          {p.capabilities.importOrders && <Badge tone="info">{t("iv2.cap_orders")}</Badge>}
                          {p.capabilities.lookup && <Badge tone="info">{t("intg.cap_lookup")}</Badge>}
                          {p.capabilities.webhookIn && <Badge tone="info">{t("intg.cap_webhook")}</Badge>}
                          {(p.capabilities.pollOrders || p.capabilities.track) && <Badge tone="info">{t("iv2.cap_poll")}</Badge>}
                          {p.capabilities.label && <Badge tone="info">{t("intg.cap_label")}</Badge>}
                          {p.capabilities.push.length > 0 && <Badge tone="neutral">{t("intg.cap_push")}</Badge>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
          {companyBar}
          <p className="text-sm text-muted">{providerDesc(t, provider.key, provider.description)}</p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted"><ModeBadge mode={provider.capabilities.mode} />{modeHint(t, provider.capabilities.mode, providerName(t, provider.key, provider.label))}</p>
          {limits && <Notice tone="info">{limits}</Notice>}
          <Input label={t("intg.conn_name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} error={errors.__name} hint={t("intg.conn_name_hint")} required data-testid="conn-name" />
          <FieldsForm provider={provider} values={values} onChange={setValues} errors={errors} />
          {formError && <Notice tone="danger">{formError}</Notice>}
          <DocsLink href={provider.docsUrl} />
          <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>{t("intg.create")}</button>
        </form>
      )}
    </Modal>
  );
}

interface CompanyRow { id: string; name: string; contactName: string | null; city: string | null; email: string | null; verificationStatus: string }
/** Staff: find the company by name, phone, e-mail or CR number (the companies list API). Without access to that list, a company account ID works too. */
function CompanyStep({ onPick }: { onPick: (c: CompanyPick) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState(""); const dq = useDebounced(q.trim());
  const [manual, setManual] = useState(""); const [manualErr, setManualErr] = useState<string | null>(null);
  const list = useApi<{ items: CompanyRow[]; total: number }>(`/admin/companies?pageSize=8${dq ? `&q=${encodeURIComponent(dq)}` : ""}`, { keepPreviousData: true, shouldRetryOnError: false });
  return (
    <div className="space-y-3" data-testid="add-company-step">
      <p className="text-sm text-muted">{t("iv2.add_company_intro")}</p>
      <SearchBox value={q} onChange={setQ} placeholder={t("iv2.add_company_search")} label={t("iv2.add_company_search")} className="sm:w-full" testId="company-search" />
      {list.error ? <Notice tone="warn">{errText(list.error, t)}</Notice> : !list.data ? <div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : list.data.items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t("common.no_results")}</p>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto" aria-label={t("iv2.add_company_results")}>
          {list.data.items.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick({ id: c.id, name: c.name })} data-testid="company-option" data-company-id={c.id} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-start text-sm transition hover:border-accent/60">
                <span className="min-w-0"><span className="block truncate font-medium">{c.name}</span><span className="block truncate text-xs text-muted">{[c.contactName, c.city, c.email].filter(Boolean).join(" · ")}</span></span>
                <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <details className="rounded-xl border border-line p-3 text-sm">
        <summary className="cursor-pointer font-medium">{t("iv2.add_company_by_id")}</summary>
        <form className="mt-3 flex flex-wrap items-end gap-2" noValidate onSubmit={(e) => { e.preventDefault(); const id = manual.trim(); if (!UUID.test(id)) { setManualErr(t("iv2.add_company_bad_id")); return; } onPick({ id, name: id }); }}>
          <div className="min-w-0 flex-1"><Input label={t("iv2.add_company_id")} ltr value={manual} onChange={(e) => { setManual(e.target.value); setManualErr(null); }} error={manualErr ?? undefined} data-testid="company-id-input" /></div>
          <Button type="submit" variant="secondary">{t("iv2.add_company_use_id")}</Button>
        </form>
      </details>
    </div>
  );
}
