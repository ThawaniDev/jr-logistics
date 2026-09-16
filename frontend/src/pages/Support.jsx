import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LifeBuoy, Send, MessageSquare, ChevronDown, ChevronUp, ArrowUpRight, Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";

const BIZ_CATEGORIES = ["general", "wallet", "technical", "driver_no_show", "driver_refused",
  "shipment_count", "location_issue", "payment_issue", "replacement_request", "urgent", "other"];
const WORKER_CATEGORIES = ["general", "wallet", "technical", "business_not_ready", "not_put_to_work",
  "shipment_count_differs", "location_issue", "task_issue", "attendance_issue", "payment_issue",
  "cancellation", "urgent", "other"];
const ESC_LEVELS = ["support", "operations", "account_manager"];

export default function Support() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const isStaff = user?.role === "admin" || user?.role === "staff";
  const [tickets, setTickets] = useState(null);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({ subject: "", category: "general", message: "", request_id: "", priority: "normal" });
  const [requests, setRequests] = useState([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/tickets").then(({ data }) => setTickets(data.tickets)).catch(() => {});
  useEffect(() => {
    load();
    if (user?.role === "business") {
      api.get("/business/requests").then(({ data }) => setRequests(data.requests.map((r) => ({ id: r._id, title: r.title })))).catch(() => {});
    } else if (user?.role === "worker") {
      api.get("/worker/jobs").then(({ data }) =>
        setRequests(data.jobs.filter((o) => o.request).map((o) => ({ id: o.request._id, title: o.request.title })))).catch(() => {});
    }
  }, [user?.role]);

  const categories = user?.role === "worker" ? WORKER_CATEGORIES : BIZ_CATEGORIES;
  const locale = lang === "ar" ? "ar-SA" : lang === "ur" ? "ur-PK" : "en-US";

  const submit = async (e) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim()) return toast.error(t("support.formError"));
    setBusy(true);
    try {
      await api.post("/tickets", {
        subject: form.subject, category: form.category, message: form.message,
        request_id: form.request_id || null, priority: form.priority,
      });
      toast.success(t("support.ticketDone"));
      setForm({ subject: "", category: "general", message: "", request_id: "", priority: "normal" });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async (id) => {
    if (!reply.trim()) return;
    try {
      await api.post(`/tickets/${id}/reply`, { message: reply });
      setReply("");
      load();
      toast.success(t("support.replyDone"));
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const resolve = async (id) => {
    try {
      await api.post(`/tickets/${id}/resolve`);
      load();
      toast.success(t("support.closed"));
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const escalate = async (id, level) => {
    try {
      await api.post(`/tickets/${id}/escalate`, { level });
      load();
      toast.success(t("support.replyDone"));
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const selCls = "w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand";

  return (
    <div className="space-y-6" data-testid="support-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{isStaff ? t("support.titleA") : t("support.titleB")}</h1>
        <p className="text-sm text-slate-400 mt-1">{isStaff ? t("support.subA") : t("support.subB")}</p>
      </div>

      {!isStaff && (
        <form onSubmit={submit} className="card-surface p-6 space-y-4" data-testid="support-form">
          <p className="font-heading font-bold flex items-center gap-2"><LifeBuoy className="w-4 h-4 text-brand" /> {t("support.newTicket")}</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t("support.subject")}</label>
              <Input data-testid="ticket-subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="bg-navy-800 border-navy-600 h-11" />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t("support.category")}</label>
              <select data-testid="ticket-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={selCls}>
                {categories.map((c) => <option key={c} value={c}>{t(`support.cat_${c}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t("support.linkRequest")}</label>
              <select data-testid="ticket-request" value={form.request_id} onChange={(e) => setForm({ ...form, request_id: e.target.value })} className={selCls}>
                <option value="">{t("support.noLink")}</option>
                {requests.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t("support.priority")}</label>
              <select data-testid="ticket-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={selCls}>
                <option value="normal">{t("support.normal")}</option>
                <option value="urgent">{t("support.urgent")}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("support.message")}</label>
            <Textarea data-testid="ticket-message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
              className="bg-navy-800 border-navy-600 min-h-[90px]" />
          </div>
          <button data-testid="ticket-submit-btn" disabled={busy}
            className="bg-brand text-navy-900 font-bold rounded-xl px-6 py-2.5 text-sm hover:bg-brand-hover transition-colors disabled:opacity-50 flex items-center gap-2">
            <Send className="w-4 h-4" /> {busy ? t("support.sending") : t("support.sendTicket")}
          </button>
        </form>
      )}

      {!tickets ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : tickets.length === 0 ? (
        <EmptyState icon={MessageSquare} title={t("support.noTickets")} desc={t("support.noTicketsDesc")} testid="tickets-empty" />
      ) : (
        <div className="space-y-3">
          {tickets.map((tk) => (
            <div key={tk._id} className="card-surface overflow-hidden" data-testid={`ticket-${tk._id}`}>
              <button onClick={() => setOpen(open === tk._id ? null : tk._id)}
                data-testid={`ticket-toggle-${tk._id}`}
                className="w-full flex items-center gap-4 p-4 text-start hover:bg-navy-700/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="font-semibold text-sm">{tk.subject}</p>
                    <StatusBadge kind="ticket" status={tk.status} />
                    {tk.priority === "urgent" && (
                      <span className="chip bg-rose-500/10 text-rose-400 border-rose-500/30">{t("support.urgent")}</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {isStaff && <span className="text-slate-400">{tk.user?.name} · </span>}
                    <span>{t(`support.cat_${tk.category}`)}</span> · <span className="num">{new Date(tk.created_at).toLocaleDateString(locale)}</span>
                    {tk.replies?.length > 0 && ` · ${tk.replies.length} ${t("support.replies")}`}
                  </p>
                </div>
                {open === tk._id ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
              </button>
              {open === tk._id && (
                <div className="border-t border-navy-600/50 p-4 space-y-3 bg-navy-850/40">
                  {tk.request && (
                    <p className="text-xs text-slate-400 flex items-center gap-1.5" data-testid={`ticket-linked-${tk._id}`}>
                      <Link2 className="w-3.5 h-3.5 text-brand" /> {t("support.linkedRequest")}:
                      <span className="font-semibold text-slate-200">{tk.request.title}</span>
                      <span className="num text-slate-500">{tk.request.start_date}</span>
                    </p>
                  )}
                  <div className="bg-navy-800 rounded-xl p-3 text-sm leading-relaxed">{tk.message}</div>
                  {tk.replies?.map((r, i) => (
                    <div key={i} className={`rounded-xl p-3 text-sm leading-relaxed ${r.from_admin ? "bg-brand/10 border border-brand/20" : "bg-navy-800"}`}>
                      <p className="text-[11px] text-slate-400 mb-1">{r.author} {r.from_admin && `· ${t("support.teamSupport")}`}</p>
                      {r.message}
                    </div>
                  ))}
                  {isStaff && (
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <label className="text-[11px] text-slate-500">{t("support.escalation")}:</label>
                      <div className="flex gap-2" data-testid={`ticket-escalate-${tk._id}`}>
                        {ESC_LEVELS.map((lv) => (
                          <button key={lv} onClick={() => escalate(tk._id, lv)} data-testid={`escalate-${lv}-${tk._id}`}
                            className={`chip text-[11px] ${tk.escalation === lv ? "bg-brand/15 text-brand border-brand/40" : "bg-navy-800 text-slate-400 border-navy-600 hover:border-slate-500"}`}>
                            <ArrowUpRight className="w-3 h-3" /> {t(`support.esc_${lv}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {tk.activity?.length > 0 && (
                    <div className="pt-2 border-t border-navy-600/40" data-testid={`ticket-activity-${tk._id}`}>
                      <p className="text-[11px] text-slate-500 mb-1.5">{t("support.activity")}</p>
                      <div className="space-y-1">
                        {tk.activity.map((a, i) => (
                          <p key={i} className="text-[10px] text-slate-600">
                            <span className="text-slate-400">{a.by}</span> — {t(`support.act_${a.action}`)}
                            <span className="num ms-2">{new Date(a.at).toLocaleString(locale)}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                  {tk.status !== "resolved" && (
                    <div className="flex gap-2">
                      <Input data-testid={`ticket-reply-${tk._id}`} value={reply} onChange={(e) => setReply(e.target.value)}
                        placeholder={t("support.replyPh")} className="bg-navy-800 border-navy-600 h-10" />
                      <button onClick={() => sendReply(tk._id)} data-testid={`ticket-reply-btn-${tk._id}`}
                        className="shrink-0 bg-brand text-navy-900 font-bold rounded-xl px-4 text-sm hover:bg-brand-hover">
                        {t("support.reply")}
                      </button>
                      <button onClick={() => resolve(tk._id)} data-testid={`ticket-resolve-btn-${tk._id}`}
                        className="shrink-0 border border-navy-600 text-slate-300 rounded-xl px-4 text-sm hover:border-brand/40 hover:text-brand">
                        {t("support.closeTicket")}
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
