import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Building2, Users, Banknote, LifeBuoy, RefreshCcw, Wallet, ClipboardList, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { SERVICE_MAP, sar } from "@/lib/constants";

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [broadcast, setBroadcast] = useState({ title: "", body: "", target: "all" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/admin/stats").then(({ data }) => setData(data)).catch(() => {});
  }, []);

  const sendBroadcast = async (e) => {
    e.preventDefault();
    if (!broadcast.title.trim() || !broadcast.body.trim()) return toast.error("أكمل عنوان ونص التنبيه");
    setBusy(true);
    try {
      const { data } = await api.post("/admin/broadcast", broadcast);
      toast.success(`تم إرسال التنبيه إلى ${data.sent} مستخدم`);
      setBroadcast({ title: "", body: "", target: "all" });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="text-slate-500 text-sm">جاري التحميل…</p>;
  const s = data.requests_by_status;

  return (
    <div className="space-y-6" data-testid="admin-dashboard">
      <div>
        <h1 className="heading text-2xl font-extrabold">لوحة تحكم المنصة</h1>
        <p className="text-sm text-slate-400 mt-1">مؤشرات السوق والعمليات لحظياً</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testid="stat-gmv" icon={Wallet} label="إجمالي قيمة الطلبات المكتملة" value={sar(data.gmv)} tone="brand" />
        <StatCard testid="stat-commission" icon={Banknote} label="عمولات المنصة" value={sar(data.commission)} tone="gold" />
        <StatCard testid="stat-businesses" icon={Building2} label="المنشآت" value={data.businesses} tone="cyan" />
        <StatCard testid="stat-workers" icon={Users} label="السائقون والمندوبون" value={data.workers} tone="blue" />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link to="/app/admin/requests" data-testid="admin-active-requests"
          className="card-surface card-surface-hover p-5 block">
          <p className="text-xs text-slate-400">طلبات نشطة</p>
          <p className="heading text-3xl font-black text-brand num mt-1">{s.published + s.filling + s.confirmed + s.in_progress}</p>
          <p className="text-[11px] text-slate-500 mt-1">منشور {s.published} · قيد التعبئة {s.filling} · مؤكد {s.confirmed} · جارٍ {s.in_progress}</p>
        </Link>
        <Link to="/app/admin/withdrawals" data-testid="admin-pending-withdrawals"
          className="card-surface card-surface-hover p-5 block">
          <p className="text-xs text-slate-400">سحوبات معلقة</p>
          <p className="heading text-3xl font-black text-amber-400 num mt-1">{data.pending_withdrawals}</p>
          <p className="text-[11px] text-slate-500 mt-1">تحتاج مراجعة وموافقة</p>
        </Link>
        <Link to="/app/admin/support" data-testid="admin-open-tickets"
          className="card-surface card-surface-hover p-5 block">
          <p className="text-xs text-slate-400">تذاكر مفتوحة</p>
          <p className="heading text-3xl font-black text-blue-400 num mt-1">{data.open_tickets}</p>
          <p className="text-[11px] text-slate-500 mt-1">دعم وشكاوى</p>
        </Link>
        <Link to="/app/admin/requests" data-testid="admin-noshows"
          className="card-surface card-surface-hover p-5 block">
          <p className="text-xs text-slate-400">حالات تغيّب</p>
          <p className="heading text-3xl font-black text-rose-400 num mt-1">{data.no_shows}</p>
          <p className="text-[11px] text-slate-500 mt-1">تتطلب بدائل</p>
        </Link>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <h2 className="heading text-lg font-bold mb-4">أحدث الطلبات</h2>
          <div className="space-y-3">
            {data.recent_requests.map((r) => (
              <Link key={r._id} to="/app/admin/requests" data-testid={`admin-recent-${r._id}`}
                className="card-surface card-surface-hover p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{r.title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{SERVICE_MAP[r.service_type]?.short} · {r.city} · <span className="num">{r.start_date}</span></p>
                </div>
                <p className="font-heading font-bold text-brand num text-sm">{sar(r.estimated_total)}</p>
                <StatusBadge kind="request" status={r.status} />
              </Link>
            ))}
          </div>
        </div>

        <div>
          <h2 className="heading text-lg font-bold mb-4 flex items-center gap-2">
            <Send className="w-4 h-4 text-brand" /> تنبيه جماعي
          </h2>
          <form onSubmit={sendBroadcast} className="card-surface p-5 space-y-3" data-testid="broadcast-form">
            <Input data-testid="broadcast-title" placeholder="عنوان التنبيه" value={broadcast.title}
              onChange={(e) => setBroadcast({ ...broadcast, title: e.target.value })} className="bg-navy-800 border-navy-600 h-11" />
            <textarea data-testid="broadcast-body" placeholder="نص التنبيه…" value={broadcast.body}
              onChange={(e) => setBroadcast({ ...broadcast, body: e.target.value })}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 py-2.5 text-sm min-h-[80px] focus:outline-none focus:ring-1 focus:ring-brand" />
            <div className="flex gap-3">
              <select data-testid="broadcast-target" value={broadcast.target}
                onChange={(e) => setBroadcast({ ...broadcast, target: e.target.value })}
                className="flex-1 bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
                <option value="all">جميع المستخدمين</option>
                <option value="business">المنشآت فقط</option>
                <option value="worker">المندوبون فقط</option>
              </select>
              <button data-testid="broadcast-send-btn" disabled={busy}
                className="bg-brand text-navy-900 font-bold rounded-xl px-6 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
                {busy ? "جاري الإرسال…" : "إرسال"}
              </button>
            </div>
          </form>
          <div className="card-surface p-5 mt-4 flex items-center gap-3">
            <RefreshCcw className="w-5 h-5 text-rose-400 shrink-0" />
            <p className="text-xs text-slate-400 leading-relaxed">
              عند تغيّب عامل تُرسل عروض بديلة تلقائياً للمطابقين المتاحين، ويمكنك التدخل اليدوي من صفحة
              <Link to="/app/admin/requests" className="text-brand hover:underline mx-1">الطلبات والمطابقة</Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
