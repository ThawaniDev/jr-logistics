import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ScrollText, CheckCircle2 } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { useI18n } from "@/i18n";
import { fmtDate } from "@/lib/constants";

const TERM_FIELDS = [
  ["commercial_terms", "office.commercialTerms"],
  ["provider_rate_note", "office.providerRate"],
  ["settlement_terms", "office.settlementTerms"],
  ["payment_terms", "office.paymentTerms"],
  ["cancellation_rules", "reqDetail.cancelPolicy"],
  ["no_show_rules", "admin.noShowRules"],
  ["replacement_rules", "admin.replacementRules"],
  ["dispute_rules", "admin.disputeRules"],
];

export default function OfficeAgreement() {
  const { t } = useI18n();
  const [agr, setAgr] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/office/agreement").then(({ data }) => setAgr(data.agreement)).catch(() => {});
  useEffect(() => { load(); }, []);

  const accept = async () => {
    setBusy(true);
    try {
      await api.post("/office/agreement/accept");
      toast.success(t("office.agreementAccepted"));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="office-agreement-page">
      <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
        <ScrollText className="w-6 h-6 text-brand" /> {t("office.agreement")}
      </h1>

      {!agr ? (
        <div className="card-surface p-6 text-sm text-slate-400" data-testid="agreement-none">{t("office.noAgreement")}</div>
      ) : (
        <div className="card-surface p-6 space-y-4" data-testid="agreement-card">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="font-heading font-bold">JR Logistics ↔ {t("office.roleTitle")}</p>
              <p className="text-[11px] text-slate-500 mt-1">
                {t("office.version")}: <span className="num">{agr.version}</span> · ID: <span className="num">{agr._id?.slice(0, 10)}</span>
              </p>
            </div>
            <span className={`chip text-[11px] ${agr.status === "accepted" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-amber-500/10 border-amber-500/30 text-amber-300"}`}
              data-testid="agreement-status">
              {agr.status === "accepted" ? t("office.agreementActive") : t("office.agreementPending")}
            </span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            <p className="text-slate-400">{t("office.effectiveDate")}: <span className="num text-slate-200">{fmtDate(agr.effective_date)}</span></p>
            {agr.expiry_date && <p className="text-slate-400">{t("office.expiryDate")}: <span className="num text-slate-200">{fmtDate(agr.expiry_date)}</span></p>}
          </div>
          <div className="space-y-2">
            {TERM_FIELDS.filter(([k]) => agr[k]).map(([k, label]) => (
              <div key={k} className="rounded-xl bg-navy-800/60 border border-navy-600/40 p-3">
                <p className="text-[11px] text-slate-500 mb-1">{t(label)}</p>
                <p className="text-xs text-slate-200 whitespace-pre-line">{agr[k]}</p>
              </div>
            ))}
          </div>
          {agr.status === "pending_acceptance" && (
            <button onClick={accept} disabled={busy} data-testid="accept-agreement-btn"
              className="flex items-center gap-2 bg-emerald-500 text-navy-900 font-bold rounded-xl px-6 py-2.5 text-sm hover:bg-emerald-400 disabled:opacity-50 transition-colors">
              <CheckCircle2 className="w-4 h-4" /> {t("office.acceptAgreement")}
            </button>
          )}
          {agr.status === "accepted" && agr.accepted_at && (
            <p className="text-[11px] text-emerald-400" data-testid="agreement-accepted-at">
              {t("office.agreementActive")} — <span className="num">{fmtDate(agr.accepted_at)}</span> · {agr.accepted_by?.name}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
