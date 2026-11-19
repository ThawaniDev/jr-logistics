"use client";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { AlertCircle, AlertTriangle, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, ErrorState, Input, Modal, Notice, PageLoading, Pagination, Tabs, Textarea, errText, useAction } from "@/components/ui";
import { ApiError, patch } from "@/lib/api";
import { fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import {
  BULK_MAX, bulkWire, detailsMissing, hasBulkInput, incompleteSheetCsv, loadAllShipments, mapServerBulkErrors, parseBulkCsv, validateDetails,
  type BulkCsv, type BulkEdit, type ShipmentItem,
} from "./business-shipments-lib";

const PAGE = 20;
const PREVIEW_LIMIT = 100;
/** Request states in which a parcel that has not left the warehouse can still be changed (mirrors the server). */
export const DETAILS_EDITABLE = ["draft", "published", "filling", "assigned", "confirmed", "in_progress"];

interface SaveResult { updated: number; completed: number; stillIncomplete: number }
type FieldKey = keyof BulkEdit;
type Errs = Record<string, Record<string, string>>;
/** A problem that is not about one field (parcel not found / already with the driver / …). */
interface Failure { text: string }

/** Prominent banner on the request page while parcels still lack recipient details. */
export function IncompleteBanner({ n, onComplete }: { n: number; onComplete: () => void }) {
  const { t, locale } = useI18n();
  if (n <= 0) return null;
  return (
    <div data-testid="incomplete-banner">
      <Notice tone="warn" title={t("pb.banner_title", { n: fmtNum(n, locale) })}>
        <p>{t("pb.banner_body")}</p>
        <Button size="sm" className="mt-3" data-testid="complete-details-btn" onClick={onComplete}><AlertTriangle className="size-4" aria-hidden />{t("pb.complete_details")}</Button>
      </Notice>
    </div>
  );
}

/** PATCH in chunks of the server's limit (each chunk is all-or-nothing); a failure says which chunk it was in via `offset`. */
async function sendRows(requestId: string, rows: Array<ReturnType<typeof bulkWire>>, fail: (e: unknown, offset: number) => void): Promise<SaveResult> {
  const sum: SaveResult = { updated: 0, completed: 0, stillIncomplete: 0 };
  for (let i = 0; i < rows.length; i += BULK_MAX) {
    try {
      const r = await patch<SaveResult>(`/requests/${requestId}/shipments`, { rows: rows.slice(i, i + BULK_MAX) });
      sum.updated += r.updated; sum.completed += r.completed; sum.stillIncomplete = r.stillIncomplete;
    } catch (e) { fail(e, i); throw e; }
  }
  return sum;
}

interface DialogProps { requestId: string; onClose: () => void; onChanged: () => void }

/** Fill in the recipients of parcels booked "details later": inline for a handful, or paste / upload a sheet for many. Mount only while open. */
export function CompleteDetailsDialog({ requestId, onClose, onChanged }: DialogProps) {
  const { t, locale } = useI18n();
  const { data, error, mutate } = useSWR(`shipments-all:${requestId}`, () => loadAllShipments(requestId), { revalidateOnFocus: false });
  const [tab, setTab] = useState<"inline" | "csv">("inline");
  const incomplete = useMemo(() => (data ?? []).filter((s) => s.status === "pending" && detailsMissing(s)), [data]);
  const saved = (r: SaveResult) => {
    toast.success(t("pb.cd_saved", { updated: fmtNum(r.updated, locale), completed: fmtNum(r.completed, locale), left: fmtNum(r.stillIncomplete, locale) }));
    void mutate(); onChanged();
    if (r.stillIncomplete === 0) { toast.success(t("pb.cd_all_done")); onClose(); }
  };
  return (
    <Modal open onClose={onClose} title={t("pb.cd_title")} footer={<Button variant="ghost" data-testid="complete-close" onClick={onClose}>{t("common.close")}</Button>}>
      <div data-testid="complete-dialog" className="space-y-4">
        {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : (
          <>
            <p className="text-sm text-muted" data-testid="complete-count">{incomplete.length > 0 ? t("pb.cd_count", { n: fmtNum(incomplete.length, locale) }) : t("pb.cd_none")}</p>
            <Tabs label={t("pb.cd_title")} value={tab} onChange={(k) => setTab(k as "inline" | "csv")} tabs={[{ key: "inline", label: t("pb.cd_tab_inline") }, { key: "csv", label: t("pb.cd_tab_csv") }]} />
            {tab === "inline" ? <InlineTab requestId={requestId} items={incomplete} onSaved={saved} /> : <CsvTab requestId={requestId} all={data} incomplete={incomplete} onSaved={saved} />}
          </>
        )}
      </div>
    </Modal>
  );
}

// ───────── (a) inline list, ~20 parcels per page ─────────
function InlineTab({ requestId, items, onSaved }: { requestId: string; items: ShipmentItem[]; onSaved: (r: SaveResult) => void }) {
  const { t, locale } = useI18n(); const a = useAction();
  const [edits, setEdits] = useState<Record<string, Partial<BulkEdit>>>({});
  const [page, setPage] = useState(1); const [showErrs, setShowErrs] = useState(false);
  const [rowErrs, setRowErrs] = useState<Errs>({}); const [failure, setFailure] = useState<Failure | null>(null);
  const pages = Math.max(1, Math.ceil(items.length / PAGE)); const cur = Math.min(page, pages);
  const slice = items.slice((cur - 1) * PAGE, cur * PAGE);
  const touched = items.filter((s) => hasBulkInput(edits[s.id]));
  const clientErrs = (s: ShipmentItem) => validateDetails({ recipientName: edits[s.id]?.recipientName, recipientPhone: edits[s.id]?.recipientPhone, address: edits[s.id]?.address }, true);
  const valueOf = (s: ShipmentItem, f: FieldKey) => edits[s.id]?.[f] ?? s[f] ?? "";
  const set = (s: ShipmentItem, f: FieldKey, v: string) => { setEdits((p) => ({ ...p, [s.id]: { ...p[s.id], [f]: v } })); setRowErrs((p) => { if (!p[s.id]) return p; const { [s.id]: _d, ...rest } = p; return rest; }); setFailure(null); };

  const save = () => {
    const bad = touched.findIndex((s) => Object.keys(clientErrs(s)).length > 0);
    if (bad >= 0) { setShowErrs(true); setPage(Math.floor(items.findIndex((s) => s.id === touched[bad].id) / PAGE) + 1); return; }
    if (touched.length === 0) return;
    setRowErrs({}); setFailure(null);
    const ids = touched.map((s) => s.id); const rows = touched.map((s) => bulkWire(s.id, edits[s.id]));
    void a.run("save", () => sendRows(requestId, rows, (e, offset) => {
      if (!(e instanceof ApiError)) return;
      const mapped = mapServerBulkErrors(e.details); const byId: Errs = {}; let first: string | null = null;
      mapped.forEach((v, i) => { const id = ids[offset + i]; if (id) { byId[id] = v; first ??= id; } });
      const row = typeof e.details.row === "number" ? ids[offset + e.details.row - 1] : null;
      if (!first && row) first = row;
      setRowErrs(byId); setShowErrs(true);
      const where = first ? items.find((s) => s.id === first) : null;
      setFailure({ text: errText(e, t) + (where ? ` — ${t("pb.cd_failed_at", { where: where.code })}` : "") });
      if (first) setPage(Math.floor(items.findIndex((s) => s.id === first) / PAGE) + 1);
    }), { onDone: (r) => { setEdits({}); setShowErrs(false); onSaved(r); } });
  };

  if (items.length === 0) return <Notice tone="success">{t("pb.cd_none")}</Notice>;
  return (
    <div className="space-y-4" data-testid="complete-inline">
      <p className="text-xs text-muted">{t("pb.cd_inline_help")}</p>
      {failure && <Notice tone="danger"><span data-testid="complete-error">{failure.text}</span></Notice>}
      <ul className="space-y-3" aria-label={t("pb.cd_list_label")}>
        {slice.map((s) => {
          const client = showErrs ? clientErrs(s) : {}; const server = rowErrs[s.id] ?? {};
          const err = (f: FieldKey) => { const k = server[f] ?? (client as Record<string, string>)[f]; return k ? t(k) : undefined; };
          const bad = Object.keys(server).length > 0 || Object.keys(client).length > 0;
          return (
            <li key={s.id} data-testid="complete-row" data-code={s.code} className={cn("rounded-card border bg-card p-3", bad ? "border-danger/50" : "border-line")}>
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span className="ltr-num text-sm font-semibold text-ink" dir="ltr">{s.code}</span>
                {s.externalRef && <span className="ltr-num" dir="ltr">{s.externalRef}</span>}
                {s.contents && <span>{s.contents}</span>}
                {hasBulkInput(edits[s.id]) && <Badge tone="info">{t("pb.cd_edited")}</Badge>}
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr]">
                <Input label={t("bs.f_name")} data-testid="complete-name" value={valueOf(s, "recipientName")} onChange={(e) => set(s, "recipientName", e.target.value)} error={err("recipientName")} maxLength={120} autoComplete="off" />
                <Input label={t("bs.f_phone")} data-testid="complete-phone" type="tel" ltr inputMode="tel" value={valueOf(s, "recipientPhone")} onChange={(e) => set(s, "recipientPhone", e.target.value)} error={err("recipientPhone")} maxLength={20} autoComplete="off" />
                <Input label={t("bs.f_address")} data-testid="complete-address" value={valueOf(s, "address")} onChange={(e) => set(s, "address", e.target.value)} error={err("address")} maxLength={300} autoComplete="off" />
              </div>
              {server.id && <p role="alert" className="mt-2 text-xs text-danger">{t(server.id)}</p>}
            </li>
          );
        })}
      </ul>
      <Pagination page={cur} total={items.length} pageSize={PAGE} onPage={setPage} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <span className="text-sm text-muted tabular-nums" aria-live="polite">{t("pb.cd_edited_n", { n: fmtNum(touched.length, locale) })}</span>
        <Button data-testid="complete-save-all" loading={a.is("save")} disabled={touched.length === 0} onClick={save}>{t("pb.cd_save_all", { n: fmtNum(touched.length, locale) })}</Button>
      </div>
    </div>
  );
}

// ───────── (b) paste / upload a sheet ─────────
function CsvTab({ requestId, all, incomplete, onSaved }: { requestId: string; all: ShipmentItem[]; incomplete: ShipmentItem[]; onSaved: (r: SaveResult) => void }) {
  const { t, locale } = useI18n(); const a = useAction();
  const [text, setText] = useState(""); const [parsed, setParsed] = useState<BulkCsv | null>(null); const [fileErr, setFileErr] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null); const [serverRows, setServerRows] = useState<Errs>({});
  const run = (src: string) => { setFailure(null); setServerRows({}); setParsed(parseBulkCsv(src, all)); };
  const onFile = async (f: File | undefined) => {
    if (!f) return; setFileErr(false);
    if (f.size > 5 * 1024 * 1024) { setFileErr(true); return; }
    const src = await f.text(); setText(src); run(src);
  };
  const ok = parsed?.rows.filter((r) => !r.problem && Object.keys(r.errors).length === 0) ?? [];
  const bad = (parsed?.rows.length ?? 0) - ok.length;
  const download = () => {
    const url = URL.createObjectURL(new Blob([incompleteSheetCsv(incomplete)], { type: "text/csv;charset=utf-8" }));
    const el = document.createElement("a"); el.href = url; el.download = "jr-parcels-details.csv"; document.body.appendChild(el); el.click(); el.remove(); URL.revokeObjectURL(url);
  };
  const save = () => {
    if (ok.length === 0) return;
    setFailure(null); setServerRows({});
    const rows = ok.map((r) => bulkWire(r.target!.id, r.edit));
    void a.run("csv", () => sendRows(requestId, rows, (e, offset) => {
      if (!(e instanceof ApiError)) return;
      const byLine: Errs = {}; let first: number | null = null;
      mapServerBulkErrors(e.details).forEach((v, i) => { const line = ok[offset + i]?.line; if (line != null) { byLine[String(line)] = v; first ??= line; } });
      if (first == null && typeof e.details.row === "number") first = ok[offset + e.details.row - 1]?.line ?? null;
      setServerRows(byLine);
      setFailure({ text: errText(e, t) + (first != null ? ` — ${t("pb.cd_failed_line", { n: first })}` : "") });
    }), { onDone: (r) => { setText(""); setParsed(null); onSaved(r); } });
  };
  return (
    <div className="space-y-4" data-testid="complete-csv">
      <p className="text-sm text-muted">{t("pb.cd_csv_help")}</p>
      <Textarea label={t("bs.import_paste")} dir="ltr" className="font-mono text-xs" rows={6} data-testid="complete-csv-text" value={text} onChange={(e) => { setText(e.target.value); setParsed(null); }} placeholder={"JR-000012-007,Mona Ali,0555555555,King Fahd Rd 120 Riyadh\nORD-1002,Al Noor Pharmacy,0501234567,Olaya St 8 Riyadh"} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-xl border border-line bg-bg2 px-3 text-xs hover:border-accent/60 pointer-coarse:h-10">
          <Upload className="size-4" aria-hidden />{t("bs.import_file")}
          <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" data-testid="complete-csv-file" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <Button size="sm" data-testid="complete-csv-preview" disabled={!text.trim()} onClick={() => run(text)}>{t("bs.import_preview")}</Button>
        <Button size="sm" variant="ghost" data-testid="complete-template" disabled={incomplete.length === 0} onClick={download}><Download className="size-4" aria-hidden />{t("pb.cd_csv_template")}</Button>
      </div>
      {fileErr && <Notice tone="danger">{t("bs.import_file_big")}</Notice>}
      {failure && <Notice tone="danger"><span data-testid="complete-csv-error">{failure.text}</span></Notice>}
      {parsed && parsed.rows.length === 0 && <Notice tone="warn">{t("bs.import_none")}</Notice>}
      {parsed && parsed.rows.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="success">{t("bs.import_valid", { n: ok.length })}</Badge>
            {bad > 0 && <Badge tone="danger">{t("bs.import_invalid", { n: bad })}</Badge>}
            <span className="text-xs text-muted">{parsed.header ? t("bs.import_header_yes") : t("pb.cd_header_no")}</span>
          </div>
          <div className="max-h-72 overflow-auto rounded-card border border-line">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="sticky top-0 bg-bg2 text-muted"><tr>{["#", t("pb.cd_col_key"), t("pb.cd_col_match"), t("bs.f_name"), t("bs.f_phone"), t("bs.f_address"), t("bs.import_problems")].map((h, i) => <th key={i} scope="col" className="px-3 py-2 text-start font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {parsed.rows.slice(0, PREVIEW_LIMIT).map((r) => {
                  const probs: string[] = [];
                  if (r.problem) probs.push(t(r.problem));
                  for (const [f, k] of Object.entries(r.errors)) probs.push(`${t(`bs.fld_${f}`)}: ${t(k)}`);
                  for (const [f, k] of Object.entries(serverRows[String(r.line)] ?? {})) probs.push(f === "id" ? t(k) : `${t(`bs.fld_${f}`)}: ${t(k)}`);
                  const bad1 = probs.length > 0;
                  return (
                    <tr key={r.line} data-testid="complete-csv-row" className={bad1 ? "bg-danger/5" : undefined}>
                      <td className="px-3 py-1.5 tabular-nums text-muted">{r.line}</td>
                      <td className="ltr-num px-3 py-1.5" dir="ltr">{r.key || "—"}</td>
                      <td className="ltr-num px-3 py-1.5" dir="ltr">{r.target?.code ?? "—"}</td>
                      <td className="px-3 py-1.5">{r.edit.recipientName || "—"}</td>
                      <td className="ltr-num px-3 py-1.5" dir="ltr">{r.edit.recipientPhone || "—"}</td>
                      <td className="max-w-[200px] truncate px-3 py-1.5" title={r.edit.address}>{r.edit.address || "—"}</td>
                      <td className="px-3 py-1.5">
                        {bad1 ? <ul className="space-y-0.5 text-danger">{probs.map((p, i) => <li key={i} className="flex items-start gap-1"><AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden />{p}</li>)}</ul>
                          : r.overwrites ? <span className="text-gold">{t("pb.cd_warn_overwrite")}</span> : <span className="text-accent">✓</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {parsed.rows.length > PREVIEW_LIMIT && <p className="text-xs text-muted">{t("bs.import_more", { n: parsed.rows.length - PREVIEW_LIMIT })}</p>}
        </div>
      )}
      <div className="flex justify-end border-t border-line pt-3">
        <Button data-testid="complete-csv-save" loading={a.is("csv")} disabled={!parsed || ok.length === 0} onClick={save}>{t("pb.cd_csv_save", { n: fmtNum(ok.length, locale) })}</Button>
      </div>
    </div>
  );
}
