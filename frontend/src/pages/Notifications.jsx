import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import api from "@/lib/api";
import { useI18n } from "@/i18n";
import { EmptyState } from "@/components/EmptyState";

const TYPE_COLORS = {
  offer: "text-amber-400 bg-amber-500/10 border-amber-500/25",
  accepted: "text-blue-400 bg-blue-500/10 border-blue-500/25",
  confirmed: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
  earning: "text-green-300 bg-green-500/10 border-green-500/25",
  attendance: "text-cyan-400 bg-cyan-500/10 border-cyan-500/25",
  replacement: "text-rose-400 bg-rose-500/10 border-rose-500/25",
  withdrawal: "text-amber-400 bg-amber-500/10 border-amber-500/25",
  support: "text-blue-400 bg-blue-500/10 border-blue-500/25",
  broadcast: "text-brand bg-brand/10 border-brand/25",
};

export default function Notifications() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState(null);

  const load = () => api.get("/notifications").then(({ data }) => setItems(data.notifications));
  useEffect(() => {
    load();
    api.post("/notifications/read-all").catch(() => {});
  }, []);

  const locale = lang === "ar" ? "ar-SA" : lang === "ur" ? "ur-PK" : "en-US";

  return (
    <div className="space-y-6" data-testid="notifications-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="heading text-2xl font-extrabold">{t("notif.title")}</h1>
          <p className="text-sm text-slate-400 mt-1">{t("notif.sub")}</p>
        </div>
        <button onClick={() => api.post("/notifications/read-all").then(load)} data-testid="mark-all-read-btn"
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-brand transition-colors">
          <CheckCheck className="w-4 h-4" /> {t("notif.markAll")}
        </button>
      </div>
      {!items ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <EmptyState icon={Bell} title={t("notif.empty")} desc={t("notif.emptyDesc")} testid="notifications-empty" />
      ) : (
        <div className="space-y-3">
          {items.map((n) => {
            const body = (
              <div
                data-testid={`notification-${n._id}`}
                className={`card-surface card-surface-hover p-4 flex gap-4 ${!n.read ? "border-brand/30" : ""}`}
              >
                <div className={`w-10 h-10 shrink-0 rounded-xl border flex items-center justify-center ${TYPE_COLORS[n.type] || "text-slate-400 bg-navy-700 border-navy-600"}`}>
                  <Bell className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm">{n.title}</p>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{n.body}</p>
                  <p className="text-[10px] text-slate-600 mt-2 num">{new Date(n.created_at).toLocaleString(locale)}</p>
                </div>
                {!n.read && <span className="w-2 h-2 rounded-full bg-brand shrink-0 mt-2" />}
              </div>
            );
            return n.link ? (
              <Link key={n._id} to={n.link}>{body}</Link>
            ) : (
              <div key={n._id}>{body}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
