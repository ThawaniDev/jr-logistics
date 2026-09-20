import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Zap, MapPin, Calendar, Truck, Send, UserCheck } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { sar } from "@/lib/constants";
import { useI18n } from "@/i18n";

export default function OfficeOpportunities() {
  const { t } = useI18n();
  const [items, setItems] = useState(null);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState("");

  const load = () => api.get("/office/opportunities")
    .then(({ data }) => setItems(data.opportunities))
    .catch((e) => { toast.error(errMsg(e)); setItems([]); });
  useEffect(() => { load(); }, []);

  const assign = async (requestId) => {
    const driverId = selected[requestId];
    if (!driverId) return toast.error(t("office.assignDriver"));
    setBusy(`assign-${requestId}`);
    try {
      await api.post(`/office/opportunities/${requestId}/assign`, { driver_id: driverId });
      toast.success(t("office.assigned"));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  const broadcast = async (requestId) => {
    setBusy(`broadcast-${requestId}`);
    try {
      const { data } = await api.post(`/office/opportunities/${requestId}/broadcast`);
      toast.success(`${t("office.broadcastDone")} (${data.matched})`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  const sel = "w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand";

  return (
    <div className="space-y-6" data-testid="office-opportunities-page">
      <div>
        <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
          <Zap className="w-6 h-6 text-brand" /> {t("office.opportunities")}
        </h1>
        <p className="text-sm text-slate-400 mt-1">{t("office.opportunitiesSub")}</p>
      </div>

      {!items ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <EmptyState icon={Zap} title={t("office.noOpportunities")} desc={t("office.noOpportunitiesDesc")} testid="office-opportunities-empty" />
      ) : (
        <div className="space-y-4" data-testid="office-opportunities-list">
          {items.map((r) => {
            const eligible = (r.eligible_drivers || []).filter((d) => d.eligible);
            const chosen = (r.eligible_drivers || []).find((d) => d._id === selected[r._id]);
            return (
              <div key={r._id} className="card-surface p-5 space-y-4" data-testid={`office-opportunity-${r._id}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-heading font-bold">{r.title}</p>
                    <p className="text-xs text-slate-500 mt-1">{r.business?.company_name || r.business?.name || r.business_id}</p>
                  </div>
                  <StatusBadge kind="request" status={r.status} />
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                  <div className="bg-navy-800/70 rounded-lg p-3 border border-navy-600/40">
                    <p className="text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3" /> {t("opp.location")}</p>
                    <p className="font-semibold mt-1">{r.pickup_city} → {r.delivery_city}</p>
                    <p className="text-[10px] text-slate-500 mt-1">{r.address}</p>
                  </div>
                  <div className="bg-navy-800/70 rounded-lg p-3 border border-navy-600/40">
                    <p className="text-slate-500 flex items-center gap-1"><Calendar className="w-3 h-3" /> {t("opp.date")}</p>
                    <p className="font-semibold mt-1 num">{r.start_date} · {r.start_time}</p>
                  </div>
                  <div className="bg-navy-800/70 rounded-lg p-3 border border-navy-600/40">
                    <p className="text-slate-500 flex items-center gap-1"><Truck className="w-3 h-3" /> {t("opp.vehicleReq")}</p>
                    <p className="font-semibold mt-1">{r.vehicle_type ? t(`veh.${r.vehicle_type}`) : "—"}{r.temperature_type ? ` · ${t(`veh.${r.temperature_type}`)}` : ""}</p>
                  </div>
                  <div className="bg-navy-800/70 rounded-lg p-3 border border-navy-600/40">
                    <p className="text-slate-500">{t("office.shipments")}</p>
                    <p className="font-semibold mt-1 num">{r.shipments_per_driver || "—"}</p>
                    {r.provider_amount_estimate && <p className="text-[10px] text-brand mt-1 num">{sar(r.provider_amount_estimate)}</p>}
                  </div>
                </div>
                {r.requirements && <p className="text-xs text-slate-400 bg-navy-800/50 rounded-xl p-3 border border-navy-600/40">{r.requirements}</p>}

                <div className="grid lg:grid-cols-[1fr_auto_auto] gap-3 items-end border-t border-navy-600/40 pt-4">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">{t("office.assignDriver")}</label>
                    <select value={selected[r._id] || ""} onChange={(e) => setSelected({ ...selected, [r._id]: e.target.value })}
                      data-testid={`assign-driver-${r._id}`} className={sel}>
                      <option value="">{t("auth.choose")}</option>
                      {(r.eligible_drivers || []).map((d) => (
                        <option key={d._id} value={d._id} disabled={!d.eligible}>
                          {d.name} — {d.vehicle_type ? t(`veh.${d.vehicle_type}`) : "—"} {d.eligible ? "" : `(${d.reasons[0]})`}
                        </option>
                      ))}
                    </select>
                    {chosen && !chosen.eligible && <p className="text-[11px] text-rose-400 mt-1">{chosen.reasons.join(" · ")}</p>}
                    {eligible.length === 0 && <p className="text-[11px] text-amber-400 mt-1">{t("office.noEligible")}</p>}
                  </div>
                  <button onClick={() => assign(r._id)} disabled={busy || !selected[r._id]} data-testid={`assign-btn-${r._id}`}
                    className="flex items-center justify-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-5 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
                    <UserCheck className="w-4 h-4" /> {busy === `assign-${r._id}` ? t("common.saving") : t("office.assign")}
                  </button>
                  <button onClick={() => broadcast(r._id)} disabled={busy} data-testid={`broadcast-btn-${r._id}`}
                    className="flex items-center justify-center gap-2 border border-navy-600 text-slate-300 font-semibold rounded-xl px-5 py-2.5 text-sm hover:border-brand/40 hover:text-brand disabled:opacity-50 transition-colors">
                    <Send className="w-4 h-4" /> {t("office.broadcast")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
