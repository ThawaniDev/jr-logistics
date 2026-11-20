"use client";
import { useState } from "react";
import { Pin, PinOff, Trash2 } from "lucide-react";
import { useSWRConfig } from "swr";
import { Badge, Button, EmptyState, ErrorState, Modal, Notice, Section, Skeleton, Textarea, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { api, post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import type { ActivityEntity } from "@/server/activity-core";

export const NOTE_MAX = 4000;
interface Note { id: string; body: string; pinned: boolean; createdAt: string; author: { id: string; name: string; role: string }; canDelete: boolean; canPin: boolean }

/**
 * Internal notes on any record (decision G6): staff-only, never shown to customers, pinned notes first. Writing needs `notes.manage`;
 * everyone who may open the record can read. Adding / removing a note also refreshes the record's activity log.
 * Mount: `<NotesPanel entity="ticket" id={id} />`.
 */
export function NotesPanel({ entity, id, title }: { entity: ActivityEntity; id: string; title?: string }) {
  const { t, locale } = useI18n(); const a = useAction(); const { mutate: refreshAll } = useSWRConfig();
  const path = `/admin/notes/${entity}/${id}`;
  const { data, error, mutate } = useApi<{ items: Note[]; canWrite: boolean }>(path);
  const [body, setBody] = useState(""); const [pinned, setPinned] = useState(false);
  const [del, setDel] = useState<Note | null>(null);
  const done = async () => { await mutate(); await refreshAll((k) => typeof k === "string" && k.includes("/admin/activity/")); };
  const add = () => a.run("add", () => post(path, { body: body.trim(), pinned }), { success: "dtk.note_saved", onDone: () => { setBody(""); setPinned(false); void done(); } });
  const toggle = (n: Note) => a.run(`pin-${n.id}`, () => api("PATCH", `/admin/notes/${n.id}`, { pinned: !n.pinned }), { onDone: () => void done() });
  const remove = (n: Note) => a.run(`del-${n.id}`, () => api("DELETE", `/admin/notes/${n.id}`), { success: "dtk.note_removed", onDone: () => { setDel(null); void done(); } });
  const tooLong = body.length > NOTE_MAX;
  return (
    <div data-testid="dtk-notes">
      <Section title={title ?? t("dtk.notes_title")} description={t("dtk.notes_hint")}>
        <div className="space-y-4">
          {data?.canWrite && (
            <div className="space-y-2">
              <Textarea data-testid="dtk-note-body" label={t("dtk.note_label")} placeholder={t("dtk.note_placeholder")} value={body} onChange={(e) => setBody(e.target.value)} maxLength={NOTE_MAX + 200} error={tooLong ? t("dtk.note_too_long", { max: NOTE_MAX }) : undefined} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted"><input type="checkbox" className="size-4 accent-[var(--jr-accent)]" checked={pinned} onChange={(e) => setPinned(e.target.checked)} data-testid="dtk-note-pin" />{t("dtk.note_pin")}</label>
                <Button onClick={add} disabled={!body.trim() || tooLong} loading={a.is("add")} data-testid="dtk-note-add">{t("dtk.note_add")}</Button>
              </div>
            </div>
          )}
          {data && !data.canWrite && <Notice tone="info">{t("dtk.note_readonly")}</Notice>}
          {error && !data ? <ErrorState error={error} retry={() => mutate()} />
            : !data ? <div className="space-y-2" aria-busy="true" role="status"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
            : data.items.length === 0 ? <EmptyState title={t("dtk.notes_empty")} />
            : (
              <ul className="space-y-2.5">
                {data.items.map((n) => (
                  <li key={n.id} data-testid="dtk-note" className="rounded-xl border border-line bg-bg2 p-3.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <span className="font-medium text-ink">{n.author.name}</span><span>({t(`role.${n.author.role}`)})</span>
                      <time dateTime={n.createdAt} className="ltr-num">{fmtDateTime(n.createdAt, locale)}</time>
                      {n.pinned && <Badge tone="warn"><Pin className="size-3" aria-hidden />{t("dtk.note_pinned")}</Badge>}
                      <span className="ms-auto flex items-center gap-1">
                        {n.canPin && <button type="button" onClick={() => toggle(n)} disabled={a.is(`pin-${n.id}`)} aria-label={t(n.pinned ? "dtk.note_unpin" : "dtk.note_pin")} title={t(n.pinned ? "dtk.note_unpin" : "dtk.note_pin")} data-testid="dtk-note-toggle-pin" className="jr-tap rounded-lg p-1.5 hover:bg-card hover:text-ink">{n.pinned ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}</button>}
                        {n.canDelete && <button type="button" onClick={() => setDel(n)} aria-label={t("dtk.note_delete")} title={t("dtk.note_delete")} data-testid="dtk-note-delete" className="jr-tap rounded-lg p-1.5 hover:bg-danger/10 hover:text-danger"><Trash2 className="size-4" aria-hidden /></button>}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </Section>
      <Modal open={!!del} onClose={() => setDel(null)} busy={!!del && a.is(`del-${del.id}`)} title={t("dtk.note_delete_title")}
        footer={<><Button variant="ghost" onClick={() => setDel(null)}>{t("common.cancel")}</Button><Button variant="danger" data-testid="dtk-note-confirm-delete" loading={!!del && a.is(`del-${del.id}`)} onClick={() => del && remove(del)}>{t("dtk.note_delete")}</Button></>}>
        <p className="text-sm text-muted">{t("dtk.note_delete_body")}</p>
      </Modal>
    </div>
  );
}
