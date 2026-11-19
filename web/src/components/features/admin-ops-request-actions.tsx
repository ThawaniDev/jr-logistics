"use client";
import { useState } from "react";
import { Badge, Button, ErrorState, Modal, Notice, Skeleton, Textarea, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";

/** Assign a driver by hand: pick one of the eligible candidates (ranked by score; ineligible ones show why) and give a reason that is kept in the audit trail. */
export function AssignModal({ requestId, open, onClose, onDone }: { requestId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n(); const a = useAction();
  const [driverId, setDriverId] = useState(""); const [reason, setReason] = useState("");
  const sug = useApi<{ items: any[] }>(open ? `/admin/requests/${requestId}/suggest` : null);
  const close = () => { setDriverId(""); setReason(""); onClose(); };
  const ok = !!driverId && reason.trim().length >= 3;
  return (
    <Modal open={open} onClose={close} busy={a.is("as")} title={t("admin.assign_driver")}
      footer={<><Button variant="ghost" onClick={close}>{t("common.cancel")}</Button><Button data-testid="admin-assign-confirm" loading={a.is("as")} disabled={!ok} onClick={() => a.run("as", () => post(`/admin/requests/${requestId}/assign`, { driverId, reason: reason.trim() }), { success: "common.saved", onDone: () => { close(); onDone(); } })}>{t("office.assign")}</Button></>}>
      <div className="max-h-64 space-y-1.5 overflow-y-auto" role="listbox" aria-label={t("admin.assign_driver")} data-testid="admin-assign-list">
        {sug.error ? <ErrorState error={sug.error} retry={() => sug.mutate()} />
          : !sug.data ? <div className="space-y-1.5"><Skeleton className="h-11" /><Skeleton className="h-11" /><Skeleton className="h-11" /></div>
          : sug.data.items.length === 0 ? <p className="text-sm text-muted">{t("uxa.no_candidates")}</p>
          : sug.data.items.map((c) => {
            const blocked = c.reasons.length > 0; const on = driverId === c.driverId;
            return (
              <button key={c.driverId} type="button" role="option" aria-selected={on} disabled={blocked} data-testid={`admin-assign-candidate-${c.driverId}`} onClick={() => setDriverId(c.driverId)}
                className={cn("flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-start text-sm transition disabled:opacity-60", on ? "border-accent bg-accent/10" : "border-line hover:border-accent/50 disabled:hover:border-line")}>
                <span className="min-w-0 truncate font-medium">{c.name}</span>
                {blocked ? <span className="text-xs text-danger">{c.reasons.map((x: string) => t(`reason.${x}`)).join(" · ")}</span> : <Badge tone="success">{t("admin.score", { n: c.score })}</Badge>}
              </button>
            );
          })}
      </div>
      <Textarea label={t("admin.assign_reason")} data-testid="admin-assign-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

/** Cancel the request on the business's behalf (reserved funds are refunded, accepted drivers are told). */
export function CancelModal({ requestId, open, onClose, onDone }: { requestId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n(); const a = useAction(); const [reason, setReason] = useState("");
  const close = () => { setReason(""); onClose(); };
  return (
    <Modal open={open} onClose={close} busy={a.is("cn")} title={t("req.cancel")}
      footer={<><Button variant="ghost" onClick={close}>{t("common.back")}</Button><Button variant="danger" data-testid="admin-cancel-confirm" loading={a.is("cn")} disabled={reason.trim().length < 3} onClick={() => a.run("cn", () => post(`/requests/${requestId}/cancel`, { reason: reason.trim() }), { success: "common.saved", onDone: () => { close(); onDone(); } })}>{t("req.cancel_confirm")}</Button></>}>
      <Notice tone="info">{t("rda.cancel_note_staff")}</Notice>
      <Textarea label={t("req.reason")} data-testid="admin-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}
