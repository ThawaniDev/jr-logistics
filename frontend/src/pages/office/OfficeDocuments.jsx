import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FileCheck, Upload } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/constants";
import { useI18n } from "@/i18n";

const OFFICE_DOCS = [
  { key: "office_cr", ar: "السجل التجاري" },
  { key: "office_license", ar: "الترخيص / التصريح" },
  { key: "iban_certificate", ar: "شهادة الآيبان" },
  { key: "other", ar: "مستند آخر" },
];

export default function OfficeDocuments() {
  const { t } = useI18n();
  const [docs, setDocs] = useState(null);
  const [docType, setDocType] = useState("office_cr");
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = () => api.get("/office/documents").then(({ data }) => setDocs(data.documents)).catch(() => {});
  useEffect(() => { load(); }, []);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error(t("docs.chooseFile"));
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("doc_type", docType);
      if (expiry) fd.append("expiry_date", expiry);
      await api.post("/office/documents/upload", fd);
      toast.success(t("office.docUploaded"));
      setExpiry("");
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const sel = "bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand";

  return (
    <div className="space-y-6" data-testid="office-documents-page">
      <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
        <FileCheck className="w-6 h-6 text-brand" /> {t("office.documents")}
      </h1>

      <div className="card-surface p-6 space-y-4" data-testid="office-doc-upload">
        <p className="font-heading font-bold flex items-center gap-2">
          <Upload className="w-4 h-4 text-brand" /> {t("office.uploadDoc")}
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          <select data-testid="office-doc-type" value={docType} onChange={(e) => setDocType(e.target.value)} className={sel}>
            {OFFICE_DOCS.map((d) => <option key={d.key} value={d.key}>{d.ar}</option>)}
          </select>
          <input type="date" data-testid="office-doc-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={sel} />
          <input type="file" ref={fileRef} data-testid="office-doc-file" accept="image/*,.pdf"
            className="text-xs text-slate-400 file:bg-navy-800 file:border file:border-navy-600 file:rounded-lg file:px-3 file:py-2 file:text-slate-300" />
        </div>
        <button onClick={upload} disabled={busy} data-testid="office-doc-upload-btn"
          className="bg-brand text-navy-900 font-bold rounded-xl px-6 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
          {busy ? t("common.saving") : t("office.uploadDoc")}
        </button>
      </div>

      {!docs ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : docs.length === 0 ? (
        <EmptyState icon={FileCheck} title={t("office.noDocs")} desc={t("office.noDriversDesc")} testid="docs-empty" />
      ) : (
        <div className="grid gap-2" data-testid="office-docs-list">
          {docs.map((d) => (
            <div key={d._id} className="card-surface p-4 flex items-center justify-between flex-wrap gap-2" data-testid={`office-doc-${d._id}`}>
              <div>
                <p className="text-sm font-semibold">{OFFICE_DOCS.find((x) => x.key === d.type)?.ar || d.type}</p>
                <p className="text-[11px] text-slate-500">
                  {d.original_filename}
                  {d.expiry_date && <> · {t("docs.expiry")}: <span className="num">{fmtDate(d.expiry_date)}</span></>}
                </p>
              </div>
              <StatusBadge status={d.status} ns="docStatus" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
