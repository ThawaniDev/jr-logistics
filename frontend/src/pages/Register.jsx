import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Building2, UserCheck, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";
import { ACTIVE_SERVICES, roleHome, DEFAULT_VEHICLE_TYPES } from "@/lib/constants";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function Register() {
  const { t } = useI18n();
  const [token, setToken] = useState(null);
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", city: "", company_name: "", cr_number: "", industry: "", national_id: "", vehicle_type: "" });
  const [services, setServices] = useState(["delivery_driver"]);
  const [vehicleTypes, setVehicleTypes] = useState(DEFAULT_VEHICLE_TYPES);
  const [serviceAreas, setServiceAreas] = useState([]);
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/catalog/defaults").then(({ data }) => {
      if (data.vehicle_types?.length) setVehicleTypes(data.vehicle_types);
      if (data.service_areas?.length) {
        setServiceAreas(data.service_areas);
        setForm((f) => ({ ...f, city: f.city || data.service_areas[0] }));
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const tok = sessionStorage.getItem("isnad_reg_token");
    if (!tok) {
      navigate("/login");
      return;
    }
    setToken(tok);
    setPhone(sessionStorage.getItem("isnad_reg_phone") || "");
  }, [navigate]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggleService = (key) =>
    setServices((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));

  const submit = async (e) => {
    e.preventDefault();
    if (!role) return toast.error(t("auth.errRole"));
    if (!form.name.trim()) return toast.error(t("auth.errName"));
    if (role === "business" && !form.company_name.trim()) return toast.error(t("auth.errCompany"));
    if (role === "worker" && services.length === 0) return toast.error(t("auth.errServices"));
    setBusy(true);
    try {
      const { data } = await api.post("/auth/register", {
        registration_token: token,
        role,
        name: form.name,
        email: form.email || null,
        city: form.city,
        company_name: form.company_name || null,
        cr_number: form.cr_number || null,
        industry: form.industry || null,
        national_id: form.national_id || null,
        vehicle_type: form.vehicle_type || null,
        services,
      });
      sessionStorage.removeItem("isnad_reg_token");
      sessionStorage.removeItem("isnad_reg_phone");
      login(data.token, data.user);
      toast.success(t("auth.regSuccess"));
      navigate(roleHome(data.user.role));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (!token) return null;

  const roles = [
    { key: "business", icon: Building2, title: t("auth.business"), desc: t("auth.businessDesc") },
    { key: "worker", icon: UserCheck, title: t("auth.driver"), desc: t("auth.driverDesc") },
  ];

  return (
    <div className="min-h-screen bg-navy-900 text-slate-100 px-4 py-10 hero-grid">
      <div className="absolute top-4 end-4 z-10">
        <LanguageSwitcher />
      </div>
      <div className="max-w-2xl mx-auto">
        <Link to="/login" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-brand mb-6" data-testid="register-back">
          <ArrowLeft className="w-4 h-4 rtl:rotate-180" /> {t("auth.backToLogin")}
        </Link>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="heading text-3xl font-black">{t("auth.regTitle")}</h1>
          <p className="text-slate-400 text-sm mt-2">
            <span className="num text-brand font-semibold">{phone}</span> — {t("auth.regVerified")}
          </p>

          <div className="grid grid-cols-2 gap-4 mt-8">
            {roles.map((r) => (
              <button
                key={r.key}
                type="button"
                data-testid={`register-role-${r.key}`}
                onClick={() => setRole(r.key)}
                className={`card-surface p-5 text-start transition-all ${
                  role === r.key ? "border-brand/60 bg-brand/5 shadow-[0_0_25px_rgba(0,229,163,0.1)]" : "hover:border-navy-600"
                }`}
              >
                <r.icon className={`w-7 h-7 mb-3 ${role === r.key ? "text-brand" : "text-slate-500"}`} />
                <p className="font-heading font-bold">{r.title}</p>
                <p className="text-xs text-slate-500 mt-1">{r.desc}</p>
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="card-surface p-6 mt-6 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">{role === "business" ? t("auth.ownerName") : t("auth.fullName")} *</label>
                <Input data-testid="register-name" value={form.name} onChange={set("name")} className="bg-navy-800 border-navy-600 h-11" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">{t("auth.optionalEmail")}</label>
                <Input data-testid="register-email" dir="ltr" type="email" value={form.email} onChange={set("email")} className="bg-navy-800 border-navy-600 h-11 text-left" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">{t("common.city")}</label>
                <select data-testid="register-city" value={form.city} onChange={set("city")}
                  className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
                  {serviceAreas.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              {role === "business" && (
                <>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">{t("auth.companyName")} *</label>
                    <Input data-testid="register-company" value={form.company_name} onChange={set("company_name")} className="bg-navy-800 border-navy-600 h-11" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">{t("auth.crNumber")}</label>
                    <Input data-testid="register-cr" dir="ltr" value={form.cr_number} onChange={set("cr_number")} className="bg-navy-800 border-navy-600 h-11 text-left" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">{t("auth.industry")}</label>
                    <Input data-testid="register-industry" value={form.industry} onChange={set("industry")} placeholder={t("auth.industryPh")} className="bg-navy-800 border-navy-600 h-11" />
                  </div>
                </>
              )}
              {role === "worker" && (
                <>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">{t("auth.nationalId")}</label>
                    <Input data-testid="register-national-id" dir="ltr" value={form.national_id} onChange={set("national_id")} className="bg-navy-800 border-navy-600 h-11 text-left" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">{t("auth.vehicleType")}</label>
                    <select data-testid="register-vehicle" value={form.vehicle_type} onChange={set("vehicle_type")}
                      className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
                      <option value="">{t("auth.choose")}</option>
                      {vehicleTypes.map((v) => <option key={v}>{v}</option>)}
                    </select>
                  </div>
                </>
              )}
            </div>
            {role === "worker" && (
              <div>
                <label className="text-xs text-slate-400 block mb-2">{t("auth.yourService")} *</label>
                <div className="flex flex-wrap gap-2" data-testid="register-services">
                  {ACTIVE_SERVICES.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      data-testid={`register-service-${s.key}`}
                      onClick={() => toggleService(s.key)}
                      className={`chip transition-all ${
                        services.includes(s.key)
                          ? "bg-brand/15 text-brand border-brand/40"
                          : "bg-navy-800 text-slate-400 border-navy-600 hover:border-slate-500"
                      }`}
                    >
                      <s.icon className="w-3.5 h-3.5" />
                      {t(`svc.${s.key}_short`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              data-testid="register-submit-btn"
              disabled={busy || !role}
              className="w-full h-12 bg-brand text-navy-900 font-bold rounded-xl hover:bg-brand-hover transition-colors disabled:opacity-50"
            >
              {busy ? t("auth.creating") : t("auth.createAccount")}
            </button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
