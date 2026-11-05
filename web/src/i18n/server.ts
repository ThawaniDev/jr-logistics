import { cookies, headers } from "next/headers";
import { isLocale, LANG_COOKIE, translate, type Locale } from "./core";
import { dictionaries } from "./dictionaries";

/** Cookie wins; otherwise the browser's Accept-Language; otherwise Arabic (primary market). */
export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLocale(c)) return c;
  const al = (await headers()).get("accept-language") ?? "";
  for (const part of al.split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isLocale(code)) return code;
  }
  return "ar";
}
export async function getT() {
  const locale = await getLocale();
  return { locale, t: (k: string, vars?: Record<string, string | number>) => translate(dictionaries[locale], dictionaries.en, k, vars) };
}
