import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Settings, Save, Percent, Banknote, Car, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import api, { errMsg } from "@/lib/api";
import { sar } from "@/lib/constants";

export default function AdminSettings() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ default_rate: "", commission_pct: "", vehicle_types: "", service_areas: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/admin/settings").then(({ data }) => {
      const s = data.settings;
      setSettings(s);
      setForm({
        default_rate: String(s.default_rate),
        commission_pct: String(Math.round(s.commission_rate * 100)),
        vehicle_types: (s.vehicle_types || []).join("\n"),
        service_areas: (s.service_areas || []).join("\n"),
      });
    }).catch((e) => toast.error(errMsg(e)));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        default_rate: Number(form.default_rate),
        commission_rate: Number(form.commission_pct) / 100,
        vehicle_types: form.vehicle_types.split("\n").map((v) => v.trim()).filter(Boolean),
        service_areas: form.service_areas.split("\n").map((v) => v.trim()).filter(Boolean),
      };
      const { data } = await api.patch("/admin/settings", payload);
      setSettings(data.settings);
      toast.success("تم حفظ الإعدادات — تسري على الطلبات الجديدة فوراً");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return <p className="text-slate-500 text-sm">جاري التحميل…</p>;

  return (
    <div className="max-w-3xl space-y-6" data-testid="admin-settings-page">
      <div>
        <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
          <Settings className="w-6 h-6 text-brand" /> التسعير والإعدادات
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          تحكم كامل في تسعير المنصة بدون تعديل الكود — التغييرات تسري على الطلبات الجديدة فقط
        </p>
      </div>

      <form onSubmit={save} className="space-y-5" data-testid="settings-form">
        <div className="card-surface p-6 space-y-4">
          <p className="font-heading font-bold flex items-center gap-2">
            <Banknote className="w-4 h-4 text-brand" /> التسعير
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">السعر الافتراضي لكل شحنة (ر.س)</label>
              <Input data-testid="settings-default-rate" type="number" min="1" step="0.5" value={form.default_rate}
                onChange={(e) => setForm({ ...form, default_rate: e.target.value })}
                className="bg-navy-800 border-navy-600 h-11 num" />
              <p className="text-[11px] text-slate-500 mt-1">يظهر كسعر مقترح عند إنشاء المنشأة لطلب جديد</p>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">عمولة المنصة (%)</label>
              <div className="relative">
                <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <Input data-testid="settings-commission" type="number" min="1" max="50" value={form.commission_pct}
                  onChange={(e) => setForm({ ...form, commission_pct: e.target.value })}
                  className="bg-navy-800 border-navy-600 h-11 num pl-9" />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">تُقتطع من قيمة الطلب عند التسوية (1% – 50%)</p>
            </div>
          </div>
          <div className="bg-navy-800/60 rounded-xl p-4 border border-navy-600/40 text-xs text-slate-400" data-testid="settings-preview">
            مثال حي: طلب بمبلغ {sar(1000)} → عمولة المنصة <span className="num text-amber-400">{sar(1000 * (Number(form.commission_pct) || 0) / 100)}</span> ·
            صافي المندوبين <span className="num text-brand">{sar(1000 - 1000 * (Number(form.commission_pct) || 0) / 100)}</span>
          </div>
        </div>

        <div className="card-surface p-6 space-y-4">
          <p className="font-heading font-bold flex items-center gap-2">
            <Car className="w-4 h-4 text-brand" /> أنواع المركبات
          </p>
          <label className="text-xs text-slate-400 block">نوع واحد في كل سطر — تظهر للمنشأة عند إنشاء الطلب وللسائق في ملفه</label>
          <Textarea data-testid="settings-vehicle-types" value={form.vehicle_types}
            onChange={(e) => setForm({ ...form, vehicle_types: e.target.value })}
            className="bg-navy-800 border-navy-600 min-h-[80px]" />
        </div>

        <div className="card-surface p-6 space-y-4">
          <p className="font-heading font-bold flex items-center gap-2">
            <MapPin className="w-4 h-4 text-brand" /> مناطق الخدمة (المدن)
          </p>
          <label className="text-xs text-slate-400 block">مدينة واحدة في كل سطر</label>
          <Textarea data-testid="settings-service-areas" value={form.service_areas}
            onChange={(e) => setForm({ ...form, service_areas: e.target.value })}
            className="bg-navy-800 border-navy-600 min-h-[100px]" />
        </div>

        <button data-testid="settings-save-btn" disabled={busy}
          className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-8 py-3 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors shadow-[0_0_25px_rgba(0,229,163,0.25)]">
          <Save className="w-4 h-4" /> {busy ? "جاري الحفظ…" : "حفظ الإعدادات"}
        </button>
      </form>
    </div>
  );
}
