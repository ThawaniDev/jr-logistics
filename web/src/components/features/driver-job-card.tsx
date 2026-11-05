"use client";
import Link from "next/link";
import { CalendarClock, MapPin, Truck, Hash } from "lucide-react";
import { Badge, Card, StatusBadge } from "@/components/ui";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

export function JobCard({ job, children, href }: { job: any; children?: React.ReactNode; href?: string }) {
  const { t, locale } = useI18n();
  const body = (
    <Card className="space-y-3 p-4 transition hover:border-accent/50">
      <div className="flex items-start justify-between gap-2">
        <div><p className="font-semibold">{t(`svc.${job.service}`)} <span className="ltr-num text-xs font-normal text-muted">· {job.ref}</span></p>{job.business && <p className="text-xs text-muted">{job.business}</p>}</div>
        <div className="flex flex-wrap justify-end gap-1">{job.isReplacement && <Badge tone="warn">{t("req.replacement")}</Badge>}<StatusBadge status={job.status} ns="jobstatus" /></div>
      </div>
      <div className="grid gap-2 text-sm text-muted sm:grid-cols-2">
        <p className="flex items-center gap-2"><CalendarClock className="size-4 shrink-0 text-cyan" aria-hidden />{fmtDateTime(job.startsAt, locale)}</p>
        <p className="flex items-center gap-2"><MapPin className="size-4 shrink-0 text-cyan" aria-hidden />{t(`city.${job.pickupCity}`)} → {t(`city.${job.deliveryCity}`)}</p>
        {job.vehicleType && <p className="flex items-center gap-2"><Truck className="size-4 shrink-0 text-cyan" aria-hidden />{t(`vehicle.${job.vehicleType}`)}{job.temperature ? ` · ${t(`temp.${job.temperature}`)}` : ""}</p>}
        <p className="flex items-center gap-2"><Hash className="size-4 shrink-0 text-cyan" aria-hidden />{fmtNum(job.expectedUnits, locale)} {t(job.service === "delivery_driver" ? "unit.shipment" : "unit.vehicle_day")}</p>
      </div>
      {job.earningHidden ? <p className="text-xs text-muted">{t("job.paid_by_office")}</p> : job.expectedEarningCents != null && (
        <div className="flex items-center justify-between rounded-xl bg-accent/10 px-3 py-2"><span className="text-xs text-muted">{t("job.expected_earning")}</span><span className="ltr-num font-bold text-accent">{fmtMoney(job.expectedEarningCents, locale)}</span></div>
      )}
      {children}
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}
