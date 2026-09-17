import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowRight, MapPin, Calendar, Clock, Users, Star, CheckCircle2,
  XCircle, Lock, Flag, UserCheck, RefreshCcw,
} from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { sar } from "@/lib/constants";
import { useI18n } from "@/i18n";

function Stars({ value, onChange, testid }) {
  return (
    <div className="flex gap-1" data-testid={testid}>
      {[1, 2, 3, 4, 5].map((s) => (
        <button key={s} type="button" onClick={() => onChange?.(s)} data-testid={`${testid}-${s}`}
          className={onChange ? "hover:scale-110 transition-transform" : "cursor-default"}>
          <Star className={`w-5 h-5 ${s <= value ? "fill-amber-400 text-amber-400" : "text-slate-600"}`} />
        </button>
      ))}
    </div>
  );
}

export default function RequestDetail() {
  const { t } = useI18n();
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [ratingFor, setRatingFor] = useState(null);
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState("");
  const [loadQty, setLoadQty] = useState({});

  const load = () => api.get(`/business/requests/${id}`).then(({ data }) => setData(data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, [id]);

  if (!data) return <p className="text-slate-500 text-sm">{t("common.loading")}</p>;
  const { request: r, offers, rated_offer_ids, wallet } = data;
  const acceptedCount = offers.filter((o) => o.status === "accepted").length;
  const activeOffers = offers.filter((o) => !["rejected", "cancelled"].includes(o.status));
  const canConfirm = ["published", "filling"].includes(r.status) && acceptedCount >= r.required_count;
  const canComplete = ["confirmed", "in_progress"].includes(r.status) &&
    offers.some((o) => ["attended", "attendance_confirmed", "driver_completed"].includes(o.status));
  const DURATION_LABEL = { one_day: t("wizard.duration_one_day"), several_days: t("wizard.duration_several_days"), week: t("wizard.duration_week"), month: t("wizard.duration_month") };

  const act = async (key, fn, success) => {
    setBusy(key);
    try {
      const res = await fn();
      toast.success(success);
      await load();
      return res;
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  const submitRating = (offerId) =>
    act(`rate-${offerId}`, () => api.post(`/business/requests/${id}/rate`, { offer_id: offerId, score, comment }),
      t("reqDetail.rateToast")).then((res) => { if (res) { setRatingFor(null); setComment(""); } });

  return (
    <div className="space-y-6" data-testid="request-detail-page">
      <Link to="/app/business/requests" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-brand" data-testid="back-to-requests">
        <ArrowRight className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" /> {t("reqDetail.back")}
      </Link>

      <div className="card-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div>
              <h1 className="heading text-xl font-extrabold">{r.title}</h1>
              <p className="text-sm text-slate-400 mt-1">{t(`svc.${r.service_type}_name`)}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <StatusBadge kind="request" status={r.status} />
                {r.replacement_requested && r.status !== "completed" && (
                  <span className="chip bg-rose-500/10 text-rose-400 border-rose-500/30 animate-pulse-soft">
                    <RefreshCcw className="w-3 h-3" /> {t("reqDetail.replacementBadge")}
                  </span>
                )}
                {r.is_demo && <span className="chip bg-navy-700 text-slate-400 border-navy-600">{t("common.demo")}</span>}
              </div>
            </div>
          </div>
          <div className="text-end">
            <p className="text-[11px] text-slate-500">{t("reqDetail.estCost")}</p>
            <p className="heading text-2xl font-black text-brand num">{sar(r.estimated_total)}</p>
            <p className="text-[11px] text-slate-500 mt-1">{t("reqDetail.commissionLabel")}: <span className="num">{sar(r.commission)}</span></p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-6 text-sm">
          <div className="bg-navy-800/60 rounded-xl p-3 border border-navy-600/40 flex items-center gap-3">
            <MapPin className="w-4 h-4 text-brand shrink-0" />
            <div><p className="text-[11px] text-slate-500">{t("reqDetail.location")}</p><p className="font-semibold mt-0.5">{r.city} — {r.address}</p></div>
          </div>
          <div className="bg-navy-800/60 rounded-xl p-3 border border-navy-600/40 flex items-center gap-3">
            <Calendar className="w-4 h-4 text-brand shrink-0" />
            <div><p className="text-[11px] text-slate-500">{t("reqDetail.date")}</p><p className="font-semibold mt-0.5 num">{r.start_date}</p></div>
          </div>
          <div className="bg-navy-800/60 rounded-xl p-3 border border-navy-600/40 flex items-center gap-3">
            <Clock className="w-4 h-4 text-brand shrink-0" />
            <div><p className="text-[11px] text-slate-500">{t("reqDetail.timeDuration")}</p><p className="font-semibold mt-0.5"><span className="num">{r.start_time}</span> · {DURATION_LABEL[r.duration_type] || r.duration_type} (<span className="num">{r.duration_days}</span> {t("wizard.day")})</p></div>
          </div>
          <div className="bg-navy-800/60 rounded-xl p-3 border border-navy-600/40 flex items-center gap-3">
            <Users className="w-4 h-4 text-brand shrink-0" />
            <div><p className="text-[11px] text-slate-500">{t("reqDetail.countRate")}</p><p className="font-semibold mt-0.5"><span className="num">{r.required_count}</span> × <span className="num">{sar(r.rate)}</span> {t("opp.perShipment")}</p></div>
          </div>
        </div>
        {(r.shipment_count || r.vehicle_type || r.requirements) && (
          <div className="mt-3 bg-navy-800/60 rounded-xl p-4 border border-navy-600/40 text-sm space-y-1.5">
            {r.shipment_count && <p><span className="text-slate-500">{t("reqDetail.shipmentsExpected")}:</span> <span className="num font-semibold">{r.shipments_per_driver ? `${r.shipments_per_driver} ${t("reqDetail.perDriver")} (${t("reqDetail.totalShipments")} ${r.shipment_count})` : r.shipment_count}</span></p>}
            {r.vehicle_type && <p><span className="text-slate-500">{t("reqDetail.vehicleType")}:</span> <span className="font-semibold">{r.vehicle_type}</span></p>}
            {r.requirements && <p><span className="text-slate-500">{t("reqDetail.requirements")}:</span> {r.requirements}</p>}
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3" data-testid="pricing-breakdown">
          {[
            [t("reqDetail.base"), sar(r.estimated_total)],
            [`${t("reqDetail.commissionLabel")} (${Math.round((r.commission_rate ?? 0.10) * 100)}%)`, sar(r.commission)],
            [t("reqDetail.driversNet"), sar(r.payout_total)],
            [t("reqDetail.perDriverNet"), sar(Math.round((r.payout_total / r.required_count) * 100) / 100)],
          ].map(([k, v]) => (
            <div key={k} className="bg-brand/5 rounded-xl p-3 border border-brand/20">
              <p className="text-[11px] text-slate-500">{k}</p>
              <p className="font-heading font-bold text-brand num mt-1">{v}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 mt-6 pt-5 border-t border-navy-600/40">
          {r.status === "draft" && (
            <button
              data-testid="publish-request-btn"
              disabled={busy === "publish"}
              onClick={() => act("publish", () => api.post(`/business/requests/${id}/publish`, { terms: true }), t("reqDetail.publishDone"))}
              className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-5 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-40 transition-colors"
            >
              {busy === "publish" ? t("reqDetail.publishing") : t("reqDetail.publish")}
            </button>
          )}
          {["published", "filling"].includes(r.status) && (
            <button
              data-testid="confirm-request-btn"
              disabled={!canConfirm || busy === "confirm"}
              onClick={() => act("confirm", () => api.post(`/business/requests/${id}/confirm`), t("reqDetail.confirmedToast"))}
              className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-5 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-40 transition-colors"
            >
              <Lock className="w-4 h-4" />
              {busy === "confirm" ? t("reqDetail.confirming") : `${t("reqDetail.confirm")} — ${sar(r.estimated_total)}`}
            </button>
          )}
          {["published", "filling"].includes(r.status) && !canConfirm && (
            <p className="text-xs text-amber-400 self-center" data-testid="confirm-hint">
              {t("reqDetail.confirmHint", { n: r.required_count - acceptedCount })} <span className="num">{sar(wallet.available)}</span>
            </p>
          )}
          {canComplete && (
            <button
              data-testid="complete-request-btn"
              disabled={busy === "complete"}
              onClick={() => act("complete", () => api.post(`/business/requests/${id}/complete`), t("reqDetail.completeToast"))}
              className="flex items-center gap-2 bg-green-500 text-navy-900 font-bold rounded-xl px-5 py-2.5 text-sm hover:bg-green-400 disabled:opacity-40 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              {busy === "complete" ? t("reqDetail.completing") : t("reqDetail.complete")}
            </button>
          )}
          {!["completed", "cancelled"].includes(r.status) && (
            <button
              data-testid="cancel-request-btn"
              disabled={busy === "cancel"}
              onClick={() => act("cancel", () => api.post(`/business/requests/${id}/cancel`, {}), t("reqDetail.cancelToast"))}
              className="flex items-center gap-2 border border-rose-500/40 text-rose-400 font-semibold rounded-xl px-5 py-2.5 text-sm hover:bg-rose-500/10 disabled:opacity-40 transition-colors"
            >
              <XCircle className="w-4 h-4" /> {t("reqDetail.cancelRequest")}
            </button>
          )}
          <Link to="/app/support" data-testid="report-problem-btn"
            className="flex items-center gap-2 border border-navy-600 text-slate-300 font-semibold rounded-xl px-5 py-2.5 text-sm hover:border-amber-500/40 hover:text-amber-400 transition-colors">
            <Flag className="w-4 h-4" /> {t("reqDetail.report")}
          </Link>
        </div>
      </div>

      <div>
        <h2 className="heading text-lg font-bold mb-4">
          {t("reqDetail.candidates")} <span className="text-sm text-slate-500 font-normal num">({activeOffers.length})</span>
        </h2>
        {activeOffers.length === 0 ? (
          <div className="card-surface p-8 text-center text-sm text-slate-500" data-testid="no-offers">
            {t("reqDetail.noOffers")}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {activeOffers.map((o) => (
              <div key={o._id} className="card-surface p-5 space-y-4" data-testid={`offer-card-${o._id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-navy-700 border border-navy-600 flex items-center justify-center font-heading font-bold text-brand">
                      {o.worker?.name?.[0] || "؟"}
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{o.worker?.name}</p>
                      <p className="text-[11px] text-slate-500 num">{o.worker?.phone || t("reqDetail.phoneAfterAccept")}</p>
                    </div>
                  </div>
                  <StatusBadge kind="offer" status={o.status} />
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  {o.worker?.worker_profile?.rating && (
                    <span className="flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      <span className="num">{o.worker.worker_profile.rating}</span>
                    </span>
                  )}
                  <span>{t("reqDetail.jobsDone")}: <span className="num">{o.worker?.worker_profile?.jobs_completed || 0}</span></span>
                  {o.is_replacement && <span className="text-rose-400">{t("reqDetail.replacementOffer")}</span>}
                </div>

                {["confirmed", "attendance_confirmed"].includes(o.status) && ["confirmed", "in_progress"].includes(r.status) && (
                  <div className="flex gap-2 pt-1">
                    <button
                      data-testid={`attend-btn-${o._id}`}
                      disabled={busy === `att-${o._id}`}
                      onClick={() => act(`att-${o._id}`, () => api.post(`/business/requests/${id}/attendance/${o._id}`, { result: "attended" }), t("reqDetail.attendToast"))}
                      className="flex-1 flex items-center justify-center gap-2 bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-semibold rounded-xl px-3 py-2 text-xs hover:bg-emerald-500/25 transition-colors"
                    >
                      <UserCheck className="w-3.5 h-3.5" /> {t("reqDetail.attend")}
                    </button>
                    <button
                      data-testid={`noshow-btn-${o._id}`}
                      disabled={busy === `no-${o._id}`}
                      onClick={() => act(`no-${o._id}`, () => api.post(`/business/requests/${id}/attendance/${o._id}`, { result: "no_show" }), t("reqDetail.noShowToast"))}
                      className="flex-1 flex items-center justify-center gap-2 bg-rose-500/10 border border-rose-500/30 text-rose-400 font-semibold rounded-xl px-3 py-2 text-xs hover:bg-rose-500/20 transition-colors"
                    >
                      <XCircle className="w-3.5 h-3.5" /> {t("reqDetail.noShow")}
                    </button>
                  </div>
                )}

                {["attended", "attendance_confirmed", "driver_completed"].includes(o.status) && (
                  <div className="pt-1">
                    {o.loaded_qty == null ? (
                      <div className="flex items-center gap-2" data-testid={`loading-form-${o._id}`}>
                        <input type="number" min="0" value={loadQty[o._id] ?? ""}
                          onChange={(e) => setLoadQty({ ...loadQty, [o._id]: e.target.value })}
                          placeholder={t("reqDetail.loadingQtyPh")} data-testid={`loading-qty-${o._id}`}
                          className="w-32 bg-navy-800 border border-navy-600 rounded-xl px-3 py-2 text-xs num focus:outline-none focus:ring-1 focus:ring-brand" />
                        <button
                          data-testid={`loading-save-${o._id}`}
                          disabled={busy === `load-${o._id}` || !loadQty[o._id]}
                          onClick={() => act(`load-${o._id}`,
                            () => api.post(`/business/requests/${id}/loading`, { offer_id: o._id, qty: Number(loadQty[o._id]) }),
                            t("reqDetail.loadingSaved"))}
                          className="bg-brand text-navy-900 font-bold rounded-xl px-4 py-2 text-xs hover:bg-brand-hover disabled:opacity-40 transition-colors"
                        >
                          {t("reqDetail.recordLoading")}
                        </button>
                      </div>
                    ) : (
                      <p className={`text-[11px] flex items-center gap-1.5 ${o.loading_disputed ? "text-rose-400" : "text-emerald-400"}`}>
                        {o.loading_disputed
                          ? t("reqDetail.loadDisputedByDriver")
                          : o.loading_confirmed
                            ? t("reqDetail.loadConfirmedByDriver")
                            : t("reqDetail.awaitingLoadConfirm")}
                        — <span className="num font-bold">{o.loaded_qty}</span>
                      </p>
                    )}
                  </div>
                )}

                {o.status === "paid" && !rated_offer_ids.includes(o._id) && (
                  ratingFor === o._id ? (
                    <div className="space-y-3 pt-1" data-testid={`rating-form-${o._id}`}>
                      <Stars value={score} onChange={setScore} testid={`stars-${o._id}`} />
                      <div className="flex gap-2">
                        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("reqDetail.rateComment")}
                          data-testid={`rating-comment-${o._id}`}
                          className="flex-1 bg-navy-800 border border-navy-600 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand" />
                        <button onClick={() => submitRating(o._id)} data-testid={`rating-submit-${o._id}`}
                          className="bg-amber-400 text-navy-900 font-bold rounded-xl px-4 text-xs hover:bg-amber-300">
                          {t("common.send")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setRatingFor(o._id); setScore(5); }} data-testid={`rate-btn-${o._id}`}
                      className="w-full flex items-center justify-center gap-2 border border-amber-500/30 text-amber-400 rounded-xl px-3 py-2 text-xs font-semibold hover:bg-amber-500/10 transition-colors">
                      <Star className="w-3.5 h-3.5" /> {t("reqDetail.rate")} — <span className="num">{sar(o.earning)}</span>
                    </button>
                  )
                )}
                {o.status === "paid" && rated_offer_ids.includes(o._id) && (
                  <p className="text-[11px] text-green-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {t("reqDetail.rated")} <span className="num">{sar(o.earning)}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
