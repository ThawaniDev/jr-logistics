/**
 * Pure rules for creating and editing accounts as staff (decision G1): which fields each kind of account has, how each field is cleaned and
 * validated, which ones are sensitive, and how a change is turned into an audit diff. No I/O — unit-tested in tests/unit/create-rules.test.ts.
 * The create form (components/features/admin-create-lib.ts) mirrors these rules for instant feedback; the server is the authority.
 */
import { normalizePhone } from "@/lib/phone";
import { TEMPERATURE_VEHICLES, VEHICLE_TYPES } from "./catalog";

export const ACCOUNT_KINDS = ["business", "office", "driver"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export const isAccountKind = (v: unknown): v is AccountKind => (ACCOUNT_KINDS as readonly string[]).includes(v as string);
export const LANGUAGES = ["ar", "en", "ur"] as const;

/** Fields every account has (they live on `users`). */
export const BASE_FIELDS = ["name", "phone", "email", "city", "language"] as const;
/** Fields of the profile table, per kind. `companyName` is the office name for an office, `contactPerson` is `responsible_person`. */
export const PROFILE_FIELDS: Record<AccountKind, readonly string[]> = {
  business: ["companyName", "contactPerson", "industry", "address", "crNumber", "taxNumber", "lat", "lng"],
  office: ["companyName", "contactPerson", "crNumber", "taxNumber", "address", "bankName", "iban"],
  driver: ["nationalId", "vehicleType", "vehicleTemperature", "vehiclePlate", "services", "bankName", "iban"],
};
/** Personal / payout data: entering or changing it needs `drivers.sensitive` (same rule as reading it). */
export const SENSITIVE_FIELDS: Record<AccountKind, readonly string[]> = { business: [], office: ["taxNumber", "bankName", "iban"], driver: ["nationalId", "bankName", "iban"] };
/** Optional text fields that may be cleared (null / empty string). */
const CLEARABLE = new Set(["email", "contactPerson", "industry", "address", "crNumber", "taxNumber", "bankName", "iban", "nationalId", "vehiclePlate"]);
const MAXLEN: Record<string, number> = { name: 100, email: 160, companyName: 150, contactPerson: 100, industry: 80, address: 300, bankName: 80, vehiclePlate: 15 };

/** Saudi IBAN: SA + 22 digits. Canonical form (no spaces, upper-case) or null. Same rule as `normalizeIban` in accounts.ts. */
export function normalizeIban(raw: string) {
  const v = raw.replace(/\s/g, "").toUpperCase();
  return /^SA\d{22}$/.test(v) ? v : null;
}
/** Arabic-Indic and Persian digits → ASCII, so a number typed on an Arabic keyboard is stored the same way. */
export const latinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REG_NO = /^[A-Za-z0-9][A-Za-z0-9\-/ ]{1,28}[A-Za-z0-9]$/; // CR / tax numbers: 3–30 letters, digits, dash, slash, space
const NATIONAL_ID = /^[A-Za-z0-9]{5,20}$/;
const PLATE = /^[\p{L}\p{N}][\p{L}\p{N} -]{0,13}[\p{L}\p{N}]$/u;
export const validPoint = (lat: unknown, lng: unknown) =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

export interface RuleContext { cityKeys: readonly string[]; enabledServices: readonly string[] }
/** The cleaned values, keyed by field name. `null` = cleared / absent. */
export type Cleaned = Record<string, string | string[] | number | null>;
export interface Checked { values: Cleaned; errors: Record<string, string> }

/** The text of a form value: trimmed, `null` when empty, `undefined` when it was not sent at all. */
function text(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Cleans and validates the fields present in `input` for one kind of account. With `partial` (an edit) only the fields that were sent are checked and
 * required fields may not be emptied; without it (a create) every required field must be there. `current` supplies the vehicle type of a driver
 * when an edit changes only the temperature (or the other way round).
 */
export function checkFields(kind: AccountKind, input: Record<string, unknown>, ctx: RuleContext, o: { partial: boolean; current?: Record<string, unknown> } = { partial: false }): Checked {
  const values: Cleaned = {}; const errors: Record<string, string> = {};
  const allowed = new Set<string>([...BASE_FIELDS, ...PROFILE_FIELDS[kind]]);
  for (const k of Object.keys(input)) if (input[k] !== undefined && input[k] !== null && input[k] !== "" && !allowed.has(k)) errors[k] = "This field does not apply to this kind of account";
  const has = (k: string) => input[k] !== undefined;
  const required = (k: string, msg: string) => { if (!o.partial && (text(input[k]) ?? null) === null) errors[k] = msg; };
  const str = (k: string, label: string, { min = 0 }: { min?: number } = {}) => {
    if (!has(k) || errors[k]) return;
    const v = text(input[k]);
    if (v === null && !CLEARABLE.has(k)) { errors[k] = `${label} is required`; return; }
    if (v && v.length < min) { errors[k] = `${label} is too short`; return; }
    if (v && v.length > (MAXLEN[k] ?? 200)) { errors[k] = `${label} is too long`; return; }
    values[k] = v ?? null;
  };

  required("name", "Name is required"); str("name", "Name", { min: 2 });
  if (kind !== "driver") { required("companyName", kind === "office" ? "Office name is required" : "Company name is required"); str("companyName", kind === "office" ? "Office name" : "Company name", { min: 2 }); }
  required("city", "City is required");
  if (has("city") && !errors.city) {
    const c = text(input.city);
    if (!c) errors.city = "City is required"; else if (!ctx.cityKeys.includes(c)) errors.city = "Unknown city"; else values.city = c;
  }
  if (has("language")) { const l = text(input.language); if (l && (LANGUAGES as readonly string[]).includes(l)) values.language = l; else errors.language = "Choose Arabic, English or Urdu"; }
  if (has("phone")) {
    const raw = text(input.phone);
    const p = raw ? normalizePhone(latinDigits(raw)) : null;
    if (!p) errors.phone = "Invalid phone"; else values.phone = p;
  } else required("phone", "Phone is required");
  if (has("email")) {
    const e = text(input.email);
    if (e && (e.length > MAXLEN.email || !EMAIL_RE.test(e))) errors.email = "Invalid email"; else values.email = e ? e.toLowerCase() : null;
  }
  for (const k of ["contactPerson", "industry", "address", "bankName"]) if (PROFILE_FIELDS[kind].includes(k)) str(k, k === "bankName" ? "Bank name" : k === "contactPerson" ? "Contact person" : k[0].toUpperCase() + k.slice(1));
  for (const k of ["crNumber", "taxNumber"]) {
    if (!PROFILE_FIELDS[kind].includes(k) || !has(k)) continue;
    const v = text(input[k]); const s = v ? latinDigits(v) : null;
    if (s && !REG_NO.test(s)) errors[k] = k === "crNumber" ? "Invalid commercial registration number" : "Invalid tax number"; else values[k] = s;
  }
  if (PROFILE_FIELDS[kind].includes("iban") && has("iban")) {
    const v = text(input.iban);
    if (v) { const n = normalizeIban(latinDigits(v)); if (!n) errors.iban = "Invalid Saudi IBAN"; else values.iban = n; } else values.iban = null;
  }
  if (kind === "business") checkPin(input, values, errors, o.current);
  if (kind === "driver") checkDriver(input, values, errors, ctx, o);
  return { values, errors };
}

function checkPin(input: Record<string, unknown>, values: Cleaned, errors: Record<string, string>, current?: Record<string, unknown>) {
  if (input.lat === undefined && input.lng === undefined) return;
  const num = (v: unknown) => (v === null || v === "" ? null : typeof v === "number" ? v : Number(latinDigits(String(v)).trim()));
  const lat = input.lat === undefined ? (current?.lat as number | null | undefined) ?? null : num(input.lat);
  const lng = input.lng === undefined ? (current?.lng as number | null | undefined) ?? null : num(input.lng);
  if (lat === null && lng === null) { values.lat = null; values.lng = null; return; }
  if (lat === null || lng === null) { errors[lat === null ? "lat" : "lng"] = "Give both latitude and longitude"; return; }
  if (!validPoint(lat, lng)) { errors.lat = "Latitude / longitude are out of range"; return; }
  values.lat = lat; values.lng = lng;
}

function checkDriver(input: Record<string, unknown>, values: Cleaned, errors: Record<string, string>, ctx: RuleContext, o: { partial: boolean; current?: Record<string, unknown> }) {
  const sent = (k: string) => input[k] !== undefined;
  if (sent("nationalId")) { const v = text(input.nationalId); const s = v ? latinDigits(v) : null; if (s && !NATIONAL_ID.test(s)) errors.nationalId = "Invalid national ID / Iqama number"; else values.nationalId = s; }
  if (sent("vehiclePlate")) { const v = text(input.vehiclePlate); if (v && !PLATE.test(v)) errors.vehiclePlate = "Invalid plate number"; else values.vehiclePlate = v ?? null; }
  const vehicle = sent("vehicleType") ? text(input.vehicleType) : (o.current?.vehicleType as string | null | undefined) ?? null;
  if (!o.partial || sent("vehicleType")) {
    if (!vehicle || !(VEHICLE_TYPES as readonly string[]).includes(vehicle)) errors.vehicleType = "Vehicle type required"; else values.vehicleType = vehicle;
  }
  if (vehicle && TEMPERATURE_VEHICLES.includes(vehicle)) {
    const temp = sent("vehicleTemperature") ? text(input.vehicleTemperature) : (o.current?.vehicleTemperature as string | null | undefined) ?? null;
    if (temp !== "dry" && temp !== "cold") errors.vehicleTemperature = "Temperature required";
    else if (!o.partial || sent("vehicleTemperature") || sent("vehicleType")) values.vehicleTemperature = temp as string;
  } else if (vehicle && (!o.partial || sent("vehicleType"))) values.vehicleTemperature = null; // dry / cold only applies to vans and dynas
  if (!o.partial || sent("services")) {
    const sv = input.services;
    if (!Array.isArray(sv) || !sv.length || sv.length > 10 || sv.some((x) => typeof x !== "string" || !ctx.enabledServices.includes(x))) errors.services = "Choose at least one enabled service";
    else values.services = [...new Set(sv as string[])];
  }
}

/** Sensitive fields present in a payload (the caller needs `drivers.sensitive` to send them). */
export const sensitiveIn = (kind: AccountKind, input: Record<string, unknown>) => SENSITIVE_FIELDS[kind].filter((k) => input[k] !== undefined && input[k] !== null && input[k] !== "");

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Field-level diff of what really changes (fields whose new value equals the old one are dropped). */
export function diffFields(before: Record<string, unknown>, after: Cleaned): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, to] of Object.entries(after)) if (!same(before[k], to)) out[k] = { from: before[k] ?? null, to };
  return out;
}
const tail = (v: unknown, n: number) => { const s = typeof v === "string" ? v : ""; return s ? `…${s.slice(-n)}` : null; };
/** Payout and identity numbers are never written in full to the audit log (the phone is: its old → new value is the point of the entry). */
export function maskDiff(diff: Record<string, { from: unknown; to: unknown }>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, d] of Object.entries(diff)) out[k] = k === "iban" || k === "nationalId" ? { from: tail(d.from, 4), to: tail(d.to, 4) } : k === "taxNumber" || k === "bankName" ? { from: d.from ? "set" : null, to: d.to ? "set" : null } : d;
  return out;
}
export const maskPhone = (p: string | null) => (p ? p.slice(0, 4) + "•••" + p.slice(-2) : null);
