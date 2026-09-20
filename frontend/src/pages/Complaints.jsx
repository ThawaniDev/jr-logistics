import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageSquareWarning, PlusCircle, Send } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";

const CATEGORIES = ["delay", "driver_behavior", "service_quality", "payment", "custody", "damage", "no_show", "other"];
const STATUS_CLS = {
  open: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  in_progress: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  resolved: "bg-green-500/10 text-green-300 border-green-500/30",
  closed: "bg-slate-700/40 text-slate-400 border-slate-600/40",
};

export default function Complaints() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ request_id: "", category: "other", subject: "", description: "" });
  const [noteFor, setNoteFor] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const locale = lang === "ar" ? "ar-SA" : lang === "ur" ? "ur-PK" : "en-US";

  const load = () => api.get("/complaints").then(({ data }) => setItems(data.complaints)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => {
    load();
    const merge = (lists) => {
      const seen = new Map();
      lists.flat().filter(Boolean).forEach((j) => { if (j.id && !seen.has(j.id)) seen.set(j.id, j); });
      setJobs([...seen.values()]);
    };
    if (user?.role === "business") {
      api.get("/business/requests").then(({ data }) => merge((data.requests || []).map((r) => ({ id: r._id, title: r.title })))).catch(() => {});
    } else if (user?.role === "office") {
      api.get("/office/jobs").then(({ data }) => merge((data.jobs || []).map((j) => ({ id: j.request_id, title: j.request?.title || j.request_id })))).catch(() => {});
    } else if (user?.role === "worker") {
      Promise.all([api.get("/worker/jobs").catch(() => ({ data: { jobs: [] } })),
                   api.get("/worker/history").catch(() => ({ data: { history: [] } }))])
        .then(([a, b]) => merge([...(a.data.jobs || []), ...(b.data.history || [])]
          .map((j) => ({ id: j.request_id, title: j.request?.title || j.request_id })))).catch(() => {});
    }
  }, [user?.role]);

  const submit = async () => {
    if (!form.request_id || !form.subject.trim() || !form.description.trim()) return toast.error(t("common.required") || t("cmp.submit"));
    setBusy(true);
    try {
      await api.post("/complaints", form);
      toast.success(t("cmp.submitted"));
      setFormOpen(false);
      setForm({ request_id: "", category: "other", subject: "", description: "" });
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const addNote = async (cid) => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api.post(`/complaints/${cid}/notes`, { text: note });
      toast.success(t("cmp.saved"));
      setNoteFor(null);
      setNote("");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="complaints-page">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
            <MessageSquareWarning className="w-6 h-6 text-brand" /> {t("cmp.title")}
          </h1>
          <p className="text-sm text-slate-400 mt-1">{t("cmp.sub")}</p>
        </div>
        <button onClick={() => setFormOpen(!formOpen)} data-testid="new-complaint-btn"
          className="flex items-center gap-2 bg-brand text-navy-900 font-bold rounded-xl px-5 py-2.5 text-sm hover:bg-brand-hover transition-colors">
          <PlusCircle className="w-4 h-4" /> {t("cmp.new")}
        </button>
      </div>

      {formOpen && (
        <div className="card-surface p-6 space-y-4" data-testid="complaint-form">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t("cmp.job")}</label>
              <select value={form.request_id} data-testid="complaint-job"
                onChange={(e) => setForm({ ...form, request_id: e.target.value })}
                className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
                <option value="">{t("cmp.selectJob")}</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t("cmp.category")}</label>
              <select value={form.category} data-testid="complaint-category"
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
                {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cmp.cat_${c}`)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("cmp.subject")}</label>
            <input value={form.subject} data-testid="complaint-subject"
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand" />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("cmp.desc")}</label>
            <textarea value={form.description} data-testid="complaint-description"
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 py-2 text-sm min-h-[90px] focus:outline-none focus:ring-1 focus:ring-brand" />
          </div>
          <button onClick={submit} disabled={busy} data-testid="complaint-submit"
            className="bg-brand text-navy-900 font-bold rounded-xl px-6 py-2.5 text-sm hover:bg-brand-hover disabled:opacity-50 transition-colors">
            {t("cmp.submit")}
          </button>
        </div>
      )}

      {!items ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <EmptyState icon={MessageSquareWarning} title={t("cmp.empty")} desc={t("cmp.emptyDesc")} testid="complaints-empty" />
      ) : (
        <div className="space-y-3" data-testid="complaints-list">
          {items.map((c) => (
            <div key={c._id} className="card-surface p-5 space-y-3" data-testid={`complaint-${c._id}`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <p className="font-semibold text-sm">{c.subject}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {c.request?.title} · <span className="num">{new Date(c.created_at).toLocaleString(locale)}</span>
                  </p>
                </div>
                <span className="chip bg-navy-800 text-slate-300 border-navy-600">{t(`cmp.cat_${c.category}`)}</span>
                <span className={`chip ${STATUS_CLS[c.status] || ""}`} data-testid={`complaint-status-${c._id}`}>{t(`cmp.st_${c.status}`)}</span>
              </div>
              <p className="text-xs text-slate-400">{c.description}</p>
              {c.assigned_to_name && (
                <p className="text-[11px] text-blue-400">{t("cmp.assignedTo")}: <b>{c.assigned_to_name}</b></p>
              )}
              {c.resolution && (
                <p className="text-[11px] text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2" data-testid={`complaint-resolution-${c._id}`}>
                  {t("cmp.resolution")}: {c.resolution}
                </p>
              )}
              {(c.notes || []).map((n, i) => (
                <p key={i} className="text-[11px] text-slate-400 border-s border-navy-600 ps-3">
                  <b className="text-slate-300">{n.by}</b>: {n.text}
                </p>
              ))}
              {c.status !== "closed" && (
                noteFor === c._id ? (
                  <div className="flex gap-2" data-testid={`note-form-${c._id}`}>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("cmp.notePh")}
                      data-testid={`note-input-${c._id}`}
                      className="flex-1 bg-navy-800 border border-navy-600 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand" />
                    <button onClick={() => addNote(c._id)} disabled={busy} data-testid={`note-send-${c._id}`}
                      className="bg-brand text-navy-900 font-bold rounded-xl px-4 text-xs hover:bg-brand-hover disabled:opacity-50">
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { setNoteFor(c._id); setNote(""); }} data-testid={`note-open-${c._id}`}
                    className="text-[11px] border border-navy-600 text-slate-300 rounded-lg px-3 py-1.5 hover:border-brand/40 hover:text-brand transition-colors">
                    {t("cmp.addNote")}
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
