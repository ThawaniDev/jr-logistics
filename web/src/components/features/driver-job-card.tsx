"use client";
import Link from "next/link";
import { CalendarClock, MapPin, Truck, Hash, Users } from "lucide-react";
import { Badge, Card, StatusBadge } from "@/components/ui";
import { progressOf, type StopsSummary } from "./driver-stops-shared";
import { JobCounters } from "./driver-job-stats";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

export function JobCard({ job, children, href, history }: { job: any; children?: React.ReactNode; href?: string; history?: boolean }) {
  const { t, locale } = useI18n();
  // Per-parcel jobs: no single delivery address or recipient (they are per stop). Before accepting, the count is a ceiling — the exact share is set on accept.
  const manifest = job.manifest === true; const offered = job.status === "offered";
  const units = manifest
    ? (offered ? t("dstop.up_to_parcels", { n: fmtNum(job.expectedUnits, locale) }) : t("dstop.n_stops_in", { n: fmtNum(job.stopsSummary?.total || job.expectedUnits, locale), city: t(`city.${job.deliveryCity}`) }))
    : `${fmtNum(job.expectedUnits, locale)} ${t(job.service === "delivery_driver" ? "unit.shipment" : "unit.vehicle_day")}`;
  // Active jobs: show where the route stands and what the driver should do now, so the dashboard answers "what next?" without opening the job.
  const sum = manifest && job.status === "attendance_confirmed" ? (job.stopsSummary as StopsSummary | null) : null;
  const prog = sum && sum.total > 0 ? progressOf(sum) : null;
  const showHint = !history && !!href && !offered && !prog;
  // paid automatically when the job ends — no confirmation wait; a driver of an office is not told about earnings (J4): his office handles the payment
  const officeHint = job.earningHidden && ["completed", "pending_settlement"].includes(job.status); // the hint already says "your office handles the payment"
  const hintKey = officeHint ? "jd.hint_completed_office" : job.status === "completed" ? "fod.hint_completed" : `job.hint_${job.status}`;
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
        <p className="flex items-center gap-2"><Hash className="size-4 shrink-0 text-cyan" aria-hidden />{units}</p>
      </div>
      {manifest && offered && <p className="text-xs text-muted">{t("dstop.share_note")}</p>}
      {manifest && job.allowPartial === false && ["offered", "accepted", "arrived"].includes(job.status) && <p className="flex items-center gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-medium text-gold"><Users className="size-4 shrink-0" aria-hidden />{t("dstop.all_or_nothing")}</p>}
      {job.finalUnits != null && <p className="text-xs text-muted">{t("units.final")}: <span className="ltr-num font-medium text-ink">{fmtNum(job.finalUnits, locale)}</span></p>}
      {job.cancelReason && <p className="text-xs text-muted">{t("job.cancel_reason", { reason: job.cancelReason })}</p>}
      {history && <p className="text-xs text-muted">{t(hintKey)}</p>}
      {job.earningHidden ? !officeHint && <p className="text-xs text-muted">{t("job.paid_by_office")}</p> : job.expectedEarningCents != null && !(history && !["completed", "pending_settlement"].includes(job.status)) && (
        <div className="flex items-center justify-between rounded-xl bg-accent/10 px-3 py-2"><span className="text-xs text-muted">{t("job.expected_earning")}</span><span className="ltr-num font-bold text-accent">{fmtMoney(job.expectedEarningCents, locale)}</span></div>
      )}
      {prog && <div className="space-y-1"><div role="progressbar" aria-label={t("a11y.progress")} aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.done} className="flex h-2 overflow-hidden rounded-full bg-line"><div className="bg-accent" style={{ width: `${(prog.delivered / prog.total) * 100}%` }} /><div className="bg-danger" style={{ width: `${(prog.failed / prog.total) * 100}%` }} /></div><p className="text-xs text-muted">{t("dstop.prog_delivered", { n: fmtNum(prog.delivered, locale) })} · {t("dstop.prog_remaining", { n: fmtNum(prog.remaining, locale) })}</p></div>}
      <JobCounters job={job} />
      {showHint && <p className="rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-medium">{t(hintKey)}</p>}
      {children}
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}
