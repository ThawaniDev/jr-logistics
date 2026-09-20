import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Zap, MapPin, Calendar, Clock, Users, CheckCircle2, XCircle, Building2, ScrollText, X, Briefcase } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { sar } from "@/lib/constants";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";

function DetailsGrid({ r }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const wp = user?.worker_profile || {};
  const hidePricing = wp.provider_type === "office" && wp.provider_status === "linked";
  const DURATION_LABEL = { one_day: t("wizard.duration_one_day"), several_days: t("wizard.duration_several_days"), week: t("wizard.duration_week"), month: t("wizard.duration_month") };
  const shipments = r.shipments_per_driver ?? (r.shipment_count ? Math.round(r.shipment_count / r.required_count) : null);
  const perShipmentNet = !hidePricing && shipments ? Math.round(((r.expected_earning || 0) / shipments) * 100) / 100 : 0;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
      <div className="bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
        <p className="text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3" /> {t("opp.location")}</p>
        <p className="font-semibold mt-1">{r.city} — {r.address}</p>
      </div>
      <div className="bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
        <p className="text-slate-500 flex items-center gap-1"><Calendar className="w-3 h-3" /> {t("opp.date")}</p>
        <p className="font-semibold mt-1 num">{r.start_date}</p>
      </div>
      <div className="bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
        <p className="text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {t("opp.timeDuration")}</p>
        <p className="font-semibold mt-1"><span className="num">{r.start_time}</span> · {DURATION_LABEL[r.duration_type] || r.duration_type}</p>
      </div>
      {!hidePricing ? (
        <div className="bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
          <p className="text-slate-500 flex items-center gap-1"><Users className="w-3 h-3" /> {t("opp.expectedEarnings")}</p>
          <p className="font-semibold mt-1 text-brand num">{sar(r.expected_earning ?? 0)}</p>
        </div>
      ) : (
        <div className="bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40" data-testid="office-pricing-hidden">
          <p className="text-slate-500 flex items-center gap-1"><Users className="w-3 h-3" /> {t("office.shipments")}</p>
          <p className="font-semibold mt-1 num">{shipments ?? "—"}</p>
        </div>
      )}
      {shipments && !hidePricing && (
        <div className="col-span-2 bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
          <p className="text-slate-500">{t("opp.shipmentsLabel")}</p>
          <p className="font-semibold mt-1 num">{shipments} {t("opp.shipmentUnit")} × {sar(perShipmentNet)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{t("opp.shipmentsNote")}</p>
        </div>
      )}
      {r.vehicle_type && (
        <div className="col-span-2 bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
          <p className="text-slate-500">{t("opp.vehicleReq")}</p>
          <p className="font-semibold mt-1">{r.vehicle_type}</p>
        </div>
      )}
      {r.requirements && (
        <div className="col-span-2 sm:col-span-4 bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40">
          <p className="text-slate-500">{t("opp.bizNotes")}</p>
          <p className="font-semibold mt-1 leading-relaxed">{r.requirements}</p>
        </div>
      )}
      {!hidePricing && (
        <div className="col-span-2 sm:col-span-4 text-[11px] text-slate-500">
          {t("opp.rateNote")}: <span className="num text-slate-300">{sar(perShipmentNet)}</span> {t("opp.perShipment")}
        </div>
      )}
    </div>
  );
}

function TermsModal({ onConfirm, onClose, busy }) {
  const { t } = useI18n();
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="terms-modal">
      <div className="absolute inset-0 bg-navy-950/85 backdrop-blur-sm" onClick={onClose} />
      <div className="relative card-surface w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="heading text-lg font-extrabold flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-brand" /> {t("terms.title")}
          </h3>
          <button onClick={onClose} data-testid="terms-close" className="text-slate-400 hover:text-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <ul className="space-y-2 text-sm text-slate-300">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <li key={i} className="flex gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-brand shrink-0 mt-0.5" />
              <span>{t(`terms.i${i}`)}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-slate-500 leading-relaxed bg-navy-800/60 rounded-xl p-3 border border-navy-600/40">
          {t("terms.note")}
        </p>
        <label className="flex items-start gap-3 cursor-pointer text-sm" data-testid="terms-agree-wrap">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
            data-testid="terms-agree-checkbox"
            className="mt-1 w-4 h-4 accent-emerald-400" />
          <span>{t("terms.agree")}</span>
        </label>
        <button disabled={!agreed || busy} onClick={onConfirm} data-testid="terms-confirm-btn"
          className="w-full h-11 bg-brand text-navy-900 font-bold rounded-xl hover:bg-brand-hover transition-colors disabled:opacity-40">
          {busy ? t("opp.applying") : t("terms.confirm")}
        </button>
      </div>
    </div>
  );
}

export default function WorkerOpportunities() {
  const { t } = useI18n();
  const [offers, setOffers] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState("");
  const [termsFor, setTermsFor] = useState(null); // { kind: "offer"|"apply", id }
  const [hasActive, setHasActive] = useState(false);

  const load = () => {
    api.get("/worker/offers").then(({ data }) => { setOffers(data.offers); if (data.has_active_job) setHasActive(true); }).catch(() => {});
    api.get("/worker/available").then(({ data }) => { setOpen(data.jobs); if (data.has_active_job) setHasActive(true); }).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const respond = async (offerId, action, terms = false) => {
    setBusy(offerId + action);
    try {
      await api.post(`/worker/offers/${offerId}/respond`, { action, terms });
      toast.success(action === "accept" ? t("opp.acceptedToast") : t("opp.declinedToast"));
      setTermsFor(null);
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
      await api.post("/worker/apply", { request_id: requestId, terms: true });
      toast.success(t("opp.appliedToast"));
      setTermsFor(null);
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
        <h1 className="heading text-2xl font-extrabold">{t("opp.title")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("opp.sub")}</p>
      </div>

      {hasActive && (
        <div className="card-surface p-6 border-brand/30 bg-brand/5 flex items-center gap-4" data-testid="active-job-notice">
          <Briefcase className="w-6 h-6 text-brand shrink-0" />
          <div className="flex-1">
            <p className="font-bold text-sm">{t("opp.activeJobNotice")}</p>
            <p className="text-xs text-slate-400 mt-1">{t("opp.activeJobNoticeDesc")}</p>
          </div>
          <Link to="/app/worker/jobs" data-testid="active-job-link"
            className="bg-brand text-navy-900 font-bold rounded-xl px-4 py-2 text-xs hover:bg-brand-hover transition-colors">
            {t("opp.goToJob")}
          </Link>
        </div>
      )}

      {!hasActive && (
      <section>
        <h2 className="heading text-lg font-bold mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" /> {t("opp.directed")}
        </h2>
        {!offers ? (
          <p className="text-slate-500 text-sm">{t("common.loading")}</p>
        ) : offers.length === 0 ? (
          <EmptyState icon={Zap} title={t("opp.noOffers")} desc={t("opp.noOffersDesc")} testid="offers-empty" />
        ) : (
          <div className="space-y-4">
            {offers.map((o) => (
              <div key={o._id} className="card-surface card-surface-hover p-5 space-y-4" data-testid={`offer-${o._id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-heading font-bold">{o.request?.title}</p>
                      {o.is_replacement && <span className="chip bg-rose-500/10 text-rose-400 border-rose-500/30">{t("opp.replacementOffer")}</span>}
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
                    onClick={() => setTermsFor({ kind: "offer", id: o._id })}
                    className="flex-1 flex items-center justify-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-4 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
                    <CheckCircle2 className="w-4 h-4" /> {t("opp.accept")}
                  </button>
                  <button data-testid={`reject-offer-${o._id}`} disabled={busy}
                    onClick={() => respond(o._id, "reject")}
                    className="flex-1 flex items-center justify-center gap-2 border border-navy-600 text-slate-300 font-semibold rounded-xl px-4 py-2.5 text-sm hover:border-rose-500/40 hover:text-rose-400 disabled:opacity-50 transition-colors">
                    <XCircle className="w-4 h-4" /> {t("opp.decline")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {!hasActive && (
      <section>
        <h2 className="heading text-lg font-bold mb-4">{t("opp.openJobs")}</h2>
        {!open ? (
          <p className="text-slate-500 text-sm">{t("common.loading")}</p>
        ) : open.length === 0 ? (
          <EmptyState icon={Zap} title={t("opp.noOpen")} desc={t("opp.noOpenDesc")} testid="open-empty" />
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
                  onClick={() => setTermsFor({ kind: "apply", id: r._id })}
                  className="w-full flex items-center justify-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-4 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
                  <CheckCircle2 className="w-4 h-4" /> {busy === "apply" + r._id ? t("opp.applying") : t("opp.apply")}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {termsFor && (
        <TermsModal
          busy={!!busy}
          onClose={() => setTermsFor(null)}
          onConfirm={() =>
            termsFor.kind === "offer" ? respond(termsFor.id, "accept", true) : apply(termsFor.id)
          }
        />
      )}
    </div>
  );
}
