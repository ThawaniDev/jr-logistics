"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlertCircle, Camera, CameraOff, CheckCircle2, Plug, ScanLine, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, Input, Notice, Select, Textarea, errText } from "@/components/ui";
import { post } from "@/lib/api";
import { fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { emptyRow, validateRow, type ManifestRow } from "./business-shipments-lib";
import { providerName, type Connection } from "./business-shipments-partner";

/** "Import from <warehouse system>": paste/scan barcodes → look them up at the partner → preview → append to the manifest. Nothing is guessed or dropped silently. */

export interface LookupResult {
  identifier: string; found: boolean; barcode?: string | null; invoice?: string | null; externalId?: string | null; status?: string | null;
  recipientName?: string | null; recipientPhone?: string | null; address?: string | null; city?: string | null; codAmount?: number | null;
  alreadyInJr?: { requestRef: string; code: string; status: string } | null; error?: string | null; errorKind?: string;
}
type Verdict = "ready" | "missing" | "in_jr" | "in_manifest" | "dup" | "error";

const CHUNK = 50;          // the server looks up at most 50 per call
const MAX_PER_RUN = 200;   // per click; the rest stays in the box
const norm = (s: string) => s.trim().toLowerCase();
/** One identifier per line; a pasted spreadsheet column, comma/semicolon/tab separated values also work. Order kept, repeats removed. */
export function parseIdentifiers(text: string): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const raw of text.split(/[\r\n\t,;]+/)) { const v = raw.trim().slice(0, 80); if (v && !seen.has(norm(v))) { seen.add(norm(v)); out.push(v); } }
  return out;
}
const refOf = (r: LookupResult) => (r.barcode || r.invoice || r.identifier).trim();

/** Recipient fields exactly as the partner returned them — missing ones stay empty so the existing row validation flags them. */
export function rowFromLookup(r: LookupResult, connectionId: string): ManifestRow {
  return emptyRow({ recipientName: r.recipientName?.trim() ?? "", recipientPhone: r.recipientPhone?.trim() ?? "", address: r.address?.trim() ?? "", externalRef: refOf(r), partnerId: connectionId });
}
const MISSING_FIELDS = ["recipientName", "recipientPhone", "address"] as const;
const missingOf = (row: ManifestRow) => { const e = validateRow(row); return MISSING_FIELDS.filter((f) => e[f]); };
const FIELD_LABEL = { recipientName: "bs.f_name", recipientPhone: "bs.f_phone", address: "bs.f_address" } as const;

// camera scanning only where the standard BarcodeDetector API exists
const noop = () => () => {};
const canScan = () => typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;
const useCanScan = () => useSyncExternalStore(noop, canScan, () => false);

function CameraScan({ onCode, onClose }: { onCode: (v: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLVideoElement>(null); const cb = useRef(onCode);
  useEffect(() => { cb.current = onCode; });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false; let stream: MediaStream | null = null; let timer: ReturnType<typeof setInterval> | undefined; let last = ""; let lastAt = 0;
    (async () => {
      try {
        const Detector = (window as unknown as { BarcodeDetector: new () => { detect: (v: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
        const detector = new Detector();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) { stream.getTracks().forEach((x) => x.stop()); return; }
        const v = ref.current; if (!v) return;
        v.srcObject = stream; await v.play();
        timer = setInterval(async () => {
          try {
            const raw = (await detector.detect(v))[0]?.rawValue?.trim();
            if (raw && !stopped && !(raw === last && Date.now() - lastAt < 3000)) { last = raw; lastAt = Date.now(); cb.current(raw); }
          } catch { /* an unreadable frame is skipped */ }
        }, 350);
      } catch { if (!stopped) setFailed(true); }
    })();
    return () => { stopped = true; clearInterval(timer); stream?.getTracks().forEach((x) => x.stop()); };
  }, []);
  return failed ? <Notice tone="warn">{t("intg.scan_denied")}</Notice> : (
    <div className="space-y-2">
      <video ref={ref} muted playsInline className="aspect-[4/3] max-h-64 w-full rounded-xl bg-black object-cover" aria-label={t("intg.scan_camera")} />
      <div className="flex items-center justify-between gap-2"><p className="text-xs text-muted">{t("intg.scan_hint")}</p><Button type="button" size="sm" variant="secondary" onClick={onClose}><CameraOff className="size-4" />{t("intg.scan_stop")}</Button></div>
    </div>
  );
}

const V_TONE = { ready: "success", missing: "danger", in_jr: "warn", in_manifest: "warn", dup: "neutral", error: "danger" } as const;

export function ImportPanel({ connections, rows, room, onAdd }: { connections: Connection[]; rows: ManifestRow[]; room: number; onAdd: (rows: ManifestRow[]) => void }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [connId, setConnId] = useState(connections[0]?.id ?? "");
  const conn = connections.find((c) => c.id === connId) ?? connections[0];
  const [text, setText] = useState(""); const [scan, setScan] = useState(""); const [cam, setCam] = useState(false);
  const [busy, setBusy] = useState(false); const [failure, setFailure] = useState<string | null>(null);
  const [asked, setAsked] = useState<string[]>([]); const [results, setResults] = useState<LookupResult[] | null>(null); const [skip, setSkip] = useState<Set<string>>(new Set());
  const cameraOk = useCanScan();
  const ids = useMemo(() => parseIdentifiers(text), [text]);
  const existing = useMemo(() => new Set(rows.map((r) => norm(r.externalRef)).filter(Boolean)), [rows]);

  const addLines = (v: string) => { const x = v.trim(); if (!x) return; setText((p) => (p.trim() ? `${p.replace(/\s+$/, "")}\n${x}` : x)); setResults(null); };

  const run = async (list: string[]) => {
    if (!conn || list.length === 0) return;
    setBusy(true); setFailure(null); setSkip(new Set());
    try {
      const batch = list.slice(0, MAX_PER_RUN); const all: LookupResult[] = [];
      for (let i = 0; i < batch.length; i += CHUNK) {
        const r = await post<{ results: LookupResult[] }>(`/integrations/connections/${conn.id}/lookup`, { identifiers: batch.slice(i, i + CHUNK) });
        all.push(...r.results);
      }
      setAsked(batch); setResults(all);
    } catch (e) { setFailure(errText(e, t)); setResults(null); }
    finally { setBusy(false); }
  };

  // Verdict per asked identifier, in the order asked. An identifier the server did not answer is shown as "not checked", never dropped.
  const verdicts = useMemo(() => {
    if (!results) return [];
    const byId = new Map(results.map((r) => [norm(r.identifier), r]));
    const seen = new Set<string>();
    return asked.map((id) => {
      const r: LookupResult = byId.get(norm(id)) ?? { identifier: id, found: false, error: "not checked", errorKind: "unchecked" };
      let v: Verdict;
      const key = norm(refOf(r));
      if (r.error) v = "error"; else if (!r.found) v = "missing";
      else if (r.alreadyInJr) v = "in_jr";
      else if (existing.has(key) || existing.has(norm(id))) v = "in_manifest";
      else if (seen.has(key)) v = "dup";
      else v = "ready";
      if (v === "ready") seen.add(key);
      return { r, v, missing: v === "ready" && conn ? missingOf(rowFromLookup(r, conn.id)) : [] };
    });
  }, [results, asked, existing, conn]);

  const selectable = verdicts.filter((x) => x.v === "ready");
  const chosen = selectable.filter((x) => !skip.has(x.r.identifier));
  const count = (v: Verdict) => verdicts.filter((x) => x.v === v).length;
  const incomplete = chosen.filter((x) => x.missing.length > 0).length;
  const over = chosen.length > room;

  const add = () => {
    if (!conn || chosen.length === 0 || over) return;
    onAdd(chosen.map((x) => rowFromLookup(x.r, conn.id)));
    const added = new Set(chosen.map((x) => norm(x.r.identifier)));
    const left = ids.filter((i) => !added.has(norm(i)));
    setText(left.join("\n")); setResults(null); setSkip(new Set());
    toast.success(t("intg.import_added", { n: chosen.length }));
  };

  if (!conn) return null;
  const many = connections.length > 1;
  const pname = providerName(t, conn.provider, conn.providerLabel);
  if (!open) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 border-cyan/30 bg-cyan/5" data-testid="import-panel-closed">
        <div className="flex min-w-0 items-start gap-3"><Plug className="mt-0.5 size-5 shrink-0 text-cyan" aria-hidden /><div className="min-w-0"><p className="font-semibold">{t("intg.import_title")}</p><p className="text-xs text-muted">{t("intg.import_sub")}</p></div></div>
        <div className="flex flex-wrap gap-2">
          {connections.map((c) => <Button key={c.id} type="button" size="sm" onClick={() => { setConnId(c.id); setOpen(true); }}><ScanLine className="size-4" />{t("intg.import_from", { name: c.name })}</Button>)}
        </div>
      </Card>
    );
  }
  return (
    <Card className="space-y-4 border-cyan/30" data-testid="import-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3"><Plug className="mt-0.5 size-5 shrink-0 text-cyan" aria-hidden /><div><h3 className="font-semibold">{t("intg.import_from", { name: conn.name })}</h3><p className="text-xs text-muted">{t("intg.import_sub")}</p></div></div>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setCam(false); }}>{t("common.close")}</Button>
      </div>
      {many && <Select label={t("intg.import_conn")} value={conn.id} onChange={(e) => { setConnId(e.target.value); setResults(null); }} options={connections.map((c) => ({ value: c.id, label: `${c.name} · ${providerName(t, c.provider, c.providerLabel)}` }))} />}
      <Textarea label={t("intg.import_ids")} dir="ltr" className="font-mono text-xs" rows={4} value={text} onChange={(e) => { setText(e.target.value); setResults(null); }} hint={t("intg.import_ids_hint")} placeholder={"6001234567\nINV-2041\n…"} data-testid="import-ids" />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1"><Input label={t("intg.scan_label")} ltr value={scan} onChange={(e) => setScan(e.target.value)} placeholder={t("intg.scan_ph")} autoComplete="off"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLines(scan); setScan(""); } }} /></div>
        <Button type="button" variant="secondary" onClick={() => { addLines(scan); setScan(""); }} disabled={!scan.trim()}>{t("intg.scan_add")}</Button>
        {cameraOk && !cam && <Button type="button" variant="secondary" onClick={() => setCam(true)}><Camera className="size-4" />{t("intg.scan_camera")}</Button>}
      </div>
      {cam && <CameraScan onCode={addLines} onClose={() => setCam(false)} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" loading={busy} disabled={ids.length === 0} onClick={() => run(ids)}><Search className="size-4" />{t("intg.lookup", { n: fmtNum(Math.min(ids.length, MAX_PER_RUN), locale) })}</Button>
        <span className="text-xs text-muted">{t("intg.ids_count", { n: fmtNum(ids.length, locale) })}</span>
      </div>
      {ids.length > MAX_PER_RUN && <Notice tone="warn">{t("intg.too_many", { max: fmtNum(MAX_PER_RUN, locale), n: fmtNum(ids.length - MAX_PER_RUN, locale) })}</Notice>}
      {failure && <Notice tone="danger" title={t("intg.lookup_failed")}>{failure} <button type="button" className="font-semibold underline" onClick={() => run(ids)}>{t("common.retry")}</button></Notice>}

      {results && (
        <div className="space-y-3" data-testid="import-results">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone="success">{t("intg.n_ready", { n: count("ready") })}</Badge>
            {count("missing") > 0 && <Badge tone="danger">{t("intg.n_missing", { n: count("missing") })}</Badge>}
            {count("in_jr") + count("in_manifest") > 0 && <Badge tone="warn">{t("intg.n_in_jr", { n: count("in_jr") + count("in_manifest") })}</Badge>}
            {count("dup") > 0 && <Badge>{t("intg.n_dup", { n: count("dup") })}</Badge>}
            {count("error") > 0 && <Badge tone="danger">{t("intg.n_error", { n: count("error") })}</Badge>}
          </div>
          {verdicts.some((x) => x.r.codAmount != null) && <p className="text-xs text-muted">{t("fob.import_cod_note")}</p>}
          <ul className="max-h-96 divide-y divide-line overflow-auto rounded-card border border-line" aria-label={t("intg.results_label")}>
            {verdicts.map(({ r, v, missing }) => (
              <li key={r.identifier} className={cn("flex items-start gap-3 px-3 py-2.5 text-sm", v === "ready" ? "" : "bg-bg2/40")} data-testid={`import-result-${v}`}>
                {v === "ready"
                  ? <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--jr-accent)]" aria-label={t("intg.pick", { id: r.identifier })} checked={!skip.has(r.identifier)} onChange={(e) => setSkip((p) => { const n = new Set(p); if (e.target.checked) n.delete(r.identifier); else n.add(r.identifier); return n; })} />
                  : <span className="mt-1 size-4 shrink-0" aria-hidden />}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="ltr-num font-medium" dir="ltr">{r.identifier}</span>
                    <Badge tone={V_TONE[v]}>{t(`intg.v_${v}`)}</Badge>
                    {v === "ready" && r.status && <span className="text-xs text-muted" dir="auto">{r.status}</span>}</div>
                  {(v === "ready" || v === "in_jr" || v === "in_manifest" || v === "dup") && (
                    <p className="text-xs text-muted">{[r.recipientName, r.recipientPhone, r.address].filter(Boolean).join(" · ") || t("intg.no_recipient")}{r.codAmount != null ? ` · ${t("intg.cod", { n: fmtNum(r.codAmount, locale) })}` : ""}</p>)}
                  {v === "in_jr" && r.alreadyInJr && <p className="text-xs text-gold">{t("intg.in_jr_ref", { ref: r.alreadyInJr.requestRef, code: r.alreadyInJr.code })}</p>}
                  {v === "in_manifest" && <p className="text-xs text-gold">{t("intg.in_manifest")}</p>}
                  {v === "missing" && <p className="text-xs text-muted">{t("intg.missing_hint", { name: pname })}</p>}
                  {v === "error" && <p className="text-xs text-danger">{t(`intg.lerr_${r.errorKind === "auth" || r.errorKind === "unavailable" || r.errorKind === "unchecked" ? r.errorKind : "other"}`, { name: pname })}{r.errorKind === "auth" && <> <Link href={`/business/integrations/${conn.id}`} className="font-semibold underline">{t("intg.fix_connection")}</Link></>}</p>}
                  {missing.length > 0 && <p className="flex items-center gap-1 text-xs font-medium text-gold"><AlertCircle className="size-3.5 shrink-0" aria-hidden />{t("intg.complete_after", { fields: missing.map((f) => t(FIELD_LABEL[f])).join(", ") })}</p>}
                </div>
              </li>
            ))}
          </ul>
          {count("error") > 0 && <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => run(verdicts.filter((x) => x.v === "error").map((x) => x.r.identifier))}>{t("intg.retry_failed")}</Button>}
          {incomplete > 0 && <Notice tone="warn">{t("intg.incomplete_note", { n: incomplete })}</Notice>}
          {over && <Notice tone="danger">{t("intg.over_room", { room: fmtNum(Math.max(room, 0), locale) })}</Notice>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs text-muted"><CheckCircle2 className="size-3.5 text-accent" aria-hidden />{t("intg.add_note")}</p>
            <Button type="button" disabled={chosen.length === 0 || over} onClick={add} data-testid="import-add">{t("intg.add_n", { n: chosen.length })}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
