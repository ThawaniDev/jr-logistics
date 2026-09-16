import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PlusCircle, ClipboardList } from "lucide-react";
import api from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { SERVICE_MAP, REQUEST_STATUS, sar } from "@/lib/constants";

export default function BusinessRequests() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    api.get("/business/requests").then(({ data }) => setData(data.requests)).catch(() => {});
  }, []);

  const list = (data || []).filter((r) => filter === "all" || r.status === filter);

  return (
    <div className="space-y-6" data-testid="business-requests-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="heading text-2xl font-extrabold">طلباتي</h1>
          <p className="text-sm text-slate-400 mt-1">إدارة طلبات الموارد ومتابعة حالتها</p>
        </div>
        <Link to="/app/business/requests/new" data-testid="requests-new-btn"
          className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-5 py-3 text-sm hover:bg-brand-hover transition-colors">
          <PlusCircle className="w-4 h-4" /> طلب جديد
        </Link>
      </div>

      <div className="flex gap-2 flex-wrap" data-testid="requests-filters">
        <button onClick={() => setFilter("all")} data-testid="filter-all"
          className={`chip ${filter === "all" ? "bg-brand/15 text-brand border-brand/40" : "bg-navy-800 text-slate-400 border-navy-600"}`}>
          الكل
        </button>
        {Object.entries(REQUEST_STATUS).map(([k, v]) => (
          <button key={k} onClick={() => setFilter(k)} data-testid={`filter-${k}`}
            className={`chip ${filter === k ? v.cls : "bg-navy-800 text-slate-400 border-navy-600"}`}>
            {v.label}
          </button>
        ))}
      </div>

      {!data ? (
        <p className="text-slate-500 text-sm">جاري التحميل…</p>
      ) : list.length === 0 ? (
        <EmptyState icon={ClipboardList} title="لا توجد طلبات" desc="أنشئ طلب خدمة جديد ليظهر هنا" testid="requests-empty">
          <Link to="/app/business/requests/new" className="mt-2 bg-brand text-navy-900 font-bold rounded-xl px-5 py-2.5 text-sm hover:bg-brand-hover">
            إنشاء طلب
          </Link>
        </EmptyState>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-600/50 text-slate-400 text-xs">
                  <th className="text-right p-4 font-semibold">الطلب</th>
                  <th className="text-right p-4 font-semibold">الخدمة</th>
                  <th className="text-right p-4 font-semibold">التاريخ</th>
                  <th className="text-right p-4 font-semibold">العدد</th>
                  <th className="text-right p-4 font-semibold">المقبولون</th>
                  <th className="text-right p-4 font-semibold">التكلفة</th>
                  <th className="text-right p-4 font-semibold">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r._id} className="border-b border-navy-600/30 hover:bg-navy-700/20 transition-colors" data-testid={`request-row-${r._id}`}>
                    <td className="p-4">
                      <Link to={`/app/business/requests/${r._id}`} className="font-semibold hover:text-brand transition-colors">
                        {r.title}
                      </Link>
                      <p className="text-[11px] text-slate-500 mt-0.5">{r.city}</p>
                    </td>
                    <td className="p-4 text-slate-300">{SERVICE_MAP[r.service_type]?.short}</td>
                    <td className="p-4 num text-slate-300">{r.start_date}</td>
                    <td className="p-4 num">{r.required_count}</td>
                    <td className="p-4">
                      <span className={`num font-semibold ${r.counts.accepted > 0 ? "text-blue-400" : "text-slate-500"}`}>
                        {r.counts.accepted + r.counts.confirmed + r.counts.attended + r.counts.paid + r.counts.attendance_confirmed}
                      </span>
                      <span className="text-slate-600 num"> / {r.required_count}</span>
                    </td>
                    <td className="p-4 font-semibold text-brand num">{sar(r.estimated_total)}</td>
                    <td className="p-4"><StatusBadge kind="request" status={r.status} pulse={r.replacement_requested} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
