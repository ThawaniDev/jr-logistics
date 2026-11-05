export const LOCALES = ["ar", "en", "ur"] as const;
export type Locale = (typeof LOCALES)[number];
export const RTL: Locale[] = ["ar", "ur"];
export const dirOf = (l: Locale): "rtl" | "ltr" => (RTL.includes(l) ? "rtl" : "ltr");
export const LANG_COOKIE = "jr_lang";
export const LOCALE_LABEL: Record<Locale, string> = { ar: "العربية", en: "English", ur: "اردو" };
export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

export type Dict = Record<string, string>;
export function translate(dict: Dict, fallback: Dict, key: string, vars?: Record<string, string | number>): string {
  let s = dict[key] ?? fallback[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
