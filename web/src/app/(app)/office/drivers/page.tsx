"use client";
import { useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoading, StatusBadge, Table, Td, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";

export default function OfficeDrivers() {
  const { t } = useI18n(); const a = useAction();
  const { data, error, mutate } = useApi("/office/drivers");
  const [open, setOpen] = useState(false); const [phone, setPhone] = useState("");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  return (
    <>
      <PageHeader title={t("nav.drivers")} subtitle={t("office.drivers_sub")} actions={<Button onClick={() => setOpen(true)}><UserPlus className="size-4" />{t("office.invite_driver")}</Button>} />
      {!data ? <PageLoading /> : data.items.length === 0 ? <EmptyState icon={<Users className="size-9" />} title={t("office.no_drivers")} hint={t("office.no_drivers_hint")} /> : (
        <Table head={[t("common.name"), t("auth.phone"), t("wizard.vehicle"), t("verify.title"), t("common.status"), ""]}>
          {data.items.map((d: any) => (
            <tr key={d.id}><Td className="font-medium">{d.name}{d.rating && <span className="ms-2 text-xs text-gold">★ {d.rating}</span>}</Td><Td className="ltr-num text-muted">{d.phone}</Td>
              <Td>{d.vehicleType ? t(`vehicle.${d.vehicleType}`) : "—"}{d.vehicleTemperature ? ` · ${t(`temp.${d.vehicleTemperature}`)}` : ""}</Td><Td><StatusBadge status={d.verificationStatus} /></Td>
              <Td>{d.onJob ? <Badge tone="warn">{t("office.on_job")}</Badge> : d.availability === "available" ? <Badge tone="success">{t("driver.online")}</Badge> : <Badge>{t("driver.offline")}</Badge>}</Td>
              <Td><Button size="sm" variant="ghost" disabled={d.onJob} loading={a.is(d.id)} onClick={() => confirm(t("office.unlink_confirm")) && a.run(d.id, () => post(`/office/drivers/${d.id}/unlink`), { success: "common.saved", onDone: () => mutate() })}>{t("office.unlink")}</Button></Td></tr>
          ))}
        </Table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t("office.invite_driver")} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button><Button loading={a.is("inv")} disabled={phone.length < 8} onClick={() => a.run("inv", () => post("/office/drivers/invite", { phone }), { success: "office.invited", onDone: () => { setOpen(false); setPhone(""); } })}>{t("office.send_invite")}</Button></>}>
        <Input label={t("auth.phone")} type="tel" ltr placeholder="05XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} hint={t("office.invite_hint")} autoFocus />
      </Modal>
    </>
  );
}
