"use client";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge, ErrorState, Notice, Section, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { hasAny, qs } from "./admin-common";
import { LoadingRows } from "./admin-offices-common";
import { daysUntil, documentRows } from "./admin-offices-lib";
import { DocumentHistory } from "./admin-driver-docs";

/**
 * Documents of one office or driver: the newest file per type plus the required types nobody uploaded yet.
 * Listing needs `documents.review` or `verification.manage`; opening the file needs `documents.review` (what the file endpoint enforces).
 * Approving or rejecting stays in the verification queue.
 */
export function OwnerDocuments({ ownerId, kind }: { ownerId: string; kind: "office" | "driver" }) {
  const { t, locale } = useI18n(); const me = useUser();
  const canList = hasAny(me, "documents.review", "verification.manage"), canOpen = hasPerm(me, "documents.review");
  const cat = useApi("/catalog"); const { data, error, mutate } = useApi(canList ? `/admin/documents${qs({ ownerId, kind })}` : null);
  if (!canList) return <Notice tone="warn">{t("rdq.no_access")}</Notice>;
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  const loading = !data || !cat.data;
  const rows = loading ? [] : documentRows<any>(data.items, cat.data.documents[kind] ?? []);
  const head = [t("verify.doc_type"), t("common.status"), t("rdq.col_uploaded"), t("docs.expires"), t("verify.note"), { label: t("docs.view"), srOnly: true }];
  return (
    <Section title={t("nav.documents")} description={t("rdq.documents_sub")} flush
      actions={hasAny(me, "verification.manage", "documents.review", "offices.view") ? <Link href="/admin/verification" className="text-sm font-medium text-accent hover:underline" data-testid="rdq-open-verification">{t("rdq.review_in_verification")}</Link> : undefined}>
      <Table stack bare dense label={t("nav.documents")} head={head}>
        {loading ? <LoadingRows cols={head.length} rows={3} /> : rows.map(({ key, required, doc }) => {
          const left = daysUntil(doc?.expiresOn);
          return (
            <tr key={key} data-testid={`rdq-doc-${key}`}>
              <Td><span className="font-medium">{t(`doc.${key}`)}</span> {required && <Badge tone="warn" className="ms-1">{t("docs.required")}</Badge>}</Td>
              <Td label={t("common.status")}>{doc ? <StatusBadge status={doc.status} ns="docstatus" /> : <Badge tone={required ? "danger" : "neutral"}>{t("rdq.doc_missing")}</Badge>}</Td>
              <Td label={t("rdq.col_uploaded")} className="whitespace-nowrap text-muted">{doc ? fmtDateTime(doc.createdAt, locale) : "—"}</Td>
              <Td label={t("docs.expires")} className="whitespace-nowrap">{doc?.expiresOn ? <span className="inline-flex flex-wrap items-center gap-1.5">{fmtDate(doc.expiresOn, locale)}{left !== null && left < 0 && <Badge tone="danger">{t("ubz.doc_expired")}</Badge>}{left !== null && left >= 0 && left <= 30 && <Badge tone="warn">{t("ubz.doc_expiring", { n: left })}</Badge>}</span> : "—"}</Td>
              <Td label={t("verify.note")} className="max-w-64 text-muted">{doc?.reviewNote ?? "—"}</Td>
              <Td align="end">{doc && canOpen ? <a href={`/api/v1/documents/${doc.id}/file`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-cyan hover:underline" data-testid={`rdq-doc-view-${key}`}>{t("docs.view")}<ExternalLink className="size-3" aria-hidden /></a> : null}</Td>
            </tr>
          );
        })}
      </Table>
    </Section>
  );
}

export function OfficeDocumentsTab({ id }: { id: string }) { return <div className="space-y-5"><OwnerDocuments ownerId={id} kind="office" /><DocumentHistory ownerId={id} kind="office" /></div>; }
