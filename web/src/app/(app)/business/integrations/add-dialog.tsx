"use client";
import { useState } from "react";
import { ArrowLeft, Plug } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Input, Modal, Notice, errText } from "@/components/ui";
import { post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import type { Connection, Provider } from "@/components/features/business-shipments-partner";
import { DocsLink, FieldsForm, initialValues, providerDesc, providerLimits, providerName, serverFieldError, toPayload, validateForm, type FormValues } from "./parts";

/** Pick a system from the catalogue → a form generated from that system's field list → create. Mount only while open. */
export function AddDialog({ providers, onClose, onCreated }: { providers: Provider[]; onClose: () => void; onCreated: (c: Connection, token: string | null) => void }) {
  const { t } = useI18n();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [name, setName] = useState(""); const [values, setValues] = useState<FormValues>({ cfg: {}, sec: {} });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [formError, setFormError] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  const pick = (p: Provider) => { setProvider(p); setName(providerName(t, p.key, p.label)); setValues(initialValues(p)); setErrors({}); setFormError(null); };
  const submit = async () => {
    if (!provider) return;
    const e = validateForm(t, provider, values);
    if (name.trim().length < 2) e.__name = t("val.required");
    setErrors(e); setFormError(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await post<Connection & { inboundToken: string | null }>("/integrations/connections", { provider: provider.key, name: name.trim(), ...toPayload(provider, values) });
      toast.success(t("intg.created_toast"));
      onCreated(r, r.inboundToken);
    } catch (err) {
      const f = serverFieldError(err, provider, t);
      if (f) setErrors({ [f.field]: f.message }); else setFormError(errText(err, t));
    } finally { setBusy(false); }
  };

  const limits = provider ? providerLimits(t, provider.key) : "";
  return (
    <Modal open onClose={onClose} title={provider ? t("intg.add_title_provider", { name: providerName(t, provider.key, provider.label) }) : t("intg.add_title")}
      footer={provider
        ? <><Button variant="ghost" onClick={() => setProvider(null)} disabled={busy}><ArrowLeft className="size-4 rtl:rotate-180" />{t("common.back")}</Button><Button loading={busy} onClick={submit} data-testid="create-connection">{t("intg.create")}</Button></>
        : <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>}>
      {!provider ? (
        <>
          <p className="text-sm text-muted">{t("intg.pick_sub")}</p>
          <ul className="space-y-2">
            {providers.map((p) => (
              <li key={p.key}>
                <button type="button" onClick={() => pick(p)} data-testid={`provider-${p.key}`} className="w-full rounded-card border border-line bg-bg2/40 p-4 text-start transition hover:border-accent/60">
                  <span className="flex items-center gap-2 font-semibold"><Plug className="size-4 text-cyan" aria-hidden />{providerName(t, p.key, p.label)}</span>
                  <span className="mt-1 block text-xs text-muted">{providerDesc(t, p.key, p.description)}</span>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {p.capabilities.lookup && <Badge tone="info">{t("intg.cap_lookup")}</Badge>}
                    {p.capabilities.webhookIn && <Badge tone="info">{t("intg.cap_webhook")}</Badge>}
                    {p.capabilities.label && <Badge tone="info">{t("intg.cap_label")}</Badge>}
                    {p.capabilities.push.length > 0 && <Badge tone="neutral">{t("intg.cap_push")}</Badge>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
          <p className="text-sm text-muted">{providerDesc(t, provider.key, provider.description)}</p>
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
