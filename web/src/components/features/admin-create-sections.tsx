"use client";
import { Checkbox, Input, Notice, Section, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { LOCALE_LABEL, type Locale } from "@/i18n/core";
import { useI18n } from "@/i18n/provider";
import { CoordFields, EmailField, LockedNote, PhoneField, ServicePicker, type Dup } from "./admin-create-fields";
import { TEMP_VEHICLES, type FieldKey, type FormState, type Kind } from "./admin-create-lib";

type Opt = { value: string; label: string };
/** Everything the sections of the account form need: state, translated problems and hints, catalog options and what this staff member may do. */
export interface Ctx {
  kind: Kind; mode: "create" | "edit"; f: FormState; set: <K extends FieldKey>(k: K, v: FormState[K]) => void;
  errs: Partial<Record<FieldKey, string>>; warn: Partial<Record<FieldKey, string>>; dup: { phone: Dup; email: Dup };
  cities: Opt[]; services: Array<{ key: string; label: string }>; vehicles: string[]; offices: Opt[];
  canSensitive: boolean; canVerify: boolean; canAffiliate: boolean; canPin: boolean; maskedPhone?: string | null; officeName?: string | null;
}
const grid = "grid gap-4 sm:grid-cols-2";

/** A text box wired to the form state: label, error, soft warning (shown as the hint) and a stable test id. `sensitive` boxes are disabled without `drivers.sensitive`. */
function Txt({ c, k, label, ltr, sensitive, hint, ...p }: { c: Ctx; k: FieldKey; label: string; ltr?: boolean; required?: boolean; inputMode?: "numeric" | "text" | "decimal"; placeholder?: string; maxLength?: number; hint?: string; sensitive?: boolean; autoCapitalize?: string }) {
  const locked = !!sensitive && !c.canSensitive;
  return <Input {...p} label={label} ltr={ltr} autoComplete="off" disabled={locked} value={locked ? "" : (c.f[k] as string)} onChange={(e) => c.set(k, e.target.value as never)}
    error={c.errs[k]} hint={c.warn[k] ?? hint} data-testid={`acr-${k}`} />;
}

export function HolderSection({ c }: { c: Ctx }) {
  const { t } = useI18n();
  return (
    <Section title={t("acr.sec_holder")} description={t(c.mode === "create" ? "acr.sec_holder_hint" : "acr.sec_holder_edit")}>
      <div className={grid}>
        <Txt c={c} k="name" label={t(c.kind === "driver" ? "reg.full_name" : "reg.owner_name")} required />
        <PhoneField value={c.f.phone} onChange={(v) => c.set("phone", v)} error={c.errs.phone} dup={c.dup.phone} masked={c.maskedPhone} editing={c.mode === "edit"} />
        <EmailField value={c.f.email} onChange={(v) => c.set("email", v)} error={c.errs.email} dup={c.dup.email} />
        <Select label={t("reg.city")} required placeholder={t("common.select")} options={c.cities} value={c.f.city} onChange={(e) => c.set("city", e.target.value)} error={c.errs.city} data-testid="acr-city" />
        <Select label={t("acr.language")} options={(Object.keys(LOCALE_LABEL) as Locale[]).map((l) => ({ value: l, label: LOCALE_LABEL[l] }))} value={c.f.language} onChange={(e) => c.set("language", e.target.value)} hint={t("acr.language_hint")} data-testid="acr-language" />
      </div>
    </Section>
  );
}

/** Company / courier office details, or the driver's identity and vehicle. */
export function DetailsSection({ c }: { c: Ctx }) {
  const { t } = useI18n(); const { kind, f } = c;
  if (kind === "driver") {
    const needTemp = TEMP_VEHICLES.includes(f.vehicleType);
    return (
      <Section title={t("acr.sec_vehicle")} description={t("acr.sec_vehicle_hint")}>
        <div className="space-y-4">
          {!c.canSensitive && <LockedNote />}
          <div className={grid}>
            <Txt c={c} k="nationalId" label={t("reg.national_id")} ltr inputMode="numeric" sensitive />
            <Txt c={c} k="vehiclePlate" label={t("reg.plate")} ltr autoCapitalize="characters" maxLength={15} />
            <Select label={t("reg.vehicle")} required placeholder={t("common.select")} options={c.vehicles.map((v) => ({ value: v, label: t(`vehicle.${v}`) }))} value={f.vehicleType} onChange={(e) => c.set("vehicleType", e.target.value)} error={c.errs.vehicleType} data-testid="acr-vehicleType" />
            {needTemp && <Select label={t("reg.temperature")} required placeholder={t("common.select")} options={[{ value: "dry", label: t("temp.dry") }, { value: "cold", label: t("temp.cold") }]} value={f.vehicleTemperature} onChange={(e) => c.set("vehicleTemperature", e.target.value)} error={c.errs.vehicleTemperature} data-testid="acr-vehicleTemperature" />}
          </div>
          <ServicePicker value={f.services} onChange={(v) => c.set("services", v)} options={c.services} error={c.errs.services} />
          {c.mode === "create" && c.canAffiliate && (
            <Select label={t("acr.office_affiliation")} placeholder={t("acr.office_none")} options={c.offices} value={f.officeId} onChange={(e) => c.set("officeId", e.target.value)} error={c.errs.officeId} hint={t("acr.office_affiliation_hint")} data-testid="acr-officeId" />
          )}
          {c.mode === "edit" && <p className="text-xs text-muted" data-testid="acr-office-note">{c.officeName ? t("acr.office_edit_note", { office: c.officeName }) : t("acr.office_edit_direct")}</p>}
        </div>
      </Section>
    );
  }
  const office = kind === "office";
  return (
    <Section title={t(office ? "acr.sec_office" : "acr.sec_company")} description={t(office ? "acr.sec_office_hint" : "acr.sec_company_hint")}>
      <div className="space-y-4">
        {office && !c.canSensitive && <LockedNote />}
        <div className={grid}>
          <Txt c={c} k="companyName" label={t(office ? "reg.office_name" : "reg.company")} required />
          <Txt c={c} k="contactPerson" label={t("acr.contact_person")} hint={t("acr.contact_person_hint")} />
          <Txt c={c} k="crNumber" label={t("reg.cr")} ltr inputMode="numeric" />
          <Txt c={c} k="taxNumber" label={t("reg.tax")} ltr inputMode="numeric" sensitive={office} />
          {!office && <Txt c={c} k="industry" label={t("reg.industry")} />}
          <div className="sm:col-span-2"><Txt c={c} k="address" label={t("reg.address")} maxLength={300} /></div>
        </div>
      </div>
    </Section>
  );
}

/** Company: the warehouse pin. Office and driver: the bank account the payouts go to. */
export function PlaceSection({ c }: { c: Ctx }) {
  const { t } = useI18n();
  if (c.kind === "business") {
    return (
      <Section title={t("acr.sec_location")} description={t("acr.sec_location_hint")}>
        <div className="space-y-4">
          {!c.canPin && <Notice tone="warn">{t("acr.pin_locked")}</Notice>}
          <CoordFields lat={c.f.lat} lng={c.f.lng} onChange={(la, ln) => { c.set("lat", la); c.set("lng", ln); }} errLat={c.errs.lat} errLng={c.errs.lng} disabled={!c.canPin} />
          {c.mode === "create" && !c.f.lat.trim() && !c.f.lng.trim() && <Notice tone="info">{t("acr.pin_later")}</Notice>}
        </div>
      </Section>
    );
  }
  return (
    <Section title={t("acr.sec_bank")} description={t("acr.sec_bank_hint")}>
      <div className="space-y-4">
        {!c.canSensitive && <LockedNote />}
        <div className={grid}>
          <Txt c={c} k="bankName" label={t("profile.bank")} sensitive maxLength={80} />
          <Txt c={c} k="iban" label={t("profile.iban")} ltr placeholder="SA…" maxLength={34} hint={t("profile.iban_hint")} sensitive />
        </div>
      </div>
    </Section>
  );
}

/** Create only: starting verification state and the sign-in text message. */
export function AccessSection({ c }: { c: Ctx }) {
  const { t } = useI18n(); const now = c.f.verifyNow && c.canVerify;
  const card = (on: boolean, disabled?: boolean) => cn("min-h-16 rounded-2xl border p-4 text-start transition", on ? "border-accent bg-accent/10" : "border-line bg-bg2 hover:border-accent/50", disabled && "cursor-not-allowed opacity-50");
  return (
    <Section title={t("acr.sec_access")} description={t("acr.sec_access_hint")}>
      <div className="space-y-4">
        <div role="radiogroup" aria-label={t("verify.title")} className="grid gap-3 sm:grid-cols-2">
          <button type="button" role="radio" aria-checked={!now} data-testid="acr-verify-pending" className={card(!now)} onClick={() => c.set("verifyNow", false)}>
            <span className="block font-semibold">{t("acr.verify_pending")}</span><span className="mt-1 block text-xs text-muted">{t(c.kind === "driver" ? "acr.verify_pending_driver_hint" : "acr.verify_pending_hint")}</span>
          </button>
          <button type="button" role="radio" aria-checked={now} aria-disabled={!c.canVerify} disabled={!c.canVerify} data-testid="acr-verify-now" className={card(now, !c.canVerify)} onClick={() => c.set("verifyNow", true)}>
            <span className="block font-semibold">{t("acr.verify_now")}</span><span className="mt-1 block text-xs text-muted">{t(c.canVerify ? "acr.verify_now_hint" : "acr.verify_now_locked")}</span>
          </button>
        </div>
        {now && (
          <div className="space-y-3">
            <Textarea label={t("acr.verify_reason")} required value={c.f.verifyReason} onChange={(e) => c.set("verifyReason", e.target.value)} error={c.errs.verifyReason} hint={t("acr.verify_reason_hint")} maxLength={500} data-testid="acr-verify-reason" />
            {c.kind === "office" && <Notice tone="warn">{t("acr.verify_office_docs")}</Notice>}
            {c.kind === "driver" && <Notice tone="info">{t("acr.verify_driver_docs")}</Notice>}
          </div>
        )}
        <Checkbox checked={c.f.sendSms} onChange={(e) => c.set("sendSms", e.target.checked)} data-testid="acr-send-sms"
          label={<><span className="font-medium text-ink">{t("acr.send_sms")}</span><span className="block text-xs text-muted">{t("acr.send_sms_hint")}</span></>} />
      </div>
    </Section>
  );
}
