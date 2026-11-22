import type { Dict } from "../core";

/** Small additions made while integrating the audit (decision K): every key starts with `k.`. */
type Row = [key: string, en: string, ar: string, ur: string];
const rows: Row[] = [
  ["k.cmp_hold_needs_order", "Link the complaint to an order before holding its settlement: a hold finds the money through the order.", "اربط الشكوى بطلب قبل حجز التسوية: يصل الحجز إلى المبلغ عبر الطلب.", "تصفیہ روکنے سے پہلے شکایت کو آرڈر سے جوڑیں: رکاوٹ رقم تک آرڈر کے ذریعے پہنچتی ہے۔"],
];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(rows.map((r) => [r[0], r[i]]));
export const en = pick(1);
export const ar = pick(2);
export const ur = pick(3);
