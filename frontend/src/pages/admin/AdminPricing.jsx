import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Tag, PlusCircle, History, Ban } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { sar, CITIES, DEFAULT_VEHICLE_TYPES, TEMP_TYPES, ACTIVE_SERVICES } from "@/lib/constants";
import { useI18n } from "@/i18n";

export default function AdminPricing() {
  const { t, lang } = useI18n();
  const [pricing, setPricing] = useState(null);
  const [businesses, setBusinesses] = useState([]);
  const [form, setForm] = useState({ business_id: "", rate: "", commission_pct: "", effective_date: "", version: "", notes: "", reason: "" });
  const [rules, setRules] = useState(null);
  const [ruleForm, setRuleForm] = useState({ business_id: "", vehicle_type: "sedan", temperature_type: "", service_type: "", pickup_city: "الرياض", delivery_city: "جدة", price: "", effective_date: "", expiry_date: "", version: "", agreement_ref: "", notes: "" });
  const [cities, setCities] = useState(CITIES);
  const [ruleBusy, setRuleBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const locale = lang === "ar" ? "ar-SA" : lang === "ur" ? "ur-PK" : "en-US";

  const load = () => {
    api.get("/admin/pricing").then(({ data }) => setPricing(data.pricing)).catch((e) => toast.error(errMsg(e)));
    api.get("/admin/pricing/rules").then(({ data }) => setRules(data.rules)).catch(() => setRules([]));
    api.get("/admin/users", { params: { role: "business" } }).then(({ data }) => setBusinesses(data.users)).catch(() => {});
    api.get("/catalog/defaults").then(({ data }) => {
      if (data.service_areas?.length) setCities(data.service_areas);
    }).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.business_id || !form.rate || !form.commission_pct || !form.effective_date)
      return toast.error(t("pricing.formError"));
    setBusy(true);
    try {
      await api.post("/admin/pricing", {
        business_id: form.business_id, rate: Number(form.rate),
        commission_rate: Number(form.commission_pct) / 100,
        effective_date: form.effective_date, version: form.version || undefined,
        notes: form.notes || undefined, reason: form.reason || undefined,
      });
      toast.success(t("pricing.saved"));
      setForm({ business_id: "", rate: "", commission_pct: "", effective_date: "", version: "", notes: "", reason: "" });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (id) => {
    try {
      await api.post(`/admin/pricing/${id}/deactivate`);
      toast.success(t("pricing.deactivated"));
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const active = (pricing || []).filter((p) => p.status === "active");
  const history = (pricing || []).filter((p) => p.status !== "active");

  const submitRule = async (e) => {
    e.preventDefault();
    if (!ruleForm.price || !ruleForm.effective_date || !ruleForm.pickup_city || !ruleForm.delivery_city)
      return toast.error(t("pricing.formError"));
    if (["van", "dyna"].includes(ruleForm.vehicle_type) && !ruleForm.temperature_type)
      return toast.error(t("wiz2.tempRequired"));
    setRuleBusy(true);
    try {
      await api.post("/admin/pricing/rules", {
        business_id: ruleForm.business_id || null,
        vehicle_type: ruleForm.vehicle_type,
        temperature_type: ["van", "dyna"].includes(ruleForm.vehicle_type) ? ruleForm.temperature_type : null,
        service_type: ruleForm.service_type || null,
        pickup_city: ruleForm.pickup_city, delivery_city: ruleForm.delivery_city,
        price: Number(ruleForm.price), effective_date: ruleForm.effective_date,
        expiry_date: ruleForm.expiry_date || null,
        version: ruleForm.version || undefined,
        agreement_ref: ruleForm.agreement_ref || undefined,
        notes: ruleForm.notes || undefined,
      });
      toast.success(t("rules.saved"));
      setRuleForm({ business_id: "", vehicle_type: "sedan", temperature_type: "", service_type: "", pickup_city: "الرياض", delivery_city: "جدة", price: "", effective_date: "", expiry_date: "", version: "", agreement_ref: "", notes: "" });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setRuleBusy(false);
    }
  };

  const deactivateRule = async (id) => {
    try {
      await api.post(`/admin/pricing/rules/${id}/deactivate`);
      toast.success(t("rules.deactivated"));
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-pricing-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("pricing.title")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("pricing.sub")}</p>
      </div>

      <form onSubmit={submitRule} className="card-surface p-6 space-y-4 border-brand/25" data-testid="pricing-rule-form">
        <p className="font-heading font-bold flex items-center gap-2">
          <PlusCircle className="w-4 h-4 text-brand" /> {t("rules.newRule")}
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("rules.business")}</label>
            <select data-testid="rule-business" value={ruleForm.business_id} onChange={(e) => setRuleForm({ ...ruleForm, business_id: e.target.value })}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
              <option value="">{t("rules.global")}</option>
              {businesses.map((b) => (
                <option key={b._id} value={b._id}>{b.business_profile?.company_name || b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("rules.vehicle")}</label>
            <select data-testid="rule-vehicle" value={ruleForm.vehicle_type}
              onChange={(e) => setRuleForm({ ...ruleForm, vehicle_type: e.target.value, temperature_type: "" })}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
              {DEFAULT_VEHICLE_TYPES.map((v) => <option key={v} value={v}>{t(`veh.${v}`)}</option>)}
            </select>
          </div>
          {["van", "dyna"].includes(ruleForm.vehicle_type) && (
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t("rules.temp")}</label>
              <select data-testid="rule-temp" value={ruleForm.temperature_type} onChange={(e) => setRuleForm({ ...ruleForm, temperature_type: e.target.value })}
                className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
                <option value="">{t("auth.choose")}</option>
                {TEMP_TYPES.map((tp) => <option key={tp} value={tp}>{t(`veh.${tp}`)}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("rules.service")}</label>
            <select data-testid="rule-service" value={ruleForm.service_type}
              onChange={(e) => setRuleForm({ ...ruleForm, service_type: e.target.value })}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
              <option value="">{t("rules.allServices")}</option>
              {ACTIVE_SERVICES.map((s) => <option key={s.key} value={s.key}>{t(`svc.${s.key}`) !== `svc.${s.key}` ? t(`svc.${s.key}`) : s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("rules.expiryDate")}</label>
            <Input data-testid="rule-expiry" type="date" value={ruleForm.expiry_date}
              onChange={(e) => setRuleForm({ ...ruleForm, expiry_date: e.target.value })}
              className="bg-navy-800 border-navy-600 h-11 num" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("rules.pickup")}</label>
            <select data-testid="rule-pickup" value={ruleForm.pickup_city} onChange={(e) => setRuleForm({ ...ruleForm, pickup_city: e.target.value })}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
              {cities.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("rules.delivery")}</label>
            <select data-testid="rule-delivery" value={ruleForm.delivery_city} onChange={(e) => setRuleForm({ ...ruleForm, delivery_city: e.target.value })}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
              {cities.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("rules.price")}</label>
            <Input data-testid="rule-price" type="number" step="0.25" min="0.25" value={ruleForm.price}
              onChange={(e) => setRuleForm({ ...ruleForm, price: e.target.value })} className="bg-navy-800 border-navy-600 h-11 num" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("rules.effectiveDate")}</label>
            <Input data-testid="rule-effective" type="date" value={ruleForm.effective_date}
              onChange={(e) => setRuleForm({ ...ruleForm, effective_date: e.target.value })} className="bg-navy-800 border-navy-600 h-11 num" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("rules.version")}</label>
            <Input data-testid="rule-version" value={ruleForm.version} placeholder="AGR-2026-001"
              onChange={(e) => setRuleForm({ ...ruleForm, version: e.target.value })} className="bg-navy-800 border-navy-600 h-11" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("rules.agreement")}</label>
            <Input data-testid="rule-agreement" value={ruleForm.agreement_ref}
              onChange={(e) => setRuleForm({ ...ruleForm, agreement_ref: e.target.value })} className="bg-navy-800 border-navy-600 h-11" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("rules.notes")}</label>
            <Input data-testid="rule-notes" value={ruleForm.notes}
              onChange={(e) => setRuleForm({ ...ruleForm, notes: e.target.value })} className="bg-navy-800 border-navy-600 h-11" />
          </div>
        </div>
        <button data-testid="rule-save-btn" disabled={ruleBusy}
          className="bg-brand text-navy-900 font-bold rounded-xl px-6 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
          {ruleBusy ? t("common.saving") : t("rules.save")}
        </button>
      </form>

      <div>
        <h2 className="heading text-lg font-bold mb-4">{t("rules.activeTitle")}</h2>
        {!rules ? (
          <p className="text-slate-500 text-sm">{t("common.loading")}</p>
        ) : rules.filter((x) => x.status === "active").length === 0 ? (
          <EmptyState icon={Tag} title={t("rules.empty")} desc={t("rules.emptyDesc")} testid="rules-empty" />
        ) : (
          <div className="card-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-600/50 text-slate-400 text-xs">
                    {[t("rules.business"), t("rules.vehicle"), t("rules.temp"), t("rules.pickup"), t("rules.delivery"), t("rules.price"), t("rules.effectiveDate"), t("rules.version"), ""].map((h, i) => (
                      <th key={i} className="text-start p-4 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rules.filter((x) => x.status === "active").map((x) => (
                    <tr key={x._id} className="border-b border-navy-600/30 hover:bg-navy-700/20" data-testid={`rule-row-${x._id}`}>
                      <td className="p-4 font-semibold text-xs">{x.business ? (x.business.business_profile?.company_name || x.business.name) : t("rules.global")}</td>
                      <td className="p-4 text-xs">{t(`veh.${x.vehicle_type}`)}</td>
                      <td className="p-4 text-xs">{x.temperature_type ? t(`veh.${x.temperature_type}`) : "—"}</td>
                      <td className="p-4 text-xs">{x.pickup_city}</td>
                      <td className="p-4 text-xs">{x.delivery_city}</td>
                      <td className="p-4 num text-brand font-bold">{sar(x.price)}</td>
                      <td className="p-4 num text-xs">{x.effective_date}</td>
                      <td className="p-4 text-xs text-slate-400">{x.version || "—"}</td>
                      <td className="p-4">
                        <button data-testid={`rule-deactivate-${x._id}`} onClick={() => deactivateRule(x._id)}
                          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition-colors">
                          <Ban className="w-3 h-3" /> {t("rules.deactivate")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="card-surface p-6 space-y-4" data-testid="pricing-form">
        <p className="font-heading font-bold flex items-center gap-2">
          <PlusCircle className="w-4 h-4 text-brand" /> {t("pricing.new")}
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("pricing.business")}</label>
            <select data-testid="pricing-business" value={form.business_id} onChange={(e) => setForm({ ...form, business_id: e.target.value })}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
              <option value="">{t("pricing.chooseBusiness")}</option>
              {businesses.map((b) => (
                <option key={b._id} value={b._id}>{b.business_profile?.company_name || b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("pricing.rate")}</label>
            <Input data-testid="pricing-rate" type="number" step="0.25" min="0.25" value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })} className="bg-navy-800 border-navy-600 h-11 num" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("pricing.commission")}</label>
            <Input data-testid="pricing-commission" type="number" min="1" max="50" value={form.commission_pct}
              onChange={(e) => setForm({ ...form, commission_pct: e.target.value })} className="bg-navy-800 border-navy-600 h-11 num" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("pricing.effectiveDate")}</label>
            <Input data-testid="pricing-effective" type="date" value={form.effective_date}
              onChange={(e) => setForm({ ...form, effective_date: e.target.value })} className="bg-navy-800 border-navy-600 h-11 num" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("pricing.version")}</label>
            <Input data-testid="pricing-version" value={form.version} placeholder="AGR-2026-001"
              onChange={(e) => setForm({ ...form, version: e.target.value })} className="bg-navy-800 border-navy-600 h-11" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("pricing.reason")}</label>
            <Input data-testid="pricing-reason" value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })} className="bg-navy-800 border-navy-600 h-11" />
          </div>
        </div>
        <button data-testid="pricing-save-btn" disabled={busy}
          className="bg-brand text-navy-900 font-bold rounded-xl px-6 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
          {busy ? t("common.saving") : t("pricing.save")}
        </button>
      </form>

      <div>
        <h2 className="heading text-lg font-bold mb-4">{t("pricing.active")}</h2>
        {!pricing ? (
          <p className="text-slate-500 text-sm">{t("common.loading")}</p>
        ) : active.length === 0 ? (
          <EmptyState icon={Tag} title={t("pricing.empty")} desc={t("pricing.emptyDesc")} testid="pricing-empty" />
        ) : (
          <div className="card-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-600/50 text-slate-400 text-xs">
                    <th className="text-start p-4 font-semibold">{t("pricing.business")}</th>
                    <th className="text-start p-4 font-semibold">{t("pricing.rate")}</th>
                    <th className="text-start p-4 font-semibold">{t("pricing.commission")}</th>
                    <th className="text-start p-4 font-semibold">{t("pricing.effectiveDate")}</th>
                    <th className="text-start p-4 font-semibold">{t("pricing.version")}</th>
                    <th className="text-start p-4 font-semibold">{t("pricing.setBy")}</th>
                    <th className="text-start p-4 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((p) => (
                    <tr key={p._id} className="border-b border-navy-600/30 hover:bg-navy-700/20" data-testid={`pricing-row-${p._id}`}>
                      <td className="p-4 font-semibold">{p.business?.business_profile?.company_name || p.business?.name}</td>
                      <td className="p-4 num text-brand font-bold">{sar(p.rate)}</td>
                      <td className="p-4 num">{Math.round(p.commission_rate * 100)}%</td>
                      <td className="p-4 num text-xs">{p.effective_date}</td>
                      <td className="p-4 text-xs text-slate-400">{p.version || "—"}</td>
                      <td className="p-4 text-xs text-slate-400">{p.created_by?.name}</td>
                      <td className="p-4">
                        <button data-testid={`pricing-deactivate-${p._id}`} onClick={() => deactivate(p._id)}
                          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition-colors">
                          <Ban className="w-3 h-3" /> {t("pricing.deactivate")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div>
          <h2 className="heading text-lg font-bold mb-4 flex items-center gap-2">
            <History className="w-4 h-4 text-slate-400" /> {t("pricing.history")}
          </h2>
          <div className="space-y-2">
            {history.map((p) => (
              <div key={p._id} className="card-surface p-4 flex flex-wrap items-center gap-4 text-xs" data-testid={`pricing-history-${p._id}`}>
                <span className="font-semibold text-sm">{p.business?.business_profile?.company_name || p.business?.name}</span>
                <span className="chip bg-navy-800 text-slate-400 border-navy-600 num">{sar(p.old_rate)} → {sar(p.rate)}</span>
                <span className="chip bg-navy-800 text-slate-400 border-navy-600 num">{p.old_commission_rate ? `${Math.round(p.old_commission_rate * 100)}%` : "—"} → {Math.round(p.commission_rate * 100)}%</span>
                <span className="text-slate-500">{p.version}</span>
                <span className="text-slate-500">{p.reason}</span>
                <span className="text-slate-600 ms-auto num">{new Date(p.created_at).toLocaleString(locale)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
