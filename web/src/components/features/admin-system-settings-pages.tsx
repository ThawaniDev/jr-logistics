"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button, Checkbox, Input, Notice, Section, Select, Textarea, errText, useAction } from "@/components/ui";
import { post } from "@/lib/api";
import { useI18n } from "@/i18n/provider";
import { CitiesEditor } from "./admin-cities";
import { FieldOpsSettings } from "./admin-settings-fieldops";
import { SettingsPage, useSettings } from "./admin-system-settings";
import { SETTINGS_RANGES, rangeErrors } from "./admin-system-settings-lib";

/** A whole-number (or decimal) setting with its allowed range shown as an error when the value would be rejected. `scale` converts a stored value (halalas) to what is typed (SAR). */
function NumField({ k, label, hint, scale = 1, unit }: { k: string; label: string; hint?: string; scale?: number; unit?: string }) {
  const { t } = useI18n(); const c = useSettings(); const r = SETTINGS_RANGES[k]; const bad = k in rangeErrors(c.edits);
  const v = Number(c.f?.[k] ?? 0) / scale;
  return <Input data-testid={`rdb-set-${k}`} label={label} type="number" inputMode="decimal" min={r.min / scale} max={r.max / scale} step={r.int && scale === 1 ? 1 : "any"} ltr value={Number.isFinite(v) ? v : ""} disabled={!c.canEdit}
    onChange={(e) => c.set(k, e.target.value === "" ? NaN : scale === 1 ? Number(e.target.value) : Math.round(Number(e.target.value) * scale))}
    error={bad ? t(r.int && scale === 1 ? "foa.set_range" : "rdb.set_range", { min: r.min / scale, max: r.max / scale }) : undefined} hint={bad ? undefined : hint ?? unit} />;
}

/** General: which services customers can order, and the cities served. */
export function GeneralSettings() {
  const { t } = useI18n(); const c = useSettings(); const f = c.f;
  return (
    <SettingsPage section="general">
      <Section title={t("settings.services")} description={t("rdb.set_services_hint")}>
        <div className="flex flex-wrap gap-x-6 gap-y-3" role="group" aria-label={t("settings.services")}>
          {["delivery_driver", "car_with_driver", "car_without_driver"].map((s) => (
            <Checkbox key={s} data-testid={`rdb-set-service-${s}`} disabled={!c.canEdit} checked={(f?.enabledServices ?? []).includes(s)} label={t(`svc.${s}`)}
              onChange={() => c.set("enabledServices", (f?.enabledServices ?? []).includes(s) ? f!.enabledServices.filter((x: string) => x !== s) : [...(f?.enabledServices ?? []), s])} />))}
        </div>
      </Section>
      <Section title={t("adm.cities")}><CitiesEditor value={f?.cities ?? []} onChange={(v) => c.set("cities", v)} disabled={!c.canEdit} /></Section>
    </SettingsPage>
  );
}

/** Matching & jobs: timing rules, overlap policy, verification requirements and the driver cancellation policy. */
export function JobsSettings() {
  const { t } = useI18n(); const c = useSettings(); const f = c.f;
  return (
    <SettingsPage section="jobs">
      <Section title={t("settings.operations")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumField k="lateGraceMin" label={t("settings.late_grace")} /><NumField k="checkinEarlyMin" label={t("settings.checkin_early")} />
          <Select data-testid="rdb-set-overlapPolicy" label={t("settings.overlap")} options={[{ value: "time_window", label: t("settings.overlap_window") }, { value: "single_active", label: t("settings.overlap_single") }]} value={f?.overlapPolicy ?? "time_window"} onChange={(e) => c.set("overlapPolicy", e.target.value)} disabled={!c.canEdit} />
        </div>
      </Section>
      <Section title={t("rdb.set_verify_title")} description={t("rdb.set_verify_hint")}>
        <div className="space-y-3">
          <Checkbox data-testid="rdb-set-requireBusinessVerification" disabled={!c.canEdit} checked={!!f?.requireBusinessVerification} onChange={(e) => c.set("requireBusinessVerification", e.target.checked)} label={t("settings.req_biz_verify")} />
          <Checkbox data-testid="rdb-set-requireDriverVerification" disabled={!c.canEdit} checked={!!f?.requireDriverVerification} onChange={(e) => c.set("requireDriverVerification", e.target.checked)} label={t("settings.req_drv_verify")} />
        </div>
      </Section>
      <Section title={t("settings.cancel_policy")} description={t("rdb.set_cancel_hint")}>
        <div className="space-y-4">
          <Checkbox data-testid="rdb-set-cancelPolicyEnabled" disabled={!c.canEdit} checked={!!f?.cancelPolicyEnabled} onChange={(e) => c.set("cancelPolicyEnabled", e.target.checked)} label={t("settings.cancel_enabled")} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumField k="cancelWarnAt" label={t("settings.warn_at")} /><NumField k="cancelSuspendAt" label={t("settings.suspend_at")} /><NumField k="cancelWindowDays" label={t("settings.window_days")} /><NumField k="cancelSuspendDays" label={t("settings.suspend_days")} />
          </div>
        </div>
      </Section>
    </SettingsPage>
  );
}

/** Field operations: the rules the driver apps follow in the field (geofence, route re-ordering, postponing evidence, door timer, warehouse defaults). */
export function FieldOpsSettingsPage() { return <SettingsPage section="fieldops"><FieldOpsSettings /></SettingsPage>; }

/** Finance & limits: VAT and the minimum withdrawal; payments themselves are automatic. */
export function FinanceSettings() {
  const { t } = useI18n();
  return (
    <SettingsPage section="finance">
      <Notice tone="info" title={t("foa.fin_auto_title")}>{t("foa.fin_auto_note")}</Notice>
      <Section title={t("settings.finance")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumField k="vatPct" label={t("settings.vat")} hint={t("settings.vat_hint")} />
          <NumField k="minWithdrawalCents" label={t("settings.min_withdrawal")} scale={100} />
        </div>
      </Section>
    </SettingsPage>
  );
}

/** Own password (works even without settings access) */
function PasswordSection() {
  const { t } = useI18n(); const a = useAction(); const router = useRouter();
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" }); const [err, setErr] = useState<string | null>(null);
  const change = () => a.run("pw", () => post("/auth/change-password", pw), { success: "settings.pw_changed", onDone: () => { router.replace("/staff/login"); router.refresh(); }, onError: (e) => setErr(errText(e, t)) });
  return (
    <Section title={t("settings.change_password")} description={t("rdb.set_pw_hint")} className="max-w-xl">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (pw.newPassword.length >= 10 && pw.currentPassword) change(); }}>
        <Input data-testid="rdb-set-pw-current" label={t("settings.current_password")} type="password" ltr autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
        <Input data-testid="rdb-set-pw-new" label={t("settings.new_password")} type="password" ltr autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} hint={t("staff.password_hint")} />
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <Button type="submit" data-testid="rdb-set-pw-submit" loading={a.is("pw")} disabled={pw.newPassword.length < 10 || !pw.currentPassword}><KeyRound className="size-4" aria-hidden />{t("settings.change_password")}</Button>
      </form>
    </Section>
  );
}

/** Security & access: your own password, and whether every staff account must use two-step verification. */
export function SecuritySettings() {
  const { t } = useI18n(); const c = useSettings();
  return (
    <SettingsPage section="security" before={<PasswordSection />} ownerNote={false}>
      <Section title={t("rdb.set_staff_signin")}>
        <Checkbox data-testid="rdb-set-requireStaffMfa" disabled={!c.canEdit} checked={!!c.f?.requireStaffMfa} onChange={(e) => c.set("requireStaffMfa", e.target.checked)}
          label={<><span className="font-medium text-ink">{t("settings.require_mfa")}</span><span className="mt-0.5 block text-xs text-muted">{t("settings.mfa_hint")}</span></>} />
        <p className="mt-3 text-sm"><Link className="inline-flex items-center gap-1.5 text-accent hover:underline" href="/staff/mfa"><ShieldCheck className="size-4" aria-hidden />{t("mfa.title")} — {t("mfa.manage")}</Link></p>
      </Section>
    </SettingsPage>
  );
}

/** Terms of service: the version and the text each kind of account accepts. */
export function TermsSettings() {
  const { t } = useI18n(); const c = useSettings(); const f = c.f;
  return (
    <SettingsPage section="terms">
      <Section title={t("settings.terms")} description={t("rdb.set_terms_hint")}>
        <div className="space-y-4">
          <div className="max-w-xs"><Input data-testid="rdb-set-termsVersion" label={t("settings.terms_version")} ltr value={f?.termsVersion ?? ""} onChange={(e) => c.set("termsVersion", e.target.value)} disabled={!c.canEdit} maxLength={20} /></div>
          {(["termsBusiness", "termsDriver", "termsOffice"] as const).map((k) => (
            <Textarea key={k} data-testid={`rdb-set-${k}`} label={t(`role.${k.slice(5).toLowerCase()}`)} rows={6} value={f?.[k] ?? ""} onChange={(e) => c.set(k, e.target.value)} disabled={!c.canEdit} maxLength={10000} />))}
        </div>
      </Section>
    </SettingsPage>
  );
}
