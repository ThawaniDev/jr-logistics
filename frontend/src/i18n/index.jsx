import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { translations } from "./translations";
import api from "@/lib/api";

export const LANGS = [
  { code: "ar", label: "العربية", dir: "rtl" },
  { code: "en", label: "English", dir: "ltr" },
  { code: "ur", label: "اردو", dir: "rtl" },
];

const I18nContext = createContext(null);

function lookup(lang, key) {
  let cur = translations[lang];
  for (const p of key.split(".")) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem("isnad_lang") || "ar");
  const dir = LANGS.find((l) => l.code === lang)?.dir || "rtl";

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((code, persistRemote = true) => {
    setLangState(code);
    localStorage.setItem("isnad_lang", code);
    if (persistRemote) api.patch("/profile", { language: code }).catch(() => {});
  }, []);

  const syncFromUser = useCallback((userLang) => {
    if (userLang && userLang !== localStorage.getItem("isnad_lang")) {
      setLang(userLang, false);
    }
  }, [setLang]);

  const t = useCallback((key, vars) => {
    let val = lookup(lang, key);
    if (val === undefined) val = lookup("ar", key);
    if (val === undefined) return key;
    if (vars && typeof val === "string") {
      Object.entries(vars).forEach(([k, v]) => { val = val.split(`{${k}}`).join(String(v)); });
    }
    return val;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, dir, isRtl: dir === "rtl", t, setLang, syncFromUser, LANGS }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);
