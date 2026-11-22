import type { Dict } from "../core";

/**
 * Report copy added by the data audit (audit K, A4). Keys follow the finance report's `rpd.` scheme (`rpd.kpi_<key>` / `rpd.def_<key>`).
 * en, ar and ur are built from the same rows, so a key can never exist in one language only.
 */
type Row = [key: string, en: string, ar: string, ur: string];
const rows: Row[] = [
  ["rpd.kpi_fin_rental_revenue", "Driverless rental revenue",
    "إيراد تأجير المركبات بدون سائق", "بغیر ڈرائیور کرائے کی آمدن"],
  ["rpd.def_fin_rental_revenue",
    "What the platform kept for driverless vehicle rentals fulfilled in the period, VAT included (the whole charge: a rental has no provider cost and no settlement), by the moment the money reached the platform wallet. It is NOT part of Billed or Platform revenue, which count settlements only: Platform revenue + this figure = what the platform wallet received. Not narrowed by office or driver.",
    "ما احتفظت به المنصة من عمليات تأجير المركبات بدون سائق المنفَّذة في الفترة شاملًا الضريبة (كامل المبلغ المحصَّل: لا تكلفة مزوّد ولا تسوية للتأجير)، بحسب لحظة وصول المال إلى محفظة المنصة. لا يدخل في «المفوتر» ولا في «إيراد المنصة» اللذين يحتسبان التسويات فقط: إيراد المنصة + هذا الرقم = ما استلمته محفظة المنصة. لا يتأثر بمرشحي المكتب والسائق.",
    "مدت میں مکمل ہونے والے بغیر ڈرائیور گاڑی کرائے پر پلیٹ فارم نے جو رکھا، ویٹ سمیت (پوری وصولی: کرائے میں فراہم کنندہ کی لاگت ہوتی ہے نہ سیٹلمنٹ)، اس لمحے کے مطابق جب رقم پلیٹ فارم والیٹ میں پہنچی۔ یہ «بل شدہ» یا «پلیٹ فارم آمدن» میں شامل نہیں جو صرف سیٹلمنٹس گنتے ہیں: پلیٹ فارم آمدن + یہ رقم = پلیٹ فارم والیٹ کو ملنے والی رقم۔ آفس اور ڈرائیور فلٹر اس پر لاگو نہیں ہوتے۔"],
];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(rows.map((r) => [r[0], r[i]]));
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
