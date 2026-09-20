import { useEffect, useState } from "react";
import { BarChart3, Users, Briefcase, Landmark, FileCheck, ScrollText, LifeBuoy, CircleCheck, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { sar, fmtDate } from "@/lib/constants";
import { useI18n } from "@/i18n";

export default function OfficeReports() {
  const { t } = useI18n();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/office/reports").then(({ data }) => setData(data)).catch(() => {});
  }, []);

  const s = data?.summary;
  return (
    <div className="space-y-6" data-testid="office-reports-page">
      <div>
        <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-brand" /> {t("office.reports")}
        </h1>
        <p className="text-sm text-slate-400 mt-1">{t("office.reportsSub")}</p>
      </div>
      {!s ? <p className="text-slate-500 text-sm">{t("common.loading")}</p> : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="office-report-cards">
            <StatCard testid="rep-drivers" icon={Users} label={t("office.totalDrivers")} value={s.drivers} tone="brand" />
            <StatCard testid="rep-active" icon={Briefcase} label={t("office.activeJobs")} value={s.active_jobs} tone="blue" />
            <StatCard testid="rep-completed" icon={Briefcase} label={t("office.completedJobs")} value={s.completed_jobs} tone="brand" />
            <StatCard testid="rep-shipments" icon={Briefcase} label={t("office.shipments")} value={s.shipments} tone="cyan" />
            <StatCard testid="rep-pending" icon={Landmark} label={t("office.pendingSettle")} value={sar(s.pending_amount)} tone="gold" />
            <StatCard testid="rep-approved" icon={Landmark} label={t("office.approvedSettle")} value={sar(s.approved_amount)} tone="blue" />
            <StatCard testid="rep-paid" icon={Landmark} label={t("office.paidSettle")} value={sar(s.paid_amount)} tone="brand" />
            <StatCard testid="rep-docs" icon={FileCheck} label={t("office.documents")} value={s.documents} tone="cyan" />
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <StatCard testid="rep-agreements" icon={ScrollText} label={t("office.agreements")} value={s.agreements} tone="blue" />
            <StatCard testid="rep-tickets" icon={LifeBuoy} label={t("office.tickets")} value={s.tickets} tone="gold" />
            <StatCard testid="rep-payments" icon={Landmark} label={t("office.payments")} value={s.payments_count} tone="brand" />
          </div>
          <div className="grid sm:grid-cols-2 gap-4" data-testid="office-sla-cards">
            <StatCard testid="rep-sla-on" icon={CircleCheck} label={t("slax.onTime")} value={s.sla_on_time} tone="green" />
            <StatCard testid="rep-sla-late" icon={AlertTriangle} label={t("slax.lateCount")} value={s.sla_late} tone="amber" />
          </div>
          <div className="card-surface p-5" data-testid="office-recent-activity">
            <h2 className="heading text-lg font-bold mb-4">{t("office.recentActivity")}</h2>
            {data.recent_activity.length === 0 ? <p className="text-sm text-slate-500">{t("timeline.empty")}</p> : (
              <div className="space-y-2">
                {data.recent_activity.map((a) => (
                  <div key={a._id} className="flex items-center justify-between gap-3 text-xs border-b border-navy-600/30 pb-2">
                    <span>{a.action}</span>
                    <span className="num text-slate-500">{fmtDate(a.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
