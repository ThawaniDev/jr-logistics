import { useEffect, useState } from "react";
import { Landmark } from "lucide-react";
import api from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { sar, fmtDate } from "@/lib/constants";
import { useI18n } from "@/i18n";

export default function OfficeSettlements() {
  const { t } = useI18n();
  const [items, setItems] = useState(null);
  const [payments, setPayments] = useState(null);

  useEffect(() => {
    api.get("/office/settlements").then(({ data }) => setItems(data.settlements)).catch(() => {});
    api.get("/office/payments").then(({ data }) => setPayments(data)).catch(() => {});
  }, []);

  return (
    <div className="space-y-6" data-testid="office-settlements-page">
      <div>
        <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
          <Landmark className="w-6 h-6 text-brand" /> {t("office.settlements")}
        </h1>
        <p className="text-sm text-slate-400 mt-1">{t("office.receivables")}</p>
      </div>

      {payments?.wallet && (
        <div className="card-surface p-5 border-brand/25" data-testid="office-receivables-wallet">
          <p className="text-xs text-slate-500">{t("office.totalRecv")}</p>
          <p className="heading text-3xl font-black num text-brand mt-1">{sar(payments.wallet.available || 0)}</p>
        </div>
      )}

      {!items ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <EmptyState icon={Landmark} title={t("office.noSettlements")} desc={t("office.noDriversDesc")} testid="settlements-empty" />
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-600/50 text-slate-400 text-xs">
                  {[t("office.jobs"), t("office.driverName"), t("fin.finalQty"), t("fin.net"), t("fin.status"), t("fin.date")].map((h, i) => (
                    <th key={i} className="text-start p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s._id} className="border-b border-navy-600/30" data-testid={`settlement-row-${s._id}`}>
                    <td className="p-4 font-semibold text-xs">{s.request_title || s.request_id}</td>
                    <td className="p-4 text-xs">{s.driver_name}</td>
                    <td className="p-4 num">{s.final_qty}</td>
                    <td className="p-4 num font-bold text-brand">{sar(s.net)}</td>
                    <td className="p-4"><StatusBadge status={s.status} ns="settlementStatus" /></td>
                    <td className="p-4 num text-xs text-slate-400">{fmtDate(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {payments && payments.payments.length > 0 && (
        <div className="space-y-2" data-testid="office-payments">
          <h2 className="heading text-lg font-bold">{t("office.payments")}</h2>
          {payments.payments.map((p) => (
            <div key={p._id} className="card-surface p-4 flex items-center justify-between" data-testid={`payment-${p._id}`}>
              <p className="text-xs text-slate-400">{p.note}</p>
              <p className="num font-bold text-emerald-400">+{sar(p.amount)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
