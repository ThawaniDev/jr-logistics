"use client";
import Link from "next/link";
import { ArrowRight, Truck } from "lucide-react";
import { Badge, Card, Notice } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import type { ActiveJobRef } from "./driver-fieldops-utils";

/** E11 — a driver with an active job sees no other offers: say why, and take him back to the job. */
export function OffersHiddenBanner({ activeJob }: { activeJob: ActiveJobRef | null }) {
  const { t } = useI18n();
  return (
    <div data-testid="offers-hidden">
      <Notice tone="info" title={t("fod.offers_hidden_title")}>
        <p>{t("fod.offers_hidden_body")}</p>
        {activeJob && <Link href={`/driver/jobs/${activeJob.offerId}`} data-testid="offers-hidden-link" className="mt-2 inline-flex min-h-11 items-center gap-1.5 font-semibold text-cyan underline">{t("fod.offers_hidden_link", { ref: activeJob.ref })}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></Link>}
      </Notice>
    </div>
  );
}

/** Dashboard shortcut to the job in progress (`overview.activeJob`). */
export function ActiveJobShortcut({ job }: { job: ActiveJobRef }) {
  const { t } = useI18n();
  return (
    <Link href={`/driver/jobs/${job.offerId}`} data-testid="active-job-card" data-offer={job.offerId} className="mb-6 block">
      <Card className="flex flex-wrap items-center justify-between gap-3 border-2 border-accent/60 bg-accent/5 p-4 transition hover:border-accent">
        <div className="flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-xl bg-accent/15 text-accent"><Truck className="size-6" aria-hidden /></span>
          <div><p className="text-xs font-semibold uppercase tracking-wider text-accent">{t("fod.active_job")}</p><p className="text-lg font-bold"><span className="ltr-num">{job.ref}</span></p></div></div>
        <div className="flex items-center gap-3"><Badge tone="warn">{t(`jobstatus.${job.status}`)}</Badge><span className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-accent">{t("fod.active_job_open")}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></span></div>
      </Card>
    </Link>
  );
}
