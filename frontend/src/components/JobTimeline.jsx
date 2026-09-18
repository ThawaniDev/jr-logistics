import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import api from "@/lib/api";
import { useI18n } from "@/i18n";

export function JobTimeline({ offerId }) {
  const { t, lang } = useI18n();
  const [events, setEvents] = useState([]);
  const locale = lang === "ar" ? "ar-SA" : lang === "ur" ? "ur-PK" : "en-US";

  useEffect(() => {
    api.get(`/jobs/${offerId}/timeline`).then(({ data }) => setEvents(data.events)).catch(() => {});
  }, [offerId]);

  return (
    <div className="rounded-xl border border-navy-600/40 bg-navy-800/40 p-3" data-testid={`timeline-${offerId}`}>
      <p className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
        <Activity className="w-3.5 h-3.5 text-brand" /> {t("timeline.title")}
      </p>
      {events.length === 0 ? (
        <p className="text-[11px] text-slate-500">{t("timeline.empty")}</p>
      ) : (
        <ol className="relative border-s border-navy-600/50 ms-2 space-y-3">
          {events.map((e) => (
            <li key={e._id} className="ms-3">
              <span className="absolute -start-1.5 mt-1 w-3 h-3 rounded-full bg-brand/20 border border-brand/50" />
              <p className="text-xs font-semibold text-slate-200">{t(`timeline.ev_${e.event_type}`) !== `timeline.ev_${e.event_type}` ? t(`timeline.ev_${e.event_type}`) : e.event_type}</p>
              <p className="text-[10px] text-slate-500">
                {e.actor_name} · <span className="num">{new Date(e.created_at).toLocaleString(locale)}</span>
                {e.notes ? ` — ${e.notes}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
