"use client";
import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, Clock, Inbox, LifeBuoy, MessageCircleReply, RotateCcw, UserCheck } from "lucide-react";
import useSWR from "swr";
import { toast } from "sonner";
import { Badge, Button, CellPair, EmptyState, ErrorState, Modal, Notice, PageHeader, PageLoading, Pagination, Segmented, Select, Stat, StatGrid, StatusBadge, Table, Td, Textarea, Input, errText, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { get, post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { assigneeName, isAssigned, reopenWindowOpen, ticketNeedsYou } from "./business-fieldops-lib";
import { AttachmentPicker, SupportMessages, useAttachments } from "./support-parts";

type Kind = "ticket" | "complaint";
export interface SupportLink { requestId?: string; offerId?: string; requestRef?: string; driverName?: string }

/**
 * Create-ticket / file-complaint dialog. Mount it only while it is open (state is reset by remounting).
 * Businesses can link the report to one of their requests; when opened from a driver card the offer is linked as well.
 * `switchable` shows a ticket/complaint toggle (used outside the support page). Tickets can carry up to three photos / PDFs (E15).
 */
export function SupportComposer({ kind: initial, link, switchable, onClose, onCreated }: { kind: Kind; link?: SupportLink; switchable?: boolean; onClose: () => void; onCreated?: () => void }) {
  const { t, locale } = useI18n(); const me = useUser(); const a = useAction(); const att = useAttachments();
  const [kind, setKind] = useState<Kind>(initial);
  const [form, setForm] = useState<{ category?: string; subject?: string; body?: string }>({});
  const [requestId, setRequestId] = useState(link?.requestId ?? ""); const [offerId, setOfferId] = useState(link?.offerId ?? "");
  const { data: cat } = useApi("/catalog");
  const reqs = useApi(me.role === "business" ? "/requests?pageSize=100" : null);
  const cats: string[] = kind === "ticket" ? cat?.ticketCategories?.[me.role] ?? [] : cat?.complaintCategories ?? [];
  const reqOptions: Array<{ value: string; label: string }> = (reqs.data?.items ?? []).map((x: any) => ({ value: x.id, label: `${x.ref} · ${t(`svc.${x.service}`)} · ${fmtDateTime(x.startsAt, locale)}` }));
  if (requestId && !reqOptions.some((o) => o.value === requestId)) reqOptions.unshift({ value: requestId, label: link?.requestRef ?? requestId });
  // Closing a half-written report asks first, so a stray Esc / backdrop click never throws the text away.
  const dirty = !!(form.body?.trim() || form.subject?.trim() || att.items.length);
  const closeSafe = () => { if (a.any) return; if (dirty && !window.confirm(t("ubz.discard_confirm"))) return; onClose(); };
  const create = () => a.run("create", () => {
    const rel = { ...(requestId ? { requestId } : {}), ...(requestId && offerId ? { offerId } : {}) };
    return post(kind === "ticket" ? "/tickets" : "/complaints", kind === "ticket"
      ? { category: form.category, subject: form.subject, body: form.body, ...rel, ...(att.ids.length ? { attachmentIds: att.ids } : {}) }
      : { category: form.category, description: form.body, ...rel });
  }, { success: "common.saved", onDone: () => { onCreated?.(); onClose(); } });
  return (
    <Modal open onClose={closeSafe} busy={a.any} title={t(kind === "ticket" ? "support.new_ticket" : "support.new_complaint")} footer={<><Button variant="ghost" disabled={a.any} onClick={closeSafe}>{t("common.cancel")}</Button><Button loading={a.is("create")} onClick={create} disabled={!form.category || !form.body || att.busy || (kind === "ticket" && !form.subject)} data-testid="support-submit">{t("common.submit")}</Button></>}>
      {switchable && <Segmented label={t("nav.support")} value={kind} onChange={(k) => { setKind(k as Kind); setForm({}); att.reset(); }} options={[{ key: "ticket", label: t("support.tickets") }, { key: "complaint", label: t("support.complaints") }]} />}
      {me.role === "business" && (
        <Select label={t("bz.related_request")} placeholder={t("bz.related_none")} options={reqOptions} value={requestId} onChange={(e) => { setRequestId(e.target.value); setOfferId(""); }} disabled={reqs.isLoading} />
      )}
      {requestId && offerId && <Notice tone="info">{link?.driverName ? `${link.driverName} · ` : ""}{t("bz.linked_job")}</Notice>}
      <Select label={t("support.category")} placeholder={t("common.select")} options={cats.map((c: string) => ({ value: c, label: tr(t, `${kind === "ticket" ? "ticket_cat" : "complaint_cat"}.${c}`, c) }))} value={form.category ?? ""} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="support-category" />
      {kind === "ticket" && <Input label={t("support.subject")} value={form.subject ?? ""} onChange={(e) => setForm({ ...form, subject: e.target.value })} maxLength={150} data-testid="support-subject" />}
      <Textarea label={t("support.details")} value={form.body ?? ""} onChange={(e) => setForm({ ...form, body: e.target.value })} maxLength={2000} hint={kind === "complaint" ? t("support.min_chars") : undefined} data-testid="support-body" />
      {kind === "ticket" && <AttachmentPicker att={att} testid="ticket-att" />}
    </Modal>
  );
}

type TFn = (k: string, v?: Record<string, string | number>) => string;
/** Translation when the key exists, otherwise the raw value (a category the server added before the dictionaries). */
const tr = (t: TFn, key: string, raw: string) => { const s = t(key); return s === key ? raw : s; };

const DONE = ["resolved", "closed"];
const seenKey = (uid: string) => `jr.support.seen.${uid}`;
/** Per-viewer convenience only (which ticket updates were already read): never needed for correctness, so every access is guarded. */
function loadSeen(uid: string): Record<string, string> {
  try { const v = JSON.parse(window.localStorage.getItem(seenKey(uid)) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
function saveSeen(uid: string, m: Record<string, string>) { try { window.localStorage.setItem(seenKey(uid), JSON.stringify(m)); } catch { /* private mode: the cue just reappears */ } }

export function SupportPage() {
  const { t, locale } = useI18n(); const me = useUser(); const a = useAction(); const att = useAttachments();
  const [tab, setTab] = useState("tickets");
  const [open, setOpen] = useState<null | Kind>(null);
  const [view, setView] = useState<any>(null); const [reply, setReply] = useState(""); const [opening, setOpening] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false); const [reopenBody, setReopenBody] = useState(""); const [reopenErr, setReopenErr] = useState<string | null>(null);
  const [tp, setTp] = useState(1); const [cp, setCp] = useState(1);
  const [seen, setSeen] = useState<Record<string, string>>(() => (typeof window === "undefined" ? {} : loadSeen(me.id)));
  const tickets = useApi(`/tickets?page=${tp}`, { keepPreviousData: true }); const complaints = useApi(`/complaints?page=${cp}`, { keepPreviousData: true });
  // How many are open / in review / resolved (one cheap count per status), for the KPI row.
  const STATUS: Record<string, string[]> = { tickets: ["open", "in_review", "resolved"], complaints: ["open", "in_progress", "resolved", "closed"] };
  const counts = useSWR<Record<string, number>>(["rdb-support-counts", tab], async () => Object.fromEntries(await Promise.all(STATUS[tab].map(async (s) => [s, Number((await get(`/${tab}?status=${s}&pageSize=1`)).total)] as const))), { revalidateOnFocus: false, shouldRetryOnError: false });
  const cur = tab === "tickets" ? tickets : complaints;
  const isTickets = tab === "tickets";
  if (cur.error) return <ErrorState error={cur.error} retry={() => cur.mutate()} />;

  const markSeen = (id: string, at: string | null | undefined) => {
    if (!at) return;
    setSeen((p) => { if (p[id] === at) return p; const n = { ...p, [id]: at }; saveSeen(me.id, n); return n; });
  };
  const closeView = () => { setView(null); setReply(""); att.reset(); setReopening(false); setReopenBody(""); setReopenErr(null); };
  const openItem = async (id: string) => {
    setOpening(id);
    try {
      const r = isTickets ? await get(`/tickets/${id}`) : await get(`/complaints/${id}`);
      setView(r);
      if (isTickets) markSeen(id, r?.ticket?.updatedAt);
    } catch (e) { toast.error(errText(e, t)); } finally { setOpening(null); }
  };
  const tk = view?.ticket;
  const sendReply = () => reply.trim() && a.run("reply", async () => {
    await post(isTickets ? `/tickets/${tk.id}/replies` : `/complaints/${view.complaint.id}/notes`, { body: reply, ...(isTickets && att.ids.length ? { attachmentIds: att.ids } : {}) });
    setReply(""); att.reset(); await openItem(isTickets ? tk.id : view.complaint.id); void cur.mutate(); void counts.mutate();
  });
  const canResolve = tk && !["resolved", "closed"].includes(tk.status) && (tk.openedBy === me.id || hasPerm(me, "tickets.manage"));
  const resolve = () => a.run("resolve", () => post(`/tickets/${tk.id}/resolve`), { success: "bz.ticket_resolved_ok", onDone: () => { tickets.mutate(); void counts.mutate(); void openItem(tk.id); } });
  const reopen = () => a.run("reopen", () => post(`/tickets/${tk.id}/reopen`, reopenBody.trim() ? { body: reopenBody.trim() } : {}), {
    success: "fob.reopened_ok", onDone: () => { setReopening(false); setReopenBody(""); setReopenErr(null); void tickets.mutate(); void counts.mutate(); void openItem(tk.id); },
    onError: (e) => setReopenErr(errText(e, t)), // also stays visible in the dialog, not only as a toast
  });
  const linkedRequest = tk?.requestId ?? view?.complaint?.requestId;
  const canReopen = !!tk && tk.status === "resolved" && tk.openedBy === me.id && reopenWindowOpen(tk);

  const waiting = (x: any) => isTickets && ticketNeedsYou(x, seen);
  const rank = (x: any) => (waiting(x) ? 0 : DONE.includes(x.status) ? 2 : 1);
  const items: any[] = cur.data ? [...cur.data.items].sort((p: any, q: any) => rank(p) - rank(q)) : [];
  const waitingCount = isTickets ? items.filter(waiting).length : 0;
  const status = (tk ?? view?.complaint)?.status as string | undefined;
  const messages: any[] = view?.replies ?? view?.notes ?? [];
  const assigned = tk && isAssigned(tk);
  const n = (s: string) => counts.data?.[s]; const cl = !counts.data;
  const newBtn = <Button onClick={() => setOpen(isTickets ? "ticket" : "complaint")} data-testid="support-new">{t(isTickets ? "support.new_ticket" : "support.new_complaint")}</Button>;

  return (
    <>
      <PageHeader title={t("nav.support")} subtitle={t("support.sub")} icon={<LifeBuoy className="size-5" />} actions={newBtn} />
      <div className="mb-4"><Segmented label={t("nav.support")} value={tab} onChange={setTab} options={[{ key: "tickets", label: t("support.tickets"), count: tickets.data?.total }, { key: "complaints", label: t("support.complaints"), count: complaints.data?.total }]} /></div>
      <StatGrid cols={4} className="mb-6">
        {isTickets && <Stat label={t("fob.waiting_you")} value={waitingCount} tone={waitingCount ? "gold" : "muted"} icon={<MessageCircleReply className="size-5" aria-hidden />} hint={t("rdb.sup_k_replied_hint")} />}
        <Stat label={t("status.open")} value={n("open") ?? 0} loading={cl} icon={<Inbox className="size-5" aria-hidden />} hint={t(isTickets ? "rdb.sup_k_open_hint" : "rdb.sup_k_cmp_open_hint")} />
        <Stat label={t(isTickets ? "status.in_review" : "status.in_progress")} value={n(isTickets ? "in_review" : "in_progress") ?? 0} loading={cl} tone="cyan" icon={<Clock className="size-5" aria-hidden />} hint={t("rdb.sup_k_work_hint")} />
        <Stat label={t("status.resolved")} value={n("resolved") ?? 0} loading={cl} tone="muted" icon={<CheckCircle2 className="size-5" aria-hidden />} />
        {!isTickets && <Stat label={t("status.closed")} value={n("closed") ?? 0} loading={cl} tone="muted" icon={<CheckCircle2 className="size-5" aria-hidden />} />}
      </StatGrid>
      {waitingCount > 0 && <div className="mb-4"><Notice tone="warn"><span data-testid="support-waiting">{t("fob.waiting_banner", { n: waitingCount })}</span></Notice></div>}
      {!cur.data ? <PageLoading /> : items.length === 0 ? (
        <EmptyState icon={<LifeBuoy className="size-9" />} title={t(isTickets ? "fob.sup_empty_ticket" : "fob.sup_empty_complaint")} hint={t(isTickets ? "fob.sup_empty_ticket_hint" : "fob.sup_empty_complaint_hint")}
          action={<Button size="sm" onClick={() => setOpen(isTickets ? "ticket" : "complaint")}>{t(isTickets ? "support.new_ticket" : "support.new_complaint")}</Button>} />
      ) : (
        <>
          <Table stack label={t(isTickets ? "support.tickets" : "support.complaints")} head={[t(isTickets ? "support.subject" : "support.category"), t("common.status"), ...(isTickets ? [t("rdb.sup_handled_by")] : []), t("common.date"), { label: t("common.open"), srOnly: true }]}>
            {items.map((x: any) => {
              const w = waiting(x);
              return (
                <tr key={x.id} data-testid="ticket-row" data-status={x.status} data-waiting={w ? "1" : "0"} onClick={() => { if (!opening) void openItem(x.id); }} className={cn("cursor-pointer", w && "bg-gold/5")}>
                  <Td label={t(isTickets ? "support.subject" : "support.category")}>
                    <div className="flex items-start gap-2">{w && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-gold" aria-hidden />}
                      <CellPair className={cn(w && "font-semibold")} title={<button type="button" disabled={opening === x.id} className="max-w-full truncate text-start font-[inherit] text-accent hover:underline disabled:opacity-60">{x.subject ?? tr(t, `complaint_cat.${x.category}`, x.category)}</button>}
                        sub={<><span className="ltr-num">{x.ref}</span> · {tr(t, `${isTickets ? "ticket_cat" : "complaint_cat"}.${x.category}`, x.category)}</>} /></div>
                  </Td>
                  <Td label={t("common.status")}><span className="inline-flex flex-wrap items-center gap-1.5">{w && <Badge tone="warn">{t("fob.waiting_you")}</Badge>}{x.priority === "urgent" && <Badge tone="danger">{t("support.urgent")}</Badge>}<StatusBadge status={x.status} /></span></Td>
                  {isTickets && <Td label={t("rdb.sup_handled_by")} className="text-sm text-muted">{isAssigned(x) ? <span className="inline-flex items-center gap-1.5"><UserCheck className="size-3.5" aria-hidden />{assigneeName(x) ?? t("fob.assigned_support")}</span> : "—"}</Td>}
                  <Td label={t("common.date")} className="whitespace-nowrap text-xs text-muted">{fmtDateTime(x.createdAt, locale)}</Td>
                  <Td align="end" className="w-10"><ChevronRight className="size-4 text-muted rtl:rotate-180" aria-hidden /></Td>
                </tr>
              );
            })}
          </Table>
          <Pagination page={isTickets ? tp : cp} total={cur.data.total ?? items.length} pageSize={cur.data.pageSize ?? 30} onPage={isTickets ? setTp : setCp} />
        </>
      )}
      {open && <SupportComposer key={open} kind={open} onClose={() => setOpen(null)} onCreated={() => { void cur.mutate(); void counts.mutate(); }} />}
      <Modal open={!!view} onClose={closeView} busy={a.any} title={tk?.subject ?? (view?.complaint && tr(t, `complaint_cat.${view.complaint.category}`, view.complaint.category)) ?? ""}
        footer={<>{canResolve && <Button variant="secondary" loading={a.is("resolve")} onClick={resolve} data-testid="ticket-resolve"><CheckCircle2 className="size-4" />{t("bz.resolve_ticket")}</Button>}<Button variant="ghost" onClick={closeView}>{t("common.close")}</Button></>}>
        <div data-testid="ticket-detail" className="space-y-4">
          {(tk || view?.complaint) && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2"><span data-testid="ticket-status"><StatusBadge status={status ?? "open"} /></span>{(tk ?? view.complaint).priority === "urgent" && <Badge tone="danger">{t("support.urgent")}</Badge>}<span className="ltr-num text-xs text-muted">{(tk ?? view.complaint).ref}</span></div>
              {tk && ["open", "in_review", "resolved"].includes(tk.status) && <p className="text-xs text-muted" data-testid="ticket-status-hint">{t(`fob.st_${tk.status}_hint`)}</p>}
              {assigned && <p className="flex items-center gap-1 text-xs text-muted" data-testid="ticket-assignee"><UserCheck className="size-3.5" aria-hidden />{assigneeName(tk) ?? t("fob.assigned_support")}</p>}
            </div>
          )}
          {me.role === "business" && linkedRequest && <Link href={`/business/requests/${linkedRequest}`} className="text-sm font-semibold text-cyan underline">{t("bz.view_request")}</Link>}
          {view?.complaint && <p className="rounded-xl bg-bg2 p-3 text-sm text-muted">{view.complaint.description}</p>}
          {view?.complaint?.resolution && <div className="rounded-xl border border-accent/40 bg-accent/5 p-3 text-sm"><p className="mb-1 font-semibold text-accent">{t("support.resolution")}</p>{view.complaint.resolution}</div>}
          <SupportMessages messages={messages} meId={me.id} roleLabel={(r) => tr(t, `role.${r}`, r)} />
          {tk?.status === "resolved" ? (
            <div className="space-y-3 rounded-xl border border-line p-3" data-testid="ticket-resolved">
              <p className="flex items-center gap-2 text-sm font-medium text-accent"><CheckCircle2 className="size-4" aria-hidden />{t("fob.resolved_note")}</p>
              {canReopen && !reopening && <Button size="sm" variant="secondary" onClick={() => { setReopening(true); setReopenErr(null); }} data-testid="ticket-reopen"><RotateCcw className="size-4" aria-hidden />{t("fob.reopen")}</Button>}
              {tk.openedBy === me.id && !canReopen && <p className="text-xs text-muted">{t("fob.reopen_expired")}</p>}
              {reopening && (
                <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); reopen(); }}>
                  <Textarea label={t("fob.reopen_reason")} value={reopenBody} onChange={(e) => setReopenBody(e.target.value)} maxLength={2000} rows={3} hint={t("fob.reopen_hint")} data-testid="ticket-reopen-body" />
                  <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" loading={a.is("reopen")} data-testid="ticket-reopen-confirm">{t("fob.reopen_confirm")}</Button><Button type="button" size="sm" variant="ghost" disabled={a.is("reopen")} onClick={() => { setReopening(false); setReopenErr(null); }}>{t("common.cancel")}</Button></div>
                </form>
              )}
              {reopenErr && <Notice tone="danger"><span data-testid="ticket-reopen-error">{reopenErr}</span></Notice>}
            </div>
          ) : view?.complaint?.status !== "closed" && (view?.ticket || view?.complaint) && (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); sendReply(); }} data-testid="ticket-reply-form">
              <Textarea aria-label={t("chat.placeholder")} rows={2} value={reply} maxLength={2000} onChange={(e) => setReply(e.target.value)} placeholder={t("chat.placeholder")} data-testid="ticket-reply" />
              {isTickets && <AttachmentPicker att={att} testid="reply-att" />}
              <div className="flex justify-end"><Button type="submit" loading={a.is("reply")} disabled={!reply.trim() || att.busy} data-testid="ticket-send">{t("chat.send")}</Button></div>
              {isTickets && att.items.length > 0 && !reply.trim() && <p className="text-xs text-muted">{t("fob.att_need_text")}</p>}
            </form>
          )}
        </div>
      </Modal>
    </>
  );
}
