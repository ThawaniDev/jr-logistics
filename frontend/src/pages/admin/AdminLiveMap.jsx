import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MapPin, RefreshCcw, Briefcase } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { useI18n } from "@/i18n";

export default function AdminLiveMap() {
  const { t, lang } = useI18n();
  const [locations, setLocations] = useState(null);
  const locale = lang === "ar" ? "ar-SA" : lang === "ur" ? "ur-PK" : "en-US";

  const load = () =>
    api.get("/admin/locations").then(({ data }) => {
      const seen = new Set();
      setLocations(data.locations.filter((l) => !seen.has(l.worker_id) && seen.add(l.worker_id)));
    }).catch((e) => toast.error(errMsg(e)));
  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="space-y-6" data-testid="admin-livemap-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="heading text-2xl font-extrabold">{t("live.title")}</h1>
          <p className="text-sm text-slate-400 mt-1">{t("live.sub")}</p>
        </div>
        <button onClick={load} data-testid="livemap-refresh"
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-brand transition-colors">
          <RefreshCcw className="w-4 h-4" /> {t("live.refresh")}
        </button>
      </div>

      {!locations ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : locations.length === 0 ? (
        <EmptyState icon={MapPin} title={t("live.empty")} desc={t("live.emptyDesc")} testid="livemap-empty" />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {locations.map((loc) => (
            <div key={loc.worker_id} className="card-surface p-5 space-y-3" data-testid={`loc-${loc.worker_id}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/25 flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5 text-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{loc.name}</p>
                  <p className="text-[11px] text-slate-500 num">{loc.phone}</p>
                </div>
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${loc.availability === "available" ? "bg-emerald-400 animate-pulse-soft" : "bg-slate-600"}`} />
              </div>
              {loc.active_job && (
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-brand" /> {loc.active_job.title} — {loc.active_job.city}
                </p>
              )}
              <div className="bg-navy-800/70 rounded-lg p-2.5 border border-navy-600/40 text-xs">
                <p className="num text-slate-300" dir="ltr">{loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}</p>
                <p className="text-[10px] text-slate-500 mt-1">{t("live.lastUpdate")}: <span className="num">{new Date(loc.at).toLocaleString(locale)}</span></p>
              </div>
              <a data-testid={`loc-map-${loc.worker_id}`}
                href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`} target="_blank" rel="noreferrer"
                className="block text-center text-xs font-semibold text-brand border border-brand/30 rounded-xl py-2 hover:bg-brand/10 transition-colors">
                {t("live.openMap")}
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
