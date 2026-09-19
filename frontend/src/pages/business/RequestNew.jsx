import { useMemo, useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { ChevronRight, ChevronLeft, Check, Rocket, Wallet, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import api, { errMsg } from "@/lib/api";
import { useI18n } from "@/i18n";
import { ACTIVE_SERVICES, SERVICE_MAP, DURATIONS, sar, DEFAULT_VEHICLE_TYPES } from "@/lib/constants";

export default function RequestNew() {
  const { t } = useI18n();
  const STEPS = [t("wizard.step1"), t("wizard.step2"), t("wizard.step3"), t("wizard.step4")];
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    service_type: "delivery_driver", title: "", required_count: 1,
    duration_type: "one_day", days_count: 2, shipments_per_driver: "",
    vehicle_type: "", temperature_type: "", pickup_city: "الرياض", delivery_city: "الرياض",
    city: "الرياض", address: "", start_date: "", start_time: "08:00", requirements: "",
  });
  const [defaults, setDefaults] = useState({
    default_rate: 8, commission_rate: 0.10,
    vehicle_types: DEFAULT_VEHICLE_TYPES,
    service_areas: ["الرياض", "جدة", "الدمام", "الخبر", "مكة المكرمة", "المدينة المنورة"],
    enabled_pickup_cities: ["الرياض"],
    enabled_delivery_cities: ["الرياض", "جدة", "الدمام", "الخبر", "مكة المكرمة", "المدينة المنورة"],
  });
  const [quote, setQuote] = useState(null);
  const [offices, setOffices] = useState([]);
  const [preferredOffice, setPreferredOffice] = useState("");
  const [busy, setBusy] = useState(false);
  const [insufficient, setInsufficient] = useState(null);
  const [termsAgreed, setTermsAgreed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/catalog/defaults")
      .then(({ data }) => setDefaults((prev) => ({
        default_rate: data.default_rate,
        commission_rate: data.commission_rate,
        vehicle_types: data.vehicle_types?.length ? data.vehicle_types : prev.vehicle_types,
        service_areas: data.service_areas?.length ? data.service_areas : prev.service_areas,
        enabled_pickup_cities: data.enabled_pickup_cities?.length ? data.enabled_pickup_cities : prev.enabled_pickup_cities,
        enabled_delivery_cities: data.enabled_delivery_cities?.length ? data.enabled_delivery_cities : prev.enabled_delivery_cities,
      })))
      .catch(() => {});
    api.get("/business/offices").then(({ data }) => setOffices(data.offices)).catch(() => {});
  }, []);

  useEffect(() => {
    if (step !== 3 || !form.vehicle_type) return;
    setQuote(null);
    api.get("/business/pricing/quote", { params: {
      vehicle_type: form.vehicle_type,
      temperature_type: ["van", "dyna"].includes(form.vehicle_type) ? form.temperature_type || undefined : undefined,
      pickup_city: form.pickup_city, delivery_city: form.delivery_city,
    } }).then(({ data }) => setQuote(data)).catch(() => setQuote({ ok: false, message: t("wiz2.quoteError") }));
  }, [step, form.vehicle_type, form.temperature_type, form.pickup_city, form.delivery_city]);

  const svc = form.service_type ? SERVICE_MAP[form.service_type] : null;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const durationDays = useMemo(() => {
    if (form.duration_type === "several_days") return Math.max(1, Number(form.days_count) || 1);
    return DURATIONS.find((d) => d.key === form.duration_type)?.days || 1;
  }, [form.duration_type, form.days_count]);

  const estimate = useMemo(() => {
    if (!svc || !quote?.ok) return null;
    const rate = quote.price;
    const total = svc.has_shipments
      ? rate * (Number(form.shipments_per_driver) || 0) * Number(form.required_count || 0)
      : rate * Number(form.required_count || 0) * durationDays;
    const commission = total * quote.commission_rate;
    return { total, commission, payout: total - commission, rate };
  }, [svc, quote, form.shipments_per_driver, form.required_count, durationDays]);

  const next = () => {
    if (step === 0 && !form.service_type) return toast.error(t("wizard.step1"));
    if (step === 1) {
      if (form.required_count < 1) return toast.error(t("wizard.driversCount"));
      if (svc?.has_shipments && !form.shipments_per_driver) return toast.error(t("wizard.shipments"));
      if (svc?.needs_vehicle && !form.vehicle_type.trim()) return toast.error(t("wizard.vehicle"));
      if (svc?.needs_vehicle && ["van", "dyna"].includes(form.vehicle_type) && !form.temperature_type)
        return toast.error(t("wiz2.tempRequired"));
    }
    if (step === 2 && (!form.address.trim() || !form.start_date)) return toast.error(t("wizard.area"));
    setStep((s) => s + 1);
  };

  const publish = async (asDraft = false) => {
    if (!asDraft && !termsAgreed) return toast.error(t("wizard.termsBizError"));
    setBusy(true);
    setInsufficient(null);
    try {
      const payload = {
        ...form,
        required_count: Number(form.required_count),
        days_count: Number(form.days_count),
        shipments_per_driver: form.shipments_per_driver ? Number(form.shipments_per_driver) : null,
        title: form.title || null,
        vehicle_type: form.vehicle_type || null,
        temperature_type: ["van", "dyna"].includes(form.vehicle_type) ? form.temperature_type || null : null,
        requirements: form.requirements || null,
        preferred_office_id: preferredOffice || null,
        publish: !asDraft,
        terms: !asDraft ? termsAgreed : false,
      };
      const { data } = await api.post("/business/requests", payload);
      if (asDraft) {
        toast.success(t("wizard.draftSaved"));
      } else {
        toast.success(t("wizard.publishedToast", { n: data.matched_workers }));
      }
      navigate(`/app/business/requests/${data.request._id}`);
    } catch (err) {
      const d = err?.response?.data?.detail;
      if (d?.code === "INSUFFICIENT_FUNDS") {
        setInsufficient(d);
        toast.error(t("wizard.insufficientFunds"));
      } else {
        toast.error(errMsg(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6" data-testid="request-new-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("wizard.title")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("wizard.sub")}</p>
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
                onClick={() => setForm({ ...form, service_type: s.key })}
                className={`p-4 rounded-xl border text-start transition-all flex items-start gap-3 ${
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
              <label className="text-xs text-slate-400 block mb-1.5">{t("wizard.reqTitle")}</label>
              <Input data-testid="req-title" value={form.title} onChange={set("title")} placeholder={svc.name} className="bg-navy-800 border-navy-600 h-11" />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">{t("wizard.driversCount")} *</label>
                <Input data-testid="req-count" type="number" min="1" value={form.required_count} onChange={set("required_count")} className="bg-navy-800 border-navy-600 h-11 num" />
              </div>
              {svc.has_shipments && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">{t("wizard.shipments")} *</label>
                  <Input data-testid="req-shipments" type="number" min="1" value={form.shipments_per_driver} onChange={set("shipments_per_driver")} className="bg-navy-800 border-navy-600 h-11 num" />
                </div>
              )}
              {svc.needs_vehicle && (
                <>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">{t("wizard.vehicle")} *</label>
                    <select data-testid="req-vehicle" value={form.vehicle_type} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value, temperature_type: "" })}
                      className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
                      <option value="">{t("wizard.chooseVehicle")}</option>
                      {defaults.vehicle_types.map((v) => <option key={v} value={v}>{t(`veh.${v}`)}</option>)}
                    </select>
                  </div>
                  {["van", "dyna"].includes(form.vehicle_type) && (
                    <div>
                      <label className="text-xs text-slate-400 block mb-1.5">{t("veh.tempType")} *</label>
                      <select data-testid="req-temp" value={form.temperature_type} onChange={set("temperature_type")}
                        className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
                        <option value="">{t("auth.choose")}</option>
                        <option value="dry">{t("veh.dry")}</option>
                        <option value="cold">{t("veh.cold")}</option>
                      </select>
                    </div>
                  )}
                </>
              )}
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-2">{t("wizard.duration")}</label>
              <div className="flex flex-wrap gap-2" data-testid="req-durations">
                {DURATIONS.map((d) => (
                  <button key={d.key} type="button" data-testid={`duration-${d.key}`}
                    onClick={() => setForm({ ...form, duration_type: d.key })}
                    className={`chip ${form.duration_type === d.key ? "bg-brand/15 text-brand border-brand/40" : "bg-navy-800 text-slate-400 border-navy-600"}`}>
                    {t(`wizard.duration_${d.key}`) !== `wizard.duration_${d.key}` ? t(`wizard.duration_${d.key}`) : d.label}
                  </button>
                ))}
              </div>
              {form.duration_type === "several_days" && (
                <div className="mt-3 max-w-[200px]">
                  <label className="text-xs text-slate-400 block mb-1.5">{t("wizard.days")}</label>
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
                <label className="text-xs text-slate-400 block mb-1.5">{t("wiz2.pickupCity")} *</label>
                <select data-testid="req-pickup-city" value={form.pickup_city} onChange={set("pickup_city")}
                  className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
                  {defaults.enabled_pickup_cities.map((c) => <option key={c}>{c}</option>)}
                </select>
                {defaults.enabled_pickup_cities.length === 1 && (
                  <p className="text-[10px] text-slate-500 mt-1">{t("wiz2.phaseOneNote")}</p>
                )}
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">{t("wiz2.deliveryCity")} *</label>
                <select data-testid="req-delivery-city" value={form.delivery_city} onChange={set("delivery_city")}
                  className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
                  {defaults.enabled_delivery_cities.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">{t("office.prefOffice")}</label>
                <select data-testid="req-preferred-office" value={preferredOffice} onChange={(e) => setPreferredOffice(e.target.value)}
                  className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
                  <option value="">{t("office.anyProvider")}</option>
                  {offices.map((o) => (
                    <option key={o._id} value={o._id}>
                      {o.office_name} — {t("office.capacity")}: {o.drivers_available}/{o.drivers_total}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-slate-400 block mb-1.5">{t("wizard.area")} *</label>
                <Input data-testid="req-address" value={form.address} onChange={set("address")} placeholder={t("wizard.areaPh")} className="bg-navy-800 border-navy-600 h-11" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">{t("wizard.startDate")} *</label>
                <Input data-testid="req-date" type="date" value={form.start_date} onChange={set("start_date")} className="bg-navy-800 border-navy-600 h-11 num" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">{t("wizard.startTime")}</label>
                <Input data-testid="req-time" type="time" value={form.start_time} onChange={set("start_time")} className="bg-navy-800 border-navy-600 h-11 num" />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t("wizard.notes")}</label>
              <Textarea data-testid="req-requirements" value={form.requirements} onChange={set("requirements")}
                placeholder={t("wizard.notesPh")} className="bg-navy-800 border-navy-600 min-h-[90px]" />
            </div>
          </div>
        )}

        {step === 3 && svc && !estimate && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 space-y-2" data-testid="no-pricing-rule">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
              <p className="text-sm font-bold text-rose-300">{quote && !quote.ok ? quote.message : t("wiz2.noPrice")}</p>
            </div>
          </div>
        )}
        {step === 3 && svc && estimate && (
          <div className="space-y-5" data-testid="step-review">
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              {[
                [t("wizard.rService"), svc.name],
                [t("wizard.rTitle"), form.title || svc.name],
                [t("wizard.rDrivers"), form.required_count],
                [t("wizard.rDuration"), `${DURATIONS.find((d) => d.key === form.duration_type)?.label} (${durationDays})`],
                [t("wiz2.appliedPrice"), quote?.ok ? `${sar(quote.price)} · ${quote.version || ""}` : "—"],
                ...(svc.has_shipments ? [
                  [t("wizard.rShipments"), form.shipments_per_driver],
                  [t("wizard.rTotal"), (Number(form.shipments_per_driver) || 0) * Number(form.required_count || 0)],
                ] : []),
                ...(svc.needs_vehicle && form.vehicle_type ? [[t("wizard.rVehicle"), form.vehicle_type]] : []),
                [t("wizard.rLocation"), `${form.pickup_city} → ${form.delivery_city} — ${form.address}`],
                [t("wizard.rStart"), `${form.start_date} · ${form.start_time}`],
              ].map(([k, v]) => (
                <div key={k} className="bg-navy-800/60 rounded-xl p-3 border border-navy-600/40">
                  <p className="text-[11px] text-slate-500">{k}</p>
                  <p className="font-semibold mt-1 num">{v}</p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-brand/30 bg-brand/5 p-5 space-y-2" data-testid="cost-breakdown">
              <div className="flex justify-between text-xs"><span className="text-slate-500">{t("wizard.base")}</span><span className="num text-slate-300">{sar(estimate.total)}</span></div>
              <div className="flex justify-between text-xs"><span className="text-slate-500">{t("wizard.commission")} (<span className="num">{Math.round(defaults.commission_rate * 100)}%</span>)</span><span className="num text-slate-300">{sar(estimate.commission)}</span></div>
              <div className="flex justify-between text-xs"><span className="text-slate-500">{t("wizard.driversNet")}</span><span className="num text-slate-300">{sar(estimate.payout)}</span></div>
              <div className="flex justify-between text-sm pt-2 border-t border-navy-600/40"><span className="text-slate-300 font-semibold">{t("wizard.totalCharged")}</span><span className="font-heading font-black text-brand text-lg num">{sar(estimate.total)}</span></div>
              <p className="text-[11px] text-slate-500">{t("wizard.breakdownNote")}</p>
            </div>
            {insufficient && (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 space-y-3" data-testid="insufficient-funds-alert">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                  <p className="text-sm font-bold text-rose-300">{t("wizard.insufficientFunds")}</p>
                </div>
                <div className="flex flex-wrap gap-6 text-xs text-slate-300">
                  <span>{t("wizard.required")}: <span className="num font-bold text-rose-300">{sar(insufficient.required)}</span></span>
                  <span>{t("wizard.available")}: <span className="num font-bold">{sar(insufficient.available)}</span></span>
                </div>
                <Link to="/app/business/wallet" data-testid="topup-now-btn"
                  className="inline-flex items-center gap-2 bg-rose-400 text-navy-900 font-bold rounded-xl px-5 py-2.5 text-sm hover:bg-rose-300 transition-colors">
                  <Wallet className="w-4 h-4" /> {t("wizard.topupNow")}
                </Link>
              </div>
            )}
            <div className="rounded-2xl border border-navy-600/50 bg-navy-800/40 p-5 space-y-3" data-testid="biz-terms-block">
              <p className="font-heading font-bold text-sm">{t("wizard.termsBizTitle")}</p>
              <ul className="space-y-1.5 text-xs text-slate-400">
                {[1, 2, 3, 4].map((i) => (
                  <li key={i} className="flex gap-2">
                    <Check className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5" />
                    <span>{t(`wizard.termsBizI${i}`)}</span>
                  </li>
                ))}
              </ul>
              <label className="flex items-start gap-3 cursor-pointer text-sm pt-1" data-testid="biz-terms-wrap">
                <input type="checkbox" checked={termsAgreed} onChange={(e) => setTermsAgreed(e.target.checked)}
                  data-testid="biz-terms-checkbox"
                  className="mt-1 w-4 h-4 accent-emerald-400" />
                <span>{t("wizard.termsBizAgree")}</span>
              </label>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}
          data-testid="wizard-back-btn"
          className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-100 disabled:opacity-30 transition-colors">
          <ChevronRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" /> {t("common.prev")}
        </button>
        {step < 3 ? (
          <button onClick={next} data-testid="wizard-next-btn"
            className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-6 py-3 text-sm hover:bg-brand-hover transition-colors">
            {t("common.next")} <ChevronLeft className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
          </button>
        ) : (
          <div className="flex gap-3">
            <button onClick={() => publish(false)} disabled={busy || !termsAgreed || !quote?.ok} data-testid="wizard-publish-btn"
              className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-6 py-3 text-sm hover:bg-brand-hover transition-colors disabled:opacity-50 shadow-[0_0_25px_rgba(0,229,163,0.3)]">
              <Rocket className="w-4 h-4" /> {busy ? t("wizard.publishing") : t("wizard.publish")}
            </button>
            <button onClick={() => publish(true)} disabled={busy} data-testid="wizard-draft-btn"
              className="flex items-center gap-2 border border-navy-600 text-slate-300 font-semibold rounded-xl px-5 py-3 text-sm hover:border-brand/40 hover:text-brand transition-colors disabled:opacity-50">
              {t("wizard.draft")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
