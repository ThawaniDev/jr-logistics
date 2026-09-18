import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileCheck, Eye, CheckCircle2, XCircle } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { useI18n } from "@/i18n";
import { fmtDate } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";

export default function AdminDocuments() {
  const { t } = useI18n();
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState("pending");
  const [busy, setBusy] = useState("");

  const load = () =>
    api.get("/admin/documents", { params: { status: filter || undefined } })
      .then(({ data }) => setItems(data.documents)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, [filter]);

  const review = async (id, action) => {
    setBusy(id + action);
    try {
      await api.post(`/admin/documents/${id}/review`, { action });
      toast.success(t("admin.staffUpdated"));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  const viewFile = async (docId) => {
    try {
      const res = await api.get(`/documents/${docId}/file`, { responseType: "blob" });
      window.open(URL.createObjectURL(res.data), "_blank");
    } catch {
      toast.error("—");
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-documents-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("admin.docsTitle")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("admin.docsSub")}</p>
      </div>

      <div className="flex gap-2 flex-wrap" data-testid="doc-filters">
        {[["pending", "ticketStatus.open"], ["verified", "docStatus.verified"], ["rejected", "docStatus.rejected"], ["", "common.all"]].map(([k, key]) => (
          <button key={k} onClick={() => setFilter(k)} data-testid={`doc-filter-${k || "all"}`}
            className={`chip ${filter === k ? "bg-brand/15 text-brand border-brand/40" : "bg-navy-800 text-slate-400 border-navy-600"}`}>
            {t(key)}
          </button>
        ))}
      </div>

      {!items ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <EmptyState icon={FileCheck} title={t("admin.docsEmpty")} testid="docs-empty" />
      ) : (
        <div className="space-y-3">
          {items.map((d) => (
            <div key={d._id} className="card-surface p-4 flex flex-wrap items-center gap-4" data-testid={`admin-doc-${d._id}`}>
              <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/25 flex items-center justify-center shrink-0">
                <FileCheck className="w-5 h-5 text-brand" />
              </div>
              <div className="flex-1 min-w-[200px]">
                <p className="font-semibold text-sm">{d.worker?.name} <span className="text-slate-500 text-xs num">{d.worker?.phone}</span></p>
                <p className="text-xs text-slate-400 mt-1">
                  {t(`docs.type_${d.type}`)} · {d.original_filename}
                  {d.expiry_date && <> · {t("admin.colExpiry")}: <span className="num">{fmtDate(d.expiry_date)}</span> {d.expired && <span className="text-rose-400">({t("admin.expired")})</span>}</>}
                </p>
              </div>
              <StatusBadge kind="doc" status={d.status} />
              {d.file_path && (
                <button onClick={() => viewFile(d._id)} data-testid={`doc-view-${d._id}`}
                  className="flex items-center gap-1.5 border border-navy-600 text-slate-300 rounded-xl px-3 py-1.5 text-xs hover:border-brand/40 hover:text-brand">
                  <Eye className="w-3.5 h-3.5" /> {t("admin.view")}
                </button>
              )}
              {d.status === "pending" && (
                <div className="flex gap-2">
                  <button data-testid={`doc-verify-${d._id}`} disabled={busy} onClick={() => review(d._id, "verify")}
                    className="flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-semibold rounded-xl px-4 py-2 text-xs hover:bg-emerald-500/25 disabled:opacity-50">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {t("admin.verify")}
                  </button>
                  <button data-testid={`doc-reject-${d._id}`} disabled={busy} onClick={() => review(d._id, "reject")}
                    className="flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/30 text-rose-400 font-semibold rounded-xl px-4 py-2 text-xs hover:bg-rose-500/20 disabled:opacity-50">
                    <XCircle className="w-3.5 h-3.5" /> {t("admin.reject")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
