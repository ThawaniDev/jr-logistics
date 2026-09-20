import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Users, UserPlus, Link2, Unlink } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { DEFAULT_VEHICLE_TYPES, TEMP_TYPES } from "@/lib/constants";
import { useI18n } from "@/i18n";

export default function OfficeDrivers() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", vehicle_type: "", vehicle_temperature: "" });
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/office/drivers").then(({ data }) => setData(data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, []);

  const invite = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return toast.error(t("common.required"));
    setBusy(true);
    try {
      await api.post("/office/drivers/invite", {
        name: form.name.trim(), phone: form.phone.trim(),
        vehicle_type: form.vehicle_type || null,
        vehicle_temperature: ["van", "dyna"].includes(form.vehicle_type) ? form.vehicle_temperature || null : null,
      });
      toast.success(t("office.inviteSent"));
      setForm({ name: "", phone: "", vehicle_type: "", vehicle_temperature: "" });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (id) => {
    try {
      await api.post(`/office/drivers/${id}/unlink`);
      toast.success(t("office.unlinked"));
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const sel = "w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand";

  return (
    <div className="space-y-6" data-testid="office-drivers-page">
      <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
        <Users className="w-6 h-6 text-brand" /> {t("office.myDrivers")}
      </h1>

      <form onSubmit={invite} className="card-surface p-6 space-y-4" data-testid="invite-driver-form">
        <p className="font-heading font-bold flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-brand" /> {t("office.inviteDriver")}
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Input data-testid="invite-name" value={form.name} placeholder={t("office.driverName")}
            onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-navy-800 border-navy-600 h-11" />
          <Input data-testid="invite-phone" dir="ltr" value={form.phone} placeholder="+9665xxxxxxxx"
            onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-navy-800 border-navy-600 h-11 text-left" />
          <select data-testid="invite-vehicle" value={form.vehicle_type}
            onChange={(e) => setForm({ ...form, vehicle_type: e.target.value, vehicle_temperature: "" })} className={sel}>
            <option value="">{t("auth.vehicleType")}</option>
            {DEFAULT_VEHICLE_TYPES.map((v) => <option key={v} value={v}>{t(`veh.${v}`)}</option>)}
          </select>
          {["van", "dyna"].includes(form.vehicle_type) && (
            <select data-testid="invite-temp" value={form.vehicle_temperature}
              onChange={(e) => setForm({ ...form, vehicle_temperature: e.target.value })} className={sel}>
              <option value="">{t("veh.tempType")}</option>
              {TEMP_TYPES.map((tp) => <option key={tp} value={tp}>{t(`veh.${tp}`)}</option>)}
            </select>
          )}
        </div>
        <button data-testid="invite-send-btn" disabled={busy}
          className="bg-brand text-navy-900 font-bold rounded-xl px-6 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
          {busy ? t("common.saving") : t("office.sendInvite")}
        </button>
      </form>

      {data?.pending_invites?.length > 0 && (
        <div className="card-surface p-5 space-y-2" data-testid="pending-invites">
          <p className="font-heading font-bold text-sm">{t("office.pendingInvites")}</p>
          {data.pending_invites.map((iv) => (
            <div key={iv._id} className="flex items-center justify-between rounded-xl bg-navy-800/60 border border-navy-600/40 px-4 py-2.5"
              data-testid={`invite-${iv._id}`}>
              <div>
                <p className="text-sm font-semibold">{iv.name}</p>
                <p className="text-[11px] text-slate-500 num">{iv.phone}</p>
              </div>
              <span className="chip bg-amber-500/10 border-amber-500/30 text-amber-300 text-[10px]">
                {iv.kind === "invite_new" ? t("office.inviteKindNew") : t("office.inviteKindLink")}
              </span>
            </div>
          ))}
        </div>
      )}

      {!data ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : data.drivers.length === 0 ? (
        <EmptyState icon={Users} title={t("office.noDrivers")} desc={t("office.noDriversDesc")} testid="drivers-empty" />
      ) : (
        <div className="grid gap-3" data-testid="drivers-list">
          {data.drivers.map((d) => {
            const wp = d.worker_profile || {};
            return (
              <div key={d._id} className="card-surface p-5 space-y-3" data-testid={`driver-card-${d._id}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-brand/10 border border-brand/25 flex items-center justify-center font-bold text-brand">
                      {d.name?.[0] || "؟"}
                    </div>
                    <div>
                      <p className="font-bold text-sm">{d.name}</p>
                      <p className="text-[11px] text-slate-500 num">{d.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`chip text-[10px] ${wp.availability === "available" && !d.has_active_job ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : d.has_active_job ? "bg-blue-500/10 border-blue-500/30 text-blue-300" : "bg-navy-800 border-navy-600 text-slate-400"}`}
                      data-testid={`driver-avail-${d._id}`}>
                      {d.has_active_job ? t("office.activeJob") : t(`drvDash.${wp.availability === "available" ? "availOn" : "availOff"}`)}
                    </span>
                    <button onClick={() => unlink(d._id)} data-testid={`unlink-${d._id}`}
                      className="chip bg-navy-800 border-navy-600 text-slate-400 hover:text-rose-400 text-[10px]">
                      <Unlink className="w-3 h-3" /> {t("office.unlink")}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-400">
                  <span>{t("auth.vehicleType")}: <b className="text-slate-200">{wp.vehicle_type ? t(`veh.${wp.vehicle_type}`) : "—"}{wp.vehicle_temperature ? ` · ${t(`veh.${wp.vehicle_temperature}`)}` : ""}</b></span>
                  <span>{t("office.jobsCompleted")}: <b className="num text-slate-200">{wp.jobs_completed || 0}</b></span>
                  <span>{t("office.docsStatus")}: <b className={wp.verification_status === "verified" ? "text-emerald-400" : "text-amber-400"}>{t(`office.status_${wp.verification_status || "pending"}`)}</b></span>
                  {d.active_job && <span>{t("office.activeJob")}: <StatusBadge kind="offer" status={d.active_job.status} /></span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
