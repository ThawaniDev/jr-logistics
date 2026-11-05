"use client";
import { useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Modal, PageHeader, PageLoading, StatusBadge, Table, Tabs, Td, Textarea, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

export default function Verification() {
  const { t, locale } = useI18n(); const a = useAction();
  const [tab, setTab] = useState("docs"); const [m, setM] = useState<null | { kind: "doc" | "acct"; item: any; action: string }>(null); const [note, setNote] = useState("");
  const q = useApi("/admin/verification-queue"); const docs = useApi("/admin/documents?status=submitted");
  if (q.error) return <ErrorState error={q.error} retry={() => q.mutate()} />;
  if (!q.data || !docs.data) return <PageLoading />;
  const done = () => { setM(null); setNote(""); q.mutate(); docs.mutate(); };
  const submit = () => m!.kind === "doc"
    ? a.run("s", () => post(`/admin/documents/${m!.item.id}/review`, { decision: m!.action, note }), { success: "common.saved", onDone: done })
    : a.run("s", () => post(`/admin/users/${m!.item.id}/verification`, { action: m!.action, note }), { success: "common.saved", onDone: done });
  const needNote = m && m.action !== "approved" && m.action !== "verify";
  return (
    <>
      <PageHeader title={t("nav.verification")} subtitle={t("verify.admin_sub")} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "docs", label: t("verify.documents"), count: docs.data.items.length }, { key: "business", label: t("role.business"), count: q.data.business.length }, { key: "offices", label: t("role.office"), count: q.data.offices.length }, { key: "drivers", label: t("role.driver"), count: q.data.drivers.length }]} />
      {tab === "docs" && (docs.data.items.length === 0 ? <EmptyState icon={<ShieldCheck className="size-9" />} title={t("verify.nothing")} /> : (
        <Table head={[t("common.name"), t("verify.doc_type"), t("docs.expires"), t("common.date"), ""]}>
          {docs.data.items.map((d: any) => <tr key={d.id}><Td className="font-medium">{d.ownerName} <Badge className="ms-1">{t(`role.${d.ownerKind}`)}</Badge></Td><Td>{t(`doc.${d.type}`)}</Td><Td className="text-muted">{d.expiresOn ? fmtDate(d.expiresOn, locale) : "—"}</Td><Td className="text-muted">{fmtDateTime(d.createdAt, locale)}</Td>
            <Td><div className="flex flex-wrap gap-1"><a href={`/api/v1/documents/${d.id}/file`} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ExternalLink className="size-4" />{t("docs.view")}</Button></a>
              <Button size="sm" onClick={() => a.run("ap" + d.id, () => post(`/admin/documents/${d.id}/review`, { decision: "approved" }), { success: "common.saved", onDone: done })} loading={a.is("ap" + d.id)}>{t("verify.approve")}</Button>
              <Button size="sm" variant="gold" onClick={() => setM({ kind: "doc", item: d, action: "info_requested" })}>{t("verify.request_info")}</Button><Button size="sm" variant="danger" onClick={() => setM({ kind: "doc", item: d, action: "rejected" })}>{t("verify.reject")}</Button></div></Td></tr>)}
        </Table>))}
      {(tab === "business" || tab === "offices") && ((tab === "business" ? q.data.business : q.data.offices).length === 0 ? <EmptyState icon={<ShieldCheck className="size-9" />} title={t("verify.nothing")} /> : (
        <Table head={[t("common.name"), t("reg.cr"), t("common.status"), t("common.date"), ""]}>
          {(tab === "business" ? q.data.business : q.data.offices).map((b: any) => <tr key={b.id}><Td className="font-medium">{b.company ?? b.name}</Td><Td className="ltr-num text-muted">{b.cr ?? "—"}</Td><Td><StatusBadge status={b.status} /></Td><Td className="text-muted">{fmtDateTime(b.createdAt, locale)}</Td>
            <Td><div className="flex flex-wrap gap-1"><Button size="sm" loading={a.is("v" + b.id)} onClick={() => a.run("v" + b.id, () => post(`/admin/users/${b.id}/verification`, { action: "verify" }), { success: "common.saved", onDone: done })}>{t("verify.approve")}</Button><Button size="sm" variant="gold" onClick={() => setM({ kind: "acct", item: b, action: "request_info" })}>{t("verify.request_info")}</Button><Button size="sm" variant="danger" onClick={() => setM({ kind: "acct", item: b, action: "reject" })}>{t("verify.reject")}</Button></div></Td></tr>)}
        </Table>))}
      {tab === "drivers" && (q.data.drivers.length === 0 ? <EmptyState title={t("verify.nothing")} /> : <Table head={[t("common.name"), t("wizard.vehicle"), t("common.date")]}>{q.data.drivers.map((d: any) => <tr key={d.id}><Td className="font-medium">{d.name}</Td><Td>{d.vehicleType ? t(`vehicle.${d.vehicleType}`) : "—"}</Td><Td className="text-muted">{fmtDateTime(d.createdAt, locale)}</Td></tr>)}</Table>)}
      <Modal open={!!m} onClose={() => setM(null)} title={m ? t(`verify.${m.action === "rejected" || m.action === "reject" ? "reject" : "request_info"}`) : ""} footer={<><Button variant="ghost" onClick={() => setM(null)}>{t("common.cancel")}</Button><Button loading={a.is("s")} disabled={!!needNote && !note.trim()} onClick={submit}>{t("common.confirm")}</Button></>}>
        <Textarea label={t("verify.note")} hint={t("verify.note_hint")} value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </>
  );
}
