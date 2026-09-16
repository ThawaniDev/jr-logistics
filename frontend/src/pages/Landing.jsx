import { Link } from "react-router-dom";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  ShieldCheck, Wallet, Users, Zap, ChevronLeft, Building2, UserCheck,
  MapPin, Clock, BadgeCheck, ArrowLeft, Star, ClipboardList,
} from "lucide-react";
import { SERVICES, DURATIONS, sar } from "@/lib/constants";

const HERO_IMG = "https://images.pexels.com/photos/4487383/pexels-photo-4487383.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.55, delay: i * 0.08 } }),
};

function Estimator() {
  const [serviceKey, setServiceKey] = useState("warehouse_worker");
  const [count, setCount] = useState(4);
  const [days, setDays] = useState(3);
  const svc = SERVICES.find((s) => s.key === serviceKey);
  const total =
    svc.unit === "shipment"
      ? svc.ref_rate * (count * 50)
      : svc.ref_rate * count * days;
  const commission = total * 0.1;
  return (
    <div className="glass rounded-2xl p-6 sm:p-8">
      <p className="text-brand text-sm font-semibold mb-1">حاسبة فورية</p>
      <h3 className="heading font-extrabold text-2xl mb-6">قدّر تكلفة طلبك في ثوانٍ</h3>
      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <label className="text-xs text-slate-400 block mb-2">نوع الخدمة</label>
          <select
            data-testid="est-service"
            value={serviceKey}
            onChange={(e) => setServiceKey(e.target.value)}
            className="w-full bg-navy-800 border border-navy-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand"
          >
            {SERVICES.map((s) => (
              <option key={s.key} value={s.key}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-2">
            {svc.unit === "shipment" ? "عدد السائقين" : svc.unit === "vehicle_day" ? "عدد السيارات" : "عدد العمال"}
          </label>
          <input
            data-testid="est-count"
            type="number" min="1" value={count}
            onChange={(e) => setCount(Math.max(1, Number(e.target.value)))}
            className="w-full bg-navy-800 border border-navy-600 rounded-xl px-3 py-2.5 text-sm num focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
        {svc.unit !== "shipment" && (
          <div>
            <label className="text-xs text-slate-400 block mb-2">عدد الأيام</label>
            <input
              data-testid="est-days"
              type="number" min="1" value={days}
              onChange={(e) => setDays(Math.max(1, Number(e.target.value)))}
              className="w-full bg-navy-800 border border-navy-600 rounded-xl px-3 py-2.5 text-sm num focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
        )}
      </div>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-navy-600/50 pt-5">
        <div>
          <p className="text-xs text-slate-400">التكلفة التقديرية الإجمالية</p>
          <p className="heading text-4xl font-black text-gradient-brand num" data-testid="est-total">{sar(total)}</p>
          <p className="text-[11px] text-slate-500 mt-1">
            تشمل عمولة المنصة {sar(commission)} — تُحجز في محفظتك ولا تُصرف إلا بعد إتمام العمل
          </p>
        </div>
        <Link
          to="/login"
          data-testid="est-cta"
          className="bg-brand text-navy-900 font-bold rounded-xl px-6 py-3 text-sm hover:bg-brand-hover transition-colors shadow-[0_0_25px_rgba(0,229,163,0.3)]"
        >
          أنشئ طلبك الآن
        </Link>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-navy-900 text-slate-100 overflow-x-hidden">
      <header className="fixed top-0 inset-x-0 z-50 glass border-x-0 border-t-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3" data-testid="landing-logo">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand to-cyan-500 flex items-center justify-center shadow-[0_0_18px_rgba(0,229,163,0.4)]">
              <span className="font-heading font-black text-navy-900">إ</span>
            </div>
            <span className="font-heading font-extrabold text-xl">إسناد</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-slate-300">
            <a href="#services" className="hover:text-brand transition-colors">الخدمات</a>
            <a href="#how" className="hover:text-brand transition-colors">كيف نعمل</a>
            <a href="#estimate" className="hover:text-brand transition-colors">حاسبة التكلفة</a>
            <a href="#join" className="hover:text-brand transition-colors">انضم إلينا</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/login" data-testid="landing-login-btn" className="text-sm text-slate-300 hover:text-brand transition-colors px-3 py-2">
              تسجيل الدخول
            </Link>
            <Link
              to="/login"
              data-testid="landing-start-btn"
              className="bg-brand text-navy-900 text-sm font-bold rounded-full px-5 py-2.5 hover:bg-brand-hover transition-colors shadow-[0_0_20px_rgba(0,229,163,0.35)]"
            >
              ابدأ الآن
            </Link>
          </div>
        </div>
      </header>

      <section className="relative pt-32 pb-20 px-4 sm:px-6 hero-grid">
        <div className="absolute inset-0 bg-gradient-to-b from-navy-900/40 via-navy-900/80 to-navy-900 pointer-events-none" />
        <div className="absolute -top-32 left-1/4 w-[480px] h-[480px] rounded-full bg-brand/10 blur-[140px] pointer-events-none" />
        <div className="absolute top-20 right-0 w-[380px] h-[380px] rounded-full bg-cyan-500/10 blur-[120px] pointer-events-none" />
        <div className="relative max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <motion.div variants={fadeUp} initial="hidden" animate="show" custom={0}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand/10 border border-brand/25 text-brand text-xs font-semibold mb-6">
              <span className="w-2 h-2 rounded-full bg-brand animate-pulse-soft" />
              منصة سعودية — السوق مفتوح الآن
            </motion.div>
            <motion.h1 variants={fadeUp} initial="hidden" animate="show" custom={1}
              className="heading text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.15] tracking-tight">
              أسنِد عملياتك اللوجستية
              <span className="block text-gradient-brand mt-2">للكفاءات الجاهزة فوراً</span>
            </motion.h1>
            <motion.p variants={fadeUp} initial="hidden" animate="show" custom={2}
              className="mt-6 text-slate-400 text-base sm:text-lg leading-relaxed max-w-xl">
              من سائقي التوصيل إلى طواقم المستودعات والفعاليات — أنشئ طلبك، استقبل المطابقات،
              أكّد الحضور، وادفع بأمان عبر محفظة ضمان. كل ذلك من منصة واحدة.
            </motion.p>
            <motion.div variants={fadeUp} initial="hidden" animate="show" custom={3} className="mt-8 flex flex-wrap gap-4">
              <Link to="/login" data-testid="hero-business-cta"
                className="group flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-2xl px-7 py-3.5 hover:bg-brand-hover transition-all shadow-[0_0_30px_rgba(0,229,163,0.3)]">
                <Building2 className="w-5 h-5" />
                أنا منشأة تحتاج موارد
                <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              </Link>
              <Link to="/login" data-testid="hero-worker-cta"
                className="flex items-center gap-2 border border-navy-600 bg-navy-800/60 text-slate-100 font-bold rounded-2xl px-7 py-3.5 hover:border-brand/50 hover:text-brand transition-all">
                <UserCheck className="w-5 h-5" />
                أنا عامل / مزود خدمة
              </Link>
            </motion.div>
            <motion.div variants={fadeUp} initial="hidden" animate="show" custom={4}
              className="mt-10 grid grid-cols-3 gap-4 max-w-md">
              {[["+9", "فئات خدمات"], ["10%", "عمولة شفافة"], ["24/7", "متابعة ودعم"]].map(([v, l]) => (
                <div key={l} className="card-surface p-3 text-center">
                  <p className="heading text-2xl font-black text-brand num">{v}</p>
                  <p className="text-[11px] text-slate-500 mt-1">{l}</p>
                </div>
              ))}
            </motion.div>
          </div>
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, delay: 0.2 }}
            className="relative hidden lg:block">
            <div className="rounded-3xl overflow-hidden border border-navy-600/60 shadow-2xl">
              <img src={HERO_IMG} alt="عمليات لوجستية" className="w-full h-[420px] object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-navy-900/90 via-transparent" />
            </div>
            <div className="absolute -bottom-5 right-6 glass rounded-2xl px-5 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand/15 border border-brand/30 flex items-center justify-center">
                <Zap className="w-5 h-5 text-brand" />
              </div>
              <div>
                <p className="text-sm font-bold">مطابقة فورية</p>
                <p className="text-[11px] text-slate-400">العامل المناسب يصله العرض خلال ثوانٍ</p>
              </div>
            </div>
            <div className="absolute -top-5 left-6 glass rounded-2xl px-5 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-bold">محفظة ضمان</p>
                <p className="text-[11px] text-slate-400">لا يُصرف المبلغ إلا بعد تأكيد الإنجاز</p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section id="services" className="py-20 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <p className="text-brand text-sm font-semibold text-center">منظومة خدمات متكاملة</p>
          <h2 className="heading text-3xl sm:text-4xl font-black text-center mt-2">كل ما تحتاجه عملياتك، في مكان واحد</h2>
          <p className="text-slate-400 text-center mt-3 max-w-2xl mx-auto text-sm sm:text-base">
            منصة واحدة تغطي كامل الطيف التشغيلي — النقل، المستودعات، والفعاليات
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-12">
            {SERVICES.map((s, i) => (
              <motion.div key={s.key} variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} custom={i % 3}
                data-testid={`service-card-${s.key}`}
                className="card-surface card-surface-hover p-6 group">
                <div className="w-12 h-12 rounded-2xl bg-brand/10 border border-brand/25 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <s.icon className="w-6 h-6 text-brand" />
                </div>
                <h3 className="heading font-bold text-lg">{s.name}</h3>
                <p className="text-sm text-slate-400 mt-2 leading-relaxed">{s.desc}</p>
                <p className="text-[11px] text-slate-500 mt-3">التسعير: {s.unit_label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="py-20 px-4 sm:px-6 bg-navy-850/50 border-y border-navy-600/40">
        <div className="max-w-7xl mx-auto">
          <p className="text-brand text-sm font-semibold text-center">دورة عمل محكمة</p>
          <h2 className="heading text-3xl sm:text-4xl font-black text-center mt-2">من الطلب إلى الدفع في أربع خطوات</h2>
          <div className="grid md:grid-cols-4 gap-5 mt-12">
            {[
              { icon: ClipboardList, t: "أنشئ طلبك", d: "حدّد الخدمة، العدد، الموقع، المدة والميزانية — وانشر الطلب فوراً" },
              { icon: Zap, t: "مطابقة فورية", d: "يصل العرض للعمال المتاحين المطابقين مع كامل التفاصيل قبل القبول" },
              { icon: BadgeCheck, t: "تأكيد وحضور", d: "أكّد العمال، احجز المبلغ في محفظة الضمان، وتتبّع الحضور لحظياً" },
              { icon: Wallet, t: "تسوية آمنة", d: "عند إتمام العمل تُصرف الأرباح للعامل تلقائياً بعد خصم العمولة" },
            ].map((s, i) => (
              <motion.div key={s.t} variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} custom={i}
                className="card-surface p-6 relative">
                <span className="absolute top-4 left-5 heading text-5xl font-black text-navy-700/60 num">{i + 1}</span>
                <div className="w-11 h-11 rounded-xl bg-brand/10 border border-brand/25 flex items-center justify-center mb-4">
                  <s.icon className="w-5 h-5 text-brand" />
                </div>
                <h3 className="heading font-bold">{s.t}</h3>
                <p className="text-sm text-slate-400 mt-2 leading-relaxed">{s.d}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="estimate" className="py-20 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <Estimator />
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            { icon: ShieldCheck, t: "محافظ ضمان", d: "أموالك محجوزة بأمان ولا تُصرف إلا بعد تأكيد إتمام العمل" },
            { icon: MapPin, t: "تغطية وطنية", d: "الرياض، جدة، الدمام، نيوم — وتوسّع مستمر في المناطق" },
            { icon: Clock, t: "استجابة سريعة", d: "مطابقة وإشعارات فورية عند نشر أي طلب جديد" },
            { icon: Star, t: "تقييمات موثوقة", d: "سجل أداء وتقييمات شفافة لكل منشأة ومزود خدمة" },
          ].map((f) => (
            <div key={f.t} className="card-surface p-5 flex gap-4">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-gold/10 border border-amber-500/25 flex items-center justify-center">
                <f.icon className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="font-heading font-bold text-sm">{f.t}</p>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">{f.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="join" className="py-20 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-6">
          <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
            className="card-surface card-surface-hover p-8 bg-gradient-to-bl from-brand/10 to-transparent">
            <Building2 className="w-10 h-10 text-brand mb-4" />
            <h3 className="heading text-2xl font-extrabold">للمنشآت والشركات</h3>
            <p className="text-slate-400 mt-3 text-sm leading-relaxed">
              مستودعك يحتاج طاقماً إضافياً؟ فعالية تحتاج منظمين؟ شحنات تحتاج مندوبين؟
              أنشئ طلبك بدقة، استقبل المرشحين، وتحكم كاملاً بالتأكيد والحضور والدفع.
            </p>
            <Link to="/login" data-testid="join-business-btn"
              className="inline-flex items-center gap-2 mt-6 bg-brand text-navy-900 font-bold rounded-xl px-6 py-3 text-sm hover:bg-brand-hover transition-colors">
              سجّل منشأتك <ArrowLeft className="w-4 h-4" />
            </Link>
          </motion.div>
          <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} custom={1}
            className="card-surface card-surface-hover p-8 bg-gradient-to-bl from-amber-500/10 to-transparent">
            <UserCheck className="w-10 h-10 text-amber-400 mb-4" />
            <h3 className="heading text-2xl font-extrabold">للعمال ومزودي الخدمة</h3>
            <p className="text-slate-400 mt-3 text-sm leading-relaxed">
              اختر خدماتك، فعّل حالة التوفر، واستقبل فرص عمل بتفاصيل كاملة قبل القبول.
              أرباحك تصل محفظتك فور تأكيد الإنجاز، واسحبها إلى حسابك البنكي.
            </p>
            <Link to="/login" data-testid="join-worker-btn"
              className="inline-flex items-center gap-2 mt-6 bg-amber-400 text-navy-900 font-bold rounded-xl px-6 py-3 text-sm hover:bg-amber-300 transition-colors">
              انضم كمزود خدمة <ArrowLeft className="w-4 h-4" />
            </Link>
          </motion.div>
        </div>
      </section>

      <footer className="border-t border-navy-600/40 py-10 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand to-cyan-500 flex items-center justify-center">
              <span className="font-heading font-black text-navy-900 text-sm">إ</span>
            </div>
            <div>
              <p className="font-heading font-bold">إسناد</p>
              <p className="text-[11px] text-slate-500">منصة سعودية للموارد اللوجستية والتشغيلية المؤقتة</p>
            </div>
          </div>
          <p className="text-xs text-slate-500 text-center">
            الرياض · جدة · الدمام · نيوم — جميع الأموال والبيانات في هذه النسخة تجريبية لأغراض العرض
          </p>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Users className="w-4 h-4 text-brand" />
            دعم رؤية السعودية 2030 لتمكين سوق العمل المرن
          </div>
        </div>
      </footer>
    </div>
  );
}
