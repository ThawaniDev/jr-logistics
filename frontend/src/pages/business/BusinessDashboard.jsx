import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Wallet, Lock, ClipboardList, PlusCircle, UserCheck, ChevronLeft, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { SERVICE_MAP, sar } from "@/lib/constants";
import { useAuth } from "@/context/AuthContext";

export default function BusinessDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/business/overview").then(({ data }) => setData(data)).catch(() => {});
  }, []);

  if (!data) return <p className="text-slate-500 text-sm">جاري التحميل…</p>;
  const { wallet, counts, pending_attendance, recent } = data;
  const active = counts.published + counts.filling + counts.confirmed + counts.in_progress;

  return (
    <div className="space-y-6" data-testid="business-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="heading text-2xl font-extrabold">
            أهلاً، {user?.business_profile?.company_name || user?.name}
          </h1>
          <p className="text-sm text-slate-400 mt-1">نظرة عامة على عملياتك التشغيلية</p>
        </div>
        <Link to="/app/business/requests/new" data-testid="dashboard-new-request-btn"
          className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-5 py-3 text-sm hover:bg-brand-hover transition-colors shadow-[0_0_25px_rgba(0,229,163,0.25)]">
          <PlusCircle className="w-4 h-4" /> طلب خدمة جديد
        </Link>
      </div>

      {pending_attendance > 0 && (
        <div className="card-surface border-amber-500/40 bg-amber-500/5 p-4 flex items-center gap-3" data-testid="attendance-alert">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300">
            لديك <span className="font-bold num">{pending_attendance}</span> تأكيد حضور بانتظار المراجعة — افتح الطلب وأكّد الحضور
          </p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testid="stat-available" icon={Wallet} label="الرصيد المتاح" value={sar(wallet.available)} sub="أموال تجريبية" tone="brand" />
        <StatCard testid="stat-reserved" icon={Lock} label="مبالغ محجوزة (ضمان)" value={sar(wallet.reserved)} sub="تُحرر عند إتمام الطلبات" tone="gold" />
        <StatCard testid="stat-active" icon={ClipboardList} label="طلبات نشطة" value={active} sub={`${counts.completed} طلب مكتمل`} tone="cyan" />
        <StatCard testid="stat-attendance" icon={UserCheck} label="حضور بانتظار التأكيد" value={pending_attendance} tone="blue" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="heading text-lg font-bold">أحدث الطلبات</h2>
          <Link to="/app/business/requests" className="text-xs text-brand hover:underline flex items-center gap-1" data-testid="view-all-requests">
            عرض الكل <ChevronLeft className="w-3 h-3" />
          </Link>
        </div>
        {recent.length === 0 ? (
          <EmptyState icon={ClipboardList} title="لا توجد طلبات بعد" desc="أنشئ أول طلب خدمة وابدأ باستقبال العمال المتاحين" testid="dashboard-empty">
            <Link to="/app/business/requests/new" data-testid="empty-new-request-btn"
              className="mt-2 bg-brand text-navy-900 font-bold rounded-xl px-5 py-2.5 text-sm hover:bg-brand-hover">
              إنشاء طلب
            </Link>
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {recent.map((r) => (
              <Link key={r._id} to={`/app/business/requests/${r._id}`} data-testid={`dashboard-request-${r._id}`}
                className="card-surface card-surface-hover p-4 flex items-center gap-4 flex-wrap">
                <div className="w-11 h-11 rounded-xl bg-navy-700/80 border border-navy-600/60 flex items-center justify-center shrink-0">
                  {SERVICE_MAP[r.service_type] && (() => { const I = SERVICE_MAP[r.service_type].icon; return <I className="w-5 h-5 text-brand" />; })()}
                </div>
                <div className="flex-1 min-w-[200px]">
                  <p className="font-semibold text-sm">{r.title}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {r.city} · <span className="num">{r.start_date}</span> · العدد المطلوب: <span className="num">{r.required_count}</span>
                  </p>
                </div>
                <div className="text-left">
                  <p className="font-heading font-bold text-brand num">{sar(r.estimated_total)}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">تكلفة تقديرية</p>
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
