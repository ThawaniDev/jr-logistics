"use client";
import { memo, useCallback, useMemo, useState } from "react";
import { Download, FileUp, FlaskConical, Plus, Trash2, Upload, AlertCircle, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, EmptyState, Input, Modal, Notice, Pagination, Textarea } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { fmtMoney, fmtNum } from "@/lib/format";
import { sumCod, validateCod } from "./business-fieldops-lib";
import { ImportPanel } from "./business-shipments-import";
import { DemoPickerDialog } from "./business-shipments-demo";
import { LaterPanel } from "./business-shipments-later";
import { PartnerOriginBadge, usePartnerConnections } from "./business-shipments-partner";
import { useB2bEnabled } from "./business-shipments-policy";
import {
  MAX_ROWS, duplicateRefs, emptyRow, missingDetails, needsRecipient, parseManifestCsv, templateCsv, validateRow,
  type ManifestRow, type ParsedCsv, type RowErrors, type RowField, type RType,
} from "./business-shipments-lib";

const PAGE = 20;
export type ServerRowErrors = Record<string, RowErrors>; // by row uid

interface RowProps {
  row: ManifestRow; index: number; cityLabel: string; showErrors: boolean; dupOf: number | undefined; serverErrs: RowErrors | undefined; partnerLabel?: string;
  /** "Details later": blank name / phone / address is allowed (anything typed must still be valid). */
  partial: boolean;
  /** The platform's B2B switch: off → no recipient-type choice (every parcel is an individual). */
  b2b: boolean;
  onPatch: (uid: string, p: Partial<ManifestRow>) => void; onRemove: (uid: string) => void;
}

/** One editable parcel. Memoised: typing in a row re-renders that row only (the list can hold 2000). */
const Row = memo(function Row({ row, index, cityLabel, showErrors, dupOf, serverErrs, partnerLabel, partial, b2b, onPatch, onRemove }: RowProps) {
  const { t, locale } = useI18n();
  // Rows imported from a warehouse system show their problems from the start: whatever the partner did not return must be completed before publishing
  // (unless the order is booked "details later", where it only has to be completed before hand-over).
  const imported = !!row.partnerId;
  const live = imported || showErrors ? validateRow(row, { partial }) : {};
  const needsDetails = imported && !partial && needsRecipient(row);
  const laterMissing = partial && missingDetails(row);
  const client = imported || showErrors ? live : {};
  if (showErrors && dupOf !== undefined) client.externalRef = "bs.val_ref_dup";
  const err = (f: RowField) => { const k = serverErrs?.[f] ?? client[f]; return k ? t(k) : undefined; };
  const has = !!(serverErrs && Object.keys(serverErrs).length) || Object.keys(client).length > 0;
  const types: RType[] = ["consumer", "business"];
  return (
    <li className={cn("rounded-card border bg-card p-4", has ? "border-danger/50" : "border-line")} data-testid="manifest-row">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-bg2 text-xs font-bold tabular-nums">{fmtNum(index + 1, locale)}</span>
          {b2b && (
            <div role="radiogroup" aria-label={t("bs.recipient_type")} className="inline-flex overflow-hidden rounded-xl border border-line">
              {types.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={row.recipientType === k} title={t(`rtype.${k}_hint`)} onClick={() => onPatch(row.uid, { recipientType: k })}
                  className={cn("px-3 py-1.5 text-xs transition", row.recipientType === k ? "bg-accent text-accent-ink font-semibold" : "bg-bg2 text-muted hover:text-ink")}>{t(`rtype.${k}`)}</button>
              ))}
            </div>
          )}
          {imported && <PartnerOriginBadge label={partnerLabel} />}
          {needsDetails && <Badge tone="warn"><AlertCircle className="size-3" aria-hidden />{t("intg.complete_details")}</Badge>}
          {laterMissing && <Badge tone="warn" className="" ><AlertCircle className="size-3" aria-hidden />{t("pb.details_missing")}</Badge>}
        </div>
        <Button type="button" variant="ghost" size="sm" aria-label={t("bs.remove_row", { n: index + 1 })} title={t("bs.remove_row", { n: index + 1 })} onClick={() => onRemove(row.uid)}><Trash2 className="size-4" /></Button>
      </div>
      {b2b && <p className="mb-3 text-xs text-muted">{t(`rtype.${row.recipientType}_hint`)}</p>}
      {!b2b && row.recipientType === "business" && <p className="mb-3 text-xs text-gold" data-testid="manifest-b2b-coerced">{t("jf2.b2b_coerced_row")}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t("bs.f_name")} value={row.recipientName} onChange={(e) => onPatch(row.uid, { recipientName: e.target.value })} error={err("recipientName")} maxLength={120} required={!partial} />
        <Input label={t("bs.f_phone")} type="tel" ltr inputMode="tel" value={row.recipientPhone} onChange={(e) => onPatch(row.uid, { recipientPhone: e.target.value })} error={err("recipientPhone")} maxLength={20} required={!partial} />
        <div className="sm:col-span-2"><Input label={t("bs.f_address")} value={row.address} onChange={(e) => onPatch(row.uid, { address: e.target.value })} error={err("address")} maxLength={300} required={!partial} /></div>
        <Input label={t("bs.f_ref")} ltr value={row.externalRef} onChange={(e) => onPatch(row.uid, { externalRef: e.target.value })} error={err("externalRef")} hint={t("bs.f_ref_hint")} maxLength={80} />
        <Input label={t("bs.f_contents")} value={row.contents} onChange={(e) => onPatch(row.uid, { contents: e.target.value })} error={err("contents")} maxLength={300} />
        <div className="sm:col-span-2"><Input label={t("bs.f_notes")} value={row.notes} onChange={(e) => onPatch(row.uid, { notes: e.target.value })} error={err("notes")} maxLength={500} /></div>
        <div className="sm:col-span-2"><Input label={t("fob.f_cod")} ltr inputMode="decimal" value={row.cod} onChange={(e) => onPatch(row.uid, { cod: e.target.value })} error={err("cod")} hint={t("fob.cod_hint")} maxLength={14} placeholder="0.00" data-testid="manifest-cod" /></div>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><MapPin className="size-3.5" aria-hidden />{t("bs.f_city")}: <span className="font-medium text-ink">{cityLabel}</span> <span>({t("bs.f_city_fixed")})</span></p>
      {err("city") && <p role="alert" className="mt-1 text-xs text-danger">{err("city")}</p>}
    </li>
  );
});

interface EditorProps {
  rows: ManifestRow[]; setRows: (fn: (p: ManifestRow[]) => ManifestRow[]) => void; onEdited: () => void;
  cityLabel: string; showErrors: boolean; serverErrs: ServerRowErrors; clearServerErrs: (uid: string) => void;
  /** Ask the editor to scroll to a row (bump `seq` to repeat). */
  jumpTo: { index: number; seq: number } | null;
  /** "Details later": `blank` parcels have no row at all (count only); the rows above are the ones the business filled in. */
  later?: boolean; blank?: number; onBlank?: (n: number) => void;
  /** `catalog.demoMode`: offers the demo parcel picker for `deliveryCity`. */
  demoMode?: boolean; deliveryCity?: string;
}

export function ManifestEditor({ rows, setRows, onEdited, cityLabel, showErrors, serverErrs, clearServerErrs, jumpTo, later = false, blank = 0, onBlank, demoMode = false, deliveryCity = "" }: EditorProps) {
  const { t, locale } = useI18n();
  const [page, setPage] = useState(1);
  const [seenJump, setSeenJump] = useState(0);
  const [importing, setImporting] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const b2b = useB2bEnabled();
  const { items: conns } = usePartnerConnections();
  const lookupConns = useMemo(() => conns.filter((c) => c.status === "active" && c.capabilities?.lookup), [conns]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  if (jumpTo && jumpTo.seq !== seenJump) { setSeenJump(jumpTo.seq); setPage(Math.floor(jumpTo.index / PAGE) + 1); }
  const cur = Math.min(page, pages);

  const dups = useMemo(() => duplicateRefs(rows), [rows]);
  const cod = useMemo(() => sumCod(rows), [rows]);
  const partial = later;
  const total = rows.length + blank;
  /** Parcels added with details count TOWARDS the total of a "details later" order: they use up blank slots (the total only grows once none are left). */
  const settle = useCallback((nextLen: number) => { if (later) onBlank?.(Math.max(0, total - nextLen)); }, [later, onBlank, total]);
  const onPatch = useCallback((uid: string, p: Partial<ManifestRow>) => { setRows((r) => r.map((x) => (x.uid === uid ? { ...x, ...p } : x))); clearServerErrs(uid); onEdited(); }, [setRows, clearServerErrs, onEdited]);
  const onRemove = useCallback((uid: string) => { setRows((r) => r.filter((x) => x.uid !== uid)); onEdited(); }, [setRows, onEdited]);
  const add = () => { if (rows.length >= MAX_ROWS) return; setRows((r) => [...r, emptyRow()]); settle(rows.length + 1); setPage(Math.floor(rows.length / PAGE) + 1); onEdited(); };

  const bad = useCallback((r: ManifestRow, i: number) => Object.keys(validateRow(r, { partial })).length > 0 || dups.has(i) || !!serverErrs[r.uid], [partial, dups, serverErrs]);
  const invalid = useMemo(() => (showErrors ? rows.reduce((n, r, i) => n + (bad(r, i) ? 1 : 0), 0) : 0), [rows, showErrors, bad]);
  const firstBad = () => { const i = rows.findIndex((r, ix) => bad(r, ix)); if (i >= 0) setPage(Math.floor(i / PAGE) + 1); };
  const isIncompleteImport = (r: ManifestRow) => !!r.partnerId && needsRecipient(r);
  const incomplete = useMemo(() => (later ? 0 : rows.reduce((n, r) => n + (isIncompleteImport(r) ? 1 : 0), 0)), [rows, later]);
  const firstIncomplete = () => { const i = rows.findIndex(isIncompleteImport); if (i >= 0) setPage(Math.floor(i / PAGE) + 1); };
  const appended = (add: ManifestRow[]) => { const next = [...rows, ...add].slice(0, MAX_ROWS); setRows(() => next); settle(next.length); setPage(Math.floor(rows.length / PAGE) + 1); onEdited(); };
  const addImported = (add: ManifestRow[]) => appended(add);
  const addDemo = (add: ManifestRow[], skipped: number) => {
    setDemoOpen(false);
    if (add.length > 0) appended(add);
    toast[add.length > 0 ? "success" : "info"](skipped > 0 ? t("pb.demo_added_skipped", { added: fmtNum(add.length, locale), skipped: fmtNum(skipped, locale) }) : t("pb.demo_added", { n: fmtNum(add.length, locale) }));
  };
  const existingRefs = useMemo(() => new Set(rows.map((r) => r.externalRef.trim().toLowerCase()).filter(Boolean)), [rows]);
  const start = (cur - 1) * PAGE;
  const slice = rows.slice(start, start + PAGE);
  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([templateCsv(b2b)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "jr-shipments-template.csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const room = MAX_ROWS - rows.length;
  return (
    <div className="space-y-4">
      {conns.length > 0 && <ImportPanel connections={lookupConns} rows={rows} room={room} onAdd={addImported} ordersSource deliveryCity={deliveryCity} />}
      {later && <LaterPanel detailed={rows.length} blank={blank} onBlank={(n) => { onBlank?.(n); onEdited(); }} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" data-testid="add-row" onClick={add} disabled={room <= 0}><Plus className="size-4" />{later ? t("pb.add_detailed_row") : t("bs.add_row")}</Button>
        <Button type="button" size="sm" variant="secondary" data-testid="import-csv" onClick={() => setImporting(true)}><FileUp className="size-4" />{t("bs.import_csv")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={downloadTemplate}><Download className="size-4" />{t("bs.template")}</Button>
        {demoMode && (
          <span className="inline-flex items-center gap-2">
            <Button type="button" size="sm" variant="gold" data-testid="demo-open" disabled={room <= 0} onClick={() => setDemoOpen(true)}><FlaskConical className="size-4" aria-hidden />{t("pb.demo_btn")}</Button>
            <Badge tone="warn" className="uppercase tracking-wide">{t("pb.demo_label")}</Badge>
          </span>
        )}
        {total > 0 && <Button type="button" size="sm" variant="ghost" className="ms-auto text-danger" onClick={() => setConfirmClear(true)}><Trash2 className="size-4" />{t("bs.clear_all")}</Button>}
      </div>
      <p className="text-xs text-muted">{t("bs.max_rows", { n: fmtNum(MAX_ROWS, locale) })}</p>
      {cod.parcels > 0 && <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-gold" data-testid="manifest-cod-total" role="status">{t("fob.cod_total_line", { amount: fmtMoney(cod.totalCents, locale), n: fmtNum(cod.parcels, locale) })}</p>}
      {incomplete > 0 && (
        <Notice tone="warn" title={t("intg.rows_incomplete", { n: incomplete })}>
          {t("intg.rows_incomplete_hint")} <button type="button" onClick={firstIncomplete} className="font-semibold underline">{t("bs.go_first_error")}</button>
        </Notice>
      )}
      {showErrors && invalid > 0 && (
        <Notice tone="danger" title={t("bs.rows_invalid", { n: invalid })}>
          <button type="button" onClick={firstBad} className="font-semibold underline">{t("bs.go_first_error")}</button>
        </Notice>
      )}
      {rows.length === 0 ? (later ? null : (
        <EmptyState title={t("bs.empty_title")} hint={t("bs.empty_hint")} icon={<Upload className="size-9" aria-hidden />}
          action={<div className="flex flex-wrap justify-center gap-2"><Button type="button" size="sm" onClick={add}><Plus className="size-4" />{t("bs.add_row")}</Button><Button type="button" size="sm" variant="secondary" onClick={() => setImporting(true)}><FileUp className="size-4" />{t("bs.import_csv")}</Button></div>} />
      )) : (
        <>
          <ol className="space-y-3" start={start + 1} aria-label={t("bs.rows_label")}>
            {slice.map((r, i) => <Row key={r.uid} row={r} index={start + i} cityLabel={cityLabel} showErrors={showErrors} dupOf={dups.get(start + i)} serverErrs={serverErrs[r.uid]} partial={partial} b2b={b2b} partnerLabel={r.partnerId ? conns.find((c) => c.id === r.partnerId)?.name : undefined} onPatch={onPatch} onRemove={onRemove} />)}
          </ol>
          <Pagination page={cur} total={rows.length} pageSize={PAGE} onPage={setPage} />
        </>
      )}
      {importing && <ImportDialog existing={rows} partial={partial} b2b={b2b} onClose={() => setImporting(false)} onAdd={(add, replace) => { const next = [...(replace ? [] : rows), ...add].slice(0, MAX_ROWS); setRows(() => next); settle(next.length); onEdited(); setImporting(false); setPage(1); }} />}
      {demoOpen && <DemoPickerDialog b2b={b2b} city={deliveryCity} cityLabel={cityLabel} existingRefs={existingRefs} room={room} onClose={() => setDemoOpen(false)} onAdd={addDemo} />}
      <Modal open={confirmClear} onClose={() => setConfirmClear(false)} title={t("bs.clear_all")} footer={<><Button variant="ghost" onClick={() => setConfirmClear(false)}>{t("common.cancel")}</Button><Button variant="danger" onClick={() => { setRows(() => []); if (later) onBlank?.(0); onEdited(); setConfirmClear(false); }}>{t("bs.clear_confirm")}</Button></>}>
        <Notice tone="warn">{t("bs.clear_note", { n: total })}</Notice>
      </Modal>
    </div>
  );
}

const PREVIEW_LIMIT = 100;

/** Paste or upload → parse → preview with per-row problems → add. Mount only while open. */
function ImportDialog({ existing, partial, b2b, onClose, onAdd }: { existing: ManifestRow[]; partial: boolean; b2b: boolean; onClose: () => void; onAdd: (rows: ManifestRow[], replace: boolean) => void }) {
  const { t, locale } = useI18n();
  const [text, setText] = useState(""); const [parsed, setParsed] = useState<ParsedCsv | null>(null); const [replace, setReplace] = useState(false); const [fileErr, setFileErr] = useState(false);
  const refs = useMemo(() => { const m = new Map<string, number>(); existing.forEach((r, i) => { const k = r.externalRef.trim().toLowerCase(); if (k && !m.has(k)) m.set(k, i); }); return m; }, [existing]);
  const run = (src: string, rep = replace) => setParsed(parseManifestCsv(src, rep ? new Map() : refs, { partial, b2b }));
  const onFile = async (f: File | undefined) => {
    if (!f) return; setFileErr(false);
    if (f.size > 5 * 1024 * 1024) { setFileErr(true); return; }
    const src = await f.text(); setText(src); run(src);
  };
  const ok = parsed?.rows.filter((r) => Object.keys(r.errors).length === 0) ?? [];
  const bad = (parsed?.rows.length ?? 0) - ok.length;
  const room = MAX_ROWS - (replace ? 0 : existing.length);
  const addList = (list: ManifestRow[]) => onAdd(list.slice(0, Math.max(0, room)), replace);
  const over = (parsed?.rows.length ?? 0) > room;
  return (
    <Modal open onClose={onClose} title={t("bs.import_title")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        {parsed && bad > 0 && ok.length < parsed.rows.length && <Button variant="secondary" disabled={room <= 0} onClick={() => addList(parsed.rows.map((r) => r.row))}>{t("bs.import_add_all", { n: parsed.rows.length })}</Button>}
        <Button disabled={!parsed || ok.length === 0 || room <= 0} onClick={() => addList(ok.map((r) => r.row))}>{t("bs.import_add_valid", { n: ok.length })}</Button>
      </>}>
      <p className="text-sm text-muted">{t(b2b ? "bs.import_help" : "jf2.import_help_c")}</p>
      <p className="text-sm text-muted" data-testid="import-cod-help">{t("fob.import_cod_help")}</p>
      <Textarea label={t("bs.import_paste")} dir="ltr" className="font-mono text-xs" rows={6} value={text} onChange={(e) => { setText(e.target.value); setParsed(null); }} placeholder={b2b ? "name,phone,address,type,ref,contents,notes,cod\nMona Ali,0555555555,King Fahd Rd 120 Riyadh,consumer,ORD-1001,Clothes,Gate 2,120.50" : "name,phone,address,ref,contents,notes,cod\nMona Ali,0555555555,King Fahd Rd 120 Riyadh,ORD-1001,Clothes,Gate 2,120.50"} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-xl border border-line bg-bg2 px-3 text-xs hover:border-accent/60">
          <Upload className="size-4" aria-hidden />{t("bs.import_file")}
          <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <Button size="sm" disabled={!text.trim()} onClick={() => run(text)}>{t("bs.import_preview")}</Button>
        {existing.length > 0 && (
          <label className="ms-auto flex cursor-pointer items-center gap-2 text-xs text-muted"><input type="checkbox" className="size-4 accent-[var(--jr-accent)]" checked={replace} onChange={(e) => { setReplace(e.target.checked); if (parsed && text.trim()) run(text, e.target.checked); }} />{t("bs.import_replace")}</label>
        )}
      </div>
      {fileErr && <Notice tone="danger">{t("bs.import_file_big")}</Notice>}
      {parsed && parsed.rows.length === 0 && <Notice tone="warn">{t("bs.import_none")}</Notice>}
      {parsed && parsed.rows.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="success">{t("bs.import_valid", { n: ok.length })}</Badge>
            {bad > 0 && <Badge tone="danger">{t("bs.import_invalid", { n: bad })}</Badge>}
            <span className="text-xs text-muted">{parsed.header ? t("bs.import_header_yes") : t("bs.import_header_no")}</span>
          </div>
          {over && <Notice tone="warn">{t("bs.import_over", { n: fmtNum(MAX_ROWS, locale) })}</Notice>}
          {parsed.coerced > 0 && <Notice tone="info"><span data-testid="import-b2b-coerced">{t("jf2.b2b_coerced_import", { n: fmtNum(parsed.coerced, locale) })}</span></Notice>}
          <div className="max-h-72 overflow-auto rounded-card border border-line">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="sticky top-0 bg-bg2 text-muted"><tr>{["#", t("bs.f_name"), t("bs.f_phone"), t("bs.f_address"), ...(b2b ? [t("bs.recipient_type")] : []), t("bs.f_ref"), t("fob.f_cod_short"), t("bs.import_problems")].map((h, i) => <th key={i} scope="col" className="px-3 py-2 text-start font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {parsed.rows.slice(0, PREVIEW_LIMIT).map((p) => {
                  const e = Object.entries(p.errors) as Array<[RowField, string]>;
                  return (
                    <tr key={p.row.uid} className={e.length ? "bg-danger/5" : undefined}>
                      <td className="px-3 py-1.5 tabular-nums text-muted">{p.line}</td><td className="px-3 py-1.5">{p.row.recipientName || "—"}</td><td className="ltr-num px-3 py-1.5" dir="ltr">{p.row.recipientPhone || "—"}</td>
                      <td className="max-w-[220px] truncate px-3 py-1.5" title={p.row.address}>{p.row.address || "—"}</td>{b2b && <td className="px-3 py-1.5">{t(`rtype.${p.row.recipientType}`)}</td>}<td className="ltr-num px-3 py-1.5" dir="ltr">{p.row.externalRef || "—"}</td>
                      <td className="ltr-num px-3 py-1.5 tabular-nums" dir="ltr" data-testid="import-cod-cell">{p.row.cod ? (validateCod(p.row.cod).error ? p.row.cod : fmtMoney(validateCod(p.row.cod).cents, locale)) : "—"}</td>
                      <td className="px-3 py-1.5 text-danger">{e.length ? <ul className="space-y-0.5">{e.map(([f, k]) => <li key={f} className="flex items-start gap-1"><AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden />{f === "cod" ? t("fob.fld_cod") : t(`bs.fld_${f}`)}: {t(k)}</li>)}</ul> : "✓"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {parsed.rows.length > PREVIEW_LIMIT && <p className="text-xs text-muted">{t("bs.import_more", { n: parsed.rows.length - PREVIEW_LIMIT })}</p>}
        </div>
      )}
    </Modal>
  );
}
