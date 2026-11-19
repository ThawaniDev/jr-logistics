"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleDashed, PackageCheck, ScanBarcode, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, Modal, Notice } from "@/components/ui";
import { friendlyErr, useDriverAction } from "./driver-action";
import { ScanInput, type ScanFeedback } from "./barcode-scanner";
import { ApiError, post } from "@/lib/api";
import { fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { signal } from "./driver-feedback";
import { loadingOf, normalizeScanCode } from "./driver-fieldops-utils";
import { ActionBar, RecipientBadge, orderStops, type Stop } from "./driver-stops-shared";

interface ScanRes { shipment: { id: string; code: string; seq: number }; scanned: number; assigned: number; already: boolean }
interface FinishRes { loaded: number; released: number; job?: unknown }
type Filter = "left" | "done" | "all";

/**
 * Loading by scanning (E3/E4): the driver scans every parcel onto the vehicle (camera or typed code / order reference / manifest number),
 * sees the checklist tick off, can undo a mistake, then finishes loading — unscanned parcels go back to the warehouse pool and the route is planned.
 * `stops[].status` is `pending` (not scanned) or `loaded` (scanned); the screen overlays its own scans so it feels instant while the job refreshes.
 */
export function LoadingScan({ job, offerId, stops, canFinish, onJob, onRefresh }: { job: any; offerId: string; stops: Stop[]; canFinish: boolean; onJob?: (job: any) => void; onRefresh: () => unknown }) {
  const { t, locale } = useI18n(); const a = useDriverAction();
  const [code, setCode] = useState(""); const [search, setSearch] = useState("");
  const [fb, setFb] = useState<(ScanFeedback & { at: number }) | null>(null);
  const [overlay, setOverlay] = useState<Record<string, "loaded" | "pending">>({});
  const [filter, setFilter] = useState<Filter>("left");
  const [inflight, setInflight] = useState(0); const [confirm, setConfirm] = useState(false);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touched = useRef<Set<string>>(new Set());
  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  const list = useMemo(() => orderStops(stops).map((s) => ({ ...s, status: overlay[s.id] ?? s.status })), [stops, overlay]);
  const meta = loadingOf(job);
  const assigned = list.length || meta.assigned;
  const scanned = list.length ? list.filter((s) => s.status === "loaded").length : meta.scanned;
  const left = Math.max(0, assigned - scanned);
  const q = search.trim().toLowerCase();
  const shown = list.filter((s) => (filter === "all" || (filter === "left" ? s.status !== "loaded" : s.status === "loaded"))
    && (!q || s.code.toLowerCase().includes(q) || s.address.toLowerCase().includes(q) || String(s.seq) === q.replace(/^0+/, "")));

  // One refresh a moment after the last scan (30 scans must not fire 30 job reloads); then the server's truth replaces the overlay.
  const scheduleRefresh = () => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(async () => {
      const ids = [...touched.current]; touched.current = new Set();
      try { await onRefresh(); } finally { setOverlay((o) => { const n = { ...o }; for (const id of ids) delete n[id]; return n; }); }
    }, 700);
  };

  const errorText = (e: unknown) => {
    if (e instanceof ApiError && e.code === "DETAILS_INCOMPLETE") return t("fod.scan_incomplete");
    if (e instanceof ApiError && e.code === "VALIDATION" && (e.details.field === "code" || e.details.field == null)) return t("fod.scan_unknown");
    if (e instanceof ApiError && e.code === "INVALID_TRANSITION") return t("fod.scan_locked");
    return friendlyErr(e, t);
  };

  /** Scans are processed one after another, in the order they arrive, so two quick camera reads never race. */
  const submit = (raw: string): Promise<ScanFeedback | void> => {
    const c = normalizeScanCode(raw);
    if (!c) return Promise.resolve();
    const run = async (): Promise<ScanFeedback> => {
      setInflight((n) => n + 1);
      let out: ScanFeedback;
      try {
        const r = await post<ScanRes>(`/offers/${offerId}/loading/scan`, { code: c });
        touched.current.add(r.shipment.id); setOverlay((o) => ({ ...o, [r.shipment.id]: "loaded" })); scheduleRefresh();
        out = r.already ? { kind: "warn", text: t("fod.scan_already", { code: r.shipment.code }) } : { kind: "ok", text: t("fod.scan_ok", { code: r.shipment.code, n: fmtNum(r.scanned, locale), total: fmtNum(r.assigned, locale) }) };
      } catch (e) {
        out = { kind: "error", text: `${c} — ${errorText(e)}` };
        if (e instanceof ApiError && e.code === "INVALID_TRANSITION") void onRefresh();
      } finally { setInflight((n) => n - 1); }
      setFb({ ...out, at: Date.now() });
      return out;
    };
    const p = chain.current.then(run, run);
    chain.current = p.catch(() => undefined);
    return p;
  };
  const typed = async (raw: string) => {
    const r = await submit(raw);
    if (r) { signal(r.kind === "ok" ? "ok" : r.kind === "warn" ? "warn" : "error"); if (r.kind !== "error") setCode(""); }
  };

  const unscan = (s: Stop) => a.run(`un-${s.id}`, () => post(`/offers/${offerId}/loading/unscan`, { code: s.code }), {
    onDone: () => { touched.current.add(s.id); setOverlay((o) => ({ ...o, [s.id]: "pending" })); setFb({ kind: "warn", text: t("fod.scan_undone", { code: s.code }), at: Date.now() }); scheduleRefresh(); },
    onError: () => { void onRefresh(); },
  });

  const finish = () => a.run("finish", () => post<FinishRes>(`/offers/${offerId}/loading/finish`, {}), {
    onDone: (r) => {
      setConfirm(false);
      toast.success(t("fod.finish_ok", { loaded: fmtNum(r.loaded, locale), released: fmtNum(r.released, locale) }));
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (r.job) onJob?.(r.job); else void onRefresh();
    },
    onError: (e) => { setConfirm(false); if (e instanceof ApiError) void onRefresh(); },
  });
  const onFinish = () => { if (left > 0) setConfirm(true); else void finish(); };

  const pct = assigned > 0 ? Math.min(100, (scanned / assigned) * 100) : 0;
  const pending = inflight > 0 || a.any;
  return (
    <div className="space-y-4" data-testid="loading-scan">
      <Card className="space-y-4 border-2 border-accent/50 bg-accent/5 p-4 sm:p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">{t("job.next_step")}</p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-bold"><ScanBarcode className="size-6 text-accent" aria-hidden />{t("fod.scan_title")}</h2>
          <p className="mt-1 text-sm text-muted">{t("fod.scan_hint")}</p>
        </div>
        <div className="space-y-1.5" data-testid="scan-progress" data-scanned={scanned} data-assigned={assigned}>
          <p className="ltr-num text-lg font-bold">{t("fod.scan_progress", { n: fmtNum(scanned, locale), total: fmtNum(assigned, locale) })}</p>
          <div role="progressbar" aria-label={t("a11y.progress")} aria-valuemin={0} aria-valuemax={assigned} aria-valuenow={scanned} className="h-3 overflow-hidden rounded-full bg-line"><div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} /></div>
        </div>
        <ScanInput value={code} onChange={setCode} onSubmit={typed} submitLabel={t("fod.scan_add")} label={t("fod.scan_label")} hint={t("fod.scan_label_hint")} continuous fillOnScan={false}
          onScan={submit} autoFocus testId="scan-input" cameraTestId="scan-camera" submitTestId="scan-submit" />
        <div aria-live="polite" className="min-h-6">
          {fb && <p data-testid="scan-feedback" data-kind={fb.kind} className={cn("flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold", fb.kind === "ok" ? "border-accent/40 bg-accent/10 text-accent" : fb.kind === "warn" ? "border-gold/40 bg-gold/10 text-gold" : "border-danger/40 bg-danger/10 text-danger")}>
            {fb.kind === "ok" ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}<span className="min-w-0 break-words">{fb.text}</span></p>}
        </div>
      </Card>

      {list.length > 0 && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{t("fod.checklist_title")}</h3>
            <div role="group" aria-label={t("fod.checklist_title")} className="flex gap-1">
              {([["left", t("fod.filter_left", { n: fmtNum(left, locale) })], ["done", t("fod.filter_done", { n: fmtNum(scanned, locale) })], ["all", t("common.all")]] as Array<[Filter, string]>).map(([k, label]) => (
                <button key={k} type="button" data-testid={`scan-filter-${k}`} aria-pressed={filter === k} onClick={() => setFilter(k)}
                  className={cn("min-h-10 rounded-full border px-3 text-sm font-medium", filter === k ? "border-accent bg-accent/15 text-accent" : "border-line text-muted")}>{label}</button>
              ))}
            </div>
          </div>
          {list.length > 8 && <ScanInput value={search} onChange={setSearch} placeholder={t("fod.find_parcel")} label={t("fod.find_parcel")} testId="parcel-search" cameraTestId="parcel-search-camera" inputClassName="h-12 text-base" />}
          {shown.length === 0 ? <p className="py-4 text-center text-sm text-muted">{t(filter === "left" && left === 0 ? "fod.all_scanned" : "fod.checklist_empty")}</p> : (
            <ul className="divide-y divide-line" data-testid="scan-list">
              {shown.map((s) => {
                const done = s.status === "loaded";
                return (
                  <li key={s.id} data-testid="scan-row" data-code={s.code} data-scanned={done ? "1" : "0"} className="flex items-center gap-3 py-2.5">
                    {done ? <Check className="size-5 shrink-0 text-accent" aria-label={t("fod.scanned_badge")} /> : <CircleDashed className="size-5 shrink-0 text-muted" aria-label={t("fod.not_scanned_badge")} />}
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="ltr-num font-mono font-bold">{s.code}</span><span className="ltr-num text-xs text-muted">#{s.seq}</span><RecipientBadge type={s.recipientType} /></p>
                      <p className="truncate text-xs text-muted">{s.address}</p>
                    </div>
                    {done && <Button type="button" data-testid="scan-undo" data-code={s.code} size="sm" variant="ghost" className="h-11 shrink-0 border border-line" loading={a.is(`un-${s.id}`)} disabled={pending && !a.is(`un-${s.id}`)} onClick={() => unscan(s)}><Undo2 className="size-4" aria-hidden />{t("fod.undo")}</Button>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      <ActionBar>
        <Button data-testid="scan-finish" size="lg" full className="h-14 text-lg" loading={a.is("finish")} disabled={!canFinish || scanned < 1 || inflight > 0} onClick={onFinish}><PackageCheck className="size-6" aria-hidden />{t("fod.finish_loading")}</Button>
        {scanned < 1 && <p className="mt-2 text-center text-xs text-muted">{t("fod.finish_need_one")}</p>}
      </ActionBar>

      <Modal open={confirm} onClose={() => setConfirm(false)} busy={a.is("finish")} title={t("fod.finish_confirm_title")}
        footer={<><Button variant="ghost" size="lg" onClick={() => setConfirm(false)}>{t("common.back")}</Button><Button data-testid="scan-finish-confirm" size="lg" loading={a.is("finish")} onClick={() => void finish()}>{t("fod.finish_confirm_yes")}</Button></>}>
        <Notice tone="warn"><span data-testid="scan-finish-warning">{t("fod.finish_confirm_body", { n: fmtNum(left, locale) })}</span></Notice>
        <p className="text-sm text-muted">{t("fod.finish_confirm_hint", { scanned: fmtNum(scanned, locale) })}</p>
      </Modal>
    </div>
  );
}

/** Shown in scan mode when the server has no parcels for this driver to scan (nothing assigned, or loading already finished but the route is not planned). */
export function LoadingWaiting() {
  const { t } = useI18n();
  return <Notice tone="info"><Badge tone="info">{t("fod.scan_waiting_badge")}</Badge> <span className="ms-1">{t("fod.scan_waiting")}</span></Notice>;
}
