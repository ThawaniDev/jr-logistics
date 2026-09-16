import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronRight, ChevronLeft, Check, Rocket } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import api, { errMsg } from "@/lib/api";
import { ACTIVE_SERVICES, SERVICE_MAP, DURATIONS, CITIES, sar } from "@/lib/constants";

const STEPS = ["نوع الخدمة", "التفاصيل والتسعير", "الموقع والجدولة", "المراجعة والنشر"];

export default function RequestNew() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    service_type: "delivery_driver", title: "", required_count: 1, rate: 7,
    duration_type: "one_day", days_count: 2, shipments_per_driver: "",
    vehicle_type: "", city: "الرياض", address: "", start_date: "", start_time: "08:00", requirements: "",
  });
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const svc = form.service_type ? SERVICE_MAP[form.service_type] : null;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const durationDays = useMemo(() => {
    if (form.duration_type === "several_days") return Math.max(1, Number(form.days_count) || 1);
    return DURATIONS.find((d) => d.key === form.duration_type)?.days || 1;
  }, [form.duration_type, form.days_count]);

  const estimate = useMemo(() => {
    if (!svc || !form.rate) return null;
    const total = svc.has_shipments
      ? Number(form.rate) * (Number(form.shipments_per_driver) || 0) * Number(form.required_count || 0)
      : Number(form.rate) * Number(form.required_count || 0) * durationDays;
    return { total, commission: total * 0.1, payout: total * 0.9 };
  }, [svc, form.rate, form.shipments_per_driver, form.required_count, durationDays]);

  const next = () => {
    if (step === 0 && !form.service_type) return toast.error("اختر نوع الخدمة");
    if (step === 1) {
      if (!form.rate || Number(form.rate) <= 0) return toast.error("أدخل السعر");
      if (form.required_count < 1) return toast.error("أدخل العدد المطلوب");
      if (svc?.has_shipments && !form.shipments_per_driver) return toast.error("أدخل الشحنات المتوقعة لكل مندوب");
      if (svc?.needs_vehicle && !form.vehicle_type.trim()) return toast.error("حدد نوع المركبة المطلوبة");
    }
    if (step === 2 && (!form.address.trim() || !form.start_date)) return toast.error("أكمل الموقع والتاريخ");
    setStep((s) => s + 1);
  };

  const publish = async () => {
    setBusy(true);
    try {
      const payload = {
        ...form,
        required_count: Number(form.required_count),
        rate: Number(form.rate),
        days_count: Number(form.days_count),
        shipments_per_driver: form.shipments_per_driver ? Number(form.shipments_per_driver) : null,
        title: form.title || null,
        vehicle_type: form.vehicle_type || null,
        requirements: form.requirements || null,
      };
      const { data } = await api.post("/business/requests", payload);
      toast.success(`تم نشر الطلب — أُرسل لـ ${data.matched_workers} عامل مطابق`);
      navigate(`/app/business/requests/${data.request._id}`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6" data-testid="request-new-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">طلب خدمة جديد</h1>
        <p className="text-sm text-slate-400 mt-1">حدّد احتياجك بدقة وسيصل للمطابقين المتاحين فوراً</p>
      </div>

      <div className="flex items-center gap-1" data-testid="wizard-steps">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1 flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border transition-all ${
              i < step ? "bg-brand text-navy-900 border-brand" : i === step ? "border-brand text-brand" : "border-navy-600 text-slate-500"
            }`}>
              {i < step ? <Check className="w-4 h-4" /> : <span className="num">{i + 1}</span>}
            </div>
            <p className={`text-[11px] hidden sm:block ${i === step ? "text-brand font-semibold" : "text-slate-500"}`}>{s}</p>
            {i < STEPS.length - 1 && <div className={`flex-1 h-px mx-2 ${i < step ? "bg-brand" : "bg-navy-600"}`} />}
          </div>
        ))}
      </div>

      <div className="card-surface p-6">
        {step === 0 && (
          <div className="grid sm:grid-cols-2 gap-3" data-testid="step-service">
            {ACTIVE_SERVICES.map((s) => (
              <button key={s.key} type="button" data-testid={`pick-service-${s.key}`}
                onClick={() => setForm({ ...form, service_type: s.key, rate: s.ref_rate })}
                className={`p-4 rounded-xl border text-right transition-all flex items-start gap-3 ${
                  form.service_type === s.key
                    ? "border-brand/60 bg-brand/5 shadow-[0_0_20px_rgba(0,229,163,0.08)]"
                    : "border-navy-600 bg-navy-800/40 hover:border-slate-500"
                }`}>
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${
                  form.service_type === s.key ? "bg-brand/15 border-brand/40" : "bg-navy-700 border-navy-600"
                }`}>
                  <s.icon className={`w-5 h-5 ${form.service_type === s.key ? "text-brand" : "text-slate-400"}`} />
                </div>
                <div>
                  <p className="font-semibold text-sm">{s.name}</p>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{s.desc}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 1 && svc && (
          <div className="space-y-4" data-testid="step-details">
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">عنوان الطلب (اختياري)</label>
              <Input data-testid="req-title" value={form.title} onChange={set("title")} placeholder={svc.name} className="bg-navy-800 border-navy-600 h-11" />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">عدد المندوبين المطلوب *</label>
                <Input data-testid="req-count" type="number" min="1" value={form.required_count} onChange={set("required_count")} className="bg-navy-800 border-navy-600 h-11 num" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">السعر المعروض ({svc.unit_label}) * — ر.س</label>
                <Input data-testid="req-rate" type="number" min="1" value={form.rate} onChange={set("rate")} className="bg-navy-800 border-navy-600 h-11 num" />
              </div>
              {svc.has_shipments && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">الشحنات المتوقعة لكل مندوب *</label>
                  <Input data-testid="req-shipments" type="number" min="1" value={form.shipments_per_driver} onChange={set("shipments_per_driver")} className="bg-navy-800 border-navy-600 h-11 num" />
                </div>
              )}
              {svc.needs_vehicle && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">نوع المركبة المطلوبة *</label>
                  <Input data-testid="req-vehicle" value={form.vehicle_type} onChange={set("vehicle_type")} placeholder="مثال: دراجة نارية، سيارة، فان صغير" className="bg-navy-800 border-navy-600 h-11" />
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-2">المدة</label>
              <div className="flex flex-wrap gap-2" data-testid="req-durations">
                {DURATIONS.map((d) => (
                  <button key={d.key} type="button" data-testid={`duration-${d.key}`}
                    onClick={() => setForm({ ...form, duration_type: d.key })}
                    className={`chip ${form.duration_type === d.key ? "bg-brand/15 text-brand border-brand/40" : "bg-navy-800 text-slate-400 border-navy-600"}`}>
                    {d.label}
                  </button>
                ))}
              </div>
              {form.duration_type === "several_days" && (
                <div className="mt-3 max-w-[200px]">
                  <label className="text-xs text-slate-400 block mb-1.5">عدد الأيام</label>
                  <Input data-testid="req-days" type="number" min="1" value={form.days_count} onChange={set("days_count")} className="bg-navy-800 border-navy-600 h-11 num" />
                </div>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4" data-testid="step-location">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">المدينة *</label>
                <select data-testid="req-city" value={form.city} onChange={set("city")}
                  className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
                  {CITIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">منطقة الخدمة (الأحياء / النطاق) *</label>
                <Input data-testid="req-address" value={form.address} onChange={set("address")} placeholder="مثال: العليا، النرجس، الياسمين" className="bg-navy-800 border-navy-600 h-11" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">تاريخ البدء *</label>
                <Input data-testid="req-date" type="date" value={form.start_date} onChange={set("start_date")} className="bg-navy-800 border-navy-600 h-11 num" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">وقت البدء</label>
                <Input data-testid="req-time" type="time" value={form.start_time} onChange={set("start_time")} className="bg-navy-800 border-navy-600 h-11 num" />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">متطلبات إضافية (اختياري)</label>
              <Textarea data-testid="req-requirements" value={form.requirements} onChange={set("requirements")}
                placeholder="مثال: خبرة سابقة، لباس معين، معدات…" className="bg-navy-800 border-navy-600 min-h-[90px]" />
            </div>
          </div>
        )}

        {step === 3 && svc && estimate && (
          <div className="space-y-5" data-testid="step-review">
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              {[
                ["الخدمة", svc.name],
                ["العنوان", form.title || svc.name],
                ["عدد المندوبين", form.required_count],
                ["المدة", `${DURATIONS.find((d) => d.key === form.duration_type)?.label} (${durationDays} يوم)`],
                ["السعر", `${sar(form.rate)} ${svc.unit_label}`],
                ...(svc.has_shipments ? [["الشحنات لكل مندوب", form.shipments_per_driver], ["إجمالي الشحنات", (Number(form.shipments_per_driver) || 0) * Number(form.required_count || 0)]] : []),
                ...(svc.needs_vehicle && form.vehicle_type ? [["نوع السيارة", form.vehicle_type]] : []),
                ["الموقع", `${form.city} — ${form.address}`],
                ["البدء", `${form.start_date} · ${form.start_time}`],
              ].map(([k, v]) => (
                <div key={k} className="bg-navy-800/60 rounded-xl p-3 border border-navy-600/40">
                  <p className="text-[11px] text-slate-500">{k}</p>
                  <p className="font-semibold mt-1 num">{v}</p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-brand/30 bg-brand/5 p-5 space-y-2" data-testid="cost-breakdown">
              <div className="flex justify-between text-sm"><span className="text-slate-400">التكلفة التقديرية الإجمالية</span><span className="font-heading font-black text-brand text-lg num">{sar(estimate.total)}</span></div>
              <div className="flex justify-between text-xs"><span className="text-slate-500">عمولة المنصة (10%)</span><span className="num text-slate-300">{sar(estimate.commission)}</span></div>
              <div className="flex justify-between text-xs"><span className="text-slate-500">صافي مستحق للمندوبين</span><span className="num text-slate-300">{sar(estimate.payout)}</span></div>
              <p className="text-[11px] text-slate-500 pt-2 border-t border-navy-600/40">
                سيُحجز المبلغ الإجمالي من محفظتك عند تأكيد العمال، ولا يُصرف إلا بعد إتمام العمل وتأكيدك.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}
          data-testid="wizard-back-btn"
          className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-100 disabled:opacity-30 transition-colors">
          <ChevronRight className="w-4 h-4" /> السابق
        </button>
        {step < 3 ? (
          <button onClick={next} data-testid="wizard-next-btn"
            className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-6 py-3 text-sm hover:bg-brand-hover transition-colors">
            التالي <ChevronLeft className="w-4 h-4" />
          </button>
        ) : (
          <button onClick={publish} disabled={busy} data-testid="wizard-publish-btn"
            className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-6 py-3 text-sm hover:bg-brand-hover transition-colors disabled:opacity-50 shadow-[0_0_25px_rgba(0,229,163,0.3)]">
            <Rocket className="w-4 h-4" /> {busy ? "جاري النشر…" : "نشر الطلب وإرسال العروض"}
          </button>
        )}
      </div>
    </div>
  );
}
