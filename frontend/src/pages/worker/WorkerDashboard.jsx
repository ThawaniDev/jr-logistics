import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Zap, Briefcase, Wallet, Star, MapPin, Calendar, CheckCircle2, Clock, Banknote, FileCheck, AlertTriangle } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { sar } from "@/lib/constants";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";

export default function WorkerDashboard() {
  const { t } = useI18n();
  const { user, refresh } = useAuth();
  const [data, setData] = useState(null);
  const wp = user?.worker_profile || {};

  const load = () => api.get("/worker/overview").then(({ data }) => setData(data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const toggleAvailability = async (status) => {
    try {
      await api.patch("/worker/availability", { status });
      if (status !== "available") {
        await api.delete("/worker/location").catch(() => {});
        stopLocationWatch();
      } else {
        startLocationWatch();
      }
      toast.success(status === "available" ? t("drvDash.availOnToast") : t("drvDash.availOffToast"));
      refresh();
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const startLocationWatch = () => {
    if (!navigator.geolocation) return;
    const send = (pos) =>
      api.post("/worker/location", { lat: pos.coords.latitude, lng: pos.coords.longitude }).catch(() => {});
    navigator.geolocation.getCurrentPosition(send, () => {});
    const id = setInterval(() => navigator.geolocation.getCurrentPosition(send, () => {}), 60000);
    window.__jrLocWatch = id;
  };
  const stopLocationWatch = () => {
    if (window.__jrLocWatch) { clearInterval(window.__jrLocWatch); window.__jrLocWatch = null; }
  };

  useEffect(() => {
    if (wp.availability === "available") startLocationWatch();
    return stopLocationWatch;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wp.availability]);

  if (!data) return <p className="text-slate-500 text-sm">{t("common.loading")}</p>;
  const available = wp.availability === "available";
  const verified = data.verification_status === "verified";

  return (
    <div className="space-y-6" data-testid="worker-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="heading text-2xl font-extrabold">{t("common.hello")} {user?.name}</h1>
          <p className="text-sm text-slate-400 mt-1">{t("drvDash.sub")}</p>
        </div>
        <button
          data-testid="availability-toggle"
          onClick={() => toggleAvailability(available ? "unavailable" : "available")}
          className={`flex items-center gap-3 rounded-2xl px-5 py-3 border font-bold text-sm transition-all ${
            available
              ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.15)]"
              : "bg-navy-800 border-navy-600 text-slate-400"
          }`}
        >
          <span className={`w-2.5 h-2.5 rounded-full ${available ? "bg-emerald-400 animate-pulse-soft" : "bg-slate-600"}`} />
          {available ? t("drvDash.availOn") : t("drvDash.availOff")}
        </button>
      </div>

      {!verified && (
        <Link to="/app/worker/documents" data-testid="doc-warning-banner"
          className="card-surface border-amber-500/40 bg-amber-500/5 p-4 flex items-center gap-3 hover:bg-amber-500/10 transition-colors">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300 flex-1">{t("drvDash.docWarning")}</p>
          <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5 shrink-0">
            <FileCheck className="w-4 h-4" /> {t("drvDash.docsNow")}
          </span>
        </Link>
      )}
      {verified && data.expiring_docs > 0 && (
        <Link to="/app/worker/documents" data-testid="doc-expiring-banner"
          className="card-surface border-amber-500/40 bg-amber-500/5 p-4 flex items-center gap-3 hover:bg-amber-500/10 transition-colors">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300 flex-1">{t("drvDash.docWarningExp")}</p>
          <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5 shrink-0">
            <FileCheck className="w-4 h-4" /> {t("drvDash.docsNow")}
          </span>
        </Link>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testid="stat-offers" icon={Zap} label={t("drvDash.newOffers")} value={data.new_offers} sub={t("drvDash.waitingYou")} tone="gold" to="/app/worker/opportunities" />
        <StatCard testid="stat-active-jobs" icon={Briefcase} label={t("drvDash.activeJobs")} value={data.active_jobs} tone="cyan" to="/app/worker/jobs" />
        <StatCard testid="stat-pending" icon={Clock} label={t("drvDash.pendingEarnings")} value={sar(data.pending_earnings)} sub={t("drvDash.pendingNote")} tone="gold" to="/app/worker/wallet" />
        <StatCard testid="stat-earnings" icon={Wallet} label={t("drvDash.availableEarnings")} value={sar(data.wallet.available)} sub={t("drvDash.withdrawable")} tone="brand" to="/app/worker/wallet" />
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard testid="stat-paid" icon={Banknote} label={t("drvDash.paidEarnings")} value={sar(data.paid_earnings)} tone="cyan" to="/app/worker/wallet" />
        <StatCard testid="stat-rating" icon={Star} label={t("drvDash.rating")} value={wp.rating ? `${wp.rating} / 5` : "—"} sub={`${data.jobs_completed} ${t("drvDash.completedJobs")}`} tone="blue" to="/app/worker/profile" />
        <StatCard testid="stat-completed-jobs" icon={CheckCircle2} label={t("drvDash.completedJobs")} value={data.jobs_completed} tone="brand" to="/app/worker/jobs" />
      </div>

      {data.new_offers > 0 && (
        <Link to="/app/worker/opportunities" data-testid="new-offers-banner"
          className="card-surface border-brand/40 bg-brand/5 p-4 flex items-center gap-3 hover:bg-brand/10 transition-colors">
          <Zap className="w-5 h-5 text-brand shrink-0" />
          <p className="text-sm">
            <span className="font-bold text-brand num">{data.new_offers}</span> {t("drvDash.offersBanner")}
          </p>
        </Link>
      )}

      {data.jobs.length === 0 ? (
        <EmptyState icon={Briefcase} title={t("drvDash.noJobs")} desc={t("drvDash.noJobsDesc")} testid="jobs-empty">
          <Link to="/app/worker/opportunities" data-testid="empty-browse-btn"
            className="mt-2 bg-brand text-navy-900 font-bold rounded-xl px-5 py-2.5 text-sm hover:bg-brand-hover">
            {t("drvDash.browse")}
          </Link>
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {[
            { title: t("drvDash.activeNow"), key: "active", items: data.jobs.filter((o) => ["attendance_confirmed", "attended"].includes(o.status)) },
            { title: t("drvDash.upcoming"), key: "upcoming", items: data.jobs.filter((o) => ["accepted", "confirmed"].includes(o.status)) },
          ].map((group) => (
            <div key={group.key} data-testid={`jobs-group-${group.key}`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="heading text-lg font-bold">{group.title}</h2>
                <Link to="/app/worker/jobs" className="text-xs text-brand hover:underline" data-testid={`view-all-jobs-${group.key}`}>{t("common.viewAll")}</Link>
              </div>
              {group.items.length === 0 ? (
                <div className="card-surface p-6 text-center text-sm text-slate-500" data-testid={`jobs-empty-${group.key}`}>{t("drvDash.noneHere")}</div>
              ) : (
                <div className="space-y-3">
                  {group.items.map((o) => (
                    <div key={o._id} className="card-surface card-surface-hover p-4 flex items-center gap-4 flex-wrap" data-testid={`dashboard-job-${o._id}`}>
                      <div className="flex-1 min-w-[220px]">
                        <p className="font-semibold text-sm">{o.request?.title}</p>
                        <p className="text-xs text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {o.request?.city}</span>
                          <span className="flex items-center gap-1 num"><Calendar className="w-3 h-3" /> {o.request?.start_date} · {o.request?.start_time}</span>
                          <span>{o.business?.business_profile?.company_name || o.business?.name}</span>
                        </p>
                      </div>
                      <StatusBadge kind="offer" status={o.status} />
                      {o.status === "confirmed" && (
                        <button
                          data-testid={`checkin-btn-${o._id}`}
                          onClick={async () => {
                            try {
                              await api.post(`/worker/offers/${o._id}/checkin`);
                              toast.success(t("jobs.checkinDone"));
                              load();
                            } catch (e) { toast.error(errMsg(e)); }
                          }}
                          className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-4 py-2 text-xs hover:bg-brand-hover transition-colors"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> {t("jobs.checkin")}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
