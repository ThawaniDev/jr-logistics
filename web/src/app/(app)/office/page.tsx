"use client";
import Link from "next/link";
import { Briefcase, Coins, Truck, Users } from "lucide-react";
import { Button, ErrorState, Notice, PageHeader, PageLoading, Stat } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";

export default function OfficeDashboard() {
  const { t, locale } = useI18n(); const me = useUser();
  const { data, error, mutate } = useApi("/office/dashboard");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const r = data.readiness;
  return (
    <>
      <PageHeader title={t("biz.welcome", { name: me.name })} subtitle={t("office.sub")} actions={<Link href="/office/drivers"><Button variant="secondary"><Users className="size-4" />{t("office.invite_driver")}</Button></Link>} />
      {!r.ready && <div className="mb-5"><Notice tone="warn" title={t("office.not_ready")}>{r.verification !== "verified" ? t("office.need_verification") : t("office.need_agreement")} <Link href={r.verification !== "verified" ? "/office/documents" : "/office/agreement"} className="font-semibold text-cyan underline">{t("office.fix_now")}</Link></Notice></div>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("office.drivers_total")} value={data.drivers.total} icon={<Users className="size-5" />} />
        <Stat label={t("office.drivers_free")} value={data.drivers.available} tone="cyan" icon={<Truck className="size-5" />} />
        <Stat label={t("office.active_jobs")} value={data.activeJobs} icon={<Briefcase className="size-5" />} />
        <Stat label={t("office.pending_settle")} value={<span className="ltr-num">{fmtMoney(data.pendingSettlementCents, locale)}</span>} tone="gold" icon={<Coins className="size-5" />} />
      </div>
    </>
  );
}
