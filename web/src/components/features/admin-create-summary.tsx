"use client";
import { ArrowRight, CheckCircle2, Info, KeyRound, Landmark } from "lucide-react";
import { Notice, Section } from "@/components/ui";
import { LOCALE_LABEL, type Locale } from "@/i18n/core";
import { useI18n } from "@/i18n/provider";
import { isolate, labelKeyOf, maskedValue, phoneOf, whatHappens, type FieldKey, type FormState, type Kind } from "./admin-create-lib";

/** Create: the bullet list of what the system will do. Edit: the list of fields that changed (old → new) with the side effects that matter. */
export function Summary({ kind, mode, f, initial, changed, officeName, canVerify, cityName }: {
  kind: Kind; mode: "create" | "edit"; f: FormState; initial: FormState; changed: FieldKey[]; officeName?: string; canVerify: boolean; cityName: (k: string) => string;
}) {
  const { t } = useI18n();
  if (mode === "create") {
    return (
      <Section title={t("acr.summary_title")} description={t("acr.summary_hint")}>
        <ul className="space-y-2.5 text-sm" data-testid="acr-summary">
          {whatHappens(kind, f, { officeName, canVerify }).map((x) => (
            <li key={x.key} className="flex items-start gap-2.5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /><span><bdi>{t(x.key, x.vars && ("phone" in x.vars || "username" in x.vars) ? Object.fromEntries(Object.entries(x.vars).map(([k, v]) => [k, k === "phone" || k === "username" ? isolate(String(v)) : v])) : x.vars)}</bdi></span></li>
          ))}
        </ul>
      </Section>
    );
  }
  const show = (k: FieldKey, s: FormState) => {
    const v = s[k]; const raw = Array.isArray(v) ? v : String(v ?? "");
    if (k === "services") return (raw as string[]).map((x) => t(`svc.${x}`)).join(", ") || "—";
    if (k === "city") return raw ? cityName(raw as string) : "—";
    if (k === "vehicleType") return raw ? t(`vehicle.${raw}`) : "—";
    if (k === "vehicleTemperature") return raw ? t(`temp.${raw}`) : "—";
    if (k === "language") return LOCALE_LABEL[raw as Locale] ?? String(raw);
    if (k === "phone") return phoneOf(raw as string) ?? (raw as string) ?? "—";
    return maskedValue(k, raw as string, kind) || "—";
  };
  const numeric = new Set<FieldKey>(["phone", "email", "lat", "lng", "iban", "nationalId", "crNumber", "taxNumber", "vehiclePlate"]);
  return (
    <Section title={t("acr.changes_title")} description={changed.length ? t("acr.changes_n", { n: changed.length }) : t("acr.changes_none")}>
      <div className="space-y-4" data-testid="acr-changes">
        {changed.length > 0 && (
          <dl className="space-y-3 text-sm">
            {changed.map((k) => (
              <div key={k} data-testid={`acr-change-${k}`}>
                <dt className="text-xs text-muted">{t(labelKeyOf(kind, k))}</dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium">
                  <span className={`text-muted line-through ${numeric.has(k) ? "ltr-num" : ""}`}>{k === "phone" && !initial.phone ? t("acr.phone_current") : show(k, initial)}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted rtl:rotate-180" aria-hidden />
                  <span className={numeric.has(k) ? "ltr-num" : undefined}>{show(k, f)}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {changed.includes("phone") && <Notice tone="warn"><span className="flex items-start gap-2"><KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />{t("acr.warn_phone_change")}</span></Notice>}
        {changed.includes("iban") && <Notice tone="warn"><span className="flex items-start gap-2"><Landmark className="mt-0.5 size-4 shrink-0" aria-hidden />{t("acr.warn_iban_change")}</span></Notice>}
        {(changed.includes("lat") || changed.includes("lng")) && <Notice tone="info"><span className="flex items-start gap-2"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{t("acr.warn_pin_change")}</span></Notice>}
        <p className="text-xs text-muted">{t("acr.audit_note")}</p>
      </div>
    </Section>
  );
}
