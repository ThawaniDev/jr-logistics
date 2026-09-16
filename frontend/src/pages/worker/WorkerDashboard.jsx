import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Zap, Briefcase, Wallet, Star, MapPin, Calendar, CheckCircle2 } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { SERVICE_MAP, sar } from "@/lib/constants";
import { useAuth } from "@/context/AuthContext";

export default function WorkerDashboard() {
  const { user, refresh } = useAuth();
  const [data, setData] = useState(null);
  const wp = user?.worker_profile || {};

  const load = () => api.get("/worker/overview").then(({ data }) => setData(data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const toggleAvailability = async (status) => {
    try {
      await api.patch("/worker/availability", { status });
      toast.success(status === "available" ? "أنت متاح الآن — ستصلك الفرص الجديدة" : "تم إيقاف استقبال الفرص");
      refresh();
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (!data) return <p className="text-slate-500 text-sm">جاري التحميل…</p>;
  const available = wp.availability === "available";

  return (
    <div className="space-y-6" data-testid="worker-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="heading text-2xl font-extrabold">أهلاً، {user?.name}</h1>
          <p className="text-sm text-slate-400 mt-1">مهامك وفرصك الجديدة في مكان واحد</p>
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
          {available ? "متاح للعمل الآن" : "غير متاح — فعّل توفرك"}
        </button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testid="stat-offers" icon={Zap} label="عروض جديدة" value={data.new_offers} sub="بانتظار ردك" tone="gold" />
        <StatCard testid="stat-active-jobs" icon={Briefcase} label="مهام نشطة" value={data.active_jobs} tone="cyan" />
        <StatCard testid="stat-earnings" icon={Wallet} label="الأرباح المتاحة" value={sar(data.wallet.available)} sub="قابلة للسحب" tone="brand" />
        <StatCard testid="stat-rating" icon={Star} label="تقييمك" value={wp.rating ? `${wp.rating} / 5` : "—"} sub={`${data.jobs_completed} مهمة مكتملة`} tone="blue" />
      </div>

      {data.new_offers > 0 && (
        <Link to="/app/worker/opportunities" data-testid="new-offers-banner"
          className="card-surface border-brand/40 bg-brand/5 p-4 flex items-center gap-3 hover:bg-brand/10 transition-colors">
          <Zap className="w-5 h-5 text-brand shrink-0" />
          <p className="text-sm">
            لديك <span className="font-bold text-brand num">{data.new_offers}</span> عرض جديد بانتظارك — راجع التفاصيل قبل انتهاء الفرصة
          </p>
        </Link>
      )}

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="heading text-lg font-bold">مهامي القادمة والجارية</h2>
          <Link to="/app/worker/jobs" className="text-xs text-brand hover:underline" data-testid="view-all-jobs">عرض الكل</Link>
        </div>
        {data.jobs.length === 0 ? (
          <EmptyState icon={Briefcase} title="لا توجد مهام مؤكدة" desc="اقبل العروض من صفحة الفرص المتاحة لتظهر مهامك هنا" testid="jobs-empty">
            <Link to="/app/worker/opportunities" data-testid="empty-browse-btn"
              className="mt-2 bg-brand text-navy-900 font-bold rounded-xl px-5 py-2.5 text-sm hover:bg-brand-hover">
              تصفح الفرص
            </Link>
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {data.jobs.map((o) => (
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
                        toast.success("تم تسجيل حضورك — بانتظار تأكيد المنشأة");
                        load();
                      } catch (e) { toast.error(errMsg(e)); }
                    }}
                    className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-4 py-2 text-xs hover:bg-brand-hover transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> تسجيل الحضور
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
