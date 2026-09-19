import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, CheckCircle2, XCircle, Ban, Users, Landmark, ScrollText, PlusCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import api, { errMsg } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { sar } from "@/lib/constants";
import { useI18n } from "@/i18n";

export default function AdminOffices() {
  const { t } = useI18n();
  const [offices, setOffices] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState("");
  const [agrForm, setAgrForm] = useState({ version: "", effective_date: "", commercial_terms: "", provider_rate_note: "", settlement_terms: "", payment_terms: "" });

  const load = () => api.get("/admin/offices").then(({ data }) => setOffices(data.offices)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, []);

  const openDetail = (id) => {
    setSelected(id);
    api.get(`/admin/offices/${id}`).then(({ data }) => setDetail(data)).catch((e) => toast.error(errMsg(e)));
  };

  const verify = async (id, action) => {
    let reason = null;
    if (action !== "approve") {
      reason = window.prompt(t("vc.rejectReason")) || "";
      if (!reason.trim()) return toast.error(t("vc.reasonRequired"));
    }
    setBusy(id + action);
    try {
      await api.post(`/admin/offices/${id}/verify`, { action, reason });
      toast.success(action === "approve" ? t("vc.approved") : t("vc.rejectedT"));
      load();
      if (selected === id) openDetail(id);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  const issueAgreement = async (e) => {
    e.preventDefault();
    if (!agrForm.version.trim() || !agrForm.effective_date) return toast.error(t("common.required"));
    setBusy("agr");
    try {
      await api.post(`/admin/offices/${selected}/agreement`, agrForm);
      toast.success(t("vc.agreementIssued"));
      setAgrForm({ version: "", effective_date: "", commercial_terms: "", provider_rate_note: "", settlement_terms: "", payment_terms: "" });
      openDetail(selected);
    } catch (e2) {
      toast.error(errMsg(e2));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-offices-page">
      <div>
        <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
          <Building2 className="w-6 h-6 text-brand" /> {t("vc.offices")}
        </h1>
        <p className="text-sm text-slate-400 mt-1">{t("vc.officesSub")}</p>
      </div>

      {!offices ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : offices.length === 0 ? (
        <EmptyState icon={Building2} title={t("office.noDocs")} desc={t("vc.officesSub")} testid="offices-empty" />
      ) : (
        <div className="grid gap-3" data-testid="offices-list">
          {offices.map((o) => {
            const op = o.office_profile || {};
            return (
              <div key={o._id} className="card-surface p-5 space-y-3" data-testid={`office-row-${o._id}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="font-bold">{op.office_name || o.name}</p>
                    <p className="text-[11px] text-slate-500">
                      <span className="num">{o.phone}</span>
                      {op.cr_number && <> · {t("vc.crNumber")}: <span className="num">{op.cr_number}</span></>}
                      {op.city && <> · {op.city}</>}
                    </p>
                  </div>
                  <StatusBadge kind="office" status={op.verification_status || "pending"} />
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {t("vc.driversCount")}: <b className="num text-slate-200">{o.drivers_count}</b></span>
                  <span className="flex items-center gap-1"><Landmark className="w-3 h-3" /> {t("office.totalRecv")}: <b className="num text-brand">{sar(o.settlements_total)}</b></span>
                  {o.settlements_pending > 0 && <span className="text-amber-400">{t("office.pendingSettle")}: <b className="num">{o.settlements_pending}</b></span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => openDetail(o._id)} data-testid={`office-view-${o._id}`}
                    className="chip bg-navy-800 border-navy-600 text-slate-300 hover:text-brand text-[11px]">
                    {t("vc.viewOffice")}
                  </button>
                  {op.verification_status === "pending" && (
                    <>
                      <button onClick={() => verify(o._id, "approve")} disabled={busy} data-testid={`office-approve-${o._id}`}
                        className="chip bg-emerald-500/10 border-emerald-500/30 text-emerald-300 text-[11px]">
                        <CheckCircle2 className="w-3 h-3" /> {t("vc.approve")}
                      </button>
                      <button onClick={() => verify(o._id, "reject")} disabled={busy} data-testid={`office-reject-${o._id}`}
                        className="chip bg-rose-500/10 border-rose-500/30 text-rose-300 text-[11px]">
                        <XCircle className="w-3 h-3" /> {t("vc.reject")}
                      </button>
                    </>
                  )}
                  {["verified", "active"].includes(op.verification_status) && (
                    <button onClick={() => verify(o._id, "suspend")} disabled={busy} data-testid={`office-suspend-${o._id}`}
                      className="chip bg-rose-500/10 border-rose-500/30 text-rose-300 text-[11px]">
                      <Ban className="w-3 h-3" /> {t("vc.suspend")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && detail && (
        <div className="card-surface p-6 space-y-4 border-brand/25" data-testid="office-detail">
          <p className="font-heading font-bold flex items-center gap-2">
            <Building2 className="w-4 h-4 text-brand" /> {detail.office.office_profile?.office_name || detail.office.name}
          </p>

          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            <p className="text-slate-400">{t("vc.driversCount")}: <b className="num text-slate-200">{detail.drivers.length}</b></p>
            <p className="text-slate-400">{t("office.documents")}: <b className="num text-slate-200">{detail.documents.length}</b></p>
          </div>

          {detail.drivers.length > 0 && (
            <div className="space-y-1.5" data-testid="office-detail-drivers">
              {detail.drivers.map((d) => (
                <div key={d._id} className="flex items-center justify-between rounded-lg bg-navy-800/60 px-3 py-2 text-xs">
                  <span>{d.name} <span className="num text-slate-500">{d.phone}</span></span>
                  <span className="text-slate-500">{t(`office.status_${(d.worker_profile || {}).provider_status || "direct"}`)}</span>
                </div>
              ))}
            </div>
          )}

          {detail.agreement && (
            <p className="text-xs text-slate-400" data-testid="office-detail-agreement">
              <ScrollText className="w-3.5 h-3.5 inline-block me-1" />
              {t("office.agreement")}: {detail.agreement.version} — {t(`office.agreement${detail.agreement.status === "accepted" ? "Active" : "Pending"}`)}
            </p>
          )}

          <form onSubmit={issueAgreement} className="rounded-xl border border-navy-600/40 p-4 space-y-3" data-testid="agreement-form">
            <p className="font-bold text-xs flex items-center gap-1.5">
              <PlusCircle className="w-3.5 h-3.5 text-brand" /> {t("vc.newAgreement")}
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              <Input data-testid="agr-version" placeholder={t("office.version")} value={agrForm.version}
                onChange={(e) => setAgrForm({ ...agrForm, version: e.target.value })} className="bg-navy-800 border-navy-600 h-10 text-xs" />
              <Input data-testid="agr-effective" type="date" value={agrForm.effective_date}
                onChange={(e) => setAgrForm({ ...agrForm, effective_date: e.target.value })} className="bg-navy-800 border-navy-600 h-10 text-xs num" />
              <Input data-testid="agr-rate" placeholder={t("office.providerRate")} value={agrForm.provider_rate_note}
                onChange={(e) => setAgrForm({ ...agrForm, provider_rate_note: e.target.value })} className="bg-navy-800 border-navy-600 h-10 text-xs" />
            </div>
            <Input data-testid="agr-terms" placeholder={t("office.commercialTerms")} value={agrForm.commercial_terms}
              onChange={(e) => setAgrForm({ ...agrForm, commercial_terms: e.target.value })} className="bg-navy-800 border-navy-600 h-10 text-xs" />
            <button disabled={busy === "agr"} data-testid="agr-issue-btn"
              className="bg-brand text-navy-900 font-bold rounded-xl px-5 py-2 text-xs hover:bg-brand-hover disabled:opacity-50">
              {t("vc.newAgreement")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
