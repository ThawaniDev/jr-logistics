import type { Dict } from "../core";

/**
 * Platform update J2 / J3 (server): routing off, B2B shipments off. Error messages shown to users, plus the timeline label of an import that was coerced to consumer parcels.
 * en, ar and ur are built from the same rows, so a key can never exist in one language only.
 */
type Row = [key: string, en: string, ar: string, ur: string];
const rows: Row[] = [
  ["err.ROUTING_DISABLED", "Route planning is turned off by the platform.", "تخطيط المسار متوقف من قِبل المنصة.", "روٹ پلاننگ پلیٹ فارم نے بند کر رکھی ہے۔"],
  ["err.B2B_DISABLED", "Business shipments are turned off — every parcel goes to a consumer.", "شحنات الأعمال (B2B) متوقفة — كل الشحنات تُسلَّم إلى أفراد.", "بزنس (B2B) شپمنٹس بند ہیں — ہر پارسل صارف کو جاتا ہے۔"],
  ["event.shipments_b2b_coerced", "Business recipients were created as consumer parcels (B2B is off)", "أُنشئت شحنات المستلمين من الأعمال كشحنات أفراد (B2B متوقف)", "بزنس وصول کنندگان کو صارف پارسل کے طور پر بنایا گیا (B2B بند ہے)"],
];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(rows.map((r) => [r[0], r[i]]));
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
