import { useEffect, useState } from "react";
import { Landmark, Wallet } from "lucide-react";
import api from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { sar, fmtDate } from "@/lib/constants";
import { useI18n } from "@/i18n";

export default function OfficePayments() {
  const { t } = useI18n();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/office/payments").then(({ data }) => setData(data)).catch(() => {});
  }, []);

  return (
    <div className="space-y-6" data-testid="office-payments-page">
      <div>
        <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
          <Wallet className="w-6 h-6 text-brand" /> {t("office.payments")}
        </h1>
        <p className="text-sm text-slate-400 mt-1">{t("office.paymentsSub")}</p>
      </div>
      {data?.wallet && (
        <div className="card-surface p-5 border-brand/25" data-testid="office-wallet-available">
          <p className="text-xs text-slate-500">{t("office.totalRecv")}</p>
          <p className="heading text-3xl font-black num text-brand mt-1">{sar(data.wallet.available || 0)}</p>
        </div>
      )}
      {!data ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : data.payments.length === 0 ? (
        <EmptyState icon={Landmark} title={t("office.noPayments")} desc={t("office.noPaymentsDesc")} testid="payments-empty" />
      ) : (
        <div className="space-y-2" data-testid="office-payments-list">
          {data.payments.map((p) => (
            <div key={p._id} className="card-surface p-4 flex items-center justify-between gap-3 flex-wrap" data-testid={`office-payment-${p._id}`}>
              <div>
                <p className="text-sm font-semibold">{p.note}</p>
                <p className="text-[11px] text-slate-500 mt-1 num">{fmtDate(p.created_at)} · {p.settlement_id?.slice(0, 10)}</p>
              </div>
              <p className="num font-bold text-emerald-400">+{sar(p.amount)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
