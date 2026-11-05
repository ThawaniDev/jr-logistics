"use client";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { dirOf, LANG_COOKIE, translate, type Dict, type Locale } from "./core";

interface Ctx { locale: Locale; dir: string; t: (key: string, vars?: Record<string, string | number>) => string; setLocale: (l: Locale) => void }
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ locale, dict, fallback, children }: { locale: Locale; dict: Dict; fallback: Dict; children: ReactNode }) {
  const t = useCallback((key: string, vars?: Record<string, string | number>) => translate(dict, fallback, key, vars), [dict, fallback]);
  const setLocale = useCallback((l: Locale) => {
    document.cookie = `${LANG_COOKIE}=${l}; Path=/; Max-Age=31536000; SameSite=Lax`;
    // persist for signed-in users; ignore failures (anonymous visitors)
    fetch("/api/v1/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: l }) }).catch(() => {}).finally(() => window.location.reload());
  }, []);
  const value = useMemo(() => ({ locale, dir: dirOf(locale), t, setLocale }), [locale, t, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n() {
  const c = useContext(I18nContext);
  if (!c) throw new Error("useI18n outside provider");
  return c;
}
export const useT = () => useI18n().t;
