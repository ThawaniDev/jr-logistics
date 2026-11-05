"use client";
import { useState } from "react";
import { Gavel } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Modal, PageHeader, PageLoading, StatusBadge, Tabs, Textarea, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { get, patch } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

const NEXT: Record<string, string[]> = { open: ["in_progress", "resolved"], in_progress: ["resolved"], resolved: ["closed", "in_progress"], closed: [] };
export default function Complaints() {
  const { t, locale } = useI18n(); const a = useAction();
  const [st, setSt] = useState("open"); const [view, setView] = useState<any>(null); const [res, setRes] = useState("");
  const { data, error, mutate } = useApi(`/admin/complaints?status=${st}`);
  const open = async (id: string) => { setView(await get(`/complaints/${id}`)); setRes(""); };
  const upd = (body: unknown) => a.run("u", () => patch(`/admin/complaints/${view.complaint.id}`, body), { success: "common.saved", onDone: () => { open(view.complaint.id); mutate(); } });
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  const c = view?.complaint;
  return (
    <>
      <PageHeader title={t("nav.complaints")} />
      <Tabs value={st} onChange={setSt} tabs={["open", "in_progress", "resolved", "closed"].map((k) => ({ key: k, label: t(`status.${k}`) }))} />
      {!data ? <PageLoading /> : data.items.length === 0 ? <EmptyState icon={<Gavel className="size-9" />} title={t("support.empty")} /> : (
        <div className="space-y-2">{data.items.map((x: any) => <button key={x.id} onClick={() => open(x.id)} className="block w-full text-start"><Card className="flex flex-wrap items-center justify-between gap-3 p-4 hover:border-accent/50"><div><p className="font-medium">{t(`complaint_cat.${x.category}`)}</p><p className="line-clamp-1 text-xs text-muted"><span className="ltr-num">{x.ref}</span> · {x.description}</p></div><div className="flex gap-2">{x.holdsSettlement && <Badge tone="warn">{t("complaints.holds_settlement")}</Badge>}{x.priority === "urgent" && <Badge tone="danger">{t("support.urgent")}</Badge>}<StatusBadge status={x.status} /></div></Card></button>)}</div>
      )}
      <Modal open={!!view} onClose={() => setView(null)} title={c ? `${c.ref} · ${t(`complaint_cat.${c.category}`)}` : ""} footer={<Button variant="ghost" onClick={() => setView(null)}>{t("common.close")}</Button>}>
        {c && <>
          <p className="rounded-xl bg-bg2 p-3 text-sm">{c.description}</p><p className="text-xs text-muted">{t(`role.${c.filedByRole}`)} · {fmtDateTime(c.createdAt, locale)}</p>
          {c.resolution && <div className="rounded-xl border border-accent/40 bg-accent/5 p-3 text-sm"><p className="mb-1 font-semibold text-accent">{t("support.resolution")}</p>{c.resolution}</div>}
          <div className="max-h-40 space-y-1 overflow-y-auto">{view.notes.map((n: any) => <p key={n.id} className="text-xs text-muted">[{n.kind}] {n.body} · {fmtDateTime(n.createdAt, locale)}</p>)}</div>
          {NEXT[c.status].length > 0 && <>
            {!c.handlerId && <Button size="sm" variant="secondary" onClick={() => upd({ assignToMe: true })}>{t("complaints.take")}</Button>}
            {(NEXT[c.status].includes("resolved") || NEXT[c.status].includes("closed")) && <Textarea label={t("support.resolution")} value={res} onChange={(e) => setRes(e.target.value)} />}
            <div className="flex flex-wrap gap-2">{NEXT[c.status].map((s) => <Button key={s} size="sm" loading={a.any} disabled={["resolved", "closed"].includes(s) && !res.trim() && !c.resolution} onClick={() => upd({ status: s, resolution: res || undefined })}>{t(`complaints.to_${s}`)}</Button>)}</div></>}
        </>}
      </Modal>
    </>
  );
}
