import { REQUEST_STATUS, OFFER_STATUS, WITHDRAWAL_STATUS, TICKET_STATUS } from "@/lib/constants";
import { useI18n } from "@/i18n";

const MAPS = {
  request: { map: REQUEST_STATUS, ns: "status", prefix: "" },
  offer: { map: OFFER_STATUS, ns: "offerStatus", prefix: "" },
  withdrawal: { map: WITHDRAWAL_STATUS, ns: "wdStatus", prefix: "" },
  ticket: { map: TICKET_STATUS, ns: "ticketStatus", prefix: "" },
  doc: { map: {}, ns: "docStatus", prefix: "" },
  office: { map: {}, ns: "office", prefix: "status_" },
  settlement: { map: {}, ns: "fin", prefix: "st_" },
};

export function StatusBadge({ kind = "request", status, pulse = false }) {
  const { t } = useI18n();
  const conf = MAPS[kind] || MAPS.request;
  const style = conf.map[status]?.cls || "bg-slate-700/40 text-slate-300 border-slate-600/40";
  const key = `${conf.ns}.${conf.prefix || ""}${status}`;
  const label = t(key);
  return (
    <span data-testid={`status-${status}`} className={`chip ${style} ${pulse ? "animate-pulse-soft" : ""}`}>
      {label === key ? status : label}
    </span>
  );
}
