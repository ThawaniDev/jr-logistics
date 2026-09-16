import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Briefcase, MapPin, Calendar, CheckCircle2, Star, Flag } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { sar } from "@/lib/constants";

function Stars({ value, onChange, testid }) {
  return (
    <div className="flex gap-1" data-testid={testid}>
      {[1, 2, 3, 4, 5].map((s) => (
        <button key={s} type="button" onClick={() => onChange?.(s)} data-testid={`${testid}-${s}`}>
          <Star className={`w-5 h-5 ${s <= value ? "fill-amber-400 text-amber-400" : "text-slate-600"}`} />
        </button>
      ))}
    </div>
  );
}

export default function WorkerJobs() {
  const [jobs, setJobs] = useState(null);
  const [history, setHistory] = useState(null);
  const [ratedIds, setRatedIds] = useState([]);
  const [ratingFor, setRatingFor] = useState(null);
  const [score, setScore] = useState(5);

  const load = () => {
    api.get("/worker/jobs").then(({ data }) => setJobs(data.jobs)).catch(() => {});
    api.get("/worker/history").then(({ data }) => { setHistory(data.history); setRatedIds(data.rated_offer_ids); }).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const checkin = async (offerId) => {
    try {
      await api.post(`/worker/offers/${offerId}/checkin`);
      toast.success("تم تسجيل حضورك — بانتظار تأكيد المنشأة");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const rate = async (offerId) => {
    try {
      await api.post("/worker/rate", { offer_id: offerId, score });
      toast.success("تم إرسال تقييمك للمنشأة");
      setRatingFor(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-8" data-testid="my-jobs-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">مهامي</h1>
        <p className="text-sm text-slate-400 mt-1">مهامك المقبولة والمؤكدة وسجل أعمالك السابقة</p>
      </div>

      <section>
        <h2 className="heading text-lg font-bold mb-4">نشطة الآن</h2>
        {!jobs ? (
          <p className="text-slate-500 text-sm">جاري التحميل…</p>
        ) : jobs.length === 0 ? (
          <EmptyState icon={Briefcase} title="لا توجد مهام نشطة" desc="اقبل الفرص المتاحة لتظهر هنا" testid="active-jobs-empty">
            <Link to="/app/worker/opportunities" className="mt-2 inline-block bg-brand text-navy-900 font-bold rounded-xl px-5 py-2.5 text-sm hover:bg-brand-hover">
              تصفح الفرص
            </Link>
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {jobs.map((o) => (
              <div key={o._id} className="card-surface p-5 space-y-3" data-testid={`job-${o._id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-heading font-bold">{o.request?.title}</p>
                    <p className="text-xs text-slate-400 mt-1">{o.business?.business_profile?.company_name || o.business?.name}</p>
                  </div>
                  <StatusBadge kind="offer" status={o.status} />
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-brand" /> {o.request?.city} — {o.request?.address}</span>
                  <span className="flex items-center gap-1 num"><Calendar className="w-3.5 h-3.5 text-brand" /> {o.request?.start_date} · {o.request?.start_time}</span>
                  <span className="text-slate-500">العائد المتوقع: <span className="num text-brand font-semibold">{o.request && sar(Math.round((o.request.estimated_total / o.request.required_count) * 0.9))}</span></span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {o.status === "confirmed" && (
                    <button data-testid={`checkin-${o._id}`} onClick={() => checkin(o._id)}
                      className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-5 py-2.5 text-xs hover:bg-brand-hover transition-colors">
                      <CheckCircle2 className="w-4 h-4" /> تسجيل الحضور في الموقع
                    </button>
                  )}
                  {o.status === "accepted" && (
                    <p className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/25 rounded-xl px-4 py-2.5">
                      بانتظار تأكيد المنشأة وحجز المبلغ
                    </p>
                  )}
                  <Link to="/app/support" data-testid={`report-${o._id}`}
                    className="flex items-center gap-2 border border-navy-600 text-slate-300 rounded-xl px-4 py-2.5 text-xs hover:border-amber-500/40 hover:text-amber-400 transition-colors">
                    <Flag className="w-3.5 h-3.5" /> الإبلاغ عن مشكلة
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="heading text-lg font-bold mb-4">سجل الأعمال</h2>
        {!history ? (
          <p className="text-slate-500 text-sm">جاري التحميل…</p>
        ) : history.length === 0 ? (
          <EmptyState icon={Briefcase} title="لا يوجد سجل بعد" desc="مهامك المكتملة وأرباحها ستظهر هنا" testid="history-empty" />
        ) : (
          <div className="space-y-3">
            {history.map((o) => (
              <div key={o._id} className="card-surface p-4 flex flex-wrap items-center gap-4" data-testid={`history-${o._id}`}>
                <div className="flex-1 min-w-[200px]">
                  <p className="font-semibold text-sm">{o.request?.title}</p>
                  <p className="text-xs text-slate-500 mt-1 num">{o.request?.start_date}</p>
                </div>
                {o.status === "paid" && <p className="text-sm font-bold text-green-300 num">+{sar(o.earning)}</p>}
                <StatusBadge kind="offer" status={o.status} />
                {o.status === "paid" && !ratedIds.includes(o._id) && (
                  ratingFor === o._id ? (
                    <div className="flex items-center gap-2">
                      <Stars value={score} onChange={setScore} testid={`wstars-${o._id}`} />
                      <button onClick={() => rate(o._id)} data-testid={`wrate-submit-${o._id}`}
                        className="bg-amber-400 text-navy-900 font-bold rounded-xl px-4 py-2 text-xs hover:bg-amber-300">
                        إرسال
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => { setRatingFor(o._id); setScore(5); }} data-testid={`wrate-${o._id}`}
                      className="flex items-center gap-1.5 border border-amber-500/30 text-amber-400 rounded-xl px-3 py-2 text-xs font-semibold hover:bg-amber-500/10">
                      <Star className="w-3.5 h-3.5" /> قيّم المنشأة
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
