"use client";
import { ExternalLink } from "lucide-react";
import { Badge, EmptyState, ErrorState, Notice, PageLoading, Section, Stat, StatGrid, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { hasAny } from "./admin-common";

const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Every document an account ever submitted (not only the newest of each type): status, file, expiry and who decided what, when and why — including earlier rejections and
 * information requests. Listing needs `documents.review` or `verification.manage`; opening a file needs `documents.review`.
 */
export function DocumentHistory({ ownerId, kind }: { ownerId: string; kind: "driver" | "office" }) {
  const { t, locale } = useI18n(); const me = useUser();
  const canList = hasAny(me, "documents.review", "verification.manage"), canOpen = hasPerm(me, "documents.review");
  const { data, error, mutate } = useApi(canList ? `/admin/${kind}s/${ownerId}/documents-log` : null);
  if (!canList) return <Notice tone="warn">{t("rdq.no_access")}</Notice>;
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const s = data.summary; const next = s.nextExpiry as { type: string; expiresOn: string; daysLeft: number | null } | null;
  return (
    <div className="space-y-5" data-testid="dv2-doc-history">
      <StatGrid cols={4}>
        <Stat label={t("dv2.docs_submissions")} value={s.total} tone="cyan" hint={t("dv2.docs_split", { approved: s.approved, rejected: s.rejected })} />
        <Stat label={t("dv2.docs_pending")} value={s.pending + s.infoRequested} tone={s.pending ? "gold" : "muted"} hint={s.oldestPendingDays != null ? t("dv2.docs_oldest_days", { n: s.oldestPendingDays }) : t("dv2.docs_none_waiting")} />
        <Stat label={t("dv2.docs_missing")} value={s.missing.length} tone={s.missing.length ? "danger" : "accent"} hint={s.missing.length ? s.missing.map((m: any) => t(`doc.${m.type}`)).join(", ") : t("dv2.docs_all_approved")} />
        <Stat label={t("dv2.docs_next_expiry")} value={next ? <span className="ltr-num text-lg">{fmtDate(next.expiresOn, locale)}</span> : "—"} tone={next && next.daysLeft != null && next.daysLeft <= 30 ? "gold" : "muted"} hint={next ? `${t(`doc.${next.type}`)} · ${next.daysLeft != null && next.daysLeft < 0 ? t("ubz.doc_expired") : t("ubz.doc_expiring", { n: next.daysLeft ?? 0 })}` : t("dv2.docs_no_expiry")} />
      </StatGrid>
      <Section title={t("dv2.docs_history")} description={t("dv2.docs_history_sub")} flush>
        {data.items.length === 0 ? <div className="p-4"><EmptyState title={t("dv2.docs_none")} hint={t("dv2.docs_none_hint")} /></div> : (
          <Table stack bare dense label={t("dv2.docs_history")} head={[t("verify.doc_type"), t("common.status"), t("dv2.col_file"), t("rdq.col_uploaded"), t("docs.expires"), t("dv2.col_decision")]}>
            {data.items.map((d: any) => (
              <tr key={d.id} data-testid={`dv2-docrow-${d.id}`}>
                <Td><span className="font-medium">{t(`doc.${d.type}`)}</span></Td>
                <Td label={t("common.status")}><StatusBadge status={d.status} ns="docstatus" /></Td>
                <Td label={t("dv2.col_file")} className="max-w-56"><span className="block truncate" title={d.fileName}>{canOpen ? <a href={`/api/v1/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan hover:underline">{d.fileName}<ExternalLink className="size-3" aria-hidden /></a> : d.fileName}</span><span className="ltr-num text-xs text-muted">{kb(d.size)}</span></Td>
                <Td label={t("rdq.col_uploaded")} className="whitespace-nowrap text-muted">{fmtDateTime(d.uploadedAt, locale)}</Td>
                <Td label={t("docs.expires")} className="whitespace-nowrap">{d.expiresOn ? <span className="inline-flex flex-wrap items-center gap-1.5">{fmtDate(d.expiresOn, locale)}{d.daysLeft != null && d.daysLeft < 0 && d.status === "approved" && <Badge tone="danger">{t("ubz.doc_expired")}</Badge>}{d.daysLeft != null && d.daysLeft >= 0 && d.daysLeft <= 30 && d.status === "approved" && <Badge tone="warn">{t("ubz.doc_expiring", { n: d.daysLeft })}</Badge>}</span> : "—"}</Td>
                <Td label={t("dv2.col_decision")} className="max-w-72">
                  {d.decisions.length === 0 && !d.reviewedAt ? <span className="text-muted">{t("dv2.not_reviewed")}</span> : (
                    <ol className="space-y-1.5 text-start text-xs">
                      {(d.decisions.length ? d.decisions : [{ action: d.status, at: d.reviewedAt, by: d.reviewer, note: d.note }]).map((x: any, i: number) => (
                        <li key={i}><span className="font-medium">{t(`docstatus.${x.action}`)}</span>{x.by && <span className="text-muted"> · {x.by}</span>}<span className="ltr-num text-muted"> · {x.at ? fmtDateTime(x.at, locale) : "—"}</span>{x.note && <span className="block text-muted">{x.note}</span>}</li>
                      ))}
                    </ol>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}
