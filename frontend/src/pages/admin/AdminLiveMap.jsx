import { useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { toast } from "sonner";
import { MapPin, RefreshCcw } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { useI18n } from "@/i18n";
import { DEFAULT_VEHICLE_TYPES, TEMP_TYPES, CITIES } from "@/lib/constants";

const STATUS_COLORS = {
  available: "#34d399", unavailable: "#64748b", on_job: "#60a5fa",
  assigned: "#fbbf24", issue: "#f43f5e",
};
const STATUS_KEYS = ["available", "unavailable", "on_job", "assigned", "issue"];

export default function AdminLiveMap() {
  const { t } = useI18n();
  const [drivers, setDrivers] = useState(null);
  const [filters, setFilters] = useState({ status: "", vehicle_type: "", temperature_type: "", city: "" });
  const [summary, setSummary] = useState(null);

  const load = () => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    api.get("/admin/operations/map", { params })
      .then(({ data }) => setDrivers(data.drivers))
      .catch((e) => toast.error(errMsg(e)));
  };
  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, [filters]);

  useEffect(() => {
    if (!filters.city) return setSummary(null);
    api.get("/admin/operations/city-summary", { params: { city: filters.city } })
      .then(({ data }) => setSummary(data)).catch(() => {});
  }, [filters.city]);

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const sel = "bg-navy-800 border border-navy-600 rounded-lg px-2.5 h-9 text-xs focus:outline-none focus:ring-1 focus:ring-brand";

  return (
    <div className="space-y-5" data-testid="admin-livemap-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="heading text-2xl font-extrabold">{t("mapv.title")}</h1>
          <p className="text-sm text-slate-400 mt-1">{t("mapv.sub")}</p>
        </div>
        <button onClick={load} data-testid="livemap-refresh"
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-brand transition-colors">
          <RefreshCcw className="w-4 h-4" /> {t("live.refresh")}
        </button>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="map-filters">
        <select value={filters.status} onChange={set("status")} className={sel} data-testid="filter-status">
          <option value="">{t("mapv.all")}</option>
          {STATUS_KEYS.map((k) => <option key={k} value={k}>{t(`mapv.${k === "on_job" ? "onJob" : k}`)}</option>)}
        </select>
        <select value={filters.vehicle_type} onChange={set("vehicle_type")} className={sel} data-testid="filter-vehicle">
          <option value="">{t("mapv.vehicle")}: {t("mapv.all")}</option>
          {DEFAULT_VEHICLE_TYPES.map((v) => <option key={v} value={v}>{t(`veh.${v}`)}</option>)}
        </select>
        <select value={filters.temperature_type} onChange={set("temperature_type")} className={sel} data-testid="filter-temp">
          <option value="">{t("mapv.temp")}: {t("mapv.all")}</option>
          {TEMP_TYPES.map((tp) => <option key={tp} value={tp}>{t(`veh.${tp}`)}</option>)}
        </select>
        <select value={filters.city} onChange={set("city")} className={sel} data-testid="filter-city">
          <option value="">{t("mapv.city")}: {t("mapv.all")}</option>
          {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {summary && (
        <div className="card-surface p-4 flex flex-wrap gap-4 text-xs" data-testid="city-summary">
          <span className="font-bold text-sm">{summary.city}</span>
          <span className="text-slate-400">{t("mapv.total")}: <b className="num text-slate-200">{summary.total}</b></span>
          <span className="text-emerald-400">{t("mapv.available")}: <b className="num">{summary.available}</b></span>
          <span className="text-slate-400">{t("mapv.unavailable")}: <b className="num">{summary.unavailable}</b></span>
          <span className="text-blue-400">{t("mapv.onJob")}: <b className="num">{summary.on_job}</b></span>
          <span className="text-amber-400">{t("mapv.assigned")}: <b className="num">{summary.assigned}</b></span>
          <span className="text-rose-400">{t("mapv.issue")}: <b className="num">{summary.issue}</b></span>
        </div>
      )}

      <div className="card-surface overflow-hidden" data-testid="ksa-map">
        <MapContainer center={[23.9, 45.0]} zoom={5} style={{ height: 480, width: "100%" }} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {(drivers || []).map((d) => (
            <CircleMarker key={d.worker_id} center={[d.lat, d.lng]} radius={9}
              pathOptions={{ color: STATUS_COLORS[d.op_status] || "#94a3b8", fillColor: STATUS_COLORS[d.op_status] || "#94a3b8", fillOpacity: 0.85, weight: 2 }}
              data-testid={`marker-${d.worker_id}`}>
              <Popup>
                <div dir="rtl" style={{ minWidth: 190 }} data-testid={`driver-card-${d.worker_id}`}>
                  <p style={{ fontWeight: 800 }}>{d.name}</p>
                  <p style={{ fontSize: 11, color: "#64748b" }}>ID: {d.worker_id.slice(0, 8)}…</p>
                  <p style={{ fontSize: 12 }}>{t("mapv.vehicle")}: {d.vehicle_type ? t(`veh.${d.vehicle_type}`) : "—"} {d.temperature_type ? `· ${t(`veh.${d.temperature_type}`)}` : ""}</p>
                  <p style={{ fontSize: 12 }}>{t("mapv.availability")}: {t(`mapv.${d.op_status === "on_job" ? "onJob" : d.op_status}`)}</p>
                  <p style={{ fontSize: 12 }}>{t("mapv.city")}: {d.city}</p>
                  <p style={{ fontSize: 12 }}>{t("mapv.docs")}: {d.verification_status || "—"}</p>
                  {d.active_job && <p style={{ fontSize: 12 }}>{t("mapv.jobStatus")}: {t(`offerStatus.${d.active_job.status}`)}</p>}
                  {d.live && <p style={{ fontSize: 11, color: "#34d399" }}>● {t("mapv.liveBadge")}</p>}
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      {!drivers ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : drivers.length === 0 ? (
        <EmptyState icon={MapPin} title={t("mapv.noDrivers")} desc={t("mapv.sub")} testid="livemap-empty" />
      ) : (
        <div className="flex flex-wrap gap-3 text-xs" data-testid="map-legend">
          {STATUS_KEYS.map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-slate-400">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLORS[k] }} />
              {t(`mapv.${k === "on_job" ? "onJob" : k}`)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
