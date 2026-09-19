import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, CheckCircle2, XCircle } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { useI18n } from "@/i18n";
import { fmtDate } from "@/lib/constants";

export function ProviderCard() {
  const { t } = useI18n();
  const [provider, setProvider] = useState(null);
  const [invites, setInvites] = useState([]);

  const load = () => {
    api.get("/worker/provider").then(({ data }) => setProvider(data)).catch(() => {});
    api.get("/worker/provider-invites").then(({ data }) => setInvites(data.invites)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const respond = async (id, action) => {
    try {
      await api.post(`/worker/provider-invites/${id}/respond`, { action });
      toast.success(action === "accept" ? t("provider.acceptedToast") : t("provider.declinedToast"));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (!provider) return null;

  return (
    <div className="card-surface p-5 space-y-3" data-testid="provider-card">
      <p className="font-heading font-bold text-sm flex items-center gap-2">
        <Building2 className="w-4 h-4 text-brand" /> {t("provider.title")}
      </p>
      {provider.office ? (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold">{provider.office.name}</p>
            <p className="text-[11px] text-slate-500">
              {t("provider.linkedTo")} · {t(`office.status_${provider.office.verification_status || "pending"}`)}
              {provider.provider_since && <> · {t("provider.since")} <span className="num">{fmtDate(provider.provider_since)}</span></>}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-400" data-testid="provider-direct">{t("provider.direct")}</p>
      )}
      {invites.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-navy-600/40" data-testid="provider-invites">
          <p className="text-xs font-bold text-slate-300">{t("provider.pendingTitle")}</p>
          {invites.map((iv) => (
            <div key={iv._id} className="flex items-center justify-between flex-wrap gap-2 rounded-xl bg-navy-800/60 border border-navy-600/40 px-4 py-2.5"
              data-testid={`provider-invite-${iv._id}`}>
              <div>
                <p className="text-sm font-semibold">{iv.office_name}</p>
                <p className="text-[11px] text-slate-500">{iv.vehicle_type ? t(`veh.${iv.vehicle_type}`) : ""}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => respond(iv._id, "accept")} data-testid={`invite-accept-${iv._id}`}
                  className="chip bg-emerald-500/10 border-emerald-500/30 text-emerald-300 text-[11px]">
                  <CheckCircle2 className="w-3 h-3" /> {t("provider.accept")}
                </button>
                <button onClick={() => respond(iv._id, "decline")} data-testid={`invite-decline-${iv._id}`}
                  className="chip bg-rose-500/10 border-rose-500/30 text-rose-300 text-[11px]">
                  <XCircle className="w-3 h-3" /> {t("provider.decline")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
