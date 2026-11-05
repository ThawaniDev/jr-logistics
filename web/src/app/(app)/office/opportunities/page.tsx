"use client";
import { useState } from "react";
import { Briefcase } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, PageLoading, Select, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

export default function OfficeOpps() {
  const { t, locale } = useI18n(); const a = useAction(); const [pick, setPick] = useState<Record<string, string>>({});
  const { data, error, mutate } = useApi("/office/opportunities");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  return (
    <>
      <PageHeader title={t("nav.opportunities")} subtitle={t("office.opps_sub")} />
      {data.items.length === 0 ? <EmptyState icon={<Briefcase className="size-9" />} title={t("office.no_opps")} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.items.map((o: any) => (
            <Card key={o.id} className="space-y-3">
              <div className="flex items-start justify-between"><div><p className="font-semibold">{t(`svc.${o.service}`)} <span className="ltr-num text-xs font-normal text-muted">· {o.ref}</span></p><p className="text-sm text-muted">{fmtDateTime(o.startsAt, locale)} · {t(`city.${o.pickupCity}`)} → {t(`city.${o.deliveryCity}`)}</p></div>{o.preferred && <Badge tone="success">{t("office.preferred")}</Badge>}</div>
              <p className="text-sm">{o.vehicleType && t(`vehicle.${o.vehicleType}`)} · {t("req.slots")} {o.slotsFilled}/{o.quantity}</p>
              {o.eligibleDrivers.length === 0 ? <p className="text-sm text-muted">{t("office.no_eligible")}</p> : (
                <div className="flex gap-2"><div className="flex-1"><Select aria-label={t("office.pick_driver")} placeholder={t("office.pick_driver")} options={o.eligibleDrivers.map((d: any) => ({ value: d.id, label: d.name }))} value={pick[o.id] ?? ""} onChange={(e) => setPick({ ...pick, [o.id]: e.target.value })} /></div>
                  <Button disabled={!pick[o.id]} loading={a.is(o.id)} onClick={() => a.run(o.id, () => post(`/office/opportunities/${o.id}/assign`, { driverId: pick[o.id] }), { success: "office.assigned", onDone: () => mutate() })}>{t("office.assign")}</Button></div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
