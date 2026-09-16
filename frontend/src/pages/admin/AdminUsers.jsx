import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Users, Search, Ban, CheckCircle2, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { SERVICES, sar } from "@/lib/constants";

export default function AdminUsers() {
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
      toast.success(status === "active" ? "تم تفعيل الحساب" : "تم إيقاف الحساب");
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
        <h1 className="heading text-2xl font-extrabold">إدارة المستخدمين</h1>
        <p className="text-sm text-slate-400 mt-1">المنشآت ومزودو الخدمة المسجلون في المنصة</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2" data-testid="users-role-tabs">
          {[["business", "المنشآت"], ["worker", "مزودو الخدمة"]].map(([k, l]) => (
            <button key={k} onClick={() => setRole(k)} data-testid={`users-tab-${k}`}
              className={`chip ${role === k ? "bg-brand/15 text-brand border-brand/40" : "bg-navy-800 text-slate-400 border-navy-600"}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input data-testid="users-search" placeholder="بحث بالاسم أو الجوال…" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
            className="bg-navy-800 border-navy-600 h-10 pr-10" />
        </div>
      </div>

      {!users ? (
        <p className="text-slate-500 text-sm">جاري التحميل…</p>
      ) : users.length === 0 ? (
        <EmptyState icon={Users} title="لا يوجد مستخدمون" testid="users-empty" />
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-600/50 text-slate-400 text-xs">
                  <th className="text-right p-4 font-semibold">الاسم</th>
                  <th className="text-right p-4 font-semibold">الجوال</th>
                  <th className="text-right p-4 font-semibold">{role === "business" ? "المنشأة" : "الخدمات"}</th>
                  <th className="text-right p-4 font-semibold">المحفظة</th>
                  <th className="text-right p-4 font-semibold">التقييم</th>
                  <th className="text-right p-4 font-semibold">الحالة</th>
                  <th className="text-right p-4 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const prof = role === "business" ? u.business_profile : u.worker_profile;
                  return (
                    <tr key={u._id} className="border-b border-navy-600/30 hover:bg-navy-700/20" data-testid={`user-row-${u._id}`}>
                      <td className="p-4">
                        <p className="font-semibold">{u.name}</p>
                        <p className="text-[11px] text-slate-500">{u.city} {u.is_demo && "· تجريبي"}</p>
                      </td>
                      <td className="p-4 num text-slate-300 text-xs">{u.phone}</td>
                      <td className="p-4 text-xs text-slate-300 max-w-[220px]">
                        {role === "business"
                          ? u.business_profile?.company_name
                          : (u.worker_profile?.services || []).map((s) => SERVICES.find((x) => x.key === s)?.short).join("، ")}
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
                          {u.status === "active" ? "نشط" : "موقوف"}
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
                          {u.status === "active" ? <><Ban className="w-3 h-3" /> إيقاف</> : <><CheckCircle2 className="w-3 h-3" /> تفعيل</>}
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
