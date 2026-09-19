import { useEffect, useState } from "react";
import { ClipboardCheck, CheckCircle2, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { useI18n } from "@/i18n";

export function OnboardingBanner({ profilePath }) {
  const { t } = useI18n();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/onboarding/status").then(({ data }) => setData(data)).catch(() => {});
  }, []);

  if (!data || (data.percent >= 100 && ["verified", "active"].includes(data.verification_status || "verified")))
    return null;

  const pendingVerify = data.percent >= 100 && !["verified", "active"].includes(data.verification_status || "");

  return (
    <div className="card-surface p-5 border-amber-500/30 bg-amber-500/5 space-y-3" data-testid="onboarding-banner">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="font-bold text-sm flex items-center gap-2">
          {pendingVerify
            ? <><AlertTriangle className="w-4 h-4 text-amber-400" /> {t("onb.verifyPending")}</>
            : <><ClipboardCheck className="w-4 h-4 text-amber-400" /> {t("onb.title")}</>}
        </p>
        <span className="text-xs text-slate-400">{t("onb.completion")}: <b className="num text-amber-300">{data.percent}%</b></span>
      </div>
      <div className="h-2 rounded-full bg-navy-800 overflow-hidden">
        <div className="h-full bg-amber-400 transition-all" style={{ width: `${data.percent}%` }}
          data-testid="onboarding-progress" />
      </div>
      {data.missing?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.missing.map((m) => (
            <span key={m} className="chip bg-amber-500/10 border-amber-500/30 text-amber-300 text-[10px]">{m}</span>
          ))}
        </div>
      )}
      {data.docs?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.docs.map((d) => {
            const k = `office.status_${d.status}`;
            const label = t(k);
            return (
            <span key={d.type} data-testid={`onb-doc-${d.type}`}
              className={`chip text-[10px] ${d.status === "verified" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : d.status === "pending" ? "bg-amber-500/10 border-amber-500/30 text-amber-300" : "bg-rose-500/10 border-rose-500/30 text-rose-300"}`}>
              {d.name}: {label === k ? d.status : label}
            </span>
            );
          })}
        </div>
      )}
      {profilePath && (
        <a href={profilePath} data-testid="onboarding-cta"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300 hover:text-amber-200">
          {pendingVerify ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ClipboardCheck className="w-3.5 h-3.5" />}
          {pendingVerify ? t("onb.verifyPending") : t("onb.title")} ←
        </a>
      )}
    </div>
  );
}
