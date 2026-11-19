"use client";
import { useState } from "react";
import { Ban, CheckCircle2, PauseCircle, ShieldCheck, XCircle, MessageSquareWarning } from "lucide-react";
import { Button, Notice, useAction } from "@/components/ui";
import { post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { ReasonModal, fullErr } from "./admin-common";
import { companyActions } from "./admin-companies-lib";
import { useRefreshCompanies, type Company } from "./admin-companies-ctx";

type Ask = { kind: "verification"; action: "request_info" | "reject" | "suspend" } | { kind: "status"; to: "active" | "suspended" };
const TITLE: Record<string, string> = {
  request_info: "verify.request_info", reject: "verify.reject", suspend: "rdp.act_suspend_verification", suspended: "rdp.act_suspend_account", active: "rdp.act_activate_account",
};

/**
 * The primary actions of a company, shown in its header. Verification actions use `POST /admin/users/:id/verification` (needs verification.manage or
 * offices.manage), account actions `POST /admin/users/:id/status` (needs users.edit). Anything that locks someone out or needs a note asks for a reason first.
 */
export function CompanyActions({ company }: { company: Company }) {
  const { t } = useI18n(); const me = useUser(); const a = useAction(); const refresh = useRefreshCompanies();
  const [ask, setAsk] = useState<Ask | null>(null); const [err, setErr] = useState<string | null>(null);
  const can = (p: string) => hasPerm(me, p);
  const act = companyActions({ status: company.status, verificationStatus: company.profile.verificationStatus }, can);
  const done = () => { setAsk(null); setErr(null); refresh(); };
  const verify = () => a.run("verify", () => post(`/admin/users/${company.id}/verification`, { action: "verify" }), { success: "common.saved", onDone: done });
  const submit = (note: string) => {
    if (!ask) return;
    const call = ask.kind === "verification" ? () => post(`/admin/users/${company.id}/verification`, { action: ask.action, note }) : () => post(`/admin/users/${company.id}/status`, { status: ask.to, reason: note });
    return a.run("ask", call, { success: "common.saved", onDone: done, onError: (e) => setErr(fullErr(e, t)) });
  };
  const key = ask ? (ask.kind === "verification" ? ask.action : ask.to) : "";
  const danger = ask ? (ask.kind === "verification" ? ask.action !== "request_info" : ask.to === "suspended") : false;
  const notice = ask?.kind === "status" && ask.to === "suspended" ? <Notice tone="warn">{t("admin.suspend_confirm")}</Notice>
    : ask?.kind === "verification" && ask.action === "suspend" ? <Notice tone="warn">{t("rdp.suspend_verification_note")}</Notice> : undefined;
  return (
    <>
      {act.verify && <Button size="sm" data-testid="companies-act-verify" loading={a.is("verify")} onClick={verify}><ShieldCheck className="size-4" aria-hidden />{t("rdp.act_verify")}</Button>}
      {act.requestInfo && <Button size="sm" variant="gold" data-testid="companies-act-info" onClick={() => { setErr(null); setAsk({ kind: "verification", action: "request_info" }); }}><MessageSquareWarning className="size-4" aria-hidden />{t("verify.request_info")}</Button>}
      {act.reject && <Button size="sm" variant="danger" data-testid="companies-act-reject" onClick={() => { setErr(null); setAsk({ kind: "verification", action: "reject" }); }}><XCircle className="size-4" aria-hidden />{t("verify.reject")}</Button>}
      {act.suspendVerification && <Button size="sm" variant="danger" data-testid="companies-act-suspend-verification" onClick={() => { setErr(null); setAsk({ kind: "verification", action: "suspend" }); }}><PauseCircle className="size-4" aria-hidden />{t("rdp.act_suspend_verification")}</Button>}
      {act.suspendAccount && <Button size="sm" variant="danger" data-testid="companies-act-suspend" onClick={() => { setErr(null); setAsk({ kind: "status", to: "suspended" }); }}><Ban className="size-4" aria-hidden />{t("rdp.act_suspend_account")}</Button>}
      {act.activateAccount && <Button size="sm" variant="secondary" data-testid="companies-act-activate" onClick={() => { setErr(null); setAsk({ kind: "status", to: "active" }); }}><CheckCircle2 className="size-4" aria-hidden />{t("rdp.act_activate_account")}</Button>}
      <ReasonModal open={!!ask} onClose={() => setAsk(null)} danger={danger} busy={a.is("ask")} onSubmit={submit}
        title={ask ? `${t(TITLE[key])} · ${company.name}` : ""} confirmLabel={ask ? t(TITLE[key]) : undefined}
        label={ask?.kind === "status" ? t("req.reason") : t("verify.note")} hint={ask?.kind === "verification" ? t("verify.note_hint") : undefined} notice={notice}>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      </ReasonModal>
    </>
  );
}
