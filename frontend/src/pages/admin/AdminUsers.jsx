import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Users, Search, Ban, CheckCircle2, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { SERVICES, sar } from "@/lib/constants";
import { useI18n } from "@/i18n";

export default function AdminUsers() {
  const { t } = useI18n();
  const [users, setUsers] = useState(null);
  const [role, setRole] = useState("business");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");

  const load = () =>
    api.get("/admin/users", { params: { role, q: q || undefined } })
      .then(({ data }) => setUsers(data.users)).catch(() => {});
  useEffect(() => { load(); }, [role]);

  const setStatus = async (id, status) => {
    setBusy(id);
    try {
      await api.patch(`/admin/users/${id}/status`, { status });
      toast.success(t("admin.staffUpdated"));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-users-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("admin.usersTitle")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("admin.usersSub")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2" data-testid="users-role-tabs">
          {[["business", t("admin.tabBusiness")], ["worker", t("admin.tabDrivers")]].map(([k, l]) => (
            <button key={k} onClick={() => setRole(k)} data-testid={`users-tab-${k}`}
              className={`chip ${role === k ? "bg-brand/15 text-brand border-brand/40" : "bg-navy-800 text-slate-400 border-navy-600"}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input data-testid="users-search" placeholder={t("admin.searchPh")} value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
            className="bg-navy-800 border-navy-600 h-10 pe-10" />
        </div>
      </div>

      {!users ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : users.length === 0 ? (
        <EmptyState icon={Users} title={t("admin.noUsers")} testid="users-empty" />
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-600/50 text-slate-400 text-xs">
                  <th className="text-start p-4 font-semibold">{t("admin.colName")}</th>
                  <th className="text-start p-4 font-semibold">{t("admin.colPhone")}</th>
                  <th className="text-start p-4 font-semibold">{role === "business" ? t("admin.colCompany") : t("admin.colServices")}</th>
                  <th className="text-start p-4 font-semibold">{t("admin.colWallet")}</th>
                  <th className="text-start p-4 font-semibold">{t("admin.colRating")}</th>
                  <th className="text-start p-4 font-semibold">{t("common.status")}</th>
                  <th className="text-start p-4 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const prof = role === "business" ? u.business_profile : u.worker_profile;
                  return (
                    <tr key={u._id} className="border-b border-navy-600/30 hover:bg-navy-700/20" data-testid={`user-row-${u._id}`}>
                      <td className="p-4">
                        <p className="font-semibold">{u.name}</p>
                        <p className="text-[11px] text-slate-500">{u.city} {u.is_demo && `· ${t("admin.demoTag")}`}</p>
                      </td>
                      <td className="p-4 num text-slate-300 text-xs">{u.phone}</td>
                      <td className="p-4 text-xs text-slate-300 max-w-[220px]">
                        {role === "business"
                          ? u.business_profile?.company_name
                          : (u.worker_profile?.services || []).map((s) => t(`svc.${s}_short`)).join("، ")}
                        {role === "worker" && (
                          <span className={`block mt-1 text-[10px] ${
                            u.worker_profile?.verification_status === "verified" ? "text-emerald-400"
                            : u.worker_profile?.verification_status === "not_eligible" ? "text-rose-400" : "text-amber-400"}`}>
                            {u.worker_profile?.verification_status === "verified" ? t("admin.verified")
                              : u.worker_profile?.verification_status === "not_eligible" ? t("admin.notEligible") : t("admin.pendingVer")}
                          </span>
                        )}
                        {role === "worker" && (u.worker_profile?.cancel_count > 0) && (
                          <span className="block mt-1 text-[10px] text-rose-400" data-testid={`cancels-${u._id}`}>
                            {u.worker_profile.cancel_count} {t("admin.cancCount")} · {u.worker_profile.cancel_count_week || 0} {t("admin.cancWeek")}
                          </span>
                        )}
                        {role === "worker" && u.worker_profile?.suspended_until && u.worker_profile.suspended_until > new Date().toISOString() && (
                          <button data-testid={`clear-suspension-${u._id}`}
                            onClick={async () => {
                              try {
                                await api.post(`/admin/users/${u._id}/clear-suspension`);
                                toast.success(t("admin.suspCleared"));
                                load();
                              } catch (e) { toast.error(errMsg(e)); }
                            }}
                            className="block mt-1.5 text-[10px] font-bold text-amber-400 border border-amber-500/30 rounded-lg px-2 py-1 hover:bg-amber-500/10 transition-colors">
                            {t("admin.suspLift")} {u.worker_profile.suspended_until.slice(0, 10)}
                          </button>
                        )}
                      </td>
                      <td className="p-4 num text-brand font-semibold">{sar(u.wallet?.available)}</td>
                      <td className="p-4">
                        {prof?.rating ? (
                          <span className="flex items-center gap-1 text-amber-400 text-xs">
                            <Star className="w-3.5 h-3.5 fill-amber-400" /> <span className="num">{prof.rating}</span>
                          </span>
                        ) : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="p-4">
                        <span className={`chip ${u.status === "active" ? "bg-green-500/10 text-green-300 border-green-500/30" : "bg-rose-500/10 text-rose-400 border-rose-500/30"}`}>
                          {u.status === "active" ? t("admin.activeStatus") : t("admin.suspended")}
                        </span>
                      </td>
                      <td className="p-4">
                        <button
                          data-testid={`user-toggle-${u._id}`}
                          disabled={busy === u._id}
                          onClick={() => setStatus(u._id, u.status === "active" ? "suspended" : "active")}
                          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border transition-colors ${
                            u.status === "active"
                              ? "border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                              : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                          }`}
                        >
                          {u.status === "active" ? <><Ban className="w-3 h-3" /> {t("admin.suspend")}</> : <><CheckCircle2 className="w-3 h-3" /> {t("admin.activate")}</>}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
