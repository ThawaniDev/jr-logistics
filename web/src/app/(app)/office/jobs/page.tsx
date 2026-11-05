"use client";
import { useState } from "react";
import { Truck } from "lucide-react";
import { Button, EmptyState, ErrorState, Modal, PageHeader, PageLoading, StatusBadge, Table, Td, Textarea, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

export default function OfficeJobs() {
  const { t, locale } = useI18n(); const a = useAction(); const [sel, setSel] = useState<any>(null); const [reason, setReason] = useState("");
  const { data, error, mutate } = useApi("/office/jobs");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  return (
    <>
      <PageHeader title={t("nav.active_jobs")} />
      {data.items.length === 0 ? <EmptyState icon={<Truck className="size-9" />} title={t("jobs.empty")} /> : (
        <Table head={[t("req.ref"), t("nav.drivers"), t("req.starts"), t("req.route"), t("common.status"), ""]}>
          {data.items.map((j: any) => <tr key={j.offerId}><Td className="ltr-num font-semibold">{j.ref}</Td><Td>{j.driver}</Td><Td className="text-muted">{fmtDateTime(j.startsAt, locale)}</Td><Td className="text-muted">{t(`city.${j.pickupCity}`)} → {t(`city.${j.deliveryCity}`)}</Td><Td><StatusBadge status={j.status} ns="jobstatus" /></Td>
            <Td>{["accepted", "arrived"].includes(j.status) && <Button size="sm" variant="danger" onClick={() => { setSel(j); setReason(""); }}>{t("office.replace")}</Button>}</Td></tr>)}
        </Table>
      )}
      <Modal open={!!sel} onClose={() => setSel(null)} title={t("office.replace")} footer={<><Button variant="ghost" onClick={() => setSel(null)}>{t("common.cancel")}</Button><Button variant="danger" loading={a.any} disabled={reason.trim().length < 3} onClick={() => a.run("rp", () => post(`/office/jobs/${sel.offerId}/replace`, { reason }), { success: "common.saved", onDone: () => { setSel(null); mutate(); } })}>{t("common.confirm")}</Button></>}>
        <Textarea label={t("req.reason")} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );
}
