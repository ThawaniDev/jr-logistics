"use client";
import { useState } from "react";
import { LifeBuoy } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Modal, PageHeader, PageLoading, Select, StatusBadge, Tabs, Textarea, Input, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { get, post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";

export function SupportPage() {
  const { t, locale } = useI18n(); const me = useUser(); const a = useAction();
  const [tab, setTab] = useState("tickets");
  const [open, setOpen] = useState<null | "ticket" | "complaint">(null);
  const [form, setForm] = useState<any>({}); const [view, setView] = useState<any>(null); const [reply, setReply] = useState("");
  const { data: cat } = useApi("/catalog");
  const tickets = useApi("/tickets"); const complaints = useApi("/complaints");
  const cur = tab === "tickets" ? tickets : complaints;
  if (cur.error) return <ErrorState error={cur.error} retry={() => cur.mutate()} />;
  const cats = tab === "tickets" ? cat?.ticketCategories?.[me.role] ?? [] : cat?.complaintCategories ?? [];

  const create = () => a.run("create", () => post(open === "ticket" ? "/tickets" : "/complaints", open === "ticket" ? { category: form.category, subject: form.subject, body: form.body } : { category: form.category, description: form.body }), {
    success: "common.saved", onDone: () => { setOpen(null); setForm({}); cur.mutate(); },
  });
  const openItem = async (id: string) => setView(tab === "tickets" ? await get(`/tickets/${id}`) : await get(`/complaints/${id}`));
  const sendReply = () => a.run("reply", async () => { await post(tab === "tickets" ? `/tickets/${view.ticket.id}/replies` : `/complaints/${view.complaint.id}/notes`, { body: reply }); setReply(""); await openItem(tab === "tickets" ? view.ticket.id : view.complaint.id); });

  return (
    <>
      <PageHeader title={t("nav.support")} subtitle={t("support.sub")} actions={<Button onClick={() => { setForm({}); setOpen(tab === "tickets" ? "ticket" : "complaint"); }}>{t(tab === "tickets" ? "support.new_ticket" : "support.new_complaint")}</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "tickets", label: t("support.tickets"), count: tickets.data?.total }, { key: "complaints", label: t("support.complaints"), count: complaints.data?.total }]} />
      {!cur.data ? <PageLoading /> : cur.data.items.length === 0 ? <EmptyState icon={<LifeBuoy className="size-9" />} title={t("support.empty")} hint={t("support.empty_hint")} /> : (
        <div className="space-y-2">
          {cur.data.items.map((x: any) => (
            <button key={x.id} onClick={() => openItem(x.id)} className="block w-full text-start">
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4 transition hover:border-accent/50">
                <div className="min-w-0"><p className="font-medium">{x.subject ?? t(`complaint_cat.${x.category}`)}</p><p className="text-xs text-muted"><span className="ltr-num">{x.ref}</span> · {fmtDateTime(x.createdAt, locale)}</p></div>
                <div className="flex gap-2">{x.priority === "urgent" && <Badge tone="danger">{t("support.urgent")}</Badge>}<StatusBadge status={x.status} /></div>
              </Card>
            </button>
          ))}
        </div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={t(open === "ticket" ? "support.new_ticket" : "support.new_complaint")} footer={<><Button variant="ghost" onClick={() => setOpen(null)}>{t("common.cancel")}</Button><Button loading={a.is("create")} onClick={create} disabled={!form.category || !form.body || (open === "ticket" && !form.subject)}>{t("common.submit")}</Button></>}>
        <Select label={t("support.category")} placeholder={t("common.select")} options={cats.map((c: string) => ({ value: c, label: t(`${open === "ticket" ? "ticket_cat" : "complaint_cat"}.${c}`) }))} value={form.category ?? ""} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        {open === "ticket" && <Input label={t("support.subject")} value={form.subject ?? ""} onChange={(e) => setForm({ ...form, subject: e.target.value })} maxLength={150} />}
        <Textarea label={t("support.details")} value={form.body ?? ""} onChange={(e) => setForm({ ...form, body: e.target.value })} maxLength={2000} hint={open === "complaint" ? t("support.min_chars") : undefined} />
      </Modal>
      <Modal open={!!view} onClose={() => setView(null)} title={view?.ticket?.subject ?? (view?.complaint && t(`complaint_cat.${view.complaint.category}`)) ?? ""} footer={<Button variant="ghost" onClick={() => setView(null)}>{t("common.close")}</Button>}>
        {view?.complaint && <p className="text-sm text-muted">{view.complaint.description}</p>}
        {view?.complaint?.resolution && <div className="rounded-xl border border-accent/40 bg-accent/5 p-3 text-sm"><p className="mb-1 font-semibold text-accent">{t("support.resolution")}</p>{view.complaint.resolution}</div>}
        <div className="max-h-64 space-y-2 overflow-y-auto">{(view?.replies ?? view?.notes ?? []).map((r: any) => <div key={r.id} className="rounded-xl bg-bg2 p-3 text-sm"><p className="mb-1 text-[11px] text-muted">{t(`role.${r.authorRole}`)} · {fmtDateTime(r.createdAt, locale)}</p>{r.body}</div>)}</div>
        {(view?.ticket?.status !== "resolved" && view?.complaint?.status !== "closed") && <div className="flex gap-2"><input className="h-10 flex-1 rounded-xl border border-line bg-bg2 px-3 text-sm" value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t("chat.placeholder")} /><Button loading={a.is("reply")} disabled={!reply.trim()} onClick={sendReply}>{t("chat.send")}</Button></div>}
      </Modal>
    </>
  );
}
