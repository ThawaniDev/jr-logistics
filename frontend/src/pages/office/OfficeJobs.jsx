import { useEffect, useState } from "react";
import { Briefcase, MessageCircle, MapPin, Calendar, Truck } from "lucide-react";
import api from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { JobChat } from "@/components/JobChat";
import { JobTimeline } from "@/components/JobTimeline";
import { useI18n } from "@/i18n";

export default function OfficeJobs({ activeOnly = false }) {
  const { t } = useI18n();
  const [jobs, setJobs] = useState(null);
  const [openOps, setOpenOps] = useState(null);

  useEffect(() => {
    api.get("/office/jobs", { params: activeOnly ? { active: true } : {} })
      .then(({ data }) => setJobs(data.jobs)).catch(() => {});
  }, [activeOnly]);

  const title = activeOnly ? t("office.activeJobs") : t("office.jobs");
  return (
    <div className="space-y-6" data-testid={activeOnly ? "office-active-jobs-page" : "office-jobs-page"}>
      <div>
        <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
          <Briefcase className="w-6 h-6 text-brand" /> {title}
        </h1>
        <p className="text-sm text-slate-400 mt-1">{t("office.jobsSub")}</p>
      </div>
      {!jobs ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : jobs.length === 0 ? (
        <EmptyState icon={Briefcase} title={t("office.noJobs")} desc={t("office.noJobsDesc")} testid="jobs-empty" />
      ) : (
        <div className="grid gap-3" data-testid="office-jobs-list">
          {jobs.map((j) => (
            <div key={j._id} className="card-surface p-5 space-y-4" data-testid={`office-job-${j._id}`}>
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <p className="font-bold text-sm">{j.request?.title || j.request_id}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {j.driver_name} · {j.request?.business?.business_profile?.company_name || j.request?.business?.name}
                  </p>
                </div>
                <StatusBadge kind="offer" status={j.status} />
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                <div className="bg-navy-800/70 rounded-lg p-3 border border-navy-600/40">
                  <p className="text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3" /> {t("opp.location")}</p>
                  <p className="font-semibold mt-1">{j.request?.pickup_city || j.request?.city} → {j.request?.delivery_city || j.request?.city}</p>
                  <p className="text-[10px] text-slate-500 mt-1">{j.request?.address}</p>
                </div>
                <div className="bg-navy-800/70 rounded-lg p-3 border border-navy-600/40">
                  <p className="text-slate-500 flex items-center gap-1"><Calendar className="w-3 h-3" /> {t("opp.date")}</p>
                  <p className="font-semibold mt-1 num">{j.request?.start_date} · {j.request?.start_time}</p>
                </div>
                <div className="bg-navy-800/70 rounded-lg p-3 border border-navy-600/40">
                  <p className="text-slate-500 flex items-center gap-1"><Truck className="w-3 h-3" /> {t("opp.vehicleReq")}</p>
                  <p className="font-semibold mt-1">{j.request?.vehicle_type ? t(`veh.${j.request.vehicle_type}`) : "—"}{j.request?.temperature_type ? ` · ${t(`veh.${j.request.temperature_type}`)}` : ""}</p>
                </div>
                <div className="bg-navy-800/70 rounded-lg p-3 border border-navy-600/40">
                  <p className="text-slate-500">{t("office.shipments")}</p>
                  <p className="font-semibold mt-1 num">{j.final_qty ?? j.driver_reported_qty ?? j.loaded_qty ?? j.request?.shipments_per_driver ?? "—"}</p>
                </div>
              </div>
              {j.request?.requirements && <p className="text-xs text-slate-400 bg-navy-800/50 rounded-xl p-3 border border-navy-600/40">{j.request.requirements}</p>}
              <div className="flex gap-2">
                <button onClick={() => setOpenOps(openOps === j._id ? null : j._id)} data-testid={`office-chat-toggle-${j._id}`}
                  className="flex items-center gap-1.5 text-xs font-semibold border border-navy-600 rounded-xl px-3 py-2 text-slate-300 hover:border-brand/40 hover:text-brand transition-colors">
                  <MessageCircle className="w-3.5 h-3.5" /> {t("opsroom.chat")}
                </button>
              </div>
              {openOps === j._id && (
                <div className="space-y-3" data-testid={`office-ops-room-${j._id}`}>
                  <JobChat offerId={j._id} />
                  <JobTimeline offerId={j._id} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
