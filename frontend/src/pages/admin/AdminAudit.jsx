import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { useI18n } from "@/i18n";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "sonner";

const ACTION_LABELS = {
  settings_updated: "settings_updated",
  user_suspended: "user_suspended",
  user_activated: "user_activated",
  manual_match: "manual_match",
  payment_processed: "payment_processed",
  withdrawal_rejected: "withdrawal_rejected",
  broadcast_sent: "broadcast_sent",
  staff_created: "staff_created",
  staff_updated: "staff_updated",
  driver_verified: "driver_verified",
  document_rejected: "document_rejected",
  compensation_approved: "compensation_approved",
  ticket_escalated: "ticket_escalated",
  ticket_resolved: "ticket_resolved",
};

export default function AdminAudit() {
  const { t } = useI18n();
  const [logs, setLogs] = useState(null);

  useEffect(() => {
    api.get("/admin/audit").then(({ data }) => setLogs(data.logs)).catch((e) => toast.error(errMsg(e)));
  }, []);

  return (
    <div className="space-y-6" data-testid="admin-audit-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("admin.auditTitle")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("admin.auditSub")}</p>
      </div>

      {!logs ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : logs.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("admin.auditEmpty")} testid="audit-empty" />
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-600/50 text-slate-400 text-xs">
                  <th className="text-start p-4 font-semibold">{t("admin.colActor")}</th>
                  <th className="text-start p-4 font-semibold">{t("admin.colAction")}</th>
                  <th className="text-start p-4 font-semibold">{t("admin.colEntity")}</th>
                  <th className="text-start p-4 font-semibold">{t("admin.colWhen")}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l._id} className="border-b border-navy-600/30 hover:bg-navy-700/20" data-testid={`audit-${l._id}`}>
                    <td className="p-4">
                      <p className="font-semibold text-xs">{l.actor_name}</p>
                      <p className="text-[10px] text-slate-500">{l.actor_role}</p>
                    </td>
                    <td className="p-4">
                      <span className="chip bg-brand/10 text-brand border-brand/25 num">{ACTION_LABELS[l.action] || l.action}</span>
                    </td>
                    <td className="p-4 text-xs text-slate-400 num">{l.entity || "—"} {l.entity_id ? `· ${String(l.entity_id).slice(0, 10)}` : ""}</td>
                    <td className="p-4 text-xs text-slate-500 num">{new Date(l.created_at).toLocaleString()}</td>
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
