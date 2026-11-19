"use client";
import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, FileCheck2, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, ErrorState, Input, Modal, Notice, PageHeader, PageLoading, ProgressBar, Section, Stat, StatGrid, StatusBadge, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDate, fmtDateTime, isoToRiyadhLocal } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { dayNumber, docProgress } from "./business-views-lib";
import { cn } from "@/lib/cn";

const MAX_BYTES = 8 * 1024 * 1024; // same limit the server enforces
const MIME_OK = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** The documents page of every portal: progress KPIs, then one card per document type (required first) with its status, expiry and upload. */
export function DocumentsPage() {
  const { t, locale } = useI18n(); const me = useUser(); const a = useAction();
  const { data: cat } = useApi("/catalog"); const { data, error, mutate } = useApi("/documents");
  const { data: prof } = useApi("/profile");
  const [expiry, setExpiry] = useState<Record<string, string>>({}); const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replace, setReplace] = useState<string | null>(null); // type awaiting confirmation: replacing an approved file sends it back to review
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data || !cat) return <PageLoading />;
  const kind = me.role === "driver" ? "driver" : me.role === "office" ? "office" : "business";
  const types: Array<{ key: string; required: boolean }> = [...cat.documents[kind]].sort((x, y) => Number(y.required) - Number(x.required));
  const vs = prof?.profile?.verificationStatus;
  const today = isoToRiyadhLocal(new Date().toISOString()).slice(0, 10); // "today" in Riyadh, not in the visitor's zone
  const todayN = dayNumber(today);
  const latestOf = (type: string) => data.items.find((d: any) => d.type === type);
  const p = docProgress(types, data.items, todayN);

  async function upload(type: string, file: File) {
    if (!MIME_OK.includes(file.type)) { toast.error(t("ubz.file_type")); return; }
    if (file.size > MAX_BYTES) { toast.error(t("ubz.file_too_big")); return; }
    const fd = new FormData(); fd.set("type", type); fd.set("file", file); if (expiry[type]) fd.set("expiresOn", expiry[type]);
    await a.run(type, () => post("/documents", fd), { success: "docs.uploaded", onDone: () => { setExpiry((x) => ({ ...x, [type]: "" })); mutate(); } });
  }
  const pick = (type: string) => inputs.current[type]?.click();

  return (
    <>
      <PageHeader title={t("nav.documents")} subtitle={t("docs.sub")} actions={vs && <StatusBadge status={vs} />} />
      {vs === "verified" ? <div className="mb-5"><Notice tone="success">{t("docs.verified_note")}</Notice></div> : <div className="mb-5"><Notice tone="warn">{t("docs.pending_note")}</Notice></div>}
      {p.total > 0 && (
        <StatGrid cols={4} className="mb-6">
          <Stat label={t("rdz.doc_k_approved")} value={<span className="ltr-num">{p.approved}/{p.total}</span>} hint={<span className="block w-full min-w-28"><ProgressBar value={p.approved} max={p.total} label={t("a11y.progress")} /></span>} icon={<ShieldCheck className="size-5" />} tone={p.approved === p.total ? "accent" : "cyan"} />
          <Stat label={t("rdz.doc_k_review")} value={p.review} hint={p.review > 0 ? t("ubz.docs_in_review") : t("rdz.doc_k_review_none")} icon={<Clock className="size-5" />} tone={p.review > 0 ? "gold" : "muted"} />
          <Stat label={t("rdz.doc_k_attention")} value={p.missing + p.rejected + p.expired} hint={p.missing > 0 ? t("ubz.docs_missing", { n: p.missing }) : p.rejected + p.expired > 0 ? t("ubz.doc_fix_hint") : t("rdz.doc_k_attention_none")} icon={<AlertTriangle className="size-5" />} tone={p.missing + p.rejected + p.expired > 0 ? "danger" : "muted"} />
          <Stat label={t("rdz.doc_k_expiring")} value={p.expiring} hint={t("rdz.doc_k_expiring_hint")} icon={<FileCheck2 className="size-5" />} tone={p.expiring > 0 ? "gold" : "muted"} />
        </StatGrid>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {types.map((ty) => {
          const latest = latestOf(ty.key);
          const daysLeft = latest?.expiresOn ? dayNumber(latest.expiresOn) - todayN : null;
          const rejected = latest && ["rejected", "info_requested"].includes(latest.status);
          return (
            <Section key={ty.key} title={<span className="flex items-center gap-2">{latest?.status === "approved" ? <CheckCircle2 className="size-5 text-accent" aria-hidden /> : <FileCheck2 className="size-5 text-muted" aria-hidden />}{t(`doc.${ty.key}`)}</span>}
              actions={ty.required ? <Badge tone="warn">{t("docs.required")}</Badge> : <Badge>{t("docs.optional")}</Badge>} className="flex flex-col [&>div:last-child]:flex-1">
              <div data-testid={`doc-${ty.key}`} className="flex h-full flex-col gap-3">
                {latest ? (
                  <div className={cn("space-y-1 rounded-xl p-3 text-sm", rejected ? "border border-danger/40 bg-danger/5" : "bg-bg2")}>
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex flex-wrap items-center gap-1.5"><StatusBadge status={latest.status} ns="docstatus" />{daysLeft !== null && daysLeft < 0 && <Badge tone="danger">{t("ubz.doc_expired")}</Badge>}{daysLeft !== null && daysLeft >= 0 && daysLeft <= 30 && <Badge tone="warn">{t("ubz.doc_expiring", { n: daysLeft })}</Badge>}</span><a href={`/api/v1/documents/${latest.id}/file`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-cyan hover:underline">{t("docs.view")}<ExternalLink className="size-3 rtl:-scale-x-100" aria-hidden /></a></div>
                    <p className="text-xs text-muted">{t("ubz.doc_uploaded", { date: fmtDateTime(latest.createdAt, locale) })}</p>
                    {latest.expiresOn && <p className="text-xs text-muted">{t("docs.expires")}: {fmtDate(latest.expiresOn, locale)}</p>}
                    {latest.reviewNote && <p className={`text-xs ${rejected ? "font-medium text-danger" : "text-gold"}`}>{latest.reviewNote}</p>}
                    {rejected && <p className="text-xs text-muted">{t("ubz.doc_fix_hint")}</p>}
                  </div>
                ) : <p className="rounded-xl border border-dashed border-line p-3 text-sm text-muted">{t("docs.none")}</p>}
                <div className="mt-auto space-y-3">
                  <Input label={t("docs.expiry_optional")} type="date" ltr min={today} value={expiry[ty.key] ?? ""} onChange={(e) => setExpiry({ ...expiry, [ty.key]: e.target.value })} />
                  <input ref={(el) => { inputs.current[ty.key] = el; }} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" tabIndex={-1} aria-hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(ty.key, f); e.target.value = ""; }} />
                  <Button variant={latest ? "secondary" : "primary"} full loading={a.is(ty.key)} onClick={() => (latest?.status === "approved" ? setReplace(ty.key) : pick(ty.key))}><Upload className="size-4" aria-hidden />{latest ? t("docs.replace") : t("docs.upload")}</Button>
                  <p className="text-center text-xs text-muted">{t("ubz.file_hint")}</p>
                </div>
              </div>
            </Section>
          );
        })}
      </div>
      <Modal open={!!replace} onClose={() => setReplace(null)} title={t("ubz.replace_title")} footer={<><Button variant="ghost" onClick={() => setReplace(null)}>{t("common.cancel")}</Button><Button onClick={() => replaceInput.current?.click()}><Upload className="size-4" aria-hidden />{t("ubz.replace_continue")}</Button></>}>
        <Notice tone="warn">{t("ubz.replace_body")}</Notice>
        {/* the picker lives inside the dialog: the page behind an open modal is inert */}
        <input ref={replaceInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" tabIndex={-1} aria-hidden onChange={(e) => { const f = e.target.files?.[0]; const k = replace; e.target.value = ""; setReplace(null); if (f && k) upload(k, f); }} />
      </Modal>
    </>
  );
}
