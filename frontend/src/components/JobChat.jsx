import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Send, MessageCircle } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { useI18n } from "@/i18n";
import { useAuth } from "@/context/AuthContext";

export function JobChat({ offerId }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const boxRef = useRef(null);

  const load = () =>
    api.get(`/jobs/${offerId}/messages`).then(({ data }) => setMessages(data.messages)).catch(() => {});
  useEffect(() => {
    load();
    const iv = setInterval(load, 8000);
    return () => clearInterval(iv);
  }, [offerId]);
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await api.post(`/jobs/${offerId}/messages`, { text: text.trim() });
      setText("");
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="rounded-xl border border-navy-600/40 bg-navy-800/40 overflow-hidden" data-testid={`chat-${offerId}`}>
      <p className="text-xs font-bold text-slate-300 px-3 py-2 border-b border-navy-600/40 flex items-center gap-1.5">
        <MessageCircle className="w-3.5 h-3.5 text-brand" /> {t("chat.title")}
      </p>
      <div ref={boxRef} className="max-h-56 overflow-y-auto p-3 space-y-2" data-testid={`chat-messages-${offerId}`}>
        {messages.length === 0 && <p className="text-[11px] text-slate-500">{t("chat.empty")}</p>}
        {messages.map((m) => (
          <div key={m._id} className={`flex ${m.sender_id === user?._id ? "justify-start flex-row-reverse" : ""}`}>
            <div className={`max-w-[80%] rounded-xl px-3 py-2 text-xs ${m.sender_id === user?._id ? "bg-brand/15 text-brand border border-brand/25" : "bg-navy-700/60 text-slate-200 border border-navy-600/40"}`}>
              <p className="text-[10px] opacity-70 mb-0.5">{m.sender_name}</p>
              <p>{m.text}</p>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="flex gap-2 p-2 border-t border-navy-600/40">
        <input value={text} onChange={(e) => setText(e.target.value)} data-testid={`chat-input-${offerId}`}
          placeholder={t("chat.placeholder")}
          className="flex-1 bg-navy-800 border border-navy-600 rounded-lg px-3 h-9 text-xs focus:outline-none focus:ring-1 focus:ring-brand" />
        <button type="submit" data-testid={`chat-send-${offerId}`}
          className="bg-brand text-navy-900 rounded-lg px-3 h-9 flex items-center hover:bg-brand-hover transition-colors">
          <Send className="w-3.5 h-3.5 rtl:-scale-x-100" />
        </button>
      </form>
    </div>
  );
}
