"use client";
import { useState } from "react";
import { toast } from "sonner";
import { MailPlus } from "lucide-react";
import { Button, EmptyState, Input, Modal, Notice, Table, Td } from "@/components/ui";
import { friendlyErr, useDriverAction } from "./driver-action";
import { ApiError, post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { inviteErrText } from "./office-shared";

export interface Invite { id: string; phone: string; createdAt: string }

/** "Invite driver": the driver must accept in the app; the office can withdraw the invitation until then. */
export function InviteDriverModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [phone, setPhone] = useState(""); const [err, setErr] = useState(""); const [sending, setSending] = useState(false);
  const close = () => { setErr(""); onClose(); };
  async function send() {
    if (sending || phone.length < 8) return;
    setSending(true); setErr("");
    try { await post("/office/drivers/invite", { phone }); toast.success(t("office.invited")); setPhone(""); close(); onDone(); }
    catch (e) { setErr(e instanceof ApiError ? inviteErrText(e, t) : friendlyErr(e, t)); }
    finally { setSending(false); }
  }
  return (
    <Modal open={open} onClose={close} busy={sending} title={t("office.invite_driver")} footer={<><Button variant="ghost" onClick={close} disabled={sending}>{t("common.cancel")}</Button><Button loading={sending} disabled={phone.length < 8} onClick={send} data-testid="office-invite-send">{t("office.send_invite")}</Button></>}>
      {err && <Notice tone="danger">{err}</Notice>}
      <Input label={t("auth.phone")} type="tel" inputMode="tel" autoComplete="off" enterKeyHint="send" ltr placeholder="05XXXXXXXX" value={phone} onChange={(e) => { setPhone(e.target.value); setErr(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void send(); } }} hint={t("office.invite_hint")} autoFocus />
    </Modal>
  );
}

/** Confirmation before a driver leaves the office. The server refuses while the driver is on a job, so callers disable the trigger then. */
export function UnlinkDriverModal({ driver, onClose, onDone }: { driver: { id: string; name: string } | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n(); const a = useDriverAction();
  return (
    <Modal open={!!driver} onClose={onClose} busy={a.any} title={t("office.unlink")} footer={<><Button variant="ghost" onClick={onClose} disabled={a.any}>{t("common.cancel")}</Button><Button variant="danger" loading={a.any} data-testid="office-unlink-confirm" onClick={() => driver && a.run(driver.id, () => post(`/office/drivers/${driver.id}/unlink`), { success: "common.saved", onDone: () => { onClose(); onDone(); } })}>{t("office.unlink")}</Button></>}>
      <Notice tone="warn">{t("office.unlink_confirm")}</Notice>
      {driver && <p className="font-semibold">{driver.name}</p>}
    </Modal>
  );
}

/** Invitations that were sent and not answered yet, each with "Withdraw". `toolbar` is the shared filter row of the drivers list. */
export function InvitesTable({ invites, total, toolbar, onChange, onInvite }: { invites: Invite[]; total: number; toolbar: React.ReactNode; onChange: () => void; onInvite: () => void }) {
  const { t, locale } = useI18n(); const a = useDriverAction();
  const empty = invites.length === 0 ? (total === 0
    ? <EmptyState icon={<MailPlus className="size-9" aria-hidden />} title={t("rdo.no_invites")} hint={t("rdo.no_invites_hint")} action={<Button onClick={onInvite}>{t("office.invite_driver")}</Button>} />
    : <EmptyState title={t("common.no_results")} />) : null;
  return (
    <Table stack label={t("office.pending_invites")} toolbar={toolbar} empty={empty} head={[t("auth.phone"), t("rdo.col_sent"), { label: t("rdo.col_actions"), srOnly: true }]}>
      {invites.map((i) => (
        <tr key={i.id} data-testid="office-invite-row">
          <Td label={t("auth.phone")} num align="start" className="font-medium">{i.phone}</Td>
          <Td label={t("rdo.col_sent")} className="text-muted">{fmtDateTime(i.createdAt, locale)}</Td>
          <Td align="end"><Button size="sm" variant="ghost" loading={a.is(i.id)} onClick={() => a.run(i.id, () => post(`/office/invites/${i.id}/revoke`), { success: "common.saved", onDone: onChange })}>{t("office.revoke_invite")}</Button></Td>
        </tr>
      ))}
    </Table>
  );
}
