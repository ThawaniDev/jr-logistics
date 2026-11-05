"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card, Checkbox, ErrorState, Input, Notice, PageHeader, PageLoading, Select, Textarea, useAction, errText } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { patch, post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { useUser, hasPerm } from "@/components/layout/auth-context";
import { useRouter } from "next/navigation";

function Inner() {
  const { t } = useI18n(); const a = useAction(); const me = useUser(); const sp = useSearchParams(); const router = useRouter();
  const { data, error, mutate } = useApi("/admin/settings", { shouldRetryOnError: false });
  const [edits, setEdits] = useState<Record<string, unknown>>({}); const [pw, setPw] = useState({ currentPassword: "", newPassword: "" }); const [pwErr, setPwErr] = useState<string | null>(null);
  const f = data ? { ...data, ...edits } : null; // server copy overlaid with unsaved edits
  const canEdit = hasPerm(me, "settings.edit");
  const set = (k: string, v: unknown) => setEdits((p) => ({ ...p, [k]: v }));
  const num = (k: string, label: string, hint?: string) => <Input label={label} type="number" min={0} value={f?.[k] ?? 0} onChange={(e) => set(k, Number(e.target.value))} disabled={!canEdit} hint={hint} />;
  const save = () => a.run("s", () => patch("/admin/settings", Object.fromEntries(["enabledServices", "vatPct", "settlementPeriod", "cancelPolicyEnabled", "cancelWarnAt", "cancelSuspendAt", "cancelWindowDays", "cancelSuspendDays", "lateGraceMin", "checkinEarlyMin", "officeWindowMin", "overlapPolicy", "requireBusinessVerification", "requireDriverVerification", "separationOfDuties", "minWithdrawalCents", "termsVersion", "termsBusiness", "termsDriver", "termsOffice"].map((k) => [k, f[k]]))), { success: "common.saved", onDone: () => { setEdits({}); mutate(); } });
  const changePw = () => a.run("pw", () => post("/auth/change-password", pw), { success: "settings.pw_changed", onDone: () => { router.replace("/staff/login"); router.refresh(); }, onError: (e) => setPwErr(errText(e, t)) });
  return (
    <>
      <PageHeader title={t("nav.settings")} subtitle={t("settings.sub")} />
      {(sp.get("change_password") || me.mustChangePassword) && <div className="mb-5"><Notice tone="warn" title={t("settings.must_change")}>{t("settings.must_change_body")}</Notice></div>}
      <Card className="mb-6 max-w-xl space-y-3"><h2 className="font-semibold">{t("settings.change_password")}</h2>
        <Input label={t("settings.current_password")} type="password" ltr autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
        <Input label={t("settings.new_password")} type="password" ltr autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} hint={t("staff.password_hint")} />
        {pwErr && <p role="alert" className="text-sm text-danger">{pwErr}</p>}
        <Button loading={a.is("pw")} disabled={pw.newPassword.length < 10 || !pw.currentPassword} onClick={changePw}>{t("settings.change_password")}</Button></Card>
      {error ? <Notice tone="info">{t("err.FORBIDDEN")}</Notice> : !f ? <PageLoading /> : (
        <div className="space-y-6">
          <Notice tone="warn">{t("settings.owner_note")}</Notice>
          <Card className="space-y-4"><h2 className="font-semibold">{t("settings.services")}</h2>
            <div className="flex flex-wrap gap-4">{["delivery_driver", "car_with_driver", "car_without_driver"].map((s) => <Checkbox key={s} disabled={!canEdit} checked={f.enabledServices.includes(s)} onChange={() => set("enabledServices", f.enabledServices.includes(s) ? f.enabledServices.filter((x: string) => x !== s) : [...f.enabledServices, s])} label={t(`svc.${s}`)} />)}</div></Card>
          <Card className="space-y-4"><h2 className="font-semibold">{t("settings.finance")}</h2><div className="grid gap-4 sm:grid-cols-3">
            {num("vatPct", t("settings.vat"), t("settings.vat_hint"))}
            <Select label={t("settings.period")} options={[{ value: "weekly", label: t("settings.weekly") }, { value: "monthly", label: t("settings.monthly") }]} value={f.settlementPeriod} onChange={(e) => set("settlementPeriod", e.target.value)} disabled={!canEdit} />
            <Input label={t("settings.min_withdrawal")} type="number" min={0} value={f.minWithdrawalCents / 100} onChange={(e) => set("minWithdrawalCents", Math.round(Number(e.target.value) * 100))} disabled={!canEdit} /></div>
            <Checkbox disabled={!canEdit} checked={f.separationOfDuties} onChange={(e) => set("separationOfDuties", e.target.checked)} label={t("settings.sod")} /></Card>
          <Card className="space-y-4"><h2 className="font-semibold">{t("settings.cancel_policy")}</h2><Checkbox disabled={!canEdit} checked={f.cancelPolicyEnabled} onChange={(e) => set("cancelPolicyEnabled", e.target.checked)} label={t("settings.cancel_enabled")} />
            <div className="grid gap-4 sm:grid-cols-4">{num("cancelWarnAt", t("settings.warn_at"))}{num("cancelSuspendAt", t("settings.suspend_at"))}{num("cancelWindowDays", t("settings.window_days"))}{num("cancelSuspendDays", t("settings.suspend_days"))}</div></Card>
          <Card className="space-y-4"><h2 className="font-semibold">{t("settings.operations")}</h2><div className="grid gap-4 sm:grid-cols-4">{num("lateGraceMin", t("settings.late_grace"))}{num("checkinEarlyMin", t("settings.checkin_early"))}{num("officeWindowMin", t("settings.office_window"))}
            <Select label={t("settings.overlap")} options={[{ value: "time_window", label: t("settings.overlap_window") }, { value: "single_active", label: t("settings.overlap_single") }]} value={f.overlapPolicy} onChange={(e) => set("overlapPolicy", e.target.value)} disabled={!canEdit} /></div>
            <div className="flex flex-wrap gap-6"><Checkbox disabled={!canEdit} checked={f.requireBusinessVerification} onChange={(e) => set("requireBusinessVerification", e.target.checked)} label={t("settings.req_biz_verify")} /><Checkbox disabled={!canEdit} checked={f.requireDriverVerification} onChange={(e) => set("requireDriverVerification", e.target.checked)} label={t("settings.req_drv_verify")} /></div></Card>
          <Card className="space-y-4"><h2 className="font-semibold">{t("settings.terms")}</h2><Input label={t("settings.terms_version")} value={f.termsVersion} onChange={(e) => set("termsVersion", e.target.value)} disabled={!canEdit} />
            <Textarea label={t("role.business")} value={f.termsBusiness} onChange={(e) => set("termsBusiness", e.target.value)} disabled={!canEdit} /><Textarea label={t("role.driver")} value={f.termsDriver} onChange={(e) => set("termsDriver", e.target.value)} disabled={!canEdit} /><Textarea label={t("role.office")} value={f.termsOffice} onChange={(e) => set("termsOffice", e.target.value)} disabled={!canEdit} /></Card>
          {canEdit && <Button size="lg" loading={a.is("s")} onClick={save}>{t("common.save")}</Button>}
        </div>
      )}
    </>
  );
}
export default function Settings() { return <Suspense><Inner /></Suspense>; }
