import type { Dict } from "../core";

/**
 * Theme (light / dark / system) menu and profile setting. Every key starts with `theme.`.
 * en, ar and ur are built from the same rows, so a key can never exist in one language only.
 */
type Row = [key: string, en: string, ar: string, ur: string];
const rows: Row[] = [
  ["theme.label", "Theme", "المظهر", "تھیم"],
  ["theme.aria", "Theme: {mode}", "المظهر: {mode}", "تھیم: {mode}"],
  ["theme.system", "System", "النظام", "سسٹم"],
  ["theme.light", "Light", "فاتح", "روشن"],
  ["theme.dark", "Dark", "داكن", "گہرا"],
  ["theme.profile_title", "Appearance", "المظهر", "ظاہری شکل"],
  ["theme.profile_hint", "Choose how JR Logistics looks on this device. System follows your phone or computer setting.", "اختر شكل JR Logistics على هذا الجهاز. خيار النظام يتبع إعداد هاتفك أو حاسوبك.", "اس ڈیوائس پر JR Logistics کی شکل منتخب کریں۔ سسٹم آپ کے فون یا کمپیوٹر کی سیٹنگ کے مطابق چلتا ہے۔"],
];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(rows.map((r) => [r[0], r[i]]));
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
