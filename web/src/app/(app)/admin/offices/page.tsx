"use client";
import { useState } from "react";
import { PageHeader, Modal, Button, Textarea, Input, useAction, Table, Td, StatusBadge, EmptyState, ErrorState, PageLoading } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { useUser, hasPerm } from "@/components/layout/auth-context";

export default function AdminOffices() {
  const { t } = useI18n(); const a = useAction(); const me = useUser();
  const { data, error, mutate } = useApi("/admin/users?role=office&pageSize=100");
  const [sel, setSel] = useState<any>(null); const [terms, setTerms] = useState(""); const [exp, setExp] = useState("");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  return (
    <>
      <PageHeader title={t("nav.offices")} subtitle={t("admin.offices_sub")} />
      {data.items.length === 0 ? <EmptyState title={t("common.no_results")} /> : (
        <Table head={[t("common.name"), t("auth.phone"), t("common.status"), ""]}>
          {data.items.map((o: any) => <tr key={o.id}><Td className="font-medium">{o.name}</Td><Td className="ltr-num text-muted">{o.phone}</Td><Td><StatusBadge status={o.status} /></Td>
            <Td><div className="flex flex-wrap gap-1">{hasPerm(me, "offices.manage") && <Button size="sm" variant="secondary" onClick={() => { setSel(o); setTerms(""); setExp(""); }}>{t("admin.send_agreement")}</Button>}
              {hasPerm(me, "offices.manage") && <Button size="sm" loading={a.is(o.id)} onClick={() => a.run(o.id, () => post(`/admin/users/${o.id}/verification`, { action: "verify" }), { success: "common.saved" })}>{t("verify.approve")}</Button>}</div></Td></tr>)}
        </Table>
      )}
      <Modal open={!!sel} onClose={() => setSel(null)} title={t("admin.send_agreement")} footer={<><Button variant="ghost" onClick={() => setSel(null)}>{t("common.cancel")}</Button><Button loading={a.is("ag")} onClick={() => a.run("ag", () => post(`/admin/offices/${sel.id}/agreements`, { terms: terms || undefined, expiresAt: exp ? new Date(exp).toISOString() : null }), { success: "common.saved", onDone: () => setSel(null) })}>{t("common.send")}</Button></>}>
        <Textarea label={t("admin.agreement_terms")} value={terms} onChange={(e) => setTerms(e.target.value)} /><Input label={t("admin.agreement_expiry")} type="date" ltr value={exp} onChange={(e) => setExp(e.target.value)} />
      </Modal>
    </>
  );
}
