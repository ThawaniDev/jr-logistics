import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, Briefcase, Landmark, CircleCheck, Clock3, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { OnboardingBanner } from "@/components/OnboardingBanner";
import { sar } from "@/lib/constants";
import { useI18n } from "@/i18n";

export default function OfficeDashboard() {
  const { t } = useI18n();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/office/dashboard").then(({ data }) => setData(data)).catch(() => {});
  }, []);

  const s = data?.summary;
  return (
    <div className="space-y-6" data-testid="office-dashboard">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("office.dashboard")}</h1>
      </div>

      <OnboardingBanner profilePath="/app/office/agreement" />

      {s && !["verified", "active"].includes(s.verification_status || "") && (
        <div className="card-surface p-4 border-amber-500/30 bg-amber-500/5 text-sm text-amber-300" data-testid="office-pending-note">
          {t("office.verifyPending")}
        </div>
      )}

      {s && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="office-driver-stats">
            <StatCard title={t("office.totalDrivers")} value={s.drivers_total} icon={Users} tone="brand" />
            <StatCard title={t("office.activeDrivers")} value={s.drivers_available} icon={CircleCheck} tone="green" />
            <StatCard title={t("office.busyDrivers")} value={s.drivers_busy} icon={Clock3} tone="blue" />
            <StatCard title={t("office.unavailDrivers")} value={s.drivers_unavailable} icon={AlertTriangle} tone="amber" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="office-job-stats">
            <StatCard title={t("office.activeJobs")} value={s.active_jobs} icon={Briefcase} tone="blue" />
            <StatCard title={t("office.completedJobs")} value={s.completed_jobs} icon={CircleCheck} tone="green" />
            <StatCard title={t("office.pendingSettle")} value={sar(s.settlements_pending)} icon={Landmark} tone="amber" />
            <StatCard title={t("office.totalRecv")} value={sar(s.total_receivables)} icon={Landmark} tone="brand" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Link to="/app/office/settlements" className="card-surface p-5 hover:border-brand/40 transition-colors" data-testid="office-go-settlements">
              <p className="text-xs text-slate-500">{t("office.paidSettle")}</p>
              <p className="heading text-2xl font-black num text-emerald-400 mt-1">{sar(s.settlements_paid)}</p>
            </Link>
            <Link to="/app/office/settlements" className="card-surface p-5 hover:border-brand/40 transition-colors" data-testid="office-go-approved">
              <p className="text-xs text-slate-500">{t("office.approvedSettle")}</p>
              <p className="heading text-2xl font-black num text-amber-400 mt-1">{sar(s.settlements_approved)}</p>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
