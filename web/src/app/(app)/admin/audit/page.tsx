"use client";
import { useState } from "react";
import { EmptyState, ErrorState, Input, PageHeader, PageLoading, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

export default function Audit() {
  const { t, locale } = useI18n(); const [entity, setEntity] = useState("");
  const { data, error, mutate } = useApi(`/admin/audit${entity ? `?entity=${encodeURIComponent(entity)}` : ""}`);
  return (
    <>
      <PageHeader title={t("nav.audit")} subtitle={t("audit.sub")} actions={<div className="w-48"><Input aria-label={t("audit.entity")} placeholder={t("audit.entity")} ltr value={entity} onChange={(e) => setEntity(e.target.value)} /></div>} />
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : data.items.length === 0 ? <EmptyState title={t("common.no_results")} /> : (
        <Table head={[t("common.date"), t("common.role"), t("audit.action"), t("audit.entity"), t("audit.details")]}>
          {data.items.map((a: any) => <tr key={a.id}><Td className="whitespace-nowrap text-muted">{fmtDateTime(a.createdAt, locale)}</Td><Td>{a.actorRole ? t(`role.${a.actorRole}`) : "—"}</Td><Td className="ltr-num font-medium">{a.action}</Td><Td className="ltr-num text-muted">{a.entity}{a.entityId ? ` · ${String(a.entityId).slice(0, 8)}` : ""}</Td><Td className="ltr-num max-w-xs truncate text-xs text-muted">{a.diff ? JSON.stringify(a.diff) : ""}</Td></tr>)}
        </Table>
      )}
    </>
  );
}
