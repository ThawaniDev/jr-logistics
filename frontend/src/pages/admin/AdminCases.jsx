import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Banknote } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { useI18n } from "@/i18n";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { sar } from "@/lib/constants";

export default function AdminCases() {
  const { t } = useI18n();
  const [cases, setCases] = useState(null);
  const [pct, setPct] = useState({});
  const [busy, setBusy] = useState("");

  const load = () => api.get("/admin/cases").then(({ data }) => setCases(data.cases)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, []);

  const compensate = async (offerId) => {
    setBusy(offerId);
    try {
      const { data } = await api.post(`/admin/offers/${offerId}/compensate`, {
        percent: pct[offerId] ? Number(pct[offerId]) : undefined,
      });
      toast.success(`${t("admin.compDone")} — ${sar(data.net)}`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-cases-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("admin.casesTitle")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("admin.casesSub")}</p>
      </div>

      {!cases ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : cases.length === 0 ? (
        <EmptyState icon={AlertTriangle} title={t("admin.casesEmpty")} testid="cases-empty" />
      ) : (
        <div className="space-y-4">
          {cases.map((c) => (
            <div key={c._id} className="card-surface p-5 space-y-4" data-testid={`case-${c._id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-heading font-bold">{c.subject}</p>
                    <span className="chip bg-rose-500/10 text-rose-400 border-rose-500/30">{t("support.urgent")}</span>
                    <StatusBadge kind="ticket" status={c.status} />
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{c.message}</p>
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-3 text-xs">
                <div className="bg-navy-800 rounded-xl p-3 border border-navy-600/40">
                  <p className="text-slate-500">{t("admin.colWorker")}</p>
                  <p className="font-semibold mt-1">{c.user?.name}</p>
                  <p className="text-slate-500 num mt-0.5">{c.user?.phone}</p>
                </div>
                <div className="bg-navy-800 rounded-xl p-3 border border-navy-600/40">
                  <p className="text-slate-500">{t("support.linkedRequest")}</p>
                  <p className="font-semibold mt-1">{c.request?.title || "—"}</p>
                  <p className="text-slate-500 mt-0.5">
                    {c.request && <>{c.request.city} · <span className="num">{c.request.start_date}</span> · {t("admin.reservedLabel")}: <span className="num">{sar(c.request.estimated_total)}</span></>}
                  </p>
                </div>
                <div className="bg-navy-800 rounded-xl p-3 border border-navy-600/40">
                  <p className="text-slate-500">{t("common.status")}</p>
                  <p className="mt-1">{c.offer ? <StatusBadge kind="offer" status={c.offer.status} /> : "—"}</p>
                </div>
              </div>
              {c.offer && ["attended", "attendance_confirmed", "driver_completed"].includes(c.offer.status) && (
                <div className="flex flex-wrap gap-3 items-end pt-3 border-t border-navy-600/40">
                  <div className="w-32">
                    <label className="text-[11px] text-slate-500 block mb-1.5">{t("admin.pctLabel")}</label>
                    <Input data-testid={`case-pct-${c._id}`} type="number" min="1" max="100"
                      value={pct[c.offer._id] ?? ""} placeholder="100"
                      onChange={(e) => setPct({ ...pct, [c.offer._id]: e.target.value })}
                      className="bg-navy-800 border-navy-600 h-10 num" />
                  </div>
                  <button data-testid={`case-compensate-${c._id}`} disabled={busy === c.offer._id}
                    onClick={() => compensate(c.offer._id)}
                    className="flex items-center gap-2 bg-amber-400 text-navy-900 font-bold rounded-xl px-5 h-10 text-sm hover:bg-amber-300 disabled:opacity-50 transition-colors">
                    <Banknote className="w-4 h-4" /> {t("admin.compensate")}
                  </button>
                </div>
              )}
              {c.offer?.status === "paid" && c.offer?.compensation && (
                <p className="text-xs text-green-400 flex items-center gap-1.5">
                  <Banknote className="w-3.5 h-3.5" /> {t("admin.compensated")}: <span className="num">{sar(c.offer.earning)}</span>
                </p>
              )}
              {c.replies?.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-navy-600/40">
                  {c.replies.map((r, i) => (
                    <div key={i} className={`rounded-xl p-3 text-xs leading-relaxed ${r.from_admin ? "bg-brand/10 border border-brand/20" : "bg-navy-800"}`}>
                      <p className="text-[10px] text-slate-400 mb-1">{r.author}</p>
                      {r.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
