import { useState } from "react";
import { toast } from "sonner";
import { User, Save, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ACTIVE_SERVICES, CITIES } from "@/lib/constants";

export default function WorkerProfile() {
  const { user, setUser } = useAuth();
  const wp = user?.worker_profile || {};
  const [form, setForm] = useState({
    name: user?.name || "", email: user?.email || "", city: user?.city || "الرياض",
    bank_name: wp.bank_name || "", iban: wp.iban || "", national_id: wp.national_id || "",
    vehicle_type: wp.vehicle_type || "",
  });
  const [services, setServices] = useState(wp.services || []);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggleService = (key) =>
    setServices((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));

  const save = async (e) => {
    e.preventDefault();
    if (services.length === 0) return toast.error("اختر خدمة واحدة على الأقل");
    setBusy(true);
    try {
      const { data } = await api.patch("/profile", { ...form, services });
      setUser(data.user);
      toast.success("تم حفظ ملفك");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6" data-testid="worker-profile-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">ملفي الشخصي</h1>
        <p className="text-sm text-slate-400 mt-1">خدماتك وبياناتك البنكية للسحب</p>
      </div>
      <form onSubmit={save} className="card-surface p-6 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-navy-600/40">
          <div className="w-12 h-12 rounded-full bg-brand/10 border border-brand/25 flex items-center justify-center font-heading font-bold text-brand text-lg">
            {user?.name?.[0] || "؟"}
          </div>
          <div>
            <p className="font-heading font-bold">{user?.name}</p>
            <p className="text-xs text-slate-500 num">{user?.phone}</p>
          </div>
          {wp.rating && (
            <span className="ms-auto chip bg-amber-500/10 text-amber-400 border-amber-500/30">
              <Star className="w-3.5 h-3.5 fill-amber-400" /> <span className="num">{wp.rating}</span> ({wp.rating_count} تقييم)
            </span>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">الاسم الكامل</label>
            <Input data-testid="profile-name" value={form.name} onChange={set("name")} className="bg-navy-800 border-navy-600 h-11" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">البريد الإلكتروني</label>
            <Input data-testid="profile-email" dir="ltr" type="email" value={form.email} onChange={set("email")} className="bg-navy-800 border-navy-600 h-11 text-left" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">المدينة</label>
            <select data-testid="profile-city" value={form.city} onChange={set("city")}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
              {CITIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">رقم الهوية</label>
            <Input data-testid="profile-national-id" dir="ltr" value={form.national_id} onChange={set("national_id")} className="bg-navy-800 border-navy-600 h-11 text-left" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">نوع مركبتك</label>
            <select data-testid="profile-vehicle" value={form.vehicle_type} onChange={set("vehicle_type")}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
              <option value="">اختر…</option>
              {["دراجة نارية", "سيارة", "فان صغير"].map((v) => <option key={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">البنك</label>
            <Input data-testid="profile-bank" value={form.bank_name} onChange={set("bank_name")} className="bg-navy-800 border-navy-600 h-11" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">رقم الآيبان</label>
            <Input data-testid="profile-iban" dir="ltr" value={form.iban} onChange={set("iban")} className="bg-navy-800 border-navy-600 h-11 text-left" />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-2">خدمتك — توصيل ومندوبون</label>
          <div className="flex flex-wrap gap-2" data-testid="profile-services">
            {ACTIVE_SERVICES.map((s) => (
              <button key={s.key} type="button" data-testid={`profile-service-${s.key}`} onClick={() => toggleService(s.key)}
                className={`chip transition-all ${
                  services.includes(s.key)
                    ? "bg-brand/15 text-brand border-brand/40"
                    : "bg-navy-800 text-slate-400 border-navy-600 hover:border-slate-500"
                }`}>
                <s.icon className="w-3.5 h-3.5" /> {s.short}
              </button>
            ))}
          </div>
        </div>
        <button data-testid="profile-save-btn" disabled={busy}
          className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-6 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
          <Save className="w-4 h-4" /> {busy ? "جاري الحفظ…" : "حفظ التغييرات"}
        </button>
      </form>
    </div>
  );
}
