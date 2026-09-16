import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Settings, Save, Percent, Banknote, Car, MapPin, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import api, { errMsg } from "@/lib/api";
import { sar } from "@/lib/constants";
import { useI18n } from "@/i18n";

export default function AdminSettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ default_rate: "", commission_pct: "", compensation_pct: "", vehicle_types: "", service_areas: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/admin/settings").then(({ data }) => {
      const s = data.settings;
      setSettings(s);
      setForm({
        default_rate: String(s.default_rate),
        commission_pct: String(Math.round(s.commission_rate * 100)),
        compensation_pct: String(s.no_work_compensation_pct ?? 100),
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
        no_work_compensation_pct: Number(form.compensation_pct),
        vehicle_types: form.vehicle_types.split("\n").map((v) => v.trim()).filter(Boolean),
        service_areas: form.service_areas.split("\n").map((v) => v.trim()).filter(Boolean),
      };
      const { data } = await api.patch("/admin/settings", payload);
      setSettings(data.settings);
      toast.success(t("admin.saved"));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return <p className="text-slate-500 text-sm">{t("common.loading")}</p>;

  return (
    <div className="max-w-3xl space-y-6" data-testid="admin-settings-page">
      <div>
        <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
          <Settings className="w-6 h-6 text-brand" /> {t("admin.settingsTitle")}
        </h1>
        <p className="text-sm text-slate-400 mt-1">{t("admin.settingsSub")}</p>
      </div>

      <form onSubmit={save} className="space-y-5" data-testid="settings-form">
        <div className="card-surface p-6 space-y-4">
          <p className="font-heading font-bold flex items-center gap-2">
            <Banknote className="w-4 h-4 text-brand" /> {t("admin.pricingSection")}
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t("admin.defaultRate")}</label>
              <Input data-testid="settings-default-rate" type="number" min="1" step="0.5" value={form.default_rate}
                onChange={(e) => setForm({ ...form, default_rate: e.target.value })}
                className="bg-navy-800 border-navy-600 h-11 num" />
              <p className="text-[11px] text-slate-500 mt-1">{t("admin.defaultRateNote")}</p>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t("admin.commissionPct")}</label>
              <div className="relative">
                <Percent className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <Input data-testid="settings-commission" type="number" min="1" max="50" value={form.commission_pct}
                  onChange={(e) => setForm({ ...form, commission_pct: e.target.value })}
                  className="bg-navy-800 border-navy-600 h-11 num pe-9" />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">{t("admin.commissionNote")}</p>
            </div>
          </div>
          <div className="bg-navy-800/60 rounded-xl p-4 border border-navy-600/40 text-xs text-slate-400" data-testid="settings-preview">
            {t("admin.preview")}: <span className="num">{sar(1000)}</span> → {t("admin.previewCommission")} <span className="num text-amber-400">{sar(1000 * (Number(form.commission_pct) || 0) / 100)}</span> ·
            {t("admin.previewDrivers")} <span className="num text-brand">{sar(1000 - 1000 * (Number(form.commission_pct) || 0) / 100)}</span>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> {t("admin.compensation")}
            </label>
            <Input data-testid="settings-compensation" type="number" min="0" max="100" value={form.compensation_pct}
              onChange={(e) => setForm({ ...form, compensation_pct: e.target.value })}
              className="bg-navy-800 border-navy-600 h-11 num max-w-xs" />
            <p className="text-[11px] text-slate-500 mt-1">{t("admin.compensationNote")}</p>
          </div>
        </div>

        <div className="card-surface p-6 space-y-4">
          <p className="font-heading font-bold flex items-center gap-2">
            <Car className="w-4 h-4 text-brand" /> {t("admin.vehiclesSection")}
          </p>
          <label className="text-xs text-slate-400 block">{t("admin.vehiclesNote")}</label>
          <Textarea data-testid="settings-vehicle-types" value={form.vehicle_types}
            onChange={(e) => setForm({ ...form, vehicle_types: e.target.value })}
            className="bg-navy-800 border-navy-600 min-h-[80px]" />
        </div>

        <div className="card-surface p-6 space-y-4">
          <p className="font-heading font-bold flex items-center gap-2">
            <MapPin className="w-4 h-4 text-brand" /> {t("admin.areasSection")}
          </p>
          <label className="text-xs text-slate-400 block">{t("admin.areasNote")}</label>
          <Textarea data-testid="settings-service-areas" value={form.service_areas}
            onChange={(e) => setForm({ ...form, service_areas: e.target.value })}
            className="bg-navy-800 border-navy-600 min-h-[100px]" />
        </div>

        <button data-testid="settings-save-btn" disabled={busy}
          className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-8 py-3 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors shadow-[0_0_25px_rgba(0,229,163,0.25)]">
          <Save className="w-4 h-4" /> {busy ? t("common.saving") : t("common.save")}
        </button>
      </form>
    </div>
  );
}
