import { REQUEST_STATUS, OFFER_STATUS, WITHDRAWAL_STATUS, TICKET_STATUS } from "@/lib/constants";

const MAPS = {
  request: REQUEST_STATUS,
  offer: OFFER_STATUS,
  withdrawal: WITHDRAWAL_STATUS,
  ticket: TICKET_STATUS,
};

export function StatusBadge({ kind = "request", status, pulse = false }) {
  const conf = MAPS[kind]?.[status] || { label: status, cls: "bg-slate-700/40 text-slate-300 border-slate-600/40" };
  return (
    <span data-testid={`status-${status}`} className={`chip ${conf.cls} ${pulse ? "animate-pulse-soft" : ""}`}>
      {conf.label}
    </span>
  );
}
