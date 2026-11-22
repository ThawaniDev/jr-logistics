import type { Dict } from "../core";

/**
 * Audit K / A6 — driver app: messages for writes whose answer never came back, and the minimum withdrawal. Every key starts with `m.`.
 * en, ar and ur are built from the same rows, so a key can never exist in one language only.
 */
type Row = [key: string, en: string, ar: string, ur: string];
const rows: Row[] = [
  ["m.net_unconfirmed_write", "No connection. We couldn't confirm that it went through. Check your signal and look at the list before trying again.",
    "لا يوجد اتصال. لم نتمكن من التأكد من اكتمال العملية. تحقق من الإشارة وراجع القائمة قبل المحاولة مرة أخرى.",
    "کنکشن نہیں ہے۔ ہم تصدیق نہیں کر سکے کہ عمل مکمل ہوا۔ سگنل چیک کریں اور دوبارہ کوشش سے پہلے فہرست دیکھ لیں۔"],
  ["m.reg_unconfirmed", "No connection. Your account may already have been created — try signing in before registering again.",
    "لا يوجد اتصال. ربما تم إنشاء حسابك بالفعل — جرّب تسجيل الدخول قبل التسجيل من جديد.",
    "کنکشن نہیں ہے۔ ہو سکتا ہے آپ کا اکاؤنٹ بن چکا ہو — دوبارہ رجسٹر کرنے سے پہلے سائن اِن کر کے دیکھیں۔"],
  ["m.withdraw_min", "The minimum withdrawal is {amount}.", "الحد الأدنى للسحب هو {amount}.", "کم از کم رقم نکلوانے کی حد {amount} ہے۔"],
];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(rows.map((r) => [r[0], r[i]]));
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
