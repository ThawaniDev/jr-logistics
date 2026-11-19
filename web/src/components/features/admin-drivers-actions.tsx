"use client";
import { useState } from "react";
import { Ban, CheckCircle2, ShieldCheck } from "lucide-react";
import { Button, Notice, useAction } from "@/components/ui";
import { post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { ConfirmModal, ReasonModal } from "./admin-common";

/** "Lift suspension": ends a strike suspension and restarts the strike count (`POST /admin/drivers/:id/clear-suspension`, needs `users.edit`). Asks first because it also resets the count. */
export function LiftSuspensionButton({ driverId, name, onDone, outline = true }: { driverId: string; name: string; onDone: () => void; outline?: boolean }) {
  const { t } = useI18n(); const me = useUser(); const a = useAction(); const [open, setOpen] = useState(false);
  if (!hasPerm(me, "users.edit")) return null;
  return (
    <>
      <Button size="sm" variant={outline ? "secondary" : "primary"} data-testid={`rdq-driver-lift-${driverId}`} onClick={() => setOpen(true)}><ShieldCheck className="size-4" aria-hidden />{t("admin.clear_suspension")}</Button>
      <ConfirmModal open={open} onClose={() => setOpen(false)} busy={a.is("lift")} title={`${t("admin.clear_suspension")} · ${name}`}
        onConfirm={() => a.run("lift", () => post(`/admin/drivers/${driverId}/clear-suspension`), { success: "common.saved", onDone: () => { setOpen(false); onDone(); } })}>
        <p className="text-sm">{t("rdq.lift_confirm", { name })}</p>
      </ConfirmModal>
    </>
  );
}

/** Confirmation for taking a driver out of an office (`POST /admin/drivers/:id/unlink-office`, needs `offices.manage`; the API refuses while the driver has an active job). */
export function UnlinkOfficeModal({ driver, office, onClose, onDone }: { driver: { id: string; name: string } | null; office: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n(); const a = useAction();
  return (
    <ConfirmModal open={!!driver} onClose={onClose} danger busy={a.is("unlink")} title={`${t("adm.unlink_office")} · ${driver?.name ?? ""}`}
      onConfirm={() => driver && a.run("unlink", () => post(`/admin/drivers/${driver.id}/unlink-office`), { success: "common.saved", onDone: () => { onClose(); onDone(); } })}>
      <p className="text-sm">{t("adm.unlink_confirm", { name: driver?.name ?? "", office })}</p>
    </ConfirmModal>
  );
}

/** Suspend / activate the account itself (`POST /admin/users/:id/status` with a reason, needs `users.edit`). Used on the driver and user views. */
export function AccountStatusButton({ user, onDone, size = "sm" }: { user: { id: string; name: string; status: string }; onDone: () => void; size?: "sm" | "md" }) {
  const { t } = useI18n(); const me = useUser(); const a = useAction(); const [to, setTo] = useState<"active" | "suspended" | null>(null);
  if (!hasPerm(me, "users.edit")) return null;
  const active = user.status === "active";
  const label = active ? t("admin.suspend") : t("admin.activate");
  return (
    <>
      <Button size={size} variant={active ? "danger" : "secondary"} data-testid={`rdq-status-${active ? "suspend" : "activate"}-${user.id}`} onClick={() => setTo(active ? "suspended" : "active")}>
        {active ? <Ban className="size-4" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}{label}
      </Button>
      <ReasonModal open={!!to} onClose={() => setTo(null)} danger={to === "suspended"} busy={a.is("status")} title={`${to === "suspended" ? t("admin.suspend") : t("admin.activate")} · ${user.name}`}
        confirmLabel={to === "suspended" ? t("admin.suspend") : t("admin.activate")} notice={to === "suspended" ? <Notice tone="warn">{t("admin.suspend_confirm")}</Notice> : undefined}
        onSubmit={(reason) => a.run("status", () => post(`/admin/users/${user.id}/status`, { status: to, reason }), { success: "common.saved", onDone: () => { setTo(null); onDone(); } })} />
    </>
  );
}

