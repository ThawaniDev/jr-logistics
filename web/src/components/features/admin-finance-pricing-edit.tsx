"use client";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Badge, Button, ErrorState, Input, Modal, Notice, Skeleton, useAction, errText } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { put } from "@/lib/api";
import { fmtDate, fmtDateTime, riyadhLocalToIso, sarToCents } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { ConfirmModal } from "./admin-common";
import { Money } from "./admin-finance-parts";
import { RuleScope, centsToInput, marginPct, pctChange, useRuleRoute } from "./admin-finance-pricing-parts";

const BIG_CHANGE_PCT = 25;
const dayOf = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : "");

function ScopeSummary({ rule }: { rule: any }) {
  const { t } = useI18n(); const route = useRuleRoute();
  return (
    <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-line bg-bg2 p-3 text-sm sm:grid-cols-2" data-testid="fin-pricing-scope">
      <div><dt className="text-xs text-muted">{t("req.service")}</dt><dd className="font-medium">{t(`svc.${rule.service}`)}</dd></div>
      <div><dt className="text-xs text-muted">{t("wizard.vehicle")}</dt><dd className="font-medium">{rule.vehicleType ? t(`vehicle.${rule.vehicleType}`) : t("pricing.any")}{rule.temperature ? ` · ${t(`temp.${rule.temperature}`)}` : ""}</dd></div>
      <div><dt className="text-xs text-muted">{t("req.route")}</dt><dd className="font-medium">{route(rule)}</dd></div>
      <div><dt className="text-xs text-muted">{t("pricing.scope")}</dt><dd className="font-medium"><RuleScope id={rule.businessId} /></dd></div>
    </dl>
  );
}

/**
 * Edit a price rule. Rules are immutable records, so saving creates the next VERSION of the same scope (the active one is retired); orders already placed keep the
 * price they were quoted with. The scope cannot change here (duplicate the rule for that).
 */
export function EditRuleDialog({ rule, onClose, onSaved }: { rule: any | null; onClose: () => void; onSaved: (r: any) => void }) {
  return rule ? <EditInner key={rule.id} rule={rule} onClose={onClose} onSaved={onSaved} /> : null;
}
function EditInner({ rule, onClose, onSaved }: { rule: any; onClose: () => void; onSaved: (r: any) => void }) {
  const { t, locale } = useI18n(); const a = useAction();
  const [price, setPrice] = useState(centsToInput(rule.priceCents)); const [cost, setCost] = useState(centsToInput(rule.providerCostCents));
  const [ref, setRef] = useState(rule.agreementRef ?? ""); const [expires, setExpires] = useState(dayOf(rule.expiresAt)); const [notes, setNotes] = useState(rule.notes ?? "");
  const [err, setErr] = useState<string | null>(null); const [now] = useState(() => Date.now());
  const hist = useApi(`/admin/pricing/${rule.id}/history`, { shouldRetryOnError: false });
  const used = hist.data?.items?.find((x: any) => x.id === rule.id)?.usedBy as number | undefined;
  const p = sarToCents(price || 0), c = sarToCents(cost || 0);
  const expIso = expires ? riyadhLocalToIso(`${expires}T23:59`) : null;
  const changed = p !== rule.priceCents || c !== rule.providerCostCents || (ref || null) !== (rule.agreementRef ?? null) || dayOf(expIso) !== dayOf(rule.expiresAt) || (notes || null) !== (rule.notes ?? null);
  const valid = p > 0 && c >= 0 && c <= p && changed && (!expIso || +new Date(expIso) > now);
  const delta = pctChange(rule.priceCents, p); const big = delta !== null && Math.abs(delta) >= BIG_CHANGE_PCT;
  const row = (label: string, before: React.ReactNode, after: React.ReactNode, hot?: boolean) => (
    <tr><th scope="row" className="py-1.5 pe-3 text-start text-xs font-normal text-muted">{label}</th><td className="py-1.5 pe-3 text-end tabular-nums">{before}</td><td className={`py-1.5 text-end tabular-nums ${hot ? "font-semibold text-accent" : ""}`}>{after}</td></tr>
  );
  const submit = () => a.run("edit", () => put(`/admin/pricing/${rule.id}`, { priceCents: p, providerCostCents: c, agreementRef: ref.trim() || null, expiresAt: expIso, notes: notes.trim() || null }),
    { success: "common.saved", onDone: (r) => { onSaved(r); onClose(); }, onError: (e) => setErr(errText(e, t)) });
  return (
    <Modal open onClose={onClose} busy={a.is("edit")} title={t("rdf.pr_edit_title")} footer={<><Button variant="ghost" disabled={a.is("edit")} onClick={onClose}>{t("common.cancel")}</Button><Button data-testid="fin-pricing-edit-save" loading={a.is("edit")} disabled={!valid} onClick={submit}>{t("rdf.pr_save_version", { v: rule.version + 1 })}</Button></>}>
      <ScopeSummary rule={rule} />
      <p className="text-xs text-muted">{t("rdf.pr_scope_locked")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t("pricing.customer_sar")} type="number" step="0.01" min="0" ltr value={price} onChange={(e) => setPrice(e.target.value)} required data-testid="fin-pricing-edit-price" />
        <Input label={t("pricing.provider_sar")} type="number" step="0.01" min="0" ltr value={cost} onChange={(e) => setCost(e.target.value)} required data-testid="fin-pricing-edit-cost" />
        <Input label={t("pricing.agreement_ref")} value={ref} onChange={(e) => setRef(e.target.value)} data-testid="fin-pricing-edit-ref" />
        <Input label={t("pricing.expires")} type="date" ltr value={expires} onChange={(e) => setExpires(e.target.value)} hint={t("rdf.pr_expires_hint")} data-testid="fin-pricing-edit-expires" />
      </div>
      <Input label={t("rdf.pr_notes")} value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} data-testid="fin-pricing-edit-notes" />
      <section aria-label={t("rdf.pr_changes")} data-testid="fin-pricing-diff">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t("rdf.pr_changes")}</h3>
        <table className="w-full text-sm"><thead><tr><th className="sr-only">{t("rdf.pr_changes")}</th><th className="pb-1 text-end text-xs font-normal text-muted">{t("rdf.pr_now")} · v{rule.version}</th><th className="pb-1 text-end text-xs font-normal text-muted">{t("rdf.pr_after")} · v{rule.version + 1}</th></tr></thead><tbody className="divide-y divide-line/60">
          {row(t("pricing.customer"), <Money c={rule.priceCents} />, <>{<Money c={p} />}{delta !== null && delta !== 0 && <span className={`ms-2 text-xs ${delta > 0 ? "text-accent" : "text-gold"}`}>{delta > 0 ? "+" : ""}{delta}%</span>}</>, p !== rule.priceCents)}
          {row(t("pricing.provider"), <Money c={rule.providerCostCents} />, <Money c={c} />, c !== rule.providerCostCents)}
          {row(t("admin.margin"), <><Money c={rule.priceCents - rule.providerCostCents} /> <span className="text-xs text-muted">({marginPct(rule.priceCents, rule.providerCostCents) ?? "—"}%)</span></>, <><Money c={p - c} /> <span className="text-xs text-muted">({marginPct(p, c) ?? "—"}%)</span></>, p - c !== rule.priceCents - rule.providerCostCents)}
          {row(t("pricing.expires"), rule.expiresAt ? fmtDate(rule.expiresAt, locale) : "—", expires ? fmtDate(expIso, locale) : "—", dayOf(expIso) !== dayOf(rule.expiresAt))}
        </tbody></table>
      </section>
      <Notice tone="info">{t("rdf.pr_edit_hint", { next: rule.version + 1, cur: rule.version })}{used != null && used > 0 && <> {t("rdf.pr_used_note", { n: used })}</>}</Notice>
      {big && <Notice tone="warn"><span data-testid="fin-pricing-big-change">{t("rdf.pr_big_change", { pct: Math.abs(delta!) })}</span></Notice>}
      {c > p && <p role="alert" className="text-sm text-danger">{t("rdf.pr_cost_over")}</p>}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </Modal>
  );
}

/** Every version of a rule's scope, newest first, with who saved it and how many orders were quoted with it; an older version can be restored as the newest. */
export function RuleHistoryDialog({ rule, canEdit, onClose, onChanged }: { rule: any | null; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  return rule ? <HistoryInner key={rule.id} rule={rule} canEdit={canEdit} onClose={onClose} onChanged={onChanged} /> : null;
}
function HistoryInner({ rule, canEdit, onClose, onChanged }: { rule: any; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useI18n(); const a = useAction();
  const { data, error, mutate } = useApi(`/admin/pricing/${rule.id}/history`, { shouldRetryOnError: false });
  const [restore, setRestore] = useState<any>(null);
  const items: any[] = data?.items ?? [];
  const top = items.reduce((m, x) => Math.max(m, x.version), 0);
  return (
    <Modal open onClose={onClose} title={t("rdf.pr_history_title")}>
      <ScopeSummary rule={rule} />
      <p className="text-xs text-muted">{t("rdf.pr_history_hint")}</p>
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <Skeleton className="h-32" /> : (
        <ul className="divide-y divide-line rounded-xl border border-line" data-testid="fin-pricing-history">
          {items.map((x) => (
            <li key={x.id} className="space-y-1.5 p-3" data-testid={`fin-pricing-version-${x.version}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold"><span className="ltr-num">v{x.version}</span>{x.id === data.current && x.status === "approved" ? <Badge tone="success">{t("pricing.active")}</Badge> : x.status === "approved" ? <Badge tone="info">{t("rdf.pr_current")}</Badge> : <Badge>{t("pricing.retired")}</Badge>}</p>
                  <p className="text-xs text-muted">{fmtDateTime(x.createdAt, locale)}{x.createdByName ? ` · ${x.createdByName}` : ""}</p>
                </div>
                <div className="text-end"><p className="font-semibold"><Money c={x.priceCents} /></p><p className="text-xs text-muted">{t("pricing.provider")}: <Money c={x.providerCostCents} /> · {t("admin.margin")}: <Money c={x.priceCents - x.providerCostCents} /></p></div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>{t("rdf.pr_used")}: <b className="tabular-nums text-ink">{x.usedBy}</b>{x.expiresAt ? ` · ${t("pricing.expires")}: ${fmtDate(x.expiresAt, locale)}` : ""}{x.agreementRef ? ` · ${x.agreementRef}` : ""}</span>
                {canEdit && x.status === "retired" && <Button size="sm" variant="secondary" data-testid={`fin-pricing-restore-${x.version}`} onClick={() => setRestore(x)}><RotateCcw className="size-3.5" aria-hidden />{t("rdf.pr_restore")}</Button>}
              </div>
              {x.notes && <p className="text-xs text-muted">{x.notes}</p>}
            </li>))}
        </ul>
      )}
      <ConfirmModal open={!!restore} onClose={() => setRestore(null)} busy={a.is("restore")} title={t("rdf.pr_restore")} confirmLabel={t("rdf.pr_restore")}
        onConfirm={() => restore && a.run("restore", () => put(`/admin/pricing/${restore.id}`, {}), { success: "common.saved", onDone: () => { setRestore(null); void mutate(); onChanged(); } })}>
        <p className="text-sm">{restore && t("rdf.pr_restore_confirm", { v: restore.version, next: top + 1 })}</p>
      </ConfirmModal>
    </Modal>
  );
}
