"use client";
import { useState } from "react";
import { LifeBuoy } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Modal, PageHeader, PageLoading, StatusBadge, Tabs, Textarea, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { get, post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

export default function Cases() {
  const { t, locale } = useI18n(); const a = useAction();
  const [st, setSt] = useState("open"); const [view, setView] = useState<any>(null); const [reply, setReply] = useState(""); const [internal, setInternal] = useState(false);
  const { data, error, mutate } = useApi(`/admin/tickets?status=${st}`);
  const open = async (id: string) => setView(await get(`/tickets/${id}`));
  const send = () => a.run("r", async () => { await post(`/tickets/${view.ticket.id}/replies`, { body: reply, internal }); setReply(""); await open(view.ticket.id); mutate(); });
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  return (
    <>
      <PageHeader title={t("nav.cases")} subtitle={t("cases.sub")} />
      <Tabs value={st} onChange={setSt} tabs={["open", "in_review", "resolved"].map((k) => ({ key: k, label: t(`status.${k}`) }))} />
      {!data ? <PageLoading /> : data.items.length === 0 ? <EmptyState icon={<LifeBuoy className="size-9" />} title={t("support.empty")} /> : (
        <div className="space-y-2">{data.items.map((x: any) => (
          <button key={x.id} onClick={() => open(x.id)} className="block w-full text-start"><Card className="flex flex-wrap items-center justify-between gap-3 p-4 hover:border-accent/50"><div><p className="font-medium">{x.subject}</p><p className="text-xs text-muted"><span className="ltr-num">{x.ref}</span> · {t(`ticket_cat.${x.category}`)} · {fmtDateTime(x.createdAt, locale)}</p></div><div className="flex gap-2">{x.priority === "urgent" && <Badge tone="danger">{t("support.urgent")}</Badge>}<StatusBadge status={x.status} /></div></Card></button>))}</div>
      )}
      <Modal open={!!view} onClose={() => setView(null)} title={view?.ticket?.subject ?? ""} footer={<>{view?.ticket?.status !== "resolved" && <Button variant="secondary" loading={a.is("rs")} onClick={() => a.run("rs", () => post(`/tickets/${view.ticket.id}/resolve`), { success: "common.saved", onDone: () => { setView(null); mutate(); } })}>{t("cases.resolve")}</Button>}<Button variant="ghost" onClick={() => setView(null)}>{t("common.close")}</Button></>}>
        <div className="max-h-64 space-y-2 overflow-y-auto">{view?.replies.map((r: any) => <div key={r.id} className={`rounded-xl p-3 text-sm ${r.internal ? "border border-gold/40 bg-gold/5" : "bg-bg2"}`}><p className="mb-1 text-[11px] text-muted">{t(`role.${r.authorRole}`)} · {fmtDateTime(r.createdAt, locale)} {r.internal && `· ${t("cases.internal")}`}</p>{r.body}</div>)}</div>
        {view?.ticket?.status !== "resolved" && <><Textarea aria-label={t("chat.placeholder")} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t("chat.placeholder")} /><div className="flex items-center justify-between"><label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="accent-[var(--jr-accent)]" />{t("cases.internal_note")}</label><Button loading={a.is("r")} disabled={!reply.trim()} onClick={send}>{t("chat.send")}</Button></div></>}
      </Modal>
    </>
  );
}
