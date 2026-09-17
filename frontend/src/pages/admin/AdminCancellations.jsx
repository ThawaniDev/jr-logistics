import { useEffect, useState } from "react";
import { toast } from "sonner";
import { XCircle, Calendar } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { useI18n } from "@/i18n";

const PARTY_CLS = {
  worker: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  business: "bg-blue-500/10 text-blue-400 border-blue-500/30",
};
const KIND_CLS = {
  cancellation: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  no_show: "bg-orange-500/10 text-orange-400 border-orange-500/30",
};

export default function AdminCancellations() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState(null);
  const [party, setParty] = useState("");
  const [kind, setKind] = useState("");
  const locale = lang === "ar" ? "ar-SA" : lang === "ur" ? "ur-PK" : "en-US";

  const load = () =>
    api.get("/admin/cancellations", { params: { party: party || undefined, kind: kind || undefined } })
      .then(({ data }) => setItems(data.cancellations)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, [party, kind]);

  return (
    <div className="space-y-6" data-testid="admin-cancellations-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("admin.cancTitle")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("admin.cancSub")}</p>
      </div>

      <div className="flex gap-2 flex-wrap" data-testid="canc-filters">
        {[["", t("common.all")], ["worker", t("admin.cancByWorker")], ["business", t("admin.cancByBiz")]].map(([v, l]) => (
          <button key={v} onClick={() => setParty(v)} data-testid={`canc-party-${v || "all"}`}
            className={`chip ${party === v ? "bg-brand/15 text-brand border-brand/40" : "bg-navy-800 text-slate-400 border-navy-600"}`}>
            {l}
          </button>
        ))}
        <span className="w-px bg-navy-600 mx-1" />
        {[["", t("common.all")], ["cancellation", t("admin.cancKindCancel")], ["no_show", t("admin.cancKindNoShow")]].map(([v, l]) => (
          <button key={v} onClick={() => setKind(v)} data-testid={`canc-kind-${v || "all"}`}
            className={`chip ${kind === v ? "bg-brand/15 text-brand border-brand/40" : "bg-navy-800 text-slate-400 border-navy-600"}`}>
            {l}
          </button>
        ))}
      </div>

      {!items ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <EmptyState icon={XCircle} title={t("admin.cancEmpty")} desc={t("admin.cancEmptyDesc")} testid="canc-empty" />
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-600/50 text-slate-400 text-xs">
                  <th className="text-start p-4 font-semibold">{t("admin.cancParty")}</th>
                  <th className="text-start p-4 font-semibold">{t("admin.cancKind")}</th>
                  <th className="text-start p-4 font-semibold">{t("admin.cancRequest")}</th>
                  <th className="text-start p-4 font-semibold">{t("admin.cancReason")}</th>
                  <th className="text-start p-4 font-semibold">{t("admin.cancDate")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c._id} className="border-b border-navy-600/30 hover:bg-navy-700/20" data-testid={`canc-row-${c._id}`}>
                    <td className="p-4">
                      <span className={`chip ${PARTY_CLS[c.party] || ""}`}>
                        {c.party === "worker" ? t("admin.cancByWorker") : t("admin.cancByBiz")}
                      </span>
                      <p className="text-xs text-slate-400 mt-1.5">
                        {c.party === "worker" ? c.worker?.name : (c.business?.business_profile?.company_name || c.business?.name)}
                      </p>
                    </td>
                    <td className="p-4">
                      <span className={`chip ${KIND_CLS[c.kind] || ""}`}>
                        {c.kind === "no_show" ? t("admin.cancKindNoShow") : t("admin.cancKindCancel")}
                      </span>
                    </td>
                    <td className="p-4">
                      <p className="font-semibold text-sm">{c.request?.title}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 num flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {c.request?.start_date} · {c.request?.city}
                      </p>
                    </td>
                    <td className="p-4 text-xs text-slate-300 max-w-[260px]">{c.reason}</td>
                    <td className="p-4 text-xs text-slate-500 num">{new Date(c.created_at).toLocaleString(locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
