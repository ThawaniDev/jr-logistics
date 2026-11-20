"use client";
import { useState } from "react";
import { Plus, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Input, Notice, Select, Table, Td, errText } from "@/components/ui";
import { patch } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { tx, type EventKind, type JrEvent } from "./business-shipments-partner";
import {
  EMPTY_OUT, KINDS, OUT_DEFAULT, OUT_NONE, checkNewKey, connApi, decodeOut, encodeOut, importChoice, inPatch, inRows, modeOf, outOptions, outPatch, outRows, pollOptions, statusKey,
  type InDraft, type KeyProblem, type OutDraft,
} from "./partner-conn-lib";
import { Section, Switch, Toggle, When, useBeforeUnloadWarning, type TFn } from "./partner-conn-parts";
import { useConnection } from "./partner-conn-detail";

const EV_LABEL = (t: TFn, ev: JrEvent) => tx(t, `iv2.ev_${ev}`, ev.replace(/_/g, " "));
const EV_HINT = (t: TFn, ev: JrEvent) => tx(t, `iv2.evh_${ev}`, "");
const KIND_LABEL = (t: TFn, k: EventKind) => tx(t, `iv2.kind_${k}`, k);
/** A translation with variables, or the fallback when the key does not exist. */
const txv = (t: TFn, key: string, vars: Record<string, string>, fallback: string) => { const s = t(key, vars); return s === key ? fallback : s; };

/**
 * Sync & statuses: (a) what JR writes back for each JR event (switch + the partner status to send), (b) how JR reads each partner status,
 * (c) behaviour (import new orders, cancel automatically, poll interval). The two tables keep a draft and save once; behaviour switches save at once.
 */
export function SyncTab() {
  const { conn } = useConnection();
  return (
    <div className="space-y-6" data-testid="sync-tab">
      <Outbound key={`out-${conn.id}`} />
      <Inbound key={`in-${conn.id}`} />
      <Behaviour />
    </div>
  );
}

// ───────── (a) outbound ─────────
function Outbound() {
  const { t } = useI18n();
  const { scope, conn, provider, name, reload } = useConnection();
  const [draft, setDraft] = useState<OutDraft>(EMPTY_OUT); const [busy, setBusy] = useState(false);
  const rows = outRows(conn, provider, draft);
  const changes = outPatch(conn, draft);
  const vocab = conn.statusOutOptions.length > 0;
  const realActions = modeOf(conn) === "merchant";
  const ro = !scope.canManage;
  useBeforeUnloadWarning(!!changes, t("iv2.unsaved_leave"));
  if (rows.length === 0) return (
    <Section title={t("iv2.out_title", { name })}><Notice tone="info">{t("iv2.out_nothing", { name })}</Notice></Section>
  );
  const options = [...outOptions(conn, rows)];
  const save = async () => {
    if (!changes) return;
    setBusy(true);
    try { await patch(connApi(scope, conn.id), { settings: changes }); toast.success(t("common.saved")); await reload(); setDraft(EMPTY_OUT); }
    catch (e) { toast.error(errText(e, t)); } finally { setBusy(false); }
  };
  // Merchant systems without a status vocabulary run a real action per event (cancel / return): say what it does in their words.
  const label = (ev: JrEvent) => (realActions && !vocab ? txv(t, `intg.sync_${ev}`, { name }, EV_LABEL(t, ev)) : EV_LABEL(t, ev));
  const hint = (ev: JrEvent) => (realActions && !vocab ? txv(t, `intg.sync_${ev}_hint`, { name }, EV_HINT(t, ev)) : EV_HINT(t, ev));
  return (
    <Section title={t("iv2.out_title", { name })} hint={vocab ? t("iv2.out_sub_vocab", { name }) : realActions ? t("iv2.out_sub_actions", { name }) : t("iv2.out_sub_events", { name })} testId="sync-outbound">
      {realActions && !vocab && <Notice tone="warn" title={t("iv2.out_actions_title")}>{t("iv2.out_actions_warn", { name })}</Notice>}
      <Table stack dense label={t("iv2.out_title", { name })} head={[t("iv2.col_event"), { label: t("iv2.col_send"), align: "center" }, ...(vocab ? [t("iv2.col_partner_status", { name })] : [])]}>
        {rows.map((r) => {
          const def = r.defaultCode ? options.find((o) => o.value === r.defaultCode)?.label ?? r.defaultCode : null;
          return (
            <tr key={r.ev} data-testid={`out-row-${r.ev}`} className={r.changed ? "bg-gold/[0.06]" : undefined}>
              <Td label={t("iv2.col_event")}>
                <p className="font-medium" id={`out-${r.ev}`}>{label(r.ev)}</p>
                {hint(r.ev) && <p className="mt-0.5 max-w-md text-xs text-muted">{hint(r.ev)}</p>}
              </Td>
              <Td label={t("iv2.col_send")} align="center">
                <div className="flex justify-end sm:justify-center"><Switch checked={r.sync} labelledBy={`out-${r.ev}`} disabled={ro || busy} testId={`set-sync-${r.ev}`} onChange={(v) => setDraft((d) => ({ ...d, sync: { ...d.sync, [r.ev]: v } }))} /></div>
              </Td>
              {vocab && (
                <Td label={t("iv2.col_partner_status", { name })} className="min-w-56">
                  <Select aria-label={t("iv2.out_select_label", { event: EV_LABEL(t, r.ev), name })} data-testid={`status-out-${r.ev}`} disabled={ro || busy} value={encodeOut(r.choice)}
                    onChange={(e) => setDraft((d) => ({ ...d, statusOut: { ...d.statusOut, [r.ev]: decodeOut(e.target.value) } }))}
                    options={[
                      { value: OUT_DEFAULT, label: def ? t("iv2.out_default", { status: def }) : t("iv2.out_default_none") },
                      { value: OUT_NONE, label: t("iv2.out_none") },
                      ...options.map((o) => ({ value: o.value, label: o.label === o.value ? o.value : `${o.label} (${o.value})` })),
                    ]} />
                  <p className="mt-1 text-xs text-muted" data-testid={`status-eff-${r.ev}`}>
                    {!r.sync ? t("iv2.out_off") : r.effective ? <>{t("iv2.out_sends")} <code dir="ltr" className="text-cyan">{r.effective}</code></> : t("iv2.out_sends_nothing")}
                  </p>
                </Td>
              )}
            </tr>
          );
        })}
      </Table>
      {!ro && <SaveBar dirty={!!changes} busy={busy} onSave={save} onDiscard={() => setDraft(EMPTY_OUT)} testId="save-outbound" />}
    </Section>
  );
}

// ───────── (b) inbound ─────────
const KEY_PROBLEM: Record<KeyProblem, string> = { empty: "val.required", too_long: "iv2.in_key_too_long", exists: "iv2.in_key_exists" };
function Inbound() {
  const { t, locale } = useI18n();
  const { scope, conn, provider, name, reload } = useConnection();
  const [draft, setDraft] = useState<InDraft>({}); const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState(""); const [newKind, setNewKind] = useState<EventKind>("cancelled"); const [keyErr, setKeyErr] = useState<string | null>(null);
  const rows = inRows(conn, provider, draft);
  const changes = inPatch(conn, provider, draft);
  const ro = !scope.canManage;
  useBeforeUnloadWarning(!!changes, t("iv2.unsaved_leave"));
  const save = async () => {
    if (!changes) return;
    setBusy(true);
    try { await patch(connApi(scope, conn.id), { settings: { statusIn: changes } }); toast.success(t("common.saved")); await reload(); setDraft({}); }
    catch (e) { toast.error(errText(e, t)); } finally { setBusy(false); }
  };
  const add = () => {
    const p = checkNewKey(newKey, rows);
    if (p) { setKeyErr(t(KEY_PROBLEM[p])); return; }
    setDraft((d) => ({ ...d, [statusKey(newKey)]: newKind })); setNewKey(""); setKeyErr(null);
  };
  const kindOptions = (documented: EventKind | null) => KINDS.map((k) => ({ value: k, label: documented === k ? `${KIND_LABEL(t, k)} · ${t("iv2.documented")}` : KIND_LABEL(t, k) }));
  const catalogPending = conn.provider === "logestechs" && !conn.runtime.statusCatalogAt;
  const caps = conn.capabilities;
  // Carrier APIs such as Omniful send shipments and cancel calls, never status strings: there is nothing to map.
  if (!caps || !(caps.webhookIn || caps.track || caps.pollOrders)) return (
    <Section title={t("iv2.in_title", { name })} testId="sync-inbound"><Notice tone="info"><span data-testid="in-api-only">{t("iv2.in_api_only", { name })}</span></Notice></Section>
  );
  return (
    <Section title={t("iv2.in_title", { name })} hint={t("iv2.in_sub", { name })} testId="sync-inbound">
      <Notice tone="info">{t("iv2.in_only_cancel")}</Notice>
      {catalogPending && <p className="text-xs text-muted" data-testid="in-catalog-pending">{t("iv2.in_catalog_pending", { name })}</p>}
      {conn.runtime.statusCatalogAt && <p className="text-xs text-muted">{t("iv2.in_catalog_at", { name })} <When at={conn.runtime.statusCatalogAt} /></p>}
      <Table stack dense label={t("iv2.in_title", { name })} head={[t("iv2.col_partner_status_in", { name }), t("iv2.col_meaning"), { label: t("iv2.col_actions"), srOnly: true, align: "end" }]}
        empty={rows.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted" data-testid="in-none">{t("iv2.in_none", { name })}</p> : undefined}>
        {rows.map((r) => {
          const shown = (locale === "ar" && r.labelAr) || r.label || null;
          return (
            <tr key={r.key} data-testid={`in-row-${r.key}`} className={r.removed ? "opacity-60" : r.changed ? "bg-gold/[0.06]" : undefined}>
              <Td label={t("iv2.col_partner_status_in", { name })}>
                <p className={`font-medium ${r.removed ? "line-through" : ""}`} dir="auto">{shown ?? <code dir="ltr">{r.value}</code>}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {shown && <code dir="ltr" className="text-cyan">{r.value}</code>}
                  {r.custom && <Badge tone="neutral" className="px-1.5 py-0 text-[10px]">{t("iv2.in_custom")}</Badge>}
                </p>
              </Td>
              <Td label={t("iv2.col_meaning")} className="min-w-52">
                <Select aria-label={t("iv2.in_select_label", { status: r.value })} data-testid={`status-in-${r.key}`} disabled={ro || busy || r.removed} value={r.kind} options={kindOptions(r.documented)}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value as EventKind }))} />
                {r.kind === "cancelled" && !r.removed && <p className="mt-1 text-xs text-gold">{conn.settings.autoCancel ? t("iv2.in_cancel_acts") : t("iv2.in_cancel_off")}</p>}
              </Td>
              <Td label={t("iv2.col_actions")} align="end">
                {r.custom && !ro && (r.removed
                  ? <Button size="sm" variant="ghost" onClick={() => setDraft((d) => { const n = { ...d }; delete n[r.key]; return n; })} data-testid={`status-in-undo-${r.key}`}><Undo2 className="size-4" aria-hidden />{t("iv2.undo")}</Button>
                  : <Button size="sm" variant="ghost" aria-label={t("iv2.in_remove", { status: r.value })} onClick={() => setDraft((d) => {
                      const saved = r.key in (conn.settings.statusIn ?? {});
                      const n = { ...d }; if (saved) n[r.key] = null; else delete n[r.key]; return n;
                    })} data-testid={`status-in-remove-${r.key}`}><Trash2 className="size-4" aria-hidden /></Button>)}
              </Td>
            </tr>
          );
        })}
      </Table>
      {!ro && (
        <form className="grid gap-3 rounded-xl border border-dashed border-line p-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end" noValidate onSubmit={(e) => { e.preventDefault(); add(); }} data-testid="status-in-add-row">
          <Input label={t("iv2.in_add_key")} hint={keyErr ? undefined : t("iv2.in_add_key_hint", { name })} error={keyErr ?? undefined} ltr value={newKey} maxLength={80} onChange={(e) => { setNewKey(e.target.value); setKeyErr(null); }} data-testid="status-in-new-key" placeholder="DELIVERED" />
          <Select label={t("iv2.col_meaning")} value={newKind} options={kindOptions(null)} onChange={(e) => setNewKind(e.target.value as EventKind)} data-testid="status-in-new-kind" />
          <Button type="submit" variant="secondary" data-testid="status-in-add" className="sm:mb-[1px]"><Plus className="size-4" aria-hidden />{t("iv2.in_add")}</Button>
        </form>
      )}
      {!ro && <SaveBar dirty={!!changes} busy={busy} onSave={save} onDiscard={() => setDraft({})} testId="save-inbound" />}
    </Section>
  );
}

// ───────── (c) behaviour ─────────
function Behaviour() {
  const { t } = useI18n();
  const { scope, conn, provider, name, reload } = useConnection();
  const [busy, setBusy] = useState<string | null>(null);
  const ro = !scope.canManage;
  const caps = conn.capabilities;
  const imp = importChoice(conn);
  const polls = pollOptions(provider, conn.settings.pollMinutes);
  const set = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    try { await patch(connApi(scope, conn.id), { settings: body }); toast.success(t("common.saved")); await reload(); }
    catch (e) { toast.error(errText(e, t)); } finally { setBusy(null); }
  };
  const inbound = !!caps && (caps.webhookIn || caps.track || caps.pollOrders || caps.carrierApi);
  const pollLabel = (n: number) => (n === 0 ? t("iv2.poll_off") : n % 60 === 0 ? t("iv2.poll_hours", { n: n / 60 }) : t("iv2.poll_minutes", { n }));
  return (
    <Section title={t("iv2.behaviour_title")} hint={t("iv2.behaviour_sub", { name })} testId="sync-behaviour">
      <div className="divide-y divide-line">
        {imp === "always" && (
          <div className="flex items-start justify-between gap-4 py-3" data-testid="import-always">
            <div className="min-w-0"><p className="text-sm font-medium">{t("iv2.import_new")}</p><p className="mt-0.5 text-xs text-muted">{t("iv2.import_always_hint", { name })}</p></div>
            <Badge tone="success">{t("iv2.always_on")}</Badge>
          </div>
        )}
        {imp === "toggle" && <Toggle testId="set-importNew" checked={conn.settings.importNew} busy={busy === "importNew"} disabled={ro} onChange={(v) => set("importNew", { importNew: v })} label={t("iv2.import_new")} hint={t("iv2.import_new_hint", { name })} />}
        {inbound && <Toggle testId="set-autoCancel" checked={conn.settings.autoCancel} busy={busy === "autoCancel"} disabled={ro} onChange={(v) => set("autoCancel", { autoCancel: v })} label={t("intg.set_autocancel")} hint={t("intg.set_autocancel_hint", { name })} />}
        {polls.length > 0 && (
          <div className="flex flex-wrap items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium" id="poll-label">{t("iv2.poll_title")}</p>
              <p className="mt-0.5 text-xs text-muted">{t("iv2.poll_hint", { name })}</p>
              <p className="mt-0.5 text-xs text-muted">{t("iv2.last_poll")}: <When at={conn.lastPollAt} /></p>
            </div>
            <div className="w-48">
              <Select aria-labelledby="poll-label" data-testid="set-pollMinutes" disabled={ro || busy === "poll"} value={String(conn.settings.pollMinutes)} options={polls.map((n) => ({ value: String(n), label: pollLabel(n) }))}
                onChange={(e) => set("poll", { pollMinutes: Number(e.target.value) })} />
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function SaveBar({ dirty, busy, onSave, onDiscard, testId }: { dirty: boolean; busy: boolean; onSave: () => void; onDiscard: () => void; testId: string }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
      {dirty && <span className="me-auto text-xs font-medium text-gold" role="status">{t("iv2.unsaved")}</span>}
      <Button type="button" variant="ghost" size="sm" disabled={!dirty || busy} onClick={onDiscard}><RotateCcw className="size-4" aria-hidden />{t("iv2.discard")}</Button>
      <Button type="button" size="sm" loading={busy} disabled={!dirty} onClick={onSave} data-testid={testId}>{t("iv2.save_changes")}</Button>
    </div>
  );
}
