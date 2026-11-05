import type { Dict, Locale } from "./core";
import ar from "./ar";
import en from "./en";
import ur from "./ur";
export const dictionaries: Record<Locale, Dict> = { ar, en, ur };
