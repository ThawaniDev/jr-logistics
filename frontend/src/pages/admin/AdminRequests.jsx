import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ClipboardList, UserPlus, ChevronDown, ChevronUp, X, Sparkles, RefreshCcw } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { REQUEST_STATUS, sar, CITIES } from "@/lib/constants";
import { useI18n } from "@/i18n";

export default function AdminRequests() {
  const { t } = useI18n();
  const [requests, setRequests] = useState(null);
  const [filter, setFilter] = useState("");
  const [city, setCity] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [detail, setDetail] = useState(null);
  const [matchWorker, setMatchWorker] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [suggestBusy, setSuggestBusy] = useState(false);

  const load = () =>
    api.get("/admin/requests", { params: {
      status: filter || undefined, city: city || undefined,
      date_from: dateFrom || undefined, date_to: dateTo || undefined,
    } }).then(({ data }) => {
      const seen = new Set();
      setRequests(data.requests.filter((r) => !seen.has(r._id) && seen.add(r._id)));
    }).catch(() => {});
  useEffect(() => { load(); }, [filter, city, dateFrom, dateTo]);

  const openDetail = async (id) => {
    setSuggestions(null);
    if (detail?.request._id === id) return setDetail(null);
    try {
      const { data } = await api.get(`/admin/requests/${id}`);
      setDetail(data);
      setMatchWorker("");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const doMatch = async () => {
    if (!matchWorker) return toast.error(t("admin.chooseDriver"));
    setBusy(true);
    try {
      await api.post(`/admin/requests/${detail.request._id}/match`, { worker_id: matchWorker });
      toast.success(t("admin.sendOffer"));
      const { data } = await api.get(`/admin/requests/${detail.request._id}`);
      setDetail(data);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-requests-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("admin.reqTitle")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("admin.reqSub")}</p>
      </div>

      <div className="flex gap-2 flex-wrap items-center" data-testid="admin-request-filters">
        <button onClick={() => setFilter("")} data-testid="afilter-all"
          className={`chip ${!filter ? "bg-brand/15 text-brand border-brand/40" : "bg-navy-800 text-slate-400 border-navy-600"}`}>
          {t("common.all")}
        </button>
        {Object.entries(REQUEST_STATUS).map(([k, v]) => (
          <button key={k} onClick={() => setFilter(k)} data-testid={`afilter-${k}`}
            className={`chip ${filter === k ? v.cls : "bg-navy-800 text-slate-400 border-navy-600"}`}>
            {t(`status.${k}`)}
          </button>
        ))}
      </div>
      <div className="flex gap-3 flex-wrap items-center" data-testid="admin-request-cf-filters">
        <select value={city} onChange={(e) => setCity(e.target.value)} data-testid="afilter-city"
          className="bg-navy-800 border border-navy-600 rounded-md px-3 h-10 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
          <option value="">{t("admin.allCities")}</option>
          {CITIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="afilter-date-from"
          className="bg-navy-800 border border-navy-600 rounded-md px-3 h-10 text-sm num focus:outline-none focus:ring-1 focus:ring-brand" />
        <span className="text-slate-500 text-xs">{t("admin.dateTo")}</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="afilter-date-to"
          className="bg-navy-800 border border-navy-600 rounded-md px-3 h-10 text-sm num focus:outline-none focus:ring-1 focus:ring-brand" />
      </div>

      {!requests ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : requests.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t("requestsPage.empty")} testid="admin-requests-empty" />
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r._id} className="card-surface overflow-hidden" data-testid={`admin-request-${r._id}`}>
              <button onClick={() => openDetail(r._id)} data-testid={`admin-request-toggle-${r._id}`}
                className="w-full flex flex-wrap items-center gap-4 p-4 text-start hover:bg-navy-700/20 transition-colors">
                <div className="flex-1 min-w-[220px]">
                  <p className="font-semibold text-sm">{r.title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {r.business?.business_profile?.company_name || r.business?.name} · {r.city} · <span className="num">{r.start_date}</span>
                  </p>
                </div>
                <div className="text-xs text-slate-400">
                  {t("admin.acceptedShort")} <span className="num text-blue-400 font-bold">{r.counts.accepted + r.counts.confirmed + r.counts.attended + r.counts.paid}</span>
                  <span className="num text-slate-600"> / {r.required_count}</span>
                  {r.counts.no_show > 0 && <span className="text-rose-400 ms-2">{t("admin.noShowShort")}: <span className="num">{r.counts.no_show}</span></span>}
                </div>
                <p className="font-heading font-bold text-brand num text-sm">{sar(r.estimated_total)}</p>
                <StatusBadge kind="request" status={r.status} pulse={r.replacement_requested && r.status !== "completed"} />
                {detail?.request._id === r._id ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
              </button>

              {detail?.request._id === r._id && (
                <div className="border-t border-navy-600/50 p-5 bg-navy-850/40 space-y-4" data-testid={`admin-request-detail-${r._id}`}>
                  <div className="grid sm:grid-cols-3 gap-3 text-xs">
                    <div className="bg-navy-800 rounded-xl p-3 border border-navy-600/40">
                      <p className="text-slate-500">{t("admin.businessCol")}</p>
                      <p className="font-semibold mt-1">{detail.business?.business_profile?.company_name || detail.business?.name}</p>
                      <p className="text-slate-500 num mt-0.5">{detail.business?.phone}</p>
                    </div>
                    <div className="bg-navy-800 rounded-xl p-3 border border-navy-600/40">
                      <p className="text-slate-500">{t("admin.serviceCount")}</p>
                      <p className="font-semibold mt-1">{t(`svc.${r.service_type}_name`)}</p>
                      <p className="text-slate-500 mt-0.5">{t("admin.countLabel")}: <span className="num">{r.required_count}</span> · <span className="num">{sar(r.rate)}</span> {t("opp.perShipment")}</p>
                    </div>
                    <div className="bg-navy-800 rounded-xl p-3 border border-navy-600/40">
                      <p className="text-slate-500">{t("admin.costCol")}</p>
                      <p className="font-semibold mt-1 text-brand num">{sar(r.estimated_total)}</p>
                      <p className="text-slate-500 mt-0.5">{t("admin.commission")}: <span className="num">{sar(r.commission)}</span></p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-400 mb-2">{t("admin.offers")} (<span className="num">{detail.offers.length}</span>)</p>
                    <div className="flex flex-wrap gap-2">
                      {detail.offers.map((o) => (
                        <div key={o._id} className="chip bg-navy-800 border-navy-600" data-testid={`admin-offer-${o._id}`}>
                          {o.worker?.name}
                          <StatusBadge kind="offer" status={o.status} />
                        </div>
                      ))}
                      {detail.offers.length === 0 && <p className="text-xs text-slate-500">{t("admin.noOffersYet")}</p>}
                    </div>
                  </div>

                  {["published", "filling", "confirmed", "in_progress"].includes(r.status) && (
                    <div className="flex flex-wrap gap-3 items-end pt-2 border-t border-navy-600/40">
                      <div className="flex-1 min-w-[220px]">
                        <label className="text-[11px] text-slate-500 block mb-1.5">{t("admin.manualMatch")}</label>
                        <select data-testid={`match-select-${r._id}`} value={matchWorker} onChange={(e) => setMatchWorker(e.target.value)}
                          className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-10 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
                          <option value="">{t("admin.chooseDriver")}</option>
                          {detail.candidates.map((c) => (
                            <option key={c._id} value={c._id}>
                              {c.name} — {c.city} {c.worker_profile?.rating ? `(${c.worker_profile.rating}★)` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button onClick={doMatch} disabled={busy} data-testid={`match-btn-${r._id}`}
                        className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-5 h-10 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
                        <UserPlus className="w-4 h-4" /> {t("admin.sendOffer")}
                      </button>
                      <button onClick={() => setDetail(null)} className="text-slate-500 hover:text-slate-300" data-testid={`match-close-${r._id}`}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {detail.offers.some((o) => ["offered", "accepted", "confirmed", "attendance_confirmed"].includes(o.status)) && (
                    <div className="flex flex-wrap gap-2 pt-2" data-testid={`replace-row-${r._id}`}>
                      {detail.offers.filter((o) => ["offered", "accepted", "confirmed", "attendance_confirmed"].includes(o.status)).map((o) => (
                        <button key={o._id} data-testid={`replace-${o._id}`}
                          onClick={async () => {
                            const reason = window.prompt(t("smart.replaceReason"));
                            if (!reason) return;
                            try {
                              await api.post(`/admin/offers/${o._id}/replace`, { reason });
                              toast.success(t("smart.replaced"));
                              const { data } = await api.get(`/admin/requests/${r._id}`);
                              setDetail(data);
                              load();
                            } catch (e) { toast.error(errMsg(e)); }
                          }}
                          className="flex items-center gap-1.5 text-[11px] border border-rose-500/40 text-rose-400 rounded-lg px-3 py-1.5 hover:bg-rose-500/10 transition-colors">
                          <RefreshCcw className="w-3 h-3" /> {t("smart.replace")} — {o.worker?.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {["published", "filling", "confirmed", "in_progress"].includes(r.status) && r.service_type !== "car_without_driver" && (
                    <div className="pt-2 border-t border-navy-600/40" data-testid={`smart-area-${r._id}`}>
                      <button data-testid={`smart-suggest-${r._id}`} disabled={suggestBusy}
                        onClick={async () => {
                          setSuggestBusy(true);
                          try {
                            const { data } = await api.get(`/admin/requests/${r._id}/smart-suggest`);
                            setSuggestions(data.suggestions);
                          } catch (e) { toast.error(errMsg(e)); } finally { setSuggestBusy(false); }
                        }}
                        className="flex items-center gap-2 border border-brand/40 text-brand rounded-xl px-4 py-2 text-xs font-semibold hover:bg-brand/10 transition-colors">
                        <Sparkles className="w-3.5 h-3.5" /> {suggestBusy ? t("smart.loading") : t("smart.suggest")}
                      </button>
                      {suggestions && (
                        <div className="mt-3 space-y-2" data-testid={`smart-list-${r._id}`}>
                          {suggestions.length === 0 && <p className="text-xs text-slate-500">{t("smart.noSuggest")}</p>}
                          {suggestions.slice(0, 8).map((s) => (
                            <div key={s.driver._id} data-testid={`suggest-${s.driver._id}`}
                              className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-xs ${s.eligible ? "border-navy-600/50 bg-navy-800/60" : "border-navy-700/40 bg-navy-850/40 opacity-70"}`}>
                              <span className="font-semibold">{s.driver.name}</span>
                              <span className={`chip ${s.driver.affiliation === "office" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" : "bg-brand/10 text-brand border-brand/30"}`}>
                                {t(s.driver.affiliation === "office" ? "smart.officeDriver" : "smart.platformDriver")}
                              </span>
                              <span className="text-slate-500">{s.driver.city}</span>
                              {s.driver.rating != null && <span className="num text-amber-400">{s.driver.rating}★</span>}
                              <span className="chip bg-navy-700 text-slate-300 border-navy-600">{t("smart.score")}: <b className="num">{s.score}</b></span>
                              {s.eligible ? (
                                <button data-testid={`suggest-assign-${s.driver._id}`} disabled={busy}
                                  onClick={async () => {
                                    setBusy(true);
                                    try {
                                      await api.post(`/admin/requests/${r._id}/match`, { worker_id: s.driver._id });
                                      toast.success(t("admin.sendOffer"));
                                      const { data } = await api.get(`/admin/requests/${r._id}`);
                                      setDetail(data);
                                      load();
                                    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
                                  }}
                                  className="ms-auto bg-brand text-navy-900 font-bold rounded-lg px-3 py-1.5 hover:bg-brand-hover disabled:opacity-50">
                                  {t("smart.pick")}
                                </button>
                              ) : (
                                <span className="ms-auto text-rose-400/80">{s.reasons.map((rk) => t(`smart.r_${rk}`)).join(" · ")}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {detail.assignment_history?.length > 0 && (
                    <div className="pt-2 border-t border-navy-600/40" data-testid={`assign-history-${r._id}`}>
                      <p className="text-xs font-semibold text-slate-400 mb-2">{t("smart.history")}</p>
                      <div className="space-y-1">
                        {detail.assignment_history.slice(0, 10).map((h) => (
                          <p key={h._id} className="text-[11px] text-slate-500">
                            <span className="text-slate-300">{h.actor_name}</span> · {t(`smart.act_${h.action}`)}
                            {h.reason ? ` — ${h.reason}` : ""} · <span className="num">{new Date(h.created_at).toLocaleString("ar-SA")}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
