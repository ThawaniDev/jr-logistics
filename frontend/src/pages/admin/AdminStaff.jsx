import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, UserPlus, Ban, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { useI18n } from "@/i18n";
import { EmptyState } from "@/components/EmptyState";

const ROLE_KEYS = ["support", "operations", "finance", "supervisor"];
const ROLE_LABEL = { support: "admin.roleSupport", operations: "admin.roleOperations", finance: "admin.roleFinance", supervisor: "admin.roleSupervisor" };

export default function AdminStaff() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", staff_role: "support", password: "" });
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState(null);
  const [resetPw, setResetPw] = useState("");

  const load = () => api.get("/admin/staff").then(({ data }) => setData(data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim() || !form.password) return toast.error(t("adminAuth.errMissing"));
    setBusy(true);
    try {
      await api.post("/admin/staff", form);
      toast.success(t("admin.staffCreated"));
      setForm({ name: "", phone: "", staff_role: "support", password: "" });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id, status) => {
    try {
      await api.patch(`/admin/staff/${id}`, { status });
      toast.success(t("admin.staffUpdated"));
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const changeRole = async (id, staff_role) => {
    try {
      await api.patch(`/admin/staff/${id}`, { staff_role });
      toast.success(t("admin.staffUpdated"));
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const resetPassword = async (id) => {
    if (!resetPw || resetPw.length < 8) return toast.error(t("admin.staffPasswordNote"));
    try {
      await api.patch(`/admin/staff/${id}`, { password: resetPw });
      toast.success(t("admin.passwordReset"));
      setResetFor(null);
      setResetPw("");
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-staff-page">
      <div>
        <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-brand" /> {t("admin.staffTitle")}
        </h1>
        <p className="text-sm text-slate-400 mt-1">{t("admin.staffSub")}</p>
      </div>

      <form onSubmit={create} className="card-surface p-6 space-y-4" data-testid="staff-form">
        <p className="font-heading font-bold flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-brand" /> {t("admin.addStaff")}
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("common.name")}</label>
            <Input data-testid="staff-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-navy-800 border-navy-600 h-11" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("common.phone")}</label>
            <Input data-testid="staff-phone" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-navy-800 border-navy-600 h-11 text-left" placeholder="+9665..." />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("admin.staffRole")}</label>
            <select data-testid="staff-role" value={form.staff_role} onChange={(e) => setForm({ ...form, staff_role: e.target.value })}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
              {ROLE_KEYS.map((r) => <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("admin.staffPassword")}</label>
            <Input data-testid="staff-password" dir="ltr" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="bg-navy-800 border-navy-600 h-11 text-left" />
          </div>
        </div>
        <p className="text-[11px] text-slate-500">{t("admin.staffPasswordNote")}</p>
        {data?.presets && (
          <div className="flex flex-wrap gap-1.5" data-testid="staff-perms-preview">
            {(data.presets[form.staff_role] || []).map((p) => (
              <span key={p} className="chip bg-navy-800 text-slate-400 border-navy-600 num">{p}</span>
            ))}
          </div>
        )}
        <p className="text-[11px] text-slate-500">{t("admin.presetsNote")}</p>
        <button data-testid="staff-create-btn" disabled={busy}
          className="bg-brand text-navy-900 font-bold rounded-xl px-6 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
          {t("admin.createAccount")}
        </button>
      </form>

      {!data ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : data.staff.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t("admin.noStaff")} testid="staff-empty" />
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-600/50 text-slate-400 text-xs">
                  <th className="text-start p-4 font-semibold">{t("common.name")}</th>
                  <th className="text-start p-4 font-semibold">{t("common.phone")}</th>
                  <th className="text-start p-4 font-semibold">{t("admin.staffRole")}</th>
                  <th className="text-start p-4 font-semibold">{t("admin.permissions")}</th>
                  <th className="text-start p-4 font-semibold">{t("common.status")}</th>
                  <th className="text-start p-4 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {data.staff.map((s) => (
                  <tr key={s._id} className="border-b border-navy-600/30 hover:bg-navy-700/20" data-testid={`staff-row-${s._id}`}>
                    <td className="p-4 font-semibold">{s.name}</td>
                    <td className="p-4 num text-slate-300 text-xs">{s.phone}</td>
                    <td className="p-4">
                      <select data-testid={`staff-role-select-${s._id}`} value={s.staff_profile?.staff_role}
                        onChange={(e) => changeRole(s._id, e.target.value)}
                        className="bg-navy-800 border border-navy-600 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand">
                        {ROLE_KEYS.map((r) => <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>)}
                      </select>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1 max-w-[280px]">
                        {(s.staff_profile?.permissions || []).map((p) => (
                          <span key={p} className="text-[10px] bg-navy-800 border border-navy-600 rounded-full px-2 py-0.5 text-slate-400 num">{p}</span>
                        ))}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`chip ${s.status === "active" ? "bg-green-500/10 text-green-300 border-green-500/30" : "bg-rose-500/10 text-rose-400 border-rose-500/30"}`}>
                        {s.status === "active" ? t("admin.activeStatus") : t("admin.suspended")}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <button data-testid={`staff-toggle-${s._id}`} onClick={() => toggle(s._id, s.status === "active" ? "suspended" : "active")}
                          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition-colors ${
                            s.status === "active" ? "border-rose-500/30 text-rose-400 hover:bg-rose-500/10" : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                          }`}>
                          {s.status === "active" ? <><Ban className="w-3 h-3" /> {t("admin.suspend")}</> : <><CheckCircle2 className="w-3 h-3" /> {t("admin.activate")}</>}
                        </button>
                        {resetFor === s._id ? (
                          <div className="flex items-center gap-1.5">
                            <Input data-testid={`staff-reset-input-${s._id}`} dir="ltr" type="password" value={resetPw}
                              onChange={(e) => setResetPw(e.target.value)}
                              className="bg-navy-800 border-navy-600 h-8 text-xs w-32 text-left" placeholder="••••••••" />
                            <button data-testid={`staff-reset-confirm-${s._id}`} onClick={() => resetPassword(s._id)}
                              className="rounded-lg bg-brand text-navy-900 px-2.5 py-1.5 text-xs font-bold hover:bg-brand-hover">
                              {t("common.save")}
                            </button>
                          </div>
                        ) : (
                          <button data-testid={`staff-reset-${s._id}`} onClick={() => { setResetFor(s._id); setResetPw(""); }}
                            className="rounded-xl px-3 py-1.5 text-xs font-semibold border border-navy-600 text-slate-400 hover:border-brand/40 hover:text-brand transition-colors">
                            {t("admin.resetPassword")}
                          </button>
                        )}
                      </div>
                    </td>
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
