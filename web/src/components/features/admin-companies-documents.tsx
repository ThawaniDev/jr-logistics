"use client";
import { useState } from "react";
import { CheckCircle2, ExternalLink, FileX2, MessageSquareWarning, XCircle } from "lucide-react";
import { Badge, Button, CellPair, EmptyState, ErrorState, PageLoading, Section, StatusBadge, Table, Td, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { ReasonModal, PrevNext, fullErr, qs, useTx } from "./admin-common";
import { IconAction } from "./admin-verification-parts";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { ActivityLog } from "./activity-log";
import { useCompany, useRefreshCompanies } from "./admin-companies-ctx";

type Decision = "approved" | "rejected" | "info_requested";
const KEY: Record<Decision, string> = { approved: "verify.approve", rejected: "verify.reject", info_requested: "verify.request_info" };

/** Documents tab: everything this company uploaded, with the review decisions (`POST /admin/documents/:id/review`; reject and request-info need a note). */
export function CompanyDocuments() {
  const { t, locale } = useI18n(); const c = useCompany(); const a = useAction(); const tx = useTx(); const refresh = useRefreshCompanies(); const me = useUser();
  const [page, setPage] = useState(1); const [ask, setAsk] = useState<null | { doc: any; decision: Decision }>(null); const [err, setErr] = useState<string | null>(null);
  const { data: cat } = useApi("/catalog");
  const { data, error, mutate } = useApi(`/admin/documents${qs({ kind: "business", ownerId: c.id, page })}`, { keepPreviousData: true, shouldRetryOnError: false });
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const items: any[] = data.items; const types: Array<{ key: string; required: boolean }> = cat?.documents?.business ?? [];
  const latest = (type: string) => items.find((d) => d.type === type);
  const done = () => { setAsk(null); setErr(null); refresh(); };
  const decide = (d: any, decision: Decision, note?: string) => a.run(`${decision}${d.id}`, () => post(`/admin/documents/${d.id}/review`, { decision, note }), { success: "common.saved", onDone: done, onError: (e) => setErr(fullErr(e, t)) });
  const expired = (d: any) => !!d.expiresOn && new Date(d.expiresOn) < new Date();
  return (
    <div className="space-y-5">
      {types.length > 0 && (
        <Section title={t("rdp.required_docs")} description={t("rdp.required_docs_hint")}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {types.map((ty) => { const d = latest(ty.key); return (
              <li key={ty.key} data-testid={`companies-doc-type-${ty.key}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-4 py-3">
                <div className="min-w-0"><p className="text-sm font-medium">{tx(`doc.${ty.key}`, ty.key)}</p><p className="text-xs text-muted">{ty.required ? t("docs.required") : t("docs.optional")}</p></div>
                {d ? <StatusBadge status={d.status} ns="docstatus" /> : <Badge tone={ty.required ? "warn" : "neutral"}><FileX2 className="size-3" aria-hidden />{t("rdp.doc_missing")}</Badge>}
              </li>); })}
          </ul>
        </Section>)}

      <Section title={t("verify.documents")} flush>
        {items.length === 0 ? <div className="p-5"><EmptyState title={t("rdp.no_docs")} hint={t("rdp.no_docs_hint")} /></div> : (
          <Table bare stack label={t("verify.documents")} head={[t("verify.doc_type"), t("common.status"), t("docs.expires"), t("rdp.uploaded"), { label: t("rdp.col_actions"), align: "end" }]}>
            {items.map((d) => (
              <tr key={d.id} data-testid="companies-doc-row">
                <Td label={t("verify.doc_type")}><CellPair title={tx(`doc.${d.type}`, d.type)} sub={d.fileName} /></Td>
                <Td label={t("common.status")}><div className="space-y-1"><StatusBadge status={d.status} ns="docstatus" />{d.reviewNote && <p className="max-w-xs text-xs text-muted">{d.reviewNote}</p>}</div></Td>
                <Td label={t("docs.expires")} className="whitespace-nowrap">{d.expiresOn ? <span className={expired(d) ? "text-danger" : "text-muted"}>{fmtDate(d.expiresOn, locale)}{expired(d) && <Badge tone="danger" className="ms-1.5">{t("ubz.doc_expired")}</Badge>}</span> : "—"}</Td>
                <Td label={t("rdp.uploaded")} className="whitespace-nowrap text-muted">{fmtDateTime(d.createdAt, locale)}</Td>
                <Td align="end"><div className="flex items-center justify-end gap-1.5">
                  <a href={`/api/v1/documents/${d.id}/file`} target="_blank" rel="noreferrer" data-testid="companies-doc-view"><Button size="sm" variant="ghost"><ExternalLink className="size-4" aria-hidden />{t("docs.view")}</Button></a>
                  {d.status !== "approved" && <Button size="sm" data-testid="companies-doc-approve" loading={a.is(`approved${d.id}`)} onClick={() => decide(d, "approved")}><CheckCircle2 className="size-4" aria-hidden />{t("verify.approve")}</Button>}
                  {d.status !== "info_requested" && <IconAction label={t("verify.request_info")} variant="gold" testId="companies-doc-info" onClick={() => { setErr(null); setAsk({ doc: d, decision: "info_requested" }); }}><MessageSquareWarning className="size-4" aria-hidden /></IconAction>}
                  {d.status !== "rejected" && <IconAction label={t("verify.reject")} variant="danger" testId="companies-doc-reject" onClick={() => { setErr(null); setAsk({ doc: d, decision: "rejected" }); }}><XCircle className="size-4" aria-hidden /></IconAction>}
                </div></Td>
              </tr>))}
          </Table>)}
      </Section>
      <PrevNext page={page} hasNext={items.length >= 50} onPage={setPage} />
      {(hasPerm(me, "users.view") || hasPerm(me, "offices.view")) && <div data-testid="dv3-doc-history"><ActivityLog entity="user" id={c.id} kinds={["document"]} compact pageSize={10} title={t("dv3.doc_history")} /></div>}
      <ReasonModal open={!!ask} onClose={() => setAsk(null)} danger={ask?.decision === "rejected"} busy={!!ask && a.is(`${ask.decision}${ask.doc.id}`)}
        title={ask ? `${t(KEY[ask.decision])} · ${tx(`doc.${ask.doc.type}`, ask.doc.type)}` : ""} confirmLabel={ask ? t(KEY[ask.decision]) : undefined} label={t("verify.note")} hint={t("verify.note_hint")}
        onSubmit={(note) => ask && decide(ask.doc, ask.decision, note)}>{err && <p role="alert" className="text-sm text-danger">{err}</p>}</ReasonModal>
    </div>
  );
}
