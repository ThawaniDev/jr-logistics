"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, FileCheck2, MessageSquareWarning, XCircle } from "lucide-react";
import { Badge, Button, CellPair, EmptyState, ErrorState, PageLoading, Segmented, StatusBadge, Table, Td, Toolbar, useAction } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { PrevNext, ReasonModal, fullErr, qs, useTx } from "./admin-common";
import { ownerHref } from "./admin-companies-lib";
import { IconAction } from "./admin-verification-parts";
import { usePageFor, useRefreshCompanies } from "./admin-companies-ctx";
import { useVerificationSummary } from "./admin-verification-frame";

type Decision = "approved" | "rejected" | "info_requested";
const STATES = ["submitted", "info_requested", "rejected", "approved"] as const;
const KINDS = ["all", "business", "office", "driver"] as const;
const LABEL: Record<Decision, string> = { approved: "verify.approve", rejected: "verify.reject", info_requested: "verify.request_info" };

/** Documents queue: every uploaded document of companies, offices and drivers (`GET /admin/documents`), reviewed with `POST /admin/documents/:id/review`. */
export function VerificationDocs() {
  const { t, locale } = useI18n(); const me = useUser(); const router = useRouter(); const path = usePathname(); const a = useAction(); const tx = useTx(); const refresh = useRefreshCompanies(); const sum = useVerificationSummary();
  const [stateRaw, setState] = useUrlState("status", "submitted"); const [kindRaw, setKind] = useUrlState("kind", "all");
  const status = (STATES as readonly string[]).includes(stateRaw) ? stateRaw : "submitted"; const kind = (KINDS as readonly string[]).includes(kindRaw) ? kindRaw : "all";
  const [page, setPage] = usePageFor(`${status}|${kind}`); const [ask, setAsk] = useState<null | { doc: any; decision: Decision }>(null); const [err, setErr] = useState<string | null>(null);
  const { data, error, mutate } = useApi(`/admin/documents${qs({ status, kind: kind === "all" ? "" : kind, page })}`, { keepPreviousData: true, shouldRetryOnError: false });
  const can = (p: string) => hasPerm(me, p);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const items: any[] = data.items; const byKind: Record<string, number> = sum.data?.documents?.byKind ?? {};
  const done = () => { setAsk(null); setErr(null); refresh(); mutate(); };
  const decide = (d: any, decision: Decision, note?: string) => a.run(`${decision}${d.id}`, () => post(`/admin/documents/${d.id}/review`, { decision, note }), { success: "common.saved", onDone: done, onError: (e) => setErr(fullErr(e, t)) });
  const waiting = status === "submitted";
  return (
    <>
      <Toolbar>
        <Segmented label={t("common.status")} value={status} onChange={setState} options={STATES.map((s) => ({ key: s, label: s === "submitted" ? t("rdp.docs_awaiting") : t(`docstatus.${s}`), count: s === "submitted" ? sum.data?.documents?.total : undefined }))} />
        <Segmented label={t("common.role")} value={kind} onChange={setKind} options={KINDS.map((k) => ({ key: k, label: k === "all" ? t("common.all") : t(`role.${k}`), count: waiting && k !== "all" ? byKind[k] ?? 0 : undefined }))} />
      </Toolbar>
      {items.length === 0 ? (
        <EmptyState icon={<FileCheck2 className="size-9" aria-hidden />} title={waiting && kind === "all" ? t("verify.nothing") : t("common.no_results")} hint={waiting && kind === "all" ? t("rdp.docs_nothing_hint") : t("ubz.no_results_hint")}
          action={status !== "submitted" || kind !== "all" ? <Button variant="secondary" onClick={() => router.replace(path, { scroll: false })}>{t("uxa.clear_filters")}</Button> : undefined} />
      ) : (
        <>
          <Table stack label={t("verify.documents")} head={[t("common.name"), t("verify.doc_type"), t("common.status"), t("docs.expires"), t("rdp.uploaded"), { label: t("rdp.col_actions"), align: "end" }]}>
            {items.map((d) => { const href = ownerHref(d.ownerKind, d.ownerId, can); return (
              <tr key={d.id} data-testid="verification-doc-row">
                <Td label={t("common.name")}><CellPair title={href ? <Link href={href} className="text-accent hover:underline">{d.ownerName}</Link> : d.ownerName} sub={<Badge className="mt-0.5">{t(`role.${d.ownerKind}`)}</Badge>} /></Td>
                <Td label={t("verify.doc_type")}><CellPair title={tx(`doc.${d.type}`, d.type)} sub={d.fileName} /></Td>
                <Td label={t("common.status")}><div className="space-y-1"><StatusBadge status={d.status} ns="docstatus" />{d.reviewNote && <p className="max-w-[16rem] text-xs text-muted">{d.reviewNote}</p>}</div></Td>
                <Td label={t("docs.expires")} className="whitespace-nowrap text-muted">{d.expiresOn ? fmtDate(d.expiresOn, locale) : "—"}</Td>
                <Td label={t("rdp.uploaded")} className="whitespace-nowrap text-muted">{fmtDateTime(d.createdAt, locale)}</Td>
                <Td align="end"><div className="flex items-center justify-end gap-1.5">
                  <a href={`/api/v1/documents/${d.id}/file`} target="_blank" rel="noreferrer" data-testid="verification-doc-view"><Button size="sm" variant="ghost"><ExternalLink className="size-4" aria-hidden />{t("docs.view")}</Button></a>
                  {d.status !== "approved" && <Button size="sm" data-testid="verification-doc-approve" loading={a.is(`approved${d.id}`)} onClick={() => decide(d, "approved")}><CheckCircle2 className="size-4" aria-hidden />{t("verify.approve")}</Button>}
                  {d.status !== "info_requested" && <IconAction label={t("verify.request_info")} variant="gold" testId="verification-doc-info" onClick={() => { setErr(null); setAsk({ doc: d, decision: "info_requested" }); }}><MessageSquareWarning className="size-4" aria-hidden /></IconAction>}
                  {d.status !== "rejected" && <IconAction label={t("verify.reject")} variant="danger" testId="verification-doc-reject" onClick={() => { setErr(null); setAsk({ doc: d, decision: "rejected" }); }}><XCircle className="size-4" aria-hidden /></IconAction>}
                </div></Td>
              </tr>); })}
          </Table>
          <PrevNext page={page} hasNext={items.length >= 50} onPage={setPage} />
        </>)}
      <ReasonModal open={!!ask} onClose={() => setAsk(null)} danger={ask?.decision === "rejected"} busy={!!ask && a.is(`${ask.decision}${ask.doc.id}`)}
        title={ask ? `${t(LABEL[ask.decision])} · ${tx(`doc.${ask.doc.type}`, ask.doc.type)}` : ""} confirmLabel={ask ? t(LABEL[ask.decision]) : undefined} label={t("verify.note")} hint={t("verify.note_hint")}
        onSubmit={(note) => ask && decide(ask.doc, ask.decision, note)}>{err && <p role="alert" className="text-sm text-danger">{err}</p>}</ReasonModal>
    </>
  );
}
