import type { Locale } from "@/i18n/core";

const tag = (l: Locale) => (l === "en" ? "en-GB" : l === "ur" ? "ur-PK-u-nu-latn" : "ar-SA-u-nu-latn-ca-gregory");
export const fmtMoney = (cents: number | null | undefined, l: Locale) =>
  cents == null ? "—" : new Intl.NumberFormat(tag(l), { style: "currency", currency: "SAR", currencyDisplay: l === "en" ? "code" : "symbol", minimumFractionDigits: 2 }).format(cents / 100);
export const fmtNum = (n: number | null | undefined, l: Locale) => (n == null ? "—" : new Intl.NumberFormat(tag(l)).format(n));
export const fmtDate = (d: string | Date | null | undefined, l: Locale) =>
  d ? new Intl.DateTimeFormat(tag(l), { dateStyle: "medium", timeZone: "Asia/Riyadh" }).format(new Date(d)) : "—";
export const fmtDateTime = (d: string | Date | null | undefined, l: Locale) =>
  d ? new Intl.DateTimeFormat(tag(l), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(d)) : "—";
export const fmtTime = (d: string | Date | null | undefined, l: Locale) =>
  d ? new Intl.DateTimeFormat(tag(l), { timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date(d)) : "—";
export function fmtDuration(sec: number, l: Locale) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${fmtNum(m, l)} ${l === "en" ? "min" : l === "ur" ? "منٹ" : "د"}`;
  return `${fmtNum(Math.floor(m / 60), l)}${l === "en" ? "h" : l === "ur" ? " گھنٹے" : "س"} ${fmtNum(m % 60, l)}${l === "en" ? "m" : l === "ur" ? " منٹ" : "د"}`;
}
export const fmtKm = (m: number, l: Locale) => `${fmtNum(Math.round(m / 100) / 10, l)} ${l === "en" ? "km" : l === "ur" ? "کلومیٹر" : "كم"}`;
/** Convert a SAR amount typed by a user into integer halalas without float drift. */
export const sarToCents = (v: string | number) => Math.round(Number(v) * 100);
/** datetime-local helper: Riyadh wall time → ISO. */
export function riyadhLocalToIso(local: string) { return new Date(`${local}:00+03:00`).toISOString(); }
export function isoToRiyadhLocal(iso: string) {
  const d = new Date(new Date(iso).getTime() + 3 * 3600_000);
  return d.toISOString().slice(0, 16);
}
