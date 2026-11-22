export const LOCALES = ["ar", "en", "ur"] as const;
export type Locale = (typeof LOCALES)[number];
export const RTL: Locale[] = ["ar", "ur"];
export const dirOf = (l: Locale): "rtl" | "ltr" => (RTL.includes(l) ? "rtl" : "ltr");
export const LANG_COOKIE = "jr_lang";
export const LOCALE_LABEL: Record<Locale, string> = { ar: "العربية", en: "English", ur: "اردو" };
export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

export type Dict = Record<string, string>;
/**
 * Looks `key` up (active language, then English, then the key itself) and fills `{name}` placeholders in ONE pass, so a value that itself contains
 * braces (a company called "{n}") is never substituted a second time; a placeholder without a value stays as it is.
 * English has no plural forms in the dictionary, so a text that reads wrong for one (“1 parcels”) gets a `<key>__one` twin: it is used when `vars.n` is 1
 * and the ACTIVE dictionary defines it (Arabic/Urdu wording is number-neutral and has none).
 */
export function translate(dict: Dict, fallback: Dict, key: string, vars?: Record<string, string | number>): string {
  let s = dict[key] ?? fallback[key] ?? key;
  if (!vars) return s;
  if (Number(vars.n) === 1 && vars.n !== "") { const one = dict[`${key}__one`]; if (one) s = one; }
  return s.replace(/\{([A-Za-z0-9_]+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}
