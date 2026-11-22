import type { Dict } from "../core";

/**
 * Mobile app appearance (light / dark / system). Every key starts with `m.theme_`.
 * en, ar and ur are built from the same rows, so a key can never exist in one language only.
 */
type Row = [key: string, en: string, ar: string, ur: string];
const rows: Row[] = [
  ["m.theme_title", "Appearance", "المظهر", "ظاہری شکل"],
  ["m.theme_system", "System default", "حسب النظام", "سسٹم کے مطابق"],
  ["m.theme_system_hint", "Follows your phone's light or dark setting", "يتبع إعداد الهاتف (فاتح أو داكن)", "فون کی ہلکی یا گہری سیٹنگ کے مطابق"],
  ["m.theme_light", "Light", "فاتح", "روشن"],
  ["m.theme_dark", "Dark", "داكن", "گہرا"],
];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(rows.map((r) => [r[0], r[i]]));
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
