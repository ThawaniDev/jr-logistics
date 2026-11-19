"use client";
import { Checkbox, Input, Notice, Section } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { FIELDOPS_RANGE, WAREHOUSE_SWITCHES, fieldopsErrors, settingValue, warehouseDefaultsOf, type FieldopsSettings, type WarehouseSwitch } from "./admin-fieldops-lib";
import { useSettings } from "./admin-system-settings";

type BoolKey = "arrivalGeofenceEnabled" | "driverCanReorderRoute" | "rescheduleEvidenceText" | "rescheduleEvidencePhoto" | "driverSingleActiveJob" | "stopFailStrictRules";

/** A switch with a label and a one-line hint underneath. */
function Switch({ id, label, hint, checked, disabled, onChange }: { id: string; label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <Checkbox data-testid={id} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
      label={<><span className="font-medium text-ink">{label}</span>{hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}</>} />
  );
}

/**
 * "Field operations" sub-page of the settings workspace (E.0): the rules the driver apps follow in the field, one `Section` per rule group.
 * Values missing from an older server fall back to the platform defaults; the page's Save sends only what changed.
 */
export function FieldOpsSettings() {
  const { t } = useI18n(); const c = useSettings(); const server = c.data ?? {}; const edits = c.edits; const set = c.set; const canEdit = c.canEdit;
  const v = <K extends keyof FieldopsSettings>(k: K) => settingValue(server, edits, k);
  const errs = fieldopsErrors(edits);
  const b = (k: BoolKey, label: string, hint: string) => <Switch id={`foa-set-${k}`} label={label} hint={hint} checked={!!v(k)} disabled={!canEdit} onChange={(x) => set(k, x)} />;
  const wd = warehouseDefaultsOf(server, edits);
  const radiusRaw = "arrivalRadiusM" in edits ? String(edits.arrivalRadiusM ?? "") : String(v("arrivalRadiusM"));
  const waitRaw = "stopWaitMin" in edits ? String(edits.stopWaitMin ?? "") : String(v("stopWaitMin"));
  const [rMin, rMax] = FIELDOPS_RANGE.arrivalRadiusM; const [wMin, wMax] = FIELDOPS_RANGE.stopWaitMin;
  const waitOn = Number(waitRaw) > 0 && !errs.stopWaitMin;
  const whLabel: Record<WarehouseSwitch, [string, string]> = {
    requireArrivalConfirmation: [t("foa.wh_sw_arrival"), t("foa.wh_sw_arrival_hint")],
    requireLoadingRecord: [t("foa.wh_sw_loading"), t("foa.wh_sw_loading_hint")],
    requireDeliveryOtp: [t("foa.wh_sw_otp"), t("foa.wh_sw_otp_hint")],
    requireSignature: [t("foa.wh_sw_signature"), t("foa.wh_sw_signature_hint")],
  };
  return (
    <div className="space-y-5" data-testid="foa-settings-card">
      <p className="text-sm text-muted">{t("foa.set_sub")}</p>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={t("foa.set_arrival")}>
          <div className="space-y-4">
            {b("arrivalGeofenceEnabled", t("foa.set_geofence"), t("foa.set_geofence_hint"))}
            <div className="max-w-xs">
              <Input data-testid="foa-set-arrivalRadiusM" label={t("foa.set_radius")} type="number" inputMode="numeric" min={rMin} max={rMax} step={1} ltr value={radiusRaw}
                onChange={(e) => set("arrivalRadiusM", e.target.value)} disabled={!canEdit || !v("arrivalGeofenceEnabled")}
                error={errs.arrivalRadiusM ? t("foa.set_range", { min: rMin, max: rMax }) : undefined} hint={errs.arrivalRadiusM ? undefined : t("foa.set_radius_hint", { min: rMin, max: rMax })} />
            </div>
          </div>
        </Section>

        <Section title={t("foa.set_door")}>
          <div className="space-y-4">
            <div className="max-w-xs">
              <Input data-testid="foa-set-stopWaitMin" label={t("foa.set_wait")} type="number" inputMode="numeric" min={wMin} max={wMax} step={1} ltr value={waitRaw}
                onChange={(e) => set("stopWaitMin", e.target.value)} disabled={!canEdit}
                error={errs.stopWaitMin ? t("foa.set_range", { min: wMin, max: wMax }) : undefined} hint={errs.stopWaitMin ? undefined : t("foa.set_wait_hint")} />
            </div>
            <Notice tone={waitOn ? "warn" : "info"}>{waitOn ? t("foa.set_wait_on", { n: Number(waitRaw) }) : t("foa.set_wait_off")}</Notice>
          </div>
        </Section>

        <Section title={t("foa.set_route")}>{b("driverCanReorderRoute", t("foa.set_reorder"), t("foa.set_reorder_hint"))}</Section>
        <Section title={t("foa.set_offers")}>{b("driverSingleActiveJob", t("foa.set_single_job"), t("foa.set_single_job_hint"))}</Section>

        <Section title={t("foa.set_postpone")} description={t("foa.set_postpone_hint")}>
          <div className="space-y-4">
            {b("rescheduleEvidenceText", t("foa.set_ev_text"), t("foa.set_ev_text_hint"))}
            {b("rescheduleEvidencePhoto", t("foa.set_ev_photo"), t("foa.set_ev_photo_hint"))}
          </div>
        </Section>
        <Section title={t("foa.set_fail")}>{b("stopFailStrictRules", t("foa.set_strict"), t("foa.set_strict_hint"))}</Section>
      </div>

      <Section title={t("foa.set_wh_defaults")}>
        <div className="space-y-4">
          <Notice tone="info">{t("foa.set_wh_defaults_note")}</Notice>
          <div className="grid gap-4 sm:grid-cols-2">
            {WAREHOUSE_SWITCHES.map((k) => (
              <Switch key={k} id={`foa-set-wh-${k}`} label={whLabel[k][0]} hint={whLabel[k][1]} checked={wd[k]} disabled={!canEdit}
                onChange={(x) => set("warehouseDefaults", { ...wd, [k]: x })} />
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}
