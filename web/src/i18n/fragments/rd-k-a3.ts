import type { Dict } from "../core";

/**
 * Short notification variants (A3 audit). `notif.<type>__short` is what the notification text falls back to when a parameter of the full text is not available
 * (a vehicle-day job has no parcel count). en, ar and ur are built from the same rows, so a key can never exist in one language only.
 */
type Row = [key: string, en: string, ar: string, ur: string];
const rows: Row[] = [
  ["notif.offer_new__short", "New job offer {ref}: {pickupCity} → {deliveryCity}", "عرض مهمة جديد {ref}: {pickupCity} ← {deliveryCity}", "کام کی نئی پیشکش {ref}: {pickupCity} ← {deliveryCity}"],
  ["notif.offer_replacement__short", "Replacement job offer {ref}: {pickupCity} → {deliveryCity}", "عرض مهمة بديلة {ref}: {pickupCity} ← {deliveryCity}", "متبادل کام کی پیشکش {ref}: {pickupCity} ← {deliveryCity}"],
];
const pick = (i: 1 | 2 | 3): Dict => Object.fromEntries(rows.map((r) => [r[0], r[i]]));
export const en: Dict = pick(1);
export const ar: Dict = pick(2);
export const ur: Dict = pick(3);
