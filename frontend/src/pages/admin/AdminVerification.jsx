import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, CheckCircle2, XCircle, FileCheck, Building2, UserCheck, Truck } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/constants";
import { useI18n } from "@/i18n";

export default function AdminVerification() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");

  const load = () => api.get("/admin/verification-center").then(({ data }) => setData(data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, []);

  const verifyAccount = async (uid, action, kind) => {
    let reason = null;
    if (action !== "approve") {
      reason = window.prompt(t("vc.rejectReason")) || "";
      if (!reason.trim()) return toast.error(t("vc.reasonRequired"));
    }
    setBusy(uid + action);
    try {
      const url = kind === "office" ? `/admin/offices/${uid}/verify` : `/admin/accounts/${uid}/verify`;
      await api.post(url, { action, reason });
      toast.success(action === "approve" ? t("vc.approved") : t("vc.rejectedT"));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  const reviewDoc = async (docId, action, isOffice) => {
    let reason = null;
    if (action === "reject") {
      reason = window.prompt(t("vc.rejectReason")) || "";
      if (!reason.trim()) return toast.error(t("vc.reasonRequired"));
    }
    setBusy(docId + action);
    try {
      const url = isOffice ? `/admin/office-documents/${docId}/review` : `/admin/documents/${docId}/review`;
      await api.post(url, { action, reason });
      toast.success(action === "verify" ? t("vc.approved") : t("vc.rejectedT"));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  const AccountSection = ({ title, icon: Icon, items, kind, testid }) => (
    <div className="card-surface p-5" data-testid={testid}>
      <h2 className="heading text-lg font-bold mb-4 flex items-center gap-2">
        <Icon className="w-4 h-4 text-brand" /> {title}
        <span className="chip bg-amber-500/10 border-amber-500/30 text-amber-300 text-[10px] num">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-slate-500 text-xs">{t("vc.empty")}</p>
      ) : (
        <div className="space-y-2">
          {items.map((u) => (
            <div key={u._id} className="flex items-center justify-between flex-wrap gap-2 rounded-xl bg-navy-800/60 border border-navy-600/40 px-4 py-2.5"
              data-testid={`vc-${kind}-${u._id}`}>
              <div>
                <p className="text-sm font-semibold">
                  {kind === "office" ? (u.office_profile?.office_name || u.name)
                    : kind === "business" ? (u.business_profile?.company_name || u.name)
                    : u.name}
                </p>
                <p className="text-[11px] text-slate-500 num">{u.phone}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => verifyAccount(u._id, "approve", kind)} disabled={busy} data-testid={`vc-approve-${u._id}`}
                  className="chip bg-emerald-500/10 border-emerald-500/30 text-emerald-300 text-[11px]">
                  <CheckCircle2 className="w-3 h-3" /> {t("vc.approve")}
                </button>
                <button onClick={() => verifyAccount(u._id, "reject", kind)} disabled={busy} data-testid={`vc-reject-${u._id}`}
                  className="chip bg-rose-500/10 border-rose-500/30 text-rose-300 text-[11px]">
                  <XCircle className="w-3 h-3" /> {t("vc.reject")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const DocSection = ({ title, docs, isOffice, testid }) => (
    <div className="card-surface p-5" data-testid={testid}>
      <h2 className="heading text-lg font-bold mb-4 flex items-center gap-2">
        <FileCheck className="w-4 h-4 text-brand" /> {title}
        <span className="chip bg-amber-500/10 border-amber-500/30 text-amber-300 text-[10px] num">{docs.length}</span>
      </h2>
      {docs.length === 0 ? (
        <p className="text-slate-500 text-xs">{t("vc.empty")}</p>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <div key={d._id} className="flex items-center justify-between flex-wrap gap-2 rounded-xl bg-navy-800/60 border border-navy-600/40 px-4 py-2.5"
              data-testid={`vc-doc-${d._id}`}>
              <div>
                <p className="text-sm font-semibold">{d.type}</p>
                <p className="text-[11px] text-slate-500">
                  {d.original_filename}
                  {d.expiry_date && <> · <span className="num">{fmtDate(d.expiry_date)}</span></>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={d.status} ns="docStatus" />
                {d.status === "pending" && (
                  <>
                    <button onClick={() => reviewDoc(d._id, "verify", isOffice)} disabled={busy} data-testid={`vc-doc-verify-${d._id}`}
                      className="chip bg-emerald-500/10 border-emerald-500/30 text-emerald-300 text-[11px]">
                      <CheckCircle2 className="w-3 h-3" /> {t("vc.approve")}
                    </button>
                    <button onClick={() => reviewDoc(d._id, "reject", isOffice)} disabled={busy} data-testid={`vc-doc-reject-${d._id}`}
                      className="chip bg-rose-500/10 border-rose-500/30 text-rose-300 text-[11px]">
                      <XCircle className="w-3 h-3" /> {t("vc.reject")}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6" data-testid="verification-center-page">
      <div>
        <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-brand" /> {t("vc.title")}
        </h1>
        <p className="text-sm text-slate-400 mt-1">{t("vc.sub")}</p>
      </div>

      {!data ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : (
        <>
          <AccountSection title={t("vc.pendingOffices")} icon={Truck} items={data.pending_offices} kind="office" testid="vc-offices" />
          <AccountSection title={t("vc.pendingBusinesses")} icon={Building2} items={data.pending_businesses} kind="business" testid="vc-businesses" />
          <AccountSection title={t("vc.pendingDrivers")} icon={UserCheck} items={data.pending_drivers} kind="driver" testid="vc-drivers" />
          <DocSection title={t("vc.pendingDocs")} docs={[...data.driver_docs, ...data.office_docs.map((d) => ({ ...d, __office: true }))]}
            isOffice={false} testid="vc-docs" />
          <DocSection title={t("vc.expiringDocs")} docs={data.expiring_docs} isOffice={false} testid="vc-expiring" />
          <DocSection title={t("vc.expiredDocs")} docs={data.expired_docs} isOffice={false} testid="vc-expired" />
        </>
      )}
    </div>
  );
}
