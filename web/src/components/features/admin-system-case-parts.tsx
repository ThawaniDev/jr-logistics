"use client";
import { useRef, useState } from "react";
import { FileText, Paperclip, StickyNote, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, Badge, Button, Checkbox, Select, Textarea, useAction } from "@/components/ui";
import { patch, post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { RoleBadge } from "./admin-system-common";
import { cannedKeys, firstName } from "@/server/details-pure";
import { TICKET_UPLOAD_MAX, attachmentKind, attachmentUrl, fmtBytes, ticketFileProblem } from "./admin-fieldops-lib";

const clip = (s: string) => (s.length > 72 ? `${s.slice(0, 72)}…` : s);
export interface Attachment { id: string; name: string; mime: string; size: number }

/** One attachment of a message: image → inline preview that opens full size; anything else → download chip. `GET /tickets/attachments/:id`. */
export function AttachmentView({ a }: { a: Attachment }) {
  const { t } = useI18n(); const [broken, setBroken] = useState(false);
  const kind = attachmentKind(a.mime); const url = attachmentUrl(a.id);
  if (kind === "image" && !broken) {
    return (
      <a data-testid={`foa-attach-${a.id}`} href={url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border border-line bg-bg" title={a.name} aria-label={t("foa.case_open_image", { name: a.name })}>
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin image, not optimisable */}
        <img src={url} alt={a.name} loading="lazy" onError={() => setBroken(true)} className="max-h-40 w-auto max-w-full object-contain" />
      </a>
    );
  }
  return (
    <a data-testid={`foa-attach-${a.id}`} href={url} {...(kind === "pdf" ? { target: "_blank", rel: "noopener noreferrer" } : { download: a.name })} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-bg px-3 py-1.5 text-xs hover:border-accent/60">
      <FileText className="size-4 shrink-0 text-muted" aria-hidden /><span className="truncate">{a.name}</span><span className="shrink-0 text-muted ltr-num">{fmtBytes(a.size)}</span>
      <span className="sr-only">{t(kind === "pdf" ? "foa.case_open_pdf" : "foa.case_download")}</span>
    </a>
  );
}

/** One message of the conversation: customer on the start side, staff on the end side, internal notes dashed and tinted. */
export function CaseMessage({ r, fallbackName }: { r: { id: string; authorName?: string | null; authorRole?: string | null; body?: string; internal?: boolean; createdAt: string; attachments?: Attachment[] }; fallbackName?: string | null }) {
  const { t, locale } = useI18n();
  const staff = r.authorRole === "staff" || r.authorRole === "admin";
  const name = r.authorName ?? (staff ? t("fob.support_team") : fallbackName ?? "—");
  return (
    <li data-testid={`foa-case-reply-${r.id}`} className={cn("flex max-w-[94%] gap-2.5 sm:max-w-[86%]", staff ? "ms-auto flex-row-reverse" : "me-auto")}>
      <Avatar name={name} size={32} className="mt-1" />
      <div className={cn("min-w-0 rounded-2xl border p-3 text-sm", r.internal ? "border-dashed border-gold/50 bg-gold/5" : staff ? "border-accent/25 bg-accent/10" : "border-line bg-bg2")}>
        <p className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
          <span className="font-semibold text-ink">{name}</span><RoleBadge role={r.authorRole} />
          {r.internal && <Badge tone="warn"><StickyNote className="size-3" aria-hidden />{t("cases.internal")}</Badge>}
          <span>{fmtDateTime(r.createdAt, locale)}</span>
        </p>
        {r.body && <p dir="auto" className="whitespace-pre-wrap break-words">{r.body}</p>}
        {Array.isArray(r.attachments) && r.attachments.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{r.attachments.map((x) => <AttachmentView key={x.id} a={x} />)}</div>}
      </div>
    </li>
  );
}

/**
 * Reply box of a ticket: text, up to three files (uploaded as they are picked), an "internal note" switch, send — plus canned replies for the ticket's category (the text is
 * inserted, never sent by itself) and "send and resolve", which posts the public reply and then marks the ticket resolved.
 */
export function CaseReplyBox({ id, onSent, category, requesterName, refNo }: { id: string; onSent: () => void; category?: string; requesterName?: string | null; refNo?: string }) {
  const { t } = useI18n(); const a = useAction();
  const [reply, setReply] = useState(""); const [internal, setInternal] = useState(false); const [files, setFiles] = useState<Attachment[]>([]);
  const pick = useRef<HTMLInputElement>(null);
  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const room = TICKET_UPLOAD_MAX - files.length;
    for (const f of Array.from(list).slice(0, Math.max(room, 0))) {
      const bad = ticketFileProblem(f);
      if (bad) { toast.error(t(bad === "type" ? "foa.case_file_type" : "foa.case_file_size", { name: f.name })); continue; }
      const fd = new FormData(); fd.append("file", f);
      await a.run("up", () => post<Partial<Attachment>>("/uploads/ticket", fd), { onDone: (u) => setFiles((p) => [...p, { id: u!.id as string, name: u!.name ?? f.name, mime: u!.mime ?? f.type, size: u!.size ?? f.size }]) });
    }
    if (list.length > room) toast.error(t("foa.case_file_max", { n: TICKET_UPLOAD_MAX }));
    if (pick.current) pick.current.value = "";
  };
  const body = () => ({ body: reply.trim(), internal, ...(files.length ? { attachmentIds: files.map((x) => x.id) } : {}) });
  const reset = () => { setReply(""); setInternal(false); setFiles([]); };
  const send = () => a.run("r", () => post(`/tickets/${id}/replies`, body()), { success: "common.saved", onDone: () => { reset(); onSent(); } });
  // The reply is out and the box cleared before the status change is attempted, so a failure of the second step never makes anyone send the message twice.
  const sendResolve = () => a.run("rr", async () => { await post(`/tickets/${id}/replies`, body()); reset(); onSent(); await patch(`/admin/tickets/${id}`, { status: "resolved" }); }, { success: "common.saved", onDone: onSent });
  const templates = category ? cannedKeys(category).map((k) => ({ value: k, label: clip(t(k, { name: firstName(requesterName), ref: refNo ?? "" })) })) : [];
  const insert = (k: string) => { if (k) { const text = t(k, { name: firstName(requesterName), ref: refNo ?? "" }); setReply((r) => (r.trim() ? `${r.trimEnd()}\n\n${text}` : text)); } };
  return (
    <div className={cn("space-y-2.5 rounded-2xl border p-3", internal ? "border-dashed border-gold/50 bg-gold/5" : "border-line bg-bg2/40")}>
      {templates.length > 0 && !internal && <div className="sm:w-80"><Select data-testid="dv3-canned" aria-label={t("dv3.canned_pick")} placeholder={t("dv3.canned_pick")} value="" onChange={(e) => insert(e.target.value)} options={templates} /></div>}
      <Textarea data-testid="foa-case-reply" aria-label={t(internal ? "rdb.cd_note_ph" : "chat.placeholder")} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t(internal ? "rdb.cd_note_ph" : "chat.placeholder")} maxLength={2000} />
      {files.length > 0 && <ul className="flex flex-wrap gap-2" aria-label={t("foa.case_attachments")}>{files.map((f) => (
        <li key={f.id} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-bg2 px-2.5 py-1 text-xs"><Paperclip className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{f.name}</span><span className="text-muted ltr-num">{fmtBytes(f.size)}</span>
          <button type="button" aria-label={t("foa.case_remove_file", { name: f.name })} className="text-muted hover:text-danger" onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))}><X className="size-3.5" aria-hidden /></button></li>))}</ul>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox data-testid="foa-case-internal" checked={internal} onChange={(e) => setInternal(e.target.checked)} label={t("cases.internal_note")} />
          <input ref={pick} data-testid="foa-case-file" type="file" className="sr-only" tabIndex={-1} aria-hidden multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => void upload(e.target.files)} />
          <Button size="sm" variant="ghost" loading={a.is("up")} disabled={files.length >= TICKET_UPLOAD_MAX} onClick={() => pick.current?.click()}><Paperclip className="size-4" aria-hidden />{t("foa.case_attach")}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!internal && category && <Button data-testid="dv3-ticket-resolve-reply" variant="secondary" loading={a.is("rr")} disabled={(!reply.trim() && !files.length) || a.is("up") || a.is("r")} onClick={sendResolve}>{t("dv3.send_resolve")}</Button>}
          <Button data-testid="foa-case-send" loading={a.is("r")} disabled={!reply.trim() || a.is("up") || a.is("rr")} onClick={send}>{t(internal ? "adm.add_note" : "chat.send")}</Button>
        </div>
      </div>
    </div>
  );
}
