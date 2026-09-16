import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LifeBuoy, Send, MessageSquare, ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";

const CATEGORIES = [
  { key: "general", label: "استفسار عام" },
  { key: "wallet", label: "المحفظة والمدفوعات" },
  { key: "attendance", label: "الحضور والتغيب" },
  { key: "technical", label: "مشكلة تقنية" },
  { key: "report", label: "الإبلاغ عن مشكلة" },
];

export default function Support() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [tickets, setTickets] = useState(null);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({ subject: "", category: "general", message: "" });
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/tickets").then(({ data }) => setTickets(data.tickets)).catch(() => {});
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim()) return toast.error("أكمل بيانات التذكرة");
    setBusy(true);
    try {
      await api.post("/tickets", form);
      toast.success("تم إرسال التذكرة — سيرد عليك فريق الدعم");
      setForm({ subject: "", category: "general", message: "" });
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
      toast.success("تم إرسال الرد");
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const resolve = async (id) => {
    try {
      await api.post(`/tickets/${id}/resolve`);
      load();
      toast.success("تم إغلاق التذكرة");
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="space-y-6" data-testid="support-page">
      <div>
        <h1 className="heading text-2xl font-extrabold">{isAdmin ? "الدعم والشكاوى" : "الدعم والمساندة"}</h1>
        <p className="text-sm text-slate-400 mt-1">
          {isAdmin ? "إدارة تذاكر المنشآت والعمال" : "فريق إسناد جاهز لمساعدتك على مدار الساعة"}
        </p>
      </div>

      {!isAdmin && (
        <form onSubmit={submit} className="card-surface p-6 space-y-4" data-testid="support-form">
          <p className="font-heading font-bold flex items-center gap-2"><LifeBuoy className="w-4 h-4 text-brand" /> فتح تذكرة جديدة</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">الموضوع</label>
              <Input data-testid="ticket-subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="bg-navy-800 border-navy-600 h-11" />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">التصنيف</label>
              <select data-testid="ticket-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full bg-navy-800 border border-navy-600 rounded-md px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-brand">
                {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">التفاصيل</label>
            <Textarea data-testid="ticket-message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
              className="bg-navy-800 border-navy-600 min-h-[90px]" />
          </div>
          <button data-testid="ticket-submit-btn" disabled={busy}
            className="bg-brand text-navy-900 font-bold rounded-xl px-6 py-2.5 text-sm hover:bg-brand-hover transition-colors disabled:opacity-50 flex items-center gap-2">
            <Send className="w-4 h-4" /> {busy ? "جاري الإرسال…" : "إرسال التذكرة"}
          </button>
        </form>
      )}

      {!tickets ? (
        <p className="text-slate-500 text-sm">جاري التحميل…</p>
      ) : tickets.length === 0 ? (
        <EmptyState icon={MessageSquare} title="لا توجد تذاكر" desc="تذاكر الدعم والبلاغات ستظهر هنا" testid="tickets-empty" />
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <div key={t._id} className="card-surface overflow-hidden" data-testid={`ticket-${t._id}`}>
              <button onClick={() => setOpen(open === t._id ? null : t._id)}
                data-testid={`ticket-toggle-${t._id}`}
                className="w-full flex items-center gap-4 p-4 text-right hover:bg-navy-700/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="font-semibold text-sm">{t.subject}</p>
                    <StatusBadge kind="ticket" status={t.status} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {isAdmin && <span className="text-slate-400">{t.user?.name} · </span>}
                    <span className="num">{new Date(t.created_at).toLocaleDateString("ar-SA")}</span>
                    {t.replies?.length > 0 && ` · ${t.replies.length} رد`}
                  </p>
                </div>
                {open === t._id ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
              </button>
              {open === t._id && (
                <div className="border-t border-navy-600/50 p-4 space-y-3 bg-navy-850/40">
                  <div className="bg-navy-800 rounded-xl p-3 text-sm leading-relaxed">{t.message}</div>
                  {t.replies?.map((r, i) => (
                    <div key={i} className={`rounded-xl p-3 text-sm leading-relaxed ${r.from_admin ? "bg-brand/10 border border-brand/20" : "bg-navy-800"}`}>
                      <p className="text-[11px] text-slate-400 mb-1">{r.author} {r.from_admin && "· فريق الدعم"}</p>
                      {r.message}
                    </div>
                  ))}
                  {t.status !== "resolved" && (
                    <div className="flex gap-2">
                      <Input data-testid={`ticket-reply-${t._id}`} value={reply} onChange={(e) => setReply(e.target.value)}
                        placeholder="اكتب ردك…" className="bg-navy-800 border-navy-600 h-10" />
                      <button onClick={() => sendReply(t._id)} data-testid={`ticket-reply-btn-${t._id}`}
                        className="shrink-0 bg-brand text-navy-900 font-bold rounded-xl px-4 text-sm hover:bg-brand-hover">
                        رد
                      </button>
                      <button onClick={() => resolve(t._id)} data-testid={`ticket-resolve-btn-${t._id}`}
                        className="shrink-0 border border-navy-600 text-slate-300 rounded-xl px-4 text-sm hover:border-brand/40 hover:text-brand">
                        إغلاق
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
