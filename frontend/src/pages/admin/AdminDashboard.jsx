import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Building2, Users, Banknote, LifeBuoy, RefreshCcw, Wallet, ClipboardList, Send, Settings, ChevronLeft, FileCheck, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { sar } from "@/lib/constants";
import { useI18n } from "@/i18n";

export default function AdminDashboard() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [broadcast, setBroadcast] = useState({ title: "", body: "", target: "all" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/admin/stats").then(({ data }) => setData(data)).catch(() => {});
  }, []);

  const sendBroadcast = async (e) => {
    e.preventDefault();
    if (!broadcast.title.trim() || !broadcast.body.trim()) return toast.error(t("admin.bcTitle"));
    setBusy(true);
    try {
      const { data } = await api.post("/admin/broadcast", broadcast);
      toast.success(`${t("admin.broadcast")} — ${data.sent}`);
      setBroadcast({ title: "", body: "", target: "all" });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="text-slate-500 text-sm">{t("common.loading")}</p>;
  const s = data.requests_by_status;

  return (
    <div className="space-y-6" data-testid="admin-dashboard">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("admin.dashTitle")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("admin.dashSub")}</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testid="stat-gmv" icon={Wallet} label={t("admin.gmv")} value={sar(data.gmv)} tone="brand" />
        <StatCard testid="stat-commission" icon={Banknote} label={t("admin.commission")} value={sar(data.commission)} tone="gold" />
        <StatCard testid="stat-businesses" icon={Building2} label={t("admin.businesses")} value={data.businesses} tone="cyan" to="/app/admin/users" />
        <StatCard testid="stat-workers" icon={Users} label={t("admin.drivers")} value={data.workers} tone="blue" to="/app/admin/users" />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link to="/app/admin/requests" data-testid="stat-active-requests"
          className="card-surface card-surface-hover p-5 block">
          <p className="text-xs text-slate-400">{t("admin.activeReqs")}</p>
          <p className="heading text-3xl font-black text-brand num mt-1">{s.published + s.filling + s.confirmed + s.in_progress}</p>
          <p className="text-[11px] text-slate-500 mt-1">{t("admin.published")} {s.published} · {t("admin.filling")} {s.filling} · {t("admin.confirmed")} {s.confirmed} · {t("admin.inProgress")} {s.in_progress}</p>
        </Link>
        <Link to="/app/admin/withdrawals" data-testid="stat-pending-withdrawals"
          className="card-surface card-surface-hover p-5 block">
          <p className="text-xs text-slate-400">{t("admin.pendingWd")}</p>
          <p className="heading text-3xl font-black text-amber-400 num mt-1">{data.pending_withdrawals}</p>
          <p className="text-[11px] text-slate-500 mt-1">{t("admin.pendingWdNote")}</p>
        </Link>
        <Link to="/app/admin/support" data-testid="stat-open-tickets"
          className="card-surface card-surface-hover p-5 block">
          <p className="text-xs text-slate-400">{t("admin.openTickets")}</p>
          <p className="heading text-3xl font-black text-blue-400 num mt-1">{data.open_tickets}</p>
          <p className="text-[11px] text-slate-500 mt-1">{t("admin.openTicketsNote")}</p>
        </Link>
        <Link to="/app/admin/requests" data-testid="stat-noshows"
          className="card-surface card-surface-hover p-5 block">
          <p className="text-xs text-slate-400">{t("admin.noShows")}</p>
          <p className="heading text-3xl font-black text-rose-400 num mt-1">{data.no_shows}</p>
          <p className="text-[11px] text-slate-500 mt-1">{t("admin.noShowsNote")}</p>
        </Link>
        <Link to="/app/admin/cases" data-testid="stat-open-cases"
          className="card-surface card-surface-hover p-5 block">
          <p className="text-xs text-slate-400">{t("admin.openCases")}</p>
          <p className="heading text-3xl font-black text-rose-400 num mt-1">{data.open_cases}</p>
          <p className="text-[11px] text-slate-500 mt-1">{t("support.cat_not_put_to_work")}</p>
        </Link>
        <Link to="/app/admin/documents" data-testid="stat-pending-docs"
          className="card-surface card-surface-hover p-5 block">
          <p className="text-xs text-slate-400">{t("admin.pendingDocs")}</p>
          <p className="heading text-3xl font-black text-cyan-400 num mt-1">{data.pending_documents}</p>
          <p className="text-[11px] text-slate-500 mt-1">{t("admin.docsSub")}</p>
        </Link>
      </div>

      <Link to="/app/admin/settings" data-testid="admin-pricing-link"
        className="card-surface card-surface-hover p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/25 flex items-center justify-center shrink-0">
          <Settings className="w-5 h-5 text-brand" />
        </div>
        <div className="flex-1">
          <p className="font-heading font-bold text-sm">{t("admin.pricingLink")}</p>
          <p className="text-[11px] text-slate-500">{t("admin.pricingLinkSub")}</p>
        </div>
        <ChevronLeft className="w-4 h-4 text-slate-500 rtl:rotate-0 ltr:rotate-180" />
      </Link>

      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <h2 className="heading text-lg font-bold mb-4">{t("admin.recentReqs")}</h2>
          <div className="space-y-3">
            {data.recent_requests.map((r) => (
              <Link key={r._id} to="/app/admin/requests" data-testid={`admin-recent-${r._id}`}
                className="card-surface card-surface-hover p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{r.title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{t(`svc.${r.service_type}_short`)} · {r.city} · <span className="num">{r.start_date}</span></p>
                </div>
                <p className="font-heading font-bold text-brand num text-sm">{sar(r.estimated_total)}</p>
                <StatusBadge kind="request" status={r.status} />
              </Link>
            ))}
          </div>
        </div>

        <div>
          <h2 className="heading text-lg font-bold mb-4 flex items-center gap-2">
            <Send className="w-4 h-4 text-brand" /> {t("admin.broadcast")}
          </h2>
          <form onSubmit={sendBroadcast} className="card-surface p-5 space-y-3" data-testid="broadcast-form">
            <Input data-testid="broadcast-title" placeholder={t("admin.bcTitle")} value={broadcast.title}
              onChange={(e) => setBroadcast({ ...broadcast, title: e.target.value })} className="bg-navy-800 border-navy-600 h-11" />
            <textarea data-testid="broadcast-body" placeholder={t("admin.bcBody")} value={broadcast.body}
              onChange={(e) => setBroadcast({ ...broadcast, body: e.target.value })}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 py-2.5 text-sm min-h-[80px] focus:outline-none focus:ring-1 focus:ring-brand" />
            <div className="flex gap-3">
              <select data-testid="broadcast-target" value={broadcast.target}
                onChange={(e) => setBroadcast({ ...broadcast, target: e.target.value })}
                className="flex-1 bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
                <option value="all">{t("admin.bcAll")}</option>
                <option value="business">{t("admin.bcBusiness")}</option>
                <option value="worker">{t("admin.bcDrivers")}</option>
              </select>
              <button data-testid="broadcast-send-btn" disabled={busy}
                className="bg-brand text-navy-900 font-bold rounded-xl px-6 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
                {busy ? t("common.saving") : t("common.send")}
              </button>
            </div>
          </form>
          <div className="card-surface p-5 mt-4 flex items-center gap-3">
            <RefreshCcw className="w-5 h-5 text-rose-400 shrink-0" />
            <p className="text-xs text-slate-400 leading-relaxed">
              {t("admin.replacementNote")}
              <Link to="/app/admin/requests" className="text-brand hover:underline mx-1">{t("nav.adminRequests")}</Link>
            </p>
          </div>
          <div className="card-surface p-5 mt-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <p className="text-xs text-slate-400 leading-relaxed">
              <Link to="/app/admin/cases" className="text-brand hover:underline mx-1">{t("nav.cases")}</Link>
              ·
              <Link to="/app/admin/documents" className="text-brand hover:underline mx-1">{t("nav.documents")}</Link>
              ·
              <FileCheck className="w-3.5 h-3.5 inline text-slate-500" />
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
