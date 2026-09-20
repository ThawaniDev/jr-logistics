import { useEffect, useState } from "react";
import { Landmark } from "lucide-react";
import api from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { StatCard } from "@/components/StatCard";
import { sar, fmtDate } from "@/lib/constants";
import { useI18n } from "@/i18n";

const RECEIVABLE_STATUSES = ["pending_review", "under_review", "approved"];

export default function OfficeReceivables() {
  const { t } = useI18n();
  const [items, setItems] = useState(null);

  useEffect(() => {
    api.get("/office/settlements").then(({ data }) => setItems(data.settlements)).catch(() => {});
  }, []);

  const rows = (items || []).filter((s) => RECEIVABLE_STATUSES.includes(s.status));
  const sum = (status) => rows.filter((s) => s.status === status).reduce((a, s) => a + (s.provider_amount || s.net || 0), 0);

  return (
    <div className="space-y-6" data-testid="office-receivables-page">
      <div>
        <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
          <Landmark className="w-6 h-6 text-brand" /> {t("office.receivables")}
        </h1>
        <p className="text-sm text-slate-400 mt-1">{t("office.receivablesSub")}</p>
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard testid="recv-pending" icon={Landmark} label={t("office.pendingSettle")} value={sar(sum("pending_review") + sum("under_review"))} tone="gold" />
        <StatCard testid="recv-approved" icon={Landmark} label={t("office.approvedSettle")} value={sar(sum("approved"))} tone="blue" />
        <StatCard testid="recv-total" icon={Landmark} label={t("office.totalRecv")} value={sar(rows.reduce((a, s) => a + (s.provider_amount || s.net || 0), 0))} tone="brand" />
      </div>
      {!items ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Landmark} title={t("office.noSettlements")} desc={t("office.noReceivablesDesc")} testid="receivables-empty" />
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-navy-600/50 text-slate-400 text-xs">
                {[t("office.jobs"), t("office.driverName"), t("fin.finalQty"), t("office.providerAmount"), t("fin.status"), t("fin.date")].map((h) => <th key={h} className="text-start p-4 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s._id} className="border-b border-navy-600/30" data-testid={`receivable-${s._id}`}>
                    <td className="p-4 font-semibold text-xs">{s.request_title || s.request_id}</td>
                    <td className="p-4 text-xs">{s.driver_name}</td>
                    <td className="p-4 num">{s.final_qty}</td>
                    <td className="p-4 num font-bold text-brand">{sar(s.provider_amount ?? s.net)}</td>
                    <td className="p-4"><StatusBadge kind="settlement" status={s.status} /></td>
                    <td className="p-4 num text-xs text-slate-400">{fmtDate(s.created_at)}</td>
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
