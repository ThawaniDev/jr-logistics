/**
 * Pure helpers of the create / edit account forms (decision G1): the form state, instant validation (mirrors server/account-admin-rules.ts, which stays
 * the authority), the request bodies, the diff of an edit, and the "what will happen" summary. No React, no I/O — unit-tested in tests/unit/create-form.test.ts.
 */
import { normalizePhone } from "@/lib/phone";
import { passwordIssue } from "@/lib/gen-password";
import { normalizeUsername, usernameFromPhone, usernameProblem } from "@/lib/username";
import { ApiError } from "@/lib/api";
import { TEMPERATURE_VEHICLES, VEHICLE_TYPES } from "@/server/catalog";
import { fmtCoord, parseCoordinates, parseOneCoord, validLatLng, normalizeDigits } from "./admin-fieldops-lib";

export type Kind = "business" | "office" | "driver";
export const KINDS: readonly Kind[] = ["business", "office", "driver"];
export const isKind = (v: unknown): v is Kind => KINDS.includes(v as Kind);
export const LANGS = ["ar", "en", "ur"] as const;
export const TEMP_VEHICLES = TEMPERATURE_VEHICLES; // vans and dynas: dry / cold applies

export interface FormState {
  name: string; phone: string; email: string; city: string; language: string;
  companyName: string; contactPerson: string; industry: string; address: string; crNumber: string; taxNumber: string;
  lat: string; lng: string; bankName: string; iban: string;
  nationalId: string; vehicleType: string; vehicleTemperature: string; vehiclePlate: string; services: string[];
  officeId: string; verifyNow: boolean; verifyReason: string; sendSms: boolean;
  /** Create only: how the person signs in. Both optional — empty username = `u` + the digits of the phone; empty password = the server generates one (shown once). */
  username: string; password: string;
}
export type FieldKey = keyof FormState;

/** Fields that exist for each kind of account (server: PROFILE_FIELDS + BASE_FIELDS). */
const BASE: FieldKey[] = ["name", "phone", "email", "city", "language"];
export const FIELDS: Record<Kind, FieldKey[]> = {
  business: [...BASE, "companyName", "contactPerson", "industry", "address", "crNumber", "taxNumber", "lat", "lng"],
  office: [...BASE, "companyName", "contactPerson", "crNumber", "taxNumber", "address", "bankName", "iban"],
  driver: [...BASE, "nationalId", "vehicleType", "vehicleTemperature", "vehiclePlate", "services", "bankName", "iban"],
};
/** Needs `drivers.sensitive` to enter or change. */
export const SENSITIVE: Record<Kind, FieldKey[]> = { business: [], office: ["taxNumber", "bankName", "iban"], driver: ["nationalId", "bankName", "iban"] };

export const emptyForm = (kind: Kind, language = "ar"): FormState => ({
  name: "", phone: "", email: "", city: "", language, companyName: "", contactPerson: "", industry: "", address: "", crNumber: "", taxNumber: "", lat: "", lng: "",
  bankName: "", iban: "", nationalId: "", vehicleType: "", vehicleTemperature: "", vehiclePlate: "", services: kind === "driver" ? ["delivery_driver"] : [],
  officeId: "", verifyNow: false, verifyReason: "", sendSms: true, username: "", password: "",
});

/** The editable snapshot from `GET /admin/accounts/:id` → form state. A masked phone (no `drivers.sensitive`) starts empty: leaving it empty keeps the number. */
export function formFromAccount(kind: Kind, d: { fields: Record<string, unknown>; phone: string | null }): FormState {
  const f = emptyForm(kind, String(d.fields.language ?? "ar")); const s = (v: unknown) => (v == null ? "" : String(v));
  const out: FormState = { ...f, phone: d.phone ?? "", sendSms: false };
  for (const k of FIELDS[kind]) {
    if (k === "phone") continue;
    if (k === "services") out.services = Array.isArray(d.fields.services) ? (d.fields.services as string[]) : [];
    else if (k === "lat" || k === "lng") (out as unknown as Record<string, string>)[k] = fmtCoord(d.fields[k] as number | null | undefined);
    else (out as unknown as Record<string, string>)[k] = s(d.fields[k]);
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REG_NO = /^[A-Za-z0-9][A-Za-z0-9\-/ ]{1,28}[A-Za-z0-9]$/;
const NATIONAL_ID = /^[A-Za-z0-9]{5,20}$/;
const PLATE = /^[\p{L}\p{N}][\p{L}\p{N} -]{0,13}[\p{L}\p{N}]$/u;
export const normalizeIban = (raw: string) => { const v = normalizeDigits(raw).replace(/\s/g, "").toUpperCase(); return /^SA\d{22}$/.test(v) ? v : null; };
export const phoneOf = (raw: string) => (raw.trim() ? normalizePhone(normalizeDigits(raw)) : null);

export interface Rules { cityKeys: string[]; serviceKeys: string[]; canSensitive: boolean; mode: "create" | "edit"; maskedPhone?: boolean }
/** i18n key of the problem per field (empty object = valid). Fields the person may not touch (sensitive without the permission) are skipped. */
export function validateForm(kind: Kind, f: FormState, r: Rules): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {};
  const has = (k: FieldKey) => FIELDS[kind].includes(k) && (r.canSensitive || !SENSITIVE[kind].includes(k));
  if (f.name.trim().length < 2) e.name = "val.required";
  if (!f.phone.trim()) { if (!(r.mode === "edit" && r.maskedPhone)) e.phone = "val.required"; } else if (!phoneOf(f.phone)) e.phone = "val.phone";
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = "profile.invalid_email";
  if (!f.city || (r.cityKeys.length && !r.cityKeys.includes(f.city))) e.city = "val.required";
  if (kind !== "driver" && f.companyName.trim().length < 2) e.companyName = "val.required";
  for (const k of ["crNumber", "taxNumber"] as const) if (has(k) && f[k].trim() && !REG_NO.test(normalizeDigits(f[k]).trim())) e[k] = "acr.err_reg_number";
  if (has("iban") && f.iban.trim() && !normalizeIban(f.iban)) e.iban = "profile.iban_invalid";
  if (kind === "business") {
    const la = f.lat.trim(), ln = f.lng.trim();
    if (la || ln) {
      const a = parseOneCoord(la), b = parseOneCoord(ln);
      if (!la || !ln) e[la ? "lng" : "lat"] = "foa.wh_err_pair"; else if (a === null || b === null || !validLatLng(a, b)) e.lat = "foa.wh_err_coords";
    }
  }
  if (kind === "driver") {
    if (has("nationalId") && f.nationalId.trim() && !NATIONAL_ID.test(normalizeDigits(f.nationalId).trim())) e.nationalId = "acr.err_national_id";
    if (f.vehiclePlate.trim() && !PLATE.test(f.vehiclePlate.trim())) e.vehiclePlate = "acr.err_plate";
    if (!f.vehicleType || !(VEHICLE_TYPES as readonly string[]).includes(f.vehicleType)) e.vehicleType = "val.required";
    if (TEMP_VEHICLES.includes(f.vehicleType) && !["dry", "cold"].includes(f.vehicleTemperature)) e.vehicleTemperature = "profile.temp_required";
    if (!f.services.length || f.services.some((s) => r.serviceKeys.length && !r.serviceKeys.includes(s))) e.services = "profile.services_required";
  }
  if (r.mode === "create" && f.verifyNow && f.verifyReason.trim().length < 3) e.verifyReason = "acr.err_reason";
  if (r.mode === "create") {
    const u = normalizeUsername(f.username);
    if (u) { const bad = usernameProblem(u); if (bad) e.username = bad === "reserved" ? "ja.un_reserved" : "ja.un_invalid"; }
    if (f.password) { const bad = passwordIssue(f.password); if (bad) e.password = bad === "weak" ? "ja.err_pw_weak" : "ja.err_pw_short"; }
  }
  return e;
}

/** Soft hints that never block saving (a number that does not look like the usual Saudi format may still be right). Values are i18n keys. */
export function softWarnings(kind: Kind, f: FormState): Partial<Record<FieldKey, string>> {
  const w: Partial<Record<FieldKey, string>> = {};
  const digits = (s: string) => normalizeDigits(s).replace(/\D/g, "");
  if (FIELDS[kind].includes("crNumber") && f.crNumber.trim() && REG_NO.test(normalizeDigits(f.crNumber).trim()) && !/^\d{10}$/.test(normalizeDigits(f.crNumber).trim())) w.crNumber = "acr.warn_cr";
  if (kind !== "driver" && f.taxNumber.trim() && digits(f.taxNumber).length !== 15) w.taxNumber = "acr.warn_tax";
  if (kind === "driver" && f.nationalId.trim() && !/^[12]\d{9}$/.test(normalizeDigits(f.nationalId).trim())) w.nationalId = "acr.warn_national_id";
  return w;
}

/** Keeps a phone number or other left-to-right token intact inside a right-to-left sentence (the "+" would otherwise jump to the end). */
export const isolate = (s: string) => `\u2066${s}\u2069`;
const t = (s: string) => s.trim();
const orNull = (s: string) => (t(s) === "" ? null : t(s));
/** The value the server would store for one field, in the same shape the PATCH body uses (so "changed?" is a plain comparison). */
function wire(k: FieldKey, f: FormState): unknown {
  switch (k) {
    case "phone": return phoneOf(f.phone) ?? t(f.phone);
    case "email": return orNull(f.email)?.toLowerCase() ?? null;
    case "iban": return orNull(f.iban) ? (normalizeIban(f.iban) ?? t(f.iban)) : null;
    case "services": return [...f.services].sort();
    case "lat": case "lng": { const v = parseOneCoord(f[k]); return t(f[k]) === "" ? null : v ?? t(f[k]); }
    case "vehicleTemperature": return TEMP_VEHICLES.includes(f.vehicleType) ? orNull(f.vehicleTemperature) : null;
    case "crNumber": case "taxNumber": case "nationalId": { const v = orNull(f[k]); return v === null ? null : normalizeDigits(v); }
    default: return orNull(f[k as keyof FormState] as string);
  }
}

/** The fields this person may change, minus the sensitive ones they cannot see. */
const editable = (kind: Kind, canSensitive: boolean) => FIELDS[kind].filter((k) => canSensitive || !SENSITIVE[kind].includes(k));

/** `POST /admin/accounts` body. */
export function buildCreatePayload(kind: Kind, f: FormState, o: { canSensitive: boolean; canVerify: boolean; canAffiliate: boolean }) {
  const body: Record<string, unknown> = { kind };
  for (const k of editable(kind, o.canSensitive)) {
    const v = wire(k, f);
    if (v === null || (Array.isArray(v) && !v.length)) continue;
    body[k] = k === "services" ? f.services : v;
  }
  if (o.canVerify && f.verifyNow) body.verifyNow = { reason: t(f.verifyReason) };
  if (kind === "driver" && o.canAffiliate && f.officeId) body.officeId = f.officeId;
  if (f.sendSms) body.sendSms = true;
  if (t(f.username)) body.username = normalizeUsername(f.username);
  if (f.password) body.password = f.password;
  return body;
}

/** The fields of an edit that really differ from what was loaded (empty = nothing to save). A masked phone left empty is "no change". */
export function changedKeys(kind: Kind, initial: FormState, f: FormState, o: { canSensitive: boolean }): FieldKey[] {
  return editable(kind, o.canSensitive).filter((k) => {
    if (k === "phone" && t(f.phone) === "") return false;
    return JSON.stringify(wire(k, initial)) !== JSON.stringify(wire(k, f));
  });
}
/** `PATCH /admin/accounts/:id` body: only the changed fields (`null` clears an optional one). */
export function buildPatch(kind: Kind, initial: FormState, f: FormState, o: { canSensitive: boolean }) {
  const body: Record<string, unknown> = {};
  const keys = changedKeys(kind, initial, f, o);
  for (const k of keys) body[k] = k === "services" ? f.services : k === "lat" || k === "lng" ? parseOneCoord(f[k]) : wire(k, f);
  if (keys.includes("vehicleType") && TEMP_VEHICLES.includes(f.vehicleType)) body.vehicleTemperature = f.vehicleTemperature;
  if (kind === "business" && (keys.includes("lat") || keys.includes("lng"))) { body.lat = parseOneCoord(f.lat); body.lng = parseOneCoord(f.lng); }
  return body;
}

/** Field-level messages from an API error (English server text — shown only for fields the form could not catch itself). */
export function apiFieldErrors(e: unknown): Partial<Record<FieldKey, string>> {
  if (!(e instanceof ApiError)) return {};
  const d = e.details as Record<string, unknown>; const out: Partial<Record<FieldKey, string>> = {};
  const known = new Set<string>(["username", "password", "name", "phone", "email", "city", "language", "companyName", "contactPerson", "industry", "address", "crNumber", "taxNumber", "lat", "lng", "bankName", "iban", "nationalId", "vehicleType", "vehicleTemperature", "vehiclePlate", "services", "officeId", "verifyReason"]);
  for (const [k, v] of Object.entries(d)) if (known.has(k) && typeof v === "string") (out as Record<string, string>)[k] = v;
  if (typeof d.field === "string" && known.has(d.field) && !(d.field in out)) (out as Record<string, string>)[d.field] = e.message;
  return out;
}

/** Where the person goes after creating / saving: the entity's own view when this staff member may open it, else the list. */
export function entityHref(kind: Kind, id: string, can: (p: string) => boolean) {
  const list = { business: "/admin/companies", office: "/admin/offices", driver: "/admin/drivers" }[kind];
  const ok = kind === "business" ? ["users.view", "offices.view", "verification.manage"] : kind === "office" ? ["users.view", "offices.view", "offices.manage"] : ["drivers.view", "users.view"];
  return ok.some(can) ? `${list}/${id}` : list;
}
export const LIST_HREF: Record<Kind, string> = { business: "/admin/companies", office: "/admin/offices", driver: "/admin/drivers" };

/** The bullet list of "what will happen" for a new account: i18n keys with their variables. */
export function whatHappens(kind: Kind, f: FormState, o: { officeName?: string; canVerify: boolean }): Array<{ key: string; vars?: Record<string, string | number> }> {
  const out: Array<{ key: string; vars?: Record<string, string | number> }> = [];
  const phone = phoneOf(f.phone);
  const username = normalizeUsername(f.username) || (phone ? usernameFromPhone(phone) : "");
  out.push(username ? { key: "acr.will_signin", vars: { username } } : { key: "acr.will_signin_any" });
  out.push(o.canVerify && f.verifyNow ? { key: "acr.will_verified" } : { key: kind === "driver" ? "acr.will_pending_driver" : "acr.will_pending" });
  out.push({ key: "acr.will_wallet" });
  if (kind === "driver") out.push({ key: "acr.will_offline" });
  if (kind === "driver" && f.officeId) out.push({ key: "acr.will_office", vars: { office: o.officeName ?? "—" } });
  if (kind === "business") out.push({ key: parseCoordinates(`${f.lat}, ${f.lng}`) ? "acr.will_pin_set" : "acr.will_pin_missing" });
  out.push({ key: "acr.will_terms" });
  out.push({ key: f.sendSms ? "acr.will_sms" : "acr.will_no_sms" });
  out.push({ key: "acr.will_audit" });
  return out;
}

/** The label (i18n key) each field carries in the form, reused to describe a change in the edit summary. */
const LABEL_KEY: Partial<Record<FieldKey, string>> = {
  name: "common.name", phone: "auth.phone", email: "auth.email", city: "reg.city", language: "acr.language", contactPerson: "acr.contact_person", industry: "reg.industry", address: "reg.address",
  crNumber: "reg.cr", taxNumber: "reg.tax", lat: "foa.wh_lat", lng: "foa.wh_lng", bankName: "profile.bank", iban: "profile.iban", nationalId: "reg.national_id",
  vehicleType: "reg.vehicle", vehicleTemperature: "reg.temperature", vehiclePlate: "reg.plate", services: "reg.services",
};
export const labelKeyOf = (kind: Kind, k: FieldKey) => (k === "companyName" ? (kind === "office" ? "reg.office_name" : "reg.company") : LABEL_KEY[k] ?? k);
/** How a stored value is shown in a change list: payout and identity numbers are masked, empty is "—". */
export function maskedValue(k: FieldKey, v: string, kind?: Kind): string {
  if (!v) return "";
  if (k === "iban" || k === "nationalId") return `…${v.replace(/\s/g, "").slice(-4)}`;
  if (k === "bankName" || (k === "taxNumber" && kind !== "business")) return "••••"; // a company's VAT number is shown (it is on its invoices); an office's is payout-related
  return v;
}
