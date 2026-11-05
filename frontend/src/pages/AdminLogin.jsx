import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { ShieldCheck, Mail, Lock, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";
import { roleHome } from "@/lib/constants";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function AdminLogin() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return toast.error(t("adminAuth.errMissing"));
    setBusy(true);
    try {
      const { data } = await api.post("/auth/admin/login", { email, password });
      login(data.token, data.user);
      toast.success(data.user.name);
      navigate(roleHome(data.user.role));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-navy-950 text-slate-100 flex items-center justify-center px-4 hero-grid relative">
      <div className="absolute -top-24 start-1/3 w-96 h-96 rounded-full bg-brand/10 blur-[130px] pointer-events-none" />
      <div className="absolute top-4 end-4 z-10">
        <LanguageSwitcher />
      </div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="w-full max-w-md">
        <Link to="/" className="flex items-center justify-center gap-3 mb-8" data-testid="admin-login-logo">
          <img src="/assets/jr-logo-mark.png" alt="JR Logistics" className="w-11 h-11 rounded-xl object-cover shadow-[0_0_25px_rgba(0,229,163,0.4)]" />
          <span className="font-heading font-extrabold text-2xl">JR Logistics</span>
        </Link>
        <form onSubmit={submit} className="glass rounded-3xl p-8 space-y-5" data-testid="admin-login-form">
          <div className="flex items-center gap-3 mb-2">
            <ShieldCheck className="w-6 h-6 text-brand shrink-0" />
            <div>
              <h1 className="heading font-extrabold text-xl">{t("adminAuth.title")}</h1>
              <p className="text-xs text-slate-400 mt-0.5">{t("adminAuth.sub")}</p>
            </div>
          </div>
          <div>
            <label className="text-sm text-slate-300 block mb-2">{t("adminAuth.email")}</label>
            <div className="relative">
              <Mail className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                data-testid="admin-email-input"
                dir="ltr" type="email" autoComplete="username"
                placeholder="admin@example.com / +9665..."
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pe-10 h-12 bg-navy-800 border-navy-600 text-left"
              />
            </div>
          </div>
          <div>
            <label className="text-sm text-slate-300 block mb-2">{t("adminAuth.password")}</label>
            <div className="relative">
              <Lock className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                data-testid="admin-password-input"
                dir="ltr" type="password" autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pe-10 h-12 bg-navy-800 border-navy-600 text-left"
              />
            </div>
          </div>
          <button
            data-testid="admin-login-btn"
            disabled={busy}
            className="w-full h-12 bg-brand text-navy-900 font-bold rounded-xl hover:bg-brand-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? t("adminAuth.signingIn") : t("adminAuth.signIn")}
          </button>
          <div className="pt-2 border-t border-navy-700/60">
            <p className="text-[11px] text-slate-400 mb-2 font-semibold">حسابات تجريبية للإدارة والموظفين (تعبئة سريعة):</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "مدير المنصة", email: "admin@isnad.sa", pw: "Isnad-Dev-Admin-2026!" },
                { label: "نائب المدير", email: "ops-admin@isnad.sa", pw: "Isnad-Dev-Admin-2026!" },
                { label: "أمل (دعم)", email: "amal@isnad.sa", pw: "Isnad-Dev-Staff-2026!" },
                { label: "بدر (عمليات)", email: "bader@isnad.sa", pw: "Isnad-Dev-Staff-2026!" },
                { label: "سارة (مالية)", email: "sara@isnad.sa", pw: "Isnad-Dev-Staff-2026!" },
              ].map((adm) => (
                <button
                  key={adm.email}
                  type="button"
                  onClick={() => {
                    setEmail(adm.email);
                    setPassword(adm.pw);
                  }}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-navy-800 hover:bg-navy-700 text-slate-300 hover:text-brand border border-navy-600 transition-colors"
                >
                  {adm.label}
                </button>
              ))}
            </div>
          </div>
          <Link to="/login" data-testid="admin-back-to-user-login"
            className="flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-brand transition-colors">
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" /> {t("adminAuth.backToUser")}
          </Link>
        </form>
        <p className="text-center text-[11px] text-slate-600 mt-6">{t("adminAuth.restricted")}</p>
      </motion.div>
    </div>
  );
}
