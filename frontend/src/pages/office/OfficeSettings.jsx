import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Settings, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";

export default function OfficeSettings() {
  const { t } = useI18n();
  const { user, refresh } = useAuth();
  const [form, setForm] = useState({ company_name: "", responsible_person: "", email: "", city: "", address: "", bank_name: "", iban: "", tax_number: "", compliance_notes: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const op = user?.office_profile || {};
    setForm({
      company_name: op.office_name || "", responsible_person: op.responsible_person || user?.name || "",
      email: user?.email || "", city: op.city || user?.city || "", address: op.address || "",
      bank_name: op.bank_name || "", iban: op.iban || "", tax_number: op.tax_number || "",
      compliance_notes: op.compliance_notes || "",
    });
  }, [user]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch("/profile", form);
      toast.success(t("office.settingsSaved"));
      refresh();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="office-settings-page">
      <div>
        <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
          <Settings className="w-6 h-6 text-brand" /> {t("office.settings")}
        </h1>
        <p className="text-sm text-slate-400 mt-1">{t("office.settingsSub")}</p>
      </div>
      <form onSubmit={save} className="card-surface p-6 space-y-5" data-testid="office-settings-form">
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="text-xs text-slate-400 block mb-1.5">{t("office.officeName")}</label><Input data-testid="office-settings-name" value={form.company_name} onChange={set("company_name")} className="bg-navy-800 border-navy-600 h-11" /></div>
          <div><label className="text-xs text-slate-400 block mb-1.5">{t("office.responsiblePerson")}</label><Input data-testid="office-settings-responsible" value={form.responsible_person} onChange={set("responsible_person")} className="bg-navy-800 border-navy-600 h-11" /></div>
          <div><label className="text-xs text-slate-400 block mb-1.5">{t("common.email")}</label><Input data-testid="office-settings-email" dir="ltr" type="email" value={form.email} onChange={set("email")} className="bg-navy-800 border-navy-600 h-11 text-left" /></div>
          <div><label className="text-xs text-slate-400 block mb-1.5">{t("common.city")}</label><Input data-testid="office-settings-city" value={form.city} onChange={set("city")} className="bg-navy-800 border-navy-600 h-11" /></div>
          <div className="sm:col-span-2"><label className="text-xs text-slate-400 block mb-1.5">{t("office.fullAddress")}</label><Input data-testid="office-settings-address" value={form.address} onChange={set("address")} className="bg-navy-800 border-navy-600 h-11" /></div>
          <div><label className="text-xs text-slate-400 block mb-1.5">{t("office.bankName")}</label><Input data-testid="office-settings-bank" value={form.bank_name} onChange={set("bank_name")} className="bg-navy-800 border-navy-600 h-11" /></div>
          <div><label className="text-xs text-slate-400 block mb-1.5">{t("office.iban")}</label><Input data-testid="office-settings-iban" dir="ltr" value={form.iban} onChange={set("iban")} className="bg-navy-800 border-navy-600 h-11 text-left" /></div>
          <div><label className="text-xs text-slate-400 block mb-1.5">{t("office.taxNumber")}</label><Input data-testid="office-settings-tax" dir="ltr" value={form.tax_number} onChange={set("tax_number")} className="bg-navy-800 border-navy-600 h-11 text-left" /></div>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">{t("office.complianceNotes")}</label>
          <Textarea data-testid="office-settings-compliance" value={form.compliance_notes} onChange={set("compliance_notes")} className="bg-navy-800 border-navy-600 min-h-[100px]" />
        </div>
        <button disabled={busy} data-testid="office-settings-save"
          className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-6 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
          <Save className="w-4 h-4" /> {busy ? t("common.saving") : t("common.save")}
        </button>
      </form>
    </div>
  );
}
