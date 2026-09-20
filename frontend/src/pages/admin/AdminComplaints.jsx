import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageSquareWarning, Send, UserCheck, CheckCircle2, XCircle } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";

const STATUSES = ["open", "in_progress", "resolved", "closed"];
const STATUS_CLS = {
  open: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  in_progress: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  resolved: "bg-green-500/10 text-green-300 border-green-500/30",
  closed: "bg-slate-700/40 text-slate-400 border-slate-600/40",
};
const CATEGORIES = ["delay", "driver_behavior", "service_quality", "payment", "custody", "damage", "no_show", "other"];

export default function AdminComplaints() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [staff, setStaff] = useState([]);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [busy, setBusy] = useState("");
  const locale = lang === "ar" ? "ar-SA" : lang === "ur" ? "ur-PK" : "en-US";

  const load = () =>
    api.get("/complaints", { params: { status: filter || undefined } })
      .then(({ data }) => setItems(data.complaints)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, [filter]);
  useEffect(() => {
    api.get("/admin/staff").then(({ data }) => setStaff(data.staff || [])).catch(() =>
      setStaff(user ? [{ _id: user._id, name: user.name }] : []));
  }, []);

  const act = async (key, fn, msg) => {
    setBusy(key);
    try {
      await fn();
      toast.success(msg);
      setNote(""); setResolution(""); setAssignTo("");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-complaints-page">
      <div>
        <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
          <MessageSquareWarning className="w-6 h-6 text-brand" /> {t("cmp.title")}
        </h1>
        <p className="text-sm text-slate-400 mt-1">{t("cmp.adminSub")}</p>
      </div>

      <div className="flex gap-2 flex-wrap" data-testid="complaint-filters">
        <button onClick={() => setFilter("")} data-testid="cfilter-all"
          className={`chip ${!filter ? "bg-brand/15 text-brand border-brand/40" : "bg-navy-800 text-slate-400 border-navy-600"}`}>
          {t("common.all")}
        </button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setFilter(s)} data-testid={`cfilter-${s}`}
            className={`chip ${filter === s ? STATUS_CLS[s] : "bg-navy-800 text-slate-400 border-navy-600"}`}>
            {t(`cmp.st_${s}`)}
          </button>
        ))}
      </div>

      {!items ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <EmptyState icon={MessageSquareWarning} title={t("cmp.empty")} testid="admin-complaints-empty" />
      ) : (
        <div className="space-y-3" data-testid="admin-complaints-list">
          {items.map((c) => (
            <div key={c._id} className="card-surface overflow-hidden" data-testid={`admin-complaint-${c._id}`}>
              <button onClick={() => setExpanded(expanded === c._id ? null : c._id)}
                data-testid={`complaint-toggle-${c._id}`}
                className="w-full flex flex-wrap items-center gap-3 p-4 text-start hover:bg-navy-700/20 transition-colors">
                <div className="flex-1 min-w-[220px]">
                  <p className="font-semibold text-sm">{c.subject}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {c.user?.name} ({t(`cmp.role_${c.user_role}`) !== `cmp.role_${c.user_role}` ? t(`cmp.role_${c.user_role}`) : c.user_role}) · {c.request?.title} · <span className="num">{new Date(c.created_at).toLocaleDateString(locale)}</span>
                  </p>
                </div>
                <span className="chip bg-navy-800 text-slate-300 border-navy-600">{t(`cmp.cat_${CATEGORIES.includes(c.category) ? c.category : "other"}`)}</span>
                {c.priority === "urgent" && <span className="chip bg-rose-500/10 text-rose-400 border-rose-500/30">{t("cmp.urgent")}</span>}
                <span className={`chip ${STATUS_CLS[c.status] || ""}`}>{t(`cmp.st_${c.status}`)}</span>
              </button>

              {expanded === c._id && (
                <div className="border-t border-navy-600/50 p-5 bg-navy-850/40 space-y-4" data-testid={`complaint-detail-${c._id}`}>
                  <p className="text-xs text-slate-300">{c.description}</p>
                  {c.assigned_to_name && <p className="text-[11px] text-blue-400">{t("cmp.assignedTo")}: <b>{c.assigned_to_name}</b></p>}
                  {c.resolution && (
                    <p className="text-[11px] text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2">
                      {t("cmp.resolution")}: {c.resolution}
                    </p>
                  )}
                  {(c.notes || []).length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold text-slate-400">{t("cmp.notes")}</p>
                      {c.notes.map((n, i) => (
                        <p key={i} className="text-[11px] text-slate-400 border-s border-navy-600 ps-3">
                          <b className="text-slate-300">{n.by}</b>: {n.text}
                        </p>
                      ))}
                    </div>
                  )}
                  {(c.history || []).length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold text-slate-400">{t("cmp.history")}</p>
                      {c.history.slice(-8).reverse().map((h, i) => (
                        <p key={i} className="text-[10px] text-slate-500">
                          {h.by} · {h.action}{h.note ? ` — ${h.note}` : ""} · <span className="num">{new Date(h.at).toLocaleString(locale)}</span>
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-navy-600/40">
                    <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} data-testid={`assign-select-${c._id}`}
                      className="bg-navy-800 border border-navy-600 rounded-md px-3 h-9 text-xs focus:outline-none focus:ring-1 focus:ring-brand">
                      <option value="">{t("cmp.assignTo")}</option>
                      {staff.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                    </select>
                    <button disabled={!assignTo || busy} data-testid={`assign-btn-${c._id}`}
                      onClick={() => act(`as-${c._id}`, () => api.post(`/complaints/${c._id}/assign`, { staff_id: assignTo }), t("cmp.saved"))}
                      className="flex items-center gap-1.5 bg-blue-500/15 border border-blue-500/40 text-blue-400 font-semibold rounded-xl px-4 py-2 text-xs hover:bg-blue-500/25 disabled:opacity-50 transition-colors">
                      <UserCheck className="w-3.5 h-3.5" /> {t("cmp.assignTo")}
                    </button>
                    {c.status === "open" && (
                      <button disabled={busy} data-testid={`progress-btn-${c._id}`}
                        onClick={() => act(`pr-${c._id}`, () => api.post(`/complaints/${c._id}/status`, { status: "in_progress" }), t("cmp.saved"))}
                        className="bg-navy-700 border border-navy-600 text-slate-200 rounded-xl px-4 py-2 text-xs hover:border-brand/40 transition-colors">
                        {t("cmp.startProgress")}
                      </button>
                    )}
                  </div>
                  {["open", "in_progress"].includes(c.status) && (
                    <div className="flex flex-wrap gap-2 items-center">
                      <input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder={t("cmp.resolutionPh")}
                        data-testid={`resolution-input-${c._id}`}
                        className="flex-1 min-w-[220px] bg-navy-800 border border-navy-600 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand" />
                      <button disabled={!resolution.trim() || busy} data-testid={`resolve-btn-${c._id}`}
                        onClick={() => act(`re-${c._id}`, () => api.post(`/complaints/${c._id}/status`, { status: "resolved", resolution }), t("cmp.saved"))}
                        className="flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-semibold rounded-xl px-4 py-2 text-xs hover:bg-emerald-500/25 disabled:opacity-50 transition-colors">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {t("cmp.resolve")}
                      </button>
                      <button disabled={!resolution.trim() || busy} data-testid={`close-btn-${c._id}`}
                        onClick={() => act(`cl-${c._id}`, () => api.post(`/complaints/${c._id}/status`, { status: "closed", resolution }), t("cmp.saved"))}
                        className="flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/30 text-rose-400 font-semibold rounded-xl px-4 py-2 text-xs hover:bg-rose-500/20 disabled:opacity-50 transition-colors">
                        <XCircle className="w-3.5 h-3.5" /> {t("cmp.closeC")}
                      </button>
                    </div>
                  )}
                  {c.status !== "closed" && (
                    <div className="flex gap-2">
                      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("cmp.notePh")}
                        data-testid={`admin-note-input-${c._id}`}
                        className="flex-1 bg-navy-800 border border-navy-600 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand" />
                      <button disabled={!note.trim() || busy} data-testid={`admin-note-send-${c._id}`}
                        onClick={() => act(`n-${c._id}`, () => api.post(`/complaints/${c._id}/notes`, { text: note }), t("cmp.saved"))}
                        className="bg-brand text-navy-900 font-bold rounded-xl px-4 text-xs hover:bg-brand-hover disabled:opacity-50">
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
