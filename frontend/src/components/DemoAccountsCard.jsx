import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Building2,
  Bike,
  Building,
  ShieldCheck,
  Users,
  Zap,
  ArrowRight,
  Phone,
  Mail,
  Sparkles,
} from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { roleHome } from "@/lib/constants";

const ROLE_TABS = [
  { key: "business", label: "المنشآت", icon: Building2, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" },
  { key: "worker", label: "المناديب", icon: Bike, color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30" },
  { key: "office", label: "مكاتب التوصيل", icon: Building, color: "text-amber-400 bg-amber-500/10 border-amber-500/30" },
  { key: "admin", label: "الإدارة", icon: ShieldCheck, color: "text-purple-400 bg-purple-500/10 border-purple-500/30" },
  { key: "staff", label: "الموظفون", icon: Users, color: "text-blue-400 bg-blue-500/10 border-blue-500/30" },
];

export default function DemoAccountsCard({ onSelectPhone, className = "" }) {
  const [activeTab, setActiveTab] = useState("business");
  const [accounts, setAccounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loggingIn, setLoggingIn] = useState(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    api
      .get("/auth/demo-accounts")
      .then(({ data }) => {
        if (mounted) setAccounts(data.demo_accounts);
      })
      .catch((err) => {
        console.error("Failed to fetch demo accounts", err);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleInstantLogin = async (acc) => {
    setLoggingIn(acc._id);
    try {
      const { data } = await api.post("/auth/demo-login", { user_id: acc._id });
      login(data.token, data.user);
      toast.success(`مرحباً بك، ${data.user.name}`);
      navigate(roleHome(data.user.role));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setLoggingIn(null);
    }
  };

  const currentAccounts = accounts ? accounts[activeTab] || [] : [];

  return (
    <div
      className={`glass rounded-3xl p-6 border border-brand/20 bg-navy-800/90 shadow-[0_0_35px_rgba(0,229,163,0.08)] ${className}`}
      data-testid="demo-accounts-panel"
    >
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-navy-700/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-brand/15 border border-brand/30 flex items-center justify-center text-brand">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-heading font-extrabold text-base text-white flex items-center gap-2">
              حسابات العرض التجريبي
              <span className="text-[10px] font-sans px-2 py-0.5 rounded-full bg-brand/20 text-brand border border-brand/40">
                جاهزة للدخول
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              اختر أي حساب لتسجيل الدخول الفوري وتجربة النظام من منظوره
            </p>
          </div>
        </div>
      </div>

      {/* Role Tabs */}
      <div className="flex gap-1.5 p-1 bg-navy-900/80 rounded-2xl border border-navy-700 mb-4 overflow-x-auto no-scrollbar">
        {ROLE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          const count = accounts?.[tab.key]?.length || 0;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              data-testid={`demo-tab-${tab.key}`}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-200 ${
                isActive
                  ? "bg-brand text-navy-950 shadow-md font-bold"
                  : "text-slate-400 hover:text-slate-200 hover:bg-navy-800/50"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {count > 0 && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    isActive ? "bg-navy-950/20 text-navy-950 font-black" : "bg-navy-800 text-slate-400"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Accounts List */}
      <div className="space-y-2.5 min-h-[220px]">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400 text-xs gap-2">
            <span className="inline-block w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            جاري تحميل الحسابات التجريبية...
          </div>
        ) : currentAccounts.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-xs">
            لا توجد حسابات متاحة في هذا التصنيف حالياً
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-2.5"
            >
              {currentAccounts.map((acc) => {
                const isLogging = loggingIn === acc._id;
                return (
                  <div
                    key={acc._id}
                    data-testid={`demo-card-${acc._id}`}
                    className="p-3.5 rounded-2xl bg-navy-900/70 border border-navy-700/70 hover:border-brand/40 hover:bg-navy-900 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-navy-800 border border-navy-600 flex items-center justify-center text-brand font-bold text-sm shrink-0">
                        {acc.name ? acc.name.charAt(0) : "U"}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-sm text-slate-100 group-hover:text-brand transition-colors">
                            {acc.title || acc.name}
                          </h4>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-navy-800 text-slate-300 border border-navy-600/50">
                            {acc.badge}
                          </span>
                        </div>
                        {acc.subtitle && (
                          <p className="text-xs text-slate-400 mt-0.5">{acc.subtitle}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] text-slate-500">
                          {acc.phone && (
                            <span className="flex items-center gap-1 font-mono text-slate-400" dir="ltr">
                              <Phone className="w-3 h-3 text-slate-500" />
                              {acc.phone}
                            </span>
                          )}
                          {acc.email && (
                            <span className="flex items-center gap-1 text-slate-400">
                              <Mail className="w-3 h-3 text-slate-500" />
                              {acc.email}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      {onSelectPhone && acc.phone && (
                        <button
                          type="button"
                          onClick={() => onSelectPhone(acc.phone)}
                          data-testid={`prefill-btn-${acc._id}`}
                          className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-brand bg-navy-800/80 hover:bg-navy-700 rounded-xl border border-navy-600 transition-colors"
                          title="تعبئة الرقم في النموذج لتجربة رمز التحقق"
                        >
                          تعبئة
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isLogging}
                        onClick={() => handleInstantLogin(acc)}
                        data-testid={`instant-login-btn-${acc._id}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-brand text-navy-950 hover:bg-brand-hover rounded-xl shadow-md transition-all disabled:opacity-50"
                      >
                        {isLogging ? (
                          <span className="inline-block w-3.5 h-3.5 border-2 border-navy-950 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Zap className="w-3.5 h-3.5" />
                        )}
                        <span>دخول فوري</span>
                        <ArrowRight className="w-3 h-3 rtl:rotate-180" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-navy-700/60 flex items-center justify-between text-[11px] text-slate-500">
        <span>كلمة مرور المشرفين والموظفين:</span>
        <code className="text-amber-400 bg-navy-900/80 px-2 py-0.5 rounded border border-navy-700 font-mono" dir="ltr">
          Isnad-Dev-Staff-2026!
        </code>
      </div>
    </div>
  );
}
