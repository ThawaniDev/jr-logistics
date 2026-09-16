import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Zap, MapPin, Calendar, Clock, Users, CheckCircle2, XCircle, Building2 } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { SERVICE_MAP, DURATIONS, sar } from "@/lib/constants";

function DetailsGrid({ r }) {
  const svc = SERVICE_MAP[r.service_type];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
      <div className="bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
        <p className="text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3" /> الموقع</p>
        <p className="font-semibold mt-1">{r.city} — {r.address}</p>
      </div>
      <div className="bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
        <p className="text-slate-500 flex items-center gap-1"><Calendar className="w-3 h-3" /> التاريخ</p>
        <p className="font-semibold mt-1 num">{r.start_date}</p>
      </div>
      <div className="bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
        <p className="text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> الوقت والمدة</p>
        <p className="font-semibold mt-1"><span className="num">{r.start_time}</span> · {DURATIONS.find((d) => d.key === r.duration_type)?.label}</p>
      </div>
      <div className="bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
        <p className="text-slate-500 flex items-center gap-1"><Users className="w-3 h-3" /> العائد المتوقع</p>
        <p className="font-semibold mt-1 text-brand num">{sar(Math.round((r.estimated_total / r.required_count) * 0.9))}</p>
      </div>
      {r.shipment_count && (
        <div className="col-span-2 bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
          <p className="text-slate-500">الشحنات المتوقعة لك</p>
          <p className="font-semibold mt-1 num">{r.shipments_per_driver ?? Math.round(r.shipment_count / r.required_count)} شحنة × {sar(r.rate)}</p>
        </div>
      )}
      {r.vehicle_type && (
        <div className="col-span-2 bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
          <p className="text-slate-500">المركبة المطلوبة</p>
          <p className="font-semibold mt-1">{r.vehicle_type}</p>
        </div>
      )}
      {r.requirements && (
        <div className="col-span-2 sm:col-span-4 bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
          <p className="text-slate-500">متطلبات المنشأة</p>
          <p className="font-semibold mt-1 leading-relaxed">{r.requirements}</p>
        </div>
      )}
      {svc && (
        <div className="col-span-2 sm:col-span-4 text-[11px] text-slate-500">
          السعر المعروض: <span className="num text-slate-300">{sar(r.rate)}</span> {svc.unit_label} · التسوية بعد تأكيد المنشأة لإتمام العمل
        </div>
      )}
    </div>
  );
}

export default function WorkerOpportunities() {
  const [offers, setOffers] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState("");

  const load = () => {
    api.get("/worker/offers").then(({ data }) => setOffers(data.offers)).catch(() => {});
    api.get("/worker/available").then(({ data }) => setOpen(data.jobs)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const respond = async (offerId, action) => {
    setBusy(offerId + action);
    try {
      await api.post(`/worker/offers/${offerId}/respond`, { action });
      toast.success(action === "accept" ? "تم قبول الفرصة — بانتظار تأكيد المنشأة وحجز المبلغ" : "تم رفض العرض");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  const apply = async (requestId) => {
    setBusy("apply" + requestId);
    try {
      await api.post("/worker/apply", { request_id: requestId });
      toast.success("تم قبولك للفرصة — بانتظار تأكيد المنشأة");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-8" data-testid="opportunities-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">الفرص المتاحة</h1>
        <p className="text-sm text-slate-400 mt-1">راجع التفاصيل الكاملة قبل القبول — لا التزام قبل موافقتك</p>
      </div>

      <section>
        <h2 className="heading text-lg font-bold mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" /> عروض موجهة إليك
        </h2>
        {!offers ? (
          <p className="text-slate-500 text-sm">جاري التحميل…</p>
        ) : offers.length === 0 ? (
          <EmptyState icon={Zap} title="لا توجد عروض موجهة حالياً" desc="فعّل حالة التوفر وأضف خدماتك ليصلك المزيد" testid="offers-empty" />
        ) : (
          <div className="space-y-4">
            {offers.map((o) => (
              <div key={o._id} className="card-surface card-surface-hover p-5 space-y-4" data-testid={`offer-${o._id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-heading font-bold">{o.request?.title}</p>
                      {o.is_replacement && <span className="chip bg-rose-500/10 text-rose-400 border-rose-500/30">فرصة بديلة</span>}
                    </div>
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5" />
                      {o.business?.business_profile?.company_name || o.business?.name}
                    </p>
                  </div>
                  <StatusBadge kind="offer" status={o.status} />
                </div>
                {o.request && <DetailsGrid r={o.request} />}
                <div className="flex gap-3 pt-1">
                  <button data-testid={`accept-offer-${o._id}`} disabled={busy}
                    onClick={() => respond(o._id, "accept")}
                    className="flex-1 flex items-center justify-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-4 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
                    <CheckCircle2 className="w-4 h-4" /> قبول الفرصة
                  </button>
                  <button data-testid={`reject-offer-${o._id}`} disabled={busy}
                    onClick={() => respond(o._id, "reject")}
                    className="flex-1 flex items-center justify-center gap-2 border border-navy-600 text-slate-300 font-semibold rounded-xl px-4 py-2.5 text-sm hover:border-rose-500/40 hover:text-rose-400 disabled:opacity-50 transition-colors">
                    <XCircle className="w-4 h-4" /> اعتذار
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="heading text-lg font-bold mb-4">طلبات مفتوحة تناسب خدماتك</h2>
        {!open ? (
          <p className="text-slate-500 text-sm">جاري التحميل…</p>
        ) : open.length === 0 ? (
          <EmptyState icon={Zap} title="لا توجد طلبات مفتوحة حالياً" desc="عند نشر منشأة لطلب يطابق خدماتك سيظهر هنا" testid="open-empty" />
        ) : (
          <div className="space-y-4">
            {open.map((r) => (
              <div key={r._id} className="card-surface card-surface-hover p-5 space-y-4" data-testid={`open-job-${r._id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-heading font-bold">{r.title}</p>
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5" />
                      {r.business?.business_profile?.company_name || r.business?.name}
                    </p>
                  </div>
                  <StatusBadge kind="request" status={r.status} />
                </div>
                <DetailsGrid r={r} />
                <button data-testid={`apply-job-${r._id}`} disabled={busy}
                  onClick={() => apply(r._id)}
                  className="w-full flex items-center justify-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-4 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
                  <CheckCircle2 className="w-4 h-4" /> {busy === "apply" + r._id ? "جاري الإرسال…" : "قدّم على هذه الفرصة"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
