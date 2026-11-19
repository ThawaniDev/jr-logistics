"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Ban, CheckCircle2, Handshake } from "lucide-react";
import { Button, Input, Modal, Notice, Textarea, useAction } from "@/components/ui";
import { ApiError, post } from "@/lib/api";
import { riyadhLocalToIso } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { ReasonModal, fullErr, hasAny } from "./admin-common";
import { needsNote, verificationActions, type VerifyAction } from "./admin-offices-lib";

const ACTION = {
  verify: { label: "rdq.act_verify", variant: "primary", danger: false },
  request_info: { label: "verify.request_info", variant: "gold", danger: false },
  reject: { label: "verify.reject", variant: "danger", danger: true },
  suspend: { label: "rdq.act_suspend_verification", variant: "danger", danger: true },
} as const;

/** Verification failures that name the missing documents are shown in the user's language (the API only returns the document keys). */
export function verifyErrorText(e: unknown, t: (k: string, v?: Record<string, string | number>) => string) {
  const missing = e instanceof ApiError && Array.isArray(e.details.missing) ? (e.details.missing as string[]) : [];
  return missing.length ? `${t("rdq.docs_missing_err")}: ${missing.map((k) => { const l = t(`doc.${k}`); return l.startsWith("doc.") ? k : l; }).join(", ")}` : fullErr(e, t);
}

/** Send a new agreement to an office (replaces a pending one). Shared by the office header and the Agreements tab. */
export function SendAgreementModal({ officeId, open, onClose, onSent }: { officeId: string; open: boolean; onClose: () => void; onSent: () => void }) {
  const { t } = useI18n(); const a = useAction();
  const [terms, setTerms] = useState(""); const [exp, setExp] = useState("");
  const close = () => { onClose(); setTerms(""); setExp(""); };
  const send = () => a.run("agreement", () => post(`/admin/offices/${officeId}/agreements`, { terms: terms || undefined, expiresAt: exp ? riyadhLocalToIso(`${exp}T23:59`) : null }), { success: "common.saved", onDone: () => { close(); onSent(); } });
  return (
    <Modal open={open} onClose={close} busy={a.is("agreement")} title={t("admin.send_agreement")}
      footer={<><Button variant="ghost" onClick={close} disabled={a.is("agreement")}>{t("common.cancel")}</Button><Button loading={a.is("agreement")} onClick={send} data-testid="rdq-agreement-send">{t("common.send")}</Button></>}>
      <Notice tone="info">{t("rdq.agreement_send_note")}</Notice>
      <Textarea label={t("admin.agreement_terms")} value={terms} onChange={(e) => setTerms(e.target.value)} data-testid="rdq-agreement-terms" />
      <Input label={t("admin.agreement_expiry")} type="date" ltr value={exp} onChange={(e) => setExp(e.target.value)} hint={t("uxa.agreement_expiry_hint")} data-testid="rdq-agreement-expiry" />
    </Modal>
  );
}

/**
 * Header actions of an office: verification decisions (`POST /admin/users/:id/verification`), account suspend / activate
 * (`POST /admin/users/:id/status`, with a reason) and "send agreement". Each is shown only when the API would accept it for the signed-in staff member.
 */
export function OfficeActions({ office, onChanged }: { office: { id: string; officeName: string; status: string; verificationStatus: string }; onChanged: () => void }) {
  const { t } = useI18n(); const me = useUser(); const a = useAction();
  const [note, setNote] = useState<VerifyAction | null>(null); const [status, setStatus] = useState<"active" | "suspended" | null>(null); const [agr, setAgr] = useState(false);
  const canVerify = hasAny(me, "verification.manage", "offices.manage"), canStatus = hasPerm(me, "users.edit"), canAgreement = hasPerm(me, "offices.manage");
  const decide = (action: VerifyAction, text?: string) => a.run(`v:${action}`, async () => {
    try { await post(`/admin/users/${office.id}/verification`, { action, note: text?.trim() || undefined }); return true; } catch (e) { toast.error(verifyErrorText(e, t)); return false; }
  }, { onDone: (ok) => { if (!ok) return; toast.success(t("common.saved")); setNote(null); onChanged(); } });
  const setAccount = (reason: string) => a.run("status", () => post(`/admin/users/${office.id}/status`, { status, reason }), { success: "common.saved", onDone: () => { setStatus(null); onChanged(); } });
  const name = office.officeName;
  return (
    <>
      {canVerify && verificationActions(office.verificationStatus).map((x) => (
        <Button key={x} size="sm" variant={ACTION[x].variant} loading={a.is(`v:${x}`)} disabled={a.any && !a.is(`v:${x}`)} data-testid={`rdq-office-${x}`} onClick={() => (needsNote(x) ? setNote(x) : decide(x))}>{t(ACTION[x].label)}</Button>
      ))}
      {canAgreement && <Button size="sm" variant="secondary" data-testid="rdq-office-send-agreement" onClick={() => setAgr(true)}><Handshake className="size-4" aria-hidden />{t("admin.send_agreement")}</Button>}
      {canStatus && (office.status === "active"
        ? <Button size="sm" variant="danger" data-testid="rdq-office-suspend-account" onClick={() => setStatus("suspended")}><Ban className="size-4" aria-hidden />{t("rdq.act_suspend_account")}</Button>
        : <Button size="sm" variant="secondary" data-testid="rdq-office-activate-account" onClick={() => setStatus("active")}><CheckCircle2 className="size-4" aria-hidden />{t("rdq.act_activate_account")}</Button>)}

      <ReasonModal open={!!note} onClose={() => setNote(null)} busy={note ? a.is(`v:${note}`) : false} minLen={1} danger={note ? ACTION[note].danger : false}
        title={note ? `${t(ACTION[note].label)} · ${name}` : ""} label={t("verify.note")} hint={t("verify.note_hint")} confirmLabel={note ? t(ACTION[note].label) : undefined}
        onSubmit={(text) => note && decide(note, text)} />
      <ReasonModal open={!!status} onClose={() => setStatus(null)} busy={a.is("status")} danger={status === "suspended"}
        title={status ? `${status === "suspended" ? t("rdq.act_suspend_account") : t("rdq.act_activate_account")} · ${name}` : ""}
        confirmLabel={status === "suspended" ? t("admin.suspend") : t("admin.activate")} notice={status === "suspended" ? <Notice tone="warn">{t("admin.suspend_confirm")}</Notice> : undefined} onSubmit={setAccount} />
      <SendAgreementModal officeId={office.id} open={agr} onClose={() => setAgr(false)} onSent={onChanged} />
    </>
  );
}
