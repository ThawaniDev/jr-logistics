import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { ShieldCheck, Phone, ArrowRight, KeyRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";
import { roleHome } from "@/lib/constants";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function Login() {
  const { t } = useI18n();
  const [step, setStep] = useState("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [demoOtp, setDemoOtp] = useState(null);
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const sendOtp = async (e) => {
    e?.preventDefault();
    if (!phone.trim()) return toast.error(t("auth.phoneLabel"));
    setBusy(true);
    try {
      const { data } = await api.post("/auth/otp/send", { phone });
      setPhone(data.phone);
      setDemoOtp(data.demo_otp);
      setStep("otp");
      toast.success(t("auth.sendOtp"));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e?.preventDefault();
    if (code.length !== 4) return toast.error("OTP");
    setBusy(true);
    try {
      const { data } = await api.post("/auth/otp/verify", { phone, code });
      if (data.is_new) {
        sessionStorage.setItem("isnad_reg_token", data.registration_token);
        sessionStorage.setItem("isnad_reg_phone", data.phone);
        navigate("/register");
        return;
      }
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
    <div className="min-h-screen bg-navy-900 text-slate-100 flex items-center justify-center px-4 hero-grid relative">
      <div className="absolute -top-24 start-1/3 w-96 h-96 rounded-full bg-brand/10 blur-[130px] pointer-events-none" />
      <div className="absolute top-4 end-4 z-10">
        <LanguageSwitcher />
      </div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="w-full max-w-md">
        <Link to="/" className="flex items-center justify-center gap-3 mb-8" data-testid="login-logo">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand to-cyan-500 flex items-center justify-center shadow-[0_0_25px_rgba(0,229,163,0.4)]">
            <span className="font-heading font-black text-navy-900 text-xl">إ</span>
          </div>
          <span className="font-heading font-extrabold text-2xl">إسناد</span>
        </Link>
        <div className="glass rounded-3xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <ShieldCheck className="w-6 h-6 text-brand shrink-0" />
            <div>
              <h1 className="heading font-extrabold text-xl">{t("auth.loginTitle")}</h1>
              <p className="text-xs text-slate-400 mt-0.5">{t("auth.loginSub")}</p>
            </div>
          </div>
          <AnimatePresence mode="wait">
            {step === "phone" ? (
              <motion.form key="phone" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                onSubmit={sendOtp} className="space-y-5">
                <div>
                  <label className="text-sm text-slate-300 block mb-2">{t("auth.phoneLabel")}</label>
                  <div className="relative">
                    <Phone className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      data-testid="login-phone-input"
                      dir="ltr"
                      placeholder="+966 5X XXX XXXX"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="pe-10 h-12 bg-navy-800 border-navy-600 text-left"
                    />
                  </div>
                </div>
                <button
                  data-testid="login-send-otp-btn"
                  disabled={busy}
                  className="w-full h-12 bg-brand text-navy-900 font-bold rounded-xl hover:bg-brand-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {busy ? t("auth.sending") : t("auth.sendOtp")}
                  <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                </button>
                <p className="text-[11px] text-slate-500 text-center leading-relaxed">{t("auth.demoMode")}</p>
              </motion.form>
            ) : (
              <motion.form key="otp" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                onSubmit={verify} className="space-y-5">
                <p className="text-sm text-slate-300 text-center">
                  {t("auth.otpTo")} <span className="num text-brand font-semibold">{phone}</span>
                </p>
                {demoOtp && (
                  <div data-testid="demo-otp-banner" className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-center">
                    <p className="text-[11px] text-amber-400/80">{t("auth.demoMode")}</p>
                    <p className="heading text-2xl font-black text-amber-400 num tracking-[0.4em]" data-testid="demo-otp-code">{demoOtp}</p>
                  </div>
                )}
                <div dir="ltr" className="flex justify-center">
                  <InputOTP maxLength={4} value={code} onChange={setCode} data-testid="otp-code-input">
                    <InputOTPGroup>
                      {[0, 1, 2, 3].map((i) => (
                        <InputOTPSlot key={i} index={i} data-testid={`otp-slot-${i}`} className="w-14 h-14 text-xl border-navy-600 bg-navy-800" />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <button
                  data-testid="login-verify-btn"
                  disabled={busy}
                  className="w-full h-12 bg-brand text-navy-900 font-bold rounded-xl hover:bg-brand-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <KeyRound className="w-4 h-4" />
                  {busy ? t("auth.verifying") : t("auth.verify")}
                </button>
                <button type="button" onClick={() => { setStep("phone"); setCode(""); }}
                  data-testid="login-back-btn"
                  className="w-full text-sm text-slate-400 hover:text-brand transition-colors">
                  {t("auth.changeNumber")}
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
        <p className="text-center text-xs text-slate-500 mt-6">{t("auth.noAccount")}</p>
      </motion.div>
    </div>
  );
}
