/**
 * Partners write cities freely ("Riyadh", "الرياض", "Jiddah", "Al Khobar", "RUH" …). JR needs its own city key, so this matcher folds the
 * usual spelling variants; anything it cannot place stays unmatched (the business picks the city — JR never guesses a delivery city).
 */
type City = { key: string; en: string; ar: string; ur?: string; delivery?: boolean };

const AR_FOLD: Array<[RegExp, string]> = [[/[إأآا]/g, "ا"], [/ى/g, "ي"], [/ة/g, "ه"], [/[ًٌٍَُِّْـ]/g, ""]];
export function foldCity(s: string): string {
  let v = s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  for (const [re, to] of AR_FOLD) v = v.replace(re, to);
  v = v.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  v = v.replace(/^(al|el|ال)\s*/u, "").replace(/\s+(city|region|province|المنطقه|منطقه)$/u, "").replace(/^(city of|madinat|مدينه)\s+/u, "");
  return v.replace(/\s+/g, "");
}

/** Spellings and airport/short codes seen in Saudi logistics systems, per JR city key. */
const ALIASES: Record<string, string[]> = {
  riyadh: ["riyad", "ruh", "riyadhcity"],
  jeddah: ["jiddah", "jedda", "jed", "jidda"],
  dammam: ["dmm", "damam"],
  khobar: ["alkhobar", "khubar", "alkhubar"],
  makkah: ["mecca", "makka", "mekkah", "makkahalmukarramah", "مكه", "مكهالمكرمه"],
  madinah: ["medina", "madina", "almadinah", "med", "almadinahalmunawwarah", "المدينه", "مدينهالمنوره"],
  tabuk: ["tabouk", "tuk"],
  abha: ["ahb"],
  buraydah: ["buraidah", "buraida", "burayda", "qassim", "elq", "القصيم"],
};

export function matchCity(raw: string | null | undefined, cities: readonly City[]): string | null {
  if (!raw || !raw.trim()) return null;
  const f = foldCity(raw);
  if (!f) return null;
  for (const c of cities) {
    const names = [c.key, c.en, c.ar, c.ur ?? "", ...(ALIASES[c.key] ?? [])].filter(Boolean).map(foldCity);
    if (names.includes(f)) return c.key;
  }
  return null;
}
