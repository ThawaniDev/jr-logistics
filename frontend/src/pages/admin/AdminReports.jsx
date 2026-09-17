import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BarChart3, Download } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";

const REPORT_TYPES = ["businesses", "drivers", "requests", "finance", "operations", "support", "staff"];

export default function AdminReports() {
  const { t } = useI18n();
  const { user } = useAuth();
  const perms = user?.role === "admin" ? ["*"] : (user?.staff_profile?.permissions || []);
  const canExport = perms.includes("*") || perms.includes("reports_export") || perms.includes("reports");
  const [type, setType] = useState("requests");
  const [filters, setFilters] = useState({ date_from: "", date_to: "", city: "", status: "" });
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setData(null);
    api.get(`/admin/reports/${type}`, {
      params: {
        date_from: filters.date_from || undefined, date_to: filters.date_to || undefined,
        city: filters.city || undefined, status: filters.status || undefined,
      },
    }).then(({ data }) => setData(data)).catch((e) => toast.error(errMsg(e)));
  };
  useEffect(() => { load(); }, [type]);

  const exportCsv = async () => {
    setBusy(true);
    try {
      const { data } = await api.get(`/admin/reports/${type}/export`, {
        params: {
          date_from: filters.date_from || undefined, date_to: filters.date_to || undefined,
          city: filters.city || undefined, status: filters.status || undefined,
        },
        responseType: "blob",
      });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}-report.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("rep.exported"));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const cols = data?.rows?.length ? Object.keys(data.rows[0]).filter((k) => !k.startsWith("_") || k === "_id") : [];

  return (
    <div className="space-y-6" data-testid="admin-reports-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{t("rep.title")}</h1>
        <p className="text-sm text-slate-400 mt-1">{t("rep.sub")}</p>
      </div>

      <div className="flex gap-2 flex-wrap" data-testid="report-types">
        {REPORT_TYPES.map((rt) => (
          <button key={rt} onClick={() => setType(rt)} data-testid={`report-${rt}`}
            className={`chip ${type === rt ? "bg-brand/15 text-brand border-brand/40" : "bg-navy-800 text-slate-400 border-navy-600"}`}>
            {t(`rep.t_${rt}`)}
          </button>
        ))}
      </div>

      <div className="card-surface p-4 flex flex-wrap items-end gap-3" data-testid="report-filters">
        <div>
          <label className="text-[11px] text-slate-500 block mb-1">{t("rep.from")}</label>
          <input type="date" value={filters.date_from} data-testid="rep-date-from"
            onChange={(e) => setFilters({ ...filters, date_from: e.target.value })}
            className="bg-navy-800 border border-navy-600 rounded-md px-3 h-10 text-sm num focus:outline-none focus:ring-1 focus:ring-brand" />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 block mb-1">{t("rep.to")}</label>
          <input type="date" value={filters.date_to} data-testid="rep-date-to"
            onChange={(e) => setFilters({ ...filters, date_to: e.target.value })}
            className="bg-navy-800 border border-navy-600 rounded-md px-3 h-10 text-sm num focus:outline-none focus:ring-1 focus:ring-brand" />
        </div>
        <button onClick={load} data-testid="rep-apply-btn"
          className="bg-navy-700 border border-navy-600 text-slate-200 rounded-xl px-5 h-10 text-sm hover:border-brand/40 transition-colors">
          {t("rep.apply")}
        </button>
        {canExport && (
          <button onClick={exportCsv} disabled={busy || !data?.rows?.length} data-testid="rep-export-btn"
            className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-5 h-10 text-sm hover:bg-brand-hover disabled:opacity-40 transition-colors">
            <Download className="w-4 h-4" /> {t("rep.export")}
          </button>
        )}
        {data && <span className="text-xs text-slate-500 num ms-auto">{data.count} {t("rep.rows")}</span>}
      </div>

      {!data ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : data.rows.length === 0 ? (
        <EmptyState icon={BarChart3} title={t("rep.empty")} testid="report-empty" />
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-navy-800">
                <tr className="border-b border-navy-600/50 text-slate-400">
                  {cols.map((c) => <th key={c} className="text-start p-3 font-semibold whitespace-nowrap">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={row._id || row.id || i} className="border-b border-navy-600/30 hover:bg-navy-700/20" data-testid={`report-row-${i}`}>
                    {cols.map((c) => (
                      <td key={c} className="p-3 whitespace-nowrap text-slate-300 max-w-[220px] truncate">
                        {row[c] == null ? "—" : String(row[c])}
                      </td>
                    ))}
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
