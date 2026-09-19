import { useState } from "react";
import { toast } from "sonner";
import { Building2, Save, BadgeCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";
import { CITIES } from "@/lib/constants";
import { OnboardingBanner } from "@/components/OnboardingBanner";

export default function BusinessProfile() {
  const { t, lang, setLang, LANGS } = useI18n();
  const { user, setUser } = useAuth();
  const bp = user?.business_profile || {};
  const [form, setForm] = useState({
    name: user?.name || "", email: user?.email || "", city: user?.city || "",
    company_name: bp.company_name || "", cr_number: bp.cr_number || "", industry: bp.industry || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.patch("/profile", { ...form, language: lang });
      setUser(data.user);
      toast.success(t("profile.saved"));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6" data-testid="business-profile-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("profile.titleB")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("profile.subB")}</p>
      </div>
      <OnboardingBanner profilePath="/app/business/profile" />
      <form onSubmit={save} className="card-surface p-6 space-y-4">
        <div className="flex items-center gap-3 pb-4 border-b border-navy-600/40">
          <div className="w-12 h-12 rounded-2xl bg-brand/10 border border-brand/25 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-brand" />
          </div>
          <div>
            <p className="font-heading font-bold">{bp.company_name || user?.name}</p>
            <p className="text-xs text-slate-500 num">{user?.phone}</p>
          </div>
          {bp.rating && (
            <span className="ms-auto chip bg-amber-500/10 text-amber-400 border-amber-500/30">
              <BadgeCheck className="w-3.5 h-3.5" /> {t("profile.rating")} <span className="num">{bp.rating}</span> (<span className="num">{bp.rating_count}</span>)
            </span>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("profile.ownerName")}</label>
            <Input data-testid="profile-name" value={form.name} onChange={set("name")} className="bg-navy-800 border-navy-600 h-11" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("common.email")}</label>
            <Input data-testid="profile-email" dir="ltr" type="email" value={form.email} onChange={set("email")} className="bg-navy-800 border-navy-600 h-11 text-left" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("profile.companyName")}</label>
            <Input data-testid="profile-company" value={form.company_name} onChange={set("company_name")} className="bg-navy-800 border-navy-600 h-11" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("profile.crNumber")}</label>
            <Input data-testid="profile-cr" dir="ltr" value={form.cr_number} onChange={set("cr_number")} className="bg-navy-800 border-navy-600 h-11 text-left" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("profile.industry")}</label>
            <Input data-testid="profile-industry" value={form.industry} onChange={set("industry")} className="bg-navy-800 border-navy-600 h-11" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("common.city")}</label>
            <select data-testid="profile-city" value={form.city} onChange={set("city")}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
              {CITIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("profile.language")}</label>
            <select data-testid="profile-language" value={lang} onChange={(e) => setLang(e.target.value)}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">{t("profile.languageNote")}</p>
          </div>
        </div>
        <button data-testid="profile-save-btn" disabled={busy}
          className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-6 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
          <Save className="w-4 h-4" /> {busy ? t("common.saving") : t("common.save")}
        </button>
      </form>
    </div>
  );
}
