/** Where a notification should take the user. Returns null when there is no useful destination (the card stays informational). */
export function notifHref(role: string, type: string, data: Record<string, unknown> | null): string | null {
  const d = data ?? {};
  const base = role === "admin" || role === "staff" ? "/admin" : `/${role}`;
  const staff = role === "admin" || role === "staff";
  if (/^(payout|withdrawal)_/.test(type) || type === "wallet_adjusted") return staff ? (type === "wallet_adjusted" ? "/admin/finance/ledger" : "/admin/finance/withdrawals") : `${base}/wallet`;
  if (/^(document|verification)_/.test(type)) return role === "business" || role === "driver" || role === "office" ? `${base}/documents` : "/admin/verification";
  if (/^(ticket|complaint)_/.test(type)) {
    if (!staff) return `${base}/support`;
    const list = type.startsWith("ticket") ? "/admin/cases" : "/admin/complaints";
    return typeof d.ref === "string" ? `${list}?q=${encodeURIComponent(d.ref)}` : list; // both lists accept ?q= (the reference), so the case is right there
  }
  if (type === "agreement_pending") return "/office/agreement";
  if (type === "office_invite") return "/driver/profile";
  if (type === "invite_accepted" || type === "invite_declined" || type === "office_unlinked") return role === "office" ? "/office/drivers" : "/driver";
  if (role === "business" && /^partner_(cancel_conflict|sync_failed)$/.test(type)) return "/business/integrations"; // fix the connection, not the request
  if (role === "business" && typeof d.requestId === "string") return `/business/requests/${d.requestId}`;
  if (role === "business" && /^(request|driver|delivery|loading|shipment|shipments|route|returns?|partner)_/.test(type)) return "/business/requests";
  if (role === "driver" && typeof d.offerId === "string") return `/driver/jobs/${d.offerId}`;
  if (role === "driver" && /^offer_/.test(type)) return "/driver/opportunities";
  if (role === "driver" && /^(cancel_|replaced_)/.test(type)) return "/driver/jobs";
  if (role === "office" && /^(office_driver|office_opportunity)/.test(type)) return type === "office_opportunity" ? "/office/opportunities" : "/office/jobs";
  if ((role === "admin" || role === "staff") && typeof d.requestId === "string") return `/admin/requests/${d.requestId}`;
  return null;
}
