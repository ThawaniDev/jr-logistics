import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Wallet, Lock, ClipboardList, PlusCircle, UserCheck, ChevronLeft, AlertTriangle, Banknote, Percent, CheckCircle2, XCircle } from "lucide-react";
import api from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { sar } from "@/lib/constants";
import { OnboardingBanner } from "@/components/OnboardingBanner";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";

export default function BusinessDashboard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/business/overview").then(({ data }) => setData(data)).catch(() => {});
  }, []);

  if (!data) return <p className="text-slate-500 text-sm">{t("common.loading")}</p>;
  const { wallet, counts, pending_attendance, recent } = data;
  const active = counts.published + counts.filling + counts.confirmed + counts.in_progress;

  return (
    <div className="space-y-6" data-testid="business-dashboard">
      <OnboardingBanner profilePath="/app/business/profile" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="heading text-2xl font-extrabold">
            {t("common.hello")} {user?.business_profile?.company_name || user?.name}
          </h1>
          <p className="text-sm text-slate-400 mt-1">{t("bizDash.sub")}</p>
        </div>
        <Link to="/app/business/requests/new" data-testid="dashboard-new-request-btn"
          className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-5 py-3 text-sm hover:bg-brand-hover transition-colors shadow-[0_0_25px_rgba(0,229,163,0.25)]">
          <PlusCircle className="w-4 h-4" /> {t("bizDash.newRequest")}
        </Link>
      </div>

      {pending_attendance > 0 && (
        <Link to="/app/business/requests" className="card-surface border-amber-500/40 bg-amber-500/5 p-4 flex items-center gap-3 hover:bg-amber-500/10 transition-colors" data-testid="attendance-alert">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300">
            <span className="font-bold num">{pending_attendance}</span> — {t("bizDash.attendanceAlert")}
          </p>
        </Link>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testid="stat-available" icon={Wallet} label={t("bizDash.available")} value={sar(wallet.available)} sub={t("bizDash.availableNote")} tone="brand" to="/app/business/wallet" />
        <StatCard testid="stat-reserved" icon={Lock} label={t("bizDash.reserved")} value={sar(wallet.reserved)} sub={t("bizDash.reservedNote")} tone="gold" to="/app/business/wallet" />
        <StatCard testid="stat-spent" icon={Banknote} label={t("bizDash.spent")} value={sar(data.total_spent)} sub={t("bizDash.spentNote")} tone="cyan" to="/app/business/requests" />
        <StatCard testid="stat-fees" icon={Percent} label={t("bizDash.fees")} value={sar(data.platform_fees)} sub={t("bizDash.feesNote")} tone="blue" to="/app/business/requests" />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testid="stat-active" icon={ClipboardList} label={t("bizDash.active")} value={active} sub={`${counts.draft || 0} ${t("bizDash.drafts")}`} tone="brand" to="/app/business/requests" />
        <StatCard testid="stat-attendance" icon={UserCheck} label={t("bizDash.attendancePending")} value={pending_attendance} tone="gold" to="/app/business/requests" />
        <StatCard testid="stat-completed" icon={CheckCircle2} label={t("bizDash.completed")} value={counts.completed} tone="cyan" to="/app/business/requests" />
        <StatCard testid="stat-cancelled" icon={XCircle} label={t("bizDash.cancelled")} value={counts.cancelled} tone="blue" to="/app/business/requests" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="heading text-lg font-bold">{t("bizDash.recent")}</h2>
          <Link to="/app/business/requests" className="text-xs text-brand hover:underline flex items-center gap-1" data-testid="view-all-requests">
            {t("common.viewAll")} <ChevronLeft className="w-3 h-3 rtl:rotate-0 ltr:rotate-180" />
          </Link>
        </div>
        {recent.length === 0 ? (
          <EmptyState icon={ClipboardList} title={t("bizDash.noRequests")} desc={t("bizDash.noRequestsDesc")} testid="dashboard-empty">
            <Link to="/app/business/requests/new" data-testid="empty-new-request-btn"
              className="mt-2 bg-brand text-navy-900 font-bold rounded-xl px-5 py-2.5 text-sm hover:bg-brand-hover">
              {t("bizDash.createRequest")}
            </Link>
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {recent.map((r) => (
              <Link key={r._id} to={`/app/business/requests/${r._id}`} data-testid={`dashboard-request-${r._id}`}
                className="card-surface card-surface-hover p-4 flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <p className="font-semibold text-sm">{r.title}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {r.city} · <span className="num">{r.start_date}</span> · {t("bizDash.required")}: <span className="num">{r.required_count}</span>
                  </p>
                </div>
                <div className="text-end">
                  <p className="font-heading font-bold text-brand num">{sar(r.estimated_total)}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{t("bizDash.estCost")}</p>
                </div>
                <StatusBadge kind="request" status={r.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
