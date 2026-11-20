"use client";
import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, Loader2, Lock, XCircle } from "lucide-react";
import { Input } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { qs, useDebounced } from "./admin-common";
import { mapsLink, parseCoordinates, parseOneCoord, validLatLng } from "./admin-fieldops-lib";
import { isolate, phoneOf, LIST_HREF, type Kind } from "./admin-create-lib";

export interface Dup { state: "idle" | "checking" | "free" | "taken" | "error"; account?: { id: string; role: Kind; name: string } | null }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Live duplicate check of the phone and email boxes (`GET /admin/accounts/check`, debounced). `exceptId` is the account being edited. */
export function useDuplicateCheck(phone: string, email: string, exceptId?: string): { phone: Dup; email: Dup } {
  const dp = useDebounced(phone.trim(), 450), de = useDebounced(email.trim(), 450);
  const p = phoneOf(dp), e = EMAIL_RE.test(de) ? de : "";
  const key = p || e ? `/admin/accounts/check${qs({ phone: p ?? undefined, email: e || undefined, exceptId })}` : null;
  const { data, error, isLoading } = useApi(key, { shouldRetryOnError: false, keepPreviousData: false, revalidateOnMount: true, dedupingInterval: 0 });
  const one = (raw: string, deb: string, ok: boolean, r?: { taken: boolean; account?: Dup["account"] }): Dup => {
    if (!raw.trim() || !ok) return { state: "idle" };
    if (raw.trim() !== deb || isLoading) return { state: "checking" };
    if (error) return { state: "error" };
    if (!r) return { state: "idle" };
    return r.taken ? { state: "taken", account: r.account } : { state: "free" };
  };
  return { phone: one(phone, dp, !!phoneOf(phone), data?.phone), email: one(email, de, EMAIL_RE.test(email.trim()), data?.email) };
}

/** The line under a phone / email box: checking, available, or "already used by …" with a link to that account. */
export function DupLine({ dup, testid }: { dup: Dup; testid: string }) {
  const { t } = useI18n();
  if (dup.state === "idle" || dup.state === "error") return null;
  const a = dup.account;
  return (
    <p role="status" data-testid={testid} data-state={dup.state} className={cn("mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs", dup.state === "taken" ? "text-danger" : dup.state === "free" ? "text-accent" : "text-muted")}>
      {dup.state === "checking" && <><Loader2 className="size-3.5 animate-spin" aria-hidden />{t("acr.checking")}</>}
      {dup.state === "free" && <><CheckCircle2 className="size-3.5" aria-hidden />{t("acr.available")}</>}
      {dup.state === "taken" && <><XCircle className="size-3.5" aria-hidden />{a ? t("acr.taken_by", { name: a.name, role: t(`role.${a.role}`) }) : t("acr.taken")}
        {a && <Link href={`${LIST_HREF[a.role]}/${a.id}`} className="inline-flex items-center gap-1 font-medium underline" target="_blank" rel="noopener"><ExternalLink className="size-3 rtl:-scale-x-100" aria-hidden />{t("acr.open_account")}</Link>}</>}
    </p>
  );
}

/** Saudi mobile number box with its live duplicate line. In edit mode without `drivers.sensitive` the current number is masked: leave the box empty to keep it. */
export function PhoneField({ value, onChange, error, dup, masked, editing }: { value: string; onChange: (v: string) => void; error?: string; dup: Dup; masked?: string | null; editing?: boolean }) {
  const { t } = useI18n(); const p = phoneOf(value);
  const hint = editing && masked && !value.trim() ? t("acr.phone_keep", { phone: isolate(masked) }) : p && p !== value.trim() ? t("acr.phone_saved_as", { phone: isolate(p) }) : t("acr.phone_hint");
  return (
    <div>
      <Input label={t("auth.phone")} ltr required type="tel" inputMode="tel" autoComplete="off" placeholder={masked && editing ? masked : "05XXXXXXXX"} value={value}
        onChange={(e) => onChange(e.target.value)} error={error ?? (dup.state === "taken" ? t("acr.taken") : undefined)} hint={hint} data-testid="acr-phone" />
      <DupLine dup={dup} testid="acr-phone-check" />
    </div>
  );
}
export function EmailField({ value, onChange, error, dup }: { value: string; onChange: (v: string) => void; error?: string; dup: Dup }) {
  const { t } = useI18n();
  return (
    <div>
      <Input label={t("reg.email_opt")} ltr type="email" inputMode="email" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} error={error ?? (dup.state === "taken" ? t("acr.taken") : undefined)} hint={t("acr.email_hint")} data-testid="acr-email" />
      <DupLine dup={dup} testid="acr-email-check" />
    </div>
  );
}

/** A field the signed-in staff member may not use (sensitive data without `drivers.sensitive`): shown disabled with the reason. */
export function LockedNote() {
  const { t } = useI18n();
  return <p className="flex items-start gap-2 rounded-xl border border-line bg-bg2 px-3 py-2 text-xs text-muted" data-testid="acr-locked-note"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />{t("acr.locked_sensitive")}</p>;
}

/** Warehouse pin: latitude / longitude plus "paste a Google Maps link or lat,lng" (same parser as the warehouse screen). */
export function CoordFields({ lat, lng, onChange, errLat, errLng, disabled }: { lat: string; lng: string; onChange: (lat: string, lng: string) => void; errLat?: string; errLng?: string; disabled?: boolean }) {
  const { t } = useI18n(); const [paste, setPaste] = useState(""); const [state, setState] = useState<"ok" | "bad" | null>(null);
  const la = parseOneCoord(lat), ln = parseOneCoord(lng); const pin = la !== null && ln !== null && validLatLng(la, ln) ? { lat: la, lng: ln } : null;
  const onText = (k: "lat" | "lng", v: string) => {
    // a "lat,lng" pair pasted into either box fills both
    if (parseOneCoord(v) === null && /[,;\s]|maps|geo:/i.test(v)) { const p = parseCoordinates(v); if (p) { onChange(String(p.lat), String(p.lng)); return; } }
    onChange(k === "lat" ? v : lat, k === "lng" ? v : lng);
  };
  const onPaste = (v: string) => {
    setPaste(v);
    if (!v.trim()) { setState(null); return; }
    const p = parseCoordinates(v);
    if (p) { setState("ok"); onChange(String(p.lat), String(p.lng)); } else setState("bad");
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t("foa.wh_lat")} ltr inputMode="decimal" placeholder="24.713600" value={lat} disabled={disabled} onChange={(e) => onText("lat", e.target.value)} error={errLat} data-testid="acr-lat" />
        <Input label={t("foa.wh_lng")} ltr inputMode="decimal" placeholder="46.675300" value={lng} disabled={disabled} onChange={(e) => onText("lng", e.target.value)} error={errLng} data-testid="acr-lng" />
      </div>
      {!disabled && <Input label={t("foa.wh_paste")} ltr value={paste} placeholder="https://maps.google.com/…  |  24.7136, 46.6753" onChange={(e) => onPaste(e.target.value)}
        error={state === "bad" ? t("foa.wh_paste_bad") : undefined} hint={state === "ok" ? t("foa.wh_paste_ok") : t("foa.wh_paste_hint")} data-testid="acr-paste" />}
      {pin ? <a href={mapsLink(pin.lat, pin.lng)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline" data-testid="acr-map-link"><ExternalLink className="size-4" aria-hidden />{t("foa.wh_view_map")}</a>
        : <p className="text-xs text-muted">{t("foa.wh_view_map_na")}</p>}
    </div>
  );
}

/** The services a driver offers, as toggle chips (same control as the registration form). */
export function ServicePicker({ value, onChange, options, error }: { value: string[]; onChange: (v: string[]) => void; options: Array<{ key: string; label: string }>; error?: string }) {
  const { t } = useI18n();
  return (
    <fieldset data-testid="acr-services">
      <legend className="mb-2 text-xs font-medium text-muted">{t("reg.services")}<span className="text-accent" aria-hidden> *</span></legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => { const on = value.includes(o.key); return (
          <button key={o.key} type="button" aria-pressed={on} data-testid={`acr-service-${o.key}`} onClick={() => onChange(on ? value.filter((x) => x !== o.key) : [...value, o.key])}
            className={cn("min-h-11 rounded-full border px-4 py-1.5 text-sm transition", on ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:text-ink")}>{o.label}</button>); })}
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </fieldset>
  );
}
