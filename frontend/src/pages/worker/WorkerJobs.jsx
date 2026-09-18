import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Briefcase, MapPin, Calendar, CheckCircle2, Star, Flag, AlertTriangle, XCircle } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { sar } from "@/lib/constants";
import { useI18n } from "@/i18n";
import { Phone, MessageCircle } from "lucide-react";
import { JobChat } from "@/components/JobChat";
import { JobTimeline } from "@/components/JobTimeline";

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
  const { t } = useI18n();
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
      toast.success(t("jobs.checkinDone"));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const finish = async () => {
    if (deliveredQty === "" || Number(deliveredQty) < 0) return toast.error(t("jobs.deliveredQ"));
    try {
      await api.post(`/worker/offers/${finishFor._id}/finish`, { delivered_qty: Number(deliveredQty) });
      toast.success(t("jobs.endDone"));
      setFinishFor(null);
      setDeliveredQty("");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const noWork = async (offerId) => {
    try {
      await api.post(`/worker/offers/${offerId}/no-work`, {});
      toast.success(t("jobs.noWorkDone"));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const [cancelFor, setCancelFor] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [finishFor, setFinishFor] = useState(null);
  const [deliveredQty, setDeliveredQty] = useState("");
  const [openOps, setOpenOps] = useState(null);

  const cancelJob = async (offerId) => {
    if (!cancelReason.trim()) return toast.error(t("jobs.cancelReason"));
    try {
      await api.post(`/worker/offers/${offerId}/cancel`, { reason: cancelReason });
      toast.success(t("jobs.cancelDone"));
      setCancelFor(null);
      setCancelReason("");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const rate = async (offerId) => {
    try {
      await api.post("/worker/rate", { offer_id: offerId, score });
      toast.success(t("jobs.rateSent"));
      setRatingFor(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-8" data-testid="my-jobs-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("jobs.title")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("jobs.sub")}</p>
      </div>

      <section>
        <h2 className="heading text-lg font-bold mb-4">{t("jobs.activeNow")}</h2>
        {!jobs ? (
          <p className="text-slate-500 text-sm">{t("common.loading")}</p>
        ) : jobs.length === 0 ? (
          <EmptyState icon={Briefcase} title={t("jobs.noActive")} desc={t("jobs.acceptOffersHint")} testid="active-jobs-empty">
            <Link to="/app/worker/opportunities" className="mt-2 inline-block bg-brand text-navy-900 font-bold rounded-xl px-5 py-2.5 text-sm hover:bg-brand-hover">
              {t("drvDash.browse")}
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
                  <span className="text-slate-500">{t("jobs.expectedEarnings")}: <span className="num text-brand font-semibold">{o.request && sar(o.request.expected_earning || 0)}</span></span>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px]" data-testid={`qty-strip-${o._id}`}>
                  <span className="chip bg-navy-800 border-navy-600 text-slate-300">{t("jobs.expectedQty")}: <b className="num">{o.request?.shipments_per_driver ?? "—"}</b></span>
                  {o.loaded_qty != null && <span className="chip bg-navy-800 border-navy-600 text-slate-300">{t("jobs.loadedQty")}: <b className="num text-brand">{o.loaded_qty}</b></span>}
                  {o.driver_reported_qty != null && <span className="chip bg-navy-800 border-navy-600 text-slate-300">{t("jobs.reportedQty")}: <b className="num text-blue-400">{o.driver_reported_qty}</b></span>}
                  {o.final_qty != null && <span className="chip bg-navy-800 border-navy-600 text-slate-300">{t("jobs.finalQty")}: <b className="num text-emerald-400">{o.final_qty}</b></span>}
                </div>
                {["accepted", "confirmed", "attendance_confirmed", "attended", "delivered_reported", "pending_settlement", "qty_disputed"].includes(o.status) && (
                  <div className="flex flex-wrap gap-2" data-testid={`contact-row-${o._id}`}>
                    <button data-testid={`call-warehouse-${o._id}`}
                      onClick={async () => { try { const { data } = await api.post(`/jobs/${o._id}/contact`, { channel: "call" }); toast.info(data.message); } catch (e) { toast.error(errMsg(e)); } }}
                      className="flex items-center gap-1.5 text-xs font-semibold border border-navy-600 rounded-xl px-3 py-2 text-slate-300 hover:border-brand/40 hover:text-brand transition-colors">
                      <Phone className="w-3.5 h-3.5" /> {t("opsroom.contactWarehouse")}
                    </button>
                    <button data-testid={`chat-toggle-${o._id}`} onClick={() => setOpenOps(openOps === o._id ? null : o._id)}
                      className="flex items-center gap-1.5 text-xs font-semibold border border-navy-600 rounded-xl px-3 py-2 text-slate-300 hover:border-brand/40 hover:text-brand transition-colors">
                      <MessageCircle className="w-3.5 h-3.5" /> {t("opsroom.chat")}
                    </button>
                  </div>
                )}
                {openOps === o._id && (
                  <div className="space-y-3" data-testid={`ops-room-${o._id}`}>
                    <JobChat offerId={o._id} />
                    <JobTimeline offerId={o._id} />
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {o.status === "confirmed" && (
                    <button data-testid={`checkin-${o._id}`} onClick={() => checkin(o._id)}
                      className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-5 py-2.5 text-xs hover:bg-brand-hover transition-colors">
                      <CheckCircle2 className="w-4 h-4" /> {t("jobs.checkin")}
                    </button>
                  )}
                  {o.status === "attended" && (
                    <button data-testid={`finish-${o._id}`} onClick={() => { setFinishFor(o); setDeliveredQty(""); }}
                      className="flex items-center gap-2 bg-green-500 text-navy-900 font-bold rounded-xl px-5 py-2.5 text-xs hover:bg-green-400 transition-colors">
                      <CheckCircle2 className="w-4 h-4" /> {t("jobs.endOpportunity")}
                    </button>
                  )}
                  {["attended", "driver_completed"].includes(o.status) && o.loaded_qty != null && !o.loading_confirmed && !o.loading_disputed && (
                    <div className="flex items-center gap-2 flex-wrap bg-navy-800/60 rounded-xl px-4 py-2.5 border border-navy-600/40" data-testid={`loading-confirm-${o._id}`}>
                      <span className="text-xs text-slate-300">{t("jobs.loadedQty")}: <b className="num text-brand">{o.loaded_qty}</b></span>
                      <button onClick={async () => {
                        try { await api.post(`/worker/offers/${o._id}/confirm-loading`); toast.success(t("jobs.loadConfirmed")); load(); }
                        catch (e) { toast.error(errMsg(e)); }
                      }} data-testid={`confirm-load-${o._id}`}
                        className="bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-semibold rounded-lg px-3 py-1.5 text-xs hover:bg-emerald-500/25 transition-colors">
                        {t("jobs.confirmLoad")}
                      </button>
                      <button onClick={async () => {
                        try { await api.post(`/worker/offers/${o._id}/dispute-loading`, {}); toast.success(t("jobs.loadDisputed")); load(); }
                        catch (e) { toast.error(errMsg(e)); }
                      }} data-testid={`dispute-load-${o._id}`}
                        className="bg-rose-500/10 border border-rose-500/30 text-rose-400 font-semibold rounded-lg px-3 py-1.5 text-xs hover:bg-rose-500/20 transition-colors">
                        {t("jobs.disputeLoad")}
                      </button>
                    </div>
                  )}
                  {o.loading_confirmed && (
                    <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> {t("jobs.loadConfirmed")} — <span className="num">{o.loaded_qty}</span>
                    </p>
                  )}
                  {o.status === "accepted" && (
                    <p className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/25 rounded-xl px-4 py-2.5">
                      {t("jobs.waitingConfirm")}
                    </p>
                  )}
                  {o.status === "driver_completed" && (
                    <p className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/25 rounded-xl px-4 py-2.5">
                      {t("jobs.finishDone")}
                    </p>
                  )}
                  {o.status === "delivered_reported" && (
                    <p className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/25 rounded-xl px-4 py-2.5" data-testid={`waiting-warehouse-${o._id}`}>
                      {t("jobs.waitingWarehouse")}
                    </p>
                  )}
                  {o.status === "pending_settlement" && (
                    <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-2.5" data-testid={`pending-settlement-${o._id}`}>
                      {t("jobs.pendingSettlement")}
                    </p>
                  )}
                  {o.status === "qty_disputed" && (
                    <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/25 rounded-xl px-4 py-2.5" data-testid={`qty-disputed-${o._id}`}>
                      {t("jobs.qtyDisputed")}
                    </p>
                  )}
                  {["attendance_confirmed", "attended"].includes(o.status) && !o.no_work_reported && (
                    <button data-testid={`nowork-${o._id}`} onClick={() => noWork(o._id)}
                      className="flex items-center gap-2 border border-rose-500/40 text-rose-400 rounded-xl px-4 py-2.5 text-xs hover:bg-rose-500/10 transition-colors">
                      <AlertTriangle className="w-3.5 h-3.5" /> {t("jobs.noWork")}
                    </button>
                  )}
                  {["accepted", "confirmed"].includes(o.status) && (
                    cancelFor === o._id ? (
                      <div className="flex items-center gap-2" data-testid={`cancel-form-${o._id}`}>
                        <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                          placeholder={t("jobs.cancelReason")} data-testid={`cancel-reason-${o._id}`}
                          className="flex-1 bg-navy-800 border border-navy-600 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand" />
                        <button onClick={() => cancelJob(o._id)} data-testid={`cancel-confirm-${o._id}`}
                          className="bg-rose-500 text-white font-bold rounded-xl px-4 py-2.5 text-xs hover:bg-rose-400">
                          {t("jobs.cancelConfirm")}
                        </button>
                      </div>
                    ) : (
                      <button data-testid={`cancel-${o._id}`} onClick={() => { setCancelFor(o._id); setCancelReason(""); }}
                        className="flex items-center gap-2 border border-rose-500/40 text-rose-400 rounded-xl px-4 py-2.5 text-xs hover:bg-rose-500/10 transition-colors">
                        <XCircle className="w-3.5 h-3.5" /> {t("jobs.cancel")}
                      </button>
                    )
                  )}
                  <Link to="/app/support" data-testid={`report-${o._id}`}
                    className="flex items-center gap-2 border border-navy-600 text-slate-300 rounded-xl px-4 py-2.5 text-xs hover:border-amber-500/40 hover:text-amber-400 transition-colors">
                    <Flag className="w-3.5 h-3.5" /> {t("jobs.reportProblem")}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="heading text-lg font-bold mb-4">{t("jobs.history")}</h2>
        {!history ? (
          <p className="text-slate-500 text-sm">{t("common.loading")}</p>
        ) : history.length === 0 ? (
          <EmptyState icon={Briefcase} title={t("jobs.noHistory")} desc={t("jobs.noHistoryDesc")} testid="history-empty" />
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
                        {t("common.send")}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => { setRatingFor(o._id); setScore(5); }} data-testid={`wrate-${o._id}`}
                      className="flex items-center gap-1.5 border border-amber-500/30 text-amber-400 rounded-xl px-3 py-2 text-xs font-semibold hover:bg-amber-500/10">
                      <Star className="w-3.5 h-3.5" /> {t("jobs.rateBiz")}
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {finishFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="end-modal">
          <div className="absolute inset-0 bg-navy-950/85 backdrop-blur-sm" onClick={() => setFinishFor(null)} />
          <div className="relative card-surface w-full max-w-md p-6 space-y-4">
            <h3 className="heading text-lg font-extrabold">{t("jobs.endTitle")}</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-navy-800/70 rounded-xl p-3 border border-navy-600/40">
                <p className="text-[11px] text-slate-500">{t("jobs.expectedQty")}</p>
                <p className="font-bold num mt-1" data-testid="end-expected-qty">{finishFor.request?.shipments_per_driver ?? "—"}</p>
              </div>
              <div className="bg-navy-800/70 rounded-xl p-3 border border-navy-600/40">
                <p className="text-[11px] text-slate-500">{t("jobs.loadedQty")}</p>
                <p className="font-bold num mt-1" data-testid="end-loaded-qty">{finishFor.loaded_qty ?? finishFor.request?.shipments_per_driver ?? "—"}</p>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t("jobs.deliveredQ")}</label>
              <input type="number" min="0" value={deliveredQty} onChange={(e) => setDeliveredQty(e.target.value)}
                data-testid="delivered-qty-input"
                className="w-full bg-navy-800 border border-navy-600 rounded-xl px-3 h-11 text-sm num focus:outline-none focus:ring-1 focus:ring-brand" />
            </div>
            <button onClick={finish} disabled={deliveredQty === ""} data-testid="end-confirm-btn"
              className="w-full h-11 bg-green-500 text-navy-900 font-bold rounded-xl hover:bg-green-400 transition-colors disabled:opacity-40">
              {t("jobs.confirmEnd")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
