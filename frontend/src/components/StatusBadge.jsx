import { REQUEST_STATUS, OFFER_STATUS, WITHDRAWAL_STATUS, TICKET_STATUS } from "@/lib/constants";
import { useI18n } from "@/i18n";

const MAPS = {
  request: { map: REQUEST_STATUS, ns: "status" },
  offer: { map: OFFER_STATUS, ns: "offerStatus" },
  withdrawal: { map: WITHDRAWAL_STATUS, ns: "wdStatus" },
  ticket: { map: TICKET_STATUS, ns: "ticketStatus" },
  doc: { map: {}, ns: "docStatus" },
};

export function StatusBadge({ kind = "request", status, pulse = false }) {
  const { t } = useI18n();
  const conf = MAPS[kind] || MAPS.request;
  const style = conf.map[status]?.cls || "bg-slate-700/40 text-slate-300 border-slate-600/40";
  return (
    <span data-testid={`status-${status}`} className={`chip ${style} ${pulse ? "animate-pulse-soft" : ""}`}>
      {t(`${conf.ns}.${status}`)}
    </span>
  );
}
