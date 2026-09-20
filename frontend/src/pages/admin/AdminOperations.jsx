import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Activity, Phone, RefreshCcw, AlertTriangle, UserX, Warehouse, CircleCheck, Clock3, UserPlus, Bell } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { useI18n } from "@/i18n";
import { StatusBadge } from "@/components/StatusBadge";

const SEV_CLS = {
  critical: "border-rose-500/50 bg-rose-500/10 text-rose-300",
  high: "border-rose-500/40 bg-rose-500/5 text-rose-300",
  medium: "border-amber-500/40 bg-amber-500/5 text-amber-300",
  low: "border-navy-600/50 bg-navy-800/40 text-slate-300",
};

export default function AdminOperations() {
  const { t } = useI18n();
  const [today, setToday] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    api.get("/admin/operations/today").then(({ data }) => setToday(data)).catch((e) => toast.error(errMsg(e)));
    api.get("/admin/operations/alerts").then(({ data }) => setAlerts(data.alerts)).catch(() => setAlerts([]));
  };
  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, []);

  const rematch = async (requestId) => {
    setBusyId(requestId);
    try {
      const { data } = await api.post(`/admin/operations/requests/${requestId}/rematch`);
      toast.success(`${t("opstoday.rematchDone")} (${data.matched})`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
    }
  };

  const s = today?.summary;
  const cards = s ? [
    ["activeRequests", s.active_requests, Activity, "text-brand"],
    ["expectedDrivers", s.expected_drivers, UserPlus, "text-slate-300"],
    ["present", s.present, CircleCheck, "text-emerald-400"],
    ["notArrived", s.not_arrived, UserX, "text-amber-400"],
    ["working", s.working, Warehouse, "text-blue-400"],
    ["waitingWarehouse", s.waiting_warehouse, Clock3, "text-violet-400"],
    ["completed", s.completed, CircleCheck, "text-green-400"],
    ["issues", s.issues, AlertTriangle, "text-rose-400"],
    ["replacements", s.replacements_open, RefreshCcw, "text-orange-400"],
  ] : [];

  return (
    <div className="space-y-6" data-testid="ops-today-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
            <Activity className="w-6 h-6 text-brand" /> {t("opstoday.title")}
          </h1>
          <p className="text-sm text-slate-400 mt-1">{t("opstoday.sub")}</p>
        </div>
        <button onClick={load} data-testid="ops-refresh"
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-brand transition-colors">
          <RefreshCcw className="w-4 h-4" /> {t("live.refresh")}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="ops-summary">
        {cards.map(([key, val, Icon, cls]) => (
          <div key={key} className="card-surface p-4" data-testid={`ops-card-${key}`}>
            <div className="flex items-center gap-2">
              <Icon className={`w-4 h-4 ${cls}`} />
              <p className="text-[11px] text-slate-500">{t(`opstoday.${key}`)}</p>
            </div>
            <p className={`heading text-2xl font-black num mt-2 ${cls}`}>{val}</p>
          </div>
        ))}
      </div>

      <div className="card-surface p-5" data-testid="late-drivers-section">
        <h2 className="heading text-lg font-bold mb-4 flex items-center gap-2">
          <UserX className="w-4 h-4 text-amber-400" /> {t("opstoday.lateTitle")}
        </h2>
        {!today ? (
          <p className="text-slate-500 text-sm">{t("common.loading")}</p>
        ) : today.late_drivers.length === 0 ? (
          <p className="text-slate-500 text-sm" data-testid="no-late">{t("opstoday.noLate")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-600/50 text-slate-400 text-xs">
                  {[t("opstoday.driver"), t("opstoday.warehouse"), t("opstoday.requestCol"), t("opstoday.city"), t("opstoday.start"), t("opstoday.minutesLate"), t("opstoday.status"), ""].map((h) => (
                    <th key={h} className="text-start p-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {today.late_drivers.map((l) => (
                  <tr key={l.offer_id} className="border-b border-navy-600/30" data-testid={`late-row-${l.offer_id}`}>
                    <td className="p-3 font-semibold">{l.driver_name}</td>
                    <td className="p-3 text-xs text-slate-400">{l.business_name}</td>
                    <td className="p-3 text-xs text-slate-400">{l.title}</td>
                    <td className="p-3 text-xs">{l.city}</td>
                    <td className="p-3 text-xs num">{l.start_time}</td>
                    <td className="p-3"><span className="num font-bold text-amber-400">{l.minutes_late}</span></td>
                    <td className="p-3"><StatusBadge kind="offer" status={l.status} /></td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1.5">
                        {l.driver_phone && (
                          <>
                            <a href={`tel:${l.driver_phone}`} data-testid={`late-call-${l.offer_id}`}
                              className="chip bg-navy-800 border-navy-600 text-slate-300 hover:text-brand text-[11px]">
                              <Phone className="w-3 h-3" /> {t("opstoday.call")}
                            </a>
                            <a href={`https://wa.me/${l.driver_phone.replace("+", "")}`} target="_blank" rel="noreferrer" data-testid={`late-wa-${l.offer_id}`}
                              className="chip bg-navy-800 border-navy-600 text-slate-300 hover:text-emerald-400 text-[11px]">
                              {t("opstoday.whatsapp")}
                            </a>
                          </>
                        )}
                        <button onClick={() => rematch(l.request_id)} disabled={busyId === l.request_id} data-testid={`late-rematch-${l.offer_id}`}
                          className="chip bg-navy-800 border-navy-600 text-slate-300 hover:text-orange-400 text-[11px] disabled:opacity-40">
                          {t("opstoday.requestReplacement")}
                        </button>
                        <Link to="/app/admin/requests" data-testid={`late-ops-${l.offer_id}`}
                          className="chip bg-navy-800 border-navy-600 text-slate-300 hover:text-brand text-[11px]">
                          {t("opstoday.openOps")}
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card-surface p-5" data-testid="alerts-section">
        <h2 className="heading text-lg font-bold mb-4 flex items-center gap-2">
          <Bell className="w-4 h-4 text-rose-400" /> {t("opstoday.alertsTitle")}
        </h2>
        {!alerts ? (
          <p className="text-slate-500 text-sm">{t("common.loading")}</p>
        ) : alerts.length === 0 ? (
          <p className="text-slate-500 text-sm" data-testid="no-alerts">{t("opstoday.noAlerts")}</p>
        ) : (
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <div key={`${a.type}-${i}`} className={`rounded-xl border p-3 flex items-start gap-3 ${SEV_CLS[a.severity] || SEV_CLS.low}`}
                data-testid={`alert-${a.type}-${i}`}>
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold">{a.title}</p>
                  <p className="text-[11px] opacity-80 mt-0.5">{a.message}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
