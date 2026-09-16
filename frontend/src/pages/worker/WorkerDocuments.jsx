import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FileCheck, Upload, AlertTriangle, CheckCircle2, Clock, Eye } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { useI18n } from "@/i18n";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";

export default function WorkerDocuments() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ doc_type: "national_id", expiry_date: "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = () => api.get("/documents/mine").then(({ data }) => setData(data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const upload = async (e) => {
    e.preventDefault();
    if (!file) return toast.error(t("docs.file"));
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("doc_type", form.doc_type);
      if (form.expiry_date) fd.append("expiry_date", form.expiry_date);
      fd.append("file", file);
      await api.post("/documents/upload", fd);
      toast.success(t("docs.uploaded"));
      setFile(null);
      setForm({ doc_type: "national_id", expiry_date: "" });
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const viewFile = async (docId) => {
    try {
      const res = await api.get(`/documents/${docId}/file`, { responseType: "blob" });
      window.open(URL.createObjectURL(res.data), "_blank");
    } catch {
      toast.error(t("common.loading"));
    }
  };

  if (!data) return <p className="text-slate-500 text-sm">{t("common.loading")}</p>;
  const vs = data.verification_status;

  return (
    <div className="space-y-6" data-testid="worker-documents-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("docs.title")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("docs.sub")}</p>
      </div>

      <div className={`card-surface p-4 flex items-center gap-3 ${
        vs === "verified" ? "border-emerald-500/40 bg-emerald-500/5"
        : vs === "not_eligible" ? "border-rose-500/40 bg-rose-500/5" : "border-amber-500/40 bg-amber-500/5"
      }`} data-testid="verification-banner">
        {vs === "verified" ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          : vs === "not_eligible" ? <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          : <Clock className="w-5 h-5 text-amber-400 shrink-0" />}
        <p className="text-sm font-semibold">
          {vs === "verified" ? t("docs.verifiedBanner") : vs === "not_eligible" ? t("docs.notEligibleBanner") : t("docs.pendingBanner")}
        </p>
        <span className="ms-auto"><StatusBadge kind="doc" status={vs} /></span>
      </div>

      {data.missing.length > 0 && (
        <p className="text-xs text-amber-400" data-testid="missing-docs">
          {t("docs.missing")}: {data.missing.map((k) => t(`docs.type_${k}`)).join("، ")}
        </p>
      )}
      {data.expiring_soon.length > 0 && (
        <p className="text-xs text-amber-400" data-testid="expiring-docs">
          {t("docs.expiringSoon")}: {data.expiring_soon.map((d) => `${t(`docs.type_${d.type}`)} (${d.expiry_date})`).join("، ")}
        </p>
      )}

      <form onSubmit={upload} className="card-surface p-6 space-y-4" data-testid="doc-upload-form">
        <p className="font-heading font-bold flex items-center gap-2">
          <Upload className="w-4 h-4 text-brand" /> {t("docs.upload")}
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("docs.docType")}</label>
            <select data-testid="doc-type" value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
              {data.doc_types.map((d) => (
                <option key={d.key} value={d.key}>
                  {t(`docs.type_${d.key}`)} {d.required ? `(${t("docs.required")})` : `(${t("docs.optional")})`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("docs.expiry")}</label>
            <input data-testid="doc-expiry" type="date" value={form.expiry_date}
              onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm num focus:outline-none focus:ring-1 focus:ring-brand" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("docs.file")}</label>
            <input data-testid="doc-file" ref={fileRef} type="file" accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 py-2 text-xs file:me-2 file:bg-navy-700 file:border-0 file:rounded-lg file:px-3 file:py-1.5 file:text-slate-200 file:text-xs" />
          </div>
        </div>
        <button data-testid="doc-upload-btn" disabled={busy}
          className="bg-brand text-navy-900 font-bold rounded-xl px-6 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
          {busy ? t("docs.uploading") : t("docs.submit")}
        </button>
      </form>

      <div>
        <h2 className="heading text-lg font-bold mb-4">{t("docs.title")}</h2>
        {data.documents.length === 0 ? (
          <EmptyState icon={FileCheck} title={t("docs.noDocs")} testid="docs-empty" />
        ) : (
          <div className="space-y-3">
            {data.documents.map((d) => (
              <div key={d._id} className="card-surface p-4 flex flex-wrap items-center gap-4" data-testid={`doc-${d._id}`}>
                <div className="w-10 h-10 rounded-xl bg-navy-700/80 border border-navy-600/60 flex items-center justify-center shrink-0">
                  <FileCheck className="w-5 h-5 text-brand" />
                </div>
                <div className="flex-1 min-w-[180px]">
                  <p className="font-semibold text-sm">{t(`docs.type_${d.type}`)}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {d.original_filename} {d.expiry_date && <>· {t("docs.expiry")}: <span className="num">{d.expiry_date}</span></>}
                  </p>
                </div>
                <StatusBadge kind="doc" status={d.status} />
                {d.status === "rejected" && d.review_note && <p className="text-xs text-rose-400 w-full">{d.review_note}</p>}
                {d.file_path && (
                  <button onClick={() => viewFile(d._id)} data-testid={`doc-view-${d._id}`}
                    className="flex items-center gap-1.5 border border-navy-600 text-slate-300 rounded-xl px-3 py-1.5 text-xs hover:border-brand/40 hover:text-brand">
                    <Eye className="w-3.5 h-3.5" /> {t("admin.view")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
