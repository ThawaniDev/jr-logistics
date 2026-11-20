import { DEFAULT_CITIES } from "./catalog";

/**
 * Demo parcels for trying the platform without typing: 80 ready-made, FULLY detailed shipments (recipient, phone, address, map pin,
 * contents, notes, order reference) for any delivery city. Served only when DEMO_MODE is on (see the route); never offered in production.
 *
 * Everything is fictitious and deterministic (same city → same 80 parcels every time, so tests and demos are repeatable):
 * names are made up, phone numbers use the 0500000xxx block, and the map pins are spread across the city's real districts
 * (Riyadh uses real district centres) with small offsets — good enough to exercise route planning, not real addresses.
 */
export interface DemoShipment {
  n: number; ref: string; recipientType: "consumer" | "business";
  recipientName: string; recipientPhone: string; address: string; city: string; lat: number; lng: number;
  contents: string; notes: string | null; district: string;
  /** Cash on delivery in halalas (every third parcel is cash-on-delivery; 0 = prepaid). */
  codCents: number;
}

export const DEMO_SHIPMENT_COUNT = 80;

const FIRST = ["محمد", "عبدالله", "فهد", "سلطان", "خالد", "ناصر", "سعود", "تركي", "بندر", "ماجد", "أحمد", "يوسف", "إبراهيم", "عمر", "فيصل", "سلمان", "نورة", "سارة", "ريم", "هند", "لينا", "منى", "ريما", "أماني", "دانة", "جود", "العنود", "شهد", "لمى", "غادة"];
const LAST = ["العتيبي", "القحطاني", "الدوسري", "الزهراني", "الغامدي", "الشمري", "المطيري", "الحربي", "السبيعي", "العنزي", "الشهري", "البلوي", "الرشيدي", "اليامي", "المالكي"];
const SHOPS = ["صيدلية النور", "بقالة الأمل", "مطعم الديرة", "عيادة الشفاء", "ورشة السلام", "مكتبة المعرفة", "مخبز الفرن الذهبي", "متجر الإلكترونيات الحديثة", "كوفي لاب", "سوبرماركت البركة", "صالون لمسة", "مركز الصيانة السريعة", "حلويات الروضة", "معرض الأثاث العصري", "مغسلة البيضاء", "شركة الأفق للمقاولات", "مختبر الحياة الطبي", "محل العطور الملكية", "مركز الهدى للتدريب", "استوديو الصورة"];
const CONTENTS = ["ملابس", "أجهزة إلكترونية", "مواد غذائية", "أدوية", "مستندات", "كتب", "مستحضرات تجميل", "قطع غيار", "ألعاب أطفال", "أدوات مطبخ", "هاتف جوال", "حقيبة", "عطور", "مستلزمات مكتبية", "أحذية"];
const COD_AMOUNTS = [4500, 7500, 12000, 19900, 25000, 35000, 52500, 89900]; // SAR 45 … 899
const NOTES = ["الاتصال قبل الوصول", "البوابة الثانية", "التسليم لحارس الأمن مرفوض", "الدور الثالث — شقة 7", "المحل يفتح بعد الظهر", null, null, null, null, null];
const STREETS = ["King Fahd Rd", "Olaya St", "King Abdullah Rd", "Prince Sultan Rd", "Takhassusi St", "Al Urubah Rd", "Imam Saud bin Abdulaziz Rd", "Abu Bakr Al Siddiq Rd", "Uthman bin Affan Rd", "Anas bin Malik Rd", "Prince Turki bin Abdulaziz Rd", "Salah Ad Din Rd", "King Salman Rd", "Al Imam Ahmad bin Hanbal St"];

/** Real Riyadh district centres. */
const RIYADH: Array<[string, number, number]> = [
  ["Al Olaya", 24.6937, 46.685], ["Al Malaz", 24.665, 46.73], ["Al Sulimaniyah", 24.7, 46.7], ["Al Nakheel", 24.74, 46.63], ["Hittin", 24.77, 46.605],
  ["Al Yasmin", 24.823, 46.643], ["Al Malqa", 24.81, 46.6], ["Al Rawdah", 24.73, 46.77], ["Al Naseem", 24.73, 46.83], ["Al Aziziyah", 24.56, 46.75],
  ["Al Shifa", 24.57, 46.7], ["As Sahafah", 24.8, 46.63], ["Qurtubah", 24.81, 46.735], ["Al Wadi", 24.785, 46.68], ["Al Murabba", 24.65, 46.71], ["Al Worood", 24.715, 46.675],
];
const OTHER_DISTRICTS = ["Al Nahda", "Al Salam", "Al Rawdah", "Al Hamra", "Al Safa", "Al Faisaliyah", "Al Aziziyah", "Al Naseem", "Al Shati", "Al Khalidiyah", "Al Zahra", "Al Marwah", "Al Yarmouk", "Al Andalus", "Al Mohammadiyah", "Al Sharq"];

/** Small deterministic PRNG (mulberry32) so a city always yields the same parcels. */
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** `b2b: false` (the platform has B2B shipments off, J3) → every demo parcel is a consumer parcel (the picker feeds manifests, which refuse business recipients then). */
export function demoShipments(cityKey: string, opts: { b2b?: boolean } = {}): DemoShipment[] | null {
  const city = DEFAULT_CITIES.find((c) => c.key === cityKey && c.delivery);
  if (!city) return null;
  const rand = rng(hash(cityKey));
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
  // Spread outside Riyadh: golden-angle spiral over a ~9 km disc around the centre (even coverage, every area gets parcels).
  const radiusKm = cityKey === "jeddah" || cityKey === "dammam" ? 11 : 8;
  const out: DemoShipment[] = [];
  for (let i = 0; i < DEMO_SHIPMENT_COUNT; i++) {
    let lat: number, lng: number, district: string;
    if (cityKey === "riyadh") {
      const d = RIYADH[i % RIYADH.length];
      lat = d[1] + (rand() - 0.5) * 0.016; lng = d[2] + (rand() - 0.5) * 0.016; district = d[0];
    } else {
      const r = radiusKm * Math.sqrt((i + 0.5) / DEMO_SHIPMENT_COUNT), th = i * 2.399963;
      lat = city.lat + (r * Math.sin(th)) / 111.2; lng = city.lng + (r * Math.cos(th)) / (111.2 * Math.cos((city.lat * Math.PI) / 180));
      district = OTHER_DISTRICTS[i % OTHER_DISTRICTS.length];
    }
    const business = i % 4 === 3; // every 4th parcel goes to a business (20 of 80)
    const n = i + 1;
    out.push({
      n, ref: `DEMO-${String(n).padStart(3, "0")}`, recipientType: business && opts.b2b !== false ? "business" : "consumer",
      recipientName: business ? SHOPS[(i >> 2) % SHOPS.length] : `${pick(FIRST)} ${pick(LAST)}`,
      recipientPhone: `05000${String(n).padStart(5, "0")}`, // 0500000001 … 0500000080 — fictitious
      address: `Building ${1000 + Math.floor(rand() * 8999)}, ${pick(STREETS)}, ${district}, ${city.en}`,
      city: cityKey, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, district,
      contents: pick(CONTENTS), notes: pick(NOTES), codCents: n % 3 === 1 ? pick(COD_AMOUNTS) : 0,
    });
  }
  return out;
}
