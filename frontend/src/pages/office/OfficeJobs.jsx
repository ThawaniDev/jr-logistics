import { useEffect, useState } from "react";
import { Briefcase } from "lucide-react";
import api from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { useI18n } from "@/i18n";

export default function OfficeJobs() {
  const { t } = useI18n();
  const [jobs, setJobs] = useState(null);

  useEffect(() => {
    api.get("/office/jobs").then(({ data }) => setJobs(data.jobs)).catch(() => {});
  }, []);

  return (
    <div className="space-y-6" data-testid="office-jobs-page">
      <h1 className="heading text-2xl font-extrabold flex items-center gap-2">
        <Briefcase className="w-6 h-6 text-brand" /> {t("office.jobs")}
      </h1>
      {!jobs ? (
        <p className="text-slate-500 text-sm">{t("common.loading")}</p>
      ) : jobs.length === 0 ? (
        <EmptyState icon={Briefcase} title={t("office.noJobs")} desc={t("office.noDriversDesc")} testid="jobs-empty" />
      ) : (
        <div className="grid gap-3" data-testid="office-jobs-list">
          {jobs.map((j) => (
            <div key={j._id} className="card-surface p-4 flex items-center justify-between flex-wrap gap-2" data-testid={`office-job-${j._id}`}>
              <div>
                <p className="font-bold text-sm">{j.request?.title || j.request_id}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {j.driver_name} · {j.request?.pickup_city || j.request?.city} · <span className="num">{j.request?.start_date}</span>
                </p>
              </div>
              <StatusBadge status={j.status} ns="offerStatus" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
