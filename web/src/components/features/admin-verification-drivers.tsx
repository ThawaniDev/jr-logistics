"use client";
import Link from "next/link";
import { ChevronRight, Truck } from "lucide-react";
import { Button, CellPair, EmptyState, ErrorState, Notice, PageLoading, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { hasAny, useTx } from "./admin-common";

/** Drivers queue: drivers whose documents are still being checked. The decision itself is made on their documents (Documents tab) — here we only point at who is waiting. */
export function VerificationDrivers() {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const { data, error, mutate } = useApi("/admin/verification-queue");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const rows: any[] = [...data.drivers].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const canDrivers = hasPerm(me, "drivers.view"), canDocs = hasAny(me, "documents.review", "verification.manage");
  if (rows.length === 0) return <EmptyState icon={<Truck className="size-9" aria-hidden />} title={t("verify.nothing")} hint={t("rdp.vf_drivers_nothing_hint")} />;
  return (
    <div className="space-y-4">
      {canDocs && <Notice tone="info">{t("uxa.driver_docs_hint")} <Link href="/admin/verification/documents?kind=driver" className="font-medium text-accent hover:underline">{t("rdp.vf_driver_docs_link")}</Link></Notice>}
      <Table stack label={t("rdp.vf_drivers")} head={[t("common.name"), t("wizard.vehicle"), t("rdp.vf_waiting_since"), { label: t("common.open"), srOnly: true }]}>
        {rows.map((d) => (
          <tr key={d.id} data-testid="verification-driver-row">
            <Td label={t("common.name")}><CellPair href={canDrivers ? `/admin/drivers/${d.id}` : undefined} title={d.name} /></Td>
            <Td label={t("wizard.vehicle")} className="text-muted">{d.vehicleType ? tx(`vehicle.${d.vehicleType}`, d.vehicleType) : "—"}</Td>
            <Td label={t("rdp.vf_waiting_since")} className="whitespace-nowrap text-muted">{fmtDateTime(d.createdAt, locale)}</Td>
            <Td align="end">{canDrivers && <Link href={`/admin/drivers/${d.id}`}><Button size="sm" variant="secondary">{t("adm.review")}<ChevronRight className="size-4 rtl:rotate-180" aria-hidden /></Button></Link>}</Td>
          </tr>))}
      </Table>
    </div>
  );
}
