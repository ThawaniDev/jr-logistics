"use client";
import { useState } from "react";
import { EmptyState, ErrorState, Input, PageHeader, PageLoading, Select, StatusBadge, Table, Td, Button, Badge, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser, hasPerm } from "@/components/layout/auth-context";

export default function AdminDrivers() {
  const { t, locale } = useI18n(); const a = useAction(); const me = useUser();
  const [q, setQ] = useState(""); const [vf, setVf] = useState("");
  const { data, error, mutate } = useApi(`/admin/drivers?x=1${q ? `&q=${encodeURIComponent(q)}` : ""}${vf ? `&verification=${vf}` : ""}`);
  return (
    <>
      <PageHeader title={t("nav.drivers")} />
      <div className="mb-4 flex flex-wrap gap-3"><div className="w-64"><Input aria-label={t("common.search")} placeholder={t("admin.search_users")} value={q} onChange={(e) => setQ(e.target.value)} /></div><div className="w-48"><Select aria-label={t("verify.title")} placeholder={t("common.all")} options={["pending", "verified", "rejected", "expired"].map((x) => ({ value: x, label: t(`status.${x}`) }))} value={vf} onChange={(e) => setVf(e.target.value)} /></div></div>
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : data.items.length === 0 ? <EmptyState title={t("common.no_results")} /> : (
        <Table head={[t("common.name"), t("auth.phone"), t("wizard.vehicle"), t("verify.title"), t("driver.completed"), t("driver.rating"), t("common.status")]}>
          {data.items.map((d: any) => <tr key={d.id}><Td className="font-medium">{d.name}{d.officeId && <Badge tone="info" className="ms-2">{t("admin.office_driver")}</Badge>}</Td><Td className="ltr-num text-muted">{d.phone}</Td><Td>{d.vehicleType ? t(`vehicle.${d.vehicleType}`) : "—"}</Td><Td><StatusBadge status={d.verificationStatus} /></Td><Td className="tabular-nums">{d.jobsCompleted}</Td><Td>{d.rating ? `★ ${d.rating}` : "—"}</Td>
            <Td>{d.suspendedUntil && new Date(d.suspendedUntil) > new Date() ? <div className="flex items-center gap-2"><Badge tone="danger">{t("driver.suspended")}</Badge>{hasPerm(me, "users.edit") && <Button size="sm" variant="secondary" loading={a.is(d.id)} onClick={() => a.run(d.id, () => post(`/admin/drivers/${d.id}/clear-suspension`), { success: "common.saved", onDone: () => mutate() })}>{t("admin.clear_suspension")}</Button>}</div> : <StatusBadge status={d.status} />}</Td></tr>)}
        </Table>
      )}
    </>
  );
}
