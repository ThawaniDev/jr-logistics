"use client";
import { useEffect, useRef, useState } from "react";
import { Download, FileText, Paperclip, X } from "lucide-react";
import { Avatar, Button, Modal, Notice, errText } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { ATTACH_ACCEPT, ATTACH_MAX, attachmentProblem, attachmentUrl, fmtBytes, isImageMime } from "./business-fieldops-lib";

/** What `POST /uploads/ticket` returns and `GET /tickets/:id` replies carry (E15). `preview` is a local blob URL for just-picked images. */
export interface Attachment { id: string; name: string; mime: string; size: number; preview?: string }

/**
 * Photos / PDFs a user attaches to a ticket message: each file is uploaded as soon as it is picked (`POST /uploads/ticket`), the ids go with the
 * message (`attachmentIds`). At most three, 8 MB each, jpg / png / webp / pdf. Shared by the composer, the reply box (business, driver and office).
 */
export function useAttachments() {
  const { t } = useI18n();
  const [items, setItems] = useState<Attachment[]>([]); const [busy, setBusy] = useState(false); const [problem, setProblem] = useState<string | null>(null);
  const [urls] = useState(() => new Set<string>());
  useEffect(() => () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); }, [urls]);
  const drop = (a: Attachment) => { if (a.preview) { URL.revokeObjectURL(a.preview); urls.delete(a.preview); } };
  const add = async (files: File[]) => {
    setProblem(null); setBusy(true);
    let count = items.length; const added: Attachment[] = [];
    try {
      for (const f of files) {
        const bad = attachmentProblem(f, count);
        if (bad) { setProblem(t(bad)); if (bad === "fob.att_too_many") break; continue; }
        try {
          const fd = new FormData(); fd.append("file", f);
          const r = await api<Partial<Attachment>>("POST", "/uploads/ticket", fd);
          if (!r?.id) throw new Error("no id");
          const preview = isImageMime(f.type) ? URL.createObjectURL(f) : undefined; if (preview) urls.add(preview);
          added.push({ id: r.id, name: r.name ?? f.name, mime: r.mime ?? f.type, size: r.size ?? f.size, preview }); count++;
        } catch (e) { setProblem(errText(e, t)); }
      }
    } finally { if (added.length) setItems((p) => [...p, ...added]); setBusy(false); }
  };
  const remove = (id: string) => { const a = items.find((x) => x.id === id); if (a) drop(a); setItems((p) => p.filter((x) => x.id !== id)); };
  const reset = () => { items.forEach(drop); setItems([]); setProblem(null); };
  return { items, busy, problem, add, remove, reset, ids: items.map((a) => a.id), full: items.length >= ATTACH_MAX };
}
export type AttachmentState = ReturnType<typeof useAttachments>;

/** Full-size look at a picture, with a download link. Mount only while open. */
export function ImagePreview({ src, name, href, onClose }: { src: string; name: string; href?: string; onClose: () => void }) {
  const { t } = useI18n(); const [failed, setFailed] = useState(false);
  return (
    <Modal open onClose={onClose} title={name} footer={<>{href && <a href={href} download={name} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-bg2 px-4 text-sm hover:border-accent/60"><Download className="size-4" aria-hidden />{t("fob.att_download")}</a>}<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button></>}>
      <div data-testid="att-preview">
        {failed ? <Notice tone="warn">{t("fob.media_load_failed")}</Notice> : (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin stream or a local blob, not an optimisable static asset
          <img src={src} alt={name} className="max-h-[70vh] w-full rounded-xl border border-line bg-bg2 object-contain" onError={() => setFailed(true)} />
        )}
      </div>
    </Modal>
  );
}

/** "Attach photo / PDF" button + chips of what is attached (thumbnail or file icon, name, size, remove). */
export function AttachmentPicker({ att, testid = "att" }: { att: AttachmentState; testid?: string }) {
  const { t } = useI18n(); const input = useRef<HTMLInputElement>(null); const [look, setLook] = useState<Attachment | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" loading={att.busy} disabled={att.full} onClick={() => input.current?.click()} data-testid={`${testid}-add`}><Paperclip className="size-4" aria-hidden />{t("fob.att_add")}</Button>
        <input ref={input} type="file" multiple accept={ATTACH_ACCEPT} className="sr-only" tabIndex={-1} aria-label={t("fob.att_add")} data-testid={`${testid}-input`}
          onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) void att.add(files); }} />
        <span className="text-xs text-muted" id={`${testid}-hint`}>{t("fob.att_hint", { n: att.items.length, max: ATTACH_MAX })}</span>
      </div>
      {att.problem && <p role="alert" className="text-xs text-danger" data-testid={`${testid}-problem`}>{att.problem}</p>}
      {att.items.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t("fob.att_list")} data-testid={`${testid}-chips`}>
          {att.items.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-xl border border-line bg-bg2 py-1 ps-1 pe-2 text-xs" data-testid="att-chip">
              {a.preview
                // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                ? <button type="button" onClick={() => setLook(a)} aria-label={t("fob.att_preview", { name: a.name })}><img src={a.preview} alt="" className="size-9 rounded-lg object-cover" /></button>
                : <span className="flex size-9 items-center justify-center rounded-lg bg-card"><FileText className="size-5 text-muted" aria-hidden /></span>}
              <span className="max-w-[9rem] truncate" title={a.name}>{a.name}</span><span className="ltr-num text-muted tabular-nums" dir="ltr">{fmtBytes(a.size)}</span>
              <button type="button" className="rounded-md p-1 text-muted hover:text-danger" aria-label={t("fob.att_remove", { name: a.name })} onClick={() => att.remove(a.id)} data-testid="att-remove"><X className="size-4" aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}
      {look?.preview && <ImagePreview src={look.preview} name={look.name} onClose={() => setLook(null)} />}
    </div>
  );
}

/** Attachments of one message: image thumbnails (click = full size) and PDF chips; every file has a download link. */
export function AttachmentList({ items }: { items?: Attachment[] | null }) {
  const { t } = useI18n(); const [look, setLook] = useState<Attachment | null>(null);
  if (!items?.length) return null;
  return (
    <>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label={t("fob.att_list")} data-testid="msg-attachments">
        {items.map((a) => (
          <li key={a.id} className="flex items-center gap-2 rounded-xl border border-line bg-card py-1 ps-1 pe-2 text-xs" data-testid="msg-attachment" data-mime={a.mime}>
            {isImageMime(a.mime)
              // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin stream
              ? <button type="button" onClick={() => setLook(a)} aria-label={t("fob.att_preview", { name: a.name })}><img src={attachmentUrl(a.id)} alt="" loading="lazy" className="size-12 rounded-lg object-cover" /></button>
              : <span className="flex size-12 items-center justify-center rounded-lg bg-bg2"><FileText className="size-6 text-muted" aria-hidden /></span>}
            <span className="min-w-0"><span className="block max-w-[10rem] truncate font-medium" title={a.name}>{a.name}</span><span className="ltr-num text-muted" dir="ltr">{fmtBytes(a.size)}</span></span>
            <a href={attachmentUrl(a.id)} {...(isImageMime(a.mime) ? { download: a.name } : { target: "_blank", rel: "noopener noreferrer" })} className="rounded-md p-1 text-cyan hover:underline" aria-label={t("fob.att_download_named", { name: a.name })} data-testid="msg-attachment-link"><Download className="size-4" aria-hidden /></a>
          </li>
        ))}
      </ul>
      {look && <ImagePreview src={attachmentUrl(look.id)} name={look.name} href={attachmentUrl(look.id)} onClose={() => setLook(null)} />}
    </>
  );
}

/**
 * The conversation of a ticket or the notes of a complaint, as chat bubbles: yours on the end side (green), JR support (blue) and anyone else on the start side.
 * `meId` tells which messages are the viewer's own; `roleLabel` names a non-staff author.
 */
export function SupportMessages({ messages, meId, roleLabel }: { messages: any[]; meId: string; roleLabel: (role: string) => string }) {
  const { t, locale } = useI18n();
  if (messages.length === 0) return null;
  return (
    <ol className="max-h-[40vh] space-y-3 overflow-y-auto pe-1" aria-label={t("fob.messages")} tabIndex={0}>
      {messages.map((r: any) => {
        const mine = !!r.authorId && r.authorId === meId; const staff = r.authorRole === "staff" || r.authorRole === "admin";
        const who = mine ? t("fob.you") : staff ? t("fob.support_team") : roleLabel(r.authorRole);
        return (
          <li key={r.id} className={cn("flex max-w-[94%] gap-2.5", mine ? "ms-auto flex-row-reverse" : "me-auto")} data-testid="ticket-message" data-author={mine ? "me" : staff ? "support" : "other"}>
            <Avatar name={who} size={28} className="mt-1" />
            <div className={cn("min-w-0 rounded-2xl border p-3 text-sm", mine ? "border-accent/25 bg-accent/10" : staff ? "border-cyan/25 bg-cyan/10" : "border-line bg-bg2")}>
              <p className="mb-1 text-[11px] text-muted"><span className="font-semibold text-ink">{who}</span> · {fmtDateTime(r.createdAt, locale)}</p>
              <p dir="auto" className="whitespace-pre-line break-words">{r.body}</p>
              <AttachmentList items={r.attachments} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
